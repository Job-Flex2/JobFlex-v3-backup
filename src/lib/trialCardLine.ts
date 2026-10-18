// THE "CARD" LINE ON SUBSCRIPTION FOR A CARD-LESS TRIAL (owner, 2026-10-09;
// ticket HQFESV). The card-less welcome email says a card can be added "any
// time from Subscription" — this is that place: "Card · None yet · Add a card"
// (to /dashboard/trial, which alone opens Checkout), or "Card · Visa ···· 4242"
// once one is on file. Only an organization with a card-less trial record
// gets the line; every other subscription page is unchanged (null).
//
// The card itself is read live from Stripe (lib/paymentCard's one rule) and
// never stored. Stripe not answering is not "no card": the record says a card
// was added, so the line says "On file".
import "server-only";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { readCardlessRecord } from "@/lib/trialState";
import { stripeClientForMode } from "@/lib/sdk/stripe";
import { NO_CARD, paymentCardOf, type PaymentCard } from "@/lib/paymentCard";

export type TrialCardLine = {
  /** "None yet", "Visa ···· 4242", "On file". */
  value: string;
  /** Where to add one — only while there is none. */
  addHref: string | null;
};

const EXPAND = ["customer", "default_payment_method", "customer.invoice_settings.default_payment_method", "customer.default_source"];

export async function trialCardLine(organizationId: string): Promise<TrialCardLine | null> {
  const rec = await readCardlessRecord(organizationId);
  if (!rec) return null;
  const hasCard = Boolean(rec.cardAt || rec.restartedAt);
  if (!hasCard) return { value: "None yet", addHref: "/dashboard/trial" };

  // The subscription that pays now: a restart after the end is a new one.
  const row = await db.subscription
    .findUnique({ where: { organizationId }, select: { externalSubId: true } })
    .catch(() => null);
  const subId = row?.externalSubId ?? rec.subId;
  const stripe = stripeClientForMode(rec.mode);
  if (!stripe || !subId) return { value: "On file", addHref: null };
  try {
    const card = await subscriptionCard(stripe, subId);
    return { value: card.kind === "none" ? "On file" : card.label, addHref: null };
  } catch {
    return { value: "On file", addHref: null };
  }
}

/** The card one Stripe subscription pays with, by lib/paymentCard's one rule —
 *  also the card line of Settings → Billing's manage window. Throws when
 *  Stripe does not answer. */
export async function subscriptionCard(stripe: Stripe, subId: string): Promise<PaymentCard> {
  const sub = await stripe.subscriptions.retrieve(subId, { expand: EXPAND });
  const cust = typeof sub.customer === "string" ? null : (sub.customer as Stripe.Customer | Stripe.DeletedCustomer);
  let card = paymentCardOf(sub, cust);
  if (card === NO_CARD || card.kind === "none") {
    const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
    const attached = (await stripe.customers.listPaymentMethods(customerId, { limit: 10 })).data;
    card = paymentCardOf(sub, cust, attached);
  }
  return card;
}
