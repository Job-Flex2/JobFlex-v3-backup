"use client";

/* The demo film's events (traffic-contract: demo_play, demo_25, demo_50,
   demo_100). Every one names the landing it played on — industry and
   landing, the trade's key ("hvac", "roofing", "fencing") — and the ad hook
   the headline showed, if any, the way landing_view does. Each fires once
   per landing per browser session (sessionStorage; a blocked storage falls
   back to once per load), so a reload or a second loop of the film is not a
   second view. */

import { trackTraffic } from "@/lib/traffic-client";
import { TRAFFIC_EVENTS } from "@/lib/traffic-contract";

export type DemoEvent = "demoPlay" | "demo25" | "demo50" | "demo100";

const sentThisLoad = new Set<string>();

export function trackDemoOnce(event: DemoEvent, landing: string, hook?: string) {
  const name = TRAFFIC_EVENTS[event];
  const key = `jf_demo_${landing}_${name}`;
  if (sentThisLoad.has(key)) return;
  sentThisLoad.add(key);
  try {
    if (window.sessionStorage.getItem(key)) return;
    window.sessionStorage.setItem(key, "1");
  } catch {
    /* storage blocked: once per load */
  }
  trackTraffic(name, { kind: "video", industry: landing, landing, variant: "e", ...(hook ? { hook } : {}) });
}
