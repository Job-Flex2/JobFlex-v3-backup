"use client";

import { useEffect } from "react";
import { trackHvac2Once } from "./hvac2-track";

/* `sample_open` for #sample (hvac2-sample.tsx), once per session: a click on
   a link to it ("View a sample estimate…" in the hero) or the finished
   estimate itself coming into view — a third of it on screen. */
export function Hvac2SampleTracker({ hook }: { hook?: string }) {
  useEffect(() => {
    const onClick = (ev: MouseEvent) => {
      const a = ev.target instanceof Element ? ev.target.closest("[data-sample-link]") : null;
      if (a) trackHvac2Once("sampleOpen", { from: "link" }, hook);
    };
    document.addEventListener("click", onClick, true);
    const doc = document.querySelector("#sample .lp-h2-doc");
    let io: IntersectionObserver | null = null;
    if (doc && typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver(([e]) => {
        if (!e.isIntersecting) return;
        trackHvac2Once("sampleOpen", { from: "view" }, hook);
        io?.disconnect();
      }, { threshold: 0.33 });
      io.observe(doc);
    }
    return () => {
      document.removeEventListener("click", onClick, true);
      io?.disconnect();
    };
  }, [hook]);
  return null;
}
