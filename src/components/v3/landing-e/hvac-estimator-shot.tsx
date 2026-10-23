"use client";

/* THE HVAC ESTIMATOR, IN THE HERO (2026-10-01; replaces the drawn window of
   ad174435). Not a picture of the estimator: the real page's form, copied
   into ./hvac-estimator-demo with its server actions swapped for fixtures
   (see the copy's header), mounted under the dashboard shell's own tokens
   and the shell's sprite, inside the landing's app frame — so the frame and
   the real /dashboard/hvac-estimator share one markup and one stylesheet.

   THE FRAME. The page is laid out at its own width (the content column a
   1440 px desk shows: the shell's 1728 px minus the sidebar) and zoomed to
   the frame, the way the roof and the fence shots are drawn to theirs; on
   a phone it is laid out at the phone's width, so the estimator's own
   handheld rules apply. The frame is a fixed height and scrolls inside —
   the whole page is there, the way it is in the app.

   THE SEQUENCE. From the moment the frame is in view the form walks itself:
   the job, the address typed and looked up, the three plates read, the
   facts confirmed, the design (with the heat pump picked, so the capacity
   chart draws), the estimate. Each move is the form's own handle (demo
   hooks) — the same state the real page's controls set. Any tap or key in
   the frame ends the sequence and the visitor has the estimator. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sprite } from "@/components/v3/proposals-blueprint/sprite";
import proposalStyles from "@/components/v3/proposals-blueprint/proposals.module.css";
import dashboardStyles from "@/components/v3/dashboard-blueprint/blueprint.module.css";
import s from "@/components/v3/hvac-estimator-blueprint/hvac-estimator.module.css";
import { trackTraffic } from "@/lib/traffic-client";
import { TRAFFIC_EVENTS } from "@/lib/traffic-contract";
import { AppFrame, TYPE_MS } from "./showcase-kit";
import { HvacEstimatorForm } from "./hvac-estimator-demo/hvac-estimator-form";
import { DEMO_READS } from "./hvac-estimator-demo/demo-actions";
import { DEMO_ADDRESS, T, T2, T3, T4 } from "./hvac-timeline";
import type { DemoStep, HvacDemoHandle, HvacDemoHooks } from "./hvac-estimator-demo/demo-hooks";
import { PLATE_INDOOR, PLATE_OUTDOOR, PLATE_PANEL } from "./hvac-estimator-demo/plates";

/** The width the page is laid out at on the desk, before it is zoomed to the
 *  frame. It was the shell's 1728 px design width less its 264 px sidebar
 *  (1464); 1350 since 2026-10-01 (owner: "the content is small") — the frame
 *  draws the page ~8 % larger, and the estimator's own layout (the ESTIMATE
 *  rail beside the step, the five-step row, the field grid) still holds at
 *  1350, above its 860 px handheld break. */
const DESK_PAGE_W = 1350;
/** The frame is laid out at the phone's width below this (the estimator's
 *  own handheld rules are at 860 and 520; the hero's phone build at 640). */
const PHONE_MAX = 640;

/* The sequence's marks (T … T4) and the showcase slide's length live in
   hvac-timeline.ts, so the showcase can read them without loading this shot. */

/** The typed answers the walk would have caught: the ducts in the crawl,
 *  fair, the return and the registers counted, gas at the house. */
const TYPED_FACTS: Record<string, unknown> = {
  "ducts.location": "crawl",
  "ducts.condition": "fair",
  foundation: "crawl-vented",
  "ducts.returnGrilleSqIn": 400,
  "ducts.supplyRegisters": 9,
  "gas.available": true,
  "gas.pipeIn": 0.75,
};

const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).map((n) => (s as Record<string, string>)[n as string] ?? (n as string)).join(" ");

