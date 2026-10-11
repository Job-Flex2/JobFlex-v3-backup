import "server-only";
// THE FREE TRIAL'S $0 INVOICES (owner, 2026-10-11). Stripe issues a $0.00
// invoice for every trial period — one at signup, and one more each time the
// trial end is moved (the 3→7-day extensions of 2026-10-11 left a first one
// reading "Trial period Oct 11 – Oct 14"). Billing history leaves them out;
// every paid invoice, refund and $0 invoice for another reason (a 100% code,
// a grant) stays.
//
// Told apart by shape, not by words — the line's description follows the
// customer's language ("Prueba gratuita de 1 × …"): nothing charged before
// any discount, no discount, and every line a subscription line at a zero
// unit amount, not a proration, whose period lies inside that subscription's
// own trial.
import type Stripe from "stripe";

function isTrialShaped(inv: Stripe.Invoice): boolean {
  if ((inv.total ?? 0) !== 0 || (inv.subtotal ?? 0) !== 0) return false;
  if ((inv.total_discount_amounts ?? []).some((d) => (d.amount ?? 0) > 0)) return false;
  const lines = inv.lines?.data ?? [];
  return lines.length > 0 && lines.every((l) => {
    const item = l.parent?.subscription_item_details;
    return l.amount === 0 && !!item?.subscription && !item.proration && l.pricing?.unit_amount_decimal === "0";
  });
}

/** The ids of the invoices that only record a free trial period. */
export async function trialOnlyInvoiceIds(stripe: Stripe, invoices: Stripe.Invoice[]): Promise<Set<string>> {
  const shaped = invoices.filter(isTrialShaped);
  if (!shaped.length) return new Set();
  // Each line's period is checked against its subscription's trial window —
  // read by id (usually one subscription; a list call misses test-clock
  // ones). Unreadable: that invoice stays, the history as Stripe has it.
  const ids = new Set(shaped.flatMap((inv) => (inv.lines?.data ?? []).map((l) => l.parent?.subscription_item_details?.subscription ?? "")).filter(Boolean));
  const trial = new Map<string, { start: number | null; end: number | null }>();
  await Promise.all([...ids].map(async (id) => {
    const s = await stripe.subscriptions.retrieve(id).catch(() => null);
    if (s) trial.set(id, { start: s.trial_start, end: s.trial_end });
  }));
  const out = new Set<string>();
  for (const inv of shaped) {
    const inside = (inv.lines?.data ?? []).every((l) => {
      const w = trial.get(l.parent?.subscription_item_details?.subscription ?? "");
      return !!w?.start && !!w.end && l.period.start >= w.start && l.period.end <= w.end;
    });
    if (inside && inv.id) out.add(inv.id);
  }
  return out;
}
