// Warehouse stock against the work that will use it (2026-09-20).
//
// Owner: the fence, roof and HVAC companies keep their own stock; the
// proposals should draw on it, warn before it runs short, and the crew
// should get a list of what to take. Pure arithmetic — no database, no
// server imports — so the trade boards, the job page and the QA agree.
//
//   on hand     what the warehouse holds (the movements, summed).
//   reserved    what SOLD jobs still need and have not loaded yet.
//   available   on hand − reserved: what a new sale could have.
//   forecast    what the OPEN proposals would take if every one sold.
//   short       forecast − available, when positive: order this much before
//               those proposals sell.
//   low         available under the reorder point — the point the office
//               set, else the biggest single job on the books, so the
//               warehouse always covers the next truck.
//
// What the company keeps in stock (2026-09-23): not every contractor stocks
// everything a job needs. An item is either KEPT IN STOCK — everything above
// applies — or BOUGHT PER JOB (StockItem.stocked false): the shelf is not
// expected to hold it, so it is never low or short and no restock is
// suggested; instead, when a job sells, its per-job materials go on a
// shopping list for that job (jobBuyList), and the crew's pick list says so.

export type TradeId = "fence" | "roof" | "hvac" | "deck";

export const TRADES: Array<{ id: TradeId; label: string; noun: string }> = [
  { id: "fence", label: "Fence", noun: "fence" },
  { id: "roof", label: "Roofing", noun: "roof" },
  { id: "hvac", label: "HVAC", noun: "HVAC" },
  { id: "deck", label: "Deck", noun: "deck" },
];

export function isTradeId(x: string | null | undefined): x is TradeId {
  return x === "fence" || x === "roof" || x === "hvac" || x === "deck";
}

/**
 * Each trade's inventory lives under its own estimator (owner, 2026-10-10:
 * "a roofer doesn't have to see the other inventories") — the page that was
 * one route for the three trades from 2026-09-29. /dashboard/inventory now
 * only forwards here.
 */
export const INVENTORY_PATH: Record<TradeId, string> = {
  roof: "/dashboard/roof-estimator/inventory",
  fence: "/dashboard/fence-estimator/inventory",
  hvac: "/dashboard/hvac-estimator/inventory",
  deck: "/dashboard/deck-estimator/inventory",
};
export const INVENTORY_PATHS: readonly string[] = Object.values(INVENTORY_PATH);

/** The address of a trade's inventory, on a tab ("book" is the default and is left out). */
export function inventoryHref(trade: TradeId, tab?: "book" | "stock" | "services" | null, hash = ""): string {
  return `${INVENTORY_PATH[trade]}${tab && tab !== "book" ? `?tab=${tab}` : ""}${hash}`;
}

/** The trade whose inventory a path is, or null. */
export function inventoryTradeOf(pathname: string | null | undefined): TradeId | null {
  const path = (pathname ?? "").split("?")[0];
  for (const t of ["roof", "fence", "hvac", "deck"] as const) if (path === INVENTORY_PATH[t]) return t;
  return null;
}

/** A proposal's material line as the stock reads it. */
export type StockLine = { name: string; quantity: number; unit?: string | null };

export type StockItem = {
  id: string;
  name: string;
  key: string;
  unit: string;
  onHand: number;
  reorderPoint: number | null;
  supplierId: string | null;
  supplierName?: string | null;
  supplierSku?: string | null;
  /** Kept on the shelf (absent = yes). False = bought for each job — never low, never restocked; on the job's shopping list instead. */
  stocked?: boolean;
};

/** Absent counts as kept in stock, so a company that never chose reads as before. */
export const isStocked = (it: { stocked?: boolean }) => it.stocked !== false;

/**
 * The name a line or an item is matched by: lower case, the size and
 * marketing noise dropped, spaces collapsed. "Starter strip · eaves + rakes"
 * and "starter strip (eaves & rakes)" are one item.
 */
