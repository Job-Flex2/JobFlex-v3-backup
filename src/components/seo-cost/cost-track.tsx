"use client";

import { useEffect } from "react";
import { trackTraffic } from "@/lib/traffic-client";
import { TRAFFIC_EVENTS } from "@/lib/traffic-contract";

// The cost guide's analytics (2026-10-26): one seo_cost_view per load, and a
// seo_cost_cta for every click on an element marked data-seo-cta="<which>".
// The calls to action stay plain server-rendered links; this listens at the
// document, so the page ships no handler per link. Renders nothing.
export function CostTrack({ trade, city }: { trade: string; city: string }) {
  useEffect(() => {
    trackTraffic(TRAFFIC_EVENTS.seoCostView, { trade, city });
    const onClick = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.("[data-seo-cta]");
      const which = el?.getAttribute("data-seo-cta");
      if (which) trackTraffic(TRAFFIC_EVENTS.seoCostCta, { which, trade, city });
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [trade, city]);
  return null;
}
