import "server-only";
/* THE TRIAL'S TERMS UNDER hvac2's HERO BUTTON (2026-10-19). Two short lines
   — what today costs and what follows, then how not to be charged.

   THE PRICE IS THE PLAN THE SIGN-UP OPENS, READ FROM THE CATALOGUE. With the
   admin's "straight to a plan" switch on, the same rule the register page
   asks (lib/signupAutoPlanServer, with the HVAC estimator as the ad's tool);
   with it off, the plan the sign-up puts first — the default plan of that
   same rule (AUTO_PLAN_SLUG, Professional), else the highlighted one. The
   trial's length is the offer's (lib/trialOfferServer), on the button. No
   plan readable: "$0 today" alone, never a typed number. */

import { formatPlanPrice, priceCadence } from "@/lib/planCatalog";
import { AUTO_PLAN_SLUG } from "@/lib/signupAutoPlan";
import { autoPlanOffer } from "@/lib/signupAutoPlanServer";
import type { getPlanCatalog } from "@/lib/planCatalogServer";

type Catalog = Awaited<ReturnType<typeof getPlanCatalog>>;

export async function hvac2TrialTerms(plans: Catalog, requiresCard: boolean): Promise<[string, string]> {
  const sellable = plans.filter((p) => !p.isFree);
  const auto = await autoPlanOffer({ tool: "hvac" }, plans).catch(() => null);
  const row = auto ? sellable.find((p) => p.slug === auto.slug) : sellable.find((p) => p.slug === AUTO_PLAN_SLUG) ?? sellable.find((p) => p.highlight);
  const cents = auto?.priceCents ?? row?.priceCents;
  const amount = cents ? `${formatPlanPrice(cents)}${priceCadence(true)}` : null;
  if (!requiresCard) {
    return [
      amount ? `$0 today, then ${amount} after your trial if you add a card.` : "$0 today. No card needed to start.",
      "No card, no charge — your work stays on the free plan.",
    ];
  }
  return [
    amount ? `$0 today, then ${amount} after your trial. Card required.` : "$0 today. Card required.",
    "Cancel anytime before the trial ends — you won't be charged.",
  ];
}
