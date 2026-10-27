// THE CARD-LESS TRIAL'S OWN CEILINGS (owner, 2026-10-02) — client-safe.
//
// A trial that asks for no card is a trial anybody can take, and some of the
// app's buttons spend our money with a third party on every press (the map in
// lib/paidApiCosts). So while an organization is on a card-less trial WITH NO
// CARD ON FILE, the paid features run under fixed ceilings of their own,
// whatever plan the trial was started on. A card added during the trial
// lifts them: the plan's own limits apply from that moment. A trial that has
// ended with no card gets none of them (the workspace is read-only too —
// lib/trialLock). The counting and the refusal live in lib/trialMeter.
//
// A ceiling counts ACTIONS a person takes, not requests underneath: one
// "Measure this roof" is one roof measurement however many calls it makes.

export type TrialCapKey =
  | "roofMeasurements"
  | "fenceLookups"
  | "hvacLookups"
  | "aiCalls"
  | "eagleViewOrders"
  | "hvacReports"
  | "smsOutbound"
  | "phoneNumbers";

/**
 * THE NUMBERS — one place. What one use costs us (list price, lib/paidApiCosts)
 * is beside each; the worst case per trial at these numbers is about $13 plus
 * three EagleView roofs at $2.40 each.
 */
export const TRIAL_CAPS: Readonly<Record<TrialCapKey, number>> = {
  /** "Measure this roof" on a new address (an EagleView Instant order — pack
   *  001, contract price — plus Google Solar ~$0.09 and parcels ≤$0.45), or a
   *  Solar "Free estimate" (~$0.10–0.55). Re-opening an address the shop
   *  already measured is free and does not count. */
  roofMeasurements: 3,
  /** A fence-estimator address: ReportAll $0.125 a parcel (up to 9 with the
   *  neighbours sweep, ~$1.10) and Regrid $0.10. The same point twice counts once. */
  fenceLookups: 3,
  /** An HVAC-estimator site lookup: geocoding $0.005, ReportAll $0.125, Regrid
   *  up to $0.20 (~$0.35). */
  hvacLookups: 3,
  /** One OpenAI run: Smart estimate read / generate / refine, video read, a
   *  transcription chunk, roof or fence AI estimate, nameplate, receipt or
   *  photo read, lead scope — $0.01 to ~$0.15 each at gpt-4.1/4o; a Smart
   *  generate also prices its lines at SerpAPI (~25 searches, ~$0.40). */
  aiCalls: 10,
  /** A billed EagleView report ($24–$87) or a paid re-measure ("Re-measure —
   *  new paid lookup", ordering missing packs). */
  eagleViewOrders: 0,
  /** A Cool Calc Manual J permit report ($3–$15 a report credit). */
  hvacReports: 0,
  /** Outgoing texts (Twilio ~$0.0125 a segment), except the verification code
   *  that proves a member's own phone. There are no outgoing calls. */
  smsOutbound: 0,
  /** An own texting number ($1.15 a month, held until released). */
  phoneNumbers: 0,
};

export const TRIAL_CAP_KEYS = Object.keys(TRIAL_CAPS) as TrialCapKey[];

/** How the screens name each ceiling: [one, many]. */
export const TRIAL_CAP_NOUN: Record<TrialCapKey, [string, string]> = {
  roofMeasurements: ["roof measurement", "roof measurements"],
  fenceLookups: ["fence address lookup", "fence address lookups"],
  hvacLookups: ["HVAC site lookup", "HVAC site lookups"],
  aiCalls: ["AI run", "AI runs"],
  eagleViewOrders: ["EagleView report or paid re-measure", "EagleView reports and paid re-measures"],
  hvacReports: ["Manual J permit report", "Manual J permit reports"],
  smsOutbound: ["outgoing text", "outgoing texts"],
  phoneNumbers: ["own texting number", "own texting numbers"],
};

/** The screen's and the dialog's title. */
export const TRIAL_CAP_TITLE = "Add a card to unlock full limits";

/** "3 roof measurements" / "no outgoing texts". */
export function trialCapAllowance(key: TrialCapKey): string {
  const n = TRIAL_CAPS[key];
  const [one, many] = TRIAL_CAP_NOUN[key];
  return n === 0 ? `no ${many}` : `${n} ${n === 1 ? one : many}`;
}

/** The sentence a refused action answers with. */
export function trialCapMessage(key: TrialCapKey): string {
  const head = TRIAL_CAPS[key] === 0 ? "The free trial without a card includes" : "You've used the";
  const what = TRIAL_CAPS[key] === 0 ? `${trialCapAllowance(key)}.` : `${trialCapAllowance(key)} the free trial includes without a card.`;
  return `${head} ${what} ${TRIAL_CAP_TITLE} — nothing is charged until the trial ends.`;
}

/** Is `v` one of the ceilings (a query string, a returned payload)? */
export function isTrialCapKey(v: unknown): v is TrialCapKey {
  return typeof v === "string" && (TRIAL_CAP_KEYS as string[]).includes(v);
}

/** Where a refusal sends the browser: the card-less trial's page, which says
 *  which ceiling was reached and adds the card. */
export function trialCapHref(key: TrialCapKey): string {
  return `/dashboard/trial?cap=${key}`;
}
