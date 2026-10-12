// HOW A PLAN OR TERM CHANGE IS MADE — the pure rule (owner, 2026-10-12), kept
// apart from Stripe so scripts/qa/plan-change.check.ts can walk every case.
// lib/planChange reads the subscription and the catalog, asks this, and acts.
//
//   trialing                         → "trial"    (swap the price, the trial runs on, $0 today)
//   YEAR → MONTH                     → "schedule" (from the end of the paid year; cancellable)
//   MONTH → YEAR                     → "charge"   (invoiced today, the unused month credited,
//                                                  the cycle restarts today) — "checkout"
//                                                  for a subscription of several lines (custom)
//   same term, up by tier            → "checkout" (paid on Stripe's page — the 2026-09-02 rule)
//   same term, dearer, not up by tier→ "charge"   (one line only; else "free")
//   same term, otherwise             → "free"     (switched now, nothing charged or refunded)

export type BillingTermName = "MONTH" | "YEAR";
export type ChangeRoute = "checkout" | "charge" | "free" | "trial" | "schedule";

export function changeRoute(o: {
  trialing: boolean;
  from: BillingTermName;
  to: BillingTermName;
  /** Catalog ladder positions (custom = -1). */
  rankFrom: number;
  rankTo: number;
  /** What the subscription bills per term now, and what the new plan would. */
  currentCents: number;
  targetCents: number;
  /** Lines on the subscription (a custom plan has a base and a page line). */
  lines: number;
}): ChangeRoute {
  if (o.trialing) return "trial";
  if (o.from === "YEAR" && o.to === "MONTH") return "schedule";
  if (o.from === "MONTH" && o.to === "YEAR") return o.lines > 1 ? "checkout" : "charge";
  if (o.rankTo > o.rankFrom) return "checkout";
  return o.targetCents > o.currentCents && o.lines === 1 ? "charge" : "free";
}
