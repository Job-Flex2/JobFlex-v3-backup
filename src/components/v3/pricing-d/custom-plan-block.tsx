// "BUILD YOUR PLAN" — the custom plan's plate, shared by /pricing and the
// landing's pricing section (owner, 2026-10-07: one plate, both places).
//
// Rendered only while the custom plan is on sale: the CALLER decides, from
// lib/customPlanFlag read on the server at request time, and passes nothing
// when it is off. The price is lib/customPlan's — base plus each page — and
// the saved trial offer the signup gives every plan.
//
// White on a 2px ink line with a hard ink offset (pricing.css, .pr-custom),
// so it reads the same on /pricing's white page and on the landing's ink
// sheet.

import { TrialDurationLabel, TrialStartLabel } from "@/components/providers/trial-offer";
import { Reveal } from "@/components/v3/landing-e/reveal";
import { priceCadence } from "@/lib/planCatalog";
import { CUSTOM_BASE_CENTS, CUSTOM_PAGE_CENTS, CUSTOM_PAGES } from "@/lib/customPlan";
import "./pricing.css";

/** Whole dollars — every price here is a round number. */
function price(cents: number): string {
  const d = cents / 100;
  return Number.isInteger(d) ? `$${d}` : `$${d.toFixed(2)}`;
}

export function CustomPlanBlock({
  registerHref,
  cta = "pricing-custom",
  delay,
}: {
  registerHref: string;
  /** The data-cta the click is counted under (traffic). */
  cta?: string;
  delay?: number;
}) {
  const customTop = CUSTOM_BASE_CENTS + CUSTOM_PAGES.length * CUSTOM_PAGE_CENTS;
  return (
    <Reveal delay={delay}>
      <div className="pr-custom p-7 sm:p-10">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div>
            <p className="lp-eyebrow text-lp-blue">Build your plan</p>
            <h2 className="mt-5 text-[clamp(26px,3vw,40px)] font-bold leading-[1.12] tracking-[-0.02em] text-[#0a0a0a]">
              Start at {price(CUSTOM_BASE_CENTS)}. Add only the machines you use.
            </h2>
            <p className="mt-4 max-w-[56ch] text-[15px] leading-[1.65] text-slate-500">
              The everyday workspace is included — dashboard, proposals with the manual builder,
              clients, projects, CRM, jobs, messages and financials. Each page below is{" "}
              {price(CUSTOM_PAGE_CENTS)} a month on top, and you can drop one the month you stop
              using it.
            </p>

            <div className="mt-7 flex flex-wrap gap-2">
              {CUSTOM_PAGES.map((p) => (
                <span key={p.id} className="pr-page">
                  {p.label}
                  <b>+{price(CUSTOM_PAGE_CENTS)}</b>
                </span>
              ))}
            </div>
          </div>

          <div className="flex flex-col justify-between border-slate-900/10 lg:border-l lg:pl-10">
            <div>
              <p className="lp-pw-price text-[#0a0a0a]">
                {price(CUSTOM_BASE_CENTS)}
                <i>{priceCadence(true)} base</i>
              </p>
              <div className="mt-2.5">
                <span className="pr-trial"><TrialDurationLabel /></span>
              </div>
              <p className="pr-desc mt-5">
                A full build with all {CUSTOM_PAGES.length} pages comes to {price(customTop)} a month —
                still less than the seats most shops pay for twice over.
              </p>
            </div>
            <a href={registerHref} className="lp-pw-go mt-8" data-cta={cta} data-cta-button="plan-custom">
              <TrialStartLabel />
            </a>
          </div>
        </div>
      </div>
    </Reveal>
  );
}
