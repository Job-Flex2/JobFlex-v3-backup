// THE MIRROR'S STATUS FOR A STRIPE SUBSCRIPTION — one answer for every path
// that writes or compares Subscription.status from Stripe (owner, 2026-10-07):
// the webhook and the reconcile cron (lib/stripeSync), the admin's "Sync from
// Stripe" (actions/adminUsers), the admin's subscription editor
// (lib/subscriptionEditor) and its syncing mark (lib/planGrant). Each of them
// had its own copy of the switch below, and the admin sync's knew nothing of
// the card-less trial: it rewrote TRIAL_ENDED as CANCELED, which dropped the
// "Trial ended" ribbon, lifted the write lock and lost the way back through
// "Add a card".
//
// No database, no client: the functions read the subscription alone.
import type Stripe from "stripe";
import { SubscriptionStatus } from "@/lib/prismaEnums";
import { FREE_SWITCH_META } from "@/lib/freePlan";
import { subscriptionPeriodEndDate } from "@/lib/stripeCompat";

function mapStripeStatus(s: Stripe.Subscription.Status): string {
  switch (s) {
    case "active":
      return SubscriptionStatus.ACTIVE;
    case "trialing":
      return SubscriptionStatus.TRIALING;
    case "past_due":
      return SubscriptionStatus.PAST_DUE;
    // Retries exhausted, subscription kept: the features close (lib/planStatus).
    case "unpaid":
      return SubscriptionStatus.UNPAID;
    case "canceled":
    case "incomplete_expired":
      return SubscriptionStatus.CANCELED;
    default:
      return SubscriptionStatus.PAST_DUE; // incomplete / paused — not yet active
  }
}

/* A CARD-LESS TRIAL THAT RAN OUT (2026-10-01). The trial is created with
   trial_settings.end_behavior.missing_payment_method = "cancel" and marked
   jf_cardless (lib/cardlessTrial), so Stripe cancels it at the trial's end
   when no card arrived. That cancellation is not a customer leaving: the
   mirror says TRIAL_ENDED (lib/trialState) — the workspace reads, nothing
   writes, and a card restarts the plan — instead of CANCELED.
   A trial the owner CANCELLED is not one (owner, 2026-10-13): it ends on
   the same day for the same lack of a card, but it was asked to — the
   company moves to the Free plan (lib/freePlan), not to the trial lock. */
export function isCardlessTrialLapse(sub: Stripe.Subscription): boolean {
  if (sub.status !== "canceled" || sub.metadata?.jf_cardless !== "1" || !sub.trial_end) return false;
  if (sub.cancel_at_period_end || sub.metadata?.[FREE_SWITCH_META] === "1") return false;
  const ended = sub.ended_at ?? sub.canceled_at ?? 0;
  return ended >= sub.trial_end - 60 * 60 && !sub.default_payment_method;
}

/** The mirror's status for a subscription. */
export function mirrorStatusFor(sub: Stripe.Subscription): string {
  return isCardlessTrialLapse(sub) ? SubscriptionStatus.TRIAL_ENDED : mapStripeStatus(sub.status);
}

/** The mirror's currentPeriodEnd: for an ENDED subscription, the moment it
 *  ended — the day the company moved to the Free plan (lib/freePlan), which
 *  an immediate cancel puts before the period's end — else the period's end. */
export function mirrorPeriodEnd(sub: Stripe.Subscription): Date | null {
  if ((sub.status === "canceled" || sub.status === "incomplete_expired") && sub.ended_at) return new Date(sub.ended_at * 1000);
  return subscriptionPeriodEndDate(sub);
}
