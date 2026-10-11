"use client";

/* An estimator sequence as the hero's product shot.

   In the showcase the shots are armed by the SECTION's in-view flag; up here
   each arms itself the same way, through the same hook, so the sequence
   starts when the visitor can see it and not on page load. None of the shots
   needs a stage of its own: AppFrame + STAGE are inside them, and the takeoff
   rail stacks under the stage below 640px on its own media query — which is
   what makes the same build the phone hero too (it replaces PhoneOverview
   there, not just DashboardMock). */

import { DeckShot } from "./deck-shots";
import { FenceShot } from "./fence-shot";
import { HvacEstimatorShot } from "./hvac-estimator-shot";
import type { LandingVariant } from "./landing-variants";
import { RoofShot } from "./roof-shot";
import { SmartProposalShot } from "./smart-proposal-shot";
import { SMART_SCENARIOS } from "./smart-scenarios";
import { useEffect, useState } from "react";
import { metaCustomEvent } from "@/lib/metaEvents";
import { useInView } from "./use-in-view";

/* Meta EstimatorDemoStep from the roof and fence hero windows (2026-10-01):
   each step once per page load — the hero mounts a phone and a desk twin,
   and only the visible one plays, but the set makes sure. Autoplay only:
   these windows have no controls (the HVAC window reports its own, taps and
   tiers included, from hvac-estimator-shot). */
const stepsSent = new Set<string>();
const reportStep = (trade: string) => (step: string) => {
  const key = `${trade}:${step}`;
  if (stepsSent.has(key)) return;
  stepsSent.add(key);
  metaCustomEvent("EstimatorDemoStep", { trade, step, how: "auto" });
};
const roofStep = reportStep("Roofing");
const fenceStep = reportStep("Fencing");

export function HeroVisual({ variant }: { variant: LandingVariant }) {
  const { ref, inView } = useInView<HTMLDivElement>(0.2);
  /* landing-e (pass B): on a phone the shot opens FILLED — lines written,
     total on the plate — so the first screen of the mock shows the result;
     the typing sequence runs from 1024px. Decided after mount (no UA
     sniffing); until then the shot waits, so nothing starts twice.
     A variant with `playOnPhone` (roofing, 2026-10-04 — the analyst: "let
     the hero's product shot play its sequence on phones too, it opens as a
     still today") runs the sequence at every width: the address typed, the
     roof found, traced and tilted, then the takeoff. Nothing moves under it
     while it plays — the rail keeps its room and opens by a clip — and a
     reduced-motion visitor still gets the filled shot (usePhases). */
  const [instant, setInstant] = useState<boolean | null>(null);
  useEffect(() => {
    const id = requestAnimationFrame(() => setInstant(!window.matchMedia("(min-width: 1024px)").matches));
    return () => cancelAnimationFrame(id);
  }, []);
  const active = instant === null ? false : inView;
  const now = instant === true && !variant.playOnPhone;
  return (
    <div ref={ref}>
      {variant.visual === "fence" && <FenceShot active={active} instant={now} onStep={fenceStep} />}
      {variant.visual === "roof" && <RoofShot active={active} instant={now} hero onStep={roofStep} />}
      {variant.visual === "hvac" && <HvacEstimatorShot active={active} instant={now} hero />}
      {variant.visual === "deck" && <DeckShot />}
      {variant.visual === "smart" && (
        <SmartProposalShot active={active} instant={now} scenario={SMART_SCENARIOS[variant.scenario ?? "kitchen"]} />
      )}
    </div>
  );
}
