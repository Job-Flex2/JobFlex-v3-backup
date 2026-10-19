/* THE FIRST SCREEN'S DEMO VIDEO (hvac2, 2026-10-19). The audit's "real
   product demo" above the button: a 45-second screen recording of the
   address-to-proposal workflow, one cut per shape — 9:16 for a phone, 16:9
   for a desk — and one poster frame.

   The files are not recorded yet. Until they are, the demo is the real
   estimator playing itself (hvac-estimator-shot, quick start). To switch:
   put the three files in public/landing-e/ under these names and set READY
   to true — the video then plays first and "Try it yourself ↓" leads to the
   interactive estimator in the showcase. A flag rather than a file check:
   the server never sees public/ on Vercel, and a probe from the browser
   would cost the first screen a round trip and a jump. */

export const HVAC2_DEMO_VIDEO = {
  READY: false,
  phone: "/landing-e/hvac-demo-916.mp4",
  desk: "/landing-e/hvac-demo-169.mp4",
  poster: "/landing-e/hvac-demo-poster.webp",
  /** Below this width the 9:16 cut plays (the hero's phone build). */
  phoneMax: 640,
  seconds: 45,
} as const;

/** What every hvac2 event carries: the version, as industry and as landing. */
export const HVAC2_EVENT = { industry: "hvac2", landing: "hvac2", variant: "e" } as const;
