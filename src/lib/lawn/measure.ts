// THE YARD IN NUMBERS (2026-10-18). From the classified photo to what a landscaper prices: the lawn split front, back
// and sides (the street side found from the pavement just outside the lot, the house's depth from its footprint), the
// beds, the trees standing in the lawn to mow around, the edges by what the lawn meets (pavement edged hard, beds
// edged soft, the house trimmed along its foundation, the lot line trimmed along a fence), slope from lidar, and how
// far the numbers can be trusted. Areas come from pixel counts; lengths from the smoothed outlines. Pure.
import type { Grid, Pt } from "./geo";
import { distanceTo, ftPerPx } from "./geo";
import { CLS } from "./classify";
import { edgeNeighbours, outlinesOf } from "./vectorize";
import { yardArea } from "./yard";

export type Zone = "front" | "back" | "side";

export type SlopeBands = { flat: number; moderate: number; steep: number; /** Share of the lawn over 33% (18°): mower safety. */ tooSteep: number; samples: number; source: "lidar" | "none" };

export type Confidence = { level: "green" | "amber" | "red"; score: number; reasons: string[] };

export type YardMeasures = {
  lotSqft: number;
  lawnSqft: number;
  lawnByZone: Record<Zone, number>;
  bedSqft: number;
  treeCanopySqft: number;
  /** Crowns over or within 30 ft of the lawn and beds — the trees whose leaves land in the yard (2026-10-19). */
  yardCanopySqft?: number;
  /** Ground left natural — woods floor, field, meadow: on the lot, never serviced (2026-10-19). */
  naturalSqft?: number;
  /** The maintained yard as one area (lawn, beds, pool, house and the paving beside them, gaps under 12 ft closed) —
   *  the outline on the map (2026-10-19). */
  yardSqft?: number;
  /** Tree crowns over the lawn: the grass under them is mowed too, but can't be seen from the air. */
  canopyOverLawnSqft: number;
  hardSqft: number;
  houseSqft: number;
  poolSqft: number;
  /** Trees standing in the lawn — each one is a mow-around and a trim ring. */
  treesInLawn: number;
  edges: {
    /** Lawn against driveway, walks, patio, curb: edged with a blade. */
    hardFt: number;
    /** Lawn against a bed: a soft (spade) edge. */
    bedFt: number;
    /** Lawn against the house: string-trimmed along the foundation. */
    houseFt: number;
    /** Lawn around trees. */
    treeFt: number;
    /** Lawn along the lot line (a fence or the neighbour's line) or the edge of the natural ground: trimmed. */
    lotLineFt: number;
  };
  bedPerimeterFt: number;
  slope: SlopeBands;
  /** The side of the lot facing the street, as the index of the lot ring's edge (pixel ring), or null. */
  frontEdge: number | null;
  confidence: Confidence;
};

const round = (n: number) => Math.round(n);

/** Pixels of the lot ring's edge `i`, as a segment. */
function edge(r: Pt[], i: number): [Pt, Pt] {
  return [r[i], r[(i + 1) % r.length]];
}

/** The lot's street side: of its edges 15 ft or longer, the one with the most pavement in a strip just outside it. */
export function streetEdge(lotRing: Pt[], labels: Uint8Array, lot: Uint8Array, g: Grid): number | null {
  const fpp = ftPerPx(g);
  // Which way is "outside": the ring's orientation decides the normal's sign.
  let area = 0;
  for (let i = 0, j = lotRing.length - 1; i < lotRing.length; j = i++) area += lotRing[j].x * lotRing[i].y - lotRing[i].x * lotRing[j].y;
  const sign = area > 0 ? 1 : -1;
  let best: { i: number; score: number } | null = null;
  for (let i = 0; i < lotRing.length; i++) {
    const [a, b] = edge(lotRing, i);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len * fpp < 15) continue;
    const nx = (-(b.y - a.y) / len) * sign;
    const ny = ((b.x - a.x) / len) * sign;
    let hard = 0;
    let n = 0;
    for (let t = 0.1; t <= 0.9; t += 0.1)
      for (const dFt of [6, 12, 20, 30]) {
        // Try both sides of the edge; the outside is the one not in the lot.
        for (const s of [1, -1]) {
          const x = Math.floor(a.x + (b.x - a.x) * t + nx * s * (dFt / fpp));
          const y = Math.floor(a.y + (b.y - a.y) * t + ny * s * (dFt / fpp));
          if (x < 0 || y < 0 || x >= g.w || y >= g.h) continue;
          const k = y * g.w + x;
          if (lot[k]) continue;
          n++;
          if (labels[k] === CLS.HARD) hard++;
        }
      }
    if (!n) continue;
    const score = (hard / n) * Math.sqrt(len);
    if (!best || score > best.score) best = { i, score };
  }
  return best && best.score > 0 ? best.i : null;
}

