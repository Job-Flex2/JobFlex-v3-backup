// READING THE YARD FROM THE AIR (2026-10-18). The USDA's aerial photo (NAIP: red, green, blue AND near-infrared, 30–60
// cm a pixel) sorted pixel by pixel into what a landscaper services: lawn, trees, beds (mulch, soil, rock, shrubs), hard
// surfaces, the house, a pool. Living plants reflect near-infrared strongly and red weakly, so the vegetation index
// (NDVI) finds the green; what the green is comes from its height (the Meta/WRI 1 m canopy-height map — a tree crown
// stands 2.5 m and up) and its texture (a mown lawn is smooth; shrubs and crowns are rough and shaded). A shadow takes
// the class of what it falls on. Thresholds adapt to each photo (Otsu), since every state's flight is exposed
// differently. The contractor corrects the result with a brush — this is the first draft, never the last word. Pure.

export const CLS = { OUT: 0, LAWN: 1, TREE: 2, BED: 3, HARD: 4, BUILDING: 5, WATER: 6, SHADOW: 7 } as const;
export type ClassId = (typeof CLS)[keyof typeof CLS];
export const CLASS_NAME: Record<number, string> = { 0: "Outside the lot", 1: "Lawn", 2: "Trees", 3: "Beds", 4: "Hard surfaces", 5: "House", 6: "Pool & water", 7: "Shadow" };

export type Raster = {
  w: number;
  h: number;
  /** Ground metres a pixel. */
  gsdM: number;
  /** Interleaved R, G, B — w·h·3 bytes. */
  rgb: Uint8Array;
  /** Near-infrared — w·h bytes. */
  nir: Uint8Array;
  /** Canopy height, metres, on the same grid (null where the map has none). */
  chm?: Float32Array | null;
};

export type ClassifyInput = {
  raster: Raster;
  /** 1 where the lot is (the parcel); the yard is classified inside it, the street side read just outside. */
  lot: Uint8Array;
  /** 1 on the house and other buildings, from the assessor's footprints. */
  buildings?: Uint8Array | null;
};

export type ClassifyResult = {
  /** One class a pixel, the whole grid (outside the lot too — the street is read there). */
  labels: Uint8Array;
  /** What the thresholds came out at, for the confidence line and the QA. */
  stats: { vegT: number; texT: number; shadowT: number; canopy: boolean; meanNdviLawn: number };
};

function otsu(vals: ArrayLike<number>, lo: number, hi: number, bins = 128): number {
  const h = new Float64Array(bins);
  let n = 0;
  for (let i = 0; i < vals.length; i++) {
    const v = vals[i];
    if (!Number.isFinite(v)) continue;
    h[Math.max(0, Math.min(bins - 1, Math.floor(((v - lo) / (hi - lo)) * bins)))]++;
    n++;
  }
  if (!n) return (lo + hi) / 2;
  let sum = 0;
  for (let i = 0; i < bins; i++) sum += i * h[i];
  let sB = 0;
  let wB = 0;
  let best = -1;
  let t = bins / 2;
  for (let i = 0; i < bins; i++) {
    wB += h[i];
    if (!wB) continue;
    const wF = n - wB;
    if (!wF) break;
    sB += i * h[i];
    const between = wB * wF * (sB / wB - (sum - sB) / wF) ** 2;
    if (between > best) {
      best = between;
      t = i;
    }
  }
  return lo + ((t + 0.5) / bins) * (hi - lo);
}

function percentile(vals: number[], p: number): number {
  if (!vals.length) return 0;
  const s = [...vals].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))];
}

/** Standard deviation of a band in a (2r+1)² window, by integral images — among the pixels `mask` keeps only, so a
 *  lawn's edge against a driveway or a roof isn't "rough" because the window reaches across it. */
function localStd(v: Uint8Array, w: number, h: number, r: number, mask: Uint8Array): Float32Array {
  const W = w + 1;
  const S = new Float64Array(W * (h + 1));
  const S2 = new Float64Array(W * (h + 1));
  const C = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const on = mask[i] ? 1 : 0;
      const a = v[i] * on;
      const k = (y + 1) * W + x + 1;
      S[k] = a + S[k - 1] + S[k - W] - S[k - W - 1];
      S2[k] = a * a + S2[k - 1] + S2[k - W] - S2[k - W - 1];
      C[k] = on + C[k - 1] + C[k - W] - C[k - W - 1];
    }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const y0 = Math.max(0, y - r);
      const y1 = Math.min(h, y + r + 1);
      const n = C[y1 * W + x1] - C[y0 * W + x1] - C[y1 * W + x0] + C[y0 * W + x0];
      if (n < 3) continue;
      const s = S[y1 * W + x1] - S[y0 * W + x1] - S[y1 * W + x0] + S[y0 * W + x0];
      const s2 = S2[y1 * W + x1] - S2[y0 * W + x1] - S2[y1 * W + x0] + S2[y0 * W + x0];
      out[y * w + x] = Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2));
    }
  return out;
}

