// Slope rules for fence runs — ported 2026-09-18 from FenceScan
// (lib/fence/slope.ts) and joined to JobFlex's own terrain report
// (components/estimator/fence/fenceTerrain.ts), which already classifies
// every traced segment as level / racked / stepped from the Elevation
// profile. This module turns that report into what the takeoff and the
// pricing need: how many code-sized steps the crew builds, how much extra
// fabric racked bays take, the post lengths, and the ground difficulty.
//
// Field rules encoded here:
//  - Panels / pickets can RACK (follow the grade) up to ~1' of rise per 8'
//    section for stick-built wood, ~6" for prefab panels, ~18" for chain
//    link; steeper than that the section must STEP — the panel stays level
//    and the next one drops, which needs a LONGER post at every step.
//  - A single step is capped at 1': codes measure fence height from the
//    grade directly below, and one big step would push the face over the
//    permitted height at the downhill post.
//  - Post length = fence height + burial (a third of the height, never
//    less than 2', never above the local frost line) + the step drop.
//  - Terrain difficulty (labor multiplier) follows the average absolute
//    grade: <5% flat · 5–12% sloped · 12–20% steep · >20% rocky-grade dig.

import type { Terrain } from "./catalog";

/** One-section rise (ft) that reads as a sheer drop — a retaining wall or
 *  cut bank, not walkable grade. */
export const WALL_RISE_FT = 2.5;

/** Max drop a SINGLE step may take (ft). */
export const MAX_STEP_DROP_FT = 1.0;

/** How much rise one section can absorb by racking, by build kind. */
export function rackingLimitFt(build: "stick" | "panel" | "mesh" | "rail"): number {
  if (build === "panel") return 0.5; // prefab panels barely rack
  if (build === "mesh") return 1.5; // chain link follows grade well
  return 1.0; // stick-built & rail
}

/**
 * Burial depth: a third of the height, never less than 2' — and never
 * above the local frost line. A post footed above frost heaves out of
 * plumb by the second spring, so in Minneapolis (48" frost) a 6' fence
 * digs 4' holes where Dallas digs 2'. `frostIn` comes from the job's
 * market; 0 means height only.
 */
export function burialFt(heightFt: number, frostIn = 0): number {
  return Math.max(2, heightFt / 3, frostIn / 12);
}

/** Posts come in even-foot lengths — round up. */
export function roundPostFt(ft: number): number {
  return Math.ceil(ft / 2) * 2;
}

/** Suggested labor terrain from the measured grade. */
export function terrainFromGrade(avgGradePct: number, maxGradePct: number): Terrain {
  if (avgGradePct < 5 && maxGradePct < 10) return "flat";
  if (avgGradePct < 12) return "sloped";
  if (avgGradePct <= 20) return "steep";
  return "rocky";
}

/** One traced segment as JobFlex's terrain report describes it. */
export interface SlopeSegment {
  /** Plan (map) length, ft. */
  planFt: number;
  /** Length along the ground, ft. */
  gradeFt: number;
  /** End-to-end rise, ft (signed). */
  riseFt: number;
  /** Slope angle from the plan, degrees. */
  thetaDeg: number;
  cls: "level" | "racked" | "stepped";
  /** Steps the report already sized for a stepped segment (one per bay). */
  steps?: number;
  /** Drop per step, ft. */
  stepDropFt?: number;
  /** The steps were planned on the ground (stepStations): the count stands as is. */
  planned?: boolean;
}

export interface SlopeSummary {
  /** Code-sized steps the crew builds across the whole fence. */
  steppedSections: number;
  /** Segments whose rise reads as a wall or cut bank — a "mounting on a
   *  wall?" question for the contractor, never auto-priced. */
  wallSegments: number;
  /** LF of fence over those drops. */
  wallLikeLf: number;
  /** Largest per-step drop after splitting, ft. */
  maxStepFt: number;
  /** Extra FABRIC on racked bays, ft — a bay that follows the grade is the
   *  hypotenuse, not its map length. Stepped bays add nothing (level panels). */
  rackedExtraLf: number;
  avgGradePct: number;
  maxGradePct: number;
  suggestedTerrain: Terrain;
  /** Standard post length for this fence, ft (height + burial). */
  basePostLengthFt: number;
  /** Post length at stepped sections, ft. */
  stepPostLengthFt: number;
  burialFt: number;
}

