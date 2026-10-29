"use client";

// MOBILE HOMEOWNER MARKETING — the handheld build of /homeowner.
//
// Served at `/homeowner` at ≤768px through the media-query switch in
// `src/app/(marketing)/homeowner/homeowner-responsive.tsx`; the desktop build
// (src/components/v3/homeowner-landing/*) serves every viewport above 768px.
// Exactly one of the two trees is ever mounted. (The standalone preview route
// was removed 2026-10-02 — /homeowner is the one address.)
//
// ── COPY IS VERBATIM ───────────────────────────────────────────────────────
// Every headline, sub, trust line, step title, card caption, review, CTA and
// footer label is the desktop page's own string, character for character. The
// wizard's questions, category list, placeholders and contact fields are not
// even re-typed — they are imported from `homeowner-landing/homeowner-data.ts`,
// so marketing copy cannot drift between the two builds.
//
// ── WHAT IS RE-COMPOSED, AND WHY ───────────────────────────────────────────
// · NAV is sticky. On a ~5,000px handheld composition the contractor exit is
//   otherwise reachable only from the very top, and the brand mark doubles as
//   the "back to the wizard" anchor for the closing CTA's neighbours. The
//   donor's "Homeowner Portal" tag becomes the second row of the brand lockup
//   (the house `mobile-nav` pattern) instead of being dropped, as the desktop
//   page drops it below 700px.
// · TRUST ROW is one framed block with internal hairlines, not three floating
//   cards — DESIGN.md's KPI-strip pattern.
// · STEPS stack full width. The desktop 2×2 fold rescues itself with
//   `transform: scale(.658)`, which renders the mono annotations at ~4.9px.
// · NETWORK CARDS stack full width for the same reason: in a 2-up grid at
//   320px each 200×200 drawing renders at 0.69 and its dimension callouts
//   become unreadable. These four drawings are the page's strongest asset.
// · REVIEWS lead with the photo board, then the quotes. See the note on the
//   144px band below.
//
// ── THE 144px EMPTY BAND ───────────────────────────────────────────────────
// The desktop page has a dead `.arch { padding-bottom: 0 }` inside its
// `@media (max-width: 1080px)` block: a trailing "фотодоска" section
// re-declares `.arch { padding-bottom: clamp(140px, 16vh, 182px) }` AFTER the
// media query at equal specificity and wins on source order, while the media
// query has already set `.arch-col { display: none }`. Below 1080px that
// leaves a 144px void under the heading, reserved for photographs that are not
// being drawn. (`.arch-mid { top: 296px }` from the same block is inert —
// the media query makes `.arch-mid` static.)
//
// Not patched — designed away. The photographs come BACK on handheld as a
// two-column board, the heading is an ordinary flow sibling above it, and this
// build's `.arch` carries no `padding-bottom` at any width, no `display: none`
// column and nothing positioned out of flow. There is no reserved space, so
// there is nothing to leave empty.
//
// ── PHOTOGRAPHY ────────────────────────────────────────────────────────────
// The eight plates still hotlink images.unsplash.com, as plain `<img>` — not
// `next/image`, because the plates are sized entirely from CSS
// (`position: absolute; inset: 0`) and next/image's wrapper changes the box.
// `next.config.ts`'s `images.remotePatterns` therefore does not govern them.
// Three deliberate handheld decisions, and one flag:
//   · the request width drops 640 → 400 and quality 70 → 62. A plate is at
//     most ~139 CSS px wide here; 400px still covers a 3× screen and cuts
//     roughly two thirds of the bytes off a page that a homeowner may well
//     open on cellular.
//   · `loading="lazy"` + `decoding="async"`: all eight sit far below the fold,
//     behind the wizard, the steps and the whole ink band.
//   · LAYOUT SHIFT IS STRUCTURALLY IMPOSSIBLE — each plate box has an explicit
//     height and the image is absolutely positioned inside it, so an image
//     that arrives late, slowly, or never changes no geometry.
//   · FAILURE degrades to the blueprint hatch and the mono label rather than a
//     hole, via the donor's `onerror` expressed as state (tearing the node out
//     from under React invites a removeChild crash on the next reconcile).
// Still a third-party dependency on a public marketing page. Flagged for the
// owner rather than silently localised — see the report.

