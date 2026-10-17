/* THE TRADE'S PRICE IN THE FIRST SCREEN (2026-10-04; the analyst: "put the
   ad's exact claim, the trade, the price and '7-day free trial' in the
   hero, above the fold"). A roofer who clicked a roof-report ad wants one
   number: what the roof estimator costs once the trial is over.

   READ FROM THE CATALOGUE, NEVER TYPED. The number is the cheapest plan on
   sale whose card ticks the trade's row ("Roof estimator") — the same
   reading the plan cards make (expandPlanFeatures, "Everything in …"
   roll-ups included), so the hero cannot disagree with the pricing section
   under it. The cheapest plan of all is not the answer: a plan without the
   estimator is not what this page sells. No plan carrying the row, or a
   catalogue that could not be read: no line at all, rather than a guess. */

import { expandPlanFeatures, formatPlanPrice, priceCadence } from "@/lib/planCatalog";
import type { LandingVariant } from "./landing-variants";

export type PricedPlan = { slug: string; priceCents: number; isFree: boolean; features: string[] };

/** The cheapest plan on sale whose card ticks `feature`. */
export function cheapestPlanWith(plans: readonly PricedPlan[], feature: string): PricedPlan | null {
  const want = feature.trim().toLowerCase();
  const sellable = plans.filter((p) => !p.isFree);
  if (!want || !sellable.length) return null;
  const { included } = expandPlanFeatures(sellable.map((p) => ({ slug: p.slug, features: p.features })));
  const carrying = sellable.filter((p) => included.get(p.slug)?.has(want));
  return carrying.length ? carrying.reduce((a, b) => (b.priceCents < a.priceCents ? b : a)) : null;
}

/** "Then from $95/mo · roof estimator included" — or null when the variant
 *  names no row, or no plan on sale carries it. The trial it follows is the
 *  hero's own button ("Start my 7-day free trial", owner 2026-10-16). */
export function heroPriceLine(v: Pick<LandingVariant, "priceFeature" | "priceNote">, plans: readonly PricedPlan[]): string | null {
  if (!v.priceFeature) return null;
  const plan = cheapestPlanWith(plans, v.priceFeature);
  if (!plan) return null;
  return `Then from ${formatPlanPrice(plan.priceCents)}${priceCadence(true)}${v.priceNote ? ` · ${v.priceNote}` : ""}`;
}
