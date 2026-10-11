// THE SMALL PICTURE (2026-10-11) — pure. A scene the engine built (lib/deck/
// scene: boxes, flat polygons, the house's wall) drawn as an isometric SVG:
// no WebGL, no three.js, a few hundred paths. The kind picker shows every
// kind of project and every sample this way, and the faces come grouped by
// the build order so the picture can stand itself up layer by layer.
//
// The camera is orthographic: the world turned `yaw` degrees about the up
// axis, then seen from `pitch` degrees above the horizon. The viewer stands
// in front of the deck (+y, away from the house), so the house is behind.
// Faces are painted far to near by their centre's depth — right for boxes
// that do not cut through each other, which a frame's members do not.

import { SCENE_LAYERS, buildRank, type DeckScene, type SceneLayer } from "./scene";

export interface IsoFace {
  /** SVG path data, already rounded. */
  d: string;
  fill: string;
  opacity?: number;
  layer: SceneLayer | "ground" | "house";
  /** The build step (SCENE_BUILD_ORDER's index), −1 for the ground and the house. */
  rank: number;
}

export interface IsoDrawing {
  viewBox: string;
  faces: IsoFace[];
  /** The ranks present, ascending — the picture stands up in this order. */
  ranks: number[];
  /** How many boxes and polygons went in. */
  solids: number;
}

export interface IsoOptions {
  yawDeg?: number;
  pitchDeg?: number;
  /** Layers left out of the picture (the wiring and the hardware are noise at this size). */
  skip?: readonly SceneLayer[];
  /** Beyond this many solids the thin layers go first (blocking, hardware, then joists). */
  maxSolids?: number;
}

const DEFAULT_SKIP: readonly SceneLayer[] = ["wire", "hardware", "blocking", "footing"];

type V3 = [number, number, number];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/** What each layer is painted with: the scene's own colours for what the contractor chose, fixed ones for the rest. */
function layerFill(layer: SceneLayer, colors: DeckScene["colors"]): { fill: string; opacity?: number } {
  switch (layer) {
    case "post": case "beam": case "ledger": case "joist": case "rim": case "blocking": case "brace": case "roof-post": case "header": case "ridge": case "rafter":
      return { fill: colors.frame };
    case "decking": case "stair": return { fill: colors.decking };
    case "fascia": return { fill: colors.fascia };
    case "rail": return { fill: colors.rail };
    case "roofing": return { fill: colors.roofing };
    case "sheathing": return { fill: "#d6bf90" };
    case "trim": return { fill: "#f1eee6" };
    case "gutter": return { fill: "#d9d6cf" };
    case "ceiling": return { fill: "#e6d5b2" };
    case "glass": return { fill: "#bfe0ef", opacity: 0.55 };
    case "screen": return { fill: "#8d969d", opacity: 0.45 };
    case "wall": return { fill: "#e3dccd" };
    case "slab": return { fill: "#c9c6bd" };
    case "footing": return { fill: "#b9b6ad" };
    case "hardware": return { fill: "#9a9ea3" };
    case "light": return { fill: "#f4efe4" };
    case "wire": return { fill: "#3a3a3f" };
  }
}

