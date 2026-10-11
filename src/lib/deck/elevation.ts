// THE DECK SEEN FROM THE YARD (M2, 2026-10-10) — pure.
//
// Owner: "add a picture of the back wall of the house so the client
// recognises his house, where the deck will be." The 3D scene (scene.ts)
// flattened into a front elevation — every box and every roof face projected
// onto the x–z plane, repeats dropped — gives an outline drawing of the deck
// and its roof that the studio lays over the photo and the contractor slides
// and scales to fit the wall. The client's page draws the same polygons over
// the same photo (lib/proposalPictures → the portal's overlay), so what the
// client sees is exactly what the contractor placed.
//
// Polygons come out in the picture's 0…1000 square, like the roof's measured
// outline (roofPictures), so the portal needs no new drawing code.

import { SCENE_LAYERS, type DeckScene, type SceneLayer } from "./scene";
import type { DeckPhoto } from "./design";

export interface ElevationPoly {
  layer: SceneLayer;
  /** [x, z, x, z, …] in feet, x from the elevation's left edge, z from the ground. */
  pts: number[];
}

export interface Elevation {
  polys: ElevationPoly[];
  widthFt: number;
  heightFt: number;
  /** Where x = 0 of the scene lands in the elevation, ft (the roof's overhang can reach past the deck). */
  leftFt: number;
}

const MAX_POLYS = 500;
const r2 = (n: number) => Math.round(n * 20) / 20;

/** The convex hull of points (monotone chain), for a tilted member's projection. */
function hull(points: Array<[number, number]>): Array<[number, number]> {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Array<[number, number]> = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Array<[number, number]> = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return [...lower, ...upper];
}

const area2 = (pts: number[]) => {
  let a = 0;
  for (let i = 0; i < pts.length; i += 2) {
    const j = (i + 2) % pts.length;
    a += pts[i] * pts[j + 1] - pts[j] * pts[i + 1];
  }
  return Math.abs(a) / 2;
};

/** The layers the elevation draws — the frame's bones and the roof's skin, not every board. */
const DRAWN: ReadonlySet<SceneLayer> = new Set<SceneLayer>(["post", "beam", "rim", "fascia", "decking", "ledger", "roof-post", "header", "ridge", "rafter", "roofing", "trim", "gutter", "slab", "stair", "rail", "glass", "screen", "wall", "light"]);

