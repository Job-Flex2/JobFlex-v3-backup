// THE MATERIALS FROM THE PLANS (owner, 2026-10-21: "also make an option to calculate any materials needed — for
// drywall, deck, roof, any — make it smart, wow"). The build list (lib/plans/assemblies) already buys the house: every
// material in the unit it is sold in, waste in it — drywall in 4×12 sheets with its mud, tape, bead and screws,
// shingles in bundles with the underlayment rolls, starter, cap, drip edge and nails, lumber by the piece, concrete by
// the yard. This lays out the part asked for (a trade, several, a job the contractor typed, or the whole house) as a
// list a supplier quotes from: the materials trade by trade, each with how it was figured and its sheet, and above
// them the measurements they rest on — which the contractor can correct (computeTakeoff takes the edit and every
// material that follows from it moves) — plus extra on top for the job's own losses. A deck comes from the Deck
// Studio's frame (lib/plans/deckMaterials). Pure.
import type { FoundRow } from "./ask";
import type { DeckMaterials } from "./deckSpec";
import type { MeasureReport, MeasureRow, MeasureSection } from "./measureReport";
import { PLAN_TRADES, TRADE_LABEL, type PlanTrade, type Takeoff, type TakeoffItem } from "./takeoff";

/** One tap: a part of the house's materials. `trades: "deck"` — the Deck Studio's list. */
export type MaterialTopic = { key: string; label: string; trades: PlanTrade[] | "deck" };
export const MATERIAL_TOPICS: MaterialTopic[] = [
  { key: "all", label: "The whole house", trades: [...PLAN_TRADES] },
  { key: "drywall", label: "Drywall", trades: ["drywall"] },
  { key: "roofing", label: "Roofing & gutters", trades: ["roofing", "gutters"] },
  { key: "framing", label: "Framing lumber", trades: ["framing"] },
  { key: "deck", label: "Deck", trades: "deck" },
  { key: "concrete", label: "Concrete & foundation", trades: ["foundation", "sitework"] },
  { key: "siding", label: "Siding & exterior trim", trades: ["siding"] },
  { key: "insulation", label: "Insulation", trades: ["insulation"] },
  { key: "paint", label: "Paint", trades: ["painting"] },
  { key: "flooring", label: "Flooring", trades: ["flooring"] },
  { key: "tile", label: "Tile", trades: ["tile"] },
  { key: "trim", label: "Interior doors & trim", trades: ["interior-trim"] },
  { key: "windows", label: "Windows & doors", trades: ["windows-doors"] },
  { key: "cabinets", label: "Cabinets & counters", trades: ["cabinets"] },
  { key: "plumbing", label: "Plumbing", trades: ["plumbing"] },
  { key: "electrical", label: "Electrical", trades: ["electrical"] },
  { key: "hvac", label: "Heating & cooling", trades: ["hvac"] },
];

/** What is wanted: the trades (all their materials), or a typed job's own lines. */
export type MaterialsJob = {
  title: string;
  request: string | null;
  trades: PlanTrade[];
  /** A typed job's lines (its work and materials as the planner chose them); null — every line of the trades. */
  itemIds: string[] | null;
  /** What was measured on the sheets for the typed job. */
  asked: FoundRow[];
};

export type MaterialLine = { id: string; trade: PlanTrade; label: string; qty: number; unit: string; basis: string; pages: number[]; source: MeasureRow["source"]; phase: string | null };
/** A measurement the materials rest on — the contractor may correct it. */
export type MaterialMeasure = { id: string; trade: PlanTrade; label: string; qty: number; unit: string; basis: string; pages: number[]; source: MeasureRow["source"]; edited: boolean };

export type MaterialsReport = {
  title: string;
  request: string | null;
  extraPct: number;
  measures: MaterialMeasure[];
  groups: Array<{ trade: PlanTrade; title: string; lines: MaterialLine[] }>;
  deck: DeckMaterials | null;
  /** Lines to order in all. */
  count: number;
  asked: MeasureRow[];
};

/** Units bought whole: a share of a sheet is a sheet. */
const WHOLE = new Set(["sheets", "bundles", "rolls", "boxes", "bags", "pieces", "buckets", "tubes", "each", "sets", "gallons", "squares", "pcs", "ea"]);

/** A quantity with `pct` more on top. Whole units gain a piece only when the extra comes to half a piece or more —
 *  10% on one beam is not a second beam; 5% on 396 sheets is 20 more. */
export function withExtra(qty: number, unit: string, pct: number): number {
  if (!pct) return qty;
  const v = qty * (1 + pct / 100);
  return WHOLE.has(unit) ? Math.max(qty, Math.round(v)) : Math.round(v * 10) / 10;
}

const isMaterial = (i: TakeoffItem) => i.role === "material" || i.role === "both" || !i.role;
const sourceOf = (i: TakeoffItem): MeasureRow["source"] => (i.measured ? "measured" : i.source);

