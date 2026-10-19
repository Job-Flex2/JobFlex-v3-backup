"use client";

/* HVAC v2 — THE ESTIMATOR TO TRY (#try, 2026-10-19), under the sample, where
   the hero's "Try it yourself ↓" leads once the film is in the hero. The
   real estimator form playing itself (hvac-estimator-shot), handed over at
   the first tap. Its code — the form and the engine — is fetched only as
   the section nears the screen, so the first screen does not carry it; the
   frame keeps its height meanwhile, so nothing under it moves.

   The demo answers every address with its example house (hvac-estimator-
   demo/demo-actions), so the section says so instead of promising "any
   address". Shown only while the hero plays the film: while the hero is
   this same estimator, a second copy would be the same demo twice. */

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { Reveal } from "../reveal";

const HvacEstimatorShot = dynamic(() => import("../hvac-estimator-shot").then((m) => m.HvacEstimatorShot), { ssr: false });

export function Hvac2Try() {
  const box = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === "undefined") { setNear(true); setInView(true); return; }
    const ioNear = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setNear(true); ioNear.disconnect(); } }, { rootMargin: "800px 0px" });
    const ioIn = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setInView(true); ioIn.disconnect(); } }, { threshold: 0.2 });
    ioNear.observe(el);
    ioIn.observe(el);
    return () => { ioNear.disconnect(); ioIn.disconnect(); };
  }, []);
  return (
    <section id="try" className="lp-h2-sec lp-h2-sec--try">
      <div className="mx-auto lp-wrap">
        <Reveal>
          <h2 className="lp-sec-title">Try it yourself</h2>
          <p className="lp-sec-lede">The real estimator, running on an example house — tap anywhere in it to take over. On your account, the address you type is the house that is looked up.</p>
        </Reveal>
        <div ref={box} className="lp-h2-try-box">
          {near ? <HvacEstimatorShot active={inView} landing="hvac2" /> : null}
        </div>
      </div>
    </section>
  );
}
