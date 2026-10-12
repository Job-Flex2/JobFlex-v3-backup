// Member-referral conversion + reward engine (the ?ref= side of the
// attribution loop — the influencer ?promo= side lives in stripeSync.ts).
//
// Policy: each converted referral credits the REFERRER 50% of one month of
// their own current plan, as a Stripe customer-balance credit that nets against
// their upcoming subscription invoices. Two referrals → two half-month credits.
//
// Lifecycle: PENDING (signup recorded) → CONVERTED (referred org's first real
// paid invoice) → PAID (credit landed on the referrer's Stripe balance).
//
// THE CREDIT WAITS FOR THE FIRST REAL PAYMENT (owner, 2026-10-12). From
// 2026-09-02 it was paid when the referred shop's subscription STARTED — a
// card-first trial is a subscription, so a "referral" that cancelled inside
// its free week paid nothing and still earned the referrer half a month, as
// many times as anyone cared to sign up. Now nothing converts or pays until
// the referred organization has paid an invoice of more than $0: the
// invoice.paid webhook records that (`referralPaid:<conversionId>`), and the
// credit is applied from there. Credits already given are left as they were.
// CONVERTED with rewardAppliedAt=null means the credit is still owed — usually
// because the referrer has no Stripe customer yet (FREE plan). It self-heals on
// the referrer's own first invoice, and admins can retry from /admin/referrals.

import type Stripe from "stripe";
import { db } from "@/lib/db";
import { getStripeClient, isStripeEnabled } from "@/lib/sdk/stripe";
import { isStripeWriteAllowed } from "@/lib/stripeSafety";
import { PLAN_MONTHLY_USD } from "@/lib/planPricing";
import { invoiceIsPaid, invoiceSubscriptionId } from "@/lib/stripeCompat";

export const REFERRAL_REWARD_PCT = 50;

/**
 * Webhook hook (invoice.paid). Idempotent by construction: the conversion
 * updateMany matches zero rows on re-runs, and the credit is idempotency-keyed
 * per conversion. Reward failures are swallowed (retried on the next invoice /
 * from the admin screen) so a credit hiccup never 500s the webhook.
 */
export async function processReferralEffectsForInvoice(invoice: Stripe.Invoice): Promise<void> {
  // Trials produce $0 invoices — a referral only converts on real money,
  // mirroring accrueForInvoice's guard.
  if (!invoiceIsPaid(invoice) || (invoice.amount_paid ?? 0) <= 0) return;
  const subId = invoiceSubscriptionId(invoice);
  if (!subId) return;

  const mirror = await db.subscription.findFirst({
    where: { externalSubId: subId },
    select: { organizationId: true },
  });
  if (!mirror) return;
  const orgId = mirror.organizationId;

  // (a) This org was a referred signup → its first real payment converts the
  // referral, and the payment is written down for the credit's own check.
  await markReferredPaid(orgId, invoice.id ?? "invoice");
  await db.referralConversion.updateMany({
    where: { signupOrgId: orgId, status: "PENDING" },
    data: { status: "CONVERTED", convertedAt: new Date() },
  });

  // (b) Credit converted-but-unrewarded referrals this invoice makes payable:
  // the one(s) just converted above (credit goes to their referrer), plus any
  // where THIS org is the referrer — it provably has a Stripe customer now.
  const payable = await db.referralConversion.findMany({
    where: {
      status: "CONVERTED",
      rewardAppliedAt: null,
      OR: [{ signupOrgId: orgId }, { code: { organizationId: orgId } }],
    },
    select: { id: true },
  });
  for (const conversion of payable) {
    try {
      await applyReferralReward(conversion.id);
    } catch (err) {
      console.warn(`[referral] reward credit failed for conversion ${conversion.id}:`, err);
    }
  }
}

