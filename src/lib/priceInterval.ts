// MONTHLY OR YEARLY, for a Stripe price this app knows — moved out of
// lib/trialPlan (2026-10-12) so the plan pages, lib/planChange and
// lib/customBilling read the term the same way without importing each other.
import { db } from "@/lib/db";

/**
 * The live catalog's PlanPrice ledger, else the reusable prices the app minted
 * itself (lib/stripePriceCache — sandbox catalog prices and the custom plan's
 * base/page prices, keyed `stripePrice:<mode>:<kind>:<interval>:<cents>`).
 * Null for anything else.
 */
export async function priceInterval(stripePriceId: string): Promise<"MONTH" | "YEAR" | null> {
  const ledger = await db.planPrice.findUnique({ where: { stripePriceId }, select: { interval: true } }).catch(() => null);
  if (ledger) return ledger.interval.toUpperCase() === "YEAR" ? "YEAR" : "MONTH";
  const minted = await db.syncState
    .findFirst({ where: { key: { startsWith: "stripePrice:" }, cursor: stripePriceId }, select: { key: true } })
    .catch(() => null);
  const interval = minted?.key.split(":").at(-2);
  return interval === "YEAR" || interval === "MONTH" ? interval : null;
}