/** Each pixel to the commonest class among its 8 neighbours and itself (ties keep the pixel's own). */
export function majority(labels: Uint8Array, w: number, h: number, keep?: (c: number) => boolean): Uint8Array {
  const out = new Uint8Array(labels);
  const cnt = new Uint8Array(8);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const own = labels[y * w + x];
      if (keep?.(own)) continue;
      cnt.fill(0);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h) cnt[labels[yy * w + xx]]++;
        }
      let best = own;
      for (let k = 1; k < 8; k++) if (cnt[k] > cnt[best] && !keep?.(k)) best = k;
      out[y * w + x] = best;
    }
  return out;
}

/** A class's speckles (connected pieces under `minPx`) take the class most around them. */
export function despeckle(labels: Uint8Array, w: number, h: number, cls: number, minPx: number): void {
  const seen = new Uint8Array(w * h);
  const q: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (seen[i] || labels[i] !== cls) continue;
    const comp: number[] = [];
    q.length = 0;
    q.push(i);
    seen[i] = 1;
    const around = new Map<number, number>();
    while (q.length) {
      const p = q.pop()!;
      comp.push(p);
      const x = p % w;
      const y = (p - x) / w;
      for (const [xx, yy] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const k = yy * w + xx;
        if (labels[k] === cls) {
          if (!seen[k]) {
            seen[k] = 1;
            q.push(k);
          }
        } else around.set(labels[k], (around.get(labels[k]) ?? 0) + 1);
      }
    }
    if (comp.length >= minPx || !around.size) continue;
    const to = [...around.entries()].sort((a, b) => b[1] - a[1])[0][0];
    for (const p of comp) labels[p] = to;
  }
}

/** A class's thin strips — pieces nowhere thicker than `maxHalf` pixels from their edge — given to what's around them.
 *  Where a lawn meets a walk, the pixel on the line is half grass, half concrete: neither green nor grey, it reads as
 *  soil. A real bed is a few feet wide; a rim is a pixel or two. */
export function dropThin(labels: Uint8Array, w: number, h: number, cls: number, maxHalf = 1): void {
  const N = w * h;
  const dist = new Uint16Array(N);
  // Two-pass city-block distance to the nearest pixel that isn't `cls`.
  const BIG = 65535;
  for (let i = 0; i < N; i++) dist[i] = labels[i] === cls ? BIG : 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!dist[i]) continue;
      const up = y > 0 ? dist[i - w] : 0;
      const left = x > 0 ? dist[i - 1] : 0;
      dist[i] = Math.min(dist[i], up + 1, left + 1);
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!dist[i]) continue;
      const down = y < h - 1 ? dist[i + w] : 0;
      const right = x < w - 1 ? dist[i + 1] : 0;
      dist[i] = Math.min(dist[i], down + 1, right + 1);
    }
  const seen = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (seen[i] || labels[i] !== cls) continue;
    const comp: number[] = [];
    const q = [i];
    seen[i] = 1;
    let deepest = 0;
    while (q.length) {
      const p = q.pop()!;
      comp.push(p);
      deepest = Math.max(deepest, dist[p]);
      const x = p % w;
      const y = (p - x) / w;
      for (const [xx, yy] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const k = yy * w + xx;
        if (!seen[k] && labels[k] === cls) {
          seen[k] = 1;
          q.push(k);
        }
      }
    }
    if (deepest > maxHalf) continue;
    // From the outside in: each strip pixel takes the commonest non-strip class among its 8 neighbours.
    const left = new Set(comp);
    for (let pass = 0; pass < 4 && left.size; pass++)
      for (const p of [...left]) {
        const x = p % w;
        const y = (p - x) / w;
        const cnt = new Map<number, number>();
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if ((!dx && !dy) || xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            const k = yy * w + xx;
            if (left.has(k)) continue;
            const c = labels[k];
            if (c !== cls) cnt.set(c, (cnt.get(c) ?? 0) + 1);
          }
        if (!cnt.size) continue;
        labels[p] = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0][0];
        left.delete(p);
      }
  }
}

