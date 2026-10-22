// WHY PLAN CHARGES FAIL — the record (owner, 2026-10-21: "see why charges
// fail, win the failed payments back faster"; many trial cards fail at the
// first charge on day 8).
//
// One PaymentFailure row per declined try of a JobFlex plan invoice. Written
// by the Stripe webhook (invoice.payment_failed → noteInvoiceFailure) and by
// scripts/backfill-payment-failures.ts, both through failedAttempts +
// recordPaymentFailure below, so a backfilled row reads like a live one.
//
//   reason   the try's own: the payment intent's last_payment_error
//            (decline_code / code / message) for the newest try, the failed
//            charge's outcome.reason / failure_code / failure_message for
//            older ones (Stripe keeps only the newest error on the intent);
//   card     the charge's payment_method_details.card — brand, funding
//            (credit / debit / prepaid), last4;
//   ignored  Stripe sent the failure but nothing was owed: the subscription
//            is active or trialing (a declined plan change, an old failure
//            after the invoice was paid — the webhook's own rule). Counted
//            apart so the statistics stay whole;
//   isTrialEnd  the first charge after a trial (billing_reason
//            subscription_cycle, its period starting at the trial's end — the
//            subscription's trial_end, else our mirror's trialEndsAt);
//   recoveredAt  invoice.paid for an invoice with failures (markFailuresRecovered).
//
// One row per (invoice, attempt): a redelivered event is the same row.
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { invoiceSubscriptionId, refId } from "@/lib/stripeCompat";
import { cardFunding, type CardFunding } from "@/lib/paymentFailureShared";

export type FailedTry = {
  at: Date;
  declineCode: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  cardBrand: string | null;
  cardFunding: CardFunding;
  cardLast4: string | null;
};

type CardLike = { brand?: string | null; funding?: string | null; last4?: string | null } | null | undefined;

const cardOf = (c: CardLike) => ({ cardBrand: c?.brand ?? null, cardFunding: cardFunding(c?.funding), cardLast4: c?.last4 ?? null });
const clip300 = (s: string | null | undefined) => (s ? s.replace(/\s+/g, " ").trim().slice(0, 300) : null);

function fromCharge(ch: Stripe.Charge): FailedTry {
  return {
    at: new Date(ch.created * 1000),
    // Stripe's decline_code on the intent is the charge's outcome.reason (generic_decline, insufficient_funds,
    // highest_risk_level for a Radar block, …).
    declineCode: ch.outcome?.reason ?? null,
    errorCode: ch.failure_code ?? null,
    errorMessage: clip300(ch.failure_message),
    ...cardOf(ch.payment_method_details?.card),
  };
}

export type InvoiceAttempts = {
  invoice: Stripe.Invoice;
  /** Every failed charge on the invoice's payment intents, oldest first. */
  tries: FailedTry[];
  /** The newest intent's last_payment_error — the newest try's own reason (no charge behind it for, say, a
   *  3DS request). Null when the intent carries none. */
  lastError: Omit<FailedTry, "at"> | null;
  /** The invoice has no payment intent at all: nothing was ever charged (no card on file). */
  noIntent: boolean;
};

/** Read an invoice's failed tries from Stripe (the clover shape: invoice payments → payment intents → charges). */
export async function failedAttempts(stripe: Stripe, invoiceId: string): Promise<InvoiceAttempts> {
  const invoice = await stripe.invoices.retrieve(invoiceId, { expand: ["payments.data.payment.payment_intent"] });
  const intents = (invoice.payments?.data ?? [])
    .slice()
    .sort((a, b) => a.created - b.created)
    .map((p) => p.payment?.payment_intent)
    .filter((pi): pi is Stripe.PaymentIntent => Boolean(pi) && typeof pi === "object");
  const tries: FailedTry[] = [];
  for (const pi of intents) {
    const charges = await stripe.charges.list({ payment_intent: pi.id, limit: 100 });
    for (const ch of charges.data) if (ch.status === "failed") tries.push(fromCharge(ch));
  }
  tries.sort((a, b) => a.at.getTime() - b.at.getTime());
  const newest = intents.at(-1);
  const e = newest?.last_payment_error;
  const lastError = e
    ? { declineCode: e.decline_code ?? null, errorCode: e.code ?? null, errorMessage: clip300(e.message), ...cardOf(e.payment_method?.card) }
    : null;
  return { invoice, tries, lastError, noIntent: intents.length === 0 };
}

/** The newest try as the webhook records it: the intent's error first (the spec of the record), the charge for
 *  what the error leaves out — the card above all. */
export function newestTry(a: InvoiceAttempts, now = new Date()): FailedTry {
  const charge = a.tries.at(-1) ?? null;
  const err = a.lastError;
  const viaCharge = charge?.cardBrand ? charge : null;
  return {
    at: charge?.at ?? now,
    declineCode: err?.declineCode ?? charge?.declineCode ?? null,
    errorCode: err?.errorCode ?? charge?.errorCode ?? (a.noIntent ? "no_payment_method" : null),
    errorMessage: err?.errorMessage ?? charge?.errorMessage ?? null,
    cardBrand: viaCharge?.cardBrand ?? err?.cardBrand ?? null,
    cardFunding: viaCharge?.cardFunding ?? err?.cardFunding ?? "unknown",
    cardLast4: viaCharge?.cardLast4 ?? err?.cardLast4 ?? null,
  };
}

const DAY_S = 86_400;

