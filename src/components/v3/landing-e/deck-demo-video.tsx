"use client";

import type { Route } from "next";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { trackDemoOnce } from "./demo-track";
import { Reveal } from "./reveal";

/* THE DECK STUDIO IN 90 SECONDS — the deck landing's demo film, directly under
   the hero (2026-10-19). Owner: "a demo up to 1.5 minutes … how everything gets
   designed, all kinds of decks, shapes, the back wall, pricing and add-ons, 3D,
   engineering, all types of roof, beams, joists — the full flow; no voice, with
   the zoom-ins". The film (advertisement/deck-demo-90) is the real studio on a
   demo company: the four builds, layouts, size and shape, the height, the
   house's back wall, boards and the price, the frame the code tables pick and
   its build-up in 3D, editing in 3D, railings and stairs, roofs, lights at
   night, the code check, the price and the proposal. Silent; every step is
   captioned in the picture.

   Its own section rather than the hero's shot (as the HVAC, roofing and fence
   films are — demo-film.tsx): at 87 seconds it is a walk-through, so it gets
   the step chips. Nothing is fetched until the section nears the screen — then
   the cut for this screen (16:9 from 640 px, 4:5 under it, the page's `sm`)
   plays muted and loops, and pauses when it scrolls away. A chip jumps to its
   step and the one playing is lit. The events are the hero films' own
   (demo_play, demo_25, demo_50, demo_100 — demo-track), landing "decking". */

const FILM = {
  desk: { src: "/landing-e/deck-demo-16x9.mp4", poster: "/landing-e/deck-demo-poster-16x9.webp" },
  phone: { src: "/landing-e/deck-demo-4x5.mp4", poster: "/landing-e/deck-demo-poster-4x5.webp" },
} as const;

/** Where each step starts in the film, seconds (advertisement/deck-demo-90/source/deck.js CAPS). */
const STEPS: ReadonlyArray<{ at: number; label: string }> = [
  { at: 3.6, label: "What you build" },
  { at: 8.6, label: "Layouts" },
  { at: 11.6, label: "Size & shape" },
  { at: 18.6, label: "Height" },
  { at: 22, label: "The house" },
  { at: 28, label: "Boards & price" },
  { at: 34.6, label: "Engineering" },
  { at: 41.6, label: "Edit in 3D" },
  { at: 46, label: "Railing & stairs" },
  { at: 51, label: "Roofs" },
  { at: 62, label: "Lights" },
  { at: 69.5, label: "Code check" },
  { at: 74.5, label: "Proposal" },
];
/** The end card starts here: no chip is lit past it. */
const END_CARD = 83.5;
/** The film's own time at which each event fires (87 s long). */
const MARKS: ReadonlyArray<readonly [number, "demoPlay" | "demo25" | "demo50" | "demo100"]> = [
  [0.5, "demoPlay"],
  [21.75, "demo25"],
  [43.5, "demo50"],
  [86, "demo100"],
];

