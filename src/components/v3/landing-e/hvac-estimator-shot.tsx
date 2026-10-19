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
import { AppFrame, READ_HOLD, TYPE_MS } from "./showcase-kit";
import { HvacEstimatorForm } from "./hvac-estimator-demo/hvac-estimator-form";
import { DEMO_ADDRESS, DEMO_READS } from "./hvac-estimator-demo/demo-actions";
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

/* The sequence, ms from the frame's arming. The address types at the
   landing's pace (showcase-kit TYPE_MS), the lookups answer after the
   fixtures' own waits (demo-actions), and the design holds long enough to
   read before the estimate. */
const T = {
  house: 1500,
  typeFrom: 2100,
  lookup: 2100 + DEMO_ADDRESS.length * TYPE_MS + 600,
};
const T2 = {
  plates: T.lookup + 1100 + 900, // the lookup's wait, then the intake step has opened
};
const PLATE_GAP = 1500;
const T3 = {
  outdoor: T2.plates + 500,
  indoor: T2.plates + 500 + PLATE_GAP,
  panel: T2.plates + 500 + PLATE_GAP * 2,
  typed: T2.plates + 500 + PLATE_GAP * 3,
};
const T4 = {
  design: T3.typed + 900,
  heatPump: T3.typed + 900 + 2600,
  estimate: T3.typed + 900 + 2600 + 2600,
};
const DONE = T4.estimate + 1200;

export const HVAC_TIMELINE = {
  done: DONE,
  /** The showcase slide's length: the sequence, then the estimate held to read. */
  slide: DONE + READ_HOLD,
};

/* THE QUICK START (hvac2's first screen, 2026-10-19 — "no 1.5 s of an empty
   form"): the frame opens on the house with the address already in the field
   (the form's own initialAddress, so the server's HTML is that step too),
   and the lookup runs at once; everything after it is the sequence above,
   moved up by what was skipped. */
const QUICK_LOOKUP = 400;
const QUICK_SHIFT = T.lookup - QUICK_LOOKUP;
export const HVAC_QUICK_DONE = DONE - QUICK_SHIFT;

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

export function HvacEstimatorShot({
  active,
  hero = false,
  quick = false,
  landing,
  onProgress,
}: {
  active: boolean;
  instant?: boolean;
  hero?: boolean;
  /** Open on the house, the address in, and run from the lookup (QUICK_SHIFT). */
  quick?: boolean;
  /** A version of a trade's page ("hvac2"): the step and tier events name it as their industry and landing. */
  landing?: string;
  /** The sequence's clock, by the quarter: 0 as it starts, then 25, 50, 100 — never after a takeover. */
  onProgress?: (pct: 0 | 25 | 50 | 100) => void;
}) {
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
    const shift = quick ? QUICK_SHIFT : 0;
    const done = DONE - shift;
    if (onProgress) {
      at(0, () => onProgress(0));
      at(done * 0.25, () => onProgress(25));
      at(done * 0.5, () => onProgress(50));
      at(done, () => onProgress(100));
    }
    if (!quick) {
      at(T.house, () => h()?.go("house"));
      // The address, a character at a time, into the real field.
      for (let i = 1; i <= DEMO_ADDRESS.length; i++) at(T.typeFrom + i * TYPE_MS, () => h()?.typeAddress(DEMO_ADDRESS.slice(0, i)));
    }
    at(T.lookup - shift, () => void h()?.lookup());
    at(T2.plates - shift, () => h()?.setMode("plates"));
    const plate = (key: "outdoor" | "indoor" | "panel", thumb: string, t: number) => {
      at(t, () => h()?.setPlates({ [key]: { thumb, busy: true } }));
      at(t + 900, () => h()?.setPlates({ [key]: { thumb, read: DEMO_READS[key] } }));
    };
    plate("outdoor", PLATE_OUTDOOR, T3.outdoor - shift);
    plate("indoor", PLATE_INDOOR, T3.indoor - shift);
    plate("panel", PLATE_PANEL, T3.panel - shift);
    at(T3.typed - shift, () => h()?.setTyped(TYPED_FACTS));
    at(T4.design - shift, () => h()?.go("design"));
    at(T4.heatPump - shift, () => h()?.setOutdoorKind("heat-pump"));
    at(T4.estimate - shift, () => h()?.go("estimate"));
    return stop;
    // onProgress is the page's own callback, read once with the sequence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, stop, quick]);

  const hooks = useMemo<HvacDemoHooks>(() => ({
    bind: (h) => { handleRef.current = h; },
    onStep: (k) => {
      setStep(k);
      trackTraffic(TRAFFIC_EVENTS.hvacDemoStep, { step: k, how: manualRef.current ? "tap" : "auto", hero, industry: landing ?? "hvac", variant: "e", ...(landing ? { landing } : {}) });
    },
    onPick: (p) => {
      trackTraffic(TRAFFIC_EVENTS.hvacDemoTier, { tier: p.tier, unit: p.id, subtotal: Math.round(p.subtotal), hero, industry: landing ?? "hvac", variant: "e", ...(landing ? { landing } : {}) });
    },
    // The landing's "Convert to proposal": the page's own proposal section,
    // which carries this same job (landing-groups HVAC_PROPOSAL).
    onConvert: () => document.getElementById("proposals")?.scrollIntoView({ behavior: "smooth", block: "start" }),
  }), [hero, landing]);

  return (
    <AppFrame path="www.jobflex.app/dashboard/hvac-estimator" body="#f2f0eb">
      {/* The frame is the window: its transform makes it the containing block
          of the page's fixed summary bar on a phone, so the bar pins to the
          frame's foot and not the visitor's screen; the scroller inside it is
          what the steps scroll (data-hvac-scroll). */}
      <div
        ref={frameRef}
        className={`lp-hvac-frame${hero ? " lp-hvac-frame--hero" : ""}${quick ? " lp-hvac-frame--quick" : ""}`}
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
            <HvacEstimatorForm aiEnabled demo={hooks} initialAddress={quick ? DEMO_ADDRESS : undefined} />
          </div>
        </div>
        </div>
      </div>
    </AppFrame>
  );
}
