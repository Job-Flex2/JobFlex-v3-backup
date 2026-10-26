"use client";
// The tour's one piece of shared state (2026-10-26): what the sidebar chip
// shows and the doors the Overview's "Show me how" knocks on. The controller
// (onboarding-tour.tsx) owns the state and publishes it here; the chip, the
// drawer's chip and the first-run card's button read it from wherever they
// are mounted in the shell. Module scope, like the other shell stores.

import { useSyncExternalStore } from "react";
import type { TourPathId } from "@/lib/onboarding/tour-paths";

export type TourChipState =
  | { kind: "none" }
  | { kind: "first"; path: TourPathId; done: number; total: number; active: boolean }
  | { kind: "next"; done: number; total: number };

type Doors = { start: () => void; resume: () => void; openNext: () => void };

const NONE: TourChipState = { kind: "none" };
let chip: TourChipState = NONE;
let doors: Doors | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function publishTour(next: TourChipState, nextDoors: Doors | null) {
  chip = next;
  doors = nextDoors;
  emit();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The server — and hydration, which must match it — never has a tour drawn. */
export function useTourChip(): TourChipState {
  return useSyncExternalStore(subscribe, () => chip, () => NONE);
}

/** True once a tour controller is mounted for this person (a failed read mounts none). */
export function useTourReady(): boolean {
  return useSyncExternalStore(subscribe, () => doors !== null, () => false);
}

export const tourDoors = {
  start: () => doors?.start(),
  resume: () => doors?.resume(),
  openNext: () => doors?.openNext(),
};
