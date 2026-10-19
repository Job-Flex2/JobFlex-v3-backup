"use client";

/* THE DEMO ABOVE THE BUTTON (hvac2's first screen, 2026-10-19; the audit:
   "show the product before you ask for the trial"). One block with its
   line over it — "Real product demo · Address to proposal in 40 seconds":

   · the film (demo-media.ts) once its files are in: a poster <picture> that
     is the first screen's largest paint, and over it a silent, inline,
     looping <video> whose sources are picked by the same media query — the
     16:9 cut in the app frame from 640 px, the 4:5 cut across the column on
     a phone, WebM first and MP4 second, so a browser fetches one file;
     "Try it yourself ↓" under it leads to the estimator further down;
   · until then the real estimator playing itself (hvac-estimator-shot,
     quick: the address is in from the first frame), in the same box.

   Either way the block reports demo_play, demo_25, demo_50, demo_100 once
   per session (hvac2-track), by the film's own time or the walk-through's
   clock. The box has its shape before anything loads (hvac2.css), so the
   button under it never moves. */

import { useRef } from "react";
import { HvacEstimatorShot } from "../hvac-estimator-shot";
import { AppFrame } from "../showcase-kit";
import { useInView } from "../use-in-view";
import { HVAC2_DEMO_VIDEO, HVAC2_DESK_MEDIA } from "./demo-media";
import { trackHvac2Once } from "./hvac2-track";

type Pct = 0 | 25 | 50 | 100;
const EVENT = { 0: "demoPlay", 25: "demo25", 50: "demo50", 100: "demo100" } as const;

function DemoFilm({ hook }: { hook?: string }) {
  const last = useRef(0);
  const mark = (pct: Pct) => trackHvac2Once(EVENT[pct], { kind: "video" }, hook);
  const onTime = (v: HTMLVideoElement) => {
    if (!v.duration || !Number.isFinite(v.duration)) return;
    const t = v.currentTime;
    // Back at the start after the end was near: the whole film played.
    if (t < last.current - 1 && last.current / v.duration > 0.9) mark(100);
    last.current = t;
    const p = t / v.duration;
    if (p >= 0.25) mark(25);
    if (p >= 0.5) mark(50);
    if (p >= 0.98) mark(100);
  };
  const { desk, phone } = HVAC2_DEMO_VIDEO;
  return (
    <div className="lp-h2-film">
      <picture>
        <source media={HVAC2_DESK_MEDIA} srcSet={desk.poster} />
        <img className="lp-h2-film-poster" src={phone.poster} alt="" fetchPriority="high" decoding="async" />
      </picture>
      <video
        className="lp-h2-film-video"
        autoPlay
        muted
        playsInline
        loop
        preload="metadata"
        aria-label="JobFlex HVAC estimator: an address becomes a load, a sized system, priced lines and a proposal"
        onPlaying={() => mark(0)}
        onTimeUpdate={(e) => onTime(e.currentTarget)}
      >
        <source media={HVAC2_DESK_MEDIA} src={desk.webm} type="video/webm" />
        <source media={HVAC2_DESK_MEDIA} src={desk.mp4} type="video/mp4" />
        <source src={phone.webm} type="video/webm" />
        <source src={phone.mp4} type="video/mp4" />
      </video>
    </div>
  );
}

function DemoInteractive({ hook }: { hook?: string }) {
  const { ref, inView } = useInView<HTMLDivElement>(0.2);
  return (
    <div ref={ref}>
      <HvacEstimatorShot active={inView} hero quick landing="hvac2" onProgress={(pct) => trackHvac2Once(EVENT[pct], { kind: "interactive" }, hook)} />
    </div>
  );
}

export function Hvac2Demo({ hook }: { hook?: string }) {
  const film = HVAC2_DEMO_VIDEO.READY;
  return (
    <figure className="lp-h2-demo">
      <figcaption className="lp-h2-demo-head">
        <span className="lp-h2-demo-tag">Real product demo</span>
        <span aria-hidden>·</span>
        <span>Address to proposal in {HVAC2_DEMO_VIDEO.seconds} seconds</span>
      </figcaption>
      {film ? (
        <>
          <div className="lp-h2-film-frame">
            <AppFrame path="www.jobflex.app/dashboard/hvac-estimator" body="#f2f0eb">
              <DemoFilm hook={hook} />
            </AppFrame>
          </div>
          <a href="#try" className="lp-h2-try">Try it yourself <span aria-hidden>↓</span></a>
        </>
      ) : (
        <DemoInteractive hook={hook} />
      )}
    </figure>
  );
}
