// THE ESTIMATE THAT RIDES WITH A LEAD (owner, 2026-10-27: a homeowner prices their roof in the home portal; the lead
// carries "the whole estimate, pre-estimated but hidden"). One record per PlatformLead in SyncState
// (`leadestimate:<leadId>`, no schema change): the range the homeowner saw and their choices on top, the whole
// package (facts, spec, every line, the assumptions, the scope) underneath for the contractor who buys the lead.
// The same record, kept as a planned project's notes, is a range someone only asked to have emailed.
//
// PURE, and it ships to the browser (the Lead Center's own screen reads it): the words, the short line, the suggested
// price, the plan notes. The two database helpers live in ./estimateStore (server only).
import { MATERIALS, type MaterialId, type RoofAnswers, type RoofRange } from "@/lib/publicEstimate/roof";
import { WEB_TRADE, type WebEstimateRecord, type WebLeadContact, type WebLeadRecord, type WebTrade } from "@/lib/webEstimator";
import type { TradeType } from "@/lib/tradeTypes";

/** The roof, priced on /price/roof: the range, the choices, and the whole hidden package. */
export type RoofLeadEstimate = {
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

/** THE HOUSE ESTIMATORS (2026-10-28): a deck, fence, heating & cooling or any-project lead priced in the website
 *  estimators' house mode (/estimate/jobflex/<trade>). The record the website estimators keep rides whole — the
 *  summary, the choice, the band, the trade's facts — and the buyer's estimator opens from it. */
export type WebLeadTrade = Exclude<WebTrade, "roof">;
export type WebLeadEstimate = {
  v: 1;
  trade: WebLeadTrade;
  /** Dollars: the band's low and high as shown, the mid from the price itself. */
  range: { low: number; mid: number; high: number };
  at: string;
  budgetCents: null;
  measurementId?: null;
  /** The homeowner's own note from the quote form. */
  note: string | null;
  web: WebEstimateRecord;
};

export type LeadEstimate = RoofLeadEstimate | WebLeadEstimate;

export const LEAD_ESTIMATE_KEY = (leadId: string) => `leadestimate:${leadId}`;

/** The row as kept (SyncState `leadestimate:<leadId>`), taken only when it is one of ours. */
export function parseLeadEstimate(raw: string | null | undefined): LeadEstimate | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as LeadEstimate;
    return parsed && parsed.v === 1 && parsed.range && typeof parsed.range.mid === "number" ? parsed : null;
  } catch {
    return null;
  }
}

/** The trade the homeowner chose on a house page, as the Lead Center matches it; "any project" names none. */
export const HOUSE_TRADE: Record<"deck" | "fence" | "hvac", TradeType> = { deck: "Decking", fence: "Fencing", hvac: "HVAC" };
/** Where a house lead was started — the LeadSource row's `source`. */
export const houseSource = (trade: WebLeadTrade): string => `price:${trade}`;
/** The trade as a noun on a card: "$7,200–$9,400 · Cedar privacy, 6 ft · fence". */
export const TRADE_NOUN: Record<WebLeadTrade, string> = { deck: "deck", fence: "fence", hvac: "heating & cooling", smart: "project" };

export function leadEstimateFromWeb(web: WebEstimateRecord, note: string | null, at: Date = new Date()): WebLeadEstimate {
  if (web.trade === "roof") throw new Error("The roof prices on /price/roof, not in house mode.");
  return { v: 1, trade: web.trade, range: { low: web.band.low, mid: Math.round(web.cents / 100), high: web.band.high }, at: at.toISOString(), budgetCents: null, note: note?.trim() || null, web };
}

/** The record the buyer's lead page and estimators read (`webLead:<orgLeadId>`, the one the website estimators
 *  write): the estimate re-homed on the buyer. The deck's `draftId` and link `token` belong to the house org's
 *  Deck Studio and stay there — the buyer's copy carries the design, and the hand-off makes their own draft. */
export function buyerWebLeadRecord(e: WebLeadEstimate, a: { leadId: string; organizationId: string; contact: WebLeadContact }, at: Date = new Date()): WebLeadRecord {
  const { draftId: _draft, token: _token, ...facts } = e.web.facts;
  void _draft; void _token;
  return { leadId: a.leadId, trade: e.trade, estimate: { ...e.web, organizationId: a.organizationId, facts }, contact: a.contact, at: at.toISOString() };
}
/** The first line of a HomePlan's notes that holds a saved range. */
export const PRICE_PLAN_TAG = "price:roof";

const usd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const num = (n: number) => Math.round(n).toLocaleString("en-US");

