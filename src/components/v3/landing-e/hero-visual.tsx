"use client";

/* An estimator sequence as the hero's product shot.

   In the showcase the shots are armed by the SECTION's in-view flag; up here
   each arms itself the same way, through the same hook, so the sequence
   starts when the visitor can see it and not on page load. None of the shots
   needs a stage of its own: AppFrame + STAGE are inside them, and the takeoff
   rail stacks under the stage below 640px on its own media query — which is
   what makes the same build the phone hero too (it replaces PhoneOverview
   there, not just DashboardMock).

   A variant with a `film` (HVAC, roofing, fencing — 2026-10-19) shows its
   estimator's demo film in the shot's place (demo-film.tsx); the shot itself
   stays the showcase's. */

import { DeckShot } from "./deck-shots";
import { DemoFilm } from "./demo-film";
import { FenceShot } from "./fence-shot";
import { HvacEstimatorShot } from "./hvac-estimator-shot";
import type { LandingVariant } from "./landing-variants";
import { RoofShot } from "./roof-shot";
import { SmartProposalShot } from "./smart-proposal-shot";
import { SMART_SCENARIOS } from "./smart-scenarios";
import { useEffect, useState } from "react";
import { useInView } from "./use-in-view";

export function HeroVisual({
  variant,
  slot = "desk",
  hook,
  landing,
}: {
  variant: LandingVariant;
  /** Which of the hero's two builds this is (hero.tsx): the film mounts its video in the one on screen. */
  slot?: "phone" | "desk";
  /** The ad hook the headline shows, for the film's events. */
  hook?: string;
  /** The landing's key ("hvac", "roofing", "fencing"), for the film's events. */
  landing?: string;
}) {
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
  if (variant.film) return <DemoFilm film={variant.film} slot={slot} landing={landing ?? variant.film} hook={hook} />;
  return (
    <div ref={ref}>
      {variant.visual === "fence" && <FenceShot active={active} instant={now} />}
      {variant.visual === "roof" && <RoofShot active={active} instant={now} hero />}
      {variant.visual === "hvac" && <HvacEstimatorShot active={active} instant={now} hero />}
      {variant.visual === "deck" && <DeckShot />}
      {variant.visual === "smart" && (
        <SmartProposalShot active={active} instant={now} scenario={SMART_SCENARIOS[variant.scenario ?? "kitchen"]} />
      )}
    </div>
  );
}
