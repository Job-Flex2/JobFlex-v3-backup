// THE LANDING'S SECTIONS, in page order (2026-10-02) — shared by the
// landing's section tracker (which fires `landing_section` as each is
// reached) and the admin's analyst (which reads how far visitors get). No
// imports on purpose: the tracker ships in the landing's JavaScript.
//
// Each section is found by the first selector that matches: the block's own
// id, or its content-visibility wrapper (`.lp-cv--…` in landing-e-page.tsx)
// which has a laid-out box even before the block is rendered. `shown` says
// which pages carry it: some sections are trade-specific.
//
// ONE LIST, AND A LANDING MAY ORDER IT ITS OWN WAY (2026-10-04). The list
// below is the page as every landing lays it out unless it is named in
// OWN_ORDER; landing-e-page.tsx renders its blocks in landingSectionOrder(),
// the tracker numbers them by it and the analyst reads such a landing apart,
// in its own order — so the page, the beacon and the reading cannot drift.

export interface LandingSection {
  key: string;
  label: string;
  selector: readonly string[];
  /** "all", or a note on which landings show it (the analyst says "where shown"). */
  shown: "all" | "some";
}

export const LANDING_SECTIONS: readonly LandingSection[] = [
  { key: "hero", label: "Hero", selector: ["#hero"], shown: "all" },
  { key: "compare", label: "JobFlex vs other apps", selector: [".lp-cv--compare", "#compare"], shown: "all" },
  { key: "showcase", label: "Estimators", selector: [".lp-cv--showcase", "#showcase"], shown: "all" },
  { key: "hvac", label: "HVAC service book", selector: [".lp-cv--hvac", "#service"], shown: "some" },
  { key: "montage", label: "Real work photos", selector: [".lp-cv--montage"], shown: "some" },
  { key: "proposals", label: "Proposals", selector: [".lp-cv--proposals", "#proposals"], shown: "all" },
  { key: "portal", label: "Client portal", selector: [".lp-cv--portal", "#portal"], shown: "all" },
  { key: "crew", label: "Crew & cash flow", selector: [".lp-cv--crew", "#crew"], shown: "all" },
  { key: "integrations", label: "Integrations", selector: [".lp-cv--integrations", "#integrations"], shown: "all" },
  { key: "stats", label: "Proof & numbers", selector: [".lp-cv--stats", "#stats"], shown: "all" },
  { key: "built", label: "Everything contractors need", selector: [".lp-cv--built", "#field"], shown: "all" },
  { key: "pricing", label: "Pricing", selector: [".lp-cv--pricing", "#pricing"], shown: "all" },
  { key: "faq", label: "FAQ", selector: [".lp-cv--faq", "#faq"], shown: "all" },
  { key: "final", label: "Final call to action", selector: ["#final"], shown: "all" },
];

export const LANDING_SECTION_KEYS = LANDING_SECTIONS.map((s) => s.key);

/* THE AD LANDINGS' ORDER (owner, 2026-10-04: "take only the roofing
   landing page and do the analyst's fixes"; then the same fixes for the
   HVAC and the fence landings). The analyst's reading of the ad
   visits: 99% reach the hero, 37% the comparison under it, 31% the estimator
   demo after that — "put the estimator demo directly under the hero, it is
   what the ad showed; the comparison after the proof, near the pricing".
   Tried on the roofing ads' landing first; every other landing keeps the
   list above. Keys are the landing's variant key (landing-variants.ts).

   `since` is when the order went live. The page and the tracker lay the
   sections out as they are now; the analyst reads a week of visits, and a
   visit from before `since` saw the usual order — it is read in that one,
   so the first days after the change are not a blend of two pages. */
const OWN_ORDER: Readonly<Record<string, { since: number; order: readonly string[] }>> = {
  roofing: {
    // Pushed 2026-10-04 ~7:45 PM Los Angeles; live a few minutes later.
    since: Date.parse("2026-10-05T03:00:00Z"),
    order: ["hero", "showcase", "hvac", "montage", "proposals", "portal", "crew", "integrations", "stats", "built", "compare", "pricing", "faq", "final"],
  },
  // The same move on HVAC: the estimators, then the HVAC service book, then
  // the rest; the comparison beside the pricing. Pushed 2026-10-04 ~10:35 PM
  // Los Angeles; live a few minutes later.
  hvac: {
    since: Date.parse("2026-10-05T05:45:00Z"),
    order: ["hero", "showcase", "hvac", "montage", "proposals", "portal", "crew", "integrations", "stats", "built", "compare", "pricing", "faq", "final"],
  },
  // And on fencing. Pushed 2026-10-04 ~11:45 PM Los Angeles; live a few
  // minutes later.
  fencing: {
    since: Date.parse("2026-10-05T06:55:00Z"),
    order: ["hero", "showcase", "hvac", "montage", "proposals", "portal", "crew", "integrations", "stats", "built", "compare", "pricing", "faq", "final"],
  },
};

/** The landings laid out in an order of their own. */
export const OWN_ORDER_LANDINGS: readonly string[] = Object.keys(OWN_ORDER);

/** True when this landing (its variant key; "default" or nothing for the
 *  general page) lays the sections out in its own order — now, or, given
 *  `at` (Unix ms, when a visit started), at that moment. */
export function hasOwnSectionOrder(industry: string | null | undefined, at?: number): boolean {
  if (!industry || !Object.prototype.hasOwnProperty.call(OWN_ORDER, industry)) return false;
  return at === undefined || at >= OWN_ORDER[industry].since;
}

/** The section keys in the order this landing shows them. */
export function landingSectionOrder(industry: string | null | undefined): readonly string[] {
  return hasOwnSectionOrder(industry) ? OWN_ORDER[industry as string].order : LANDING_SECTION_KEYS;
}

/** The sections themselves, in this landing's order. */
export function landingSectionsFor(industry: string | null | undefined): readonly LandingSection[] {
  if (!hasOwnSectionOrder(industry)) return LANDING_SECTIONS;
  return landingSectionOrder(industry).map((key) => LANDING_SECTIONS.find((s) => s.key === key)).filter((s): s is LandingSection => !!s);
}

// An own order is the same sections, each once — checked at module load so a
// section added to the list above cannot go missing from a landing unnoticed.
if (process.env.NODE_ENV !== "production") {
  for (const [landing, { order }] of Object.entries(OWN_ORDER)) {
    const missing = LANDING_SECTION_KEYS.filter((k) => !order.includes(k));
    const extra = order.filter((k, i) => !LANDING_SECTION_KEYS.includes(k) || order.indexOf(k) !== i);
    if (missing.length || extra.length) throw new Error(`landing-sections: the ${landing} order is not the list (missing ${missing.join(", ") || "none"}; unknown or repeated ${extra.join(", ") || "none"})`);
    if (order[0] !== "hero" || order[order.length - 1] !== "final") throw new Error(`landing-sections: the ${landing} order must start at the hero and end at the final call to action`);
  }
}
