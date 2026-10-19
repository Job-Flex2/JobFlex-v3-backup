// THE YARD THAT'S KEPT (2026-10-19 — owner, of a wooded acreage the map had tinted speck by speck: "make outlines where
// you identify this is really the maintained place, because it could be like 10 acres"). The photo sorts every pixel;
// a crew services only the yard around the buildings. Two passes decide what's kept and what's left NATURAL (shown on
// the map, never priced, one tap from counted):
//  · on the server, with the photo's near-infrared at hand: green in the woods' shade — ferns, salal, brush, read as
//    "smooth and green" — is told from lawn by how dark it is next to the photo's own sunlit lawn (shadedUndergrowth);
//  · then, here and on the map whenever the reach changes (keepYard):
//    – a speck of grass, soil or shadow out in the woods (a gap in the canopy, ringed by crowns) is the woods';
//    – grass in a little opening of the woods, well away from the house, is natural;
//    – the lawn is the grass within reach of the buildings — 200 ft unless the contractor changes it — and grass past
//      that (a field, a pasture, a meadow) is natural;
//    – beds are the planting around the house and in the lawn; brush along the woods' edge and bare ground away from
//      both are natural;
//    – paving near the house (the patio, the driveway out to the street) stays; a far-off gravel patch is natural.
// With no building on the lot nothing is cut by reach — there's nothing to measure it from. Pure, browser-safe.
import type { Grid } from "./geo";
import { distanceTo, M_TO_FT } from "./geo";
import { CLS, despeckle } from "./classify";

/** How far from the buildings grass is taken as lawn, by default. */
export const DEFAULT_REACH_FT = 200;
/** The reaches the map offers. */
export const REACHES_FT = [100, 200, 300] as const;

type Piece = { px: number[]; minDist: number; around: Map<number, number>; aroundN: number };

/** The 4-connected pieces of a class inside the lot, each with its nearest distance (to the buildings) and what rims it. */
function piecesOf(L: Uint8Array, lot: Uint8Array, w: number, h: number, cls: number, dist: Float32Array): Piece[] {
  const seen = new Uint8Array(w * h);
  const out: Piece[] = [];
  for (let i = 0; i < w * h; i++) {
    if (seen[i] || !lot[i] || L[i] !== cls) continue;
    const px: number[] = [];
    const q = [i];
    seen[i] = 1;
    let minDist = Infinity;
    const around = new Map<number, number>();
    let aroundN = 0;
    while (q.length) {
      const p = q.pop()!;
      px.push(p);
      if (dist[p] < minDist) minDist = dist[p];
      const x = p % w;
      const y = (p - x) / w;
      for (const [xx, yy] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const k = yy * w + xx;
        if (lot[k] && L[k] === cls) {
          if (!seen[k]) {
            seen[k] = 1;
            q.push(k);
          }
        } else {
          const c = lot[k] ? L[k] : CLS.OUT;
          around.set(c, (around.get(c) ?? 0) + 1);
          aroundN++;
        }
      }
    }
    out.push({ px, minDist, around, aroundN });
  }
  return out;
}

const share = (pc: Piece, ...cls: number[]) => cls.reduce((s, c) => s + (pc.around.get(c) ?? 0), 0) / (pc.aroundN || 1);

/** Distance (pixels) from every pixel to the lot's own buildings — a building at least half inside the lot; a
 *  neighbour's roof the lot line clips doesn't count — Infinity everywhere when the lot has none. */
function fromBuildings(L: Uint8Array, lot: Uint8Array, w: number, h: number): { dist: Float32Array; any: boolean } {
  const N = w * h;
  const on = new Uint8Array(N);
  const seen = new Uint8Array(N);
  let any = false;
  for (let i = 0; i < N; i++) {
    if (seen[i] || L[i] !== CLS.BUILDING) continue;
    const comp: number[] = [];
    const q = [i];
    seen[i] = 1;
    let inside = 0;
    while (q.length) {
      const p = q.pop()!;
      comp.push(p);
      if (lot[p]) inside++;
      const x = p % w;
      const y = (p - x) / w;
      for (const [xx, yy] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const k = yy * w + xx;
        if (!seen[k] && L[k] === CLS.BUILDING) {
          seen[k] = 1;
          q.push(k);
        }
      }
    }
    if (inside * 2 < comp.length) continue;
    for (const p of comp) if (lot[p]) on[p] = 1;
    any = true;
  }
  return { dist: any ? distanceTo(on, w, h) : new Float32Array(N).fill(Infinity), any };
}