/** Without assessor footprints: the house is a solid hard or roof-coloured piece inside the lot, away from the lot line
 *  (a driveway reaches the street; a roof doesn't), bigger than a shed. Marked BUILDING in place. */
export function findHouse(labels: Uint8Array, lot: Uint8Array, g: Grid): number {
  const { w, h } = g;
  const sqftPx = ftPerPx(g) ** 2;
  const seen = new Uint8Array(w * h);
  let marked = 0;
  for (let i = 0; i < w * h; i++) {
    if (seen[i] || !lot[i] || (labels[i] !== CLS.HARD && labels[i] !== CLS.BED)) continue;
    const comp: number[] = [];
    const q = [i];
    seen[i] = 1;
    let touches = 0;
    let x0 = w;
    let y0 = h;
    let x1 = 0;
    let y1 = 0;
    while (q.length) {
      const p = q.pop()!;
      comp.push(p);
      const x = p % w;
      const y = (p - x) / w;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
      for (const [xx, yy] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const k = yy * w + xx;
        if (!lot[k]) {
          touches++;
          continue;
        }
        if (!seen[k] && (labels[k] === CLS.HARD || labels[k] === CLS.BED)) {
          seen[k] = 1;
          q.push(k);
        }
      }
    }
    const areaSqft = comp.length * sqftPx;
    const fill = comp.length / ((x1 - x0 + 1) * (y1 - y0 + 1));
    // Away from the lot line, or crossing it only a little (a lot line drawn through the eaves; an assumed lot).
    const away = touches <= 2;
    const compact = areaSqft >= 1000 && fill >= 0.6 && areaSqft <= 9000 && touches <= Math.sqrt(comp.length) * 0.3;
    if (areaSqft >= 400 && fill >= 0.45 && (away || compact)) {
      for (const p of comp) labels[p] = CLS.BUILDING;
      marked += comp.length;
    }
  }
  return marked;
}

/** Slope from bare-earth elevations sampled on a grid over the lawn (feet; `step` ft apart, row-major, NaN = none). */
export function slopeBands(elev: number[] | null, cols: number, rows: number, stepFt: number): SlopeBands {
  if (!elev || !elev.length) return { flat: 1, moderate: 0, steep: 0, tooSteep: 0, samples: 0, source: "none" };
  let flat = 0;
  let moderate = 0;
  let steep = 0;
  let tooSteep = 0;
  let n = 0;
  for (let y = 0; y + 1 < rows; y++)
    for (let x = 0; x + 1 < cols; x++) {
      const z = elev[y * cols + x];
      const zx = elev[y * cols + x + 1];
      const zy = elev[(y + 1) * cols + x];
      if (![z, zx, zy].every(Number.isFinite)) continue;
      const s = Math.hypot((zx - z) / stepFt, (zy - z) / stepFt) * 100;
      n++;
      if (s < 10) flat++;
      else if (s < 20) moderate++;
      else steep++;
      if (s > 33) tooSteep++;
    }
  if (!n) return { flat: 1, moderate: 0, steep: 0, tooSteep: 0, samples: 0, source: "none" };
  return { flat: flat / n, moderate: moderate / n, steep: steep / n, tooSteep: tooSteep / n, samples: n, source: "lidar" };
}

export type MeasureInput = {
  grid: Grid;
  labels: Uint8Array;
  lot: Uint8Array;
  /** The lot ring in pixels (for the street side); null with no parcel. */
  lotRing: Pt[] | null;
  slope?: SlopeBands | null;
  /** For the confidence line. */
  photo: { date: string | null; gsdM: number };
  parcel: boolean;
  footprints: boolean;
  canopyMap: boolean;
};

