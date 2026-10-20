import { preload } from "react-dom";
import { PhoneOverview } from "./blueprint-phone";
import { REGISTER } from "./routes";
import { DashboardMock } from "./dashboard-mock";
import { HeroVisual } from "./hero-visual";
import { DEFAULT_LANDING, type LandingVariant, type LandingVariantKey } from "./landing-variants";
import { Reveal } from "./reveal";
import { HeroEntrance } from "./hero-entrance";
import { HeroExperiment } from "./hero-experiment";
import { HomeownerDoor } from "./homeowner-door";
import { HeroProof } from "./hero-proof";
import "./hero-fit.css";

/* THE ENTRANCE IS ARMED BY THE PAGE, NOT ASSUMED BY THE STYLESHEET
   (2026-10-04). The copy used to be server-rendered invisible and shown by
   hero-entrance once the JavaScript and gsap were in: on a phone on Google's
   mobile profile that was a black first screen for 7–8 s, and three ad
   clicks in four left without a second page. Now the headline, the line and
   the buttons are on screen from the first paint. Only a desk about to play
   the entrance holds them back: this runs as the HTML streams in, ahead of
   the copy, and sets html[data-lp-entrance] when the window is a desk's
   (1024px, a hovering fine pointer) with no reduced-motion preference —
   the one state landing-e.css hides `.lp-enter` under (the headline and
   the button; the film between them is never held). hero-entrance lifts
   it as its motion starts; if that has not happened 1.8 s on, the timer
   here lifts it and the copy simply appears. No JavaScript, a phone, a
   touch screen: never armed, never hidden. */
const ENTRANCE_PRELUDE = `(function(){try{var d=document.documentElement,w=window;if(!w.matchMedia||!w.matchMedia("(min-width: 1024px) and (hover: hover) and (pointer: fine)").matches||w.matchMedia("(prefers-reduced-motion: reduce)").matches)return;d.setAttribute("data-lp-entrance","pending");w.__jfEntranceTimer=setTimeout(function(){if(d.getAttribute("data-lp-entrance")==="pending"){d.removeAttribute("data-lp-entrance");if(w.__jfHeroShownAt===undefined)w.__jfHeroShownAt=Math.round(performance.now());}},1800);}catch(e){}})();`;

/* THE PICTURE WHOLE IN THE FIRST SCREEN (2026-10-19). Runs as the HTML
   streams in, right after the hero's two builds: finds the one on screen
   (the box marked data-fit) and writes where its picture starts, in page px,
   to html's --lp-fit-top. hero-fit.css sizes the film's frame from it — as
   wide as lets the picture end above the screen's foot (100svh). Again on a
   resize and once the fonts are in (the headline's lines move the box). A
   product shot with no film (data-fit="shot") is drawn at its own size and
   scaled down with `zoom` (html's --lp-fit-zoom — never the element's own
   style, which React hydrates) until it ends there too: a few passes, as a
   zoomed shot lays out wider and may grow taller in its own px. Without JavaScript the
   stylesheet's fallback top applies. */
const FIT_SCRIPT = `(function(){try{var d=document.documentElement,w=window,q=0;function fit(){q=0;var a=document.querySelectorAll("#hero [data-fit]"),el=null;for(var i=0;i<a.length;i++){if(a[i].getClientRects().length){el=a[i];break;}}if(!el)return;if(el.getAttribute("data-fit")==="shot"){d.style.removeProperty("--lp-fit-zoom");var z=1,foot=w.innerWidth<640?16:24;for(var k=0;k<5;k++){var r=el.getBoundingClientRect(),room=w.innerHeight-(r.top+w.scrollY)-foot;if(!(r.height>room+0.5)||z<=0.5)break;z=Math.max(0.5,Math.floor(z*room/r.height*1000)/1000);d.style.setProperty("--lp-fit-zoom",String(z));}return;}d.style.setProperty("--lp-fit-top",Math.round(el.getBoundingClientRect().top+w.scrollY)+"px");}function later(){if(!q)q=requestAnimationFrame(fit);}fit();w.addEventListener("resize",later);w.addEventListener("load",later);if(document.fonts&&document.fonts.ready)document.fonts.ready.then(later);}catch(e){}})();`;

/* The first screen, and the one screen a trade variant may replace.
   THE ORDER (2026-10-19, desk and phone alike): the one-thought headline
   (the variant's `title`; a `?hook=` puts the ad's two lines there), the
   demo film — or, with no film, the product shot — whole inside the first
   screen, then the one button and the line under it. Under the hero: the
   numbers, the reviews and the description (hero-proof.tsx). No Google
   button here — it stays on the register page. */
