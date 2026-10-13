// Smart Proposal — the price book: merge, cost conversion, prompt text and
// the trade's benchmark range (2026-09-18).
//
// The per-group files beside this one hold one SpecialtyPrices per AI
// specialty (./types). This module turns a customer price into the
// contractor's cost (the estimator writes lines at cost; the org's markup
// adds overhead and profit afterwards), prints the cost after each step of
// the procedure block, and gives a whole job of known size a range from the
// trade's benchmark, so a reply far under it is asked again
// (lib/estimate/remodel-sanity `retryReasons`). Plain module.

import type { BriefFacts } from "../brief";
import { locationIndex } from "../location-index";
import type { ProcedureUnit } from "../procedures/types";
import { PRICES as CORE } from "./core-building-trades";
import { PRICES as MEP } from "./mep";
import { PRICES as EXTERIOR } from "./exterior-systems";
import { PRICES as INTERIOR } from "./interior-finishes";
import { PRICES as SURFACE } from "./specialty-surface-decor";
import { PRICES as SITE } from "./site-landscape";
import { PRICES as ENVELOPE } from "./waterproofing-envelope";
import { PRICES as SYSTEMS } from "./specialty-systems";
import { PRICES as CIVIL } from "./civil-demolition";
import { PRICES as FABRICATION } from "./fabrication-custom";
import { PRICES as GENERAL } from "./general-professional";
import { PRICES as ROADWAY } from "./roadway-transportation";
import { PRICES as ENGINEERING } from "./engineering-design";
import { PRICES as DEVELOPMENT } from "./development-consulting";
import type { PriceRange, SpecialtyPrices, StepPrice, StepPriceMap } from "./types";

export * from "./types";

/** Every specialty's prices, keyed by AI specialty id. */
export const SPECIALTY_PRICES: StepPriceMap = {
  ...CORE,
  ...MEP,
  ...EXTERIOR,
  ...INTERIOR,
  ...SURFACE,
  ...SITE,
  ...ENVELOPE,
  ...SYSTEMS,
  ...CIVIL,
  ...FABRICATION,
  ...GENERAL,
  ...ROADWAY,
  ...ENGINEERING,
  ...DEVELOPMENT,
};

export function pricesFor(specialtyId: string): SpecialtyPrices | null {
  return SPECIALTY_PRICES[specialtyId] ?? null;
}

/** A customer price as the contractor's cost: less overhead and profit, unless it is a fee. */
export function toCost(n: number, op: number, fee = false): number {
  return fee ? n : n / (1 + op);
}

export type StepCost = { total: PriceRange; material: PriceRange; labor: PriceRange; fee: boolean };

export function stepCost(p: StepPrice, op: number): StepCost {
  const fee = !!p.fee;
  const total: PriceRange = [toCost(p.price[0], op, fee), toCost(p.price[1], op, fee)];
  const share = fee ? 0 : Math.min(1, Math.max(0, p.labor));
  return {
    total,
    labor: [total[0] * share, total[1] * share],
    material: [total[0] * (1 - share), total[1] * (1 - share)],
    fee,
  };
}

/** Money as a price list prints it: cents under $10, whole dollars under $1,000, tens above. */
export function priceMoney(n: number): string {
  if (n < 10) return `$${(Math.round(n * 100) / 100).toFixed(2)}`;
  if (n < 1000) return `$${Math.round(n).toLocaleString("en-US")}`;
  return `$${(Math.round(n / 10) * 10).toLocaleString("en-US")}`;
}

const span = ([a, b]: PriceRange) => (priceMoney(a) === priceMoney(b) ? priceMoney(a) : `${priceMoney(a)}-${priceMoney(b)}`);

const PER: Record<ProcedureUnit, string> = {
  sqft: "per sqft",
  "linear ft": "per linear ft",
  "sq boards": "per square (sq boards)",
  "cu yards": "per cu yard",
  "sq yards": "per sq yard",
  unit: "each",
  hour: "per hour",
  fixed: "for the line",
  yards: "per linear yard",
};

/** The cost text after a procedure step: "cost $9-$14 per linear ft (material $4-$6 + labor $5-$8)". */
export function stepCostText(unit: ProcedureUnit, p: StepPrice, op: number): string {
  const c = stepCost(p, op);
  if (c.total[1] <= 0) return "no charge";
  if (c.fee) return `fee ${span(c.total)} ${PER[unit]}, passed through without markup`;
  const share = Math.min(1, Math.max(0, p.labor));
  if (share >= 0.97) return `cost ${span(c.total)} ${PER[unit]}, labor`;
  if (share <= 0.03) return `cost ${span(c.total)} ${PER[unit]}, material and equipment`;
  return `cost ${span(c.total)} ${PER[unit]} (material ${span(c.material)} + labor ${span(c.labor)})`;
}

