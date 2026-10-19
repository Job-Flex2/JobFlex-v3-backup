import { ENTRANCE_PRELUDE } from "../hero";
import { HeroEntrance } from "../hero-entrance";
import { HomeownerDoor } from "../homeowner-door";
import type { LandingVariant } from "../landing-variants";
import { Hvac2Demo } from "./hvac2-demo";
import "./hvac2.css";

/* HVAC, VERSION 2 — THE FIRST SCREEN (?industry=hvac2, 2026-10-19). The
   audit's order, top to bottom, the same on a phone and a desk:

     FOR HVAC CONTRACTORS            who it is for, in the HVAC tool's colour
     Stop Spending Hours…            the claim (or an ad's ?hook= lines)
     Start with an address…          what you do with it
     ■ ■ ■                           what you get
     REAL PRODUCT DEMO               the product, before the ask (hvac2-demo)
     [Start My 7-Day Free Trial →]   the one button — Google stays on the sign-up
     $0 today, then …                the terms, from the catalogue (hvac2-terms)
     View a sample estimate…         the proof, without an account (#sample)

   The ink ground, the type and the entrance are the landing's own hero
   (hero.tsx) arranged differently, not a new style; the base HVAC page
   keeps hero.tsx untouched. */

/** The page's one button and its two lines of terms — the hero's and the
 *  sample's here; the close (cta-footer) and the sticky bar (mobile-cta)
 *  print the same pair. `cta` is the click's tracked spot (cta-tracker). */
export function Hvac2Cta({ href, label, terms, cta, onInk = false }: { href: string; label: string; terms: [string, string]; cta: string; onInk?: boolean }) {
  return (
    <div className={`lp-h2-act${onInk ? " lp-h2-act--ink" : ""}`}>
      <a href={href} className="lp-btn-lime lp-trial-cta lp-h2-cta" data-cta={cta}>
        {label}
        <span aria-hidden>→</span>
      </a>
      <p className="lp-h2-terms">
        <span>{terms[0]}</span>
        <span>{terms[1]}</span>
      </p>
    </div>
  );
}

export function Hvac2Hero({
  variant,
  registerHref,
  trialCta,
  terms,
  hook,
}: {
  variant: LandingVariant;
  registerHref: string;
  /** "Start My 7-Day Free Trial" (the arrow is the button's) — the trial's own length. */
  trialCta: string;
  /** The two lines under the button (hvac2-terms.ts). */
  terms: [string, string];
  /** The ad hook the headline shows, for the demo's events. */
  hook?: string;
}) {
  return (
    <section id="hero" className="lp-hero lp-h2-hero">
      {/* No ridge photo behind this hero: the ink ground alone, so the first
          screen's largest paint is the demo's poster — the product — and not
          a backdrop (Lighthouse, 2026-10-19: LCP 7.8 s → 6.9 s on a phone). */}
      <div className="lp-h2-col">
        <script dangerouslySetInnerHTML={{ __html: ENTRANCE_PRELUDE }} />
        <HeroEntrance>
          {variant.kicker ? <p className="lp-h2-kicker">{variant.kicker}</p> : null}
          <h1 className={`lp-enter lp-h2-h1${variant.h1Break ? " lp-h1--lines" : ""}`} data-entrance="h1">
            {variant.h1[0]}
            {variant.h1Break ? <br /> : (
              <>
                {" "}
                <br className="lp-h2-br" />
              </>
            )}
            {variant.h1[1]}
          </h1>
          <div className="lp-enter lp-h2-sub" data-entrance="sub">
            {variant.sub ? <p className="lp-h2-lede">{variant.sub}</p> : null}
            {variant.checks?.length ? (
              <ul className="lp-h2-checks">
                {variant.checks.map((c) => (
                  <li key={c}>
                    <span className="lp-h2-tick" aria-hidden>
                      <svg viewBox="0 0 12 12"><path d="M2.5 6.2l2.3 2.3L9.5 3.8" /></svg>
                    </span>
                    {c}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <Hvac2Demo hook={hook} />
          <div className="lp-enter lp-h2-hero-act" data-entrance="cta">
            <Hvac2Cta href={registerHref} label={trialCta} terms={terms} cta="hero" onInk />
            <a href="#sample" className="lp-h2-sample-link" data-sample-link>
              View a sample estimate before signing up
            </a>
            {/* The homeowner who clicked a contractor ad, sent where they belong (as on the HVAC page). */}
            <HomeownerDoor trade="hvac" />
          </div>
        </HeroEntrance>
      </div>
    </section>
  );
}