export function materialsReport(t: Takeoff, job: MaterialsJob, extraPct = 0, deck: DeckMaterials | null = null, edits: Record<string, number> = {}): MaterialsReport {
  const ids = job.itemIds ? new Set(job.itemIds) : null;
  const wanted = (i: TakeoffItem) => job.trades.includes(i.trade) && (!ids || ids.has(i.id)) && i.qty > 0;
  const items = t.items.filter(wanted);
  const groups = PLAN_TRADES.filter((tr) => items.some((i) => i.trade === tr && isMaterial(i))).map((tr) => ({
    trade: tr,
    title: TRADE_LABEL[tr],
    lines: items
      .filter((i) => i.trade === tr && isMaterial(i))
      .map((i): MaterialLine => {
        const extra = extraPct && i.role === "material";
        return {
          id: i.id,
          trade: tr,
          label: i.label,
          qty: extra ? withExtra(i.qty, i.unit, extraPct) : i.qty,
          unit: i.unit,
          basis: extra ? `${i.basis} · +${extraPct}% extra` : i.basis,
          pages: i.pages,
          source: sourceOf(i),
          phase: i.phase ?? null,
        };
      }),
  }));
  // The measurements under them: the work lines of the same trades (the quantity each material is figured from).
  const measures = items
    .filter((i) => i.role === "labor")
    .map((i): MaterialMeasure => ({ id: i.id, trade: i.trade, label: i.label, qty: i.qty, unit: i.unit, basis: i.basis, pages: i.pages, source: edits[i.id] != null ? "entered" : sourceOf(i), edited: edits[i.id] != null }));
  const asked = job.asked.map((r): MeasureRow => ({ label: r.label, value: r.qty != null ? `${r.qty.toLocaleString("en-US")} ${r.unit}` : "not found on the sheets", pages: r.pages, source: r.status === "measured" ? "measured" : r.status === "kept" ? "derived" : "rule", note: r.asWritten }));
  // The deck's yard list takes the same extra (whole pieces, bags and fittings rounded up).
  const deckOut = deck && extraPct ? { ...deck, groups: deck.groups.map((g) => ({ ...g, lines: g.lines.map((l) => ({ ...l, qty: withExtra(l.qty, l.unit, extraPct) })) })) } : deck;
  const deckLines = deckOut ? deckOut.groups.reduce((a, g) => a + g.lines.length, 0) : 0;
  return {
    title: job.title,
    request: job.request,
    extraPct,
    measures,
    groups,
    deck: deckOut,
    count: groups.reduce((a, g) => a + g.lines.length, 0) + deckLines,
    asked,
  };
}

const qtyWords = (q: number) => (Number.isInteger(q) ? q.toLocaleString("en-US") : (Math.round(q * 10) / 10).toLocaleString("en-US"));

/** The list in the report shape the PDF and the spreadsheet already draw (lib/plans/measureReport). */
export function materialsAsReport(r: MaterialsReport, meta: { name: string | null; address: string | null; sheets: number }): MeasureReport {
  const sections: MeasureSection[] = [];
  if (r.measures.length) {
    sections.push({ key: "measures", title: "What it is figured from", rows: r.measures.map((m) => ({ label: `${TRADE_LABEL[m.trade]} · ${m.label}`, value: `${qtyWords(m.qty)} ${m.unit}`, pages: m.pages, source: m.source, note: m.edited ? "entered by you" : m.basis })) });
  }
  for (const g of r.groups) sections.push({ key: g.trade, title: `${g.title} — materials`, rows: g.lines.map((l) => ({ label: l.label, value: `${qtyWords(l.qty)} ${l.unit}`, pages: l.pages, source: l.source, note: l.basis })) });
  if (r.deck) for (const g of r.deck.groups) sections.push({ key: `deck-${g.label}`, title: `Deck — ${g.label.toLowerCase()}`, rows: g.lines.map((l) => ({ label: l.label, value: `${qtyWords(l.qty)} ${l.unit}`, pages: [], source: "derived", note: l.note ?? undefined })) });
  const summary = [
    { label: "Materials for", value: r.title },
    { label: "Lines to order", value: qtyWords(r.count) },
    ...(r.extraPct ? [{ label: "Extra on top", value: `${r.extraPct}%` }] : []),
    ...(r.deck ? [{ label: "Deck", value: r.deck.words }] : []),
  ];
  return {
    name: meta.name,
    address: meta.address,
    sheets: meta.sheets,
    summary,
    rooms: [],
    sections,
    asked: r.asked.length && r.request ? { request: r.request, rows: r.asked } : null,
    checks: [
      ...(r.groups.some((g) => g.lines.some((l) => l.source === "rule")) ? ["Lines marked “Assumed” are a builder's rule where the plans are silent — confirm them before ordering."] : []),
      ...(r.deck?.fixes.length ? [`The deck's framing was sized to the code tables: ${r.deck.fixes.join("; ")}.`] : []),
    ],
  };
}

/** The list as plain text — to text or email a supplier for a quote. */
export function materialsText(r: MaterialsReport, meta: { name: string | null; address: string | null }): string {
  const head = [`Materials — ${r.title}`, [meta.name, meta.address].filter(Boolean).join(", "), r.extraPct ? `(${r.extraPct}% extra included)` : ""].filter(Boolean);
  const body = [
    ...r.groups.flatMap((g) => [``, g.title.toUpperCase(), ...g.lines.map((l) => `${qtyWords(l.qty)} ${l.unit} — ${l.label}`)]),
    ...(r.deck ? r.deck.groups.flatMap((g) => [``, `DECK · ${g.label.toUpperCase()}`, ...g.lines.map((l) => `${qtyWords(l.qty)} ${l.unit} — ${l.label}`)]) : []),
  ];
  return [...head, ...body, "", "Quantities from the plans by JobFlex — please quote."].join("\n");
}
