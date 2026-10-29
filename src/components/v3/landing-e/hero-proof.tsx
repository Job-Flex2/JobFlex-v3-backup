/* UNDER THE HERO (2026-10-19), on every landing: how it works (#how), then
   the reviews — before the page's usual sections.

   HOW IT WORKS: the trade's tool as a kicker, the variant's `pitch` and its
   `lede`, centred; then three steps across the container. Each step is a
   real frame of that step (`how`, landing-variants.ts) with its figure on a
   plate in the blueprint blue (--accent, the app's own; the same on every
   trade since 2026-10-29 — the tool's colour stays on the sidebar, the
   estimator icons, the showcase and the films) at the frame's lower-left
   corner, then the step's number and line (`points`) and the figure's
   words (`proof`) — each figure belongs to its line, its source listed in
   landing-variants.
   No arrows, no scales, no motion. Phone: the steps in a column. */

import type { LandingVariant } from "./landing-variants";
import { LandingReviews } from "./landing-reviews";
import { HowImg } from "./how-img";

export function HeroProof({ variant }: { variant: LandingVariant }) {
  const { points, proof, how } = variant;
  const steps = points && proof && how ? points.map((title, i) => ({ title, ...proof[i], ...how[i] })) : [];
  return (
    <>
      {variant.pitch ? (
        <section id="how" className="lp-how">
          <div className="lp-how-wrap">
            <header className="lp-how-head">
              {variant.kicker ? <p className="lp-how-kicker">{variant.kicker}</p> : null}
              <h2 className="lp-how-pitch">{variant.pitch}</h2>
              {variant.lede ? <p className="lp-how-lede">{variant.lede}</p> : null}
            </header>
            {steps.length ? (
              <ol className="lp-how-steps">
                {steps.map((s, i) => (
                  <li key={s.title} className="lp-how-step">
                    <figure className="lp-how-shot">
                      <HowImg src={s.img} alt={s.alt} />
                      <figcaption className="lp-how-plate">
                        <span className="lp-how-val">{s.value}</span>
                        <span className="lp-how-plate-l">{s.label}</span>
                      </figcaption>
                    </figure>
                    <h3 className="lp-how-title">
                      <span className="lp-how-num">{String(i + 1).padStart(2, "0")}</span>
                      {s.title}
                    </h3>
                    <p className="lp-how-label">{s.label}</p>
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
        </section>
      ) : null}
      <LandingReviews />
    </>
  );
}
