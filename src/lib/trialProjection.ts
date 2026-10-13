// WHAT THE FREE TRIALS ARE LIKELY TO BRING EACH MONTH (owner, 2026-10-05:
// "where the signup total is, add projected revenue from the free trials per
// month — make it smart"). Pure: the server reads the rows
// (actions/trafficDashboard getSignupLedger), this decides what they mean.
//
// A trial is worth its plan's MONTHLY price — the monthly or the yearly price
// it was started on, a yearly one divided by twelve, a custom plan by the
// pages it picked — times the chance it pays. The chance comes from what the
// account has done, strongest signal first:
//
//   card on file   a card-less trial that added a card converts on its own
//                  on day 8 unless the owner cancels — 90 %;
//   trial over     the trial ended with no card; a card can still restart
//                  it, but rarely does — 5 %;
//   working        made a proposal, or three records (clients, jobs, leads),
//                  or used the app on three different days — 45 %;
//   trying         made something, or came back on a second day, or opened
//                  ten screens — 20 %;
//   just started   under a day old with nothing yet: too early to tell — 15 %;
//   quiet          a day or more and nothing done — 6 %.
//
// Those are starting points for a card-less B2B trial, not facts about
// JobFlex. As trials finish, the shop's own record takes over: every
// card-less trial that ended either added a card (or restarted with one) or
// lapsed, and that rate — pulled toward the 20 % starting point by five
// imaginary trials so two lucky signups cannot triple the forecast — scales
// every tier between the two certain ones. The panel prints both numbers.
//
// List prices: a promo code or a referral discount is not taken off.

export type TrialTier = "card" | "working" | "trying" | "new" | "quiet" | "canceling" | "over";
export const TRIAL_TIERS: readonly TrialTier[] = ["card", "working", "trying", "new", "quiet", "canceling", "over"];

// "canceling" (owner, 2026-10-12): the shop pressed Cancel during the trial — it ends with the trial and nothing is
// charged unless they resume, card or no card; counted like a trial that is over.
export const TIER_CHANCE: Record<TrialTier, number> = { card: 0.9, working: 0.45, trying: 0.2, new: 0.15, quiet: 0.06, canceling: 0.05, over: 0.05 };
/** What the panel calls each tier — plain words about the trial, no billing
 *  talk (owner, 2026-10-05: "just revenue from the trials"). */
export const TIER_LABEL: Record<TrialTier, string> = {
  card: "ready to pay",
  working: "working in the app",
  trying: "trying it",
  new: "just started",
  quiet: "quiet so far",
  canceling: "set to cancel",
  over: "trial ended",
};

/** The average starting chance of a card-less trial, and how many imaginary trials hold the shop's own rate to it. */
export const PRIOR_RATE = 0.2;
export const PRIOR_WEIGHT = 5;
/** The calibrated chance of an uncertain tier never goes past this. */
const CHANCE_CAP = 0.85;

/** What one trial account has done. */
export interface TrialSignals {
  /** A card was added during a card-less trial (it converts by itself). */
  hasCard: boolean;
  /** The trial is over without a card (ended, or its end has passed). */
  over: boolean;
  /** Set to cancel when the trial ends (the owner pressed Cancel; Resume undoes it). */
  canceling?: boolean;
  /** Hours since the account was made. */
  ageHours: number;
  proposals: number;
  /** Clients, jobs and leads made. */
  records: number;
  /** Different days with a screen opened. */
  activeDays: number;
  /** Screens opened. */
  views: number;
}

export function trialTier(s: TrialSignals): TrialTier {
  // Before the card: a card on file is not charged once the trial is set to cancel.
  if (s.canceling) return "canceling";
  if (s.hasCard) return "card";
  if (s.over) return "over";
  if (s.proposals >= 1 || s.records >= 3 || s.activeDays >= 3) return "working";
  if (s.records >= 1 || s.activeDays >= 2 || s.views >= 10) return "trying";
  if (s.ageHours < 24) return "new";
  return "quiet";
}

