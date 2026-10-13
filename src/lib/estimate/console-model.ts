// THE SMART PROPOSAL CONSOLE MODEL
//
// One line-item shape, one set of totals, one materials-request derivation —
// shared by the desktop console (components/v3/advanced-ai-blueprint), the
// handheld studio (app/(mobile)/mobile-advanced-ai-v2) and the video estimator
// (components/v3/video-estimator-blueprint, mobile-video-estimator).
//
// ONE LINE, TWO PRICES (owner, 2026-09-02)
//
// A line item is a piece of WORK — "Install 6 ft cedar privacy fence" — with
// a measured quantity, a unit, a material price per unit and a labor price per
// unit. Material and labor are COLUMNS of every row, not row types. The old
// model kept two ledgers ("materials" / "labor") and the estimator wrote a
// material row and a separate labor row for the same task, so the client read
// "Cedar fence panels" and "Cedar fence installation" as two things and the
// labor for 120 sqft of counters floated free of the 120 sqft it belonged to.
//
// THE WIRE FORMAT DID NOT CHANGE. `GeneratedEstimate` (lib/estimatorSchema)
// still carries `materials[]` and `labor[]`: saved estimates, the refine
// round-trip and convertEstimateToProposal all read it. `linesFromEstimate`
// PAIRS a material row with the labor row that shares its id (or, for older
// estimates, its name and unit); `estimateFromLines` splits a line back into
// the two rows with the SAME id, so the pairing is exact on the way back.
// The server writes both rows from one fused item, so nothing is guessed.
//
// This module is pure and client-safe: no DB, no server-only imports, no React.

import type { EstimateDiscount, GeneratedEstimate } from "@/lib/estimatorSchema";

// ── The intake gate's answers ───────────────────────────────────────────────

/** One clarifying question and what the contractor typed or picked for it. */
export type ClarifyAnswer = { question: string; answer: string };

/**
 * Fold the clarifying answers back into the brief.
 *
 * `analyzeEstimatePrompt` asks the questions but has nowhere to put the
 * answers — `generateAdvancedEstimate` takes a single `description` string and
 * nothing else. So the answers become more brief, appended as a labelled block
 * the planner reads as part of the job description. Both surfaces must compose
 * it identically or the same job, answered the same way, prices differently on
 * a phone than on a desk.
 */
export function briefWithAnswers(brief: string, answers: ClarifyAnswer[]): string {
  const pairs = answers
    .map((a) => ({ q: a.question.trim(), a: a.answer.trim() }))
    .filter((p) => p.q && p.a);
  if (pairs.length === 0) return brief;
  return `${brief.trim()}\n\nAdditional detail:\n${pairs
    .map((p) => `- ${p.q} → ${p.a}`)
    .join("\n")}`;
}

/**
 * One editable row of the ledger.
 *
 * `materialPrice` and `laborPrice` are what the client is billed per unit,
 * and are always the source of truth for money. `retailPrice` is what the
 * live product search actually returned for the PACKAGE (a box, a pail) and
 * never changes when the contractor edits a price — the Materials request
 * keeps showing the real shelf price as a "where to buy it" reference.
 */
export type ConsoleLine = {
  id: string;
  name: string;
  qty: number;
  /** One of ESTIMATE_UNITS, or the estimator's own word for an older line. */
  unit: string;
  /** Material $ per unit. Edited freely. 0 for a labor-only task. */
  materialPrice: number;
  /** Labor $ per unit. Edited freely. 0 for a supply-only task. */
  laborPrice: number;
  /** The listing's package price, or null when the line was never shopped. */
  retailPrice: number | null;
  store?: string;
  productUrl?: string;
  imageUrl?: string;
  dimensions?: string;
  notes?: string;
  /** "Updated" / "Added" after a refine, cleared by Undo. */
  badge?: string;
  /**
   * What the post-generation validation did to this line
   * (lib/estimate/validate-estimate): "auto" = added from the trade's standard
   * scope, "adjusted" = its price was pulled to the catalogue anchor,
   * "suggested" = the description never asked for it. A SUGGESTED line is
   * shown apart and counts in no total until the contractor adds it.
   */
  flag?: "auto" | "adjusted" | "suggested" | "computed";
  flagNote?: string;
  /**
   * The trade a line belongs to on an estimate priced from blueprints (lib/plans):
   * the ledger heads each trade's lines with it, and the proposal's line name
   * carries it ("Framing — Exterior walls…"), since a proposal has no sections.
   */
  group?: string;
};

