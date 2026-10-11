/* The server-side Meta events of a signup's life (2026-09-09):
   CompleteRegistration when the organization is created (signupCheckout),
   StartTrial when Stripe's checkout comes back trialing (the return or the
   webhook, whichever finds the organization first), Purchase and — since
   2026-10-01 — Subscribe on the first paid invoice, i.e. the first charge
   after the trial. A flag is set only once Meta has accepted the event. All three read the person from what the signup wrote
   on the organization (Organization.metaSignupJson) and its landing
   attribution, and each carries an event_id the browser's copy shares. */

import type Stripe from "stripe";
import { db } from "@/lib/db";
import { parseMetaSignup, sendMetaEvent, type MetaEvent, type MetaSignupContext } from "@/lib/metaCapi";
import { invoiceSubscriptionId } from "@/lib/stripeCompat";

type OrgRow = {
  id: string;
  billingEmail: string | null;
  phone: string | null;
  landingIndustry: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  metaSignupJson: string | null;
};

const ORG_SELECT = {
  id: true, billingEmail: true, phone: true, landingIndustry: true,
  utmSource: true, utmMedium: true, utmCampaign: true, utmContent: true, metaSignupJson: true,
} as const;

function eventFor(org: OrgRow, ctx: MetaSignupContext, base: Pick<MetaEvent, "eventName" | "eventId" | "value" | "currency"> & { custom?: MetaEvent["custom"] }): MetaEvent {
  return {
    ...base,
    sourceUrl: ctx.sourceUrl ?? null,
    consent: ctx.consent,
    user: {
      email: org.billingEmail,
      phone: org.phone,
      fbp: ctx.fbp ?? null,
      fbc: ctx.fbc ?? null,
      clientIp: ctx.clientIp ?? null,
      userAgent: ctx.userAgent ?? null,
      externalId: org.id,
    },
    custom: {
      industry: org.landingIndustry ?? "default",
      utm_source: org.utmSource,
      utm_medium: org.utmMedium,
      utm_campaign: org.utmCampaign,
      utm_content: org.utmContent,
      ...(ctx.signupMode ? { signup_mode: ctx.signupMode } : {}),
      ...(base.custom ?? {}),
    },
  };
}

/** InitiateCheckout when the owner of a card-less trial opens the card form
 *  (/api/billing/trial-card) — the browser fires the same id. During the
 *  trial it is the card that will be charged on day 8; after it, the plan's
 *  first charge. */
export async function metaTrialCardCheckout(organizationId: string, eventId: string, purpose: "trial-card" | "trial-restart"): Promise<void> {
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: ORG_SELECT });
  const ctx = org ? parseMetaSignup(org.metaSignupJson) : null;
  if (!org || !ctx) return;
  const plan = (await db.subscription.findUnique({ where: { organizationId }, select: { plan: true } }).catch(() => null))?.plan;
  await sendMetaEvent(
    eventFor(org, ctx, {
      eventName: "InitiateCheckout",
      eventId,
      custom: { content_category: purpose, plan: plan ?? "none" },
    }),
  );
}

/** Stripe's checkout came back for a subscription: StartTrial when it is trialing. */
export async function metaOnCheckoutCompleted(session: Stripe.Checkout.Session, sub: Stripe.Subscription): Promise<void> {
  if (sub.status !== "trialing") return;
  const mirror = await db.subscription.findFirst({ where: { externalSubId: sub.id }, select: { organizationId: true, plan: true } });
  // No mirror yet: the webhook beat the browser's return, and the organization
  // does not exist. The return (completePendingSignup) sends it instead.
  if (!mirror) return;
  await metaStartTrial(mirror.organizationId, sub, {
    amountTotal: session.amount_total,
    currency: session.currency,
    plan: mirror.plan,
  });
}

/** StartTrial, once per organization. Called from BOTH ends of the checkout —
 *  the return from Stripe, which creates the organization, and the webhook,
 *  which can arrive before it (and then finds nothing to name). Same event_id
 *  either way, `<subscription>:trial`, so a pair that raced is one event to Meta. */
export async function metaStartTrial(
  organizationId: string,
  sub: Stripe.Subscription,
  checkout: { amountTotal: number | null | undefined; currency: string | null | undefined; plan?: string | null },
): Promise<void> {
  if (sub.status !== "trialing") return;
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: ORG_SELECT });
  const ctx = org ? parseMetaSignup(org.metaSignupJson) : null;
  if (!org || !ctx || ctx.trialSentAt) return;
  // The mirror's plan, as the webhook's copy reads it, when the caller has none.
  const plan =
    checkout.plan ??
    (await db.subscription.findUnique({ where: { organizationId }, select: { plan: true } }).catch(() => null))?.plan;
  const amount = checkout.amountTotal != null ? checkout.amountTotal / 100 : undefined;
  const sent = await sendMetaEvent(
    eventFor(org, ctx, {
      eventName: "StartTrial",
      eventId: `${sub.id}:trial`,
      value: amount,
      currency: checkout.currency?.toUpperCase() ?? "USD",
      custom: { plan: plan ?? "none", predicted_ltv: amount },
    }),
  );
  if (!sent) return;
  await db.organization.update({
    where: { id: org.id },
    data: { metaSignupJson: JSON.stringify({ ...ctx, trialSentAt: new Date().toISOString() }) },
  }).catch(() => {});
}

/** The first paid invoice of a subscription is the Purchase; renewals are not.
 *  The same invoice is the Subscribe (2026-10-01): the trial has turned into
 *  a paying subscription. Server only, its own id `<invoice>:subscribe`, its
 *  own flag; it goes only with the first Purchase, so a subscription whose
 *  Purchase went before Subscribe existed never sends one on a renewal. */
export async function metaOnInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
  if (!invoice.amount_paid || invoice.amount_paid <= 0) return;
  const subId = invoiceSubscriptionId(invoice);
  if (!subId) return;
  const mirror = await db.subscription.findFirst({ where: { externalSubId: subId }, select: { organizationId: true, plan: true } });
  if (!mirror) return;
  const org = await db.organization.findUnique({ where: { id: mirror.organizationId }, select: ORG_SELECT });
  const ctx = org ? parseMetaSignup(org.metaSignupJson) : null;
  if (!org || !ctx || ctx.purchaseSentAt) return;
  const value = invoice.amount_paid / 100;
  const currency = invoice.currency.toUpperCase();
  const [sent, subscribed] = await Promise.all([
    sendMetaEvent(
      eventFor(org, ctx, {
        eventName: "Purchase",
        eventId: invoice.id,
        value,
        currency,
        custom: { plan: mirror.plan },
      }),
    ),
    ctx.subscribeSentAt
      ? Promise.resolve(false)
      : sendMetaEvent(
          eventFor(org, ctx, {
            eventName: "Subscribe",
            eventId: `${invoice.id}:subscribe`,
            value,
            currency,
            custom: { plan: mirror.plan, predicted_ltv: value, subscription_id: subId },
          }),
        ),
  ]);
  if (!sent && !subscribed) return;
  const now = new Date().toISOString();
  await db.organization.update({
    where: { id: org.id },
    data: {
      metaSignupJson: JSON.stringify({
        ...ctx,
        ...(sent ? { purchaseSentAt: now } : {}),
        ...(subscribed ? { subscribeSentAt: now } : {}),
      }),
    },
  }).catch(() => {});
}