/** Card-less trials that finished: added a card (or restarted with one), or lapsed. */
export interface TrialHistory {
  converted: number;
  lapsed: number;
}

export interface TrialCalibration {
  /** What the shop's finished trials did; null with none finished yet. */
  observedRate: number | null;
  finished: number;
  /** The rate after pulling it toward the starting point. */
  blendedRate: number;
  /** What every uncertain tier is multiplied by. */
  factor: number;
}

export function calibrate(h: TrialHistory): TrialCalibration {
  const converted = Math.max(0, Math.floor(h.converted || 0));
  const finished = converted + Math.max(0, Math.floor(h.lapsed || 0));
  const blendedRate = (converted + PRIOR_WEIGHT * PRIOR_RATE) / (finished + PRIOR_WEIGHT);
  const factor = Math.min(2.5, Math.max(0.4, blendedRate / PRIOR_RATE));
  return { observedRate: finished > 0 ? converted / finished : null, finished, blendedRate, factor };
}

/** The chance one trial pays: the tier's starting chance, scaled by the shop's record where the tier is uncertain. */
export function trialChance(tier: TrialTier, factor = 1): number {
  const base = TIER_CHANCE[tier];
  if (tier === "card" || tier === "over" || tier === "canceling") return base;
  return Math.min(CHANCE_CAP, Math.round(base * factor * 1000) / 1000);
}

/** A price, as it bills per month: a yearly price is a twelfth. */
export function monthlyCents(amountCents: number, interval: string): number {
  return String(interval).toUpperCase() === "YEAR" ? Math.round(amountCents / 12) : amountCents;
}

export interface TrialValue {
  /** The plan's monthly value; null when no price could be found for it. */
  monthlyCents: number | null;
  tier: TrialTier;
  chance: number;
  /** monthlyCents × chance, rounded to the cent. */
  expectedCents: number;
}

export function valueTrial(monthly: number | null, tier: TrialTier, factor = 1): TrialValue {
  const chance = trialChance(tier, factor);
  return { monthlyCents: monthly, tier, chance, expectedCents: monthly === null ? 0 : Math.round(monthly * chance) };
}

export interface TrialProjection {
  /** The monthly revenue the trials are likely to bring. */
  expectedCents: number;
  /** If every trial paid. */
  maxCents: number;
  trials: number;
  /** Trials with no price found — counted, not valued. */
  unpriced: number;
  /** The trials by tier: how many, and what they are likely to bring. */
  byTier: Record<TrialTier, { count: number; expectedCents: number }>;
  calibration: TrialCalibration;
  /** The paying accounts of the span at list price, per month. */
  payingCents: number;
  paying: number;
}

export function projectTrials(trials: readonly TrialValue[], calibration: TrialCalibration, payingMonthly: ReadonlyArray<number | null>): TrialProjection {
  const byTier = Object.fromEntries(TRIAL_TIERS.map((t) => [t, { count: 0, expectedCents: 0 }])) as TrialProjection["byTier"];
  let expectedCents = 0;
  let maxCents = 0;
  let unpriced = 0;
  for (const t of trials) {
    byTier[t.tier].count += 1;
    byTier[t.tier].expectedCents += t.expectedCents;
    expectedCents += t.expectedCents;
    if (t.monthlyCents === null) unpriced += 1;
    else maxCents += t.monthlyCents;
  }
  return {
    expectedCents,
    maxCents,
    trials: trials.length,
    unpriced,
    byTier,
    calibration,
    payingCents: payingMonthly.reduce<number>((a, c) => a + (c ?? 0), 0),
    paying: payingMonthly.length,
  };
}

/** "$1,234" — whole dollars; cents only under ten dollars. */
export function dollars(cents: number): string {
  const d = cents / 100;
  return `$${d.toLocaleString("en-US", { maximumFractionDigits: d > 0 && d < 10 ? 2 : 0, minimumFractionDigits: 0 })}`;
}