import "./mobile-homeowner.css";
import { Fragment, useState } from "react";
import Link from "next/link";
import { MobileHomeownerSprite } from "./mobile-homeowner-sprite";
import { MobileStepsGrid } from "./mobile-homeowner-vignettes";
import { MobileHomeownerWizard } from "./mobile-homeowner-wizard";
import type { WizardPrefill } from "@/lib/home/prefill";
import { portalHeroSub } from "@/lib/home/portalPrice";
import { StoryQuestions, WhyJobflex } from "../homeowner-landing/homeowner-story-sections";
import {
  useInViewOnce,
  useReducedMotion,
  useReveal,
} from "../homeowner-landing/use-homeowner-behavior";
import { useBandParallax, useNetCountLabel } from "./use-mobile-homeowner-behavior";

/* nc-1: the licence barcode, sixteen bars. */
const NC1_BARS: Array<[string, string]> = [
  ["50.0", "1.5"],
  ["52.9", "3.0"],
  ["57.3", "1.5"],
  ["60.2", "2.0"],
  ["63.6", "4.0"],
  ["69.0", "1.5"],
  ["71.9", "2.5"],
  ["75.8", "3.5"],
  ["80.7", "1.5"],
  ["83.6", "2.0"],
  ["87.0", "3.0"],
  ["91.4", "1.5"],
  ["94.3", "2.5"],
  ["98.2", "2.0"],
  ["101.6", "4.0"],
  ["107.0", "1.5"],
];

/* nc-2: the coverage plat, three rows of ten cells; `fill` marks the sky-blue
   parcels. */
const NC2_CELLS: Array<{ x: string; y: string; fill: boolean }> = [
  { x: "27.00", y: "106.00", fill: false },
  { x: "42.00", y: "106.00", fill: false },
  { x: "57.00", y: "106.00", fill: true },
  { x: "72.00", y: "106.00", fill: false },
  { x: "87.00", y: "106.00", fill: false },
  { x: "102.00", y: "106.00", fill: true },
  { x: "117.00", y: "106.00", fill: false },
  { x: "132.00", y: "106.00", fill: false },
  { x: "147.00", y: "106.00", fill: true },
  { x: "162.00", y: "106.00", fill: false },
  { x: "27.00", y: "121.00", fill: false },
  { x: "42.00", y: "121.00", fill: true },
  { x: "57.00", y: "121.00", fill: false },
  { x: "72.00", y: "121.00", fill: false },
  { x: "87.00", y: "121.00", fill: true },
  { x: "102.00", y: "121.00", fill: false },
  { x: "117.00", y: "121.00", fill: false },
  { x: "132.00", y: "121.00", fill: true },
  { x: "147.00", y: "121.00", fill: false },
  { x: "162.00", y: "121.00", fill: false },
  { x: "27.00", y: "136.00", fill: false },
  { x: "42.00", y: "136.00", fill: false },
  { x: "57.00", y: "136.00", fill: true },
  { x: "72.00", y: "136.00", fill: false },
  { x: "87.00", y: "136.00", fill: false },
  { x: "102.00", y: "136.00", fill: true },
  { x: "117.00", y: "136.00", fill: false },
  { x: "132.00", y: "136.00", fill: false },
  { x: "147.00", y: "136.00", fill: true },
  { x: "162.00", y: "136.00", fill: false },
];

