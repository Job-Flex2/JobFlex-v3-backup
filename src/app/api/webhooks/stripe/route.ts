import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { getStripe, isStripeEnabled } from "@/lib/sdk/stripe";
import { runWebhookEnvelope } from "@/lib/webhookEnvelope";
import {
  syncSubscriptionFromStripe,
  markSubscriptionCanceled,
  markSubscriptionPastDue,
  accrueForInvoice,
  reverseForCharge,
  holdForDispute,
  settleDispute,
  handleConnectAccountUpdate,
  handleTransferEvent,
} from "@/lib/stripeSync";
import { confirmSyncingFromStripe } from "@/lib/planGrant";
import { processReferralEffectsForInvoice } from "@/lib/referralRewards";
import { metaOnCheckoutCompleted, metaOnInvoicePaid } from "@/lib/metaSignupEvents";
import { trackActivation } from "@/lib/activation-events";
import { finishCardCheckout, noteCardlessTrialEnded } from "@/lib/cardlessTrial";
import { CARD_UPDATE_PURPOSE, finishCardUpdate, sendDunningEmail } from "@/lib/cardUpdate";
import { completeFromCheckoutSession, completeFromPaymentIntent } from "@/lib/leadCenter/purchase";
import { cancelReplacedSubscription } from "@/lib/checkoutReturn";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!isStripeEnabled() || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ disabled: true });
  }

  const sig = req.headers.get("stripe-signature");
  const body = await req.text();
  const stripe = getStripe();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig!, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "bad signature";
    return NextResponse.json({ error: `Webhook signature: ${msg}` }, { status: 400 });
  }

  const result = await runWebhookEnvelope(
    { provider: "STRIPE", eventId: event.id, type: event.type },
    () => dispatch(event, stripe),
  );
  if (result.outcome === "duplicate") return NextResponse.json({ duplicate: true });
  // 500 so Stripe retries; the idempotency keys make re-processing safe.
  if (result.outcome === "failed") return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json({ received: true });
}

async function dispatch(event: Stripe.Event, stripe: Stripe) {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      // A Lead Center lead paid through Checkout (lib/leadCenter/purchase):
      // the contacts open here, or on the return page if it got there first.
      if (await completeFromCheckoutSession(session)) break;
      // A card added to a card-less trial (setup mode), or the plan restarted
      // after one ended (subscription mode) — lib/cardlessTrial. The return
      // page usually got there first; both are safe to run twice.
      const purpose = session.metadata?.jf_purpose;
      const trialOrg = session.metadata?.organizationId;
      // A new card after a failed payment (lib/cardUpdate): made the default
      // and the open invoice paid with it. The return page usually got there
      // first; both are safe to run twice.
      if (trialOrg && purpose === CARD_UPDATE_PURPOSE) {
        const done = await finishCardUpdate(trialOrg, session.id);
        if (!done.ok) console.warn(`[webhook] card update for ${trialOrg}: ${done.error}`);
        break;
      }
      if (trialOrg && (purpose === "trial-card" || purpose === "trial-restart")) {
        const done = await finishCardCheckout(trialOrg, session.id);
        if (!done.ok) console.warn(`[webhook] trial card for ${trialOrg}: ${done.error}`);
        if (purpose === "trial-card") break;
      }
      if (session.mode === "subscription" && session.subscription) {
        const sub = await stripe.subscriptions.retrieve(
          typeof session.subscription === "string" ? session.subscription : session.subscription.id,
        );
        await syncSubscriptionFromStripe(sub, stripe);
        // A plan checkout that replaces a subscription ends the old one here
        // too — the customer may never reach the return page (lib/checkoutReturn).
        if (sub.status === "active" || sub.status === "trialing") {
          await cancelReplacedSubscription(stripe, session, sub.id, "webhook");
        }
        // Meta StartTrial when the checkout came back trialing (lib/metaSignupEvents).
        await metaOnCheckoutCompleted(session, sub).catch((err) => console.warn("[meta:capi] StartTrial failed", err));
      } else {
        await handleProposalPayment(session); // existing one-time proposal payment flow
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      await syncSubscriptionFromStripe(sub, stripe);
      // An admin change written from Stripe's reply is "syncing" until Stripe
      // reports the subscription back in that state (lib/planGrant).
      await confirmSyncingFromStripe(sub).catch((err) => console.warn("[webhook] sync mark:", err));
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      // A card-less trial that ran out lands as TRIAL_ENDED, not CANCELED
      // (lib/stripeSync, isCardlessTrialLapse).
      await markSubscriptionCanceled(sub);
      await noteCardlessTrialEnded(sub);
      break;
    }
    // Three days before any trial ends. The mirror follows the subscription
    // (its trial end may have moved); the card-less trial's reminder emails
    // are the daily cron's (/api/cron/trials), on its own two-day and same-day
    // schedule.
    case "customer.subscription.trial_will_end": {
      await syncSubscriptionFromStripe(event.data.object as Stripe.Subscription, stripe);
      break;
    }
    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice;
      await accrueForInvoice(invoice, event.id, stripe);
      // Member-referral side: convert PENDING referrals on the referred org's
      // first real payment + apply owed 50%-of-a-month referrer credits.
      await processReferralEffectsForInvoice(invoice);
      // Meta Purchase + Subscribe on the first paid invoice, once per organization.
      await metaOnInvoicePaid(invoice).catch((err) => console.warn("[meta:capi] Purchase failed", err));
      break;
    }
    // A lead paid through Checkout with a method that settles later (a Link
    // bank debit): the session completes unpaid and this is the "paid".
    case "checkout.session.async_payment_succeeded": {
      await completeFromCheckoutSession(event.data.object as Stripe.Checkout.Session);
      break;
    }
    // The backstop for a lead charged to the card on file: the synchronous
    // "succeeded" opens it at once, and this repairs the rare charge whose
    // answer never got written. Ignores every PaymentIntent that is not a lead's.
    case "payment_intent.succeeded": {
      await completeFromPaymentIntent(event.data.object as Stripe.PaymentIntent);
      break;
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      await markSubscriptionPastDue(invoice);
      // The owner's two emails: the first failure, and Stripe's last try.
      await sendDunningEmail(invoice).catch((err) => console.warn("[webhook] dunning email failed:", err));
      break;
    }
    case "charge.refunded": {
      await reverseForCharge(event.data.object as Stripe.Charge, event.id, stripe);
      break;
    }
    // A chargeback removes the commission as a refund does (owner, 2026-09-22):
    // frozen while the dispute is open, reversed if it is lost, released with a
    // fresh hold if it is won. The event's own time is the date the dispute
    // opened or closed — a retried delivery must not move the hold clock.
    case "charge.dispute.created": {
      await holdForDispute(event.data.object as Stripe.Dispute, new Date(event.created * 1000));
      break;
    }
    case "charge.dispute.closed": {
      await settleDispute(event.data.object as Stripe.Dispute, event.id, new Date(event.created * 1000));
      break;
    }
    case "account.updated": {
      await handleConnectAccountUpdate(event.data.object as Stripe.Account);
      break;
    }
    case "transfer.created": {
      await handleTransferEvent(event.data.object as Stripe.Transfer, false);
      break;
    }
    case "transfer.reversed": {
      // The event's own time is the reversal date written on the request.
      await handleTransferEvent(event.data.object as Stripe.Transfer, true, new Date(event.created * 1000));
      break;
    }
    default:
      break;
  }
}

