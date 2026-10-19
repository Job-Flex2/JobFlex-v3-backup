// THE CONTRACTOR'S OWN OUTLINES (2026-10-19 — owner, after the photo reading on a wooded lot: "no good, let's just have
// a good pic and the contractor can draw lines and get the sq ft to cut — make it smart"). The yard is what the
// contractor draws on the aerial: lawns, beds, and cut-outs (a patio, a garden, a play area inside a lawn — not mowed).
// The areas are the shapes' own, to the square foot; a bed or cut-out drawn inside a lawn comes off it. What the
// edges run along — the drive, the house, a bed, the trees, the fence — is still read from the USDA photo under them,
// so edging and trimming are counted for each shape as drawn. Suggestions (the photo's own reading, outlined) and the
// one-tap outline of a single piece are starting points to adjust, never the measure. Pure, browser-safe.
import type { LatLng, Pt } from "./geo";
import { fillRings, fromMerc, fromPx, M_TO_FT, mercScale, toMerc, toPx } from "./geo";
import { CLS } from "./classify";
import { smoothLoop, signedArea, traceLoops } from "./vectorize";
import { zoneFrame, type YardMeasures, type Zone } from "./measure";
import { decodeLabels, gridOf, lotMaskOf, measureSite, type LawnSite } from "./site";
import { yardArea } from "./yard";

export type ShapeKind = "lawn" | "bed" | "cut";
export type LawnShape = {
  id: string;
  kind: ShapeKind;
  /** "Front lawn", "Back bed 2" — named for where it lies; the contractor can rename it. */
  name: string;
  ring: LatLng[];
};

export const KIND_WORD: Record<ShapeKind, string> = { lawn: "Lawn", bed: "Bed", cut: "Not mowed" };
export const MAX_SHAPES = 120;
export const MAX_POINTS = 600;

/** A ring in local feet (x east, y north) about its first point — Web Mercator scaled to the ground at that latitude. */
function feetOf(ring: LatLng[]): Pt[] {
  if (!ring.length) return [];
  const o = toMerc(ring[0]);
  const k = mercScale(ring[0].lat) * M_TO_FT;
  return ring.map((p) => {
    const m = toMerc(p);
    return { x: (m.x - o.x) * k, y: (m.y - o.y) * k };
  });
}

/** A ring's area, square feet. */
export function ringSqft(ring: LatLng[]): number {
  const r = feetOf(ring);
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j].x + r[i].x) * (r[j].y - r[i].y);
  return Math.abs(a) / 2;
}

/** A path's length, feet (closed: back to the first point). */
export function pathFt(ring: LatLng[], closed = true): number {
  const r = feetOf(ring);
  let s = 0;
  for (let i = 1; i < r.length; i++) s += Math.hypot(r[i].x - r[i - 1].x, r[i].y - r[i - 1].y);
  if (closed && r.length > 2) s += Math.hypot(r[0].x - r[r.length - 1].x, r[0].y - r[r.length - 1].y);
  return s;
}

/** Where a shape's label goes: the point inside it farthest from its edge (a grid search, refined once), so a bent
 *  lawn's label sits on the lawn, not in the bend. */
export function labelPoint(ring: LatLng[], holes: LatLng[][] = []): LatLng {
  if (ring.length < 3) return ring[0] ?? { lat: 0, lng: 0 };
  const r = feetOf(ring);
  // Shapes inside it (a bed in a lawn) are kept clear of, like its own edge.
  const hs = holes.filter((x) => x.length >= 3).map((x) => feetAbout(ring[0], x));
  const inside = (x: number, y: number) => inPoly({ x, y }, r) && !hs.some((hr) => inPoly({ x, y }, hr));
  const edgeDist = (x: number, y: number) => {
    let best = Infinity;
    for (const rr of [r, ...hs])
      for (let i = 0, j = rr.length - 1; i < rr.length; j = i++) {
        const ax = rr[j].x;
        const ay = rr[j].y;
        const dx = rr[i].x - ax;
        const dy = rr[i].y - ay;
        const L = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L));
        best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
      }
    return best;
  };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of r) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  let best = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, d: -1 };
  const search = (cx0: number, cy0: number, cx1: number, cy1: number, n: number) => {
    for (let i = 0; i <= n; i++)
      for (let j = 0; j <= n; j++) {
        const x = cx0 + ((cx1 - cx0) * i) / n;
        const y = cy0 + ((cy1 - cy0) * j) / n;
        if (!inside(x, y)) continue;
        const d = edgeDist(x, y);
        if (d > best.d) best = { x, y, d };
      }
  };
  search(x0, y0, x1, y1, 18);
  if (best.d > 0) {
    const sx = (x1 - x0) / 18;
    const sy = (y1 - y0) / 18;
    search(best.x - sx, best.y - sy, best.x + sx, best.y + sy, 8);
  }
  // Back to lat/lng from local feet about the first point.
  const o = toMerc(ring[0]);
  const k = mercScale(ring[0].lat) * M_TO_FT;
  return fromMerc({ x: o.x + best.x / k, y: o.y + best.y / k });
}

