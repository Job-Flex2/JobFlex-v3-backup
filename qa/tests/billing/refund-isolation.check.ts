// A refund event may only touch the payment of the org whose endpoint
// delivered it (audit, 2026-09-20). Two throwaway orgs, one Stripe payment
// each; a charge.refunded for org B's payment_intent dispatched under org A's
// endpoint context must be ignored, and under org B's it must be recorded.
//   npx tsx --tsconfig tsconfig.json qa/tests/billing/refund-isolation.check.ts
// Writes to the local dev database and removes everything it created.
import "../_lib/_server-only";
import type Stripe from "stripe";
import { db } from "../../../src/lib/db";
import { dispatchStripeEvent } from "../../../src/lib/payments/stripeEvents";

let failures = 0;
let passes = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) passes++;
  else failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || detail === undefined ? "" : " — " + JSON.stringify(detail)}`);
};

async function main() {
  const tag = `qa-refund-${Date.now()}`;
  const orgA = await db.organization.create({ data: { name: `${tag} A`, slug: `${tag}-a` } });
  const orgB = await db.organization.create({ data: { name: `${tag} B`, slug: `${tag}-b` } });
  const piB = `pi_${tag}_B`;
  const payB = await db.payment.create({
    data: { organizationId: orgB.id, provider: "STRIPE", amount: 100, status: "PAID", externalId: `cs_${tag}_B`, externalPaymentId: piB },
  });

  const refundEvent = {
    id: `evt_${tag}`,
    type: "charge.refunded",
    data: { object: { object: "charge", payment_intent: piB, amount_refunded: 10000, refunded: true } },
  } as unknown as Stripe.Event;
  const ctxFor = (organizationId: string, account: string) => ({
    via: "key" as const,
    stripe: {} as Stripe,
    reqOpts: {},
    account,
    organizationId,
  });

  try {
    // 1. Signed by org A's endpoint, naming org B's payment intent.
    await dispatchStripeEvent(refundEvent, ctxFor(orgA.id, "acct_A"));
    const afterA = await db.payment.findUnique({ where: { id: payB.id } });
    check("a refund delivered on org A's endpoint leaves org B's payment PAID", afterA?.status === "PAID" && afterA.refundedAmount === 0, afterA);

    // 2. The same event on org B's own endpoint is recorded.
    await dispatchStripeEvent({ ...refundEvent, id: `evt_${tag}_2` } as Stripe.Event, ctxFor(orgB.id, "acct_B"));
    const afterB = await db.payment.findUnique({ where: { id: payB.id } });
    check("the same event on org B's endpoint records the refund", afterB?.status === "REFUNDED" && afterB.refundedAmount === 100, afterB);

    // 3. An endpoint with no resolvable org records nothing.
    const payA = await db.payment.create({
      data: { organizationId: orgA.id, provider: "STRIPE", amount: 50, status: "PAID", externalId: `cs_${tag}_A`, externalPaymentId: `pi_${tag}_A` },
    });
    await dispatchStripeEvent(
      { ...refundEvent, id: `evt_${tag}_3`, data: { object: { object: "charge", payment_intent: `pi_${tag}_A`, amount_refunded: 5000, refunded: true } } } as unknown as Stripe.Event,
      { via: "connect", stripe: {} as Stripe, reqOpts: {}, account: null, organizationId: null },
    );
    const afterNoOrg = await db.payment.findUnique({ where: { id: payA.id } });
    check("an event with no known org is ignored", afterNoOrg?.status === "PAID", afterNoOrg);
  } finally {
    await db.payment.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await db.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
    await db.$disconnect();
  }
  console.log(`${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
}

void main();