/* nc-2: four map pins, each a filled teardrop plus a sky dot. */
const NC2_PINS: Array<{ d: string; cx: string; cy: string }> = [
  { d: "M62.50 111.50c0 0-4.5-5.5-4.5-8.5a4.5 4.5 0 019 0c0 3-4.5 8.5-4.5 8.5z", cx: "62.50", cy: "103.00" },
  { d: "M47.50 126.50c0 0-4.5-5.5-4.5-8.5a4.5 4.5 0 019 0c0 3-4.5 8.5-4.5 8.5z", cx: "47.50", cy: "118.00" },
  { d: "M137.50 126.50c0 0-4.5-5.5-4.5-8.5a4.5 4.5 0 019 0c0 3-4.5 8.5-4.5 8.5z", cx: "137.50", cy: "118.00" },
  { d: "M152.50 141.50c0 0-4.5-5.5-4.5-8.5a4.5 4.5 0 019 0c0 3-4.5 8.5-4.5 8.5z", cx: "152.50", cy: "133.00" },
];

/* The photo board. Heights are the desktop arch's own 172/134/190/228/210/
   172/134/172 taken to ~75%, which keeps the arch's rhythm — the tall Roof
   plate still anchors the board — while fitting eight plates into a phone
   column. Explicit heights, not `aspect-ratio`: the box has to be a known size
   before the photograph arrives, or a slow image would reflow the section. */
const PLATES: Array<{ height: number; src: string; label: string }> = [
  { height: 129, src: "https://images.unsplash.com/photo-1721134115634-ab794ccfc81e?w=400&q=62&auto=format&fit=crop", label: "Deck rebuild" },
  { height: 100, src: "https://images.unsplash.com/photo-1556911220-bff31c812dba?w=400&q=62&auto=format&fit=crop", label: "Kitchen" },
  { height: 142, src: "https://images.unsplash.com/photo-1552321554-5fefe8c9ef14?w=400&q=62&auto=format&fit=crop", label: "Bath" },
  { height: 171, src: "https://images.unsplash.com/photo-1570129477492-45c003edd2be?w=400&q=62&auto=format&fit=crop", label: "Roof" },
  { height: 157, src: "https://images.unsplash.com/photo-1676268479279-5a7dcf050634?w=400&q=62&auto=format&fit=crop", label: "Fence" },
  { height: 129, src: "https://images.unsplash.com/photo-1682888818704-6dc91e9d7532?w=400&q=62&auto=format&fit=crop", label: "Tile" },
  { height: 100, src: "https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=400&q=62&auto=format&fit=crop", label: "Flooring" },
  { height: 129, src: "https://images.unsplash.com/photo-1513694203232-719a280e022f?w=400&q=62&auto=format&fit=crop", label: "Basement" },
];

/* The shared house mark (/jobflex-mark.png), clipped the way landing-e does it
   — the "JF" plate was the donor's placeholder, not the brand. Sized and inset
   by mobile-homeowner.css (.brand-mark / .brand-mark-img). */
function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset, sized by CSS */}
      <img className="brand-mark-img" src="/jobflex-mark.png" alt="" />
    </span>
  );
}

function Plate({ height, src, label }: { height: number; src: string; label: string }) {
  const [dead, setDead] = useState(false);
  return (
    <div className="plate" style={{ height: `calc(${height}px * var(--s))` }}>
      {dead ? null : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="plate-ph"
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setDead(true)}
        />
      )}
      <div className="plate-l">{label}</div>
    </div>
  );
}

/** The 2,300+ figure on the COVERAGE drawing. Its own component so the 60fps
 *  count-up re-renders one <tspan> rather than the page. */
function NetCount() {
  const seen = useInViewOnce("jfmh-net", 0.35);
  const reduced = useReducedMotion();
  const label = useNetCountLabel(seen, reduced);
  return <tspan>{label}</tspan>;
}

