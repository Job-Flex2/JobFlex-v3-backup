// THE SHEET SIZES AND THE SCALES THE DEPARTMENT ASKS FOR (2026-10-28, owner: "make an option that the contractor can
// scale the plans and permits the way it's required") — pure.
//
// The permit set was drawn on 11 × 17 (ANSI B) only. A department names the smallest scale it reads — the City of
// Sacramento: plans at 1/4 in. = 1 ft, the site plan at 1/8 in. = 1 ft — and a big lot or a long deck cannot keep
// that on 11 × 17. So the set can go on 18 × 24 (ARCH C) or 24 × 36 (ARCH D): the title block keeps its width, the
// drawing area grows, and every view is fitted again at the largest architect's scale the bigger frame holds.
// "Auto" picks the smallest sheet that keeps both minimums; a chosen sheet that cannot is said, not hidden.
import { fitView, ARCH_SCALES, type ArchScale, type View } from "./draft";
import { siteScaleWords } from "../countyCodes";

export type PaperKey = "B" | "C" | "D";
export interface Paper {
  key: PaperKey;
  /** "11 × 17". */
  name: string;
  standard: string;
  /** Landscape, inches. */
  w: number;
  h: number;
  /** How much wider and taller the drawing area is than the 11 × 17 sheet's — the fit boxes scale by it. */
  kx: number;
  ky: number;
}
/** The title block column and the frame's insets (plan-set.module.css): fixed on every size. */
const TITLE_BLOCK_IN = 2.6;
const SIDES_IN = 0.75;
const TOP_BOTTOM_IN = 0.5;
const DRAW_W_B = 17 - SIDES_IN - TITLE_BLOCK_IN;
const DRAW_H_B = 11 - TOP_BOTTOM_IN;
const paper = (key: PaperKey, name: string, standard: string, w: number, h: number): Paper => ({ key, name, standard, w, h, kx: (w - SIDES_IN - TITLE_BLOCK_IN) / DRAW_W_B, ky: (h - TOP_BOTTOM_IN) / DRAW_H_B });
export const PAPERS: Record<PaperKey, Paper> = {
  B: paper("B", "11 × 17", "ANSI B", 17, 11),
  C: paper("C", "18 × 24", "ARCH C", 24, 18),
  D: paper("D", "24 × 36", "ARCH D", 36, 24),
};
export const PAPER_ORDER: readonly PaperKey[] = ["B", "C", "D"];
export type PaperChoice = "auto" | PaperKey;

/** The smallest plan scale a department reads, inches per foot; 1/4 in. = 1 ft is the common rule. */
export const PLAN_SCALE_MINS: ReadonlyArray<{ inPerFt: number; label: string }> = [
  { inPerFt: 0.25, label: '1/4" = 1\'-0"' },
  { inPerFt: 0.1875, label: '3/16" = 1\'-0"' },
  { inPerFt: 0.125, label: '1/8" = 1\'-0"' },
];
/** The smallest site-plan scale, feet per inch: the architect's 1/8 in., or an engineer's 1 in. = 10, 20, 30, 40 ft. */
export const SITE_SCALE_MINS: readonly number[] = [8, 10, 20, 30, 40];

export interface SheetPrefs {
  paper: PaperChoice;
  minPlanInPerFt: number;
  minSiteFtPerIn: number;
}
export const DEFAULT_SHEET_PREFS: SheetPrefs = { paper: "auto", minPlanInPerFt: 0.25, minSiteFtPerIn: 20 };

export function normalizeSheetPrefs(raw: unknown): SheetPrefs {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const paperChoice: PaperChoice = r.paper === "B" || r.paper === "C" || r.paper === "D" ? r.paper : "auto";
  const plan = PLAN_SCALE_MINS.find((x) => typeof r.minPlanInPerFt === "number" && Math.abs(x.inPerFt - (r.minPlanInPerFt as number)) < 1e-6)?.inPerFt ?? DEFAULT_SHEET_PREFS.minPlanInPerFt;
  const site = SITE_SCALE_MINS.find((x) => x === r.minSiteFtPerIn) ?? DEFAULT_SHEET_PREFS.minSiteFtPerIn;
  return { paper: paperChoice, minPlanInPerFt: plan, minSiteFtPerIn: site };
}

/** A view fitted into a box drawn for 11 × 17, on this sheet: the box grows with the drawing area. */
export function fitOn(p: Paper, build: (s: ArchScale) => View, w: number, h: number, max?: number): View {
  return fitView(build, w * p.kx, h * p.ky, max);
}

/** The site plan's frame on A-101: about 8.6 × 9.2 in. on 11 × 17, less the street band and the north arrow, which keep their size. */
const SITE_FRAME_B = { w: 8.6, h: 9.2 };
const SITE_BANDS = { w: 1.25, h: 1.75 };
export function siteBoxOn(p: Paper): { w: number; h: number } {
  return { w: SITE_FRAME_B.w * p.kx - SITE_BANDS.w, h: SITE_FRAME_B.h * p.ky - SITE_BANDS.h };
}

/** The architect's label for a view's scale (paper inches per model inch). */
export function archLabel(k: number): string {
  return ARCH_SCALES.find((s) => Math.abs(s.k - k) < 1e-9)?.label ?? `${(k * 12).toFixed(3).replace(/0+$/, "")}" = 1'-0"`;
}
export const planScaleLabel = (inPerFt: number): string => PLAN_SCALE_MINS.find((x) => Math.abs(x.inPerFt - inPerFt) < 1e-6)?.label ?? `${inPerFt}" = 1'-0"`;

export interface PaperPick {
  paper: Paper;
  /** The framing plan's scale on it, inches per foot, and the site plan's, feet per inch. */
  planInPerFt: number;
  siteFtPerIn: number;
  /** Both minimums kept. */
  met: boolean;
  words: string;
}

/**
 * The sheet for this set: the chosen one, or — on "auto" — the smallest that holds the framing plan at the plan
 * minimum and the lot at the site minimum. `fits` draws both on a sheet and says what scales they got.
 */
export function pickPaper(prefs: SheetPrefs, fits: (p: Paper) => { planK: number; siteFtPerIn: number }): PaperPick {
  const keys = prefs.paper === "auto" ? PAPER_ORDER : [prefs.paper];
  let last: { p: Paper; f: { planK: number; siteFtPerIn: number } } | null = null;
  const kept = (f: { planK: number; siteFtPerIn: number }) => f.planK * 12 + 1e-9 >= prefs.minPlanInPerFt && f.siteFtPerIn <= prefs.minSiteFtPerIn;
  for (const k of keys) {
    const p = PAPERS[k];
    const f = fits(p);
    last = { p, f };
    if (kept(f)) return pick(p, f, true, prefs);
  }
  return pick((last as { p: Paper }).p, (last as { f: { planK: number; siteFtPerIn: number } }).f, false, prefs);
}
function pick(p: Paper, f: { planK: number; siteFtPerIn: number }, met: boolean, prefs: SheetPrefs): PaperPick {
  const planInPerFt = Math.round(f.planK * 12 * 10000) / 10000;
  const base = `${p.name} (${p.standard}): the framing plan at ${archLabel(f.planK)}, the site plan at ${siteScaleWords(f.siteFtPerIn)}`;
  const words = met
    ? base
    : `${base} — under the ${planScaleLabel(prefs.minPlanInPerFt)} / ${siteScaleWords(prefs.minSiteFtPerIn)} asked for${prefs.paper === "auto" ? ", even on 24 × 36" : `; pick a larger sheet or "Auto"`}.`;
  return { paper: p, planInPerFt, siteFtPerIn: f.siteFtPerIn, met, words };
}