/** Kept for callers that still name the two ledgers; nothing branches on it. */
export type LineGroup = "materials" | "labor";

/**
 * The unit choices offered in the ledger's unit field.
 *
 * ONE vocabulary, and it is the manual builder's own picker (manual-focus-math
 * UNITS) — the same ten words, in the same order, with the same labels. The
 * estimator prompts are pinned to these values, the proposal conversion maps
 * them onto `LineItem.measurementType`, and a line that leaves the Smart
 * Proposal for the manual builder lands on the option it was priced in.
 */
export const ESTIMATE_UNITS: readonly { value: string; label: string }[] = [
  { value: "sqft", label: "sqft" },
  { value: "lf", label: "lf" },
  { value: "linear ft", label: "linear ft" },
  { value: "sq boards", label: "sq boards" },
  { value: "cu yards", label: "cu yards" },
  { value: "yards", label: "yards" },
  { value: "sq yards", label: "sq yards" },
  { value: "unit", label: "unit" },
  { value: "hour", label: "hr" },
  { value: "fixed", label: "fixed" },
];

export const ESTIMATE_UNIT_VALUES: readonly string[] = ESTIMATE_UNITS.map((u) => u.value);

/** Older estimates carry free-text units; fold the known ones onto the picker. */
const LEGACY_UNIT: Record<string, string> = {
  "sq ft": "sqft",
  sf: "sqft",
  "square feet": "sqft",
  "square foot": "sqft",
  "ln ft": "linear ft",
  "lin ft": "linear ft",
  "linear feet": "linear ft",
  "linear foot": "linear ft",
  "lineal ft": "linear ft",
  square: "sq boards",
  squares: "sq boards",
  "roofing square": "sq boards",
  "cu yd": "cu yards",
  "cubic yards": "cu yards",
  "cubic yard": "cu yards",
  yd: "yards",
  yard: "yards",
  "sq yd": "sq yards",
  "square yards": "sq yards",
  each: "unit",
  ea: "unit",
  pc: "unit",
  pcs: "unit",
  piece: "unit",
  box: "unit",
  boxes: "unit",
  sheet: "unit",
  sheets: "unit",
  roll: "unit",
  rolls: "unit",
  bag: "unit",
  bags: "unit",
  gal: "unit",
  gallon: "unit",
  gallons: "unit",
  bundle: "unit",
  hr: "hour",
  hrs: "hour",
  hours: "hour",
  day: "fixed",
  "crew day": "fixed",
  job: "fixed",
  lot: "fixed",
  "lump sum": "fixed",
  ls: "fixed",
};

/**
 * Normalize a unit string onto the picker vocabulary. Unknown words are kept
 * verbatim so an estimator's own unit never silently rewrites a line — the
 * select shows it at the head of its list instead (see `unitSelectOptions`).
 */
export function normalizeUnit(unit: string | null | undefined, fallback: LineGroup = "materials"): string {
  const raw = (unit ?? "").trim().toLowerCase();
  if (!raw) return fallback === "labor" ? "fixed" : "unit";
  if (ESTIMATE_UNIT_VALUES.includes(raw)) return raw;
  return LEGACY_UNIT[raw] ?? raw;
}

/** The picker's options — the same ten everywhere. The argument is ignored;
 *  it survives so older call sites still compile. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function unitOptionsFor(_group?: LineGroup): readonly string[] {
  return ESTIMATE_UNIT_VALUES;
}

/**
 * Options for a unit select showing `current`: the ten house units, with the
 * line's own unit at the head when it is not one of them, so switching the
 * control never drops the value it was showing.
 */
export function unitSelectOptions(current: string): { value: string; label: string }[] {
  const cur = (current ?? "").trim();
  if (!cur || ESTIMATE_UNIT_VALUES.includes(cur)) return [...ESTIMATE_UNITS];
  return [{ value: cur, label: cur }, ...ESTIMATE_UNITS];
}

// ── Identity ────────────────────────────────────────────────────────────────
// Ids survive the refine round-trip (lineSchema.id) so the AI can edit a line
// by identity instead of by name — renaming a line must not re-shop it.

