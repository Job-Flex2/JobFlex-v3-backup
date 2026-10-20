/* UNDER THE HERO (2026-10-19), on every landing: the description, then the
   reviews — before the page's usual sections.

   The description is the variant's `pitch` as the heading and three rows
   under it, each the line from `points` beside the figure of the same index
   from `proof` (landing-variants.ts — the figures' sources are listed
   there), the figure in the trade estimator's colour. */

import type { CSSProperties } from "react";
import type { LandingVariant } from "./landing-variants";
import { LandingReviews } from "./landing-reviews";

/* The estimator's colour (globals.css --tool-*); a Smart Proposal trade
   takes the Smart tool's, the default page the accent. */
const TOOL: Record<LandingVariant["visual"], string> = {
  hvac: "var(--tool-hvac)",
  roof: "var(--tool-roof)",
  fence: "var(--tool-fence)",
  deck: "var(--tool-deck)",
  smart: "var(--tool-smart)",
  dashboard: "var(--accent)",
};

export function HeroProof({ variant }: { variant: LandingVariant }) {
  const rows = variant.points && variant.proof ? variant.points.map((text, i) => ({ text, ...variant.proof![i] })) : [];
  return (
    <section className="lp-proof" aria-label="What JobFlex does">
      <div className="lp-proof-wrap">
        {variant.pitch ? (
          <div className="lp-pitch" style={{ "--lp-tool": TOOL[variant.visual] } as CSSProperties}>
            <h2 className="lp-pitch-text">{variant.pitch}</h2>
            {rows.length ? (
              <ul className="lp-figs">
                {rows.map((r) => (
                  <li key={r.text} className="lp-fig">
                    <span className="lp-fig-val">
                      <span className="lp-fig-n">{r.value}</span>
                      <span className="lp-fig-l">{r.label}</span>
                    </span>
                    <span className="lp-fig-t">{r.text}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        <LandingReviews />
      </div>
    </section>
  );
}