export function classify({ raster, lot, buildings }: ClassifyInput): ClassifyResult {
  const { w, h, gsdM, rgb, nir, chm } = raster;
  const N = w * h;
  const ndvi = new Float32Array(N);
  const br = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const r = rgb[i * 3];
    const g = rgb[i * 3 + 1];
    const b = rgb[i * 3 + 2];
    ndvi[i] = (nir[i] - r) / (nir[i] + r + 1e-6);
    br[i] = (r + g + b) / 3;
  }
  // Thresholds from the lot and a ring around it (the photo's own exposure), not the whole crop.
  const sample: number[] = [];
  const brSample: number[] = [];
  for (let i = 0; i < N; i += 2) {
    if (!lot[i]) continue;
    sample.push(ndvi[i]);
    brSample.push(br[i]);
  }
  const vegT = Math.max(0.06, Math.min(0.3, otsu(sample.length > 200 ? sample : Array.from(ndvi), -0.4, 0.8)));
  const shadowT = Math.max(32, Math.min(62, percentile(brSample.length ? brSample : Array.from(br), 0.06) + 6));
  // Roughness among low plants only: a tree is told by its height, and a lawn's edge against a crown isn't rough.
  const veg = new Uint8Array(N);
  for (let i = 0; i < N; i++) veg[i] = ndvi[i] > vegT && !(chm && chm[i] >= 2.5) ? 1 : 0;
  const std = localStd(nir, w, h, Math.max(1, Math.round(1 / gsdM)), veg);
  const vegStd: number[] = [];
  for (let i = 0; i < N; i += 2) if (ndvi[i] > vegT && lot[i]) vegStd.push(std[i]);
  const texT = vegStd.length > 100 ? Math.max(9, Math.min(30, otsu(vegStd, 0, 60))) : 16;
  const canopy = !!chm && chm.some((v) => v >= 2.5);

  const L = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const r = rgb[i * 3];
    const g = rgb[i * 3 + 1];
    const b = rgb[i * 3 + 2];
    const tall = !!chm && chm[i] >= 2.5;
    if (buildings?.[i]) L[i] = CLS.BUILDING;
    else if (b > r + 25 && g > r && br[i] > 70 && ndvi[i] < 0.05) L[i] = CLS.WATER;
    else if (br[i] < shadowT && ndvi[i] < vegT + 0.2) L[i] = tall ? CLS.TREE : CLS.SHADOW;
    else if (ndvi[i] > vegT) {
      if (tall) L[i] = CLS.TREE;
      // Rough, low and not mown: shrubs and planting — a bed. Rough and dark with no height on the map: a young tree.
      else if (std[i] > texT * 1.35) L[i] = br[i] < 70 ? CLS.TREE : CLS.BED;
      else L[i] = CLS.LAWN;
    } else {
      const sat = Math.max(r, g, b) - Math.min(r, g, b);
      // Mulch, soil, decomposed granite and rock: warm and earth-coloured (red ≥ green ≥ blue), not grey.
      L[i] = sat > 22 && r >= g - 4 && g >= b - 6 && ndvi[i] > -0.08 ? CLS.BED : CLS.HARD;
    }
  }
  // A shadow is what it falls on: grown in from its non-shadow neighbours.
  for (let pass = 0; pass < 40; pass++) {
    let left = 0;
    const next = new Uint8Array(L);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (L[i] !== CLS.SHADOW) continue;
        const cnt = new Map<number, number>();
        for (const [xx, yy] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const c = L[yy * w + xx];
          if (c !== CLS.SHADOW && c !== CLS.BUILDING && c !== CLS.WATER) cnt.set(c, (cnt.get(c) ?? 0) + 1);
        }
        if (cnt.size) next[i] = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0][0];
        else left++;
      }
    L.set(next);
    if (!left) break;
  }
  for (let i = 0; i < N; i++) if (L[i] === CLS.SHADOW) L[i] = CLS.HARD;
  // A crown's shaded rim: no green to speak of, but standing over a metre of mapped tree height — the tree's edge.
  if (chm) for (let i = 0; i < N; i++) if (L[i] === CLS.BED && chm[i] >= 1.2) L[i] = CLS.TREE;
  // Calm the speckle; the house keeps its outline.
  let out = majority(L, w, h, (c) => c === CLS.BUILDING);
  out = majority(out, w, h, (c) => c === CLS.BUILDING);
  const sqftPx = (gsdM * 3.280839895) ** 2;
  dropThin(out, w, h, CLS.BED, Math.max(1, Math.round(0.45 / gsdM)));
  despeckle(out, w, h, CLS.LAWN, Math.ceil(12 / sqftPx));
  despeckle(out, w, h, CLS.BED, Math.ceil(6 / sqftPx));
  despeckle(out, w, h, CLS.HARD, Math.ceil(6 / sqftPx));
  despeckle(out, w, h, CLS.TREE, Math.ceil(10 / sqftPx));
  let nd = 0;
  let nl = 0;
  for (let i = 0; i < N; i++)
    if (out[i] === CLS.LAWN && lot[i]) {
      nd += ndvi[i];
      nl++;
    }
  return { labels: out, stats: { vegT, texT, shadowT, canopy, meanNdviLawn: nl ? nd / nl : 0 } };
}
