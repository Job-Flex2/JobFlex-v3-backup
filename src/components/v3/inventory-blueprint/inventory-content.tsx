"use client";

// INVENTORY — the page (owner, second pass, 2026-09-29), one trade per page
// since 2026-10-10: each estimator has its own inventory under it
// (lib/inventory INVENTORY_PATH) and the page carries no trade switch — a
// roofer never sees the fence or HVAC buttons.
//
// The hierarchy, top down: the head (a mono kicker naming the estimator and
// the trade's title, the primary action on the right — nothing under the
// title); one row with the secondary actions on the right; the main tabs in the Financials treatment (mono caps, a count
// chip, a 3px blueprint rule); then the tab — the PRICE BOOK the estimator
// prices from (a specification schedule), the STOCK (inventory-stock.tsx),
// and the HVAC SERVICE MENU when the trade is HVAC. Every write goes through
// the estimators' own actions (fenceCatalog, roofCatalog, hvacEstimator), so
// the estimators read what this page saved.

import { useCallback, useMemo, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { Download, Pencil, Plus, Upload, X } from "lucide-react";
import { toast } from "@/components/ui/Toast";
import { saveFenceCatalog } from "@/actions/fenceCatalog";
import { saveRoofCatalog } from "@/actions/roofCatalog";
import { clearHvacCatalog, importHvacCatalogCsv, loadUsCatalog, saveHvacCatalogItem, saveHvacRateCard } from "@/actions/hvacEstimator";
import { deleteHvacCatalogItem } from "@/actions/inventoryPage";
import { saveDeckRateBook } from "@/actions/deckEstimator";
import { HvacServicesContent } from "@/components/v3/hvac-services-blueprint/hvac-services-content";
import type { InventoryPageData, InventoryTab, PriceBookData } from "@/lib/inventoryPage";
import { inventoryHref, TRADES, type TradeId } from "@/lib/inventory";
import { CATALOG_CSV_COLUMNS, STARTER_CATALOG } from "@/lib/hvac/ledger";
import { FENCE_TYPES } from "@/lib/fence/catalog";
import { SERVICE_MENU } from "@/lib/hvac/serviceMenu";
import { DECK_RATE_GROUP_LABEL } from "@/lib/deck/rates";
import {
  FENCE_RATE_LIMITS, FENCE_TYPE_IDS, HVAC_KINDS, ROOF_FAMILY_OPTIONS,
  bookNumbers, fenceBookRows, fenceDocWith, fenceDocWithout, filterRows, groupRows, hvacBookRows, hvacCardWith, hvacRateRows,
  deckBookRows, deckBookWith, nextCustomFenceId, roofBookRows, roofDocWith, roofDocWithout, roofLists, rowKey, shownGroups, slugId, usd2,
  type BookRow,
} from "@/lib/priceBook";
import { InventoryStock } from "./inventory-stock";
import { cx, Empty, Filters, Sheet, useHandheld, useUrlParam } from "./inventory-shared";

const TAB_LABEL: Record<InventoryTab, string> = { book: "Price book", stock: "Stock", services: "Service menu" };
const GROUP_ORDER: Record<TradeId, string[]> = {
  fence: ["Wood", "Vinyl", "Composite", "Chain link", "Aluminum", "Steel", "Rail", "Your own"],
  roof: ["Asphalt shingle", "Metal", "Tile", "Wood shake", "Slate", "Synthetic", "Flat / low slope", "Underlayment"],
  hvac: [...HVAC_KINDS.map((k) => k.label), "Rate card · fees & markups", "Rate card · labor", "Rate card · materials"],
  deck: (["lumber", "decking", "hardware", "concrete", "roof", "trim", "gutters", "allowance", "electrical", "labor", "roofLabor"] as const).map((k) => DECK_RATE_GROUP_LABEL[k]),
};
const FENCE_COLORS = ["#c4914a", "#a86e2d", "#7c5a3a", "#d9d3c4", "#f0ede6", "#5f6b73", "#2f3a44", "#8a4b2f", "#3b6b3b", "#b9b0a2"];

export type InventoryContentProps = { data: InventoryPageData; canEditBook: boolean; canWriteStock: boolean };

const hrefFor = (trade: TradeId, tab: InventoryTab, hash = ""): Route => inventoryHref(trade, tab, hash) as Route;
/** The estimator a trade's inventory sits under, for the kicker. */
const ESTIMATOR_NAME: Record<TradeId, string> = { roof: "Roof estimator", fence: "Fence estimator", hvac: "HVAC estimator", deck: "Deck estimator" };

const numOr = (v: unknown, d = 0) => { const n = typeof v === "number" ? v : parseFloat(String(v ?? "")); return Number.isFinite(n) ? n : d; };
const dateOf = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "never");

