// THE WALL'S STEPS FROM THE PHOTO'S OWN PIXELS (2026-10-23 night). Pure. Owner, with the live read beside the house
// he expects: "still wrong — should be like on the second pic". The vision model, asked where the wall steps, found
// one corner of the bump-out and read it the wrong way round (the porch roof's side as the part standing out). The
// picture itself says both things plainly:
//   · WHERE the wall steps — a corner board runs the whole height of the wall, up BOTH storeys without a break; a
//     window's frame stands up only within its own storey, a porch post only below the porch roof;
//   · WHICH WAY — a part of the wall nearer the camera shows its eave higher in the picture (it is closer; the same
//     height looks taller) — a few per cent of the wall's height for a 2-ft bump-out seen across a yard. A porch roof
//     in front of a part does not move that part's eave.
// So: the corners where an edge runs up both storeys, then each part's eave — the run of soffit, fascia and gutter
// above it — matched against the main wall's (the widest part's) and said to stand out, back, or level. Nothing is
// said where the photo doesn't show it plainly (no corner, no eave to match): the model's read stands.
//
// On the grey picture the browser makes of the photo (lib/deck/photoSnap's Gray), in the read's own fractions.

import type { WallJog } from "./photoFit";
import type { HouseRead } from "./houseRead";
import { gradients, type Gray } from "./photoSnap";

export type PartState = "out" | "back" | "level" | "unknown";

