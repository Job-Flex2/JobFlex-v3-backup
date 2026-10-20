// The engine roster the picker draws.
//
// A fixture, not a query, and deliberately so: WHICH estimators exist is a
// product fact, not org data. The queued entries are honest placeholders for
// trades that have no engine yet — they render disabled and unfocusable rather
// than as buttons that lead nowhere.
//
// ORDER IS THE MOCKUP'S. `jobflex-estimator-picker-blueprint (10).html` lists
// its ENGINES as Manual, Smart Proposal, Roof, Fence — catalogue numbers 03,
// 04, 01, 02 — so the block reads Manual/Smart on the top row. Video was added
// after it (2026-08-22), in the position the sidebar gives it. The number
// stays on the record as `no`; only the queued stubs print it, which is also
// what the source does (`<i>05</i>Deck`).

export type EngineDiagram = "roof" | "fence" | "sheet" | "prose" | "video" | "hvac" | "plans" | "deck";

type EngineBase = {
  id: string;
  /** Catalogue number. Printed on the queued stubs only — the source's cards
      carry it in their data and never render it. */
  no: string;
  title: string;
  /** The lowercase method line under the title — how you feed this engine. */
  method: string;
  diagram: EngineDiagram;
  /** Input/output. The source's dead fields, kept because they are real and
      cost nothing. The `time` figure that used to ride beside them was dropped
      from the record when the owner had it taken off the cards (2026-08-22). */
  spec: { input: string; output: string };
};

/** "soon": built, but not sold yet (lib/editions EDITION_OPEN) — a card for whoever
 *  may use it (the edition's buyers; admins preview), "Coming soon" for everyone else. */
export type Engine = EngineBase &
  ({ status: "active"; href: string } | { status: "soon"; href: string } | { status: "queued"; href?: never });

export const ENGINES: Engine[] = [
  {
    id: "manual",
    no: "03",
    title: "Manual",
    method: "line items",
    diagram: "sheet",
    status: "active",
    // The blueprint builder, and it is WIRED as of 2026-08-15: it reads the
    // org's real clients and defaults, honours the `?client=` this dialog
    // appends, and Save / Save & send write through saveProposal /
    // sendProposal. The proposals page's "Manual proposal" button points here
    // too, so both entry points land on the same builder.
    //
    // The older cost-sheet builder is untouched and still reachable directly at
    // /dashboard/estimators/manual.
    href: "/dashboard/manual-blueprint",
    spec: { input: "typed rows", output: "cost sheet" },
  },
  {
    id: "smart",
    no: "04",
    title: "Smart Proposal",
    method: "describe it",
    diagram: "prose",
    status: "active",
    href: "/dashboard/advanced-ai",
    spec: { input: "plain prose", output: "cost sheet" },
  },
  {
    // Added 2026-10-15 (owner: "add the blueprint estimator"). After Smart
    // Proposal, where the sidebar's Estimating tools bay puts it. Catalogue 10
    // for the same reason as Video and HVAC: only the queued stubs print theirs.
    id: "blueprint",
    no: "10",
    title: "Blueprint",
    method: "read the plans",
    diagram: "plans",
    status: "active",
    href: "/dashboard/blueprint-estimator",
    spec: { input: "plan set · spec pages", output: "measures · priced lines" },
  },
  {
    id: "roof",
    no: "01",
    title: "Roof",
    method: "satellite trace",
    diagram: "roof",
    status: "active",
    href: "/dashboard/roof-estimator",
    spec: { input: "aerial imagery", output: "squares · facets" },
  },
  {
    id: "fence",
    no: "02",
    title: "Fence",
    method: "map trace",
    diagram: "fence",
    status: "active",
    href: "/dashboard/fence-estimator",
    spec: { input: "drawn polyline", output: "linear ft · gates" },
  },
  {
    // Added 2026-08-22 with the Video estimator port. It sits after Fence
    // because that is where the sidebar's Estimating tools section puts it.
    //
    // Catalogue number 08, not 05: 05–07 are already spent on the queued stubs,
    // and those are the only entries that PRINT their number. Renumbering three
    // stubs to give this card a lower one would change what is on screen for a
    // figure this card never shows.
    id: "video",
    no: "08",
    title: "Video",
    method: "walk it on video",
    diagram: "video",
    status: "active",
    href: "/dashboard/video-estimator",
    spec: { input: "walkthrough clip", output: "cost sheet" },
  },
  {
    // Added 2026-09-15. Catalogue 09 for the same reason Video is 08: the
    // printed numbers belong to the queued stubs. Sits after Video, where the
    // sidebar's Estimating tools section puts it.
    id: "hvac",
    no: "09",
    title: "HVAC",
    method: "measure the house",
    diagram: "hvac",
    status: "active",
    href: "/dashboard/hvac-estimator",
    spec: { input: "video walk · nameplates", output: "load · unit · cost sheet" },
  },
  {
    // A card since 2026-10-15 (it was a queued stub, then a stub that said
    // "coming soon"). The picker decides per account (view.unlocked): since
    // 2026-10-19 every account whose plan runs has it (lib/editions
    // EDITION_FOR_EVERY_ACCOUNT), so it is live for all of them.
    id: "deck",
    no: "05",
    title: "Deck Studio",
    // Lowercase like every method line (the card sets text-transform), so no "3D" here.
    method: "design it on the house",
    diagram: "deck",
    status: "soon",
    href: "/dashboard/deck-estimator",
    spec: { input: "size · photo · state", output: "3D · permit set · proposal" },
  },
  {
    id: "concrete",
    no: "06",
    title: "Concrete",
    method: "queued",
    diagram: "sheet",
    status: "queued",
    spec: { input: "—", output: "—" },
  },
  {
    id: "paint",
    no: "07",
    title: "Paint",
    method: "queued",
    diagram: "sheet",
    status: "queued",
    spec: { input: "—", output: "—" },
  },
];

export const ACTIVE_COUNT = ENGINES.filter((e) => e.status === "active").length;
export const SOON_COUNT = ENGINES.filter((e) => e.status === "soon").length;
export const QUEUED_COUNT = ENGINES.filter((e) => e.status === "queued").length;

/** Where the live engines go. Exported so the two topbars can ask "can this
 *  role reach ANY of them?" before drawing a New Estimate button that would
 *  only open a dialog whose every card bounces. Kept here rather than restated
 *  at each call site, so adding an engine cannot leave a topbar out of date. */
export const ACTIVE_ENGINE_HREFS: string[] = ENGINES.filter(
  (e): e is Engine & { status: "active"; href: string } => e.status === "active",
).map((e) => e.href);
