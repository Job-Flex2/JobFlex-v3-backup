// When a plan set gives the heating & cooling load no floor plan, say what the set IS and what to bring instead
// (owner, 2026-10-19: a civil drainage set — cover, TESC plan, drainage plan — was dropped on the HVAC estimator and
// it only said "No floor plan could be read"). A civil set is told apart by its own words before anything is read, so
// it costs no run and no wait. Pure.

import type { SheetKind } from "@/lib/plans/sheet";

/** The words of a civil (site engineering) sheet: erosion control, grading, storm drainage, impervious areas. */
const CIVIL = /\b(TESC|EROSION (AND |& )?SEDIMENT(ATION)? CONTROL|EROSION CONTROL|GRADING PLAN|DRAINAGE PLAN|STORM ?WATER|STORM DRAIN(AGE)?|IMPERVIOUS SURFACES?|CATCH BASIN|INFILTRATION TRENCH|DETENTION (TANK|POND|VAULT)|UTILITY PLAN|CIVIL PLANS?)\b/;

/** A sheet's own name, from its words — civil sheets first, then the kind it was read as. */
const NAMED: [RegExp, string][] = [
  [/\b(COVER|TITLE) SHEET\b/, "cover sheet"],
  [/\bTESC PLAN\b|\bEROSION (AND |& )?SEDIMENT(ATION)? CONTROL PLAN\b|\bEROSION CONTROL PLAN\b/, "erosion-control (TESC) plan"],
  [/\bDRAINAGE PLAN\b/, "drainage plan"],
  [/\bGRADING PLAN\b/, "grading plan"],
  [/\bUTILITY PLAN\b/, "utility plan"],
  [/\bPLAN (AND |& )PROFILE\b|\bROAD(WAY)? PLAN\b/, "road plan"],
];

const KIND_WORD: Record<SheetKind, string> = {
  cover: "cover sheet", site: "site plan", foundation: "foundation plan", floor: "floor plan", roof: "roof plan",
  elevation: "elevations", section: "sections", structural: "structural sheets", electrical: "electrical plan",
  plumbing: "plumbing plan", mechanical: "mechanical plan", schedule: "schedules", detail: "details", other: "other sheets",
};

export type PageSeen = { text: string; title?: string | null; kind: SheetKind | null };

function wordsOf(p: PageSeen): string {
  return `${p.title ?? ""}\n${p.text}`.toUpperCase();
}

/** Every page names itself a civil sheet and none is a floor plan: the set shows the lot, not the house. */
export function isCivilSet(pages: PageSeen[]): boolean {
  return pages.length > 0 && pages.every((p) => p.kind !== "floor" && CIVIL.test(wordsOf(p)));
}

function sheetNames(pages: PageSeen[]): string {
  const names: string[] = [];
  for (const p of pages) {
    const w = wordsOf(p);
    const n = NAMED.find(([re]) => re.test(w))?.[1] ?? (p.kind ? KIND_WORD[p.kind] : null);
    if (n && !names.includes(n)) names.push(n);
  }
  if (!names.length) return "";
  const shown = names.slice(0, 4);
  return names.length > shown.length ? `${shown.join(", ")} and more` : shown.length > 1 ? `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}` : shown[0];
}

const WAY_ON = "Upload those, or go on without plans and type the house's size.";

/** What the contractor reads when no floor plan came off the set. */
export function noFloorPlanText(pages: PageSeen[], civil = isCivilSet(pages)): string {
  const n = pages.length;
  const these = n === 1 ? "This sheet" : `These ${n} sheets`;
  const names = sheetNames(pages);
  if (civil) {
    return `${these} ${n === 1 ? "is" : "are"} a civil set${names ? ` (${names})` : ""} — ${n === 1 ? "it shows" : "they show"} the lot, the grading and the storm drainage, not the house. A heating & cooling load is figured from the architectural plans: the floor plans, with the window schedule and the energy notes when the set has them. ${WAY_ON}`;
  }
  return `No floor plan in ${n === 1 ? "this sheet" : `these ${n} sheets`}${names ? ` (${names})` : ""}. A heating & cooling load is figured from the floor plans, with the window schedule and the energy notes when the set has them. ${WAY_ON}`;
}
