import "server-only";
// STRAIGHT TO PROFESSIONAL, ASKED NOW (2026-10-17). The plan the sign-up opens the card page for — or null for the
// plan cards — read from the admin switch (lib/trialPolicyServer readSignupPlan) at the moment it is asked, by the
// one rule (lib/signupAutoPlan autoPlanFor). The register page asks it as the page is drawn (step 1 names the plan);
// the plan step asks it again as it opens (actions/signupPaywall signupPlans), so a tab drawn before the switch was
// turned on — or off — and a draft or intent saved under the other setting still get what the switch says today.
import { readSignupPlan } from "@/lib/trialPolicyServer";
import { getPlanCatalog } from "@/lib/planCatalogServer";
import { isEditionPlan } from "@/lib/editions";
import { autoPlanFor, type AutoPlanOffer } from "@/lib/signupAutoPlan";
import type { SpotlightTool } from "@/lib/planSpotlight";

export type AutoPlanAsk = {
  /** ?plan= — a plan the visitor chose on a pricing page, this visit. */
  asked?: string | null;
  edition?: "deck" | null;
  /** The tool the ad sold (lib/planSpotlight). */
  tool?: SpotlightTool | null;
};

type Catalog = Awaited<ReturnType<typeof getPlanCatalog>>;

export async function autoPlanOffer(ask: AutoPlanAsk, catalog?: Catalog): Promise<AutoPlanOffer | null> {
  if ((await readSignupPlan()).mode !== "auto") return null;
  const plans = (catalog ?? (await getPlanCatalog().catch(() => []))).filter((p) => !p.isFree);
  const editionSlug = ask.edition === "deck" ? (plans.find((p) => isEditionPlan(p.slug, "deck"))?.slug ?? null) : null;
  const pick = autoPlanFor({ plans, tool: ask.tool ?? null, editionSlug, asked: ask.asked ?? null });
  const plan = pick ? plans.find((p) => p.slug === pick.slug) : null;
  return pick && plan ? { slug: plan.slug, name: plan.name, priceCents: plan.priceCents, why: pick.why } : null;
}
