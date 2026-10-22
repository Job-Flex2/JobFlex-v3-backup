// THE USES ON A PLAN CARD'S ROW (owner, 2026-10-21): every standard plan has
// every estimator and every page, what differs is how much of each a month —
// so the card says the amount before the thing: "20/mo · Roof estimator",
// "3 · Workers management", "Unlimited · Calendar". The amount is the
// plan's own cap (PricingPlan.limitsJson, lib/planLimits), read off the row's
// wording; a row that names no metered thing (Financials, Messages…) prints
// as before, and one that already carries its number ("Up to 3 users") too.
//
// Client-safe, pure: the landing's pricing, signup step 3, the upgrade pages
// and the phone's all call this with the plan's limits.
//
// One cap serves several rows. Smart Proposal, the roof, fence, video and
// blueprint estimators share `estimatorUses`, so each of those rows prints
// the same number — it is one pool, not five. HVAC has its own key. Lawn and
// the design studio are not metered yet (no key): "Unlimited" until a key
// exists and the owner sets a cap. Deck Studio is no plan's resource at all —
// the trial's, then the $49/mo add-on (owner-locked 2026-10-20, lib/editions):
// a row naming it never gets an amount (getPlanCatalog drops such rows too).

import { LIMIT_DEFS, isUnlimited, type LimitKey, type PlanLimits } from "@/lib/planLimits";

const RULES: ReadonlyArray<{ match: RegExp; key: LimitKey | null }> = [
  { match: /smart proposal/i, key: "estimatorUses" },
  { match: /roof estimator/i, key: "estimatorUses" },
  { match: /fence estimator/i, key: "estimatorUses" },
  { match: /video estimator/i, key: "estimatorUses" },
  { match: /blueprint/i, key: "estimatorUses" },
  { match: /hvac estimator/i, key: "hvacEstimates" },
  { match: /lawn/i, key: null },
  { match: /design studio/i, key: null },
  { match: /proposal management/i, key: "proposalsCreated" },
  { match: /client management/i, key: "clients" },
  { match: /^calendar/i, key: "calendarEvents" },
  { match: /workers management/i, key: "workers" },
  { match: /free leads|^leads\b/i, key: "leads" },
  { match: /ai phone answering|ai desk|receptionist/i, key: "aiPhoneCalls" },
  { match: /^messages/i, key: "messagesSent" },
  { match: /review requests/i, key: "reviewRequests" },
];

/** A row naming Deck Studio / the Deck estimator — no plan's resource (lib/editions). */
export const DECK_ROW = /\bdeck (estimator|studio)\b/i;

export interface RowUsage {
  /** "20/mo" · "3" · "Unlimited" */
  words: string;
  unlimited: boolean;
  key: LimitKey | null;
}

/** The amount a plan's row carries, or null when the row names nothing metered (or carries its own number). */
export function rowUsage(row: string, limits: PlanLimits | null | undefined): RowUsage | null {
  const r = row.trim();
  if (!r || /^(\d|up to\b|unlimited\b|everything in\b)/i.test(r)) return null;
  if (DECK_ROW.test(r)) return null;
  const rule = RULES.find((x) => x.match.test(r));
  if (!rule) return null;
  const cap = rule.key ? limits?.[rule.key] : undefined;
  if (rule.key === null || isUnlimited(cap)) return { words: "Unlimited", unlimited: true, key: rule.key };
  const scope = LIMIT_DEFS.find((d) => d.key === rule.key)?.scope ?? "monthly";
  return { words: scope === "monthly" ? `${cap}/mo` : `${cap}`, unlimited: false, key: rule.key };
}