export function DeckDemoVideo({ registerHref, cta, note }: { registerHref: string; cta: string; note: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [step, setStep] = useState(-1);
  const [playing, setPlaying] = useState(false);

  const cut = () => (window.matchMedia("(max-width: 639px)").matches ? FILM.phone : FILM.desk);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const film = cut();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            // The poster and the film load only as the section nears the screen — never with the first paint.
            if (!v.getAttribute("poster")) v.poster = film.poster;
            if (!v.getAttribute("src")) v.src = film.src;
            if (e.intersectionRatio >= 0.35) v.play().catch(() => undefined);
          } else v.pause();
        }
      },
      { rootMargin: "300px 0px", threshold: [0, 0.35] },
    );
    io.observe(v);
    return () => io.disconnect();
  }, []);

  const onTime = () => {
    const v = ref.current;
    if (!v) return;
    const t = v.currentTime;
    let k = -1;
    for (let i = 0; i < STEPS.length; i++) if (t >= STEPS[i].at) k = i;
    if (t >= END_CARD) k = -1;
    if (k !== step) setStep(k);
    for (const [at, event] of MARKS) if (t >= at) trackDemoOnce(event, "decking");
  };

  const jump = (i: number) => {
    const v = ref.current;
    if (!v) return;
    if (!v.getAttribute("src")) v.src = cut().src;
    v.currentTime = STEPS[i].at;
    v.play().catch(() => undefined);
    setStep(i);
  };

  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => undefined);
    else v.pause();
  };

  return (
    <section id="demo" className="relative overflow-hidden bg-white px-5 py-[7vmin] sm:px-6">
      <div className="mx-auto lp-wrap">
        <Reveal>
          <h2 className="lp-sec-title">A deck designed in 3D, framed to code and priced — in 90 seconds.</h2>
          <p className="lp-sec-lede">
            The real Deck Studio: pick what you&apos;re building, shape it to the house&apos;s back wall, swap boards and watch the price follow, let the code tables pick the joists, beams and footings, put a roof on it and light it up — then one click to the proposal, the lumber-yard list and the permit set.
          </p>
        </Reveal>

        <Reveal delay={100} className="mt-8 sm:mt-10">
          <figure className="relative m-0 border-2 border-ink bg-[#f2f0eb] shadow-[8px_8px_0_#1854a0]">
            <video
              ref={ref}
              className="block aspect-[4/5] w-full bg-[#f2f0eb] object-cover sm:aspect-[16/9]"
              muted
              loop
              playsInline
              preload="none"
              aria-label="Demo: a deck designed in JobFlex Deck Studio — the four builds, size and shape, the house's back wall, boards and the price, the frame sized from the code tables and built up in 3D, railings and stairs, roofs, lights at night, the code check, the price and the client's proposal. Silent, with captions in the picture."
              onTimeUpdate={onTime}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onClick={toggle}
            />
            <button
              type="button"
              onClick={toggle}
              className="absolute right-3 top-3 grid h-11 w-11 place-items-center border-2 border-ink bg-white text-ink shadow-[3px_3px_0_#0a0a0a] sm:right-4 sm:top-4"
              aria-label={playing ? "Pause the demo" : "Play the demo"}
            >
              {playing ? (
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
                  <rect x="3" y="2" width="3.5" height="12" fill="currentColor" />
                  <rect x="9.5" y="2" width="3.5" height="12" fill="currentColor" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
                  <path d="M4 2 L14 8 L4 14 Z" fill="currentColor" />
                </svg>
              )}
            </button>
          </figure>
          <ol className="m-0 mt-4 flex list-none flex-wrap gap-2 p-0" aria-label="Jump to a step">
            {STEPS.map((s, i) => (
              <li key={s.label}>
                <button
                  type="button"
                  onClick={() => jump(i)}
                  aria-current={step === i ? "step" : undefined}
                  className={
                    "h-9 border-2 px-3 font-mono text-[12px] font-bold uppercase tracking-[0.08em] transition-colors " +
                    (step === i ? "border-ink bg-ink text-white" : "border-black/15 bg-white text-ink hover:border-ink")
                  }
                >
                  <span className="mr-1.5 text-[#1854A0]">{String(i + 1).padStart(2, "0")}</span>
                  {s.label}
                </button>
              </li>
            ))}
          </ol>
        </Reveal>

        <Reveal delay={140} className="mt-8 flex flex-col items-start gap-3 sm:mt-10 sm:flex-row sm:items-center sm:gap-5">
          <Link href={registerHref as Route} className="lp-btn-lime w-full sm:w-auto" data-cta="deck-demo">
            {cta}
            <span aria-hidden>→</span>
          </Link>
          <p className="text-[14px] text-[color:var(--ink-soft)]">{note}</p>
        </Reveal>
      </div>
    </section>
  );
}