export function measureYard(inp: MeasureInput): YardMeasures {
  const { grid: g, labels, lot } = inp;
  const { w, h } = g;
  const fpp = ftPerPx(g);
  const sqftPx = fpp * fpp;
  // Inside the lot only; the rest is OUT for the counts (the street was read already).
  const L = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = lot[i] ? labels[i] : CLS.OUT;
  const count = (c: number) => {
    let n = 0;
    for (let i = 0; i < w * h; i++) if (L[i] === c) n++;
    return n * sqftPx;
  };
  let lotPx = 0;
  for (let i = 0; i < w * h; i++) if (lot[i]) lotPx++;

  // Front, back and sides: along the street edge's inward normal, before the house, past it, beside it.
  const frontEdge = inp.lotRing ? streetEdge(inp.lotRing, labels, lot, g) : null;
  const byZone: Record<Zone, number> = { front: 0, back: 0, side: 0 };
  let nx = 0;
  let ny = 1;
  let ox = 0;
  let oy = 0;
  if (frontEdge != null && inp.lotRing) {
    const [a, b] = edge(inp.lotRing, frontEdge);
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    nx = -(b.y - a.y) / len;
    ny = (b.x - a.x) / len;
    ox = (a.x + b.x) / 2;
    oy = (a.y + b.y) / 2;
    // Point the normal into the lot.
    const tx = Math.floor(ox + nx * 3);
    const ty = Math.floor(oy + ny * 3);
    if (!(tx >= 0 && ty >= 0 && tx < w && ty < h && lot[ty * w + tx])) {
      nx = -nx;
      ny = -ny;
    }
  }
  let tMin = Infinity;
  let tMax = -Infinity;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (L[y * w + x] === CLS.BUILDING) {
        const t = (x + 0.5 - ox) * nx + (y + 0.5 - oy) * ny;
        tMin = Math.min(tMin, t);
        tMax = Math.max(tMax, t);
      }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (L[y * w + x] !== CLS.LAWN) continue;
      if (frontEdge == null || !Number.isFinite(tMin)) {
        byZone.front += sqftPx;
        continue;
      }
      const t = (x + 0.5 - ox) * nx + (y + 0.5 - oy) * ny;
      byZone[t < tMin ? "front" : t > tMax ? "back" : "side"] += sqftPx;
    }

  // Trees in the lawn: crowns mostly ringed by lawn.
  const treeOut = outlinesOf(L, w, h, CLS.TREE, Math.ceil(10 / sqftPx));
  let treesInLawn = 0;
  let canopyOverLawnPx = 0;
  for (const o of treeOut) {
    if (o.hole) continue;
    const ring = edgeNeighbours([o], L, w, h, CLS.TREE);
    const total = [...ring.values()].reduce((s, v) => s + v, 0) || 1;
    const lawnShare = (ring.get(CLS.LAWN) ?? 0) / total;
    if (lawnShare >= 0.6) {
      treesInLawn++;
      // Its crown's area (from the ring, approximate: the region's pixels are counted below).
      let a = 0;
      for (let i = 0, j = o.ring.length - 1; i < o.ring.length; j = i++) a += o.ring[j].x * o.ring[i].y - o.ring[i].x * o.ring[j].y;
      canopyOverLawnPx += Math.abs(a) / 2;
    }
  }

  // Edges of the lawn, by what's across them.
  const lawnOut = outlinesOf(L, w, h, CLS.LAWN, Math.ceil(12 / sqftPx));
  const e = edgeNeighbours(lawnOut, L, w, h, CLS.LAWN);
  const ft = (c: number) => (e.get(c) ?? 0) * fpp;
  const bedOut = outlinesOf(L, w, h, CLS.BED, Math.ceil(6 / sqftPx));
  const bedPerimeterFt = bedOut.reduce((s, o) => {
    let p = 0;
    for (let i = 0; i < o.ring.length; i++) {
      const a = o.ring[i];
      const b = o.ring[(i + 1) % o.ring.length];
      p += Math.hypot(b.x - a.x, b.y - a.y);
    }
    return s + p;
  }, 0) * fpp;

  const lawnSqft = count(CLS.LAWN);
  const treeSqft = count(CLS.TREE);
  // The trees that drop leaves in the yard: crowns within 30 ft of the lawn or a bed.
  const yardMask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) yardMask[i] = L[i] === CLS.LAWN || L[i] === CLS.BED ? 1 : 0;
  const nearYard = distanceTo(yardMask, w, h);
  let yardCanopyPx = 0;
  for (let i = 0; i < w * h; i++) if (L[i] === CLS.TREE && nearYard[i] * fpp <= 30) yardCanopyPx++;
  const bedSqft = count(CLS.BED);
  const slope = inp.slope ?? slopeBands(null, 0, 0, 1);
  return {
    lotSqft: round(lotPx * sqftPx),
    lawnSqft: round(lawnSqft),
    lawnByZone: { front: round(byZone.front), back: round(byZone.back), side: round(byZone.side) },
    bedSqft: round(bedSqft),
    treeCanopySqft: round(treeSqft),
    yardCanopySqft: round(yardCanopyPx * sqftPx),
    naturalSqft: round(count(CLS.NATURAL)),
    yardSqft: yardArea(L, lot, g).sqft,
    canopyOverLawnSqft: round(canopyOverLawnPx * sqftPx),
    hardSqft: round(count(CLS.HARD)),
    houseSqft: round(count(CLS.BUILDING)),
    poolSqft: round(count(CLS.WATER)),
    treesInLawn,
    edges: { hardFt: round(ft(CLS.HARD)), bedFt: round(ft(CLS.BED)), houseFt: round(ft(CLS.BUILDING)), treeFt: round(ft(CLS.TREE)), lotLineFt: round(ft(CLS.OUT) + ft(CLS.NATURAL)) },
    bedPerimeterFt: round(bedPerimeterFt),
    slope,
    frontEdge,
    confidence: confidenceOf({ ...inp, lawnSqft, canopySqft: yardCanopyPx * sqftPx, groundSqft: lawnSqft + bedSqft + yardCanopyPx * sqftPx }),
  };
}

