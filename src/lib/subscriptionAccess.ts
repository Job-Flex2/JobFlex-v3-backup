import { cache } from "react";
import type { Subscription } from "@prisma/client";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { planLapsed } from "@/lib/planStatus";

/** A grant's explicit null means no expiry, not "fall back to the old trial".
 * Legacy rows without recorded terms retain their dates: absence is not a grant. */
export function applyGrantTerms<T extends Subscription>(sub: T, cursor: string | null): T {
  if (sub.provider !== "MANUAL" || sub.status !== "ACTIVE" || sub.externalSubId || !cursor) return sub;
  try {
    const grant = JSON.parse(cursor) as { plan?: unknown; endsAt?: unknown };
    if (grant.plan !== sub.plan) return sub;
    if (grant.endsAt === null) return { ...sub, currentPeriodEnd: null, trialEndsAt: null };
    if (typeof grant.endsAt === "string" && Number.isFinite(Date.parse(grant.endsAt))) {
      return { ...sub, currentPeriodEnd: new Date(grant.endsAt), trialEndsAt: null };
    }
  } catch { /* Invalid terms must not open an expired plan. */ }
  return sub;
}

/** Read and reconcile only this existing Stripe subscription. No payment,
 * checkout, restart or changes to Stripe. A concurrent plan change wins. */
export async function refreshSubscriptionAccess(sub: Subscription): Promise<Stripe.Subscription | null> {
  if (sub.provider !== "STRIPE" || !sub.externalSubId || !sub.externalCustomerId) return null;
  const { getStripeClient } = await import("@/lib/sdk/stripe");
  const { stripe } = await getStripeClient();
  const live = await stripe.subscriptions.retrieve(sub.externalSubId, {}, { timeout: 5000, maxNetworkRetries: 0 });
  const customer = typeof live.customer === "string" ? live.customer : live.customer.id;
  if (live.id !== sub.externalSubId || customer !== sub.externalCustomerId ||
      (live.metadata.organizationId && live.metadata.organizationId !== sub.organizationId)) {
    throw new Error("Subscription ownership could not be verified.");
  }
  const { mirrorPeriodEnd, mirrorStatusFor } = await import("@/lib/stripeStatus");
  await db.subscription.updateMany({
    where: { id: sub.id, provider: "STRIPE", externalSubId: sub.externalSubId, updatedAt: sub.updatedAt },
    data: {
      status: mirrorStatusFor(live),
      currentPeriodEnd: mirrorPeriodEnd(live),
      trialEndsAt: live.status === "trialing" && live.trial_end ? new Date(live.trial_end * 1000) : null,
      canceledAt: live.canceled_at ? new Date(live.canceled_at * 1000) : null,
    },
  });
  return live;
}

/** One effective row for the page gate, feature tier and quotas. Deduplicated
 * within a server render; Stripe is consulted only before lapsing a live row. */
export const readAccessSubscription = cache(async (organizationId: string) => {
  let sub = await db.subscription.findUnique({ where: { organizationId } });
  if (!sub) return null;
  if (sub.provider === "MANUAL" && sub.status === "ACTIVE") {
    const grant = await db.syncState.findUnique({ where: { key: `planGrant:${organizationId}` } });
    return applyGrantTerms(sub, grant?.cursor ?? null);
  }
  if (sub.provider === "STRIPE" && ["ACTIVE", "TRIALING", "PAST_DUE"].includes(sub.status) && planLapsed(sub)) {
    try {
      await refreshSubscriptionAccess(sub);
      sub = await db.subscription.findUnique({ where: { organizationId } });
    } catch {
      // Keep the last known state when billing is unavailable. Recovery UI
      // offers a fresh check rather than silently granting access.
      console.warn("[subscription-access] Could not verify a stale subscription.");
    }
  }
  return sub;
});
