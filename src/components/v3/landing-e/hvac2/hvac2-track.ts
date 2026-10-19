"use client";

/* hvac2's own events (traffic-contract: demo_play, demo_25, demo_50,
   demo_100). Every one names the version — industry and
   landing "hvac2" — and the ad hook the headline showed, if any, the way
   landing_view and cta_click do on this page. Each fires once per browser
   session (sessionStorage; a blocked storage falls back to once per load),
   so a reload or a second loop of the film is not a second view. */

import { trackTraffic } from "@/lib/traffic-client";
import { TRAFFIC_EVENTS } from "@/lib/traffic-contract";

type Hvac2Event = "demoPlay" | "demo25" | "demo50" | "demo100";

const sentThisLoad = new Set<string>();

export function trackHvac2Once(event: Hvac2Event, props: Record<string, string | number | boolean>, hook?: string) {
  const name = TRAFFIC_EVENTS[event];
  const key = `jf_hvac2_${name}`;
  if (sentThisLoad.has(key)) return;
  sentThisLoad.add(key);
  try {
    if (window.sessionStorage.getItem(key)) return;
    window.sessionStorage.setItem(key, "1");
  } catch {
    /* storage blocked: once per load */
  }
  trackTraffic(name, { ...props, industry: "hvac2", landing: "hvac2", variant: "e", ...(hook ? { hook } : {}) });
}