/** The record for a range the homeowner just saw, with no budget and no measurement yet. */
export function leadEstimateFrom(range: RoofRange, answers: RoofAnswers, guide: { low: number; high: number } | null, at: Date = new Date()): RoofLeadEstimate {
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

const basisWords = (e: Pick<RoofLeadEstimate, "basis" | "measurementId">) => (e.measurementId ? "measured" : e.basis === "solar" ? "aerial read" : "from home size");

/** One paragraph for the lead's description and the contractor's brief. */
export function estimateWords(e: LeadEstimate): string {
  if (e.trade !== "roof") {
    const note = e.note ? ` Homeowner's note: "${e.note}"` : "";
    return `Priced on JobFlex: ${e.web.summary} Chose: ${e.web.choice}. Shown ${usd(e.range.low)}–${usd(e.range.high)} (before tax).${note}`;
  }
  const notes = [e.answers.leaks ? "leaks" : null, e.answers.skylights ? "skylights" : null, e.answers.solarPanels ? "solar panels" : null].filter((x): x is string => !!x);
  const noted = notes.length === 0 ? "" : notes.length === 1 ? `; ${notes[0]} noted` : `; ${notes.slice(0, -1).join(", ")} and ${notes[notes.length - 1]} noted`;
  const tear = e.tearOffLayers === 0 ? "no tear-off" : `tear-off ${e.tearOffLayers} layer${e.tearOffLayers === 1 ? "" : "s"}`;
  const basis = e.measurementId ? "measured" : e.basis === "solar" ? "read from aerial data" : "from the home's size";
  const budget = e.budgetCents && e.budgetCents > 0 ? ` Budget: about ${usd(e.budgetCents / 100)}.` : "";
  return `Roof replacement, ${e.materialLabel.toLowerCase()}, ${tear}, about ${num(e.squares * 100)} sq ft of roof at ${e.pitchLabel}, ${e.storeys} floor${e.storeys === 1 ? "" : "s"}${noted}. Range shown: ${usd(e.range.low)}–${usd(e.range.high)} (${basis}).${budget}`;
}

/** One line for a card: "$14,200–$19,800 · architectural shingle · 21 sq · aerial read". */
export function estimateShort(e: LeadEstimate): string {
  if (e.trade !== "roof") return `${usd(e.range.low)}–${usd(e.range.high)} · ${e.web.choice} · ${TRADE_NOUN[e.trade]}`;
  return `${usd(e.range.low)}–${usd(e.range.high)} · ${e.materialLabel.toLowerCase()} · ${Math.round(e.squares)} sq · ${basisWords(e)}`;
}

/** What they chose, lower-cased, for a row: the roof's material, a house estimate's choice. */
export function estimateMaterialWords(e: LeadEstimate): string {
  return e.trade === "roof" ? e.materialLabel.toLowerCase() : e.web.choice.toLowerCase();
}

/** The estimator a house estimate opens in, by name: "Fence estimator", "Deck Studio"… */
export function estimatorNameFor(trade: WebLeadTrade): string {
  return WEB_TRADE[trade].name.replace(" on your website", "");
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
  return parseLeadEstimate(notes.slice(PRICE_PLAN_TAG.length + 1));
}

/** A saved range's plan is nudged ONCE (nobody consented to more); an ordinary plan keeps its follow-up. */
export function planNudgesOnce(notes: string | null | undefined): boolean {
  return parsePlanEstimate(notes) !== null;
}

export function parsePlanSite(notes: string | null | undefined): PlanSite | null {
  if (!parsePlanEstimate(notes)) return null;
  const site = (JSON.parse(notes!.slice(PRICE_PLAN_TAG.length + 1)) as { site?: PlanSite }).site;
  return site && typeof site.lat === "number" && typeof site.lng === "number" && typeof site.address === "string" ? site : null;
}

/** What a saved range reads as on a plan row or in a reminder: "Roof range $14,200–$19,800 · architectural shingle — priced on JobFlex". */
export function planRangeWords(e: LeadEstimate): string {
  if (e.trade !== "roof") {
    const noun = TRADE_NOUN[e.trade];
    return `${noun.charAt(0).toUpperCase()}${noun.slice(1)} range ${usd(e.range.low)}–${usd(e.range.high)} · ${e.web.choice} — priced on JobFlex, not a quote`;
  }
  return `Roof range ${usd(e.range.low)}–${usd(e.range.high)} · ${e.materialLabel.toLowerCase()} — priced on JobFlex, not a quote`;
}

/** One line as the roof estimator's tables take it. */
export type ReopenLine = { name: string; quantity: number; unitPrice: number; unit: string };

/** The whole hidden estimate, as the buyer's roof estimator opens it: a hand takeoff (the squares and the pitch),
 *  the spec with the homeowner's choices, every line, the scope and the assumptions — with one more on top saying
 *  where it came from. No measurement, no linked proposal: Convert makes a new proposal. */
export function reopenFromEstimate(e: RoofLeadEstimate, address: string | null) {
  const line = (l: RoofLeadEstimate["hidden"]["materials"][number]): ReopenLine => ({ name: l.name, quantity: l.quantity, unitPrice: l.unitPrice, unit: l.unit });
  return {
    manual: { squares: Math.round(e.squares * 10) / 10, pitchLabel: e.pitchLabel, address },
    spec: e.hidden.spec,
    materials: e.hidden.materials.map(line),
    labor: e.hidden.labor.map(line),
    title: `Roof · ${address ?? "the lead's address"}`,
    scope: e.hidden.scopeText,
    assumptions: [
      `This estimate was priced on JobFlex by the homeowner on ${e.at.slice(0, 10)}: ${estimateWords(e)} Priced at JobFlex's default catalog × the local index (${e.cityFactor}); your own rates apply once you re-price. ${e.basis === "solar" ? "The roof was read from aerial data, not measured" : "The roof size came from the home's square footage"} — measure before you sign.`,
      ...e.hidden.assumptions,
    ],
  };
}
