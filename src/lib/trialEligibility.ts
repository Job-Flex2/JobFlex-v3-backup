import "server-only";
// ONE FREE TRIAL PER COMPANY (owner, 2026-10-12).
//
// A company that has ever had a subscription — in any status, paid, trialing,
// cancelled, ended for non-payment, granted by support — or a card-less trial,
// pays at once when it buys a plan again: no trial_period_days on its
// checkout, and no surface promises it a trial. Until this rule a cancelled
// shop (or one cancelled for not paying) got the catalog's trial again on
// every "Restart subscription" (api/checkout/subscription).
//
// Read from what lasts, never from the mirror's current state alone: a comp
// clears externalSubId on purpose and keeps the customer; a card-less trial
// keeps its record (lib/trialState) after it ends; a grant keeps its record
// (lib/planGrant); a client with a partner attribution has subscribed before.
import { db } from "@/lib/db";
import { cardlessKey } from "@/lib/trialState";
import { planGrantKey } from "@/lib/planGrant";

/** The statuses only a subscription that existed can be in. */
const HAD = new Set(["TRIALING", "ACTIVE", "PAST_DUE", "UNPAID", "CANCELED", "EXPIRED", "TRIAL_ENDED"]);

/** True when the company has had a subscription or a trial before. */
export async function hadSubscription(organizationId: string): Promise<boolean> {
  const [sub, records, attribution] = await Promise.all([
    db.subscription.findUnique({
      where: { organizationId },
      select: { status: true, externalSubId: true, externalCustomerId: true, trialEndsAt: true, currentPeriodEnd: true, provider: true },
    }),
    db.syncState.count({ where: { key: { in: [cardlessKey(organizationId), planGrantKey(organizationId)] } } }),
    db.attribution.count({ where: { organizationId } }),
  ]);
  if (records > 0 || attribution > 0) return true;
  if (!sub) return false;
  return Boolean(
    sub.externalSubId ||
      sub.externalCustomerId ||
      sub.trialEndsAt ||
      sub.currentPeriodEnd ||
      sub.provider === "MANUAL" ||
      HAD.has(String(sub.status).toUpperCase()),
  );
}

/** The trial a checkout may carry: the plan's days for a first subscription, none after. */
export async function trialDaysFor(organizationId: string, planTrialDays: number): Promise<number> {
  if (!planTrialDays) return 0;
  return (await hadSubscription(organizationId)) ? 0 : planTrialDays;
}
