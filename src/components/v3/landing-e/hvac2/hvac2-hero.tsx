import { ENTRANCE_PRELUDE } from "../hero";
import { HeroEntrance } from "../hero-entrance";
import { HomeownerDoor } from "../homeowner-door";
import type { LandingVariant } from "../landing-variants";
import { Hvac2Demo } from "./hvac2-demo";
import "./hvac2.css";

/* HVAC, VERSION 2 — THE FIRST SCREEN (?industry=hvac2, 2026-10-19). The
   October audit's order, top to bottom, the same on a phone and a desk:

     FOR HVAC CONTRACTORS            who it is for
     Stop Spending Hours…            the claim (or an ad's ?hook= lines)
     Start with an address…          what you do with it
     ✓ ✓ ✓                           what you get
     REAL PRODUCT DEMO               the product, before the ask
     [Start My 7-Day Free Trial →]   one button — Google stays on the sign-up
     $0 today, then …                the terms, from the catalogue (hvac2-terms)
     View a sample estimate…         the proof, without signing up (#sample)

   On a phone the demo's frame is short enough that the button is in the
   first screen of a 390×844 window and of Facebook's and Instagram's in-app
   browsers (hvac2.css); on a desk the demo sits in the app frame. The ink
   ground, the ridge photo, the type and the entrance are the landing's own
   hero (hero.tsx) — this is another arrangement of the same pieces, not a
   new style. The base HVAC page keeps hero.tsx as it was. */
export function Hvac2Hero({
  variant,
  registerHref,
  trialCta,
  terms,
}: {
  variant: LandingVariant;
  registerHref: string;
  /** "Start My 7-Day Free Trial" (the arrow is the button's) — the trial's own length. */
  trialCta: string;
  /** The two lines under the button (hvac2-terms.ts). */
  terms: [string, string];
}) {
  return (
    <section id="hero" className="lp-hero lp-h2-hero">
      {/* The ridge plate, the first screen's largest paint, as a picture in the HTML rather than
          the stylesheet's background: the browser asks for it as it reads the markup, at high
          priority, instead of after the CSS and behind the scripts (Lighthouse, 2026-10-19: a
          preload() from the hero is streamed after <head> and never reaches the first bytes).
          Same files, crop, mask and fade as hero.tsx's plate (landing-e.css .lp-bg--ridge). */}
      <div className="lp-bg lp-bg--ridge lp-h2-ridge" aria-hidden>
        <picture>
          <source media="(max-width: 860px)" srcSet="/landing-d/bg-hero-ridge-800.webp" />
          <img src="/landing-d/bg-hero-ridge-1600.webp" alt="" fetchPriority="high" decoding="async" />
        </picture>
      </div>
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
                    <svg viewBox="0 0 16 16" aria-hidden><path d="M3 8.5l3.2 3L13 4.5" /></svg>
                    {c}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <Hvac2Demo />
          <div className="lp-enter lp-h2-act" data-entrance="cta">
            <a href={registerHref} className="lp-btn-lime lp-trial-cta lp-h2-cta" data-cta="hero">
              {trialCta}
              <span aria-hidden>→</span>
            </a>
            <p className="lp-h2-terms">
              <span>{terms[0]}</span>
              <span>{terms[1]}</span>
            </p>
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
