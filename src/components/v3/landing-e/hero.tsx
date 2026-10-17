import { preload } from "react-dom";
import { PhoneOverview } from "./blueprint-phone";
import { REGISTER } from "./routes";
import { DashboardMock } from "./dashboard-mock";
import { HeroVisual } from "./hero-visual";
import { DEFAULT_LANDING, type LandingVariant, type LandingVariantKey, type UtmParams } from "./landing-variants";
import { Reveal } from "./reveal";
import { GoogleSignupButton } from "./google-signup-button";
import { HeroEntrance } from "./hero-entrance";
import { HeroExperiment } from "./hero-experiment";
import type { InAppBrowser } from "@/lib/inAppBrowser";
import { HomeownerDoor } from "./homeowner-door";

/* THE ENTRANCE IS ARMED BY THE PAGE, NOT ASSUMED BY THE STYLESHEET
   (2026-10-04). The copy used to be server-rendered invisible and shown by
   hero-entrance once the JavaScript and gsap were in: on a phone on Google's
   mobile profile that was a black first screen for 7–8 s, and three ad
   clicks in four left without a second page. Now the headline, the line and
   the buttons are on screen from the first paint. Only a desk about to play
   the entrance holds them back: this runs as the HTML streams in, ahead of
   the copy, and sets html[data-lp-entrance] when the window is a desk's
   (1024px, a hovering fine pointer) with no reduced-motion preference —
   the one state landing-e.css hides `.lp-enter` under. hero-entrance lifts
   it as its motion starts; if that has not happened 1.8 s on, the timer
   here lifts it and the copy simply appears. No JavaScript, a phone, a
   touch screen: never armed, never hidden. */
const ENTRANCE_PRELUDE = `(function(){try{var d=document.documentElement,w=window;if(!w.matchMedia||!w.matchMedia("(min-width: 1024px) and (hover: hover) and (pointer: fine)").matches||w.matchMedia("(prefers-reduced-motion: reduce)").matches)return;d.setAttribute("data-lp-entrance","pending");w.__jfEntranceTimer=setTimeout(function(){if(d.getAttribute("data-lp-entrance")==="pending"){d.removeAttribute("data-lp-entrance");if(w.__jfHeroShownAt===undefined)w.__jfHeroShownAt=Math.round(performance.now());}},1800);}catch(e){}})();`;

/* The first screen, and the one screen a trade variant may replace. The
   headline, the line under it, the solid button's words and the product shot
   come from the variant (landing-variants.ts); DEFAULT_LANDING IS the
   original copy, so a page with no `?industry=` renders exactly what it did
   before variants existed. Reveal and parallax wrappers are shared. */
