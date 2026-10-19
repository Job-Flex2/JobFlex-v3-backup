import "server-only";
/* THE TRIAL'S TERMS UNDER EVERY hvac2 BUTTON (2026-10-19; the audit: "say
   what happens after the trial right where they decide"). Two short lines —
   what today costs and what follows, then how not to be charged — under the
   hero's button, the sample's, the final block's and the phone's sticky bar.

   THE PRICE IS THE PLAN THE SIGN-UP OPENS, READ FROM THE CATALOGUE. With the
   admin's "straight to a plan" switch on, the same rule the register page
   asks (lib/signupAutoPlanServer, with the HVAC estimator as the ad's tool);
   with it off, the plan the sign-up puts first — the default plan of that
   same rule (AUTO_PLAN_SLUG, Professional), else the highlighted one. The
   trial's length is the offer's (lib/trialOfferServer). No plan readable:
   "$0 today" alone, never a typed number. */

import { formatPlanPrice, priceCadence } from "@/lib/planCatalog";
import { AUTO_PLAN_SLUG } from "@/lib/signupAutoPlan";
import { autoPlanOffer } from "@/lib/signupAutoPlanServer";
import type { getPlanCatalog } from "@/lib/planCatalogServer";

type Catalog = Awaited<ReturnType<typeof getPlanCatalog>>;

export interface Hvac2Terms {
  /** The two lines under every button. */
  lines: [string, string];
  /** The plan they name, for the FAQ ("Professional at $95/mo"); null when the catalogue had none. */
  plan: { name: string; amount: string } | null;
}

export async function hvac2TrialTerms(plans: Catalog, requiresCard: boolean): Promise<Hvac2Terms> {
  const sellable = plans.filter((p) => !p.isFree);
  const auto = await autoPlanOffer({ tool: "hvac" }, plans).catch(() => null);
  const row = auto ? sellable.find((p) => p.slug === auto.slug) : sellable.find((p) => p.slug === AUTO_PLAN_SLUG) ?? sellable.find((p) => p.highlight);
  const cents = auto?.priceCents ?? row?.priceCents;
  const amount = cents ? `${formatPlanPrice(cents)}${priceCadence(true)}` : null;
  const plan = amount && row ? { name: auto?.name ?? row.name, amount } : null;
  if (!requiresCard) {
    return {
      plan,
      lines: [
        amount ? `$0 today, then ${amount} after your trial if you add a card.` : "$0 today. No card needed to start.",
        "No card, no charge — your work stays on the free plan.",
      ],
    };
  }
  return {
    plan,
    lines: [
      amount ? `$0 today, then ${amount} after your trial. Card required.` : "$0 today. Card required.",
      "Cancel anytime before the trial ends — you won't be charged.",
    ],
  };
}
