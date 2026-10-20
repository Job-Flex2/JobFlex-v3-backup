/* UNDER THE HERO (2026-10-19), on every landing: the numbers, the reviews,
   then the description — before the page's usual sections.

   THE NUMBERS ARE THE PAGE'S OWN. Every card says something the landing
   already shows or the product already does — nothing new is claimed here:
   - "< 1 min": the estimator films run 40–44 s from the address to the
     proposal (demo-media DEMO_CAPTION) — the HVAC, roof and fence pages;
   - "90 s": the Deck Studio film's own card, "From the first click to the
     client's signature, in ninety seconds";
   - "0": the estimate is made before a site visit (the HVAC, roof and fence
     heroes' own copy: "before the first site visit", "without … driving to
     the job first");
   - "$40M+": the stats section's "Companies using JobFlex made $40,000,000+";
   - "1 app": estimate, proposal, the client's signature and the deposit in
     the one app (the roofing ads' "Address to Signature. One App.", "Get
     Paid by Stage");
   - "4": the four estimators of their own — roof, fence, HVAC, deck.
   Three cards where the page has three facts, four where it has four. */

import type { CSSProperties } from "react";
import type { LandingVariant } from "./landing-variants";
import { LandingReviews } from "./landing-reviews";

type Stat = { n: string; t: string };

const MADE: Stat = { n: "$40M+", t: "made by companies using JobFlex" };
const ONE_APP: Stat = { n: "1 app", t: "estimate, proposal, signature and payment" };

function statsFor(v: LandingVariant): Stat[] {
  if (v.film === "deck") return [{ n: "90 s", t: "first click to signature in the demo above" }, MADE, ONE_APP];
  if (v.film) return [{ n: "< 1 min", t: "address to proposal in the demo above" }, { n: "0", t: "site visits before the estimate" }, MADE, ONE_APP];
  return [MADE, ONE_APP, { n: "4", t: "estimators of their own: roof, fence, HVAC and deck" }];
}

/* The tick's colour is the trade's estimator's (globals.css --tool-*); a
   Smart Proposal trade takes the Smart tool's, the default page the accent. */
const TICK: Record<LandingVariant["visual"], string> = {
  hvac: "var(--tool-hvac)",
  roof: "var(--tool-roof)",
  fence: "var(--tool-fence)",
  deck: "var(--tool-deck)",
  smart: "var(--tool-smart)",
  dashboard: "var(--accent)",
};

export function HeroProof({ variant }: { variant: LandingVariant }) {
  const stats = statsFor(variant);
  return (
    <section className="lp-proof" aria-label="JobFlex in numbers">
      <div className="lp-proof-wrap">
        <ul className={`lp-stats${stats.length % 2 ? " lp-stats--odd" : ""}`}>
          {stats.map((s) => (
            <li key={s.n} className="lp-stat">
              <span className="lp-stat-n">{s.n}</span>
              <span className="lp-stat-t">{s.t}</span>
            </li>
          ))}
        </ul>
        <LandingReviews />
        {variant.pitch ? (
          <div className="lp-proof-block lp-pitch">
            <p className="lp-pitch-text">{variant.pitch}</p>
            {variant.points ? (
              <ul className="lp-points" style={{ "--lp-tick": TICK[variant.visual] } as CSSProperties}>
                {variant.points.map((p) => (
                  <li key={p} className="lp-point">
                    <span className="lp-tick" aria-hidden>
                      <svg viewBox="0 0 12 12" width="12" height="12">
                        <path d="M2.5 6.2 5 8.6 9.6 3.6" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="square" />
                      </svg>
                    </span>
                    {p}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