/** How far the numbers can be trusted — green, amber or red, and why. */
/** `canopySqft` over `groundSqft` is the share of the yard under trees (its crowns, over the yard and the yard with
 *  them — the woods beyond it aren't measured, so they don't count against it). */
export function confidenceOf(inp: Pick<MeasureInput, "photo" | "parcel" | "footprints" | "canopyMap"> & { lawnSqft: number; canopySqft: number; groundSqft: number; now?: Date }): Confidence {
  const reasons: string[] = [];
  let score = 100;
  const now = inp.now ?? new Date();
  if (!inp.parcel) {
    score -= 30;
    reasons.push("No lot lines found — drag the lot's corners to the property line");
  }
  if (inp.photo.date) {
    const years = (now.getTime() - new Date(inp.photo.date).getTime()) / (365.25 * 24 * 3600 * 1000);
    if (years > 3) {
      score -= 20;
      reasons.push(`The aerial photo is ${Math.floor(years)} years old — check for changes since`);
    } else if (years > 1.5) {
      score -= 8;
      reasons.push(`Aerial photo from ${new Date(inp.photo.date).toLocaleDateString("en-US", { month: "long", year: "numeric" })}`);
    }
    const m = new Date(inp.photo.date).getUTCMonth();
    if (m <= 1 || m === 11) {
      score -= 12;
      reasons.push("Photographed in winter — dormant grass reads as bare ground");
    }
  } else {
    score -= 25;
    reasons.push("No aerial photo here");
  }
  if (inp.photo.gsdM > 0.45) {
    score -= 10;
    reasons.push(`A ${Math.round(inp.photo.gsdM * 100)} cm photo — small beds and edges are approximate`);
  }
  const canopyShare = inp.groundSqft ? inp.canopySqft / inp.groundSqft : 0;
  if (canopyShare > 0.35) {
    score -= 25;
    reasons.push(`Trees stand over ${Math.round(canopyShare * 100)}% of the yard — lawn under them is a guess`);
  } else if (canopyShare > 0.2) {
    score -= 10;
    reasons.push(`Trees stand over ${Math.round(canopyShare * 100)}% of the yard`);
  }
  if (!inp.footprints) {
    score -= 8;
    reasons.push("House outline read from the photo, not the county's records");
  }
  if (!inp.canopyMap) {
    score -= 8;
    reasons.push("No tree-height map here — trees told apart by texture only");
  }
  if (inp.lawnSqft < 200) {
    score -= 15;
    reasons.push("Very little lawn found — paint it in where there is some");
  }
  score = Math.max(0, Math.min(100, score));
  return { level: score >= 75 ? "green" : score >= 50 ? "amber" : "red", score, reasons };
}
