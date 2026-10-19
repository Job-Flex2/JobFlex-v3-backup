"use client";

/* THE DEMO FILM IN THE HERO SHOT'S PLACE (?industry=hvac2, 2026-10-19).
   HVAC's first screen with the film where the estimator shot plays: the same
   app frame (showcase-kit AppFrame), under the line "Real product demo ·
   address to proposal in 40 seconds".

   The hero renders its visual twice — a phone build under 640 px and a desk
   build from 640 px (hero.tsx), one of them display:none. Each copy gets a
   poster <picture> switched by the same media query, so both ask for the one
   poster this width needs (the first screen's largest paint), and only the
   copy this width shows mounts a <video>: one file is fetched — the 16:9 cut
   on a desk, the 4:5 cut on a phone, WebM first and MP4 second. Silent,
   inline, looping, no controls. A visitor who asked for reduced motion keeps
   the poster.

   demo_play once it plays, then demo_25 / demo_50 / demo_100 by the film's
   own time — each once per browser session (hvac2-track). */

import { useEffect, useRef, useState } from "react";
import { AppFrame } from "../showcase-kit";
import { HVAC2_DEMO_VIDEO, HVAC2_DESK_MEDIA } from "./demo-media";
import { trackHvac2Once } from "./hvac2-track";
import "./hvac2.css";

type Pct = 0 | 25 | 50 | 100;
const EVENT = { 0: "demoPlay", 25: "demo25", 50: "demo50", 100: "demo100" } as const;

export function Hvac2Film({ slot, hook }: { slot: "phone" | "desk"; hook?: string }) {
  const [play, setPlay] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const last = useRef(0);
  useEffect(() => {
    const desk = window.matchMedia(HVAC2_DESK_MEDIA);
    const still = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setPlay(desk.matches === (slot === "desk") && !still.matches);
    sync();
    desk.addEventListener("change", sync);
    still.addEventListener("change", sync);
    return () => {
      desk.removeEventListener("change", sync);
      still.removeEventListener("change", sync);
    };
  }, [slot]);
  // Muted set on the element itself before play(): an inserted <video> does
  // not always autoplay on iOS from React's prop alone.
  useEffect(() => {
    const v = videoRef.current;
    if (!play || !v) return;
    v.muted = true;
    v.play().catch(() => {});
  }, [play]);

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
  const cut = HVAC2_DEMO_VIDEO[slot];
  return (
    <figure className="lp-h2-fig">
      <figcaption className="lp-h2-cap">Real product demo · address to proposal in {HVAC2_DEMO_VIDEO.seconds} seconds</figcaption>
      <AppFrame path="www.jobflex.app/dashboard/hvac-estimator" body="#f2f0eb">
        <div className="lp-h2-film">
          <picture>
            <source media={HVAC2_DESK_MEDIA} srcSet={desk.poster} />
            <img className="lp-h2-film-media" src={phone.poster} alt="" fetchPriority="high" decoding="async" />
          </picture>
          {play ? (
            <video
              ref={videoRef}
              className="lp-h2-film-media"
              autoPlay
              muted
              playsInline
              loop
              preload="metadata"
              aria-label="JobFlex HVAC estimator: an address becomes a load, a sized system, priced lines and a proposal"
              onPlaying={() => mark(0)}
              onTimeUpdate={(e) => onTime(e.currentTarget)}
            >
              <source src={cut.webm} type="video/webm" />
              <source src={cut.mp4} type="video/mp4" />
            </video>
          ) : null}
        </div>
      </AppFrame>
    </figure>
  );
}