let idSeq = 0;
export function newLineId(prefix = "l"): string {
  idSeq += 1;
  return `${prefix}${idSeq}-${Math.random().toString(36).slice(2, 8)}`;
}

/** A blank row for the Add-line button. */
export function blankLine(): ConsoleLine {
  return {
    id: newLineId("n"),
    name: "",
    qty: 1,
    unit: "unit",
    materialPrice: 0,
    laborPrice: 0,
    retailPrice: null,
  };
}

// ── Pairing the wire format into fused lines ────────────────────────────────

type WireLine = GeneratedEstimate["materials"][number];

const num = (n: unknown): number => (typeof n === "number" && Number.isFinite(n) ? n : 0);

function pairKey(l: WireLine): string {
  return `${l.name.trim().toLowerCase()}|${normalizeUnit(l.unit)}`;
}

/**
 * Pair every material row with the labor row for the same task.
 *
 * Match by id first (the server writes both rows of one item with one id),
 * then by name + unit (estimates from before the fused model, and a model
 * that echoed the name but dropped the id). Unpaired rows become one-sided
 * lines: a supply-only material, or a labor-only task like demolition.
 */
export function pairEstimateLines(
  est: Pick<GeneratedEstimate, "materials" | "labor">,
): Array<{ material: WireLine | null; labor: WireLine | null }> {
  const laborById = new Map<string, WireLine>();
  const laborByKey = new Map<string, WireLine[]>();
  for (const l of est.labor) {
    if (l.id) laborById.set(l.id, l);
    const k = pairKey(l);
    laborByKey.set(k, [...(laborByKey.get(k) ?? []), l]);
  }
  const used = new Set<WireLine>();
  const out: Array<{ material: WireLine | null; labor: WireLine | null }> = [];
  for (const m of est.materials) {
    let lab: WireLine | undefined = m.id ? laborById.get(m.id) : undefined;
    if (!lab || used.has(lab)) {
      lab = (laborByKey.get(pairKey(m)) ?? []).find((l) => !used.has(l));
    }
    if (lab) used.add(lab);
    out.push({ material: m, labor: lab ?? null });
  }
  for (const l of est.labor) {
    if (!used.has(l)) out.push({ material: null, labor: l });
  }
  return out;
}

/** Flatten a generated estimate into the single ordered ledger every UI renders. */
export function linesFromEstimate(est: GeneratedEstimate): ConsoleLine[] {
  return pairEstimateLines(est).map(({ material: m, labor: l }, i) => {
    const src = (m ?? l)!;
    const materialPrice = m ? num(m.unitPrice) : 0;
    return {
      id: m?.id || l?.id || `i${i + 1}-${newLineId("x")}`,
      name: src.name,
      qty: num(m?.quantity ?? l?.quantity),
      unit: normalizeUnit(src.unit, m ? "materials" : "labor"),
      materialPrice,
      laborPrice: l ? num(l.unitPrice) : 0,
      // The listing's package price, set server-side. Older estimates carried
      // no such field: their store-matched rows were priced FROM the listing,
      // so the arriving unitPrice was the retail price.
      retailPrice:
        m && Number.isFinite(m.retailPrice) && m.retailPrice != null
          ? m.retailPrice
          : m?.store
            ? materialPrice
            : null,
      store: m?.store,
      productUrl: m?.productUrl,
      imageUrl: m?.imageUrl,
      dimensions: m?.dimensions,
      notes: m?.notes ?? l?.notes,
      flag: m?.flag ?? l?.flag,
      flagNote: m?.flagNote ?? l?.flagNote,
    };
  });
}

/**
 * Rebuild the wire shape from the edited ledger — the input to
 * `refineAdvancedEstimate`, `saveEstimate` and `convertEstimateToProposal`.
 *
 * One fused line becomes a material row (its product identity and material
 * $/unit) and, when it carries labor, a labor row with the SAME id, name,
 * quantity and unit. A labor-only task writes only the labor row.
 */
