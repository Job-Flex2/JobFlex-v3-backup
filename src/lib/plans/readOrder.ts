// In what order a plan set is read, how closely, and what a job waits for. Pure.
//
// Reading every sheet of a set at full detail takes minutes (owner, 2026-10-13: "is it
// normal that it takes so long?"). Most of that is spent on sheets most jobs never use —
// seven structural sheets on a two-story house — and every job used to wait for all of
// them. Now:
//   · a first look (the title block, the sheet small) says what each sheet is, in seconds
//   · the sheets most jobs rest on are read first and closest — floor plans, schedules,
//     the cover's area summary, the site plan; elevations, sections and structural notes
//     after them, with four close-ups instead of twelve; details not at all
//   · a job waits only for the kinds of sheet its lines rest on: countertops for the floor
//     plans, a roof for the roof plan and the elevations, the whole house for everything
import { levelName, SHEET_KINDS, type SheetKind } from "./sheet";
import type { PlanTrade } from "./takeoff";

/** First → last. A kind not listed reads last. */
const ORDER: SheetKind[] = ["floor", "schedule", "cover", "site", "foundation", "roof", "elevation", "section", "electrical", "plumbing", "mechanical", "structural", "other"];

export function readRank(kind: SheetKind | null | undefined): number {
  const i = kind ? ORDER.indexOf(kind) : -1;
  return i < 0 ? ORDER.length : i;
}

/** Sheets with nothing small to measure: read with the overview and four close-ups. */
const LIGHT = new Set<SheetKind>(["elevation", "section", "structural", "other"]);
export const readsLight = (kind: SheetKind | null | undefined): boolean => !!kind && LIGHT.has(kind);

/**
 * Details and general notes are not read in the background: the first look indexes what is
 * on them, and a job that needs one looks at it closely then (lib/plans/ask specPages).
 */
export const readsAtAll = (kind: SheetKind | null | undefined): boolean => kind !== "detail";

/** What every job rests on: the rooms, the areas and plate heights, the openings and fixtures. */
export const BASE_KINDS: SheetKind[] = ["floor", "cover", "schedule"];

/** The kinds of sheet a trade's quantities rest on beyond the base. */
const TRADE_KINDS: Record<PlanTrade, SheetKind[]> = {
  general: [],
  sitework: ["site", "foundation"],
  foundation: ["foundation", "site"],
  framing: ["roof", "elevation", "section", "structural", "foundation"],
  roofing: ["roof", "elevation"],
  gutters: ["roof", "elevation"],
  "windows-doors": ["elevation"],
  siding: ["elevation", "roof"],
  insulation: ["section", "roof", "foundation"],
  drywall: ["section"],
  "interior-trim": [],
  flooring: [],
  tile: [],
  cabinets: [],
  painting: ["section", "elevation"],
  plumbing: ["plumbing"],
  electrical: ["electrical"],
  hvac: ["mechanical", "section"],
};

/** The kinds of sheet a job made of these trades waits for. */
export function kindsFor(trades: Iterable<PlanTrade>): Set<SheetKind> {
  const out = new Set<SheetKind>(BASE_KINDS);
  for (const t of trades) for (const k of TRADE_KINDS[t] ?? []) out.add(k);
  return out;
}

// ── the first look ──────────────────────────────────────────────────────────

export const SKIM_SYSTEM =
  "You index the sheets of a construction plan set. From a quick look at a sheet you say what kind of sheet it is and list everything on it, so the sheets a job needs can be found later. You answer with JSON only.";

export function skimPrompt(page: number, pages: number, images: number): string {
  return [
    `Sheet ${page} of ${pages}. The first picture is the whole sheet, small${images > 1 ? "; the next four are its quarters — top left, top right, bottom left, bottom right" : ""}.`,
    "1. kind — by the sheet's own title first (\"MAIN FLOOR PLAN\", \"FOUNDATION PLAN\", \"S2.1 FRAMING\"), else by what it draws: floor (a floor plan with rooms — not a framing plan), foundation, roof (roof plan or roof framing), elevation (exterior elevations), section, site, cover (cover or title sheet, area summary), schedule (window, door, fixture, finish or energy schedules), structural (framing plans, shear walls, structural notes), electrical, plumbing, mechanical, detail (details, interior elevations, general notes, specifications), other.",
    "2. contents — every drawing, schedule and block of notes on the sheet, one short line each, by its own title where it has one (\"KITCHEN INTERIOR ELEVATIONS\", \"COUNTERTOP EDGE DETAIL\", \"DOOR SCHEDULE\", \"GENERAL NOTES\"). A note that specifies a material, finish or method a trade would price is a line of its own, quoted short (\"note: countertops 3cm quartz, eased edge\", \"note: 5/8 type X at the garage\"). Up to 16 lines.",
    'Answer: {"kind": "", "title": "the sheet title as written, or null", "level": "Main|Upper|Basement|Third or null (a floor plan\'s floor)", "contents": [""]}',
  ].join("\n");
}

export type SheetSkim = {
  kind: SheetKind;
  title: string | null;
  level: string | null;
  /** What is on the sheet — its drawings, schedules and the notes that specify a trade's work. */
  contents: string[];
};

/** The first look's answer, checked: an unknown kind is "other", a floor plan's floor is named. */
export function cleanSkim(raw: unknown): SheetSkim {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const kind = (SHEET_KINDS as readonly string[]).includes(String(o.kind)) ? (o.kind as SheetKind) : "other";
  const title = typeof o.title === "string" && o.title.trim() ? o.title.trim().slice(0, 120) : null;
  const level = kind === "floor" ? levelName(typeof o.level === "string" ? o.level : null) ?? levelName(title) : null;
  const contents = (Array.isArray(o.contents) ? o.contents : [])
    .map((x) => (typeof x === "string" ? x.replace(/\s+/g, " ").trim().slice(0, 120) : ""))
    .filter(Boolean)
    .slice(0, 16);
  return { kind, title, level, contents };
}