/** Each shape filled onto the site's grid (pixels whose centres fall inside). */
function rasterOf(site: LawnSite, ring: LatLng[]): Uint8Array {
  const g = gridOf(site);
  return fillRings(g.w, g.h, [ring.map((p) => toPx(g, p))]);
}

export type ShapeAreas = {
  /** Lawn to mow: the lawn shapes, less whatever beds and cut-outs lie in them and any overlap between lawns. */
  lawnSqft: number;
  bedSqft: number;
  /** Each shape as drawn — its area, its edge length — and, for a lawn, what's left to mow once the beds and cut-outs
   *  in it come off (`net`). */
  each: Record<string, { sqft: number; ft: number; net: number }>;
};

/** Points in local feet about one origin, for comparing shapes with each other. */
function feetAbout(o: LatLng, ring: LatLng[]): Pt[] {
  const m0 = toMerc(o);
  const k = mercScale(o.lat) * M_TO_FT;
  return ring.map((p) => {
    const m = toMerc(p);
    return { x: (m.x - m0.x) * k, y: (m.y - m0.y) * k };
  });
}
function inPoly(p: Pt, r: Pt[]): boolean {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) if (r[i].y > p.y !== r[j].y > p.y && p.x < ((r[j].x - r[i].x) * (p.y - r[i].y)) / (r[j].y - r[i].y) + r[i].x) c = !c;
  return c;
}
/** Inside, or on the edge to half a foot — a corner snapped onto another shape's edge is on it, not out of it. */
function inOrOn(p: Pt, r: Pt[]): boolean {
  if (inPoly(p, r)) return true;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const dx = r[i].x - r[j].x;
    const dy = r[i].y - r[j].y;
    const L = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - r[j].x) * dx + (p.y - r[j].y) * dy) / L));
    if (Math.hypot(p.x - r[j].x - t * dx, p.y - r[j].y - t * dy) <= 0.5) return true;
  }
  return false;
}
function crosses(a: Pt[], b: Pt[]): boolean {
  const side = (p: Pt, q: Pt, r: Pt) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  for (let i = 0; i < a.length; i++) {
    const p1 = a[i];
    const p2 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) {
      const q1 = b[j];
      const q2 = b[(j + 1) % b.length];
      const d1 = side(q1, q2, p1);
      const d2 = side(q1, q2, p2);
      const d3 = side(p1, p2, q1);
      const d4 = side(p1, p2, q2);
      if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
    }
  }
  return false;
}

/** The areas from the shapes: each one's own exactly. Where one lies wholly inside another (a bed in a lawn — the
 *  usual case) the overlap is its whole area, exactly; shapes that cross each other overlap by the grid's pixels
 *  where they meet. */
