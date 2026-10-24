"use client";

// THE APP BEHIND THE PHONE SIGN-UP: the phone Overview with a sample shop (./fixture), drifting up without end.
// Loaded only on a phone, by the viewport switch (app/(auth)/auth/register/register-responsive.tsx), after the form.
//
// THE LOOP. Two copies of the Overview's page stand one under the other in a track, and the track slides up by one
// copy's height (translateY −50%), linear, infinite — at the moment it wraps, the second copy is exactly where the
// first began, so there is no jump. It is a CSS animation of `transform` only: the compositor moves it, nothing is
// laid out per frame and no script runs while it plays. The script measures one copy once (after the fonts have
// settled) to set the duration for ~50 px/s, then lets the animation start. `prefers-reduced-motion`: it stands still.
// The form's touches and the sheet opening do not stop it.
//
// THREE OVERVIEWS, ONE PICTURE. The Overview owns its own frame (top bar, scroller, bottom bar), so the frame is one
// copy with its page hidden and its paper made clear, and the drifting page under it is two more copies with their
// bars, drawer and sheets left out (phone-backdrop.module.css). All three are mobile-v2's MobileDashboard in its
// `sample` mode, inert: nothing in them can be pressed, focused or read out.

import { useEffect, useMemo, useRef, useState } from "react";
import { MobileDashboard } from "@/app/(mobile)/mobile-v2/mobile-dashboard";
import type { TradeType } from "@/lib/tradeTypes";
import { signupDashboardFixture } from "./fixture";
import css from "./phone-backdrop.module.css";

/** Drift speed, px per second. */
const SPEED = 50;

export function PhoneBackdrop({ trade }: { trade: TradeType | null }) {
  const data = useMemo(() => signupDashboardFixture(trade), [trade]);
  const copyRef = useRef<HTMLDivElement>(null);
  /* One copy's height, in whole pixels: a fractional height would draw the second copy a fraction of a pixel off
     the first, and the wrap would show as a shimmer along every edge. */
  const [copyH, setCopyH] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    void document.fonts.ready.then(() => {
      requestAnimationFrame(() => {
        const h = copyRef.current?.getBoundingClientRect().height ?? 0;
        if (alive && h > 0) setCopyH(Math.ceil(h));
      });
    });
    return () => {
      alive = false;
    };
  }, []);

  const run = copyH ? ({ "--copy-h": `${copyH}px`, "--drift-s": `${Math.round((copyH / SPEED) * 10) / 10}s` } as React.CSSProperties) : undefined;

  return (
    <div className={css.backdrop} inert aria-hidden="true" data-nest="">
      <div className={css.drift}>
        <div className={css.track} data-run={copyH ? "" : undefined} style={run}>
          <div className={css.copy} ref={copyRef}>
            <MobileDashboard data={data} sample />
          </div>
          <div className={css.copy}>
            <MobileDashboard data={data} sample />
          </div>
        </div>
      </div>
      <div className={css.frame}>
        <MobileDashboard data={data} sample />
      </div>
    </div>
  );
}
