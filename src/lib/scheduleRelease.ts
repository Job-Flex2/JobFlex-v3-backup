// A SUBSCRIPTION SCHEDULE LET GO (2026-10-12). Stripe refuses a cancel (at the
// period end) on a subscription a schedule holds; a schedule left on a
// cancelled subscription is clutter. Its own module, free of app imports, so
// every place that cancels — the owner, support, a replaced checkout, a
// deleted account — can call it without import cycles (lib/planChange books
// the schedules).
import type Stripe from "stripe";

/**
 * ANY schedule Stripe holds on this subscription, released — ours or one made
 * elsewhere (the dashboard, a half-done booking). Run before every cancel and
 * every immediate cancel: a scheduled subscription refuses cancel_at_period_end.
 * Returns the released schedule's id, or null when there was none.
 */
export async function releaseAttachedSchedule(stripe: Stripe, subId: string): Promise<string | null> {
  const sub = await stripe.subscriptions.retrieve(subId);
  const id = typeof sub.schedule === "string" ? sub.schedule : sub.schedule?.id;
  if (!id) return null;
  const schedule = await stripe.subscriptionSchedules.retrieve(id);
  if (schedule.status === "active" || schedule.status === "not_started") await stripe.subscriptionSchedules.release(id);
  return id;
}