export function InventoryContent({ data, canEditBook, canWriteStock }: InventoryContentProps) {
  const { trade, tab } = data;
  const tabs: InventoryTab[] = trade === "hvac" ? ["book", "stock", "services"] : ["book", "stock"];
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const rows = useMemo(() => bookRowsOf(data.book), [data.book]);
  // The stock tab fills the head's action and the toolbar's right side through these.
  const [primarySlot, setPrimarySlot] = useState<HTMLElement | null>(null);
  const [toolbarSlot, setToolbarSlot] = useState<HTMLElement | null>(null);
  const counts: Partial<Record<InventoryTab, number>> = { book: rows.filter((r) => r.kind !== "hvac-rate").length, stock: data.stock?.data.rows.length, services: trade === "hvac" ? SERVICE_MENU.length : undefined };
  const estimatorHref = `/dashboard/${trade}-estimator` as Route;

  return (
    <>
      <div className={cx("page-head")}>
        <div>
          <div className={cx("kicker")}>{ESTIMATOR_NAME[trade]} · Inventory</div>
          <h1 className={cx("page-title")}>{TRADES.find((t) => t.id === trade)?.label ?? ""} inventory</h1>
        </div>
        <div className={cx("page-actions")} ref={setPrimarySlot}>
          {tab === "book" && canEditBook && trade !== "deck" && (
            <button type="button" className={cx("btn", "btn-primary")} onClick={() => setSheet(newRowSheet(trade, data.book))}>
              <Plus className={cx("ic")} aria-hidden="true" />Add item
            </button>
          )}
        </div>
      </div>

      {/* One row (2026-10-10, the trade switch gone): the sections on the
          left — one joined segmented control, a mono counter after the label —
          and the secondary actions on the right. */}
      <div className={cx("head2")}>
      <div className={cx("toolbar")}>
        <nav className={cx("trade")} aria-label="Inventory sections">
          {tabs.map((t) => (
            <Link key={t} href={hrefFor(trade, t)} className={cx("trade-btn", t === tab && "on")} aria-current={t === tab ? "page" : undefined} id={t === "book" ? "book" : undefined}>
              {TAB_LABEL[t]}
              {counts[t] !== undefined && (t !== "stock" || counts[t]! > 0) && <b>{counts[t]}</b>}
            </Link>
          ))}
        </nav>
        <div className={cx("toolbar-acts")} ref={setToolbarSlot}>
          {tab === "book" && trade === "hvac" && canEditBook && <HvacCatalogActions book={data.book} />}
          {tab !== "stock" && <Link href={estimatorHref} className={cx("btn", "btn-ghost")}>Open the estimator</Link>}
        </div>
      </div>
      </div>

      {tab === "book" && <PriceBook data={data} rows={rows} canEdit={canEditBook} sheet={sheet} setSheet={setSheet} />}
      {tab === "stock" && (data.stock ? <InventoryStock key={trade} data={data.stock.data} facts={data.stock.facts} canWrite={canWriteStock} slots={{ primary: primarySlot, toolbar: toolbarSlot }} /> : <Empty text={`No ${trade} board yet`} />)}
      {tab === "services" && data.book.trade === "hvac" && <HvacServicesContent card={data.book.card} factor={data.book.factor} place={data.book.place} embedded />}
    </>
  );
}

function bookRowsOf(book: PriceBookData): BookRow[] {
  if (book.trade === "fence") return fenceBookRows(book.doc);
  if (book.trade === "roof") return roofBookRows(book.doc);
  if (book.trade === "deck") return deckBookRows(book.book);
  return [...hvacBookRows(book.items, book.own), ...hvacRateRows(book.card, book.defaults)];
}

/* ── the sheet's state: which row, or a new one ─────────────────────── */

type SheetState = { row: BookRow | null; kind: BookRow["kind"]; fields: Record<string, string | number | boolean | undefined>; isNew: boolean; title: string };

function newRowSheet(trade: TradeId, book: PriceBookData): SheetState {
  if (trade === "fence") {
    const doc = book.trade === "fence" ? book.doc : null;
    const like = FENCE_TYPES[0];
    return { row: null, kind: "fence-type", isNew: true, title: "New fence type", fields: { id: nextCustomFenceId(doc), label: "", like: like.id, materialPerLf: 30, laborPerLf: 15, gateSingle: 450, color: FENCE_COLORS[0] } };
  }
  if (trade === "roof") return { row: null, kind: "roof-system", isNew: true, title: "New roof system", fields: { label: "", family: "asphalt", matPerSq: 150, laborPerSq: 200, wastePct: 12, capPerFt: 2.5, what: "system" } };
  if (trade === "deck") return { row: null, kind: "deck-rate", isNew: true, title: "Deck prices", fields: {} };
  return { row: null, kind: "hvac-unit", isNew: true, title: "New unit", fields: { kind: "heat-pump", brand: "", model: "", tons: 3, seer2: 16, cost: 0 } };
}

/* ── THE PRICE BOOK ─────────────────────────────────────────────────── */

