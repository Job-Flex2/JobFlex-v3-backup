/* THE FIRST SCREEN'S DEMO FILM (hvac2, 2026-10-19). "Real product demo ·
   address to proposal in 40 seconds", one cut per shape, silent:
   16:9 for a desk (≥ 640 px, inside the app frame) and 4:5 for a phone (the
   column's full width), each as WebM first and MP4 second, and one poster
   per shape — the poster is the first screen's largest paint, the film plays
   over it once it has frames.

   A FLAG, NOT A FILE CHECK. The page is rendered per request
   (src/app/page.tsx, force-dynamic) and on Vercel the server function does
   not carry public/ — a check there would say "no film" in production while
   the files sit on the CDN; a check from the browser would cost the first
   screen a request and a swap. So the six files land in public/landing-e/
   under the names below and READY turns true in the same commit. Until
   then hvac2's first screen shows HVAC's own estimator shot, as on
   ?industry=hvac (hero-visual.tsx). The six files are in (4cce4867): on. */

export const HVAC2_DEMO_VIDEO = {
  READY: true,
  /** ≥ 640 px. */
  desk: { webm: "/landing-e/hvac-demo-16x9.webm", mp4: "/landing-e/hvac-demo-16x9.mp4", poster: "/landing-e/hvac-demo-poster-16x9.webp" },
  /** < 640 px. */
  phone: { webm: "/landing-e/hvac-demo-4x5.webm", mp4: "/landing-e/hvac-demo-4x5.mp4", poster: "/landing-e/hvac-demo-poster-4x5.webp" },
  /** The cut's length, as the label says it. */
  seconds: 40,
} as const;

/** The one media query both the poster and the film switch on. */
export const HVAC2_DESK_MEDIA = "(min-width: 640px)";
