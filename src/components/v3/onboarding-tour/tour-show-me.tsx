"use client";
// "Show me how" on the Overview's first-run card (2026-10-26): starts the
// first-estimate tour for anyone, the companies it does not offer itself to
// included. Drawn only when a tour is mounted for this person.

import { tourDoors, useTourReady } from "./tour-store";

export function TourShowMe({ className }: { className: string }) {
  const ready = useTourReady();
  if (!ready) return null;
  return (
    <button type="button" className={className} onClick={() => tourDoors.start()} data-cta="first-run-tour">
      Show me how
    </button>
  );
}