export function shapeAreas(site: LawnSite, shapes: LawnShape[]): ShapeAreas {
  const g = gridOf(site);
  const sqftPx = (g.gsdM * M_TO_FT) ** 2;
  const live = shapes.filter((x) => x.ring.length >= 3);
  const each: ShapeAreas["each"] = {};
  if (!live.length) return { lawnSqft: 0, bedSqft: 0, each };
  const o = live[0].ring[0];
  const ft = live.map((x) => feetAbout(o, x.ring));
  const area = live.map((x) => ringSqft(x.ring));
  const box = ft.map((r) => r.reduce((b, p) => [Math.min(b[0], p.x), Math.min(b[1], p.y), Math.max(b[2], p.x), Math.max(b[3], p.y)], [Infinity, Infinity, -Infinity, -Infinity]));
  const masks = new Map<number, Uint8Array>();
  const mask = (i: number) => {
    let m = masks.get(i);
    if (!m) {
      m = rasterOf(site, live[i].ring);
      masks.set(i, m);
    }
    return m;
  };
  /** How much of shape `i` shape `j` covers, sq ft. */
  const overlap = (i: number, j: number): number => {
    const a = box[i];
    const b = box[j];
    if (a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1]) return 0;
    const crossing = crosses(ft[i], ft[j]);
    if (!crossing && ft[j].every((p) => inOrOn(p, ft[i]))) return area[j];
    if (!crossing && ft[i].every((p) => inOrOn(p, ft[j]))) return area[i];
    if (!crossing) return 0;
    const mi = mask(i);
    const mj = mask(j);
    let n = 0;
    for (let k = 0; k < mi.length; k++) if (mi[k] && mj[k]) n++;
    return n * sqftPx;
  };
  let lawn = 0;
  let bed = 0;
  live.forEach((x, i) => {
    let net = area[i];
    if (x.kind === "lawn") {
      for (let j = 0; j < live.length; j++) {
        if (j === i) continue;
        // Beds and cut-outs come off; a lawn drawn over another counts once (the earlier one keeps the overlap).
        if (live[j].kind !== "lawn" || j < i) net -= overlap(i, j);
      }
      net = Math.max(0, net);
      lawn += net;
    } else if (x.kind === "bed") {
      for (let j = 0; j < i; j++) if (live[j].kind === "bed") net -= overlap(i, j);
      net = Math.max(0, net);
      bed += net;
    }
    each[x.id] = { sqft: area[i], ft: pathFt(x.ring), net };
  });
  return { lawnSqft: Math.round(lawn), bedSqft: Math.round(bed), each };
}

/** The grid's classes as the shapes say: what isn't drawn as lawn or bed isn't serviced; lawn painted where drawn
 *  (trees in it stay trees — mowed round — and the house stays the house); beds over all of it; a cut-out keeps the
 *  paving or pool the photo shows there and is otherwise ground left alone. The photo's own classes (`base`, the yard
 *  as read) stay around the shapes, so the edges are named by what they meet. */
export function drawnLabels(site: LawnSite, base: Uint8Array, shapes: LawnShape[]): Uint8Array {
  const g = gridOf(site);
  const N = g.w * g.h;
  const read = base;
  const L = new Uint8Array(read);
  for (let i = 0; i < N; i++) if (L[i] === CLS.LAWN || L[i] === CLS.BED || L[i] === CLS.SHADOW) L[i] = CLS.NATURAL;
  const order: ShapeKind[] = ["lawn", "cut", "bed"];
  for (const kind of order)
    for (const s of shapes) {
      if (s.kind !== kind || s.ring.length < 3) continue;
      const m = rasterOf(site, s.ring);
      for (let i = 0; i < N; i++) {
        if (!m[i]) continue;
        if (kind === "lawn") {
          if (L[i] !== CLS.TREE && L[i] !== CLS.BUILDING) L[i] = CLS.LAWN;
        } else if (kind === "cut") {
          L[i] = read[i] === CLS.HARD || read[i] === CLS.WATER || read[i] === CLS.BUILDING || read[i] === CLS.TREE ? read[i] : CLS.NATURAL;
        } else L[i] = CLS.BED;
      }
    }
  return L;
}

/** The yard's numbers from the shapes: the edges, zones, trees and slope as the photo shows them along and inside the
 *  shapes, the areas the shapes' own. */
export function measureShapes(site: LawnSite, base: Uint8Array, shapes: LawnShape[]): { measures: YardMeasures; areas: ShapeAreas } {
  const m = measureSite(site, drawnLabels(site, base, shapes));
  const a = shapeAreas(site, shapes);
  const z = m.lawnByZone.front + m.lawnByZone.back + m.lawnByZone.side;
  const k = z > 0 ? a.lawnSqft / z : 0;
  const beds = shapes.filter((s) => s.kind === "bed");
  const measures: YardMeasures = {
    ...m,
    lawnSqft: a.lawnSqft,
    lawnByZone: z > 0 ? { front: Math.round(m.lawnByZone.front * k), back: Math.round(m.lawnByZone.back * k), side: Math.round(m.lawnByZone.side * k) } : { front: a.lawnSqft, back: 0, side: 0 },
    bedSqft: a.bedSqft,
    bedPerimeterFt: Math.round(beds.reduce((t, s) => t + (a.each[s.id]?.ft ?? 0), 0)),
    yardSqft: a.lawnSqft + a.bedSqft,
    naturalSqft: undefined,
  };
  return { measures, areas: a };
}

