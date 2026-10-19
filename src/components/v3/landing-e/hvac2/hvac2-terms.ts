import "server-only";
/* THE TRIAL'S TERMS UNDER THE BUTTON (hvac2, 2026-10-19; the audit: "say
   what happens after the trial right where they decide"). Two short lines:
   what today costs and what follows, then how not to be charged.

   THE PRICE IS THE ONE THE SIGN-UP WILL CHARGE, READ FROM THE CATALOGUE.
   With the admin's "straight to a plan" switch on (lib/signupAutoPlanServer)
   the sign-up from this page opens one plan's card page — the same rule,
   asked the same way the register page asks it (the HVAC estimator as the
   ad's tool), so this line names that plan's price exactly. With the switch
   off the visitor picks on the plan cards: the line says "from" the cheapest
   plan that lists the HVAC estimator (hero-price.ts), else the cheapest plan
   on sale. No plan readable: no amount, only "$0 today". */

import { formatPlanPrice, priceCadence } from "@/lib/planCatalog";
import { autoPlanOffer } from "@/lib/signupAutoPlanServer";
import type { getPlanCatalog } from "@/lib/planCatalogServer";
import { cheapestPlanWith } from "../hero-price";

type Catalog = Awaited<ReturnType<typeof getPlanCatalog>>;

export async function hvac2TrialTerms(plans: Catalog, requiresCard: boolean): Promise<[string, string]> {
  const auto = await autoPlanOffer({ tool: "hvac" }, plans).catch(() => null);
  const sellable = plans.filter((p) => !p.isFree);
  const from = auto ? null : cheapestPlanWith(sellable, "HVAC estimator") ?? (sellable.length ? sellable.reduce((a, b) => (b.priceCents < a.priceCents ? b : a)) : null);
  const amount = auto ? `${formatPlanPrice(auto.priceCents)}${priceCadence(true)}` : from ? `from ${formatPlanPrice(from.priceCents)}${priceCadence(true)}` : null;
  if (!requiresCard) {
    return [
      amount ? `$0 today, then ${amount} after your trial if you add a card.` : "$0 today. No card needed to start.",
      "No card, no charge — your work stays on the free plan.",
    ];
  }
  return [
    amount ? `$0 today, then ${amount} after your trial. Card required.` : "$0 today. Card required.",
    "Cancel before the trial ends and you won't be charged.",
  ];
}