export function stockKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[·•|/\\()[\]{}"'"”“’]+/g, " ")
    .replace(/\b(?:and|&|plus|with|the|a|an|of|for|per|new|matched|premium|standard|grade)\b/g, " ")
    .replace(/[^a-z0-9. ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type StockRow = StockItem & {
  reserved: number;
  available: number;
  forecast: number;
  short: number;
  /** The reorder point in force: the set one, else the biggest single job. */
  threshold: number;
  low: boolean;
  /** What to order now: enough for the reserved and forecast work plus the threshold. */
  suggestedOrder: number;
};

type Demand = { lines: readonly StockLine[] };

const r2 = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
const ceil = (n: number) => Math.ceil(Math.max(0, n) - 1e-9);

function needByKey(jobs: readonly Demand[]): { total: Map<string, number>; biggest: Map<string, number> } {
  const total = new Map<string, number>();
  const biggest = new Map<string, number>();
  for (const j of jobs) {
    const perJob = new Map<string, number>();
    for (const l of j.lines) {
      const k = stockKey(l.name);
      if (!k || !(l.quantity > 0)) continue;
      perJob.set(k, (perJob.get(k) ?? 0) + l.quantity);
    }
    for (const [k, q] of perJob) {
      total.set(k, (total.get(k) ?? 0) + q);
      biggest.set(k, Math.max(biggest.get(k) ?? 0, q));
    }
  }
  return { total, biggest };
}

/**
 * Every item with the work counted against it.
 *   sold: the proposals accepted whose jobs have not loaded their materials.
 *   open: the proposals still out (draft, sent, viewed).
 */
export function stockRows(items: readonly StockItem[], sold: readonly Demand[], open: readonly Demand[]): StockRow[] {
  const s = needByKey(sold);
  const o = needByKey(open);
  return items.map((it) => {
    const reserved = r2(s.total.get(it.key) ?? 0);
    const forecast = r2(o.total.get(it.key) ?? 0);
    const available = r2(it.onHand - reserved);
    // Bought per job: the shelf is not meant to hold it, so it is never low or
    // short and nothing is suggested for the shelf. What sold jobs still need
    // and open proposals would take stay readable — the per-job shopping list
    // (jobBuyList) is built from the same lines.
    if (!isStocked(it)) return { ...it, reserved, available, forecast, short: 0, threshold: 0, low: false, suggestedOrder: 0 };
    const threshold = it.reorderPoint ?? Math.max(s.biggest.get(it.key) ?? 0, o.biggest.get(it.key) ?? 0);
    const short = r2(Math.max(0, forecast - available));
    const low = available < threshold || available < 0;
    // Only an item that is low or short gets an order suggested: enough to
    // cover the sold and open work and still leave the threshold on the shelf.
    const suggestedOrder = low || short > 0 ? ceil(Math.max(0, reserved + forecast + threshold - it.onHand)) : 0;
    return { ...it, reserved, available, forecast, short, threshold: r2(threshold), low, suggestedOrder };
  });
}

/** The lines of a proposal the warehouse does not know: worth adding as items. */
export function untrackedLines(items: readonly StockItem[], lines: readonly StockLine[]): StockLine[] {
  const known = new Set(items.map((i) => i.key));
  const seen = new Set<string>();
  const out: StockLine[] = [];
  for (const l of lines) {
    const k = stockKey(l.name);
    if (!k || known.has(k) || seen.has(k) || !(l.quantity > 0)) continue;
    seen.add(k);
    out.push(l);
  }
  return out;
}

export type PickRow = {
  name: string;
  unit: string;
  quantity: number;
  itemId: string | null;
  onHand: number | null;
  enough: boolean;
  /** The item is bought for each job, not kept on the shelf: "ordered for this job", not "short". */
  perJob: boolean;
};

/**
 * What the crew takes from the warehouse for one job: every material line,
 * whole units, and whether the shelf has it. A line the warehouse does not
 * track still goes on the list — the crew still has to bring it.
 */
export function pickList(items: readonly StockItem[], lines: readonly StockLine[]): PickRow[] {
  const byKey = new Map(items.map((i) => [i.key, i]));
  const merged = new Map<string, PickRow>();
  for (const l of lines) {
    const k = stockKey(l.name);
    if (!k || !(l.quantity > 0)) continue;
    const it = byKey.get(k);
    const prev = merged.get(k);
    const quantity = ceil((prev?.quantity ?? 0) + l.quantity);
    merged.set(k, {
      name: it?.name ?? l.name,
      unit: it?.unit ?? l.unit ?? "each",
      quantity,
      itemId: it?.id ?? null,
      onHand: it ? r2(it.onHand) : null,
      enough: it ? it.onHand >= quantity : false,
      perJob: it ? !isStocked(it) : false,
    });
  }
  return [...merged.values()];
}

/**
 * What leaves the warehouse when the truck is loaded (actions/inventory
 * loadJobMaterials): each tracked line as far as the shelf has it — a per-job
 * item only what arrived for the job, a stocked item short on the shelf only
 * what is there (the rest is bought for the job). The count never goes below
 * zero. `short` counts the stocked lines the shelf could not cover.
 */
export function issueFromShelf(rows: readonly PickRow[]): { taken: Array<PickRow & { itemId: string; take: number }>; short: number } {
  const tracked = rows.filter((r): r is PickRow & { itemId: string } => !!r.itemId);
  const taken = tracked.map((r) => ({ ...r, take: Math.min(r.quantity, Math.max(0, r.onHand ?? 0)) })).filter((r) => r.take > 0);
  const short = tracked.filter((r) => !r.perJob && r.quantity > Math.max(0, r.onHand ?? 0)).length;
  return { taken, short };
}

/** The stock schedule's search: the item's name, its supplier or its SKU. */
export function stockMatches(r: Pick<StockItem, "name" | "supplierName" | "supplierSku">, needle: string): boolean {
  const n = needle.trim().toLowerCase();
  return !n || r.name.toLowerCase().includes(n) || (r.supplierName ?? "").toLowerCase().includes(n) || (r.supplierSku ?? "").toLowerCase().includes(n);
}

export type BuyLine = {
  itemId: string;
  key: string;
  name: string;
  unit: string;
  /** Whole units the job needs. */
  quantity: number;
  /** Covered by what is on hand already — an order that arrived — soonest job first. */
  have: number;
  toBuy: number;
  supplierId: string | null;
  supplierName: string | null;
  supplierSku: string | null;
};
export type BuyJob<J> = { job: J; lines: BuyLine[]; /** Lines with something still to buy. */ toBuy: number };
export type BuyJobIn = Demand & { startsAt?: string | null };

/**
 * The per-job shopping list (2026-09-23): for each sold job still to load,
 * the materials the company buys per job rather than keeps in stock — whole
 * units, merged by item, the item's own name. What is on hand already (an
 * order that arrived) is given to the soonest job first, so a line reads
 * "arrived" or "to buy". A job with no per-job material is left out.
 */
export function jobBuyList<J extends BuyJobIn>(items: readonly StockItem[], jobs: readonly J[]): BuyJob<J>[] {
  const perJob = new Map(items.filter((i) => !isStocked(i)).map((i) => [i.key, i]));
  if (!perJob.size) return [];
  const remaining = new Map<string, number>();
  for (const it of perJob.values()) remaining.set(it.key, Math.max(0, it.onHand));
  const when = (j: BuyJobIn) => (j.startsAt ? Date.parse(j.startsAt) || Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER);
  const out: BuyJob<J>[] = [];
  for (const job of [...jobs].sort((a, b) => when(a) - when(b))) {
    const need = new Map<string, number>();
    for (const l of job.lines) {
      const k = stockKey(l.name);
      if (!k || !(l.quantity > 0) || !perJob.has(k)) continue;
      need.set(k, (need.get(k) ?? 0) + l.quantity);
    }
    if (!need.size) continue;
    const lines: BuyLine[] = [];
    for (const [k, q] of need) {
      const it = perJob.get(k)!;
      const quantity = ceil(q);
      const have = r2(Math.min(quantity, Math.max(0, remaining.get(k) ?? 0)));
      remaining.set(k, (remaining.get(k) ?? 0) - have);
      lines.push({ itemId: it.id, key: k, name: it.name, unit: it.unit, quantity, have, toBuy: ceil(quantity - have), supplierId: it.supplierId, supplierName: it.supplierName ?? null, supplierSku: it.supplierSku ?? null });
    }
    lines.sort((a, b) => a.name.localeCompare(b.name));
    out.push({ job, lines, toBuy: lines.filter((l) => l.toBuy > 0).length });
  }
  return out;
}

export type PoLine = { name: string; sku: string | null; unit: string; quantity: number };

/** The purchase order's text — one supplier, the items short at that supplier. */
export function purchaseOrderText(input: { company: string; supplier: string; trade: string; lines: readonly PoLine[]; note?: string }): { subject: string; html: string } {
  const rows = input.lines
    .map((l) => `<tr><td style="padding:6px 10px;border-bottom:1px solid #e5e5e5">${esc(l.name)}${l.sku ? ` <span style="color:#666">(${esc(l.sku)})</span>` : ""}</td><td style="padding:6px 10px;border-bottom:1px solid #e5e5e5;text-align:right">${l.quantity} ${esc(l.unit)}</td></tr>`)
    .join("");
  return {
    subject: `Purchase order — ${input.company} — ${input.trade} materials`,
    html: `<p>Hello ${esc(input.supplier)},</p><p>Please supply the following for ${esc(input.company)}:</p><table style="border-collapse:collapse;font-family:sans-serif;font-size:14px">${rows}</table>${input.note ? `<p>${esc(input.note)}</p>` : ""}<p>Please confirm price and delivery by reply.</p><p>Thank you,<br>${esc(input.company)}</p>`,
  };
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}
