/* UNDER THE HERO (2026-10-19), on every landing: how it works (#how), then
   the reviews — before the page's usual sections.

   HOW IT WORKS: on the light drafting grid, the trade's tool as a kicker,
   the variant's `pitch` and its `lede` on the left; on the right the three
   steps (how-steps.tsx) — each the line from `points` as the step's title
   and the figure of the same index from `proof` under it (landing-variants.ts
   — each figure belongs to its line, its source listed there), in the trade
   tool's colour. Phone: the text above, the steps in a column. */

import type { CSSProperties } from "react";
import type { LandingVariant } from "./landing-variants";
import { LandingReviews } from "./landing-reviews";
import { HowSteps, type HowIcon } from "./how-steps";

/* The tool's colour (globals.css --tool-*); a Smart Proposal trade takes the
   Smart tool's, the default page the blueprint blue. */
const TOOL: Record<LandingVariant["visual"], string> = {
  hvac: "var(--tool-hvac)",
  roof: "var(--tool-roof)",
  fence: "var(--tool-fence)",
  deck: "var(--tool-deck)",
  smart: "var(--tool-smart)",
  dashboard: "var(--accent)",
};

/* Each step's icon: where the estimate starts (the address, the deck, the
   description), the priced lines, the proposal. The default page's three
   lines are the office's own: proposals, the calendar, payments. */
const ADDRESS: [HowIcon, HowIcon, HowIcon] = ["pin", "calc", "file"];
const ICONS: Record<LandingVariant["visual"], [HowIcon, HowIcon, HowIcon]> = {
  hvac: ADDRESS,
  roof: ADDRESS,
  fence: ADDRESS,
  deck: ["deck", "calc", "file"],
  smart: ["pen", "calc", "file"],
  dashboard: ["file", "cal", "card"],
};

export function HeroProof({ variant }: { variant: LandingVariant }) {
  const icons = ICONS[variant.visual];
  const steps = variant.points && variant.proof ? variant.points.map((title, i) => ({ title, ...variant.proof![i], icon: icons[i] })) : [];
  return (
    <>
      {variant.pitch ? (
        <section id="how" className="lp-how" style={{ "--lp-tool": TOOL[variant.visual] } as CSSProperties}>
          <div className="lp-how-wrap">
            <div className="lp-how-copy">
              {variant.kicker ? <p className="lp-how-kicker">{variant.kicker}</p> : null}
              <h2 className="lp-how-pitch">{variant.pitch}</h2>
              {variant.lede ? <p className="lp-how-lede">{variant.lede}</p> : null}
            </div>
            {steps.length ? <HowSteps steps={steps} /> : null}
          </div>
        </section>
      ) : null}
      <LandingReviews />
    </>
  );
}
