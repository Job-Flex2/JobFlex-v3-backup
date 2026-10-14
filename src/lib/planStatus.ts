// WHETHER A PLAN STILL OPENS ITS FEATURES — one rule for every door
// (owner, 2026-10-07). The limits engine (quotas), the feature tier
// (lib/orgPlan, planCatalogServer.getOrgPlanContext) and the page gate
// (lib/customPageAccess) all ask this, so a cancelled shop cannot keep the
// estimators because one of them only looked at the plan's name.
//
//   · ACTIVE and PAST_DUE keep the plan until the paid period is over (plus
//     a 3-day grace for webhook lag). PAST_DUE is a failed renewal Stripe is
//     still retrying: the shop keeps working under the "Payment failed"
//     ribbon while it updates the card.
//   · TRIALING keeps it until the trial (or the period) ends.
//   · CANCELED, UNPAID (Stripe gave up retrying), EXPIRED and TRIAL_ENDED (a
//     card-less trial that ran out) close it at once. A cancellation booked
//     for the period's end is still ACTIVE/TRIALING until Stripe ends it.
//   · FREE closes it too (owner, 2026-10-14): it is the Free plan, which
//     opens nothing a cancelled company cannot (lib/freePlan) — a grant that
//     ran out onto "free" used to open the paid pages, the roof orders,
//     Cool Calc and texts. Its limits are the "free" catalog row's.
//   · No subscription is not a lapse: there is nothing to close.
//
// Database-free, so the edge of every check can call it on a row it already
// holds.

/** Tolerates renewal-webhook lag before an ACTIVE/PAST_DUE sub is treated as lapsed. */
export const LAPSE_GRACE_MS = 3 * 24 * 60 * 60 * 1000;

export type PlanStatusRow = {
  status: string;
  currentPeriodEnd: Date | null;
  trialEndsAt: Date | null;
};

/** The columns planLapsed reads, for a Prisma `select`. */
export const PLAN_STATUS_SELECT = { status: true, currentPeriodEnd: true, trialEndsAt: true } as const;

/** True when the subscription no longer opens its plan's features. */
export function planLapsed(sub: PlanStatusRow | null | undefined, now: Date = new Date()): boolean {
  if (!sub) return false;
  if (sub.status === "FREE") return true;
  const periodOver = !!sub.currentPeriodEnd && sub.currentPeriodEnd.getTime() + LAPSE_GRACE_MS < now.getTime();
  if (sub.status === "ACTIVE" || sub.status === "PAST_DUE") return periodOver;
  if (sub.status === "TRIALING") {
    const trialOver = !!sub.trialEndsAt && sub.trialEndsAt.getTime() < now.getTime();
    return trialOver || periodOver;
  }
  return true;
}
