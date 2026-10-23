/* The HVAC shot's clock, apart from the shot (2026-10-22). The showcase sizes
   its HVAC slide by HVAC_TIMELINE; reading it from hvac-estimator-shot.tsx
   pulled the whole estimator form — lib/hvac, the toast, the dashboard's CSS —
   into every landing's first load, though only the HVAC landing shows it.
   The shot and the showcase both read the marks from here; the shot itself is
   loaded where it is rendered. */

import { READ_HOLD, TYPE_MS } from "./showcase-kit";

/** The example house the demo types (the fixtures in hvac-estimator-demo/demo-actions read it from here). */
export const DEMO_ADDRESS = "4418 NE 97th St, Kirkland, WA 98033";

/* The sequence, ms from the frame's arming. The address types at the
   landing's pace (showcase-kit TYPE_MS), the lookups answer after the
   fixtures' own waits (demo-actions), and the design holds long enough to
   read before the estimate. */
export const T = {
  house: 1500,
  typeFrom: 2100,
  lookup: 2100 + DEMO_ADDRESS.length * TYPE_MS + 600,
};
export const T2 = {
  plates: T.lookup + 1100 + 900, // the lookup's wait, then the intake step has opened
};
const PLATE_GAP = 1500;
export const T3 = {
  outdoor: T2.plates + 500,
  indoor: T2.plates + 500 + PLATE_GAP,
  panel: T2.plates + 500 + PLATE_GAP * 2,
  typed: T2.plates + 500 + PLATE_GAP * 3,
};
export const T4 = {
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