/** Where the map opens: on the yard the photo reads (60 ft round it, a fifth of its size at least) when that's well
 *  inside a big lot, else on the whole lot. */
export function startBounds(site: LawnSite, labels: Uint8Array): { south: number; west: number; north: number; east: number } {
  const g = gridOf(site);
  const { mask } = lotMaskOf(site);
  const lotBox = (() => {
    const lat = site.lot.ring.map((p) => p.lat);
    const lng = site.lot.ring.map((p) => p.lng);
    return { south: Math.min(...lat), north: Math.max(...lat), west: Math.min(...lng), east: Math.max(...lng) };
  })();
  const L = new Uint8Array(labels.length);
  for (let i = 0; i < L.length; i++) L[i] = mask[i] ? labels[i] : CLS.OUT;
  const area = yardArea(L, mask, g);
  if (!area.sqft || area.wholeLot) return lotBox;
  let x0 = g.w;
  let y0 = g.h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < g.h; y++)
    for (let x = 0; x < g.w; x++)
      if (area.mask[y * g.w + x]) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x + 1);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y + 1);
      }
  const pad = Math.max(60 / (g.gsdM * M_TO_FT), 0.2 * Math.max(x1 - x0, y1 - y0));
  const sw = fromPx(g, { x: Math.max(0, x0 - pad), y: Math.min(g.h, y1 + pad) });
  const ne = fromPx(g, { x: Math.min(g.w, x1 + pad), y: Math.max(0, y0 - pad) });
  // Most of the lot anyway: the lot.
  const yardArea2 = (ne.lat - sw.lat) * (ne.lng - sw.lng);
  const lotArea2 = (lotBox.north - lotBox.south) * (lotBox.east - lotBox.west);
  return yardArea2 > lotArea2 * 0.6 ? lotBox : { south: sw.lat, west: sw.lng, north: ne.lat, east: ne.lng };
}

/** Where a shape lies — front, back or side of the house — by the most of its pixels. */
export function zoneOfShape(site: LawnSite, ring: LatLng[], labels: Uint8Array): Zone {
  const g = gridOf(site);
  const { ring: lotRing, mask } = lotMaskOf(site);
  const zf = zoneFrame(lotRing, labels, mask, g);
  const m = rasterOf(site, ring);
  const n: Record<Zone, number> = { front: 0, back: 0, side: 0 };
  for (let i = 0; i < m.length; i++) if (m[i]) n[zf.zoneAt((i % g.w) + 0.5, Math.floor(i / g.w) + 0.5)]++;
  return n.back > n.front && n.back >= n.side ? "back" : n.side > n.front ? "side" : "front";
}

/** A name for a new shape: "Front lawn", "Back bed", "Not mowed" — numbered when the name is taken. */
export function nameFor(kind: ShapeKind, zone: Zone, taken: string[]): string {
  const base = kind === "cut" ? "Not mowed" : `${zone[0].toUpperCase()}${zone.slice(1)} ${kind}`;
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n++) if (!taken.includes(`${base} ${n}`)) return `${base} ${n}`;
}

const newId = () => `s${Math.random().toString(36).slice(2, 10)}`;

/** A pixel ring (corners) to lat/lng, simplified to `tolFt`. */
function toRing(site: LawnSite, loop: Pt[], tolFt: number): LatLng[] {
  const g = gridOf(site);
  const fpp = g.gsdM * M_TO_FT;
  return smoothLoop(loop, Math.max(0.75, tolFt / fpp)).map((p) => fromPx(g, p));
}

/** The photo's own reading outlined, as shapes to adjust: every lawn piece of 150 sq ft and up (with a hole of 300 sq ft
 *  and up inside one as "not mowed"), every bed of 40 sq ft and up, named for where they lie. `labels` is the yard as
 *  read (the site's labels). */