/**
 * Apply the 50%-of-one-month credit for a single CONVERTED conversion.
 * Safe to call repeatedly: rewardAppliedAt gates re-entry locally and the
 * Stripe idempotency key (`refcredit:<conversionId>`) gates it remotely.
 */
export async function applyReferralReward(
  conversionId: string
): Promise<{ applied: boolean; reason?: string }> {
  const conversion = await db.referralConversion.findUnique({
    where: { id: conversionId },
    include: { code: { select: { organizationId: true } } },
  });
  if (!conversion) return { applied: false, reason: "not-found" };
  if (conversion.status === "PENDING") return { applied: false, reason: "not-converted" };
  if (conversion.rewardAppliedAt) return { applied: false, reason: "already-applied" };
  // A credit is only ever earned by a referred ORGANIZATION that paid an
  // invoice (processReferralEffectsForInvoice stamps signupOrgId → CONVERTED).
  // Rows with no signupOrgId come from the public homeowner intake and can be
  // fabricated by anyone against any code — they must never turn into money.
  if (!conversion.signupOrgId) return { applied: false, reason: "no-signup-org" };
  // Only for a referred organization that has really paid (owner, 2026-10-12).
  if (!(await referredOrgPaid(conversion.signupOrgId))) return { applied: false, reason: "referred-not-paid" };

  const referrerOrgId = conversion.code.organizationId;
  const referrerSub = await db.subscription.findUnique({
    where: { organizationId: referrerOrgId },
    select: { externalCustomerId: true, plan: true },
  });
  if (!referrerSub?.externalCustomerId) return { applied: false, reason: "no-stripe-customer" };
  if (!isStripeEnabled()) return { applied: false, reason: "stripe-disabled" };
  // Respect the live-write safety flag without throwing — the reward simply
  // stays owed (CONVERTED) until writes are allowed or an admin retries.
  if (!isStripeWriteAllowed()) return { applied: false, reason: "stripe-writes-disabled" };

  const monthlyCents = await referrerMonthlyPriceCents(referrerSub.plan);
  if (monthlyCents <= 0) return { applied: false, reason: "no-priced-plan" };
  const rewardCents = Math.round(monthlyCents * (REFERRAL_REWARD_PCT / 100));

  // Mode-aware: the referrer's customer lives on whichever account (live or
  // sandbox) their subscription was started on; the live-only client could
  // not find a sandbox customer and every sandbox reward silently failed.
  const { stripe } = await getStripeClient();
  const txn = await stripe.customers.createBalanceTransaction(
    referrerSub.externalCustomerId,
    {
      amount: -rewardCents, // negative = credit toward future invoices
      currency: "usd", // platform bills in USD; the credit must match the customer currency
      description: `JobFlex referral reward — ${REFERRAL_REWARD_PCT}% off one month`,
    },
    { idempotencyKey: `refcredit:${conversion.id}` }
  );

  await db.referralConversion.update({
    where: { id: conversion.id },
    data: {
      status: "PAID",
      rewardCents,
      rewardAppliedAt: new Date(),
      rewardStripeTxnId: txn.id,
    },
  });
  return { applied: true };
}

// 50% of one MONTH of the referrer's plan, even for annual payers: the real
// synced monthly Stripe price when one exists, else the admin catalog price,
// else the static fallback table.
async function referrerMonthlyPriceCents(plan: string): Promise<number> {
  const priced = await db.planPrice.findFirst({
    where: { planSlug: plan.toLowerCase(), interval: "MONTH", active: true },
    select: { unitAmountCents: true },
  });
  if (priced) return priced.unitAmountCents;
  const catalogRow = await db.pricingPlan.findFirst({
    where: { slug: { in: [plan, plan.toLowerCase(), plan.toUpperCase()] } },
    select: { priceCents: true },
  });
  if (catalogRow) return catalogRow.priceCents;
  return Math.round((PLAN_MONTHLY_USD[plan.toUpperCase()] ?? 0) * 100);
}