export function estimateFromLines(
  lines: ConsoleLine[],
  base: Pick<GeneratedEstimate, "title" | "scope" | "assumptions"> & {
    estimatedTimelineDays?: number;
    discount?: EstimateDiscount | null;
  },
): GeneratedEstimate {
  const materials: WireLine[] = [];
  const labor: WireLine[] = [];
  for (const l of lines) {
    const hasProduct = Boolean(l.store || l.productUrl || l.imageUrl || l.retailPrice != null);
    const hasMaterial = num(l.materialPrice) > 0 || hasProduct;
    const hasLabor = num(l.laborPrice) > 0;
    const name = l.group && !l.name.startsWith(l.group) ? `${l.group} — ${l.name}` : l.name;
    const common = { id: l.id, name, quantity: l.qty, unit: l.unit || undefined, flag: l.flag, flagNote: l.flagNote };
    if (hasMaterial || !hasLabor) {
      materials.push({
        ...common,
        unitPrice: num(l.materialPrice),
        retailPrice: l.retailPrice ?? undefined,
        store: l.store,
        productUrl: l.productUrl,
        imageUrl: l.imageUrl,
        dimensions: l.dimensions,
        notes: l.notes,
      });
    }
    if (hasLabor) {
      labor.push({ ...common, unitPrice: num(l.laborPrice), notes: hasMaterial ? undefined : l.notes });
    }
  }
  return {
    title: base.title,
    scope: base.scope,
    assumptions: base.assumptions,
    estimatedTimelineDays: base.estimatedTimelineDays,
    discount: base.discount ?? null,
    materials,
    labor,
  };
}

/**
 * Merge a refined estimate back into the ledger.
 *
 * Matching is by id so a line the AI renamed keeps its identity — and keeps the
 * `retailPrice` it was shopped at, unless the refine actually re-shopped it
 * (the server nulls and re-attaches store/link/image on any changed line, so a
 * new `store` value means a new match and a new listing price).
 */
export function mergeRefined(previous: ConsoleLine[], refined: GeneratedEstimate): ConsoleLine[] {
  const before = new Map(previous.map((l) => [l.id, l]));
  return linesFromEstimate(refined).map((next) => {
    const old = before.get(next.id);
    if (!old) return { ...next, badge: "Added" };
    const reshopped = next.store != null && next.store !== old.store;
    const changed =
      next.qty !== old.qty ||
      next.materialPrice !== old.materialPrice ||
      next.laborPrice !== old.laborPrice ||
      next.name !== old.name ||
      next.unit !== old.unit;
    return {
      ...next,
      retailPrice: reshopped ? next.retailPrice : (old.retailPrice ?? next.retailPrice),
      badge: reshopped || changed ? "Updated" : undefined,
    };
  });
}

// ── Money ───────────────────────────────────────────────────────────────────

/** Material $ + labor $ per unit — what the client is billed per unit. */
export function unitPriceOf(l: ConsoleLine): number {
  return num(l.materialPrice) + num(l.laborPrice);
}

export function lineMaterial(l: ConsoleLine): number {
  return num(l.qty) * num(l.materialPrice);
}

export function lineLabor(l: ConsoleLine): number {
  return num(l.qty) * num(l.laborPrice);
}

export function lineTotal(l: ConsoleLine): number {
  return lineMaterial(l) + lineLabor(l);
}

/** A line the contractor has not accepted yet is in no total (audit 2026-09-17). */
export const isBilled = (l: ConsoleLine): boolean => l.flag !== "suggested";

export function sumMaterials(lines: ConsoleLine[]): number {
  return lines.reduce((n, l) => n + (isBilled(l) ? lineMaterial(l) : 0), 0);
}

export function sumLabor(lines: ConsoleLine[]): number {
  return lines.reduce((n, l) => n + (isBilled(l) ? lineLabor(l) : 0), 0);
}

/** Order-level discount as the console holds it. Mirrors `EstimateDiscount`. */
export type DiscountState = { mode: "pct" | "amt"; value: number };

export const NO_DISCOUNT: DiscountState = { mode: "pct", value: 0 };

export function discountToSchema(d: DiscountState): EstimateDiscount | null {
  if (!d.value || d.value <= 0) return null;
  return { label: "Discount", amount: d.value, isPercent: d.mode === "pct" };
}

export function discountFromSchema(d: EstimateDiscount | null | undefined): DiscountState {
  if (!d) return NO_DISCOUNT;
  return { mode: d.isPercent ? "pct" : "amt", value: d.amount };
}

export type TotalsInput = {
  lines: ConsoleLine[];
  discount?: DiscountState;
  /** Percent, e.g. 6.5. Seeded from the state, overridable. */
  taxPct?: number;
  /** Percent uplift on cost, handheld only. Omit on desktop. */
  marginPct?: number;
};