export function Hero({
  variant = DEFAULT_LANDING,
  variantKey,
  utm,
  registerHref = REGISTER,
  cta,
  trialCta,
  fbclid,
  inAppBrowser = null,
  priceLine = null,
}: {
  /** The solid button's words: the trial, as on the default page — "Start my
   *  7-day free trial" on every landing (owner, 2026-10-16). A trade's own
   *  heroCta stays in landing-variants.ts, unused here, to bring back. */
  trialCta?: string;
  /** The trade's price for the first screen ("Then from $95/mo · roof
   *  estimator included"), read from the plan catalogue by the page
   *  (hero-price.ts). Null — every landing but an ad landing — renders nothing. */
  priceLine?: string | null;
  /** The in-app browser the server read from the request (lib/inAppBrowser):
   *  no Google button there, from the first paint. */
  inAppBrowser?: InAppBrowser | null;
  variant?: LandingVariant;
  /** The variant's key, for the Google button's cookie and callback. */
  variantKey?: LandingVariantKey;
  utm?: UtmParams;
  registerHref?: string;
  /** landing-e: the first-person CTA replaces the variant's own words. */
  cta?: string;
  /** Meta's click id, for the Google button's callback (the register links have it in registerHref). */
  fbclid?: string;
}) {
  const shot = variant.visual !== "dashboard";
  // An ad landing's first screen (landing-variants.ts, 2026-10-04): tighter
  // on a phone, so the claim, the button, the trial and the price are all
  // above the fold and the product shot starts inside it.
  const adScreen = shot && !!variant.shotCta;
  // The hero plate is the LCP element: preload the one this viewport's CSS
  // will ask for (landing-e.css switches at 860 px). One <link rel="preload">
  // per breakpoint in <head>, with imagesrcset/imagesizes and a media query.
  preload("/landing-d/bg-hero-ridge-800.webp", { as: "image", imageSrcSet: "/landing-d/bg-hero-ridge-800.webp 800w", imageSizes: "100vw", media: "(max-width: 860px)" });
  preload("/landing-d/bg-hero-ridge-1600.webp", { as: "image", imageSrcSet: "/landing-d/bg-hero-ridge-1600.webp 1600w", imageSizes: "100vw", media: "(min-width: 861px)" });
  return (
    <section id="hero" className="lp-hero">
      <div className="lp-bg lp-bg--ridge" aria-hidden />
      <div className={`relative z-[1] mx-auto flex max-w-[86rem] flex-col items-center gap-3 px-5 pt-[12vmin] text-center sm:pt-[14vmin]${adScreen ? " lp-hero-copy--ad" : ""}`}>
        {/* No launch line above the headline (owner, 2026-10-14): the gold
            "Just launched" link is gone from every variant. The column's own
            top padding is the gap under the nav, so the headline now starts
            exactly where that link did. */}
        {/* The entrance (pass C): H1 lines out of a mask, sub +150 ms, buttons
            +250 ms — hero-entrance.tsx, on a desk the prelude has armed.
            `.lp-enter` marks the three blocks; they are hidden only under
            html[data-lp-entrance] (ENTRANCE_PRELUDE above). */}
        <script dangerouslySetInnerHTML={{ __html: ENTRANCE_PRELUDE }} />
        <HeroEntrance>
        {/* A/B landing_hero_v1 (scaffold, not running): the headline block
            is the experiment's slot, on the default hero only — a trade
            variant is its own page and is never bucketed. */}
        <HeroExperiment enabled={!variantKey}>
        <h1
          className={`lp-enter ${variant.h1Long ? "text-[clamp(32px,4.8vw,68px)]" : "text-[clamp(38px,6.7vw,96px)]"} font-bold leading-[1.02] tracking-[-0.025em] text-ink${variant.h1Break ? " lp-h1--lines" : ""}`}
          data-entrance="h1"
        >
          {variant.h1[0]}
          {/* A sentence-long headline breaks where it falls on a phone; the
              set break is the desk's. An ad's opening line and its answer
              (h1Break) are two sentences and keep the break everywhere. */}
          {variant.h1Long && !variant.h1Break ? (
            <>
              {" "}
              <br className="hidden sm:inline" />
            </>
          ) : (
            <br />
          )}
          {variant.h1[1]}
        </h1>
        {/* The line under the headline exists only on trade variants; the
            default hero never had one and renders nothing here. */}
        {variant.sub && !variant.subStrong && (
          <p className={`lp-enter mx-auto max-w-[38rem] text-[15px] leading-[1.5] text-white/70 sm:text-[17px] lg:max-w-[46rem]${variant.subEven ? " lp-sub--even" : ""}`} data-entrance="sub">{variant.sub}</p>
        )}
        {/* A sub with a bold line of its own under it (HVAC, 2026-10-01): the
            two arrive together, as the one sub block the entrance moves. */}
        {variant.sub && variant.subStrong && (
          <div className="lp-enter mx-auto max-w-[38rem] lg:max-w-[46rem]" data-entrance="sub">
            <p className="text-[15px] leading-[1.5] text-white/70 sm:text-[17px]">{variant.sub}</p>
            <p className="mt-3 text-[16px] font-bold leading-[1.4] text-white sm:text-[18px]">{variant.subStrong}</p>
          </div>
        )}
        </HeroExperiment>
        <div className="lp-enter w-full sm:w-auto" data-entrance="cta">
          {/* The pair, and nothing under it (owner, 2026-10-15): the framed
              "Start your 7-day free trial" badge that sat beneath it is gone
              from every landing — it read as a third button. The product shot
              follows at the hero's own 8vmin. */}
          <div className="mx-auto mt-4 flex w-full max-w-[22rem] flex-col gap-3 sm:w-auto sm:max-w-none">
          <div className="flex w-full flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-center">
            <a
              href={registerHref}
              className={`lp-btn-dark lp-cta lp-cta--solid${(trialCta ?? cta ?? variant.primaryCta).length > 30 ? " lp-cta--long" : ""}`}
              data-cta="hero"
            >
              {trialCta ?? cta ?? variant.primaryCta}
            </a>
            <GoogleSignupButton className="lp-cta lp-cta--ghost" industry={variantKey} utm={utm} fbclid={fbclid} inApp={inAppBrowser}>
              <svg viewBox="0 0 48 48" className="h-[18px] w-[18px]" aria-hidden>
                <path
                  fill="#FFC107"
                  d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.5 6.1 29.5 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.7-.4-3.9z"
                />
                <path
                  fill="#FF3D00"
                  d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.5 6.1 29.5 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
                />
                <path
                  fill="#4CAF50"
                  d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
                />
                <path
                  fill="#1976D2"
                  d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.5l6.2 5.2C41.4 34.9 44 30 44 24c0-1.3-.1-2.7-.4-3.9z"
                />
              </svg>
              Sign up with Google
            </GoogleSignupButton>
          </div>
          </div>
          {/* The price, in the first screen (2026-10-04): under the buttons,
              in the landing's mono caps. The trial it follows is the button
              above it (owner, 2026-10-16), so the line says only the price. */}
          {priceLine ? <p className="lp-hero-price">{priceLine}</p> : null}
        </div>
        </HeroEntrance>
      </div>

      <div className={`lp-hero-vis relative z-[1] mt-[8vmin] px-5 pb-[26vmin] sm:px-6${adScreen ? " lp-hero-vis--cta" : ""}`}>
        {/* Two builds of the same screen, not one build clipped: the desktop
            plate's 208px sidebar and four-across KPI row cannot survive a
            phone column (owner, 2026-08-25). The phone build also skips
            lp-wrap, whose gutter would double the section's own px-5.
            An estimator shot is one build for both: its takeoff rail stacks
            under the stage below 640px by its own media query. */}
        <Reveal shown className="sm:hidden">
          {shot ? <HeroVisual variant={variant} /> : <PhoneOverview />}
        </Reveal>
        <div className="mx-auto hidden lp-wrap sm:block">
          <Reveal shown>
            <div data-parallax="18">{shot ? <HeroVisual variant={variant} /> : <DashboardMock />}</div>
          </Reveal>
        </div>
        {/* THE BUTTON UNDER THE SHOT (2026-10-04; the analyst: "they leave at
            the hero — put a sign-up button right there, at the point where
            they stop"). The shot has just shown the estimate being made; the
            next thing under it is the way to make one. The top-of-page words,
            the blue of every section's button.
            Clicks are `cta_click` with placement "hero-shot". */}
        {adScreen ? (
          <div className="lp-hero-after">
            <a href={registerHref} className="lp-btn-lime w-full sm:w-auto" data-cta="hero-shot">
              {cta ?? variant.primaryCta}
              <span aria-hidden>→</span>
            </a>
            {/* The homeowner who clicked a contractor ad, sent where they belong (2026-10-16). */}
            <HomeownerDoor trade={variantKey} />
          </div>
        ) : null}
      </div>
    </section>
  );
}
