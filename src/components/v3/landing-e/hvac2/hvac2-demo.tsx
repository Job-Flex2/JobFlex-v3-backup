"use client";

/* THE DEMO ABOVE THE BUTTON (hvac2's first screen, 2026-10-19; the October
   audit: "show the product before you ask for the trial"). One block, framed
   like the app, with its own line over it:

   · the video (demo-media.ts), once it is recorded: muted, inline, looping,
     loaded only as it nears the screen — the 9:16 cut on a phone, the 16:9
     cut on a desk — with "Try it yourself ↓" under it, to the interactive
     estimator in the showcase;
   · until then the real estimator playing itself (hvac-estimator-shot),
     opening on the house with the address in — never an empty form — and
     a tap or a key hands it over.

   Either way the block reports `demo_play` as it starts and `demo_25`,
   `demo_50`, `demo_100` as it goes (traffic-contract), with industry and
   landing "hvac2". The frame is a fixed height (hvac2.css), so nothing under
   it moves while it plays. */

import { useCallback, useEffect, useRef, useState } from "react";
import { trackTraffic } from "@/lib/traffic-client";
import { TRAFFIC_EVENTS } from "@/lib/traffic-contract";
import { HvacEstimatorShot } from "../hvac-estimator-shot";
import { AppFrame } from "../showcase-kit";
import { useInView } from "../use-in-view";
import { HVAC2_DEMO_VIDEO, HVAC2_EVENT } from "./demo-media";

type Pct = 0 | 25 | 50 | 100;
const EVENT: Record<Pct, (typeof TRAFFIC_EVENTS)[keyof typeof TRAFFIC_EVENTS]> = {
  0: TRAFFIC_EVENTS.demoPlay,
  25: TRAFFIC_EVENTS.demo25,
  50: TRAFFIC_EVENTS.demo50,
  100: TRAFFIC_EVENTS.demo100,
};

/** Each mark once per page load, whichever way the demo reached it. */
function useDemoMarks(kind: "video" | "interactive") {
  const sent = useRef(new Set<Pct>());
  return useCallback((pct: Pct) => {
    if (sent.current.has(pct)) return;
    sent.current.add(pct);
    trackTraffic(EVENT[pct], { kind, ...HVAC2_EVENT });
  }, [kind]);
}

function DemoVideo() {
  const wrap = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const mark = useDemoMarks("video");
  const last = useRef(0);

  // Lazy: the file is asked for as the block nears the screen, in the cut this width plays.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const pick = () => (window.matchMedia(`(max-width: ${HVAC2_DEMO_VIDEO.phoneMax - 1}px)`).matches ? HVAC2_DEMO_VIDEO.phone : HVAC2_DEMO_VIDEO.desk);
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      setSrc(pick());
      io.disconnect();
    }, { rootMargin: "200px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const onTime = () => {
    const v = video.current;
    if (!v || !v.duration || !Number.isFinite(v.duration)) return;
    const t = v.currentTime;
    // A loop back to the start after the end was near: the whole of it played.
    if (t < last.current - 1 && last.current / v.duration > 0.9) mark(100);
    last.current = t;
    const p = t / v.duration;
    if (p >= 0.25) mark(25);
    if (p >= 0.5) mark(50);
    if (p >= 0.98) mark(100);
  };

  return (
    <div ref={wrap} className="lp-h2-video">
      <video
        ref={video}
        className="lp-h2-video-el"
        src={src ?? undefined}
        poster={HVAC2_DEMO_VIDEO.poster}
        autoPlay
        muted
        playsInline
        loop
        preload="none"
        aria-label="JobFlex HVAC estimator: an address becomes a load estimate, a sized system, priced options and a proposal"
        onPlaying={() => mark(0)}
        onTimeUpdate={onTime}
      />
    </div>
  );
}

function DemoInteractive() {
  const { ref, inView } = useInView<HTMLDivElement>(0.2);
  const mark = useDemoMarks("interactive");
  return (
    <div ref={ref}>
      <HvacEstimatorShot active={inView} hero quick landing="hvac2" onProgress={mark} />
    </div>
  );
}

export function Hvac2Demo() {
  const video = HVAC2_DEMO_VIDEO.READY;
  return (
    <figure className="lp-h2-demo" aria-label="Real product demo">
      <figcaption className="lp-h2-demo-head">
        <span className="lp-h2-demo-tag">Real product demo</span>
        {video ? (
          <span className="lp-h2-demo-line">Watch the address-to-proposal workflow in {HVAC2_DEMO_VIDEO.seconds} seconds</span>
        ) : (
          <>
            <span className="lp-h2-demo-line lp-h2-demo-line--desk">The real estimator, from address to estimate — tap it to take over</span>
            <span className="lp-h2-demo-line lp-h2-demo-line--phone">The real estimator · tap to try</span>
          </>
        )}
      </figcaption>
      {video ? (
        <>
          <AppFrame path="www.jobflex.app/dashboard/hvac-estimator" body="#0d0f12">
            <DemoVideo />
          </AppFrame>
          <a href="#showcase" className="lp-h2-try">Try it yourself <span aria-hidden>↓</span></a>
        </>
      ) : (
        <DemoInteractive />
      )}
    </figure>
  );
}
