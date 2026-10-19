// THE LAWN ESTIMATOR'S GEOMETRY (2026-10-18). Everything a property is measured in: Web Mercator for the aerial
// photo's pixels, local FEET around the property for areas and lengths (x east, y SOUTH — the photo's own axes, so a
// pixel row and a foot row run the same way). Pure, browser-safe.

export type LatLng = { lat: number; lng: number };
export type Pt = { x: number; y: number };
/** A Web Mercator box, metres: west, south, east, north. */
export type MercBox = [number, number, number, number];

const R = 6378137;
export const M_TO_FT = 3.280839895;
export const SQM_TO_SQFT = M_TO_FT * M_TO_FT;

export const toMerc = (p: LatLng): Pt => ({ x: (p.lng * Math.PI * R) / 180, y: R * Math.log(Math.tan(Math.PI / 4 + (p.lat * Math.PI) / 360)) });
export const fromMerc = (p: Pt): LatLng => ({ lng: (p.x / R) * (180 / Math.PI), lat: (2 * Math.atan(Math.exp(p.y / R)) - Math.PI / 2) * (180 / Math.PI) });
/** Mercator stretches ground distances by 1 / cos(latitude): metres on the ground per Mercator metre. */
export const mercScale = (lat: number) => Math.cos((lat * Math.PI) / 180);

/** A square box of `halfM` ground metres around a point, in Mercator metres. */
export function boxAround(p: LatLng, halfM: number): MercBox {
  const c = toMerc(p);
  const h = halfM / mercScale(p.lat);
  return [c.x - h, c.y - h, c.x + h, c.y + h];
}

/** A box around rings (lat/lng), grown by `padM` ground metres. */
export function boxOfRings(rings: LatLng[][], padM: number, lat: number): MercBox {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rings)
    for (const p of r) {
      const m = toMerc(p);
      x0 = Math.min(x0, m.x);
      y0 = Math.min(y0, m.y);
      x1 = Math.max(x1, m.x);
      y1 = Math.max(y1, m.y);
    }
  const pad = padM / mercScale(lat);
  return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
}

/** The grid a photo is read on: its box, its size in pixels, and its ground resolution. */
export type Grid = { box: MercBox; w: number; h: number; /** Ground metres per pixel. */ gsdM: number; lat: number };

export function gridFor(box: MercBox, gsdM: number, lat: number, maxPx = 1400): Grid {
  const k = mercScale(lat);
  const wM = (box[2] - box[0]) * k;
  const hM = (box[3] - box[1]) * k;
  let g = gsdM;
  if (Math.max(wM, hM) / g > maxPx) g = Math.max(wM, hM) / maxPx;
  return { box, w: Math.max(8, Math.round(wM / g)), h: Math.max(8, Math.round(hM / g)), gsdM: g, lat };
}

/** A lat/lng → the grid's pixel coordinates (fractional; x right, y down). */
export function toPx(g: Grid, p: LatLng): Pt {
  const m = toMerc(p);
  return { x: ((m.x - g.box[0]) / (g.box[2] - g.box[0])) * g.w, y: ((g.box[3] - m.y) / (g.box[3] - g.box[1])) * g.h };
}
export function fromPx(g: Grid, p: Pt): LatLng {
  return fromMerc({ x: g.box[0] + (p.x / g.w) * (g.box[2] - g.box[0]), y: g.box[3] - (p.y / g.h) * (g.box[3] - g.box[1]) });
}
/** Feet per pixel on the ground. */
export const ftPerPx = (g: Grid) => g.gsdM * M_TO_FT;

/** Shoelace area of a ring (any units; positive). */
export function ringArea(r: Pt[]): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j].x + r[i].x) * (r[j].y - r[i].y);
  return Math.abs(a) / 2;
}
export function ringPerimeter(r: Pt[]): number {
  let s = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += Math.hypot(r[i].x - r[j].x, r[i].y - r[j].y);
  return s;
}
export function pointInRing(p: Pt, r: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i];
    const b = r[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Rasterize rings onto a w×h mask (1 inside), scanline even-odd — the lot, a house. */
export function fillRings(w: number, h: number, rings: Pt[][], into?: Uint8Array, value = 1): Uint8Array {
  const m = into ?? new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const cy = y + 0.5;
    const xs: number[] = [];
    for (const r of rings)
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const a = r[i];
        const b = r[j];
        if (a.y > cy !== b.y > cy) xs.push(a.x + ((cy - a.y) * (b.x - a.x)) / (b.y - a.y));
      }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.ceil(xs[k] - 0.5));
      const x1 = Math.min(w - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = x0; x <= x1; x++) m[y * w + x] = value;
    }
  }
  return m;
}

/** Distance from every pixel to the nearest `on` pixel, in pixels (chamfer 3-4, within 8% of true distance). Infinity
 *  everywhere when nothing is on. */
export function distanceTo(on: Uint8Array, w: number, h: number): Float32Array {
  const N = w * h;
  const BIG = 1e9;
  const d = new Float32Array(N);
  let any = false;
  for (let i = 0; i < N; i++) {
    d[i] = on[i] ? 0 : BIG;
    if (on[i]) any = true;
  }
  if (!any) return d.fill(Infinity);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + 3);
      if (y > 0) {
        v = Math.min(v, d[i - w] + 3);
        if (x > 0) v = Math.min(v, d[i - w - 1] + 4);
        if (x < w - 1) v = Math.min(v, d[i - w + 1] + 4);
      }
      d[i] = v;
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = d[i];
      if (x < w - 1) v = Math.min(v, d[i + 1] + 3);
      if (y < h - 1) {
        v = Math.min(v, d[i + w] + 3);
        if (x < w - 1) v = Math.min(v, d[i + w + 1] + 4);
        if (x > 0) v = Math.min(v, d[i + w - 1] + 4);
      }
      d[i] = v;
    }
  for (let i = 0; i < N; i++) d[i] /= 3;
  return d;
}

/** Douglas–Peucker on an open or closed path. */
export function simplify(path: Pt[], tol: number): Pt[] {
  if (path.length < 4) return path;
  const keep = new Uint8Array(path.length);
  keep[0] = keep[path.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, path.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const A = path[a];
    const B = path[b];
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const L = Math.hypot(dx, dy) || 1e-9;
    let best = -1;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((path[i].x - A.x) * dy - (path[i].y - A.y) * dx) / L;
      if (d > best) {
        best = d;
        at = i;
      }
    }
    if (best > tol && at > 0) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return path.filter((_, i) => keep[i]);
}