export type Totals = {
  materials: number;
  labor: number;
  /** materials + labor, before margin. */
  subtotal: number;
  marginCash: number;
  /** subtotal + margin — what the client is quoted before discount and tax. */
  clientPrice: number;
  discountCash: number;
  /** clientPrice − discount. The figure tax is charged on. */
  taxable: number;
  taxCash: number;
  total: number;
};

/**
 * The one place the money chain is defined: cost → margin → discount → tax.
 *
 * Tax lands on the discounted price because that is what the customer actually
 * pays for, and margin lands before the discount because a discount is given
 * off the quoted price, not off cost.
 */
export function computeTotals({ lines, discount, taxPct, marginPct }: TotalsInput): Totals {
  const materials = sumMaterials(lines);
  const labor = sumLabor(lines);
  const subtotal = materials + labor;
  const marginCash = subtotal * ((Number(marginPct) || 0) / 100);
  const clientPrice = subtotal + marginCash;
  const d = discount ?? NO_DISCOUNT;
  const rawDiscount = d.mode === "pct" ? clientPrice * ((Number(d.value) || 0) / 100) : Number(d.value) || 0;
  // A discount can be typed larger than the job; it may zero the price, never invert it.
  const discountCash = Math.min(Math.max(rawDiscount, 0), clientPrice);
  const taxable = clientPrice - discountCash;
  const taxCash = taxable * ((Number(taxPct) || 0) / 100);
  return {
    materials,
    labor,
    subtotal,
    marginCash,
    clientPrice,
    discountCash,
    taxable,
    taxCash,
    total: taxable + taxCash,
  };
}

// ── Materials request ───────────────────────────────────────────────────────

/**
 * One shoppable row, derived from the ledger rather than stored beside it.
 *
 * Deriving is what makes the request card reactive: deleting a line removes its
 * row, changing a quantity moves its buy quantity and its total, and adding a
 * line shows up immediately as unshopped. There is nothing to keep in sync
 * because there is no second copy.
 */
export type MaterialRequestRow = {
  id: string;
  name: string;
  qty: number;
  unit: string;
  /** The billed material $ per unit — what the contractor typed, if they typed one. */
  unitPrice: number;
  /** The matched listing's price — per PACKAGE (a box, a pail), not per unit.
   *  It is the "what it costs to buy" figure of the shop list; the line's own
   *  `unitPrice` is the estimator's price per measured unit and the two are
   *  not comparable. */
  retailUnitPrice: number | null;
  /** Legacy: true when the billed price differs from the listing price. Kept
   *  for the type; no surface renders it since the two prices were decoupled. */
  overridden: boolean;
  /** qty × billed material $/unit. */
  total: number;
  store?: string;
  productUrl?: string;
  imageUrl?: string;
  dimensions?: string;
  /** False for a hand-added line the search has never seen. */
  shopped: boolean;
};

/**
 * Build the Materials request from the live ledger.
 *
 * A labor-only task (demolition, cleanup) never appears — it carries no product
 * and nothing to buy. Zero-quantity lines are kept: a contractor zeroing a
 * quantity is deciding not to buy it *yet*, and dropping the row would lose the
 * retail match they would need to put it back.
 */
export function materialsRequest(lines: ConsoleLine[]): MaterialRequestRow[] {
  return lines
    .filter((l) => num(l.materialPrice) > 0 || l.store || l.productUrl || l.retailPrice != null)
    .map((l) => {
      const price = num(l.materialPrice);
      const retail = l.retailPrice;
      return {
        id: l.id,
        name: l.name,
        qty: num(l.qty),
        unit: l.unit,
        unitPrice: price,
        retailUnitPrice: retail,
        overridden: retail != null && Math.abs(retail - price) > 0.005,
        total: lineMaterial(l),
        store: l.store,
        productUrl: l.productUrl,
        imageUrl: l.imageUrl,
        dimensions: l.dimensions,
        shopped: Boolean(l.store || l.productUrl),
      };
    });
}

/** What the Materials request card totals: the buy-side cost, not the client price. */
export function materialsRequestTotal(rows: MaterialRequestRow[]): number {
  return rows.reduce((n, r) => n + r.total, 0);
}
