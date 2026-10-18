"use client";

import { useEffect, useRef } from "react";
import { flushTrafficNow, onTrafficReady, trackTraffic, trafficReadyAt } from "@/lib/traffic-client";
import { TRAFFIC_EVENTS } from "@/lib/traffic-contract";
import { claimPageLoad, visibleAt } from "@/lib/pageClock";
import type { LandingVariantKey } from "./landing-variants";

/* THE FIRST SCREEN AS THE VISITOR'S PHONE DREW IT (the analyst, 2026-10-04).
   Lab loads on Google's mobile profile showed the headline arriving 7–8 s
   after the tap (hero-entrance keeps the copy invisible until the page's
   JavaScript is in); this measures the same moments on real visits, so the
   analyst can say what the first screen costs and see a fix land. One
   `landing_timing` per load: the first paint and the LCP from the browser's
   own timeline, the headline's moment from hero-entrance
   (window.__jfHeroShownAt), "ready" = this effect (the JavaScript has taken
   over), the tracking library's own start, the KB downloaded so far and the
   connection where Chrome names it. Sent once the headline has shown and
   the tracking is in — or, leaving before that, by beacon with `shown` false
   and the moment they left. Nothing here is personal: numbers and a trade.
   ONE PER REAL LOAD, IN VISIBLE TIME (lib/pageClock, 2026-10-17): every
   moment is ms since the load with the tab's hidden spans taken out, and only
   the landing the document was loaded on reports — one reached by a <Link>
   or Back (the logo from the sign-up form) sent the document's age as its
   timing (136 s for a page drawn at once). */
export function LandingTiming({ industry }: { industry: LandingVariantKey | undefined }) {
  // Survives StrictMode's simulated remount and a change of trade on the same page; a new mount is a new arrival.
  const load = useRef<{ first: boolean; readyMs: number; sent: boolean } | null>(null);
  useEffect(() => {
    if (typeof performance === "undefined") return;
    if (!load.current) load.current = { first: claimPageLoad("landing"), readyMs: visibleAt(), sent: false };
    const me = load.current;
    if (!me.first || me.sent) return;
    const readyMs = me.readyMs;
    const w = window as Window & { __jfHeroShownAt?: number };
    const num = (x: number | null | undefined) => (typeof x === "number" && Number.isFinite(x) ? Math.round(x) : -1);
    // A moment off the browser's timeline, as visible time since the load.
    const vis = (x: number | null | undefined) => (typeof x === "number" && Number.isFinite(x) ? visibleAt(x) : -1);
    const paint = () => {
      try { const p = performance.getEntriesByType("paint").find((e) => e.name === "first-contentful-paint"); return p ? vis(p.startTime) : -1; } catch { return -1; }
    };
    let lcp = -1;
    let lcpObserver: PerformanceObserver | null = null;
    try {
      lcpObserver = new PerformanceObserver((l) => { for (const e of l.getEntries()) lcp = vis(e.startTime); });
      lcpObserver.observe({ type: "largest-contentful-paint", buffered: true });
    } catch { lcpObserver = null; }
    const kb = () => {
      try {
        const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
        const res = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
        const bytes = (nav?.transferSize ?? 0) + res.reduce((a, e) => a + (e.transferSize || 0), 0);
        return bytes > 0 ? Math.round(bytes / 1024) : -1;
      } catch { return -1; }
    };
    const connection = () => {
      const c = (navigator as Navigator & { connection?: { effectiveType?: string; downlink?: number; rtt?: number } }).connection;
      return c ? { connection: String(c.effectiveType ?? ""), downlink: num(c.downlink), rtt: num(c.rtt) } : { connection: "", downlink: -1, rtt: -1 };
    };
    const send = (shown: boolean) => {
      if (me.sent) return;
      me.sent = true;
      lcpObserver?.disconnect();
      trackTraffic(TRAFFIC_EVENTS.landingTiming, {
        shown,
        hero_ms: shown ? vis(w.__jfHeroShownAt) : -1,
        left_ms: shown ? -1 : visibleAt(),
        paint_ms: paint(), lcp_ms: lcp, ready_ms: readyMs, tracked_ms: vis(trafficReadyAt()), kb: kb(),
        ...connection(),
        industry: industry ?? "default", variant: "e",
      });
    };
    // Shown: a beat for the LCP and the tracking to settle, then the send
    // (queued until the library is in, if it is not yet).
    let poll = 0, settle = 0, offReady: (() => void) | null = null;
    const whenShown = () => {
      window.clearInterval(poll);
      settle = window.setTimeout(() => { offReady = onTrafficReady(() => send(true)); }, 1500);
    };
    if (w.__jfHeroShownAt !== undefined) whenShown();
    else poll = window.setInterval(() => { if (w.__jfHeroShownAt !== undefined) whenShown(); }, 100);
    // Leaving first: what is known goes by beacon. traffic-client's own
    // pagehide flush ran before this handler, so the flush is asked for again.
    const onLeave = () => { send(w.__jfHeroShownAt !== undefined); flushTrafficNow(); };
    const onHide = () => { if (document.visibilityState === "hidden") onLeave(); };
    window.addEventListener("pagehide", onLeave);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.clearInterval(poll); window.clearTimeout(settle); offReady?.(); lcpObserver?.disconnect();
      window.removeEventListener("pagehide", onLeave); document.removeEventListener("visibilitychange", onHide);
    };
  }, [industry]);
  return null;
}