/** Green in the woods' shade, in place. The near-infrared tells it: sunlit leaves glow in it, shade doesn't — so lawn
 *  darker than 60% of the photo's sunlit plants (the 90th percentile of its every green pixel, crowns and lawns: a
 *  wooded lot's own "lawn" can be mostly undergrowth) is in shade. A patch of it that sunlit lawn mostly rims is a
 *  tree's shadow on the lawn, and stays; one the woods mostly rim, away from the house, is undergrowth — ferns, salal,
 *  brush under the trees' edge — and is set natural. Run on the server (it needs the photo); returns the sq ft set. */
export function shadedUndergrowth(L: Uint8Array, lot: Uint8Array, g: Pick<Grid, "w" | "h" | "gsdM">, photo: { rgb: Uint8Array; nir: Uint8Array }): number {
  const { w, h } = g;
  const N = w * h;
  const { rgb, nir } = photo;
  const fpp = g.gsdM * M_TO_FT;
  const hist = new Uint32Array(256);
  let n = 0;
  for (let i = 0; i < N; i += 2) {
    const r = rgb[i * 3];
    if ((nir[i] - r) / (nir[i] + r + 1e-6) > 0.2) {
      hist[nir[i]]++;
      n++;
    }
  }
  if (n < 200) return 0;
  let ref = 255;
  for (let v = 0, c = 0; v < 256; v++) {
    c += hist[v];
    if (c >= n * 0.9) {
      ref = v;
      break;
    }
  }
  const dark = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (lot[i] && L[i] === CLS.LAWN && nir[i] < ref * 0.6) dark[i] = 1;
  const { dist } = fromBuildings(L, lot, w, h);
  const seen = new Uint8Array(N);
  let set = 0;
  for (let i = 0; i < N; i++) {
    if (seen[i] || !dark[i]) continue;
    const px: number[] = [];
    const q = [i];
    seen[i] = 1;
    let minDist = Infinity;
    let rim = 0;
    let sunlit = 0;
    while (q.length) {
      const p = q.pop()!;
      px.push(p);
      if (dist[p] < minDist) minDist = dist[p];
      const x = p % w;
      const y = (p - x) / w;
      for (const [xx, yy] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const k = yy * w + xx;
        if (dark[k]) {
          if (!seen[k]) {
            seen[k] = 1;
            q.push(k);
          }
          continue;
        }
        rim++;
        if (lot[k] && L[k] === CLS.LAWN) sunlit++;
      }
    }
    if (minDist * fpp <= 25 || px.length * fpp * fpp < 100 || sunlit / (rim || 1) >= 0.5) continue;
    for (const p of px) L[p] = CLS.NATURAL;
    set += px.length;
  }
  return Math.round(set * fpp * fpp);
}

export type YardPass = {
  labels: Uint8Array;
  /** Ground left natural, sq ft (inside the lot). */
  naturalSqft: number;
  /** The reach used, feet; null when there was no building to measure it from. */
  reachFt: number | null;
};

/** Pick out the maintained yard from the photo's reading (a site's readLabels — never a pass already made): what isn't,
 *  inside the lot, becomes NATURAL (or the woods' TREE, for specks in them). `labels` is left alone; a copy comes back. */
