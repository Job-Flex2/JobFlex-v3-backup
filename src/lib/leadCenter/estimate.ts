// THE ESTIMATE THAT RIDES WITH A LEAD (owner, 2026-10-27: a homeowner prices their roof in the home portal; the lead
// carries "the whole estimate, pre-estimated but hidden"). One record per PlatformLead in SyncState
// (`leadestimate:<leadId>`, no schema change): the range the homeowner saw and their choices on top, the whole
// package (facts, spec, every line, the assumptions, the scope) underneath for the contractor who buys the lead.
// The same record, kept as a planned project's notes, is a range someone only asked to have emailed.
//
// PURE, and it ships to the browser (the Lead Center's own screen reads it): the words, the short line, the suggested
// price, the plan notes. The two database helpers live in ./estimateStore (server only).
import { MATERIALS, type MaterialId, type RoofAnswers, type RoofRange } from "@/lib/publicEstimate/roof";

export type LeadEstimate = {
  v: 1;
  trade: "roof";
  range: { low: number; mid: number; high: number };
  material: MaterialId;
  materialLabel: string;
  tearOffLayers: 0 | 1 | 2;
  storeys: 1 | 2 | 3;
  squares: number;
  pitchLabel: string;
  basis: "solar" | "size";
  budgetCents: number | null;
  answers: RoofAnswers;
  cityFactor: number;
  guideRange: { low: number; high: number } | null;
  at: string;
  /** The EagleView measurement ordered for the lead (phase 1b), once there is one. */
  measurementId?: string | null;
  /** THE WHOLE ESTIMATE, hidden from the homeowner: what the buyer's roof estimator opens. Priced at the default
   *  catalog × the city factor; the contractor's own rates apply once opened. */
  hidden: RoofRange["hidden"];
};

export const LEAD_ESTIMATE_KEY = (leadId: string) => `leadestimate:${leadId}`;
/** The first line of a HomePlan's notes that holds a saved range. */
export const PRICE_PLAN_TAG = "price:roof";

const usd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const num = (n: number) => Math.round(n).toLocaleString("en-US");

/** The record for a range the homeowner just saw, with no budget and no measurement yet. */
export function leadEstimateFrom(range: RoofRange, answers: RoofAnswers, guide: { low: number; high: number } | null, at: Date = new Date()): LeadEstimate {
  return {
    v: 1,
    trade: "roof",
    range: { low: range.low, mid: range.mid, high: range.high },
    material: answers.material,
    materialLabel: MATERIALS.find((m) => m.id === answers.material)?.label ?? answers.material,
    tearOffLayers: answers.tearOffLayers,
    storeys: answers.storeys,
    squares: range.squares,
    pitchLabel: range.pitchLabel,
    basis: range.basis,
    budgetCents: null,
    answers,
    cityFactor: range.cityFactor,
    guideRange: guide ? { low: guide.low, high: guide.high } : null,
    at: at.toISOString(),
    hidden: range.hidden,
  };
}

const basisWords = (e: Pick<LeadEstimate, "basis" | "measurementId">) => (e.measurementId ? "measured" : e.basis === "solar" ? "aerial read" : "from home size");

/** One paragraph for the lead's description and the contractor's brief. */
export function estimateWords(e: LeadEstimate): string {
  const notes = [e.answers.leaks ? "leaks" : null, e.answers.skylights ? "skylights" : null, e.answers.solarPanels ? "solar panels" : null].filter((x): x is string => !!x);
  const noted = notes.length === 0 ? "" : notes.length === 1 ? `; ${notes[0]} noted` : `; ${notes.slice(0, -1).join(", ")} and ${notes[notes.length - 1]} noted`;
  const tear = e.tearOffLayers === 0 ? "no tear-off" : `tear-off ${e.tearOffLayers} layer${e.tearOffLayers === 1 ? "" : "s"}`;
  const basis = e.measurementId ? "measured" : e.basis === "solar" ? "read from aerial data" : "from the home's size";
  const budget = e.budgetCents && e.budgetCents > 0 ? ` Budget: about ${usd(e.budgetCents / 100)}.` : "";
  return `Roof replacement, ${e.materialLabel.toLowerCase()}, ${tear}, about ${num(e.squares * 100)} sq ft of roof at ${e.pitchLabel}, ${e.storeys} floor${e.storeys === 1 ? "" : "s"}${noted}. Range shown: ${usd(e.range.low)}–${usd(e.range.high)} (${basis}).${budget}`;
}

/** One line for a card: "$14,200–$19,800 · architectural shingle · 21 sq · aerial read". */
export function estimateShort(e: LeadEstimate): string {
  return `${usd(e.range.low)}–${usd(e.range.high)} · ${e.materialLabel.toLowerCase()} · ${Math.round(e.squares)} sq · ${basisWords(e)}`;
}

/** What the Lead Center suggests in the "Lead price, $" box: priced $35, measured $60, measured with a budget $75;
 *  exclusive doubles it. */
export function suggestedLeadPriceCents(e: LeadEstimate, exclusive: boolean): number {
  const measured = Boolean(e.measurementId);
  const budget = Boolean(e.budgetCents && e.budgetCents > 0);
  const base = measured ? (budget ? 7500 : 6000) : 3500;
  return exclusive ? base * 2 : base;
}

export type PlanSite = { address: string; city: string; state: string; zip: string; lat: number; lng: number };

/** A planned project's notes that hold a range: the tag, a newline, the record (with the house, so "Get quotes" from
 *  the dashboard or the email picks the flow up at the form). */
export function planNotesFor(e: LeadEstimate, site?: PlanSite | null): string {
  return `${PRICE_PLAN_TAG}\n${JSON.stringify(site ? { ...e, site } : e)}`;
}

export function parsePlanEstimate(notes: string | null | undefined): LeadEstimate | null {
  if (!notes || !notes.startsWith(PRICE_PLAN_TAG + "\n")) return null;
  try {
    const parsed = JSON.parse(notes.slice(PRICE_PLAN_TAG.length + 1)) as LeadEstimate;
    return parsed && parsed.v === 1 && parsed.range && typeof parsed.range.mid === "number" ? parsed : null;
  } catch {
    return null;
  }
}

export function parsePlanSite(notes: string | null | undefined): PlanSite | null {
  if (!parsePlanEstimate(notes)) return null;
  const site = (JSON.parse(notes!.slice(PRICE_PLAN_TAG.length + 1)) as { site?: PlanSite }).site;
  return site && typeof site.lat === "number" && typeof site.lng === "number" && typeof site.address === "string" ? site : null;
}

/** What a saved range reads as on a plan row or in a reminder: "Roof range $14,200–$19,800 · architectural shingle — priced on JobFlex". */
export function planRangeWords(e: LeadEstimate): string {
  return `Roof range ${usd(e.range.low)}–${usd(e.range.high)} · ${e.materialLabel.toLowerCase()} — priced on JobFlex, not a quote`;
}
