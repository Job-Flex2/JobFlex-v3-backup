"use client";

/* ============================================================
   ESTIMATORS SHOWCASE — four sequences, not four pictures
   ============================================================
   Rebuilt as timed demos (owner, 2026-08-24). Each estimator plays the way a
   product video plays it: a state at a time, every change a transition rather
   than a cut, so you watch the work happen instead of reading about it.

     Smart Proposal — prompt alone → lifts away → lines write themselves
     Roof           — address → aerial → outline traces → the SAME outline
                      tilts into perspective and the photo falls away
     Fence          — map → cursor clicks the layer on → parcel → run →
                      the ground tips and walls stand on the run itself
     Video          — recording → pulls back → the read lands as notes on
                      the footage and the takeoff in the rail

   Timing lives in one place per shot (PHASES), and one hook drives them, so a
   sequence can be retimed without touching the markup. Everything moves on
   transform/opacity so it stays on the compositor; the 3D moments are a real
   rotateX on a perspective stage, not a fake skew.

   ONE CLOCK (owner, 2026-09-26: "the progress bar lags"). A slide's shot and
   its tab's timer bar start in the same commit and nothing pauses either, so
   the bar is always exactly as far along as the sequence it stands for, and
   the bar's own end is what moves to the next slide. Nothing stops the bar
   on hover or touch: pass B's hold paused the BAR alone while the shot kept
   playing, so with the pointer resting on the card (i.e. after clicking a
   tab) the bar sat still, fell behind the animation and the next slide came
   late. Gating the shots too was tried in August and froze them mid-sequence
   the moment the cursor wandered in, which read as the animation breaking.
   ============================================================ */

import { useEffect, useRef, useState } from "react";
import { Reveal } from "./reveal";
import { useInView } from "./use-in-view";

import {
  AppFrame,
  EASE,
  READ_HOLD,
  Rail,
  SKY,
  STAGE,
  Stat,
  TotalPlate,
  usePhases,
  useTyped,
} from "./showcase-kit";
import dynamic from "next/dynamic";
import { FENCE_TIMELINE, FenceShot } from "./fence-shot";
import { HVAC_TIMELINE } from "./hvac-timeline";
import type { ShowcaseSlideKey } from "./landing-variants";
import { ROOF_TIMELINE, RoofShot } from "./roof-shot";
import { SmartProposalShot, smartTimeline } from "./smart-proposal-shot";
import "./showcase-pass.css";
import { SMART_SCENARIOS, type SmartScenarioKey } from "./smart-scenarios";
import { REGISTER } from "./routes";

/* The HVAC slide's shot is its own chunk (2026-10-22): only the HVAC landing
   shows that slide, and the shot carries the whole demo form. Its length is
   read from hvac-timeline.ts, so sizing the slide loads nothing. */
const HvacEstimatorShot = dynamic(() => import("./hvac-estimator-shot").then((m) => m.HvacEstimatorShot));

/* ============================================================
   4 · VIDEO — the real clip, the read as notes, the proposal
   ============================================================
   An actual walkthrough plays here rather than a drawing of one. What the AI
   reads off the footage lands as short notes pinned to the things themselves —
   not a measuring rig of crosshairs and dimension chips. */

const V_NOTES: { label: string; left: string; top: string }[] = [
  { label: "Wood uppers", left: "22%", top: "24%" },
  { label: "Tile backsplash", left: "60%", top: "50%" },
  { label: "Granite countertop", left: "30%", top: "74%" },
];

/* The notes are pinned to things in the FRAME, so they are only right while
   the clip is showing that frame. This is the point in the footage where the
   camera is on the uppers and the backsplash. */
const V_NOTES_IN = 2.6;
const V_NOTES_OUT = 9.5;

const V_PHASES = [1500, 2600, 4600];