export function MobileHomeowner({ prefill = null, house = false }: { prefill?: WizardPrefill | null; house?: boolean }) {
  const rv = useReveal();
  useBandParallax("jfmh-net");

  return (
    <div className="jf-mobile-homeowner">
      <MobileHomeownerSprite />

      <noscript>
        <div className="nojs">
          This page is interactive — enable JavaScript to walk through the project wizard.
        </div>
      </noscript>

      <nav className="nav">
        <a className="brand" href="#jfmh-top" aria-label="JobFlex home">
          <BrandMark />
          <span className="nav-txt">
            <span className="brand-txt">JOBFLEX</span>
            <span className="nav-tag">Homeowner Portal</span>
          </span>
        </a>
        <Link className="nav-cta" href="/">
          For contractors
          <svg className="ic ic-sm">
            <use href="#jfmh-i-arrow-r" />
          </svg>
        </Link>
      </nav>

      <section className="hero anchor-top" id="jfmh-top">
        <div className="hero-in">
          <div className="hero-top">
            <div className="pill anim a1">
              Free — no account required
            </div>
            {/* ONE PORTAL (2026-10-28, lib/home/portalPrice): the price and the project in one place. */}
            <h1 className="h1 anim a2">
              See your price.
              <br />
              Get <span className="inv">real</span> quotes.
            </h1>
            <p className="h1-sub anim a3">{portalHeroSub(house)}</p>
          </div>

          <MobileHomeownerWizard uid="m0" prefill={prefill} house={house} />

          <div className="trust-row">
            <div className="tr">
              <svg className="ic">
                <use href="#jfmh-i-check" />
              </svg>
              <span>Local pros on JobFlex</span>
            </div>
            <div className="tr">
              <svg className="ic">
                <use href="#jfmh-i-clock" />
              </svg>
              <span>A price range in about a minute</span>
            </div>
            <div className="tr">
              <svg className="ic">
                <use href="#jfmh-i-tag" />
              </svg>
              <span>100% free for homeowners</span>
            </div>
          </div>
        </div>
      </section>

      <section className="steps">
        <div className="sec-in">
          <div className={rv.cls("secN", "sec-n")} ref={rv.ref("secN")}>
            How it works
          </div>
          <h2 className={rv.cls("secH", "sec-h")} ref={rv.ref("secH")}>
            Price it, send it, <span className="inv">meet your pro.</span>
          </h2>

          <MobileStepsGrid className={rv.cls("grid4", "grid4")} gridRef={rv.ref("grid4")} house={house} />
        </div>
      </section>

      {/* WHY JOBFLEX (2026-10-28, ./homeowner-story): the price first, one pro who runs their business on JobFlex. */}
      <WhyJobflex top="#jfmh-top" />

      {/* THE HOME DASHBOARD (2026-10-03): what comes with the first project.
          Every line here is true of the dashboard as shipped (lib/home/portal). */}
      <section className="steps" id="jfmh-home-dashboard">
        <div className="sec-in">
          <div className="sec-n">Your home dashboard</div>
          <h2 className="sec-h">
            One link. <span className="inv">Every project</span> on your house.
          </h2>
          <div className="grid4">
            <div className="st">
              <div className="st-n">01</div>
              <div className="st-t">Made for you, automatically</div>
              <p className="st-b">Submit your first project and your home dashboard comes with it. No account, no password — the link is yours.</p>
            </div>
            <div className="st">
              <div className="st-n">02</div>
              <div className="st-t">Proposals and your contractor</div>
              <p className="st-b">Read each proposal and accept it online, message your contractor, see the next visit.</p>
            </div>
            <div className="st">
              <div className="st-n">03</div>
              <div className="st-t">Plan the next job</div>
              <p className="st-b">Put “garage epoxy floor — March” on your calendar. When March comes, we remind you, and one tap sends it to a local pro.</p>
            </div>
            <div className="st">
              <div className="st-n">04</div>
              <div className="st-t">Your house’s record</div>
              <p className="st-b">What was done, by whom and for how much — kept in one place for as long as you own the home.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="net" id="jfmh-net">
        <div className="net-in">
          <h2 className={rv.cls("netH", "net-h")} ref={rv.ref("netH")}>
            Local <span>Contractors</span>
          </h2>

          <div className="net-cards">
            <div className={rv.cls("nc1", "nc nc-1")} ref={rv.ref("nc1")}>
              <div className="nc-art">
                <svg
                  className="nc-svg"
                  viewBox="0 0 200 200"
                  preserveAspectRatio="xMidYMid meet"
                  aria-hidden="true"
                >
                  <path className="nc-edge" d="M40 36v-8M160 36v-8M32 44h-8M32 150h-8M40 158v8M160 158v8" />
                  <rect className="nc-face" x="40" y="44" width="120" height="106" />
                  <rect className="nc-edge" x="40" y="44" width="120" height="106" />
                  <path className="nc-edge" d="M40 60h120" />
                  <text className="nc-xs" x="100" y="55" textAnchor="middle">
                    JOBFLEX PRO
                  </text>
                  <rect className="nc-edge" x="50" y="68" width="34" height="42" />
                  <circle className="nc-hip" cx="67" cy="83" r="7" />
                  <path className="nc-hip" d="M55 107a12 12 0 0124 0" />
                  <path className="nc-hip" d="M94 74h18M94 86h18" />
                  <path className="nc-edge" d="M118 74h34M118 86h34" />
                  <text className="nc-xs" x="90" y="100">
                    Local shop
                  </text>
                  {NC1_BARS.map(([x, width]) => (
                    <rect key={x} className="nc-bar" x={x} y="120" width={width} height="17" />
                  ))}
                  <circle className="nc-face" cx="136" cy="128" r="13" />
                  <circle className="nc-edge" cx="136" cy="128" r="13" />
                  <path className="nc-key" d="M129 128l5 5 10-11" />
                  <text className="nc-s" x="100" y="176" textAnchor="middle">
                    PROFILE
                  </text>
                </svg>
              </div>
              <div className="nc-cap">
                <b>Pros who run their business on JobFlex.</b>
                <span>Estimates, proposals and scheduling in one place.</span>
              </div>
            </div>

            <div className={rv.cls("nc2", "nc nc-2")} ref={rv.ref("nc2")}>
              <div className="nc-art">
                <svg
                  className="nc-svg"
                  viewBox="0 0 200 200"
                  preserveAspectRatio="xMidYMid meet"
                  aria-hidden="true"
                >
                  <path className="nc-hip" d="M27.00 34h146.00" />
                  <path className="nc-edge" d="M27.00 28v12M173.00 28v12" />
                  <text className="nc-num" x="100" y="76" textAnchor="middle">
                    <NetCount />
                    <tspan className="nc-plus">+</tspan>
                  </text>
                  <path
                    className="nc-road"
                    d="M21.00 119.00H179.00 M21.00 134.00H179.00 M70.00 100.00V153.00 M130.00 100.00V153.00"
                  />
                  {NC2_CELLS.map((c) => (
                    <rect
                      key={c.x + "-" + c.y}
                      className={c.fill ? "nc-fill" : "nc-cell"}
                      x={c.x}
                      y={c.y}
                      width="11.0"
                      height="11.0"
                    />
                  ))}
                  {NC2_PINS.map((p) => (
                    <Fragment key={p.cx + "-" + p.cy}>
                      <path className="nc-pinf" d={p.d} />
                      <circle className="nc-pind" cx={p.cx} cy={p.cy} r="1.9" />
                    </Fragment>
                  ))}
                  <text className="nc-s" x="100" y="176" textAnchor="middle">
                    COVERAGE
                  </text>
                </svg>
              </div>
              <div className="nc-cap">
                <b>Trades JobFlex routes.</b>
                <span>Roofing to remodels — one form for all of them.</span>
              </div>
            </div>

            <div className={rv.cls("nc3", "nc nc-3")} ref={rv.ref("nc3")}>
              <div className="nc-art">
                <svg
                  className="nc-svg"
                  viewBox="0 0 200 200"
                  preserveAspectRatio="xMidYMid meet"
                  aria-hidden="true"
                >
                  <defs>
                    <pattern
                      id="jfmh-hatch"
                      width="5.5"
                      height="5.5"
                      patternUnits="userSpaceOnUse"
                      patternTransform="rotate(45)"
                    >
                      <line x1="0" y1="0" x2="0" y2="5.5" stroke="rgba(242,240,235,.32)" strokeWidth="1" />
                    </pattern>
                  </defs>
                  <path className="nc-hip" d="M100 30v106" />
                  <rect className="nc-hip" x="36" y="42" width="128" height="80" />
                  <path className="nc-hatch" d="M42 48L76 82L42 116Z" />
                  <path className="nc-hatch" d="M158 48L124 82L158 116Z" />
                  <rect className="nc-face" x="42" y="48" width="116" height="68" />
                  <rect className="nc-edge" x="42" y="48" width="116" height="68" />
                  <path className="nc-hip" d="M42 48L76 82M158 48L124 82M42 116L76 82M158 116L124 82" />
                  <path className="nc-key" d="M76 82H124" />
                  <text className="nc-area" x="100" y="102" textAnchor="middle">
                    1,720 SF
                  </text>
                  <path className="nc-edge" d="M42 148v-8M158 148v-8" />
                  <path className="nc-hip" d="M42 144h116" />
                  <text className="nc-xs" x="100" y="159" textAnchor="middle">
                    34&apos;0&quot;
                  </text>
                  <path className="nc-edge" d="M166 48h8M166 116h8" />
                  <path className="nc-hip" d="M170 48v68" />
                  <text
                    className="nc-xs"
                    x="184"
                    y="82"
                    textAnchor="middle"
                    transform="rotate(90 184 82)"
                  >
                    19&apos;0&quot;
                  </text>
                  <path className="nc-key" d="M22 46v-14M18 36l4-4 4 4" />
                  <text className="nc-xs" x="22" y="56" textAnchor="middle">
                    N
                  </text>
                  <text className="nc-s" x="100" y="176" textAnchor="middle">
                    ROOF PLAN
                  </text>
                </svg>
              </div>
              <div className="nc-cap">
                <b>A scope a pro can price.</b>
                <span>Sizes, materials and what to check on site.</span>
              </div>
            </div>

            <div className={rv.cls("nc4", "nc nc-4")} ref={rv.ref("nc4")}>
              <div className="nc-art">
                <svg
                  className="nc-svg"
                  viewBox="0 0 200 200"
                  preserveAspectRatio="xMidYMid meet"
                  aria-hidden="true"
                >
                  <circle className="nc-face" cx="100" cy="78" r="42" />
                  <circle className="nc-edge" cx="100" cy="78" r="42" />
                  <circle className="nc-hip" cx="100" cy="78" r="30" />
                  <path
                    className="nc-min"
                    d="M104.0 39.7L104.4 36.2M108.0 40.3L108.7 36.9M111.9 41.4L113.0 38.1M115.7 42.8L117.1 39.6M122.6 46.9L124.7 44.0M125.8 49.4L128.1 46.8M128.6 52.2L131.2 49.9M131.1 55.4L134.0 53.3M135.2 62.3L138.4 60.9M136.6 66.1L139.9 65.0M137.7 70.0L141.1 69.3M138.3 74.0L141.8 73.6M138.3 82.0L141.8 82.4M137.7 86.0L141.1 86.7M136.6 89.9L139.9 91.0M135.2 93.7L138.4 95.1M131.1 100.6L134.0 102.7M128.6 103.8L131.2 106.1M125.8 106.6L128.1 109.2M122.6 109.1L124.7 112.0M115.7 113.2L117.1 116.4M111.9 114.6L113.0 117.9M108.0 115.7L108.7 119.1M104.0 116.3L104.4 119.8M96.0 116.3L95.6 119.8M92.0 115.7L91.3 119.1M88.1 114.6L87.0 117.9M84.3 113.2L82.9 116.4M77.4 109.1L75.3 112.0M74.2 106.6L71.9 109.2M71.4 103.8L68.8 106.1M68.9 100.6L66.0 102.7M64.8 93.7L61.6 95.1M63.4 89.9L60.1 91.0M62.3 86.0L58.9 86.7M61.7 82.0L58.2 82.4M61.7 74.0L58.2 73.6M62.3 70.0L58.9 69.3M63.4 66.1L60.1 65.0M64.8 62.3L61.6 60.9M68.9 55.4L66.0 53.3M71.4 52.2L68.8 49.9M74.2 49.4L71.9 46.8M77.4 46.9L75.3 44.0M84.3 42.8L82.9 39.6M88.1 41.4L87.0 38.1M92.0 40.3L91.3 36.9M96.0 39.7L95.6 36.2"
                  />
                  <path
                    className="nc-edge"
                    d="M100.0 44.0L100.0 36.0M117.0 48.6L121.0 41.6M129.4 61.0L136.4 57.0M134.0 78.0L142.0 78.0M129.4 95.0L136.4 99.0M117.0 107.4L121.0 114.4M100.0 112.0L100.0 120.0M83.0 107.4L79.0 114.4M70.6 95.0L63.6 99.0M66.0 78.0L58.0 78.0M70.6 61.0L63.6 57.0M83.0 48.6L79.0 41.6"
                  />
                  <text className="nc-xs" x="100.0" y="56.0" textAnchor="middle">
                    12
                  </text>
                  <text className="nc-xs" x="125.0" y="81.0" textAnchor="middle">
                    3
                  </text>
                  <text className="nc-xs" x="100.0" y="106.0" textAnchor="middle">
                    6
                  </text>
                  <text className="nc-xs" x="75.0" y="81.0" textAnchor="middle">
                    9
                  </text>
                  <path className="nc-key" d="M100.0 48.0A30 30 0 0 1 126.0 93.0" />
                  <path className="nc-edge" d="M100 78L120.8 90.0M100 78L100.0 46.0" />
                  <circle className="nc-dot" cx="100" cy="78" r="3" />
                  <path className="nc-hip" d="M56 140h88" />
                  <path className="nc-edge" d="M56 140v7" />
                  <path className="nc-edge" d="M78 140v4" />
                  <path className="nc-edge" d="M100 140v4" />
                  <path className="nc-edge" d="M122 140v4" />
                  <path className="nc-edge" d="M144 140v7" />
                  <text className="nc-xs" x="56" y="157" textAnchor="middle">
                    0H
                  </text>
                  <text className="nc-xs" x="144" y="157" textAnchor="middle">
                    24H
                  </text>
                  <text className="nc-s" x="100" y="176" textAnchor="middle">
                    RESPONSE
                  </text>
                </svg>
              </div>
              <div className="nc-cap">
                <b>24 hours to take your job.</b>
                <span>Then it moves to the next local pro.</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="revs">
        <div className="sec-in">
          {/* No kicker here. The desktop section has none — `.arch-tag` exists
              in its stylesheet but is never rendered — and inventing marketing
              copy for a mobile build is not this build's job. */}
          <h2 className={rv.cls("archH", "arch-h")} ref={rv.ref("archH")}>
            Every room in the house
            <br />
            <span>one simple form</span>
          </h2>

          <div className={rv.cls("arch", "arch")} ref={rv.ref("arch")}>
            {PLATES.map((p) => (
              <Plate key={p.label} height={p.height} src={p.src} label={p.label} />
            ))}
          </div>
        </div>
      </section>

      {/* GOOD TO KNOW (2026-10-28): the questions a homeowner asks before sending anything. */}
      <StoryQuestions house={house} top="#jfmh-top" />

      <section className="cta">
        <div className="cta-in">
          <p className={rv.cls("ctaQ", "cta-q")} ref={rv.ref("ctaQ")}>
            Ready when you are.
          </p>
          <p className={rv.cls("ctaA", "cta-a")} ref={rv.ref("ctaA")}>
            Price it or describe it in a minute — a local pro takes it from there, and your home dashboard comes with it.
          </p>
          <a className={rv.cls("ctaBtn", "cta-btn")} ref={rv.ref("ctaBtn")} href="#jfmh-top">
            Start your project
            <svg className="ic">
              <use href="#jfmh-i-arrow" />
            </svg>
          </a>
        </div>
      </section>

      <footer className="foot">
        <div className="foot-b">
          <BrandMark />
          <span>JobFlex</span>
        </div>
        <div className="foot-links">
          <Link className="lead" href="/">
            For contractors
          </Link>
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
        </div>
      </footer>
    </div>
  );
}