export function keepYard(labels: Uint8Array, lot: Uint8Array, g: Pick<Grid, "w" | "h" | "gsdM">, opts: { reachFt?: number } = {}): YardPass {
  const { w, h } = g;
  const N = w * h;
  const fpp = g.gsdM * M_TO_FT;
  const sqftPx = fpp * fpp;
  const L = new Uint8Array(labels);
  const { dist, any: hasBuilding } = fromBuildings(L, lot, w, h);
  const ft = (p: number) => dist[p] * fpp;
  const reach = opts.reachFt ?? DEFAULT_REACH_FT;
  const far = (p: number) => hasBuilding && ft(p) > reach;

  // Specks in the woods: small, mostly ringed by crowns, not up against the house.
  for (const cls of [CLS.LAWN, CLS.BED, CLS.HARD])
    for (const pc of piecesOf(L, lot, w, h, cls, dist))
      if (pc.px.length * sqftPx < 400 && share(pc, CLS.TREE) >= 0.6 && pc.minDist * fpp > 30) for (const p of pc.px) L[p] = CLS.TREE;

  // An opening in the woods, well away from the house: under a fifth of it more than 12 ft from a crown.
  {
    const tree = new Uint8Array(N);
    for (let i = 0; i < N; i++) tree[i] = L[i] === CLS.TREE ? 1 : 0;
    const dTree = distanceTo(tree, w, h);
    for (const pc of piecesOf(L, lot, w, h, CLS.LAWN, dist)) {
      if (pc.px.length * sqftPx >= 3000 || (hasBuilding && pc.minDist * fpp <= 100)) continue;
      let open = 0;
      for (const p of pc.px) if (dTree[p] * fpp > 12) open++;
      if (open / pc.px.length < 0.2) for (const p of pc.px) L[p] = CLS.NATURAL;
    }
  }

  if (hasBuilding) {
    // Lawn: within reach of the buildings.
    for (let i = 0; i < N; i++) if (lot[i] && L[i] === CLS.LAWN && far(i)) L[i] = CLS.NATURAL;
    // Beds: around the buildings, or in the lawn — rimmed by it, small, within reach. A strip along the woods' edge
    // (more crown than lawn around it) is the woods' brush.
    const NEAR_FT = 60;
    for (const pc of piecesOf(L, lot, w, h, CLS.BED, dist)) {
      const inLawn = share(pc, CLS.LAWN) >= 0.35 && share(pc, CLS.TREE, CLS.NATURAL) < 0.5 && pc.px.length * sqftPx <= 2500 && pc.minDist * fpp <= reach;
      if (inLawn) continue;
      for (const p of pc.px) if (ft(p) > NEAR_FT) L[p] = CLS.NATURAL;
    }
    // Paving: a piece that comes near the buildings stays whole (the driveway runs to the street); the rest past reach goes.
    for (const pc of piecesOf(L, lot, w, h, CLS.HARD, dist)) {
      if (pc.minDist * fpp <= NEAR_FT) continue;
      for (const p of pc.px) if (far(p)) L[p] = CLS.NATURAL;
    }
  }
  // What the cuts left in crumbs goes to what's around it.
  despeckle(L, w, h, CLS.LAWN, Math.ceil(60 / sqftPx));
  despeckle(L, w, h, CLS.BED, Math.ceil(30 / sqftPx));
  let natural = 0;
  for (let i = 0; i < N; i++) if (lot[i] && L[i] === CLS.NATURAL) natural++;
  return { labels: L, naturalSqft: Math.round(natural * sqftPx), reachFt: hasBuilding ? reach : null };
}

/** The maintained yard as one area — what the map outlines and leaves undimmed: the lawn, beds, pool and buildings,
 *  the paving right beside them (patio, walks, the top of the drive), drawn together across gaps under 12 ft (a tree
 *  in the lawn, a path between beds), holes filled, clipped to the lot. A yard that's most of its lot (70% and up — a
 *  town lot, the street trees and the neighbour's drive nibbling at its edges) is the whole lot. Areas come from the
 *  classes, never from this. */
