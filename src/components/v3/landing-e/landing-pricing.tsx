import type { PlanDTO } from "@/lib/planCatalog";
import { PricingPlans } from "./pricing-plans";
import { Reveal } from "./reveal";
import { REGISTER } from "./routes";
import "./pricing-faq.css";
import { TrialLine } from "./trial-line";
import { CustomPlanBlock } from "@/components/v3/pricing-d/custom-plan-block";

/* The price anchor before the footer (CRO stage 2, 2026-09-09). The plans
   are the Subscription page's own catalogue (PricingPlan, via
   getPlanCatalog on the server) — nothing here names a plan or a price.
   THE INK SHEET (owner, 2026-09-10): lp-base under the showcase's drafting
   grid (landing-e.css, .lp-price).
   SUBSCRIPTION PLANS (owner, 2026-09-26): the section's headline is the
   title, set large; the cards are the register's step-3 plan cards
   (pricing-plans.tsx), each with its own start button, so the section has
   no separate CTA — `cta` is still accepted from the page and unused.
   A $0 tier, when one exists in the catalogue, is what a skipped checkout
   leaves behind and is not sold. */
export function LandingPricing({
  plans,
  registerHref = REGISTER,
  requiresCard = true,
  customOffered = false,
}: {
  plans: PlanDTO[];
  /** CUSTOM_PLAN_ENABLED (lib/customPlanFlag), read on the server per request:
   *  "Build your plan" under the cards while the custom plan is on sale. */
  customOffered?: boolean;
  registerHref?: string;
  cta?: string;
  /** signupTrialMode (lib/trialPolicyServer): the words of the trial's badge under the title. */
  requiresCard?: boolean;
}) {
  const sellable = plans.filter((p) => !p.isFree);
  if (!sellable.length) return null;

  return (
    <section id="pricing" className="lp-price relative overflow-hidden px-5 py-[8vmin] sm:px-6">
      <div className="relative z-[1] mx-auto lp-wrap">
        <Reveal>
          <h2 className="lp-sec-title lp-sec-title--on-ink">Subscription plans</h2>
          {/* U+2011 non-breaking hyphens: the line never breaks at "per-/seat" or "add-/ons". */}
          <p className="lp-sec-lede lp-sec-lede--on-ink">Flat monthly price · no per‑seat add‑ons</p>
          <TrialLine tone="dark" className="mt-6" href={registerHref} spot="pricing" requiresCard={requiresCard} />
        </Reveal>

        <Reveal delay={120} className="mt-9 sm:mt-11">
          <PricingPlans plans={sellable} registerHref={registerHref} tone="ink" customOffered={customOffered} />
        </Reveal>

        {customOffered ? (
          <div className="mt-10 sm:mt-14">
            <CustomPlanBlock registerHref={registerHref} cta="landing-custom" delay={180} />
          </div>
        ) : null}
      </div>
    </section>
  );
}
