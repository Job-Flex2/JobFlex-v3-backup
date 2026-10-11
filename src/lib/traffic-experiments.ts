export interface TrafficExperiment {
  key: string;
  path: string;
  variants: readonly string[];
  /** false = registered, not running: no flag request is made and the hook
   *  answers null, so the page renders exactly as it does with no experiment. */
  active: boolean;
  assignment?: "server";
}

// Opt-in only. Add an approved page and its PostHog multivariate flag here.
// Use a new key for each test; never reuse a completed experiment's key.
export const TRAFFIC_EXPERIMENTS: readonly TrafficExperiment[] = [
  // Ended 2026-10-11 (lib/trialOffer TRIAL_TEST_ENDED): kept for its results.
  { key: "signup_trial_length_v1", path: "/", variants: ["a", "b"], active: false, assignment: "server" },
  // The landing's default hero (no `?industry=`). SCAFFOLD ONLY (2026-09-20):
  // variant b's content is the owner's to write — landing-e/hero-experiment.tsx
  // holds the empty slot. To launch: fill the slot, create the multivariate
  // flag `landing_hero_v1` (control / b) in PostHog, then set active: true.
  { key: "landing_hero_v1", path: "/", variants: ["control", "b"], active: false },
];

/** Feature flags are fetched only while something is actually running. */
export const TRAFFIC_EXPERIMENTS_ACTIVE = TRAFFIC_EXPERIMENTS.some((e) => e.active && e.assignment !== "server");