export interface WallStepsFound {
  /** The wall's steps as the pixels say them — in the read's terms (x, y on the base, "toward" when the part to the
   *  right is nearer the camera). */
  jogs: WallJog[];
  /** The corners found (fractions across the picture) and each part between them. */
  corners: number[];
  /** Each part: out, back or level against the main wall, by how far its eave's shadow band sits above (−) or below
   *  the main wall's, px; `corr` how plainly that band shows (0…1). */
  parts: Array<{ x0: number; x1: number; state: PartState; shiftPx: number; corr: number }>;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const lineY = (l: { left: { x: number; y: number }; right: { x: number; y: number } }, x: number) => l.left.y + ((l.right.y - l.left.y) * (x - l.left.x)) / Math.max(1e-6, l.right.x - l.left.x);

/** The corners of the wall: columns where an edge stands up through every storey of it. Fractions across the
 *  picture, left to right. */
export function wallCorners(read: HouseRead, g: Gray, gx?: Float32Array): number[] {
  if (!read.eave) return [];
  const { w, h } = g;
  const G = gx ?? gradients(g).gx;
  const xL = Math.round(Math.min(read.base.left.x, read.base.right.x) * w);
  const xR = Math.round(Math.max(read.base.left.x, read.base.right.x) * w);
  if (xR - xL < 40) return [];
  const eaveAt = (px: number) => lineY(read.eave!, px / w) * h;
  const baseAt = (px: number) => lineY(read.base, px / w) * h;
  const H = baseAt((xL + xR) / 2) - eaveAt((xL + xR) / 2);
  if (H < 40) return [];
  // What counts as an edge: well above the wall's own texture (lap siding stands in lines across, not up).
  const sample: number[] = [];
  for (let y = Math.round(eaveAt((xL + xR) / 2) + H * 0.1); y < baseAt((xL + xR) / 2) - H * 0.1; y += 3) for (let x = xL; x < xR; x += 3) sample.push(G[y * w + x]);
  sample.sort((a, b) => a - b);
  const T = clamp(3 * (sample[Math.floor(sample.length / 2)] ?? 0.02), 0.04, 0.12);
  const bands = read.storeys === 2 ? [[0.06, 0.46], [0.54, 0.94]] : [[0.08, 0.92]];
  const scoreAt = (x: number) => {
    let worst = 1;
    for (const [a, b] of bands) {
      const top = eaveAt(x) + H * a;
      const bot = eaveAt(x) + H * b;
      let on = 0;
      let n = 0;
      for (let y = Math.round(top); y < bot; y++) {
        const i = y * w + x;
        n++;
        if (Math.max(G[i - 1], G[i], G[i + 1]) > T) on++;
      }
      worst = Math.min(worst, n ? on / n : 0);
    }
    return worst;
  };
  const span = xR - xL;
  const margin = Math.max(4, Math.round(span * 0.04));
  const scores: number[] = [];
  for (let x = xL + margin; x <= xR - margin; x++) scores.push(scoreAt(x));
  const picks: Array<{ x: number; s: number }> = [];
  scores.forEach((s, i) => {
    if (s < 0.72) return;
    const x = xL + margin + i;
    const near = picks.find((p) => Math.abs(p.x - x) < span * 0.04);
    if (!near) picks.push({ x, s });
    else if (s > near.s) Object.assign(near, { x, s });
  });
  return picks
    .sort((a, b) => b.s - a.s)
    .slice(0, 4)
    .map((p) => r3(p.x / w))
    .sort((a, b) => a - b);
}

/** A part's eave: the picture's brightness in rows around the eave line (±`reach` px), averaged across the part's
 *  columns clear of any window just under the eave (index 0 = `reach` px above the line). Each column is read along
 *  the eave line's own slope, so a tilted photo isn't read as a step. */
function eaveProfile(read: HouseRead, g: Gray, x0: number, x1: number, reach: number): number[] | null {
  const { w, h, data } = g;
  const a = Math.round(x0 * w);
  const b = Math.round(x1 * w);
  const cols: number[] = [];
  for (let x = a; x < b; x++) {
    const fx = x / w;
    const yE = lineY(read.eave!, fx);
    // A window whose head is near the eave would put its own frame into the profile: its columns are left out.
    if (read.windows.some((win) => fx >= win.x0 - 0.004 && fx <= win.x1 + 0.004 && (win.head - yE) * h < reach)) continue;
    cols.push(x);
  }
  if (cols.length < 3) return null;
  const rows: number[] = [];
  for (let k = -reach; k <= reach; k++) {
    let s = 0;
    let n = 0;
    for (const x of cols) {
      const y = Math.round(lineY(read.eave!, x / w) * h) + k;
      if (y < 0 || y >= h) continue;
      s += data[y * w + x];
      n++;
    }
    if (!n) return null;
    rows.push(s / n);
  }
  // Smoothed over a few rows: one dark line of a gutter's lip is not the band.
  return rows.map((_, i) => {
    let s = 0;
    let n = 0;
    for (let k = -2; k <= 2; k++) if (rows[i + k] !== undefined) [s, n] = [s + rows[i + k], n + 1];
    return s / n;
  });
}

/** The eave's shadow band in a profile: its darkest row, and how plainly it shows (how much darker than the
 *  profile's middle brightness, 0…1). */
function shadowBand(p: number[]): { at: number; depth: number } {
  let i0 = 0;
  for (let i = 1; i < p.length; i++) if (p[i] < p[i0]) i0 = i;
  // To a fraction of a row: the low point of the parabola through the darkest row and its neighbours.
  let at = i0;
  if (i0 > 0 && i0 < p.length - 1) {
    const den = p[i0 - 1] - 2 * p[i0] + p[i0 + 1];
    if (den > 1e-9) at = i0 + clamp((p[i0 - 1] - p[i0 + 1]) / (2 * den), -0.5, 0.5);
  }
  const sorted = [...p].sort((a, b) => a - b);
  const mid = sorted[Math.floor(sorted.length / 2)];
  return { at, depth: mid > 0 ? (mid - p[i0]) / mid : 0 };
}

/**
 * The wall's steps from the photo: its corners, and each part out, back or level against the main wall. Null when the
 * photo doesn't say — no eave, no corner, or no part decided (the model's read stands then).
 */
export function wallSteps(read: HouseRead, g: Gray, opts: { depthFt?: number | null } = {}): WallStepsFound | null {
  if (!read.eave) return null;
  const { gx } = gradients(g);
  const corners = wallCorners(read, g, gx);
  if (!corners.length) return null;
  const xL = Math.min(read.base.left.x, read.base.right.x);
  const xR = Math.max(read.base.left.x, read.base.right.x);
  const H = (lineY(read.base, (xL + xR) / 2) - lineY(read.eave, (xL + xR) / 2)) * g.h;
  // Wide enough to find the eave wherever the read put its line (a model's line can be a few per cent off).
  const reach = Math.max(10, Math.round(H * 0.14));
  const xs = [xL, ...corners, xR];
  const parts = xs.slice(0, -1).map((x0, i) => {
    const x1 = xs[i + 1];
    // Clear of the corner boards themselves, but no more: between a row of upper windows the gaps are narrow.
    const pad = Math.max(3 / g.w, (x1 - x0) * 0.04);
    const prof = x1 - x0 > (xR - xL) * 0.05 ? eaveProfile(read, g, x0 + pad, x1 - pad, reach) : null;
    const band = prof ? shadowBand(prof) : null;
    // An eave that shows: its shadow band plainly darker than the wall and sky around it, not at the window's edge.
    const plain = !!band && band.depth >= 0.3 && band.at > 2 && band.at < (prof?.length ?? 0) - 3;
    return { x0, x1, band: plain ? band : null };
  });
  // Each corner by the two parts either side of it: the one whose eave's shadow sits higher in the picture is nearer
  // the camera. A corner with an eave that doesn't show on either side says nothing.
  const thr = Math.max(2.5, H * 0.02);
  const jogs: WallJog[] = [];
  const plane: Array<number | null> = parts.map(() => null);
  const firstShown = parts.findIndex((p) => p.band);
  if (firstShown < 0) return null;
  plane[firstShown] = 0;
  corners.forEach((x, k) => {
    const a = parts[k].band;
    const b = parts[k + 1].band;
    if (!a || !b) return;
    const d = b.at - a.at;
    if (Math.abs(d) < thr) {
      if (plane[k] !== null) plane[k + 1] = plane[k];
      return;
    }
    if (plane[k] !== null) plane[k + 1] = (plane[k] as number) + (d < 0 ? 1 : -1);
    // How far it steps the photo doesn't say (a few per cent of the eave's height is the camera's distance as much
    // as the step's): one depth for every step — the model's where it gave one, else none (the house takes its usual
    // 2 ft and says it's a guess) — so a bump-out's two sides come out the same.
    jogs.push({ x, y: r3(lineY(read.base, x)), dir: d < 0 ? "toward" : "away", depthFt: opts.depthFt ?? null });
  });
  if (!jogs.length) return null;
  // Each part against the main wall (the widest whose plane is known), for the review's words and the QA.
  const known = parts.map((p, i) => ({ i, w: p.x1 - p.x0 })).filter(({ i }) => plane[i] !== null);
  const main = known.reduce((m, k) => (k.w > m.w ? k : m), known[0]);
  const ref = parts[main.i].band!.at;
  const out = parts.map((p, i) => {
    const pl = plane[i];
    const state: PartState = pl === null || !p.band ? "unknown" : pl > (plane[main.i] as number) ? "out" : pl < (plane[main.i] as number) ? "back" : "level";
    return { x0: p.x0, x1: p.x1, state, shiftPx: p.band ? Math.round((p.band.at - ref) * 10) / 10 : 0, corr: p.band ? Math.round(p.band.depth * 100) / 100 : 0 };
  });
  return { jogs, corners, parts: out };
}
