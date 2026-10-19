/* landing-e CTA copy (pass B, 2026-09-10). First person with the trade's
   outcome for the top of the page — nav, hero, sticky bar, showcase; one
   line for everything from Proposals down. The shared variant data
   (landing-variants.ts) is untouched: this is the CTA table.
   Every trade's line says "free" (owner, 2026-10-02), as the low line does. */

import type { LandingVariantKey } from "./landing-variants";

export const LOW_CTA = "Start my free trial";

const TOP: Record<LandingVariantKey, string> = {
  roofing: "Start my free roof report",
  fencing: "Start my free fence takeoff",
  decking: "Start my free deck estimate",
  siding: "Start my free siding bid",
  landscaping: "Start my free yard proposal",
  concrete: "Start my free concrete bid",
  windows: "Start my free window quote",
  flooring: "Start my free floor bid",
  tile: "Start my free tile quote",
  countertops: "Start my free countertop quote",
  painting: "Start my free paint bid",
  drywall: "Start my free drywall bid",
  insulation: "Start my free insulation quote",
  "kitchen-bath": "Start my free remodel estimate",
  plumbing: "Start my free plumbing quote",
  electrical: "Start my free electrical quote",
  hvac: "Start my free HVAC quote",
  carpentry: "Start my free carpentry bid",
  demolition: "Start my free tear-out quote",
  "general-contractor": "Start my free whole-job estimate",
};

/** The top-of-page CTA for a trade; the default page's is the low line. */
export function firstPersonCta(key: LandingVariantKey | undefined): string {
  return key ? TOP[key] : LOW_CTA;
}