function PriceBook({ data, rows, canEdit, sheet, setSheet }: { data: InventoryPageData; rows: BookRow[]; canEdit: boolean; sheet: SheetState | null; setSheet: (s: SheetState | null) => void }) {
  const { trade, book } = data;
  const handheld = useHandheld();
  const [q, setQ] = useState("");
  // The group filter lives in the URL (?group=): it survives a reload, and the trade links carry none, so a trade switch resets it.
  const [group, setGroup] = useUrlParam("group");
  const [open, setOpen] = useState<string | null>(null);
  const shown = useMemo(() => filterRows(rows, q), [rows, q]);
  // The search and the filter together; the strip's counters count the search's rows per group.
  const groups = useMemo(() => shownGroups(rows, GROUP_ORDER[trade], q, group), [rows, trade, q, group]);
  const searchGroups = useMemo(() => groupRows(shown, GROUP_ORDER[trade]), [shown, trade]);
  const allGroups = useMemo(() => groupRows(rows, GROUP_ORDER[trade]), [rows, trade]);
  // The schedule's running number, over the whole book: a row keeps its number under a search or a filter.
  const numbers = useMemo(() => bookNumbers(rows, GROUP_ORDER[trade]), [rows, trade]);
  const defaults = rows.filter((r) => r.companyDefault).length;
  const catalogRows = rows.filter((r) => r.kind !== "hvac-rate").length;
  const standing = book.trade === "hvac" ? (book.own ? "Yours" : "Starter") : book.trade === "deck" ? (Object.keys(book.book).length ? "Yours" : "Examples") : book.doc ? "Yours" : "Catalog";

  const openRow = useCallback((r: BookRow) => {
    if (!canEdit) return;
    setSheet({ row: r, kind: r.kind, isNew: false, title: r.name, fields: { ...r.fields, id: r.id } });
  }, [canEdit, setSheet]);

  return (
    <section aria-label={`${trade} price book`} id="catalog">
      <div className={cx("kpi-grid")} data-book-kpis>
        <div className={cx("kpi")}><div className={cx("kpi-val")}>{catalogRows}</div><div className={cx("kpi-lbl")}>items</div></div>
        <div className={cx("kpi")}><div className={cx("kpi-val", defaults > 0 && "accent")}>{defaults}</div><div className={cx("kpi-lbl")}>company defaults</div></div>
        <div className={cx("kpi")}><div className={cx("kpi-val")}>{standing}</div><div className={cx("kpi-lbl")}>{book.trade === "hvac" ? "unit catalog" : "the book in force"}</div></div>
        <div className={cx("kpi")}><div className={cx("kpi-val")}>{dateOf(book.updatedAt)}</div><div className={cx("kpi-lbl")}>last saved</div></div>
      </div>

      <section className={cx("card")} aria-label="Schedule">
        <div className={cx("card-head")}>
          <div><div className={cx("card-title")}>Price schedule</div></div>
        </div>
        <div className={cx("tools")}>
          <label className="search"><svg className="ic" aria-hidden="true"><use href="#i-search" /></svg><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find an item" aria-label="Find an item" />{q && <button type="button" className={cx("link")} onClick={() => setQ("")} aria-label="Clear search"><X size={14} /></button>}</label>
          <Filters label="Group" value={group} items={[{ id: "", label: "All", n: shown.length }, ...allGroups.map((g) => ({ id: g.label, label: g.label, n: searchGroups.find((x) => x.label === g.label)?.rows.length ?? 0 }))]} onChange={setGroup} />
        </div>

        {groups.length === 0 ? (
          rows.length === 0
            ? <Empty text="Nothing in this book yet" action={canEdit && <button type="button" className={cx("btn", "btn-primary")} onClick={() => setSheet(newRowSheet(trade, book))}>Add item</button>} />
            : <Empty text="Nothing matches" action={<button type="button" className={cx("btn", "btn-ghost")} onClick={() => { setQ(""); setGroup(""); }}>Show all</button>} />
        ) : handheld ? (
          <div role="list">
            {groups.map((g) => (
              <div key={g.label}>
                <div className={cx("grp-h")} id={`grp-${slugId(g.label, [])}`}><div className="pgrp"><span className="pgrp-name">{g.label}</span><span className="pgrp-meta">{g.rows.length} items</span></div></div>
                {g.rows.map((r) => {
                  const key = `${r.kind}:${r.id}`;
                  const isOpen = open === key;
                  return (
                    <div key={key} role="listitem"><div className={cx("rowi")} role="button" tabIndex={0} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : key)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(isOpen ? null : key); } }}>
                      <div className={cx("l1")}>{r.color && <span style={{ display: "inline-block", width: 12, height: 12, background: r.color, border: "1px solid var(--ink)" }} aria-hidden="true" />}<span className={cx("t")}>{r.name}</span><span className={cx("p")}>{r.price === null ? "—" : usd2(r.price)}</span></div>
                      <div className={cx("l2")}><span>{r.specs}</span><span>/ {r.unit}</span>{r.companyDefault && <span className={cx("pstatus", "pstatus--accepted")}>Default</span>}</div>
                      {isOpen && (
                        <div className={cx("more")}>
                          {r.labor !== null && <div className={cx("kv")}><span>Labor</span><b>{usd2(r.labor)} / {r.unit}</b></div>}
                          <div className={cx("kv")}><span>Group</span><b>{r.group}</b></div>
                          {canEdit && <div className={cx("acts2")}><button type="button" className={cx("btn", "btn-primary")} onClick={(e) => { e.stopPropagation(); openRow(r); }}>Edit</button></div>}
                        </div>
                      )}
                    </div></div>
                  );
                })}
              </div>
            ))}
          </div>
        ) : (
          <div className={cx("tbl-wrap")}>
            <table className="ptable">
              <thead>
                <tr>
                  <th scope="col" className={cx("no")}>No.</th><th scope="col">Item</th><th scope="col">Specification</th><th scope="col">Unit</th>
                  <th scope="col" className="num">{trade === "hvac" ? "Shop cost" : "Material"}</th>
                  {trade !== "hvac" && <th scope="col" className="num">Labor</th>}
                  <th scope="col" className="c">Standing</th>
                  {canEdit && <th scope="col" className="th-open"><span style={{ position: "absolute", left: -9999 }}>Actions</span></th>}
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <GroupRows key={g.label} label={g.label} count={g.rows.length} cols={canEdit ? (trade === "hvac" ? 7 : 8) : trade === "hvac" ? 6 : 7}>
                    {g.rows.map((r) => {
                      const n = numbers.get(rowKey(r)) ?? 0;
                      return (
                        <tr key={`${r.kind}:${r.id}`} className="prow" onClick={() => openRow(r)} tabIndex={canEdit ? 0 : undefined} onKeyDown={(e) => { if (e.key === "Enter") openRow(r); }}>
                          <td className={cx("pt-mono", "no")}>{String(n).padStart(2, "0")}</td>
                          <td className="pt-title">{r.color && <span className={cx("sw")} style={{ background: r.color }} aria-hidden="true" />}{r.name}</td>
                          <td className="pt-mono">{r.specs}</td>
                          <td className="pt-mono">{r.unit}</td>
                          <td className="num"><span className="pt-money">{r.price === null ? "—" : usd2(r.price)}</span></td>
                          {trade !== "hvac" && <td className="num"><span className="pt-money">{r.labor === null ? "—" : usd2(r.labor)}</span></td>}
                          <td className="c">{r.companyDefault ? <span className="pstatus pstatus--accepted">Company</span> : <span className="pstatus">{r.kind === "hvac-rate" ? "typical" : "catalog"}</span>}</td>
                          {canEdit && <td className="num"><button type="button" className="pt-open" onClick={(e) => { e.stopPropagation(); openRow(r); }} aria-label={`Edit ${r.name}`} title="Edit"><Pencil className="ic" aria-hidden="true" /></button></td>}
                        </tr>
                      );
                    })}
                  </GroupRows>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <BookSettings book={book} canEdit={canEdit} />

      {sheet && <EditSheet state={sheet} book={book} rows={rows} onClose={() => setSheet(null)} />}
    </section>
  );
}