function VideoShot({ active }: { active: boolean }) {
  const phase = usePhases(V_PHASES, active);
  const pulled = phase >= 1;
  // once the read is in, the caption steps off the footage so the notes
  // (and the frame) are clear
  const heard = phase >= 3;
  const caption = useTyped("…remodel the whole kitchen — the run here is about twelve feet…", active, 24);
  // The clip loops; the notes belong to the read of THIS pass, so they leave
  // and land again each time the footage restarts.
  const [loop, setLoop] = useState(0);
  // Driven by the video clock, not a wall clock (owner, 2026-08-25). On the
  // second pass the notes used to reappear the instant the clip restarted,
  // which put "Wood uppers" on a bare wall — the camera was not there yet.
  const [clipT, setClipT] = useState(0);
  const lastT = useRef(0);
  // CRO stage 1 (2026-09-09): the 1.2 MB clip used to preload="auto" and
  // autoplay from mount. Now only its metadata loads until the stage is at
  // least half on screen, and it pauses again when scrolled away.
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (!("IntersectionObserver" in window)) {
      if (active) void el.play().catch(() => {});
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && active) void el.play().catch(() => {});
        else el.pause();
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [active]);
  const read = phase >= 2;
  const notesOn = read && clipT >= V_NOTES_IN && clipT <= V_NOTES_OUT;

  return (
    <AppFrame path="app.jobflex.com/estimators/video" body="#0f172a">
      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_260px]">
        <div className={STAGE} style={{ background: "#0f172a" }}>
          {/* the footage, which pulls back once it has been watched */}
          <div
            className="absolute inset-0"
            style={{
              transform: pulled ? "scale(1)" : "scale(1.18)",
              transition: `transform 1.3s ${EASE}`,
            }}
          >
            <video
              ref={videoRef}
              className="h-full w-full object-cover"
              src="/landing-d/walkthrough.mp4"
              muted
              loop
              playsInline
              preload="metadata"
              onTimeUpdate={(e) => {
                const t = e.currentTarget.currentTime;
                if (t < lastT.current - 0.5) setLoop((l) => l + 1);
                lastT.current = t;
                setClipT(t);
              }}
            />
          </div>

          {/* what the read found: notes pinned to the footage */}
          {V_NOTES.map((n, i) => (
            <span
              key={`${n.label}-${loop}`}
              className="absolute z-20 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-[2px] bg-ink/85 px-2 py-1 text-[10.5px] font-bold text-white"
              style={{
                left: n.left,
                top: n.top,
                ...(notesOn
                  ? { animation: `toast-in .45s ${EASE} ${i * 160}ms backwards` }
                  : { opacity: 0 }),
              }}
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: SKY }} />
              {n.label}
            </span>
          ))}

          <span
            className="absolute right-4 top-4 z-20 flex items-center gap-1.5 rounded-[2px] bg-black/60 px-2 py-1 font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-white"
            style={{ opacity: pulled ? 0 : 1, transition: "opacity .5s ease" }}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-red-500" style={{ animation: "lpPulse 1.2s ease-in-out infinite" }} />
            rec 0:18
          </span>

          <div
            className="absolute inset-x-0 bottom-0 z-20 flex items-start gap-2 px-4 pb-4 pt-8"
            style={{
              background: "linear-gradient(to top, rgba(15,23,42,.96), rgba(15,23,42,0))",
              opacity: heard ? 0 : 1,
              transition: "opacity .5s ease",
            }}
          >
            <span className="mt-[2px] shrink-0 rounded-[2px] bg-white/90 px-1.5 py-[2px] font-mono text-[9px] font-black uppercase text-slate-900">cc</span>
            <span className="text-[14px] font-semibold leading-[1.4] text-white">{caption}</span>
          </div>

          {/* The "Priced from the clip" sheet that slid over the footage is
              gone (owner, 2026-09-26); the takeoff lives in the rail. */}
        </div>

        <Rail title="Read from clip" shown={read}>
          <Stat k="Wall run" v="12 ft 4 in" accent />
          <Stat k="Ceiling" v="8 ft" />
          <Stat k="Uppers" v="2 walls" />
          <Stat k="Labor" v="$5,120" />
          <TotalPlate total="$9,868" note="Estimate total" play={read} />
        </Rail>
      </div>
    </AppFrame>
  );
}

/* ============================================================
   THE SECTION
   ============================================================ */

const SLIDE_LABEL: Record<ShowcaseSlideKey, string> = {
  smart: "Smart Proposal",
  roof: "Roof estimator",
  fence: "Fence estimator",
  hvac: "HVAC estimator",
  video: "Video estimator",
};
/** Floor for any slide, and the video's own length. */
const SLIDE_MIN_MS = 9000;
/** The four, in the order they always ran. */
const DEFAULT_SLIDES: ShowcaseSlideKey[] = ["smart", "roof", "fence", "video"];