// One-time proposal payments. The Payment row always records the true amount
// that arrived, but the proposal only flips to PAID when the full expected
// total was actually paid — defense-in-depth against a checkout session created
// for a tampered amount (the checkout routes already derive the amount
// server-side, so a shortfall should only ever come from an out-of-band session).
async function handleProposalPayment(session: Stripe.Checkout.Session) {
  // Contractor-account checkouts (metadata.kind set) never reach this route —
  // they fire on the CONNECTED account and land in /api/webhooks/stripe-connect.
  // The guard only matters if someone points a Connect endpoint here by mistake.
  if (session.metadata?.kind) return;
  const publicId = session.metadata?.publicId;
  if (!publicId) return;
  const proposal = await db.proposal.findUnique({ where: { publicId } });
  if (!proposal) return;

  const expected = Math.round(proposal.total * 100);
  const paid = session.amount_total ?? 0;
  const fullyPaid = paid >= expected;

  // Re-dispatch safety (see the idempotency envelope above): one Payment row
  // per checkout session, no matter how many deliveries reach this handler.
  const already = await db.payment.findFirst({
    where: { externalId: session.id, provider: "STRIPE" },
    select: { id: true },
  });
  if (already) return;

  await db.payment.create({
    data: {
      organizationId: proposal.organizationId,
      proposalId: proposal.id,
      clientId: proposal.clientId,
      amount: paid / 100,
      currency: (session.currency ?? "usd").toUpperCase(),
      provider: "STRIPE",
      status: fullyPaid ? "PAID" : "PARTIAL",
      externalId: session.id,
      method: "card",
      paidAt: new Date(),
    },
  });
  trackActivation("payment_recorded", proposal.organizationId, { provider: "STRIPE", online: true });

  if (fullyPaid) {
    await db.proposal.update({
      where: { id: proposal.id },
      data: { status: "PAID", paidAt: new Date() },
    });
  } else {
    // Underpaid — leave the proposal unpaid and surface it for manual review
    // rather than silently marking a $12k quote PAID for a few cents.
    console.warn(
      `[stripe] proposal ${proposal.id} underpaid: got ${paid} of ${expected} (${session.id}) — not marking PAID`,
    );
  }
}
