import "server-only";
// WHAT CUSTOMERS HAVE PAID (owner, 2026-10-17: "remove the assumptions") — the money Stripe took for JobFlex
// subscriptions since the investors' start day: paid subscription invoices on the platform's own account, for the
// accounts the page counts (hidden and test accounts out), by the day each was paid. Revenue on the investor page
// is this, not a list price spread over days. Read at most every ten minutes per instance; a failure or a slow
// answer is "not read", said so on the page — never a guess.
import { getStripeClient, isStripeEnabled } from "@/lib/sdk/stripe";
import { invoiceSubscriptionId } from "@/lib/stripeCompat";
import type { PaymentIn } from "@/lib/investorModel";

export type PaymentRead = { ok: true; payments: PaymentIn[] } | { ok: false; error: string };

const FRESH_MS = 10 * 60_000;
/** A failed read is retried after a minute, not on every page view. */
const RETRY_MS = 60_000;
const WAIT_MS = 8_000;
const MAX_PAGES = 30;
let kept: { key: string; at: number; value: PaymentRead } | null = null;

export async function readSubscriptionPayments(sinceMs: number, customers: ReadonlySet<string>, dayOf: (ms: number) => string): Promise<PaymentRead> {
  if (!isStripeEnabled()) return { ok: false, error: "Stripe is not connected on this deployment." };
  const key = `${sinceMs}|${[...customers].sort().join(",")}`;
  if (kept && kept.key === key && Date.now() - kept.at < (kept.value.ok ? FRESH_MS : RETRY_MS)) return kept.value;
  const read = async (): Promise<PaymentRead> => {
    const { stripe } = await getStripeClient();
    const out: PaymentIn[] = [];
    let after: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await stripe.invoices.list({ status: "paid", created: { gte: Math.floor(sinceMs / 1000) }, limit: 100, ...(after ? { starting_after: after } : {}) });
      for (const inv of res.data) {
        const customer = typeof inv.customer === "string" ? inv.customer : inv.customer?.id;
        if (!customer || !customers.has(customer) || !invoiceSubscriptionId(inv)) continue;
        if ((inv.currency ?? "usd").toLowerCase() !== "usd" || !(inv.amount_paid > 0)) continue;
        out.push({ date: dayOf((inv.status_transitions?.paid_at ?? inv.created) * 1000), cents: inv.amount_paid });
      }
      if (!res.has_more || res.data.length === 0) break;
      after = res.data.at(-1)?.id;
    }
    return { ok: true, payments: out };
  };
  let value: PaymentRead;
  try {
    value = await Promise.race([read(), new Promise<PaymentRead>((resolve) => setTimeout(() => resolve({ ok: false, error: "Stripe took too long to answer." }), WAIT_MS))]);
  } catch (err) {
    value = { ok: false, error: err instanceof Error ? `Stripe: ${err.message.slice(0, 140)}` : "Stripe did not answer." };
  }
  kept = { key, at: Date.now(), value };
  return value;
}