/** The scene flattened onto the x–z plane. */
export function deckElevation(scene: DeckScene): Elevation {
  const raw: Array<{ layer: SceneLayer; pts: number[] }> = [];
  const seen = new Set<string>();
  const push = (layer: SceneLayer, pts: number[]) => {
    if (pts.length < 6 || area2(pts) < 0.02) return;
    const key = `${layer}:${pts.map(r2).join(",")}`;
    if (seen.has(key)) return;
    seen.add(key);
    raw.push({ layer, pts: pts.map(r2) });
  };
  for (const b of scene.boxes) {
    const layer = SCENE_LAYERS[b[0]];
    if (!DRAWN.has(layer)) continue;
    const [, cx, , cz, sx, sy, sz, lean] = b;
    if (b.length === 8 || (b[8] === 0 && b[9] === 0)) {
      if (lean) {
        // A knee brace along x: the diagonal of its box; along y: its post-side face.
        if (lean === 1 || lean === 2) {
          const dir = lean === 1 ? 1 : -1;
          const t = 0.3;
          push(layer, [cx - (dir * sx) / 2, cz - sz / 2, cx - (dir * sx) / 2 + t, cz - sz / 2, cx + (dir * sx) / 2, cz + sz / 2, cx + (dir * sx) / 2 - t, cz + sz / 2]);
        } else push(layer, [cx - sx / 2, cz - sz / 2, cx + sx / 2, cz - sz / 2, cx + sx / 2, cz + sz / 2, cx - sx / 2, cz + sz / 2]);
      } else if (layer === "decking") {
        // The walking surface: one band, not every board.
        push(layer, [cx - sx / 2, cz - sz / 2, cx + sx / 2, cz - sz / 2, cx + sx / 2, cz + sz / 2, cx - sx / 2, cz + sz / 2]);
      } else push(layer, [cx - sx / 2, cz - sz / 2, cx + sx / 2, cz - sz / 2, cx + sx / 2, cz + sz / 2, cx - sx / 2, cz + sz / 2]);
      continue;
    }
    // A turned member: its eight corners, projected.
    const yaw = b[8];
    const tilt = b[9];
    const ax = Math.cos(yaw) * Math.cos(tilt);
    const az = Math.sin(tilt);
    const wx = -Math.sin(yaw);
    const dx = -Math.cos(yaw) * Math.sin(tilt);
    const dz = Math.cos(tilt);
    const corners: Array<[number, number]> = [];
    for (const i of [-1, 1]) for (const j of [-1, 1]) for (const k of [-1, 1]) corners.push([cx + (i * sx * ax) / 2 + (j * sy * wx) / 2 + (k * sz * dx) / 2, cz + (i * sx * az) / 2 + (k * sz * dz) / 2]);
    push(layer, hull(corners).flat());
  }
  for (const p of scene.polys) {
    const layer = SCENE_LAYERS[p[0]];
    if (!DRAWN.has(layer)) continue;
    const pts: Array<[number, number]> = [];
    for (let i = 1; i + 2 < p.length; i += 3) pts.push([p[i], p[i + 2]]);
    push(layer, hull(pts).flat());
  }
  // The decking as one band across the whole deck.
  const deckBand = raw.filter((p) => p.layer === "decking");
  const others = raw.filter((p) => p.layer !== "decking");
  if (deckBand.length) {
    const xs = deckBand.flatMap((p) => p.pts.filter((_, i) => i % 2 === 0));
    const zs = deckBand.flatMap((p) => p.pts.filter((_, i) => i % 2 === 1));
    others.push({ layer: "decking", pts: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs), Math.min(...xs), Math.max(...zs)] });
  }
  const polys = others.slice(0, MAX_POLYS);
  const allX = polys.flatMap((p) => p.pts.filter((_, i) => i % 2 === 0));
  const allZ = polys.flatMap((p) => p.pts.filter((_, i) => i % 2 === 1));
  const minX = allX.length ? Math.min(...allX) : 0;
  const maxX = allX.length ? Math.max(...allX) : scene.widthFt;
  const maxZ = allZ.length ? Math.max(...allZ, 0) : scene.heightFt;
  return {
    polys: polys.map((p) => ({ layer: p.layer, pts: p.pts.map((v, i) => (i % 2 === 0 ? r2(v - minX) : r2(Math.max(0, v)))) })),
    widthFt: r2(maxX - minX),
    heightFt: r2(maxZ),
    leftFt: r2(-minX),
  };
}

/** Where a new photo's elevation starts: centred low on the picture, four fifths of its width. */
export function defaultPlacement(): NonNullable<DeckPhoto["placed"]> {
  return { x: 0.1, y: 0.88, w: 0.8 };
}

/**
 * The elevation on a picture, as polygon point lists in the picture's
 * 0…1000 square (what the portal's overlay draws): the ground line at
 * `placed.y`, its left end at `placed.x`, the elevation `placed.w` of the
 * picture wide — a foot is the same number of pixels across and up.
 */
export function elevationOverlay(elev: Elevation, placed: NonNullable<DeckPhoto["placed"]>, photoW: number, photoH: number): Array<{ layer: SceneLayer; points: string }> {
  if (!(elev.widthFt > 0) || !(photoW > 0) || !(photoH > 0)) return [];
  const sx = (placed.w * 1000) / elev.widthFt;
  const sz = sx * (photoW / photoH);
  const x0 = placed.x * 1000;
  const y0 = placed.y * 1000;
  const f = (n: number) => Math.round(n * 10) / 10;
  return elev.polys.map((p) => {
    const pts: string[] = [];
    for (let i = 0; i < p.pts.length; i += 2) pts.push(`${f(x0 + p.pts[i] * sx)},${f(y0 - p.pts[i + 1] * sz)}`);
    return { layer: p.layer, points: pts.join(" ") };
  });
}