/** The shortest bay a step may make (ft): a sheer drop (a retaining wall, a cut bank) is not stepped in posts inches
 *  apart — what a 2 ft bay can't take is the wall-like drop the contractor is asked about. */
export const MIN_STEP_BAY_FT = 2;

/**
 * THE STEP PLAN (2026-10-18 — owner: "fence the slope down without [the panels] falling like this: small steps, or an
 * angle"). A stepped run is a level panel per bay, its base on the HIGH ground under it, and a step at each post. A bay
 * is used up by its length (at most the post spacing) and by how much the ground under it CHANGES (at most one code
 * step) — every bump and dip counted, not only the net drop between the segment's ends: rolling ground sized by its
 * net rise stood panels feet above the dips. Posts go where the ground spends that allowance — close together down
 * the steep part, a full bay apart on the flat — so no panel hangs more than one step over the ground and none buries.
 *
 * `z` is the ground every `dsFt` along the segment (the profile, or the 3D's lidar). `count`: draw exactly the ticket's
 * steps (the 3D, so what stands is what was charged — spread where ITS ground drops). Returns the stations, 0 … length.
 */
export function stepStations(z: readonly number[], dsFt: number, spacingFt: number, opts: { count?: number | null; maxStepFt?: number } = {}): number[] {
  const n0 = z.length;
  if (n0 < 2 || !(dsFt > 0)) return [0, Math.max(0, dsFt * (n0 - 1))];
  const maxStep = opts.maxStepFt ?? MAX_STEP_DROP_FT;
  const len = dsFt * (n0 - 1);
  const spacing = Math.max(1, spacingFt);
  // A bay ends at whichever comes first — a step's worth of ground change, or the post spacing: each foot of fence
  // spends the larger of the two — but never more than a bay of MIN_STEP_BAY_FT would (steeper ground is stepped every
  // 2 ft; its extra fall is the wall-like drop the contractor is asked about).
  const m = [0];
  for (let k = 1; k < n0; k++) m.push(m[k - 1] + Math.min(Math.max(Math.abs(z[k] - z[k - 1]) / maxStep, dsFt / spacing), dsFt / MIN_STEP_BAY_FT));
  const M = m[n0 - 1];
  let n = opts.count && opts.count >= 1 ? Math.round(opts.count) : Math.max(1, Math.ceil(M - 1e-6), Math.ceil(len / spacing - 1e-6));
  // Never planned shorter than MIN_STEP_BAY_FT: steeper than a step every 2 ft is a wall-like drop, asked about.
  n = Math.min(n, Math.max(1, Math.floor(len / MIN_STEP_BAY_FT + 1e-6)));
  const at = (target: number) => {
    let j = 1;
    while (j < n0 - 1 && m[j] < target) j++;
    const span = m[j] - m[j - 1];
    return dsFt * (j - 1 + (span > 0 ? Math.min(1, Math.max(0, (target - m[j - 1]) / span)) : 0));
  };
  const out = [0];
  for (let k = 1; k < n; k++) {
    const s = at((M * k) / n);
    // A cliff packs the measure into a foot: no bay shorter than MIN_STEP_BAY_FT there either.
    // (A hair of tolerance: bays spread evenly at exactly the shortest length must all stand.)
    if (s - out[out.length - 1] >= MIN_STEP_BAY_FT - 0.05 && len - s >= MIN_STEP_BAY_FT - 0.05) out.push(s);
  }
  out.push(len);
  return out;
}

/** Steps (level panels) a stepped segment needs on this ground — the count the takeoff charges. */
export const stepCountOn = (z: readonly number[], dsFt: number, spacingFt: number) => stepStations(z, dsFt, spacingFt).length - 1;

/** A level panel's base over one bay: the highest ground under it (sampled every `dsFt`). */
export function panelBase(z: readonly number[], dsFt: number, s0: number, s1: number): number {
  if (!z.length) return 0;
  const zAt = (s: number) => {
    const f = Math.max(0, Math.min(z.length - 1, s / dsFt));
    const i = Math.floor(f);
    const t = f - i;
    return i + 1 < z.length ? z[i] + (z[i + 1] - z[i]) * t : z[i];
  };
  let hi = Math.max(zAt(s0), zAt(s1));
  for (let k = Math.ceil(s0 / dsFt); k * dsFt < s1; k++) if (k >= 0 && k < z.length) hi = Math.max(hi, z[k]);
  return hi;
}