function GroupRows({ label, count, cols, children }: { label: string; count: number; cols: number; children: ReactNode }) {
  return <>
    <tr className="prow-grp" id={`grp-${slugId(label, [])}`}><td colSpan={cols}><div className="pgrp"><span className="pgrp-name">{label}</span><span className="pgrp-meta">{count} items</span></div></td></tr>
    {children}
  </>;
}

/* Under the schedule: the figures that are not a row — removal and waste (fence), nothing (roof, hvac). */
function BookSettings({ book, canEdit }: { book: PriceBookData; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (book.trade !== "fence") return null;
  const doc = book.doc;
  const save = (patch: { removalPerLf?: number; wastePct?: number }) => start(async () => {
    const next = { ...(doc ?? { version: 1 as const, rates: {}, custom: [] }), ...patch };
    const r = await saveFenceCatalog(next);
    if (!r.ok) { toast.error("Couldn't save", r.error); return; }
    toast.success("Saved to the company", "Every fence estimate on this account prices from it.");
    router.refresh();
  });
  return (
    <section className={cx("card")} id="settings" aria-label="Book settings">
      <div className={cx("card-head")}><div><div className={cx("card-title")}>Book settings</div><div className={cx("card-sub")}>The studio reads them on every estimate.</div></div></div>
      <div className={cx("card-body")}>
        <div className={cx("fields")}>
          <label className={cx("fld")}><span className={cx("lbl")}>Removal of the old fence</span><span><MoneyInput value={doc?.removalPerLf ?? 6} disabled={!canEdit || pending} onCommit={(v) => save({ removalPerLf: v })} label="Removal per linear foot" /> <span className="pt-mono">per lf</span></span></label>
          <label className={cx("fld")}><span className={cx("lbl")}>Waste on materials</span><span><MoneyInput value={doc?.wastePct ?? 10} disabled={!canEdit || pending} onCommit={(v) => save({ wastePct: v })} label="Waste percent" sign="%" /></span></label>
        </div>
      </div>
    </section>
  );
}

function MoneyInput({ value, onCommit, disabled, label, sign = "$" }: { value: number; onCommit: (v: number) => void; disabled?: boolean; label: string; sign?: string }) {
  const [text, setText] = useState(String(value));
  return (
    <span className={cx("money")}>
      <span className={cx("money-sign")}>{sign}</span>
      <input className={cx("in-money")} inputMode="decimal" value={text} aria-label={label} disabled={disabled} onChange={(e) => setText(e.target.value)} onBlur={() => { const n = parseFloat(text); if (Number.isFinite(n) && n !== value) onCommit(n); else setText(String(value)); }} onKeyDown={(e) => { if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur(); }} />
    </span>
  );
}

/* ── HVAC catalog actions: the US list, a CSV in, a CSV out, clear ── */

function HvacCatalogActions({ book }: { book: PriceBookData }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (book.trade !== "hvac") return null;
  const own = book.own;
  const loadUs = () => start(async () => {
    const r = await loadUsCatalog({ replace: false });
    if (!r.ok) { toast.error("Couldn't load", r.error); return; }
    toast.success(`US catalog loaded · ${r.imported} rows`, "Put your shop costs on the rows you sell.");
    router.refresh();
  });
  const onCsv = (file: File | undefined) => {
    if (!file) return;
    start(async () => {
      const csv = await file.text();
      const r = await importHvacCatalogCsv({ csv, replace: false });
      if (!r.ok) { toast.error("Import refused", r.error); return; }
      toast.success(`Imported ${r.imported} rows`, r.errors.length ? `${r.errors.length} rows skipped` : r.note);
      router.refresh();
    });
  };
  const download = () => {
    const esc = (v: unknown) => (v === undefined || v === null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const rows = book.items.map((c) => CATALOG_CSV_COLUMNS.map((k) => esc(k === "afue" && c.afue ? Math.round(c.afue * 1000) / 10 : (c as unknown as Record<string, unknown>)[k])).join(","));
    const blob = new Blob([[CATALOG_CSV_COLUMNS.join(","), ...rows].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `hvac-catalog-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const clear = () => start(async () => {
    if (!window.confirm("Remove every row of your HVAC catalog? The estimator goes back to the starter ladder.")) return;
    const r = await clearHvacCatalog();
    if (!r.ok) { toast.error("Couldn't clear", r.error); return; }
    toast.success("Catalog cleared");
    router.refresh();
  });
  return (
    <>
      <label className={cx("btn", "btn-ghost")} htmlFor="inv-csv"><Upload className={cx("ic")} aria-hidden="true" />Import catalog<input id="inv-csv" type="file" accept=".csv,text/csv" style={{ display: "none" }} disabled={pending} onChange={(e) => onCsv(e.target.files?.[0])} /></label>
      <button type="button" className={cx("btn", "btn-ghost")} onClick={loadUs} disabled={pending}>{pending ? "Working…" : own ? "Update US catalog" : "Load US catalog"}</button>
      <button type="button" className={cx("btn", "btn-ghost")} onClick={download} title="Every row as CSV — edit the cost column and import it back"><Download className={cx("ic")} aria-hidden="true" />CSV</button>
      {own && <button type="button" className={cx("btn", "btn-ghost")} onClick={clear} disabled={pending}>Clear</button>}
    </>
  );
}

/* ── THE EDIT SHEET ─────────────────────────────────────────────────── */

function EditSheet({ state, book, rows, onClose }: { state: SheetState; book: PriceBookData; rows: BookRow[]; onClose: () => void }) {
  const router = useRouter();
  const [f, setF] = useState(state.fields);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string, v: string | number | boolean | undefined) => setF((p) => ({ ...p, [k]: v }));
  const str = (k: string) => String(f[k] ?? "");
  const num = (k: string) => numOr(f[k]);
  const done = (title: string, sub?: string) => { toast.success(title, sub); router.refresh(); onClose(); };
  const fail = (r: { ok: false; error: string }) => setErr(r.error);

  const save = () => start(async () => {
    setErr(null);
    if (state.kind === "fence-type" && book.trade === "fence") {
      const id = str("id");
      const isCustom = !(FENCE_TYPE_IDS as string[]).includes(id);
      if (isCustom && !str("label").trim()) return setErr("Give the type a name.");
      const lim = FENCE_RATE_LIMITS;
      const m = num("materialPerLf"), l = num("laborPerLf"), g = num("gateSingle");
      if (m < lim.materialPerLf.min || m > lim.materialPerLf.max) return setErr(`Material must be $${lim.materialPerLf.min}–$${lim.materialPerLf.max} per lf.`);
      if (l < lim.laborPerLf.min || l > lim.laborPerLf.max) return setErr(`Labor must be $${lim.laborPerLf.min}–$${lim.laborPerLf.max} per lf.`);
      if (g < lim.gateSingle.min || g > lim.gateSingle.max) return setErr(`A walk gate must be $${lim.gateSingle.min}–$${lim.gateSingle.max}.`);
      const doc = fenceDocWith(book.doc, { id, label: str("label"), like: str("like"), materialPerLf: m, laborPerLf: l, gateSingle: g, color: str("color") || undefined });
      const r = await saveFenceCatalog(doc);
      return r.ok ? done("Saved to the company", "Every fence estimate prices from it.") : fail(r);
    }
    if ((state.kind === "roof-system" || state.kind === "roof-underlayment") && book.trade === "roof") {
      const what = state.isNew ? str("what") : state.kind === "roof-system" ? "system" : "underlayment";
      if (!str("label").trim()) return setErr("Give it a name.");
      const lists = roofLists(book.doc);
      if (what === "system") {
        const id = state.isNew ? slugId(str("label"), lists.systems.map((s) => s.id)) : str("id");
        const doc = roofDocWith(book.doc, { system: { id, label: str("label").trim(), family: (str("family") || "asphalt") as never, matPerSq: num("matPerSq"), laborPerSq: num("laborPerSq"), wastePct: num("wastePct"), capPerFt: num("capPerFt") } });
        const r = await saveRoofCatalog(doc);
        return r.ok ? done("Saved to the company", "Every roof estimate lists it.") : fail(r);
      }
      const id = state.isNew ? slugId(str("label"), lists.underlayments.map((u) => u.id)) : str("id");
      const doc = roofDocWith(book.doc, { underlayment: { id, label: str("label").trim(), perSq: num("perSq") } });
      const r = await saveRoofCatalog(doc);
      return r.ok ? done("Saved to the company") : fail(r);
    }
    if (state.kind === "hvac-unit" && book.trade === "hvac") {
      if (!str("brand").trim() || !str("model").trim()) return setErr("Brand and model at least.");
      const id = state.isNew ? slugId(`${str("kind")}-${str("brand")}-${str("model")}`, rows.map((r) => r.id)) : str("id");
      const item = { id, kind: str("kind"), brand: str("brand").trim(), model: str("model").trim(), tons: f.tons === "" || f.tons === undefined ? undefined : num("tons"), seer2: f.seer2 ? num("seer2") : undefined, hspf2: f.hspf2 ? num("hspf2") : undefined, afue: f.afue ? num("afue") : undefined, btuInput: f.btuInput ? num("btuInput") : undefined, refrigerant: str("refrigerant") || undefined, staging: str("staging") || undefined, cost: f.cost === "" || f.cost === undefined ? undefined : num("cost"), source: "shop" as const };
      // A shop that has not made the catalog its own edits one row of the
      // starter ladder: the ladder comes along, so the engine keeps its choices.
      if (!book.own) {
        for (const s of STARTER_CATALOG) {
          if (s.id === id) continue;
          const r0 = await saveHvacCatalogItem({ ...s, typed: undefined });
          if (!r0.ok) return fail(r0);
        }
      }
      const r = await saveHvacCatalogItem(item);
      return r.ok ? done("Saved to the catalog", "The estimator picks from it and prices at your cost.") : fail(r);
    }
    if (state.kind === "hvac-rate" && book.trade === "hvac") {
      const r = await saveHvacRateCard(hvacCardWith(book.card, str("id"), num("value")));
      return r.ok ? done("Rate card saved") : fail(r);
    }
    if (state.kind === "deck-rate" && book.trade === "deck") {
      if (state.isNew) return onClose();
      const v = num("value");
      const min = num("min");
      const max = num("max");
      if (!(v >= min && v <= max)) return setErr(`Keep it between $${min} and $${max}.`);
      const r = await saveDeckRateBook(deckBookWith(book.book, str("id"), v));
      return r.ok ? done("Saved to the company", "Every deck prices from it from now on.") : fail(r);
    }
  });

  const remove = () => start(async () => {
    setErr(null);
    if (!state.row) return;
    if (state.kind === "fence-type" && book.trade === "fence") {
      const r = await saveFenceCatalog(fenceDocWithout(book.doc, state.row.id));
      return r.ok ? done(state.row.custom ? "Type removed" : "Back to the catalog rate") : fail(r);
    }
    if ((state.kind === "roof-system" || state.kind === "roof-underlayment") && book.trade === "roof") {
      const r = await saveRoofCatalog(roofDocWithout(book.doc, state.kind, state.row.id));
      return r.ok ? done(state.row.custom ? "Removed" : "Back to the catalog figures") : fail(r);
    }
    if (state.kind === "hvac-unit" && book.trade === "hvac") {
      if (!book.own) return setErr("The starter ladder cannot be edited row by row — load the US catalog or import yours first.");
      const r = await deleteHvacCatalogItem(state.row.id);
      return r.ok ? done("Row removed") : fail(r);
    }
    if (state.kind === "hvac-rate" && book.trade === "hvac") {
      const def = state.fields.section === "top" ? (book.defaults as unknown as Record<string, number>)[str("id")] : (book.defaults[state.fields.section as "labor" | "materials"] as Record<string, number>)[str("id").split(".")[1]];
      const r = await saveHvacRateCard(hvacCardWith(book.card, str("id"), def));
      return r.ok ? done("Back to the typical figure") : fail(r);
    }
    if (state.kind === "deck-rate" && book.trade === "deck") {
      const r = await saveDeckRateBook(deckBookWith(book.book, str("id"), null));
      return r.ok ? done("Back to the example price") : fail(r);
    }
  });

  const kicker = state.kind === "deck-rate" ? "Deck price book" : state.kind === "hvac-rate" ? "Rate card" : state.kind === "hvac-unit" ? "Catalog unit" : state.kind === "roof-underlayment" ? "Underlayment" : state.kind === "roof-system" ? "Roof system" : "Fence type";
  const removeLabel = state.row ? (state.row.custom ? "Delete" : state.row.companyDefault ? "Reset to catalog" : null) : null;

  return (
    <Sheet kicker={kicker} title={state.title} onClose={onClose} footer={
      <>
        {removeLabel && <button type="button" className={cx("btn", "btn-danger")} onClick={remove} disabled={pending}>{removeLabel}</button>}
        <div className={cx("r")}>
          <button type="button" className={cx("btn", "btn-ghost")} onClick={onClose} disabled={pending}>Cancel</button>
          <button type="button" className={cx("btn", "btn-primary")} onClick={save} disabled={pending}>{pending ? "Saving…" : "Save to company"}</button>
        </div>
      </>
    }>
      {err && <div className={cx("note", "note-err")} role="alert">{err}</div>}
      {state.kind === "fence-type" && <FenceFields f={f} set={set} isCustom={!(FENCE_TYPE_IDS as string[]).includes(str("id"))} />}
      {(state.kind === "roof-system" || state.kind === "roof-underlayment") && <RoofFields f={f} set={set} isNew={state.isNew} kind={state.kind} />}
      {state.kind === "hvac-unit" && <HvacUnitFields f={f} set={set} />}
      {state.kind === "hvac-rate" && (
        <div className={cx("fld")}><span className={cx("lbl")}>{state.title}</span><input className={cx("in", "in-mono")} inputMode="decimal" value={str("value")} onChange={(e) => set("value", e.target.value)} aria-label={state.title} /><span className={cx("hint")}>{String(state.row?.specs ?? "")}</span></div>
      )}
      {state.kind === "deck-rate" && (state.isNew ? (
        <div className={cx("note")}>The deck estimator prices every job from this book: lumber by the foot, boards, connectors, concrete, roofing, gutters, rails, stairs, the electrical, and the crew&apos;s work by the measure. Every figure here is an example until you type your own — click any row to set it. The same book is under &quot;Your prices&quot; in the estimator.</div>
      ) : (
        <div className={cx("fld")}><span className={cx("lbl")}>{state.title}</span><input className={cx("in", "in-mono")} inputMode="decimal" value={str("value")} onChange={(e) => set("value", e.target.value)} aria-label={state.title} /><span className={cx("hint")}>{String(state.row?.specs ?? "")} · per {String(state.row?.unit ?? "")} · ${str("min")}–${str("max")}</span></div>
      ))}
    </Sheet>
  );
}

type FieldsProps = { f: Record<string, string | number | boolean | undefined>; set: (k: string, v: string | number | boolean | undefined) => void };
const s = (v: unknown) => (v === undefined || v === null ? "" : String(v));

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className={cx("fld")}><span className={cx("lbl")}>{label}</span>{children}{hint && <span className={cx("hint")}>{hint}</span>}</label>;
}

function FenceFields({ f, set, isCustom }: FieldsProps & { isCustom: boolean }) {
  return (
    <>
      {isCustom && <Field label="Name"><input className={cx("in")} value={s(f.label)} onChange={(e) => set("label", e.target.value)} placeholder="e.g. Cedar privacy · 8' premium" /></Field>}
      {isCustom && (
        <Field label="Built like" hint="The catalog type its takeoff follows — posts, rails, pickets, heights.">
          <select className={cx("sel-w")} value={s(f.like)} onChange={(e) => set("like", e.target.value)}>{FENCE_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
        </Field>
      )}
      <div className={cx("three")}>
        <Field label="Material" hint={f.standardMaterial !== undefined ? `catalog $${s(f.standardMaterial)} / lf` : "$ per lf"}><input className={cx("in", "in-mono")} inputMode="decimal" value={s(f.materialPerLf)} onChange={(e) => set("materialPerLf", e.target.value)} /></Field>
        <Field label="Labor" hint={f.standardLabor !== undefined ? `catalog $${s(f.standardLabor)} / lf` : "$ per lf"}><input className={cx("in", "in-mono")} inputMode="decimal" value={s(f.laborPerLf)} onChange={(e) => set("laborPerLf", e.target.value)} /></Field>
        <Field label="Walk gate" hint={f.standardGate !== undefined ? `catalog $${s(f.standardGate)}` : "$ installed, 4'"}><input className={cx("in", "in-mono")} inputMode="decimal" value={s(f.gateSingle)} onChange={(e) => set("gateSingle", e.target.value)} /></Field>
      </div>
      {isCustom && (
        <div className={cx("fld")}><span className={cx("lbl")}>Swatch</span><div className={cx("sw-row")}>{FENCE_COLORS.map((c) => <button key={c} type="button" className={cx("sw-b")} style={{ background: c }} aria-label={`Color ${c}`} aria-pressed={s(f.color) === c} onClick={() => set("color", c)} />)}</div></div>
      )}
    </>
  );
}

function RoofFields({ f, set, isNew, kind }: FieldsProps & { isNew: boolean; kind: "roof-system" | "roof-underlayment" }) {
  const what = isNew ? s(f.what) || "system" : kind === "roof-system" ? "system" : "underlayment";
  return (
    <>
      {isNew && (
        <Field label="What">
          <select className={cx("sel-w")} value={what} onChange={(e) => set("what", e.target.value)}><option value="system">Roof system (covering)</option><option value="underlayment">Underlayment</option></select>
        </Field>
      )}
      <Field label="Name"><input className={cx("in")} value={s(f.label)} onChange={(e) => set("label", e.target.value)} placeholder={what === "system" ? "e.g. Architectural shingle · 50-yr" : "e.g. Synthetic underlayment"} /></Field>
      {what === "system" ? (
        <>
          <Field label="Family"><select className={cx("sel-w")} value={s(f.family) || "asphalt"} onChange={(e) => set("family", e.target.value)}>{ROOF_FAMILY_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></Field>
          <div className={cx("two")}>
            <Field label="Material" hint="$ per square"><input className={cx("in", "in-mono")} inputMode="decimal" value={s(f.matPerSq)} onChange={(e) => set("matPerSq", e.target.value)} /></Field>
            <Field label="Install labor" hint="$ per square"><input className={cx("in", "in-mono")} inputMode="decimal" value={s(f.laborPerSq)} onChange={(e) => set("laborPerSq", e.target.value)} /></Field>
            <Field label="Waste" hint="percent"><input className={cx("in", "in-mono")} inputMode="decimal" value={s(f.wastePct)} onChange={(e) => set("wastePct", e.target.value)} /></Field>
            <Field label="Hip & ridge cap" hint="$ per ft"><input className={cx("in", "in-mono")} inputMode="decimal" value={s(f.capPerFt)} onChange={(e) => set("capPerFt", e.target.value)} /></Field>
          </div>
        </>
      ) : (
        <Field label="Price" hint="$ per square"><input className={cx("in", "in-mono")} inputMode="decimal" value={s(f.perSq)} onChange={(e) => set("perSq", e.target.value)} /></Field>
      )}
    </>
  );
}

function HvacUnitFields({ f, set }: FieldsProps) {
  return (
    <>
      <Field label="Kind"><select className={cx("sel-w")} value={s(f.kind)} onChange={(e) => set("kind", e.target.value)}>{HVAC_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</select></Field>
      <div className={cx("two")}>
        <Field label="Brand"><input className={cx("in")} value={s(f.brand)} onChange={(e) => set("brand", e.target.value)} /></Field>
        <Field label="Model"><input className={cx("in")} value={s(f.model)} onChange={(e) => set("model", e.target.value)} /></Field>
      </div>
      <div className={cx("three")}>
        <Field label="Tons"><input className={cx("in", "in-mono")} inputMode="decimal" value={s(f.tons)} onChange={(e) => set("tons", e.target.value)} /></Field>
        <Field label="SEER2"><input className={cx("in", "in-mono")} inputMode="decimal" value={s(f.seer2)} onChange={(e) => set("seer2", e.target.value)} /></Field>
        <Field label="HSPF2"><input className={cx("in", "in-mono")} inputMode="decimal" value={s(f.hspf2)} onChange={(e) => set("hspf2", e.target.value)} /></Field>
        <Field label="AFUE" hint="0.96 for 96%"><input className={cx("in", "in-mono")} inputMode="decimal" value={s(f.afue)} onChange={(e) => set("afue", e.target.value)} /></Field>
        <Field label="Input BTU"><input className={cx("in", "in-mono")} inputMode="numeric" value={s(f.btuInput)} onChange={(e) => set("btuInput", e.target.value)} /></Field>
        <Field label="Refrigerant"><select className={cx("sel-w")} value={s(f.refrigerant)} onChange={(e) => set("refrigerant", e.target.value)}><option value="">—</option>{["R-410A", "R-454B", "R-32", "R-22", "other"].map((r) => <option key={r} value={r}>{r}</option>)}</select></Field>
      </div>
      <div className={cx("two")}>
        <Field label="Staging"><select className={cx("sel-w")} value={s(f.staging)} onChange={(e) => set("staging", e.target.value)}><option value="">—</option><option value="single">single</option><option value="two-stage">two-stage</option><option value="variable">variable</option></select></Field>
        <Field label="Shop cost" hint="$ each — what you pay; the ledger prices from it"><input className={cx("in", "in-mono")} inputMode="decimal" value={s(f.cost)} onChange={(e) => set("cost", e.target.value)} /></Field>
      </div>
    </>
  );
}
