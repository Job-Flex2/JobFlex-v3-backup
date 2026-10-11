// THE INVENTORY PAGE'S READ (2026-09-29) — server only.
//
// One route, three trades, two things per trade: the price book the estimator
// prices from and the warehouse stock the proposals draw on. The trade comes
// from the URL, else the visitor's last choice (a cookie), else the company's
// own specialty (Organization.tradeTypesJson), else roofing. Every document is
// read the way its estimator reads it — the same actions' rules, the same
// fallbacks — so the page and the estimator can never show two books.

import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { isTradeId, TRADES, type TradeId } from "@/lib/inventory";
import { loadTradeBoard, type TradeBoardData } from "@/lib/inventoryBoard";
import { loadStockFacts, type StockFacts } from "@/lib/inventoryDashboard";
import { parseTradeTypes } from "@/lib/tradeTypes";
import { fenceCatalogSchema, type FenceCatalogDoc } from "@/lib/fence/catalogSchema";
import { roofCatalogSchema, type RoofCatalogDoc } from "@/lib/roofPackage/catalogSchema";
import { DEFAULT_RATE_CARD, STARTER_CATALOG, normalizeRateCard, type HvacRateCard } from "@/lib/hvac/ledger";
import type { CatalogItem } from "@/lib/hvac/types";
import { locationIndex } from "@/lib/estimate/location-index";
import { sanitizeDeckRateBook, type DeckRateBook } from "@/lib/deck/rates";
import { deckBookKey } from "@/lib/deck/rateBookStore";

export const TRADE_COOKIE = "jf_inventory_trade";

export type InventoryTab = "book" | "stock" | "services";

export type PriceBookData =
  | { trade: "fence"; doc: FenceCatalogDoc | null; updatedAt: string | null }
  | { trade: "roof"; doc: RoofCatalogDoc | null; updatedAt: string | null }
  | { trade: "hvac"; items: CatalogItem[]; own: boolean; card: HvacRateCard; cardOwn: boolean; defaults: HvacRateCard; updatedAt: string | null; factor: number; place: string }
  | { trade: "deck"; book: DeckRateBook; updatedAt: string | null };

export type InventoryPageData = {
  trade: TradeId;
  trades: typeof TRADES;
  tab: InventoryTab;
  book: PriceBookData;
  stock: { data: TradeBoardData; facts: StockFacts } | null;
};

/** The trade the page opens on. */
export async function resolveInventoryTrade(organizationId: string, requested: string | null | undefined): Promise<TradeId> {
  if (isTradeId(requested)) return requested;
  try {
    const c = (await cookies()).get(TRADE_COOKIE)?.value;
    if (isTradeId(c)) return c;
  } catch {
    /* outside a request */
  }
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { tradeTypesJson: true } });
  for (const t of parseTradeTypes(org?.tradeTypesJson)) {
    const s = String(t).toLowerCase();
    if (s.startsWith("roof")) return "roof";
    if (s.startsWith("fenc")) return "fence";
    if (s.startsWith("hvac")) return "hvac";
    if (s.startsWith("deck")) return "deck";
  }
  return "roof";
}

export function parseTab(raw: string | null | undefined, trade: TradeId): InventoryTab {
  if (raw === "stock") return "stock";
  if (raw === "services" && trade === "hvac") return "services";
  return "book";
}

async function fenceBook(organizationId: string): Promise<PriceBookData> {
  try {
    const row = await db.fenceCatalog.findUnique({ where: { organizationId } });
    if (!row) return { trade: "fence", doc: null, updatedAt: null };
    const parsed = fenceCatalogSchema.safeParse(JSON.parse(row.catalogJson));
    return { trade: "fence", doc: parsed.success ? parsed.data : null, updatedAt: row.updatedAt.toISOString() };
  } catch {
    return { trade: "fence", doc: null, updatedAt: null };
  }
}

async function roofBook(organizationId: string): Promise<PriceBookData> {
  try {
    const row = await db.roofCatalog.findUnique({ where: { organizationId } });
    if (!row) return { trade: "roof", doc: null, updatedAt: null };
    const parsed = roofCatalogSchema.safeParse(JSON.parse(row.catalogJson));
    return { trade: "roof", doc: parsed.success ? parsed.data : null, updatedAt: row.updatedAt.toISOString() };
  } catch {
    return { trade: "roof", doc: null, updatedAt: null };
  }
}

async function hvacBook(organizationId: string): Promise<PriceBookData> {
  let items: CatalogItem[] = STARTER_CATALOG;
  let own = false;
  let updatedAt: Date | null = null;
  let card: HvacRateCard = DEFAULT_RATE_CARD;
  let cardOwn = false;
  try {
    const rows = await db.hvacCatalogItem.findMany({ where: { organizationId }, orderBy: [{ kind: "asc" }, { brand: "asc" }, { model: "asc" }] });
    if (rows.length) {
      items = rows.map((r) => JSON.parse(r.itemJson) as CatalogItem);
      own = true;
      updatedAt = rows.reduce<Date | null>((m, r) => (m && m > r.updatedAt ? m : r.updatedAt), null);
    }
  } catch {
    /* table not pushed yet: the starter ladder stands */
  }
  try {
    const row = await db.hvacSettings.findUnique({ where: { organizationId } });
    if (row) {
      card = normalizeRateCard(JSON.parse(row.rateCardJson));
      cardOwn = true;
      if (!updatedAt || row.updatedAt > updatedAt) updatedAt = row.updatedAt;
    }
  } catch {
    /* defaults */
  }
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { address: true } });
  const idx = locationIndex(org?.address ?? "");
  return { trade: "hvac", items, own, card, cardOwn, defaults: DEFAULT_RATE_CARD, updatedAt: updatedAt?.toISOString() ?? null, factor: idx.factor, place: idx.place };
}

/** The deck estimator's price book (lib/deck/rates): the rows the shop typed, under its SyncState key. */
async function deckBook(organizationId: string): Promise<PriceBookData> {
  try {
    const row = await db.syncState.findUnique({ where: { key: deckBookKey(organizationId) } });
    return { trade: "deck", book: row ? sanitizeDeckRateBook(JSON.parse(row.cursor)) : {}, updatedAt: row?.updatedAt?.toISOString() ?? null };
  } catch {
    return { trade: "deck", book: {}, updatedAt: null };
  }
}

export async function loadInventoryPage(organizationId: string, trade: TradeId, tab: InventoryTab): Promise<InventoryPageData> {
  const book = trade === "fence" ? await fenceBook(organizationId) : trade === "roof" ? await roofBook(organizationId) : trade === "deck" ? await deckBook(organizationId) : await hvacBook(organizationId);
  let stock: InventoryPageData["stock"] = null;
  if (tab === "stock") {
    const data = await loadTradeBoard(organizationId, trade);
    if (data) {
      const facts = await loadStockFacts(organizationId, trade, data.proposals.filter((p) => p.linked && p.status === "ACCEPTED" && !p.loaded).map((p) => p.id));
      stock = { data, facts };
    }
  }
  return { trade, trades: TRADES, tab, book, stock };
}