/**
 * The steps ONE stepped segment is built and priced with: its bays, each
 * re-split so no step drops more than MAX_STEP_DROP_FT. The ticket, the
 * map's badge and the 3D all read this, so the three show one count (the
 * 3D used to split by the ground under each bay: 29 drawn, 31 priced).
 */
export function segmentSteps(s: Pick<SlopeSegment, "planFt" | "riseFt" | "cls" | "steps" | "stepDropFt" | "planned">, sectionLenFt: number): { steps: number; dropFt: number } {
  if (s.cls !== "stepped" || !(s.planFt > 0)) return { steps: 0, dropFt: 0 };
  // The terrain report planned them on the ground itself (stepStations, with its drop per step): that IS the count.
  // (A count of one step a bay — an older report, or one typed — is still split below.)
  if (s.planned && s.steps) return { steps: s.steps, dropFt: s.stepDropFt ?? Math.abs(s.riseFt) / s.steps };
  const bays = Math.max(1, s.steps ?? Math.ceil(s.planFt / Math.max(1, sectionLenFt)));
  // Every bay drops rise/bays; a bay dropping more than a code step
  // splits into shorter panels with extra posts.
  const perBay = Math.abs(s.riseFt) / bays;
  const splits = Math.max(1, Math.ceil(perBay / MAX_STEP_DROP_FT));
  return { steps: bays * splits, dropFt: perBay / splits };
}

/**
 * Summarize JobFlex's per-segment terrain for the takeoff. Steps: the
 * report's own count on stepped segments, re-split so no step drops more
 * than MAX_STEP_DROP_FT (a 3' drop over one 8' bay is three 1' steps with
 * two extra posts, not one 3' cliff). Segments a fence could rack are the
 * report's "racked" class; their extra fabric is gradeFt − planFt.
 */
export function summarizeSlope(
  segs: readonly SlopeSegment[],
  heightFt: number,
  sectionLenFt: number,
  frostIn = 0,
): SlopeSummary {
  let steps = 0;
  let wallSegments = 0;
  let wallLikeLf = 0;
  let maxStep = 0;
  let rackedExtra = 0;
  let gradeWeighted = 0;
  let planTotal = 0;
  let maxGrade = 0;
  for (const s of segs) {
    if (!(s.planFt > 0)) continue;
    const gradePct = Math.tan((s.thetaDeg * Math.PI) / 180) * 100;
    gradeWeighted += gradePct * s.planFt;
    planTotal += s.planFt;
    maxGrade = Math.max(maxGrade, gradePct);
    if (s.cls === "racked") {
      rackedExtra += Math.max(0, s.gradeFt - s.planFt);
    } else if (s.cls === "stepped") {
      // A wall-like drop is judged over the type's own bays — never over the many short ones a step plan makes.
      const bays = Math.max(1, Math.ceil(s.planFt / Math.max(1, sectionLenFt)));
      const perBay = Math.abs(s.riseFt) / bays;
      const seg = segmentSteps(s, sectionLenFt);
      steps += seg.steps;
      maxStep = Math.max(maxStep, seg.dropFt);
      // A wall-like drop: more than WALL_RISE_FT in a single bay.
      if (perBay >= WALL_RISE_FT) {
        wallSegments += 1;
        wallLikeLf += s.planFt;
      }
    }
  }
  const avg = planTotal > 0 ? gradeWeighted / planTotal : 0;
  const burial = burialFt(heightFt, frostIn);
  const base = heightFt + burial;
  return {
    steppedSections: steps,
    wallSegments,
    wallLikeLf: round1(wallLikeLf),
    maxStepFt: round2(maxStep),
    rackedExtraLf: round1(rackedExtra),
    avgGradePct: round1(avg),
    maxGradePct: round1(maxGrade),
    suggestedTerrain: terrainFromGrade(avg, maxGrade),
    basePostLengthFt: roundPostFt(base),
    stepPostLengthFt: roundPostFt(base + Math.min(2, maxStep)),
    burialFt: round2(burial),
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