export function EstimatorsShowcase({
  slides,
  ownSlide,
  scenario,
  registerHref = REGISTER,
  cta = "Start my free trial",
}: {
  /** The trade's own estimator (roof / fence). landing-e (pass B): the
   *  showcase opens on Smart so it does not repeat the hero's shot; the
   *  trade's own slide comes second, then the rest in the usual order. */
  ownSlide?: ShowcaseSlideKey;
  /** The landing's own set, in its order (landing-variants `showcaseSlides`,
   *  2026-10-20: an ad landing shows its estimator, Smart and Video). Given,
   *  it replaces the full set and `ownSlide`'s place in it. */
  slides?: readonly ShowcaseSlideKey[];
  /** The Smart slide plays the current trade's scenario, not the kitchen. */
  scenario?: SmartScenarioKey;
  registerHref?: string;
  cta?: string;
}) {
  const { ref, inView } = useInView<HTMLDivElement>(0.15);
  const own = ownSlide && ownSlide !== "smart" ? ownSlide : undefined;
  const SLIDES = (slides?.length ? slides : own ? ["smart" as const, own, ...DEFAULT_SLIDES.filter((k) => k !== "smart" && k !== own)] : DEFAULT_SLIDES).map((key) => ({ key, label: SLIDE_LABEL[key] }));
  /* Each slide lasts as long as its own sequence plus the reading hold
     (owner, 2026-09-26) — the timer bar runs for exactly this long. */
  const smartScenario = SMART_SCENARIOS[scenario ?? "kitchen"];
  const SLIDE_MS: Record<ShowcaseSlideKey, number> = {
    smart: Math.max(SLIDE_MIN_MS, smartTimeline(smartScenario).slide),
    roof: Math.max(SLIDE_MIN_MS, ROOF_TIMELINE.slide),
    fence: Math.max(SLIDE_MIN_MS, FENCE_TIMELINE.slide),
    hvac: Math.max(SLIDE_MIN_MS, HVAC_TIMELINE.slide),
    video: Math.max(SLIDE_MIN_MS, V_PHASES[2] + READ_HOLD),
  };
  const [slide, setSlide] = useState(0);
  const [run, setRun] = useState(0);
  const [reduced, setReduced] = useState(false);
  /* A horizontal swipe on the stage moves one slide (pass B). A finger or a
     pointer on the showcase no longer holds the timer (see ONE CLOCK). */
  const touchX = useRef<number | null>(null);

  useEffect(() => {
    const id = requestAnimationFrame(() =>
      setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches),
    );
    return () => cancelAnimationFrame(id);
  }, []);

  const s = SLIDES[slide];
  const goTo = (n: number) => {
    setSlide(((n % SLIDES.length) + SLIDES.length) % SLIDES.length);
    setRun((r) => r + 1);
  };

  return (
    <>
      {/* One build for both viewports (owner, 2026-08-25). The phone used to
          get a separate, static estimates section; it now runs the same four
          sequences with the takeoff rail stacked under the stage. */}
      {/* Flat ink ground with the blueprint drafting grid (owner, 2026-09-10):
          no plate, no overlay, no gradient — the grid is two CSS layers of
          1 px white lines (landing-e.css, .lp-est). */}
      <section id="showcase" className="lp-est relative overflow-hidden bg-lp-base px-5 py-[11vmin] sm:py-[9vmin] sm:px-6">
        <div
          ref={ref}
          className="relative z-[1] mx-auto lp-wrap"
          onTouchStart={(e) => { touchX.current = e.touches[0]?.clientX ?? null; }}
          onTouchEnd={(e) => {
            const x0 = touchX.current; touchX.current = null;
            const x1 = e.changedTouches[0]?.clientX;
            if (x0 !== null && x1 !== undefined && Math.abs(x1 - x0) > 40) goTo(slide + (x1 < x0 ? 1 : -1));
          }}
          onTouchCancel={() => { touchX.current = null; }}
        >
          <Reveal>
            <h2 className="mb-5 text-[clamp(34px,3.6vw,54px)] font-bold leading-[1.04] tracking-[-0.02em] text-white sm:mb-7">
              Estimates.
            </h2>
          </Reveal>

          <Reveal delay={80}>
            {/* Two by two on a phone (owner, 2026-09-26): the full labels, a
                timer bar under each, every tab at least 48 px tall. From 640 px
                the strip is one row as before. An odd last tab (HVAC
                adds a fifth) takes the whole row rather than half of it. */}
            <div
              className="grid grid-cols-2 items-stretch gap-1.5 sm:flex sm:flex-wrap sm:gap-2"
              role="tablist"
              aria-label="Estimators"
            >
              {SLIDES.map((sl, i) => (
                <button
                  key={sl.key}
                  type="button"
                  role="tab"
                  aria-selected={i === slide}
                  onClick={() => goTo(i)}
                  // Inactive tabs at half the transparency they had (owner,
                  // 2026-09-10): ground 0.02 -> 0.04, text ~0.60 -> 0.80, track
                  // 0.15 -> 0.30. The active tab is unchanged. From 1024px the
                  // label is 2px larger and the track and padding follow.
                  className={`${SLIDES.length % 2 && i === SLIDES.length - 1 ? "col-span-2 " : ""}relative min-h-[48px] overflow-hidden rounded-[2px] px-3 pb-3 pt-2.5 text-left transition-colors duration-200 sm:flex-1 sm:px-4 sm:pb-3.5 sm:pt-3 lg:px-5 lg:pb-4 lg:pt-3.5 ${
                    i === slide ? "bg-white/[0.08] text-white" : "bg-white/[0.04] text-white/80 hover:bg-white/[0.06] hover:text-white/95"
                  }`}
                >
                  <span className="block text-[13px] font-semibold leading-tight sm:text-[13.5px] lg:text-[15.5px]">
                    {sl.label}
                  </span>
                  <span className="mt-2 block h-[3px] overflow-hidden rounded-full bg-white/30 sm:mx-0 sm:mt-2.5 lg:mt-3 lg:h-[4px]">
                    {i === slide && (
                      <span
                        key={`${slide}-${run}`}
                        // only the fill's own end advances — never a bubbled
                        // animationend from inside the tab
                        onAnimationEnd={(e) => { if (e.target === e.currentTarget) goTo(slide + 1); }}
                        className="block h-full origin-left rounded-full bg-white"
                        style={
                          reduced
                            ? { width: "100%" }
                            : {
                                // A scaleX from the left on the compositor
                                // (slide-fill, landing-e.css), for exactly as
                                // long as the slide's own sequence. It waits
                                // only for the section to come on screen —
                                // the same `inView` that starts the shot, so
                                // the two set off together (ONE CLOCK).
                                animation: `slide-fill ${SLIDE_MS[sl.key]}ms linear forwards`,
                                animationPlayState: inView ? "running" : "paused",
                              }
                        }
                      />
                    )}
                  </span>
                </button>
              ))}
            </div>
          </Reveal>

          <Reveal delay={120}>
            {/* The new slide is there from its first frame (owner, 2026-09-26):
                the old fade from transparent blinked the whole card out and
                back, which on Smart read as a white page flashing up. It only
                settles 6 px into place now (lp-est-swap, showcase-pass.css). */}
            <div className="lp-est-swap mt-6 sm:mt-9" key={`${s.key}-${run}`}>
              {s.key === "smart" && <SmartProposalShot active={inView} scenario={smartScenario} />}
              {s.key === "roof" && <RoofShot active={inView} />}
              {s.key === "fence" && <FenceShot active={inView} />}
              {s.key === "hvac" && <HvacEstimatorShot active={inView} />}
              {s.key === "video" && <VideoShot active={inView} />}
            </div>
          </Reveal>

          {/* The section's own CTA (pass B): the top-of-page words, blue on ink. */}
          <Reveal delay={160} className="mt-8 sm:mt-10">
            <a href={registerHref} className="lp-btn-lime w-full sm:w-auto" data-cta="showcase">
              {cta}
              <span aria-hidden>→</span>
            </a>
          </Reveal>
        </div>
      </section>
    </>
  );
}
