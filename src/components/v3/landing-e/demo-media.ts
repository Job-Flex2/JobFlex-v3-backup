/* THE FIRST SCREEN'S DEMO FILMS (2026-10-19). One per estimator the ads
   sell — HVAC, roof, fence — each recorded from the real app
   (advertisement/hvac, advertisement/roof, advertisement/fence), silent,
   "Real product demo · address to proposal in 40 seconds". Two cuts per
   film: 16:9 for a desk (≥ 640 px, inside the app frame) and 4:5 for a
   phone (the column's full width), each as MP4 first and WebM second, and
   one poster per cut — the poster is the first screen's largest paint, the
   film plays over it once it has frames.

   A landing names its film in landing-variants (`film`); demo-film.tsx
   plays it in the hero shot's place. The files sit in public/landing-e/ —
   no file check: the page is rendered per request and on Vercel the server
   function does not carry public/, so a check would say "no film" in
   production while the files sit on the CDN. */

export type DemoFilmKey = "hvac" | "roof" | "fence";

/** `mp4Type` / `webmType`: the <source> types with their codecs, so a browser
 *  skips a file it cannot decode instead of choosing it and stalling. */
type Cut = { webm: string; mp4: string; poster: string; mp4Type: string; webmType: string };

export type DemoFilm = {
  /** ≥ 640 px. */
  desk: Cut;
  /** < 640 px. */
  phone: Cut;
  /** The app frame's address line: the page the film was recorded on. */
  path: string;
  /** The frame's ground while the poster loads — the recorded page's own. */
  body: string;
  /** The film's height on a desk, in px: the height of the shot it replaces
   *  (its frame without the address bar), so the hero keeps its height. The
   *  16:9 box is no wider than this × 16/9. */
  deskHeight: number;
  /** What the film shows, for a screen reader. */
  label: string;
};

/* The codecs as the files carry them (render-demo.js: x264 High, libvpx-vp9),
   read off each MP4's avcC box: the 16:9 cut is High 5.1 (avc1.640033), the
   4:5 cut High 5.0 (avc1.640032), the same for all three films. A re-render
   at another size or level changes them — read them again. */
const WEBM_TYPE = 'video/webm; codecs="vp9"';
const cuts = (name: string) => ({
  desk: { webm: `/landing-e/${name}-demo-16x9.webm`, mp4: `/landing-e/${name}-demo-16x9.mp4`, poster: `/landing-e/${name}-demo-poster-16x9.webp`, mp4Type: 'video/mp4; codecs="avc1.640033"', webmType: WEBM_TYPE },
  phone: { webm: `/landing-e/${name}-demo-4x5.webm`, mp4: `/landing-e/${name}-demo-4x5.mp4`, poster: `/landing-e/${name}-demo-poster-4x5.webp`, mp4Type: 'video/mp4; codecs="avc1.640032"', webmType: WEBM_TYPE },
});

export const DEMO_FILMS: Record<DemoFilmKey, DemoFilm> = {
  hvac: {
    ...cuts("hvac"),
    path: "www.jobflex.app/dashboard/hvac-estimator",
    body: "#f2f0eb",
    deskHeight: 600,
    label: "JobFlex HVAC estimator: an address becomes a load, a sized system, priced lines and a proposal",
  },
  roof: {
    ...cuts("roof"),
    path: "www.jobflex.app/dashboard/roof-estimator",
    body: "#e9eae6",
    deskHeight: 430,
    label: "JobFlex roof estimator: an address becomes a measured roof, priced materials and labor and a proposal",
  },
  fence: {
    ...cuts("fence"),
    path: "www.jobflex.app/dashboard/fence-estimator",
    body: "#20222a",
    deskHeight: 430,
    label: "JobFlex fence estimator: an address becomes the lot line, a drawn fence with gates, a price and a proposal",
  },
};

/** The line over every film. */
export const DEMO_CAPTION = "Real product demo · address to proposal in 40 seconds";

/** The one media query both the poster and the film switch on. */
export const DEMO_DESK_MEDIA = "(min-width: 640px)";
/** Its exact complement, for the phone copy's <source>s. */
export const DEMO_PHONE_MEDIA = "not all and (min-width: 640px)";