/** A hex colour darkened or lightened: k < 1 darker. */
export function shadeHex(hex: string, k: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  const r = ch((n >> 16) & 255), g = ch((n >> 8) & 255), b = ch(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

interface Solid {
  layer: SceneLayer | "ground" | "house";
  rank: number;
  fill: string;
  opacity?: number;
  /** Convex faces, each a ring of world points. */
  faces: V3[][];
  /** Painted before everything, in this order (the ground, the house). */
  first?: number;
}

/** The eight corners of a box about `c` along the unit axes u (length), v (width), w (depth). */
function orientedBox(c: V3, u: V3, v: V3, w: V3, su: number, sv: number, sw: number): V3[][] {
  const p = (a: number, b: number, d: number): V3 => add(add(add(c, scale(u, (a * su) / 2)), scale(v, (b * sv) / 2)), scale(w, (d * sw) / 2));
  // Corners: index bits (a, b, d) ∈ {−1, +1}.
  const P = {
    mmm: p(-1, -1, -1), pmm: p(1, -1, -1), ppm: p(1, 1, -1), mpm: p(-1, 1, -1),
    mmp: p(-1, -1, 1), pmp: p(1, -1, 1), ppp: p(1, 1, 1), mpp: p(-1, 1, 1),
  };
  // Six faces, each wound so its normal points outward (right-hand rule).
  return [
    [P.mmp, P.pmp, P.ppp, P.mpp], // +w
    [P.mmm, P.mpm, P.ppm, P.pmm], // −w
    [P.pmm, P.ppm, P.ppp, P.pmp], // +u
    [P.mmm, P.mmp, P.mpp, P.mpm], // −u
    [P.mpm, P.mpp, P.ppp, P.ppm], // +v
    [P.mmm, P.pmm, P.pmp, P.mmp], // −v
  ];
}

const Z: V3 = [0, 0, 1];

/** A scene's box row → its solid: axis-aligned, leaning (a knee brace), or turned and tilted (a rafter). */
function boxSolid(b: number[]): V3[][] {
  const [, cx, cy, cz, sx, sy, sz, lean = 0, yaw, tilt] = b;
  const c: V3 = [cx, cy, cz];
  if (typeof yaw === "number" && typeof tilt === "number") {
    const u: V3 = [Math.cos(yaw) * Math.cos(tilt), Math.sin(yaw) * Math.cos(tilt), Math.sin(tilt)];
    const v: V3 = [-Math.sin(yaw), Math.cos(yaw), 0];
    const w = norm(cross(u, v));
    return orientedBox(c, u, v, w, sx, sy, sz);
  }
  if (lean >= 1 && lean <= 4) {
    // A brace drawn as the diagonal of its box: along x (1 toward +x, 2 toward −x) or y (3 toward +y, 4 toward −y), rising with z.
    const alongX = lean <= 2;
    const sign = lean === 1 || lean === 3 ? 1 : -1;
    const run = alongX ? sx : sy;
    const u = norm(alongX ? [sign * run, 0, sz] : [0, sign * run, sz]);
    const v: V3 = alongX ? [0, 1, 0] : [1, 0, 0];
    const w = norm(cross(u, v));
    const thick = Math.min(alongX ? sy : sx, 0.3);
    return orientedBox(c, u, v, w, Math.hypot(run, sz), thick, 0.3);
  }
  return orientedBox(c, [1, 0, 0], [0, 1, 0], Z, sx, sy, sz);
}

function newell(ring: V3[]): V3 {
  let n: V3 = [0, 0, 0];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    n = [n[0] + (a[1] - b[1]) * (a[2] + b[2]), n[1] + (a[2] - b[2]) * (a[0] + b[0]), n[2] + (a[0] - b[0]) * (a[1] + b[1])];
  }
  return norm(n);
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The drawing. `yawDeg` turns the deck (positive brings its right end
 * toward the viewer); `pitchDeg` is the eye's height above the horizon.
 */
export function isoDrawing(scene: DeckScene, opts: IsoOptions = {}): IsoDrawing {
  const yaw = ((opts.yawDeg ?? 34) * Math.PI) / 180;
  const pitch = ((opts.pitchDeg ?? 30) * Math.PI) / 180;
  const skip = new Set<SceneLayer>(opts.skip ?? DEFAULT_SKIP);
  const maxSolids = opts.maxSolids ?? 2400;
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  // World → screen. x' runs right, y' toward the viewer, z up.
  const project = (p: V3): [number, number] => {
    const x1 = p[0] * cy - p[1] * sy;
    const y1 = p[0] * sy + p[1] * cy;
    return [x1, y1 * sp - p[2] * cp];
  };
  const depth = (p: V3) => (p[0] * sy + p[1] * cy) * cp + p[2] * sp;
  /** The direction toward the viewer, in world terms. */
  const toViewer: V3 = norm([sy * cp, cy * cp, sp]);
  /** The light: high, a little to the left and the front. */
  const light: V3 = norm([-0.35, 0.3, 0.9]);

  const solids: Solid[] = [];
  const layerOf = (i: number): SceneLayer | null => SCENE_LAYERS[i] ?? null;

  // The ground: a pad under everything, first of all.
  const ring = scene.outline.length >= 6 ? scene.outline : [0, 0, scene.widthFt, 0, scene.widthFt, scene.depthFt, 0, scene.depthFt];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < ring.length; i += 2) {
    minX = Math.min(minX, ring[i]); maxX = Math.max(maxX, ring[i]);
    minY = Math.min(minY, ring[i + 1]); maxY = Math.max(maxY, ring[i + 1]);
  }
  for (const f of scene.footings) {
    minX = Math.min(minX, f[0] - 1); maxX = Math.max(maxX, f[0] + 1);
    minY = Math.min(minY, f[1] - 1); maxY = Math.max(maxY, f[1] + 1);
  }
  const groundDrop = scene.ground ? Math.max(scene.ground.outDropFt, scene.ground.acrossDropFt, 0) : 0;
  const pad = 2.5;
  solids.push({
    layer: "ground", rank: -1, fill: "#e4e8dc", first: 0,
    faces: [[[minX - pad, Math.min(minY, 0) - 0.2, -groundDrop], [maxX + pad, Math.min(minY, 0) - 0.2, -groundDrop], [maxX + pad, maxY + pad, -groundDrop], [minX - pad, maxY + pad, -groundDrop]]],
  });

  // The house: its wall behind the deck, only as tall as the picture needs, with the door.
  if (scene.house && scene.house.blocks.length) {
    const h = scene.house;
    const doorH = h.door ? h.door[2] : 6.7;
    const top = Math.min(h.heightFt, scene.heightFt + doorH + 1.5);
    let k = 1;
    for (const blk of h.blocks) {
      const [x0, y0, x1, y1] = blk;
      const yBack = Math.max(y0, y1 - 1.25);
      const c: V3 = [(x0 + x1) / 2, (yBack + y1) / 2, top / 2];
      solids.push({ layer: "house", rank: -1, fill: "#e9e5db", first: k++, faces: orientedBox(c, [1, 0, 0], [0, 1, 0], Z, Math.abs(x1 - x0), Math.abs(y1 - yBack), top) });
    }
    if (h.door) {
      const [dx, dw, dh] = h.door;
      const y = Math.max(...h.blocks.map((b) => b[3])) + 0.02;
      const z0 = scene.heightFt;
      solids.push({ layer: "house", rank: -1, fill: "#8a6d4b", first: k++, faces: [[[dx - dw / 2, y, z0], [dx + dw / 2, y, z0], [dx + dw / 2, y, z0 + dh], [dx - dw / 2, y, z0 + dh]]] });
    }
  }

  // The boxes.
  const counts = new Map<SceneLayer, number>();
  for (const b of scene.boxes) {
    const layer = layerOf(b[0]);
    if (!layer || skip.has(layer)) continue;
    counts.set(layer, (counts.get(layer) ?? 0) + 1);
  }
  let budget = maxSolids;
  const thinFirst: SceneLayer[] = ["light", "gutter", "trim", "brace", "joist", "rafter"];
  for (const l of thinFirst) {
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    if (total <= budget) break;
    const n = counts.get(l) ?? 0;
    if (n) { skip.add(l); counts.delete(l); }
  }
  budget = Math.max(budget, 1);
  for (const b of scene.boxes) {
    const layer = layerOf(b[0]);
    if (!layer || skip.has(layer)) continue;
    if (!(b[4] > 0.005 && b[5] > 0.005 && b[6] > 0.005)) continue;
    const { fill, opacity } = layerFill(layer, scene.colors);
    solids.push({ layer, rank: buildRank(layer), fill, opacity, faces: boxSolid(b) });
  }
  // The flat polygons: the roof's faces, the ceiling, the slab, glass, screens, walls.
  for (const p of scene.polys) {
    const layer = layerOf(p[0]);
    if (!layer || skip.has(layer) || p.length < 10) continue;
    const ringP: V3[] = [];
    for (let i = 1; i + 2 < p.length; i += 3) ringP.push([p[i], p[i + 1], p[i + 2]]);
    const { fill, opacity } = layerFill(layer, scene.colors);
    solids.push({ layer, rank: buildRank(layer), fill, opacity, faces: [ringP] });
  }
  // Boards laid on the diagonal or cut to a shaped front: flat rings at the walking surface.
  if (scene.diagonal && !skip.has("decking")) {
    const { boards, zs, thickFt } = scene.diagonal;
    boards.forEach((ring2, i) => {
      if (ring2.length < 6) return;
      const z = (zs?.[i] ?? scene.heightFt) + thickFt / 2;
      const ringP: V3[] = [];
      for (let k = 0; k + 1 < ring2.length; k += 2) ringP.push([ring2[k], ring2[k + 1], z]);
      solids.push({ layer: "decking", rank: buildRank("decking"), fill: scene.colors.decking, faces: [ringP] });
    });
  }

  // Faces: keep those turned toward the viewer (both sides of a lone polygon), shade by the light, sort far to near.
  type Painted = { d: string; fill: string; opacity?: number; layer: Solid["layer"]; rank: number; depth: number; first: number };
  const painted: Painted[] = [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of solids) {
    const lone = s.faces.length === 1;
    for (const face of s.faces) {
      if (face.length < 3) continue;
      let n = newell(face);
      const facing = dot(n, toViewer);
      if (!lone && facing <= 0.02) continue;
      if (lone && facing < 0) n = scale(n, -1);
      const k = 0.6 + 0.4 * Math.max(0, dot(n, light));
      const fill = s.layer === "ground" ? s.fill : shadeHex(s.fill, k);
      let cxp = 0, cyp = 0, czp = 0;
      const pts: string[] = [];
      for (const p of face) {
        const [X, Y] = project(p);
        pts.push(`${r2(X)},${r2(Y)}`);
        cxp += p[0]; cyp += p[1]; czp += p[2];
        x0 = Math.min(x0, X); x1 = Math.max(x1, X); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y);
      }
      const c: V3 = [cxp / face.length, cyp / face.length, czp / face.length];
      painted.push({ d: `M${pts.join("L")}Z`, fill, opacity: s.opacity, layer: s.layer, rank: s.rank, depth: depth(c), first: s.first ?? Number.POSITIVE_INFINITY });
    }
  }
  painted.sort((a, b) => (a.first - b.first) || (a.depth - b.depth) || (a.rank - b.rank));
  if (!Number.isFinite(x0)) { x0 = 0; y0 = 0; x1 = 1; y1 = 1; }
  const m = 0.6;
  const faces: IsoFace[] = painted.map((p) => ({ d: p.d, fill: p.fill, opacity: p.opacity, layer: p.layer, rank: p.rank }));
  const ranks = [...new Set(faces.map((f) => f.rank))].sort((a, b) => a - b);
  return { viewBox: `${r2(x0 - m)} ${r2(y0 - m)} ${r2(x1 - x0 + 2 * m)} ${r2(y1 - y0 + 2 * m)}`, faces, ranks, solids: solids.length };
}
