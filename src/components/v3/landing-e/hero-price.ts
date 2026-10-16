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

/** "from $95/mo · roof estimator included" — or null when the variant names
 *  no row, or no plan on sale carries it. */
function pricePart(v: Pick<LandingVariant, "priceFeature" | "priceNote">, plans: readonly PricedPlan[]): string | null {
  if (!v.priceFeature) return null;
  const plan = cheapestPlanWith(plans, v.priceFeature);
  if (!plan) return null;
  return `from ${formatPlanPrice(plan.priceCents)}${priceCadence(true)}${v.priceNote ? ` · ${v.priceNote}` : ""}`;
}

/** "Then from $95/mo · roof estimator included" — or null when the variant
 *  names no row, or no plan on sale carries it. */
export function heroPriceLine(v: Pick<LandingVariant, "priceFeature" | "priceNote">, plans: readonly PricedPlan[]): string | null {
  const price = pricePart(v, plans);
  return price ? `Then ${price}` : null;
}

/* THE TRIAL LEADS THE LINE (owner, 2026-10-16). With the framed trial badge
   gone (bc7ed723), a trade hero whose button says "Create My Free Estimate"
   never said the first days are free. The line under the buttons now opens
   with the trial: "7-day free trial · then from $95/mo · fence estimator
   included" — and where the catalogue names no plan for the trade, the trial
   alone: "7-day free trial · cancel anytime" (with a card; the card-less
   trial's words already say there is nothing to cancel). `trial` is
   lib/trialPolicy trialShortLine, with the offer's days. */
export function heroTrialLine(v: Pick<LandingVariant, "priceFeature" | "priceNote">, plans: readonly PricedPlan[], trial: string, requiresCard: boolean): string {
  const price = pricePart(v, plans);
  if (price) return `${trial} · then ${price}`;
  return requiresCard ? `${trial} · cancel anytime` : trial;
}
