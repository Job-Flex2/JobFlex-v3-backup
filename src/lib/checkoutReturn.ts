// THE PLAN CHECKOUT'S RETURN LEG — processed ONCE (owner, 2026-10-06).
//
// /dashboard/upgrade?session_id=… (and its handheld twin /mobile-upgrade-v1)
// record a paid plan change themselves, because the customer lands back
// before the webhook does (and in the sandbox the live webhook never sees the
// event). Until this file the return was re-run on every visit of the URL,
// and for the custom plan it re-wrote the org's pages FROM THE SESSION: a
// shop that removed pages (Stripe down to $20) could open its old success
// link and get all of them back. The audit did exactly that.
//
// Now:
//   · a session is claimed once, atomically, in SyncState
//     `checkoutReturn:<sessionId>` — the second visit changes nothing;
//   · it is applied only while its subscription is live (active / trialing);
//   · a custom plan's pages are read from the SUBSCRIPTION (metadata that
//     lib/customBilling keeps current), checked against the page quantity it
//     bills — never from the session alone.

import type Stripe from "stripe";
import { db } from "@/lib/db";
import { getStripeClient } from "@/lib/sdk/stripe";
import { subscriptionPeriodEndDate } from "@/lib/stripeCompat";
import { SubscriptionStatus } from "@/lib/prismaEnums";
import { CUSTOM_PLAN_SLUG, normalizeCustomPages } from "@/lib/customPlan";
import { billedPageCount, writeOrgPages } from "@/lib/customBilling";
import { recordPlanChange } from "@/lib/subscriptionRecord";
import { releaseAttachedSchedule } from "@/lib/scheduleRelease";
import { mirrorDeckAddon } from "@/lib/deckAddonBilling";

const claimKey = (sessionId: string) => `checkoutReturn:${sessionId}`;

/**
 * THE SUBSCRIPTION A PLAN CHECKOUT REPLACES ENDS — from the return page AND
 * from the webhook (owner, 2026-10-12). The checkout route names it in the
 * session's `replacesSubId`; until this was also run by
 * checkout.session.completed, a customer who paid and closed the tab before
 * Stripe sent them back kept BOTH subscriptions billing. Idempotent: an
 * already-ended subscription is left alone, so whichever leg comes second
 * does nothing. Never cancels the subscription the session itself made, and
 * only one the same organisation's checkout named.
 */
export async function cancelReplacedSubscription(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
  newSubId: string,
  tag = "checkout",
): Promise<"canceled" | "already-ended" | "none"> {
  const replaces = (session.metadata?.replacesSubId as string | undefined) || null;
  if (!replaces || replaces === newSubId) return "none";
  try {
    const old = await stripe.subscriptions.retrieve(replaces);
    if (old.status === "canceled" || old.status === "incomplete_expired") return "already-ended";
    const org = session.metadata?.organizationId;
    if (org && old.metadata?.organizationId && old.metadata.organizationId !== org) {
      console.warn(`[${tag}] replaced subscription ${replaces} belongs to another organization — left alone`);
      return "none";
    }
    await releaseAttachedSchedule(stripe, replaces).catch(() => null);
    await stripe.subscriptions.cancel(replaces, { prorate: false, invoice_now: false });
    return "canceled";
  } catch (err) {
    console.warn(`[${tag}] could not cancel replaced subscription ${replaces}:`, err);
    return "none";
  }
}

/** True the first time a session is claimed; false on every later visit. */
async function claimSession(sessionId: string, organizationId: string): Promise<boolean> {
  try {
    await db.syncState.create({ data: { key: claimKey(sessionId), cursor: organizationId } });
    return true;
  } catch {
    return false;
  }
}

function pagesOf(list: string | null | undefined): string[] {
  return normalizeCustomPages(String(list ?? "").split(",").filter(Boolean));
}

/**
 * Verify a checkout return and record the plan change, once. Returns the new
 * plan slug, or null when the session is not this org's, not paid, already
 * processed, or its subscription is no longer live.
 */
export async function applyCheckoutReturn(organizationId: string, sessionId: string, tag = "upgrade"): Promise<string | null> {
  try {
    const { stripe } = await getStripeClient();
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["subscription"] });
    if (session.metadata?.organizationId !== organizationId) return null;
    const paid = session.status === "complete" || session.payment_status === "paid";
    if (!paid) return null;
    const planSlug = (session.metadata?.planSlug as string | undefined) ?? null;
    if (!planSlug) return null;
    const sub = session.subscription;
    if (!sub || typeof sub === "string") return null;
    if (sub.status !== "active" && sub.status !== "trialing") return null;
    if (!(await claimSession(session.id, organizationId))) return null;

    const trialEnd = sub.trial_end ? new Date(sub.trial_end * 1000) : null;
    const periodEnd = subscriptionPeriodEndDate(sub);
    const customerId = typeof session.customer === "string" ? session.customer : null;
    // Canonical enum casing: the limits engine treated the old lowercase
    // "active"/"trialing" as LAPSED (free quotas for a paying customer).
    const status = trialEnd ? SubscriptionStatus.TRIALING : SubscriptionStatus.ACTIVE;
    /* THE OLD SUBSCRIPTION ENDS HERE. The checkout route names the one this
       purchase replaces (a plan switch); it is cancelled at once, so the org
       never bills twice. Best-effort: a failure here leaves the old sub for
       the admin's reconcile, it never blocks the change that was paid for. */
    await cancelReplacedSubscription(stripe, session, sub.id, tag);
    // A custom plan's pages: what the subscription bills, by its own record.
    if (planSlug === CUSTOM_PLAN_SLUG) {
      const qty = billedPageCount(sub);
      const fromSub = pagesOf(sub.metadata?.customPages);
      const fromSession = pagesOf(session.metadata?.customPages);
      const pages = fromSub.length === qty ? fromSub : fromSession.length === qty ? fromSession : fromSub.slice(0, qty);
      await writeOrgPages(organizationId, pages);
    }
    const recorded = await recordPlanChange({ organizationId, planSlug, status, customerId, subId: sub.id, trialEnd, periodEnd });
    // The Deck Studio add-on, ticked on the plan card or switched on on Stripe's page (lib/deckAddonBilling).
    await mirrorDeckAddon(sub, false, organizationId).catch((err) => console.warn(`[${tag}] deck add-on mirror:`, err));
    return recorded;
  } catch (err) {
    console.warn(`[${tag}] checkout verify failed:`, err);
    return null;
  }
}
