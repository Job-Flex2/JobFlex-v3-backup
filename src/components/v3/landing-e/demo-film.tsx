"use client";

/* THE DEMO FILM IN THE HERO SHOT'S PLACE (2026-10-19) — the HVAC,
   roofing and fencing landings. The landing's first screen with
   its estimator's film where the product shot plays: the same app frame
   (showcase-kit AppFrame), under the line "Real product demo · address to
   proposal in 40 seconds". Which film is the landing's `film`
   (landing-variants); its files are in demo-media.ts.

   The hero renders its visual twice — a phone build under 640 px and a desk
   build from 640 px (hero.tsx), one of them display:none. Each copy gets a
   poster <picture> switched by the same media query, so both ask for the one
   poster this width needs (the first screen's largest paint), and only the
   copy this width shows mounts a <video>: one file is fetched — the 16:9 cut
   on a desk, the 4:5 cut on a phone, WebM first and MP4 second. Silent,
   inline, looping, no controls. A visitor who asked for reduced motion keeps
   the poster.

   demo_play once it plays, then demo_25 / demo_50 / demo_100 by the film's
   own time — each once per browser session (demo-track). */

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { AppFrame } from "./showcase-kit";
import { DEMO_CAPTION, DEMO_DESK_MEDIA, DEMO_FILMS, type DemoFilmKey } from "./demo-media";
import { trackDemoOnce, type DemoEvent } from "./demo-track";
import "./demo-film.css";

type Pct = 0 | 25 | 50 | 100;
const EVENT: Record<Pct, DemoEvent> = { 0: "demoPlay", 25: "demo25", 50: "demo50", 100: "demo100" };

export function DemoFilm({
  film,
  slot,
  landing,
  hook,
}: {
  film: DemoFilmKey;
  /** Which of the hero's two builds this is: the video mounts in the one on screen. */
  slot: "phone" | "desk";
  /** The landing's key ("hvac", "roofing", "fencing"), named on the events. */
  landing: string;
  /** The ad hook the headline shows, for the events. */
  hook?: string;
}) {
  const [play, setPlay] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const last = useRef(0);
  useEffect(() => {
    const desk = window.matchMedia(DEMO_DESK_MEDIA);
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

  const mark = (pct: Pct) => trackDemoOnce(EVENT[pct], landing, hook);
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
  const f = DEMO_FILMS[film];
  const cut = f[slot];
  return (
    <figure className="lp-film-fig" style={{ "--film-h": `${f.deskHeight}px` } as CSSProperties}>
      <figcaption className="lp-film-cap">{DEMO_CAPTION}</figcaption>
      <AppFrame path={f.path} body={f.body}>
        <div className="lp-film">
          <picture>
            <source media={DEMO_DESK_MEDIA} srcSet={f.desk.poster} />
            <img className="lp-film-media" src={f.phone.poster} alt="" fetchPriority="high" decoding="async" />
          </picture>
          {play ? (
            <video
              ref={videoRef}
              className="lp-film-media"
              autoPlay
              muted
              playsInline
              loop
              preload="metadata"
              aria-label={f.label}
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