export function yardArea(labels: Uint8Array, lot: Uint8Array, g: Pick<Grid, "w" | "h" | "gsdM">): { mask: Uint8Array; sqft: number; wholeLot: boolean } {
  const { w, h } = g;
  const N = w * h;
  const fpp = g.gsdM * M_TO_FT;
  const core = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const c = labels[i];
    if (lot[i] && (c === CLS.LAWN || c === CLS.BED || c === CLS.WATER || c === CLS.BUILDING)) core[i] = 1;
  }
  const dCore = distanceTo(core, w, h);
  const gapPx = 12 / fpp;
  // Paving beside the yard joins it.
  for (let i = 0; i < N; i++) if (lot[i] && labels[i] === CLS.HARD && dCore[i] * fpp <= 20) core[i] = 1;
  // Closing: grown by half the gap, then shrunk back — the lot line counting as yard, so a yard that runs to the fence
  // meets it instead of rounding off short of the corners.
  for (let i = 0; i < N; i++) if (!lot[i]) core[i] = 1;
  const grown = new Uint8Array(N);
  const d1 = distanceTo(core, w, h);
  for (let i = 0; i < N; i++) grown[i] = d1[i] <= gapPx / 2 ? 0 : 1;
  const d2 = distanceTo(grown, w, h);
  const mask = new Uint8Array(N);
  for (let i = 0; i < N; i++) mask[i] = lot[i] && d2[i] > gapPx / 2 ? 1 : 0;
  // Holes filled: whatever the outside can't reach without crossing the yard.
  const outside = new Uint8Array(N);
  const q: number[] = [];
  for (let x = 0; x < w; x++)
    for (const y of [0, h - 1]) {
      const i = y * w + x;
      if (!mask[i] && !outside[i]) {
        outside[i] = 1;
        q.push(i);
      }
    }
  for (let y = 0; y < h; y++)
    for (const x of [0, w - 1]) {
      const i = y * w + x;
      if (!mask[i] && !outside[i]) {
        outside[i] = 1;
        q.push(i);
      }
    }
  while (q.length) {
    const p = q.pop()!;
    const x = p % w;
    const y = (p - x) / w;
    for (const [xx, yy] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const k = yy * w + xx;
      if (!mask[k] && !outside[k]) {
        outside[k] = 1;
        q.push(k);
      }
    }
  }
  let n = 0;
  for (let i = 0; i < N; i++) {
    mask[i] = lot[i] && !outside[i] ? 1 : 0;
    n += mask[i];
  }
  // Crumbs of yard (a lone bush, under 150 sq ft) aren't drawn as a yard of their own.
  const keep = new Uint8Array(N);
  keep.set(mask);
  despeckle(keep, w, h, 1, Math.ceil(150 / (fpp * fpp)));
  n = 0;
  let lotPx = 0;
  for (let i = 0; i < N; i++) {
    mask[i] = keep[i] === 1 ? 1 : 0;
    n += mask[i];
    lotPx += lot[i];
  }
  if (lotPx && n >= lotPx * 0.7) {
    mask.set(lot);
    return { mask, sqft: Math.round(lotPx * fpp * fpp), wholeLot: true };
  }
  return { mask, sqft: Math.round(n * fpp * fpp), wholeLot: false };
}

/** A tap on the map: the whole connected piece under it (of its class, inside the lot) changed to `to`. */
export function fillPiece(labels: Uint8Array, lot: Uint8Array, w: number, h: number, at: number, to: number): Uint8Array {
  const L = new Uint8Array(labels);
  const from = L[at];
  if (!lot[at] || from === to || from === CLS.BUILDING) return L;
  const q = [at];
  L[at] = to;
  while (q.length) {
    const p = q.pop()!;
    const x = p % w;
    const y = (p - x) / w;
    for (const [xx, yy] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const k = yy * w + xx;
      if (lot[k] && L[k] === from) {
        L[k] = to;
        q.push(k);
      }
    }
  }
  return L;
}

/** A tap on a natural piece — count it in: every natural pixel connected to it is grass to mow, unless the photo read
 *  paving or water there. (What the photo read as soil or brush out in a field is the field's dry or rough grass, not
 *  a bed to mulch — the beds round the house were never left out.) */
export function countPiece(labels: Uint8Array, read: Uint8Array, lot: Uint8Array, w: number, h: number, at: number): Uint8Array {
  const L = new Uint8Array(labels);
  if (!lot[at] || L[at] !== CLS.NATURAL) return L;
  const back = (p: number) => (read[p] === CLS.HARD || read[p] === CLS.WATER ? read[p] : CLS.LAWN);
  const q = [at];
  L[at] = back(at);
  while (q.length) {
    const p = q.pop()!;
    const x = p % w;
    const y = (p - x) / w;
    for (const [xx, yy] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const k = yy * w + xx;
      if (lot[k] && L[k] === CLS.NATURAL) {
        L[k] = back(k);
        q.push(k);
      }
    }
  }
  return L;
}

/** A reach changed: the yard redone from the photo's reading, the contractor's own edits (every pixel where `edited`
 *  differs from the pass it started from) laid back on top. */
export function reReach(read: Uint8Array, edited: Uint8Array, lot: Uint8Array, g: Pick<Grid, "w" | "h" | "gsdM">, fromFt: number, toFt: number): YardPass {
  const before = keepYard(read, lot, g, { reachFt: fromFt }).labels;
  const next = keepYard(read, lot, g, { reachFt: toFt });
  for (let i = 0; i < edited.length; i++) if (edited[i] !== before[i]) next.labels[i] = edited[i];
  let natural = 0;
  for (let i = 0; i < edited.length; i++) if (lot[i] && next.labels[i] === CLS.NATURAL) natural++;
  return { ...next, naturalSqft: Math.round(natural * (g.gsdM * M_TO_FT) ** 2) };
}