/** Said once above the priced steps: what the numbers are and which prices govern. */
export const STEP_PRICE_HEADER =
  "PRICE BOOK: each step carries its contractor COST per unit — US national average, standard grade, before markup: material at contractor cost plus labor at a loaded crew rate. Overhead and profit are added by the contractor's own markup after this estimate, never in the lines. Scale every cost by the LOCATION factor; budget work takes the low end, standard the middle, premium the high end. A fee is passed through as it is. These step costs govern the line prices; a TRADE PROFILE's anchors are only a cross-check.";

// ── The trade's benchmark range ─────────────────────────────────────────────

export type SpecialtyRange = {
  kind: "specialty";
  /** The specialty id — what the action's log names. */
  job: string;
  label: string;
  unit: ProcedureUnit;
  qty: number;
  low: number;
  high: number;
  place: string;
};

/**
 * The brief's quantity in the benchmark's unit, or undefined when it states
 * none. A count counts only when its noun is what the trade sells by ("12
 * windows" for windows): "a 40-unit building" is never 40 months of a
 * construction manager.
 */
export function briefQuantity(unit: ProcedureUnit, facts: BriefFacts, measures = ""): number | undefined {
  const measured = (u: string) => facts.measures.find((m) => m.unit === u)?.value;
  const counted = () =>
    facts.measures.find((m) => {
      if (m.unit !== "unit") return false;
      const noun = m.text.toLowerCase().replace(/[^a-z ]+/g, " ").trim().split(/\s+/).pop() ?? "";
      const stem = noun.replace(/(es|s)$/, "");
      return stem.length > 2 && !/^(unit|each|ea|piece|pc|item)$/.test(stem) && measures.toLowerCase().includes(stem);
    })?.value;
  switch (unit) {
    case "sqft":
      return facts.area;
    case "linear ft":
      return facts.length;
    case "sq yards":
      return measured("sq yards") ?? (facts.area ? facts.area / 9 : undefined);
    case "cu yards":
      return measured("cu yards");
    case "sq boards":
      // A roof is stated in sqft ("2,400 sqft"); a bare "24 sq" is read as sqft and is skipped.
      return facts.area && facts.area >= 300 ? facts.area / 100 : undefined;
    case "unit":
      return counted();
    default:
      return undefined;
  }
}

const round100 = (n: number) => Math.round(n / 100) * 100;

/**
 * A whole job of this specialty, with its size stated in the unit the trade
 * sells by, gets the benchmark's range at contractor cost, scaled to the
 * job's city. No range for a job sold per job (`fixed`), a size far outside
 * the typical job (a misread number must not ask again), or no size.
 */
export function specialtyRange(
  specialty: { id: string; name: string },
  facts: BriefFacts,
  location: string | null | undefined,
  /** The quantity in the benchmark's own unit when the caller measured it (a blueprint takeoff), not the brief. */
  measured?: number | null,
): SpecialtyRange | null {
  const book = pricesFor(specialty.id);
  if (!book) return null;
  const b = book.benchmark;
  const qty = measured ?? briefQuantity(b.unit, facts, b.measures);
  if (!qty || !(qty > 0)) return null;
  if (qty < b.typicalQty[0] / 4 || qty > b.typicalQty[1] * 4) return null;
  const idx = locationIndex(location);
  const floor = b.minJob ? toCost(b.minJob, book.op) * idx.factor : 0;
  const low = Math.max(toCost(b.price[0], book.op) * idx.factor * qty, floor);
  const high = Math.max(toCost(b.price[1], book.op) * idx.factor * qty, floor);
  const shown = qty >= 100 ? Math.round(qty).toLocaleString("en-US") : String(Math.round(qty * 10) / 10);
  return {
    kind: "specialty",
    job: specialty.id,
    label: `${specialty.name} job of about ${shown} ${b.unit} (${b.measures})`,
    unit: b.unit,
    qty,
    low: round100(low),
    high: round100(high),
    place: idx.level === "national" ? "the US" : idx.place,
  };
}

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** The line the prompt carries so the model knows the range before it answers. */
export function specialtyRangeLine(r: SpecialtyRange): string {
  return `THIS BRIEF'S RANGE: a ${r.label} in ${r.place} runs ${usd(r.low)}-${usd(r.high)} at contractor cost, before markup (the price book's benchmark for this trade, standard grade). A total under it leaves out steps of the PROCEDURE or prices them below their step costs — walk the procedure before you answer. Fix the lines, never just the total.`;
}