export function Hero({
  variant = DEFAULT_LANDING,
  variantKey,
  registerHref = REGISTER,
  cta,
  trialCta,
  priceLine = null,
  hook,
}: {
  /** The ad hook the headline shows (`?hook=`), for the demo film's events. */
  hook?: string;
  /** The button's words: the trial — "Start my 7-day FREE TRIAL" on every
   *  landing (owner, 2026-10-16). A trade's own heroCta stays in
   *  landing-variants.ts, unused here, to bring back. */
  trialCta?: string;
  /** The line under the button ("Build your free estimates"); null renders
   *  nothing. The trial's terms are Stripe's page's, never this line's. */
  priceLine?: string | null;
  variant?: LandingVariant;
  /** The variant's key, for the film's events and the homeowner's door. */
  variantKey?: LandingVariantKey;
  registerHref?: string;
  /** landing-e: the first-person CTA replaces the variant's own words. */
  cta?: string;
}) {
  const shot = variant.visual !== "dashboard";
  // An ad landing (landing-variants.ts, 2026-10-04): the homeowner's door under the button.
  const adScreen = shot && !!variant.shotCta;
  const words = trialCta ?? cta ?? variant.primaryCta;
  // The hero plate is the LCP element: preload the one this viewport's CSS
  // will ask for (landing-e.css switches at 860 px). One <link rel="preload">
  // per breakpoint in <head>, with imagesrcset/imagesizes and a media query.
  preload("/landing-d/bg-hero-ridge-800.webp", { as: "image", imageSrcSet: "/landing-d/bg-hero-ridge-800.webp 800w", imageSizes: "100vw", media: "(max-width: 860px)" });
  preload("/landing-d/bg-hero-ridge-1600.webp", { as: "image", imageSrcSet: "/landing-d/bg-hero-ridge-1600.webp 1600w", imageSizes: "100vw", media: "(min-width: 861px)" });
  return (
    <>
    <section id="hero" className="lp-hero">
      <div className="lp-bg lp-bg--ridge" aria-hidden />
      <div className="lp-fold relative z-[1] mx-auto max-w-[86rem] px-5 text-center sm:px-6">
        {/* The entrance (pass C): H1 lines out of a mask, the button +250 ms
            — hero-entrance.tsx, on a desk the prelude has armed. `.lp-enter`
            marks the two blocks; they are hidden only under
            html[data-lp-entrance] (ENTRANCE_PRELUDE above). */}
        <script dangerouslySetInnerHTML={{ __html: ENTRANCE_PRELUDE }} />
        <HeroEntrance>
        {/* A/B landing_hero_v1 (scaffold, not running): the headline block
            is the experiment's slot, on the default hero only — a trade
            variant is its own page and is never bucketed. */}
        <HeroExperiment enabled={!variantKey}>
        <h1 className={`lp-enter lp-fold-h1${variant.title ? "" : " lp-h1--lines"}`} data-entrance="h1">
          {variant.title ?? (
            <>
              {variant.h1[0]}
              <br />
              {variant.h1[1]}
            </>
          )}
        </h1>
        </HeroExperiment>
        {/* Two builds of the same screen, not one build clipped: the desktop
            plate's 208px sidebar and four-across KPI row cannot survive a
            phone column (owner, 2026-08-25). An estimator shot or a film is
            one build for both, each copy switched by the same 640 px. */}
        <div className="lp-fold-vis">
          <Reveal shown className="sm:hidden">
            {variant.film ? (
              <HeroVisual variant={variant} slot="phone" hook={hook} landing={variantKey} />
            ) : (
              <div data-fit="shot">{shot ? <HeroVisual variant={variant} slot="phone" hook={hook} landing={variantKey} /> : <PhoneOverview />}</div>
            )}
          </Reveal>
          <div className="mx-auto hidden lp-wrap sm:block">
            <Reveal shown>
              {variant.film ? (
                <HeroVisual variant={variant} slot="desk" hook={hook} landing={variantKey} />
              ) : (
                <div data-fit="shot">{shot ? <HeroVisual variant={variant} slot="desk" hook={hook} landing={variantKey} /> : <DashboardMock />}</div>
              )}
            </Reveal>
          </div>
        </div>
        <script dangerouslySetInnerHTML={{ __html: FIT_SCRIPT }} />
        {/* The one button, right under the picture: a thumb wide on a phone.
            The line under it is the page's (landing-e-page.tsx). */}
        <div className="lp-enter lp-fold-cta" data-entrance="cta">
          <a href={registerHref} className={`lp-btn-dark lp-cta lp-cta--solid lp-trial-cta${words.length > 30 ? " lp-cta--long" : ""}`} data-cta="hero">
            {words}
          </a>
          {priceLine ? <p className="lp-hero-price">{priceLine}</p> : null}
          {/* The homeowner who clicked a contractor ad, sent where they belong (2026-10-16). */}
          {adScreen ? <HomeownerDoor trade={variantKey} /> : null}
        </div>
        </HeroEntrance>
      </div>
    </section>
    <HeroProof variant={variant} />
    </>
  );
}
