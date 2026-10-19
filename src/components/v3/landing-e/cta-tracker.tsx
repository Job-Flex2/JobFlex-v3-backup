"use client";

import { useEffect } from "react";
import { trackTraffic } from "@/lib/traffic-client";
import { TRAFFIC_EVENTS } from "@/lib/traffic-contract";
import type { LandingVariantKey } from "./landing-variants";

/* One `cta_click` per click on any element carrying `data-cta` — the hero
   button, the Google button, the sticky phone bar, the footer, the nav and
   the intro (CRO stage 1, 2026-09-09; the gold "pill" placement is retired
   since 2026-10-14 and only appears in older events). Delegated from the
   document so the anchors stay plain server-rendered links; the capture phase
   runs before the navigation, and trackTraffic sends by beacon, so the event
   survives the page leaving. Properties: placement, the button's words,
   the trade hero shown ("default" when none), the target path; `spot` when
   the element names which of a kind it is (the trial badges, 2026-10-02);
   `button` when it names which button it is (data-cta-button: the plan a
   card's button starts, the nav's trial or login — 2026-10-15).
   `only` limits the tracker to some placements — /pricing tracks the plan
   buttons and the nav's (pricing-visit.tsx). */
export function CtaTracker({ industry, only }: { industry: LandingVariantKey | undefined; only?: string[] }) {
  useEffect(() => {
    const onClick = (ev: MouseEvent) => {
      const target = ev.target instanceof Element ? ev.target.closest<HTMLElement>("[data-cta]") : null;
      if (!target) return;
      const placement = target.dataset.cta || "unknown";
      if (only && !only.includes(placement)) return;
      const label = (target.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80);
      const href = target instanceof HTMLAnchorElement ? target.getAttribute("href") ?? "" : "";
      trackTraffic(TRAFFIC_EVENTS.ctaClick, {
        placement,
        label,
        industry: industry ?? "default",
        href: href.split("?")[0],
        variant: "e",
        ...(target.dataset.ctaSpot ? { spot: target.dataset.ctaSpot } : {}),
        ...(target.dataset.ctaButton ? { button: target.dataset.ctaButton } : {}),
      });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `only` is a literal per page
  }, [industry]);
  return null;
}