/** The first charge after a trial: a renewal invoice whose new period starts where the trial ended. */
export function isTrialEndInvoice(invoice: Stripe.Invoice, trialEnd: number | null): boolean {
  if (!trialEnd || invoice.billing_reason !== "subscription_cycle") return false;
  // A renewal invoice's own period_* is the period that ENDED; its lines carry the one now billed.
  const starts = (invoice.lines?.data ?? []).map((l) => l.period?.start).filter((n): n is number => typeof n === "number");
  const start = starts.length ? Math.min(...starts) : invoice.period_end;
  return Math.abs(start - trialEnd) <= DAY_S;
}

/** Whose invoice: the subscription's mirror first, then the customer's. */
async function mirrorOf(invoice: Stripe.Invoice) {
  const subId = invoiceSubscriptionId(invoice);
  const customerId = refId(invoice.customer);
  const select = { id: true, organizationId: true, trialEndsAt: true } as const;
  return (
    (subId ? await db.subscription.findFirst({ where: { externalSubId: subId }, select }) : null) ??
    (customerId ? await db.subscription.findFirst({ where: { externalCustomerId: customerId }, select }) : null)
  );
}

export type RecordInput = {
  invoice: Stripe.Invoice;
  attempt: number;
  failed: FailedTry;
  ignored: boolean;
  /** The subscription as Stripe holds it, when read — its trial_end decides isTrialEnd. */
  sub: Stripe.Subscription | null;
};

/** Write one try. Null for an invoice that is not a plan charge (no subscription) or is for nothing; `created`
 *  false when the row was already there (a redelivered event, a second backfill). */
export async function recordPaymentFailure(input: RecordInput): Promise<{ id: string; created: boolean } | null> {
  const { invoice, attempt, failed } = input;
  const subId = invoiceSubscriptionId(invoice);
  const cents = invoice.amount_due ?? 0;
  if (!invoice.id || !subId || cents <= 0) return null;
  const mirror = await mirrorOf(invoice);
  const trialEnd = input.sub?.trial_end ?? (mirror?.trialEndsAt ? Math.floor(mirror.trialEndsAt.getTime() / 1000) : null);
  const data = {
    createdAt: failed.at,
    organizationId: mirror?.organizationId ?? null,
    subscriptionId: mirror?.id ?? null,
    stripeInvoiceId: invoice.id,
    stripeSubscriptionId: subId,
    attempt: Math.max(1, attempt),
    amountCents: cents,
    currency: invoice.currency ?? "usd",
    billingReason: invoice.billing_reason ?? null,
    declineCode: failed.declineCode,
    errorCode: failed.errorCode,
    errorMessage: failed.errorMessage,
    cardBrand: failed.cardBrand,
    cardFunding: failed.cardFunding,
    cardLast4: failed.cardLast4,
    isTrialEnd: isTrialEndInvoice(invoice, trialEnd),
    ignored: input.ignored,
    // A backfilled try of an invoice paid since.
    recoveredAt: invoice.status === "paid" && invoice.status_transitions?.paid_at ? new Date(invoice.status_transitions.paid_at * 1000) : null,
  };
  try {
    const row = await db.paymentFailure.create({ data, select: { id: true } });
    return { id: row.id, created: true };
  } catch (err) {
    if ((err as { code?: string })?.code !== "P2002") throw err;
    const row = await db.paymentFailure.findUnique({ where: { stripeInvoiceId_attempt: { stripeInvoiceId: invoice.id, attempt: data.attempt } }, select: { id: true } });
    return row ? { id: row.id, created: false } : null;
  }
}

/**
 * invoice.payment_failed → the try on record. Returns what was declined (for the owner's text) even when the row
 * could not be written — a database without the table (prisma/sql/prod-2026-10-21-payment-failures.sql) loses the
 * row, not the rest of the webhook. Throws only when Stripe cannot be read.
 */
export async function noteInvoiceFailure(
  stripe: Stripe,
  invoice: Stripe.Invoice,
  opts: { sub: Stripe.Subscription | null; ignored: boolean },
): Promise<FailedTry | null> {
  if (!invoice.id || !invoiceSubscriptionId(invoice) || (invoice.amount_due ?? 0) <= 0) return null;
  const attempts = await failedAttempts(stripe, invoice.id);
  const failed = newestTry(attempts);
  // The event's own attempt_count: Stripe's retry schedule (a manual try does not move it).
  const attempt = invoice.attempt_count || attempts.invoice.attempt_count || 1;
  try {
    const r = await recordPaymentFailure({ invoice: attempts.invoice, attempt, failed, ignored: opts.ignored, sub: opts.sub });
    if (r?.created) {
      console.info(`[payment-failure] ${invoice.id} try ${attempt}: ${failed.declineCode ?? failed.errorCode ?? "no reason"} · ${failed.cardBrand ?? "?"} ${failed.cardFunding}${opts.ignored ? " · not a missed bill" : ""}`);
    }
  } catch (err) {
    console.warn(`[payment-failure] ${invoice.id}: not recorded —`, err instanceof Error ? err.message : err);
  }
  return failed;
}

/** invoice.paid → every try of it on record is recovered. Returns how many rows it marked. */
export async function markFailuresRecovered(invoice: Stripe.Invoice): Promise<number> {
  if (!invoice.id) return 0;
  const paidAt = invoice.status_transitions?.paid_at ? new Date(invoice.status_transitions.paid_at * 1000) : new Date();
  const r = await db.paymentFailure.updateMany({ where: { stripeInvoiceId: invoice.id, recoveredAt: null }, data: { recoveredAt: paidAt } });
  return r.count;
}