export function HvacEstimatorShot({ active, hero = false }: { active: boolean; instant?: boolean; hero?: boolean }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HvacDemoHandle | null>(null);
  // Where the sequence is, and whether the visitor took over.
  const timers = useRef<number[]>([]);
  const [manual, setManual] = useState(false);
  const manualRef = useRef(false);
  const [step, setStep] = useState<DemoStep>("job");
  const [zoom, setZoom] = useState(1);

  // The page's zoom follows the frame's width (see the header).
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const fit = () => {
      const w = el.clientWidth;
      if (!w) return; // the hidden twin (the hero mounts a phone build and a desk build)
      setZoom(window.innerWidth < PHONE_MAX ? 1 : Math.max(0.3, Math.min(1, w / DESK_PAGE_W)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const stop = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);
  const takeOver = useCallback(() => {
    if (manualRef.current) return;
    manualRef.current = true;
    setManual(true);
    stop();
  }, [stop]);

  // The sequence, once, from the arming.
  useEffect(() => {
    if (!active || manualRef.current) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const at = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(() => { if (!manualRef.current) fn(); }, reduced ? Math.min(ms, 50) : ms));
    const h = () => handleRef.current;
    at(T.house, () => h()?.go("house"));
    // The address, a character at a time, into the real field.
    for (let i = 1; i <= DEMO_ADDRESS.length; i++) at(T.typeFrom + i * TYPE_MS, () => h()?.typeAddress(DEMO_ADDRESS.slice(0, i)));
    at(T.lookup, () => void h()?.lookup());
    at(T2.plates, () => h()?.setMode("plates"));
    const plate = (key: "outdoor" | "indoor" | "panel", thumb: string, t: number) => {
      at(t, () => h()?.setPlates({ [key]: { thumb, busy: true } }));
      at(t + 900, () => h()?.setPlates({ [key]: { thumb, read: DEMO_READS[key] } }));
    };
    plate("outdoor", PLATE_OUTDOOR, T3.outdoor);
    plate("indoor", PLATE_INDOOR, T3.indoor);
    plate("panel", PLATE_PANEL, T3.panel);
    at(T3.typed, () => h()?.setTyped(TYPED_FACTS));
    at(T4.design, () => h()?.go("design"));
    at(T4.heatPump, () => h()?.setOutdoorKind("heat-pump"));
    at(T4.estimate, () => h()?.go("estimate"));
    return stop;
  }, [active, stop]);

  const hooks = useMemo<HvacDemoHooks>(() => ({
    bind: (h) => { handleRef.current = h; },
    onStep: (k) => {
      setStep(k);
      trackTraffic(TRAFFIC_EVENTS.hvacDemoStep, { step: k, how: manualRef.current ? "tap" : "auto", hero, industry: "hvac", variant: "e" });
    },
    onPick: (p) => {
      trackTraffic(TRAFFIC_EVENTS.hvacDemoTier, { tier: p.tier, unit: p.id, subtotal: Math.round(p.subtotal), hero, industry: "hvac", variant: "e" });
    },
    // The landing's "Convert to proposal": the page's own proposal section,
    // which carries this same job (landing-groups HVAC_PROPOSAL).
    onConvert: () => document.getElementById("proposals")?.scrollIntoView({ behavior: "smooth", block: "start" }),
  }), [hero]);

  return (
    <AppFrame path="www.jobflex.app/dashboard/hvac-estimator" body="#f2f0eb">
      {/* The frame is the window: its transform makes it the containing block
          of the page's fixed summary bar on a phone, so the bar pins to the
          frame's foot and not the visitor's screen; the scroller inside it is
          what the steps scroll (data-hvac-scroll). */}
      <div
        ref={frameRef}
        className={`lp-hvac-frame${hero ? " lp-hvac-frame--hero" : ""}`}
        data-hvac-window
        data-step={step}
        data-manual={manual ? "1" : undefined}
        onPointerDownCapture={takeOver}
        onKeyDownCapture={takeOver}
      >
        <div className="lp-hvac-scroll" data-hvac-scroll>
        {/* The dashboard shell's root: its tokens, its reset, its sprite — the
            page's stylesheet is scoped to `.jf-blueprint .content`. The root's
            own height and overflow are the app window's; here the frame scrolls. */}
        <div className={`${proposalStyles.bp} ${dashboardStyles.bp} jf-blueprint lp-hvac-page`} style={{ zoom }}>
          <Sprite />
          <div className="content">
            <div className={cx("page-head")}>
              <div>
                <div className={cx("kicker")}>Automation · Replacement · example</div>
                <h2 className={cx("page-title")}>HVAC estimator</h2>
              </div>
            </div>
            {/* aiEnabled: the plates and a walk are read here too — from the
                example's fixtures, after the pause a model run takes. */}
            <HvacEstimatorForm aiEnabled demo={hooks} />
          </div>
        </div>
        </div>
      </div>
    </AppFrame>
  );
}