const paidKey = (conversionId: string) => `referralPaid:${conversionId}`;

/** The referred organization paid an invoice of more than $0: written once per conversion. */
async function markReferredPaid(orgId: string, invoiceId: string): Promise<void> {
  const rows = await db.referralConversion.findMany({ where: { signupOrgId: orgId }, select: { id: true } });
  for (const r of rows) {
    await db.syncState
      .upsert({ where: { key: paidKey(r.id) }, update: {}, create: { key: paidKey(r.id), cursor: invoiceId } })
      .catch(() => {});
  }
}

/**
 * Has the referred organization paid a real invoice? The webhook's record
 * first; failing that (a conversion from before 2026-10-12, or an event this
 * deployment never saw — the sandbox), Stripe's own list of its paid invoices.
 * Read-only.
 */
export async function referredOrgPaid(orgId: string): Promise<boolean> {
  const conversions = await db.referralConversion.findMany({ where: { signupOrgId: orgId }, select: { id: true } });
  if (conversions.length) {
    const marked = await db.syncState.count({ where: { key: { in: conversions.map((c) => paidKey(c.id)) } } });
    if (marked > 0) return true;
  }
  const sub = await db.subscription.findUnique({ where: { organizationId: orgId }, select: { externalCustomerId: true } });
  if (!sub?.externalCustomerId || !isStripeEnabled()) return false;
  try {
    const { stripe } = await getStripeClient();
    const invoices = await stripe.invoices.list({ customer: sub.externalCustomerId, status: "paid", limit: 24 });
    const paid = invoices.data.find((inv) => (inv.amount_paid ?? 0) > 0);
    if (paid) await markReferredPaid(orgId, paid.id ?? "invoice");
    return Boolean(paid);
  } catch (err) {
    console.warn(`[referral] could not read paid invoices for ${orgId}:`, err);
    return false;
  }
}

/**
 * THE REFERRAL COUNTS WHEN THE REFERRED SHOP FIRST PAYS (owner, 2026-10-12;
 * it counted at the subscription's start from 2026-09-02). Called from the
 * signup return leg and, per referrer code, from the subscription page — a
 * catch-up for a payment whose webhook this deployment did not see. Until
 * the referred organization has paid more than $0 it does nothing.
 * Idempotent: the status flip matches zero rows on re-runs and the credit is
 * keyed per conversion.
 */
export async function settleReferralsForSignupOrg(orgId: string): Promise<void> {
  if (!(await referredOrgPaid(orgId))) return;
  await db.referralConversion.updateMany({
    where: { signupOrgId: orgId, status: "PENDING" },
    data: { status: "CONVERTED", convertedAt: new Date() },
  });
  const payable = await db.referralConversion.findMany({
    where: { status: "CONVERTED", rewardAppliedAt: null, signupOrgId: orgId },
    select: { id: true },
  });
  for (const c of payable) {
    try {
      await applyReferralReward(c.id);
    } catch (err) {
      console.warn(`[referral] reward credit failed for conversion ${c.id}:`, err);
    }
  }
}

/** Catch-up for one referrer's code: every PENDING conversion whose shop holds
 *  a Stripe subscription is settled — once that shop has paid. */
export async function settleReferralsForCode(codeId: string): Promise<void> {
  const pending = await db.referralConversion.findMany({
    where: { codeId, status: "PENDING", signupOrgId: { not: null } },
    select: { signupOrgId: true },
  });
  if (pending.length === 0) return;
  const orgIds = Array.from(new Set(pending.map((p) => p.signupOrgId as string)));
  const live = await db.subscription.findMany({
    // A trialing shop has not paid yet; only a paying one is worth the Stripe read.
    where: { organizationId: { in: orgIds }, externalSubId: { not: null }, status: { in: ["ACTIVE", "PAST_DUE"] } },
    select: { organizationId: true },
  });
  for (const s of live) await settleReferralsForSignupOrg(s.organizationId);
}