export function suggestShapes(site: LawnSite, labels: Uint8Array, taken: string[] = []): LawnShape[] {
  const g = gridOf(site);
  const { mask } = lotMaskOf(site);
  const sqftPx = (g.gsdM * M_TO_FT) ** 2;
  const out: LawnShape[] = [];
  const names = [...taken];
  for (const [kind, cls, minSqft, tolFt] of [
    ["lawn", CLS.LAWN, 150, 2],
    ["bed", CLS.BED, 40, 1.2],
  ] as const) {
    const m = new Uint8Array(g.w * g.h);
    for (let i = 0; i < m.length; i++) m[i] = mask[i] && labels[i] === cls ? 1 : 0;
    for (const loop of traceLoops(m, g.w, g.h)) {
      const a = signedArea(loop) * sqftPx;
      const hole = a < 0;
      if (hole ? kind !== "lawn" || -a < 300 : a < minSqft) continue;
      const ring = toRing(site, loop, tolFt);
      if (ring.length < 3) continue;
      const k: ShapeKind = hole ? "cut" : kind;
      const name = nameFor(k, zoneOfShape(site, ring, labels), names);
      names.push(name);
      out.push({ id: newId(), kind: k, name, ring });
      if (out.length >= MAX_SHAPES) return out;
    }
  }
  return out;
}

/** One tap on the photo: the piece of lawn (or bed) under it, outlined from the reading — the yard as read first, the
 *  photo's raw reading where the yard pass left it out. Null when there's no lawn or bed there. */
export function outlineAt(site: LawnSite, labels: Uint8Array, at: LatLng, taken: string[] = []): LawnShape | null {
  const g = gridOf(site);
  const { mask } = lotMaskOf(site);
  const p = toPx(g, at);
  const x = Math.floor(p.x);
  const y = Math.floor(p.y);
  if (x < 0 || y < 0 || x >= g.w || y >= g.h) return null;
  const start = y * g.w + x;
  const read = decodeLabels(site.readLabels, g.w * g.h);
  const src = labels[start] === CLS.LAWN || labels[start] === CLS.BED ? labels : read[start] === CLS.LAWN || read[start] === CLS.BED ? read : null;
  if (!src) return null;
  const cls = src[start];
  const comp = new Uint8Array(g.w * g.h);
  const q = [start];
  comp[start] = 1;
  while (q.length) {
    const i = q.pop()!;
    const cx = i % g.w;
    const cy = (i - cx) / g.w;
    for (const [xx, yy] of [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]] as const) {
      if (xx < 0 || yy < 0 || xx >= g.w || yy >= g.h) continue;
      const k = yy * g.w + xx;
      if (!comp[k] && src[k] === cls && (mask[k] || !mask[start])) {
        comp[k] = 1;
        q.push(k);
      }
    }
  }
  const outer = traceLoops(comp, g.w, g.h)
    .map((loop) => ({ loop, a: signedArea(loop) }))
    .filter((o) => o.a > 0)
    .sort((a, b) => b.a - a.a)[0];
  if (!outer) return null;
  const ring = toRing(site, outer.loop, cls === CLS.LAWN ? 2 : 1.2);
  if (ring.length < 3) return null;
  const kind: ShapeKind = cls === CLS.LAWN ? "lawn" : "bed";
  return { id: newId(), kind, name: nameFor(kind, zoneOfShape(site, ring, labels), taken), ring };
}

/** A shape as the contractor drew it (corners clicked), named for where it lies. */
export function drawnShape(site: LawnSite, kind: ShapeKind, ring: LatLng[], labels: Uint8Array, taken: string[]): LawnShape {
  return { id: newId(), kind, name: nameFor(kind, zoneOfShape(site, ring, labels), taken), ring };
}

/** Shapes off the wire, held to sense: known kinds, finite corners, sane counts and names. */
export function cleanShapes(raw: unknown): LawnShape[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: LawnShape[] = [];
  for (const r of raw.slice(0, MAX_SHAPES)) {
    const o = r && typeof r === "object" ? (r as Record<string, unknown>) : null;
    if (!o || (o.kind !== "lawn" && o.kind !== "bed" && o.kind !== "cut") || !Array.isArray(o.ring)) continue;
    const ring = (o.ring as unknown[])
      .slice(0, MAX_POINTS)
      .map((p) => (p && typeof p === "object" ? (p as Record<string, unknown>) : {}))
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(Number(p.lat)) <= 90 && Math.abs(Number(p.lng)) <= 180)
      .map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) }));
    if (ring.length < 3) continue;
    out.push({ id: typeof o.id === "string" && o.id.length <= 40 ? o.id : newId(), kind: o.kind, name: typeof o.name === "string" ? o.name.trim().slice(0, 60) || KIND_WORD[o.kind] : KIND_WORD[o.kind], ring });
  }
  return out;
}
