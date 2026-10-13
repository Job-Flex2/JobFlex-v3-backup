"use server";

import { requireOrg } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { readAccessSubscription, refreshSubscriptionAccess } from "@/lib/subscriptionAccess";
import { planLapsed } from "@/lib/planStatus";
import { recoveryKind, paymentFailureReason, type BillingRecoveryState } from "@/lib/billingRecovery";
import { invoiceSubscriptionId } from "@/lib/stripeCompat";

/** Authenticated status check, not a charge. Stripe's hosted invoice handles
 * the payment confirmation, saved card, and any bank authentication. */
export async function checkBillingRecovery(): Promise<BillingRecoveryState> {
  const { organizationId, role } = await requireOrg();
  const isOwner = role === "OWNER";
  let sub = await readAccessSubscription(organizationId);
  let live: Awaited<ReturnType<typeof refreshSubscriptionAccess>> = null;
  let verified = sub?.provider !== "STRIPE";
  if (sub?.provider === "STRIPE") {
    try {
      live = await refreshSubscriptionAccess(sub);
      verified = Boolean(live);
      sub = await db.subscription.findUnique({ where: { organizationId } });
      // A concurrent replacement must not receive the old invoice or card form.
      if (sub?.externalSubId !== live?.id || sub?.provider !== "STRIPE") live = null;
    } catch { verified = false; }
  }
  const kind = recoveryKind(sub);
  const result: BillingRecoveryState = {
    kind, blocked: planLapsed(sub), verified, isOwner,
    reason: kind === "payment" ? paymentFailureReason() : "",
    invoiceUrl: null, amountCents: null, currency: "USD", nextRetryAt: null,
    canUpdateCard: Boolean(isOwner && live && ["active", "trialing", "past_due", "unpaid"].includes(live.status)),
  };
  if (kind === "canceled" && live?.cancellation_details?.reason === "payment_failed") {
    result.reason = "Your subscription ended after payment could not be collected, so your account moved to the Free plan — your data is all here. Choose a plan to pay with another card and open your tools again.";
  }
  if (kind !== "payment" || !live || !isOwner) return result;
  try {
    const { getStripeClient } = await import("@/lib/sdk/stripe");
    const { stripe } = await getStripeClient();
    // Paying an old invoice may not reopen an UNPAID subscription. Always
    // recover the latest subscription invoice, not another customer invoice.
    const invoiceId = typeof live.latest_invoice === "string" ? live.latest_invoice : live.latest_invoice?.id;
    if (!invoiceId) return result;
    const invoice = await stripe.invoices.retrieve(invoiceId, { expand: ["payments.data.payment.payment_intent"] }, { timeout: 5000, maxNetworkRetries: 0 });
    const customer = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
    if (invoiceSubscriptionId(invoice) !== live.id || customer !== sub?.externalCustomerId) return result;
    if (invoice.status === "open" && invoice.amount_remaining > 0) {
      const url = invoice.hosted_invoice_url ? new URL(invoice.hosted_invoice_url) : null;
      result.invoiceUrl = url?.protocol === "https:" && url.hostname === "invoice.stripe.com" ? url.href : null;
      result.amountCents = invoice.amount_remaining;
      result.currency = invoice.currency.toUpperCase();
      result.nextRetryAt = invoice.next_payment_attempt ? new Date(invoice.next_payment_attempt * 1000).toISOString() : null;
      const intent = invoice.payments?.data.find((p) => p.is_default)?.payment.payment_intent;
      if (intent && typeof intent !== "string") {
        result.reason = paymentFailureReason(intent.last_payment_error?.decline_code ?? intent.last_payment_error?.code ??
          (intent.status === "requires_action" ? "authentication_required" : null));
      }
    }
  } catch { result.verified = false; }
  return result;
}
