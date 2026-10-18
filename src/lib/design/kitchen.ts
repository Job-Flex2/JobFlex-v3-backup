// THE KITCHEN, LAID OUT (Home Design Studio, milestone 3 — 2026-10-17). Owner: "you can add fixtures, cabinets,
// countertops … make it super smart". Pure rules a kitchen designer uses, in plan inches:
//   · spans — each wall face the room has, clipped at the corners, with its doors and windows;
//   · fillWidths — a stretch of wall in standard 3-inch cabinet widths, the fewest boxes, the least filler;
//   · autoKitchen — a kitchen for an empty room: the sink centered under the window, the dishwasher beside it, the
//     range on the next wall with counter both sides, the fridge at an open end, a blind corner where two runs meet,
//     wall cabinets over the runs (never over a window, a door or a tall unit), a hood over the range, an island
//     only where 42 in walkways fit round it, stools on its seating side, pendants over it, recessed lights;
//   · kitchenFromPlan — the same, from what the architect DREW: the counter's front edge a cabinet depth off a wall,
//     the dashed uppers, the island block, the burners (four small circles), the sink bowls, the fridge box.
// Everything returned is ordinary DesignItems the contractor then moves, resizes or deletes.
import type { DesignDoc, DesignItem, Finishes, P } from "./model";
import { DEFAULT_CEILING, newId } from "./model";
import { add, centroid, dist, dot, leftN, mulP, pointInPoly, project, sub, unit, type Room } from "./geometry";
import { BASE_H, UPPER_Z, lib, newItemFrom } from "./library";

const DEG = 180 / Math.PI;

/* ── How high the backsplash rises behind an item (the 3D and the estimate share it) ─────────────────────────── */

export function splashTopFor(it: DesignItem, items: DesignItem[], height: Finishes["backsplash"]["height"], ceiling: number): number {
  if (height === "4in") return 40;
  const r = (it.rot * Math.PI) / 180;
  const u = { x: -Math.sin(r), y: Math.cos(r) };
  const t = it.x * u.x + it.y * u.y;
  const over = items.filter((o) => o.id !== it.id && o.wallId === it.wallId && o.z >= 40 && Math.abs(o.x * u.x + o.y * u.y - t) < (o.w + it.w) / 2 - 1);
  const hood = over.find((o) => o.lib === "HD" || o.lib === "MW");
  if (it.lib === "RNG") return hood ? hood.z : height === "full" ? Math.min(ceiling, 84) : 54;
  if (height === "18in") return UPPER_Z;
  return over.length ? Math.min(...over.map((o) => o.z)) : Math.min(ceiling, 84);
}


/* ── An item's frame ───────────────────────────────────────────────────────────────────────────────────────────── */

/** Its front direction f and its width axis u (f turned a quarter to the right on the plan). */
export function frameOf(it: Pick<DesignItem, "rot">): { f: P; u: P } {
  const r = (it.rot * Math.PI) / 180;
  const f = { x: Math.cos(r), y: Math.sin(r) };
  return { f, u: { x: -f.y, y: f.x } };
}

/** Its four footprint corners: back-left, back-right, front-right, front-left. */
export function cornersOf(it: Pick<DesignItem, "x" | "y" | "rot" | "w" | "d">): P[] {
  const { f, u } = frameOf(it);
  const c = { x: it.x, y: it.y };
  const hw = it.w / 2;
  const hd = it.d / 2;
  return [add(add(c, mulP(u, -hw)), mulP(f, -hd)), add(add(c, mulP(u, hw)), mulP(f, -hd)), add(add(c, mulP(u, hw)), mulP(f, hd)), add(add(c, mulP(u, -hw)), mulP(f, hd))];
}

/** Do two footprints overlap (more than a hair)? Separating axes. */
export function overlaps(a: Pick<DesignItem, "x" | "y" | "rot" | "w" | "d">, b: Pick<DesignItem, "x" | "y" | "rot" | "w" | "d">, slack = 0.5): boolean {
  const ca = cornersOf(a);
  const cb = cornersOf(b);
  for (const it of [a, b]) {
    const { f, u } = frameOf(it);
    for (const ax of [f, u]) {
      const pa = ca.map((p) => dot(p, ax));
      const pb = cb.map((p) => dot(p, ax));
      if (Math.max(...pa) - slack <= Math.min(...pb) || Math.max(...pb) - slack <= Math.min(...pa)) return false;
    }
  }
  return true;
}

/* ── The room's wall faces ─────────────────────────────────────────────────────────────────────────────────────── */

export type Span = {
  wallId: string;
  /** The face's ends on the room side, a → b. */
  a: P;
  b: P;
  dir: P;
  /** Into the room. */
  n: P;
  len: number;
  /** Doors and openings across it (t from a): nothing stands there. */
  doors: Array<[number, number]>;
  /** Windows: [t0, t1, sill]. */
  windows: Array<[number, number, number]>;
  /** The wall's height. */
  height: number;
};

export function roomSpans(doc: Pick<DesignDoc, "walls" | "openings">, room: Room): Span[] {
  const poly = room.poly;
  const nPts = poly.length;
  // Each edge of the room's loop, with the wall it lies on.
  const edges = poly.map((p, i) => {
    const q = poly[(i + 1) % nPts];
    const w = doc.walls.find((x) => project(x.a, x.b, p).off <= 1.5 && project(x.a, x.b, q).off <= 1.5) ?? null;
    return { p, q, w };
  });
  // Edges on one wall (a T-junction split it) join into one face.
  const merged: typeof edges = [];
  for (const e of edges) {
    const last = merged[merged.length - 1];
    if (last && e.w && last.w?.id === e.w.id) last.q = e.q;
    else merged.push({ ...e });
  }
  if (merged.length > 1 && merged[0].w && merged[merged.length - 1].w?.id === merged[0].w.id) {
    merged[0].p = merged[merged.length - 1].p;
    merged.pop();
  }
  const out: Span[] = [];
  merged.forEach((e, i) => {
    // A room boundary (an open plan's edge) has no face: no cabinets against it, no paint, no baseboard.
    if (!e.w || e.w.boundary) return;
    const d = unit(sub(e.q, e.p));
    let n = leftN(d);
    const mid = mulP(add(e.p, e.q), 0.5);
    if (!pointInPoly(add(mid, mulP(n, 3)), poly)) n = mulP(n, -1);
    const prev = merged[(i - 1 + merged.length) % merged.length].w;
    const next = merged[(i + 1) % merged.length].w;
    const a = add(add(e.p, mulP(n, e.w.thick / 2)), mulP(d, (prev?.thick ?? 0) / 2));
    const b = add(add(e.q, mulP(n, e.w.thick / 2)), mulP(d, -(next?.thick ?? 0) / 2));
    const len = Math.max(0, dot(sub(b, a), d));
    const w = e.w;
    const wd = unit(sub(w.b, w.a));
    const tOf = (tw: number) => dot(sub(add(w.a, mulP(wd, tw)), a), d);
    const doors: Array<[number, number]> = [];
    const windows: Array<[number, number, number]> = [];
    for (const o of doc.openings.filter((x) => x.wallId === w.id)) {
      const t0 = tOf(o.at - o.width / 2);
      const t1 = tOf(o.at + o.width / 2);
      const lo = Math.max(0, Math.min(t0, t1));
      const hi = Math.min(len, Math.max(t0, t1));
      if (hi - lo < 1) continue;
      if (o.kind === "window") windows.push([lo, hi, o.sill]);
      else doors.push([lo, hi]);
    }
    out.push({ wallId: w.id, a, b, dir: d, n, len, doors: doors.sort((x, y) => x[0] - y[0]), windows: windows.sort((x, y) => x[0] - y[0]), height: w.height });
  });
  return out.filter((s) => s.len >= 6);
}

/** The point t along a span, `off` inches out from its face. */
export const spanAt = (s: Span, t: number, off = 0): P => add(add(s.a, mulP(s.dir, t)), mulP(s.n, off));
const rotOf = (v: P) => Math.round(Math.atan2(v.y, v.x) * DEG * 100) / 100;

/** Two spans meeting at an inside corner: which ends. */
function cornerBetween(s1: Span, s2: Span): { end1: "a" | "b"; end2: "a" | "b" } | null {
  for (const e1 of ["a", "b"] as const)
    for (const e2 of ["a", "b"] as const) if (dist(s1[e1], s2[e2]) <= 3) return { end1: e1, end2: e2 };
  return null;
}

/* ── Standard widths ───────────────────────────────────────────────────────────────────────────────────────────── */

const WIDTHS = [36, 33, 30, 27, 24, 21, 18, 15, 12, 9];

/** A stretch in standard widths: the fewest boxes, the widest smallest box, what's left as filler (under 3 in). */
export function fillWidths(len: number, opts: { min?: number; max?: number } = {}): { widths: number[]; filler: number } {
  const min = opts.min ?? 9;
  const max = opts.max ?? 36;
  const ws = WIDTHS.filter((w) => w >= min && w <= max);
  const L = Math.floor((len + 1e-6) / 3) * 3;
  if (L < min) return { widths: [], filler: Math.max(0, len) };
  // best[x]: [boxes, -smallest box] to fill exactly x.
  const best: Array<{ n: number; small: number; prev: number; w: number } | null> = Array(L + 1).fill(null);
  best[0] = { n: 0, small: Infinity, prev: -1, w: 0 };
  for (let x = 3; x <= L; x += 3) {
    for (const w of ws) {
      const p = best[x - w];
      if (x - w < 0 || !p) continue;
      const cand = { n: p.n + 1, small: Math.min(p.small, w), prev: x - w, w };
      const cur = best[x];
      if (!cur || cand.n < cur.n || (cand.n === cur.n && cand.small > cur.small)) best[x] = cand;
    }
  }
  let x = L;
  while (x > 0 && !best[x]) x -= 3;
  const widths: number[] = [];
  for (let k = x; k > 0; k = best[k]!.prev) widths.push(best[k]!.w);
  widths.sort((a, b) => b - a);
  return { widths, filler: Math.max(0, len - x) };
}

/* ── Runs ──────────────────────────────────────────────────────────────────────────────────────────────────────── */

type Fixed = { t0: number; t1: number; lib: string; w: number; opts?: DesignItem["opts"] };

/** A unit's start on the run's 3-inch grid (moved 1½ in at most), so the cabinets between come out whole. */
const on3 = (t: number, base: number) => base + Math.round((t - base) / 3) * 3;

function place(span: Span, t0: number, w: number, libId: string, room: string | null, d?: number, z?: number, h?: number): DesignItem | null {
  const e = lib(libId);
  if (!e) return null;
  const depth = d ?? e.d;
  const c = spanAt(span, t0 + w / 2, depth / 2);
  const it = newItemFrom(libId, { x: c.x, y: c.y, rot: rotOf(span.n), wallId: span.wallId, room }, newId("i"), w);
  if (!it) return null;
  it.d = depth;
  if (z != null) it.z = z;
  if (h != null) it.h = h;
  return it;
}

/** A base run on a span from t0 to t1: the fixed units where they go, standard cabinets between, fillers at the ends. */
function baseRun(span: Span, t0: number, t1: number, fixed: Fixed[], room: string | null, near: { range?: number } = {}): DesignItem[] {
  const out: DesignItem[] = [];
  const fx = fixed.filter((f) => f.t1 > t0 && f.t0 < t1).sort((a, b) => a.t0 - b.t0);
  let t = t0;
  const gaps: Array<[number, number]> = [];
  for (const f of fx) {
    if (f.t0 > t) gaps.push([t, f.t0]);
    const it = place(span, f.t0, f.w, f.lib, room);
    if (it) {
      if (f.opts) it.opts = { ...(it.opts ?? {}), ...f.opts };
      out.push(it);
    }
    t = Math.max(t, f.t1);
  }
  if (t < t1) gaps.push([t, t1]);
  for (const [g0, g1] of gaps) {
    const len = g1 - g0;
    if (len < 1) continue;
    const { widths, filler } = fillWidths(len);
    let x = g0 + (filler >= 1.5 ? 0 : filler / 2);
    if (filler >= 1.5) {
      const fw = Math.min(6, Math.round(filler * 2) / 2);
      const fi = place(span, g0, fw, "BF", room);
      if (fi) out.push(fi);
      x = g0 + fw;
    }
    // Drawers beside a range; doors elsewhere.
    for (const w of widths) {
      const nextToRange = near.range != null && (Math.abs(x - near.range) < 1 || Math.abs(x + w - near.range) < 1);
      const it = place(span, x, w, nextToRange && w <= 24 ? "DB" : "B", room);
      if (it) out.push(it);
      x += w;
    }
  }
  return out;
}

/** Wall cabinets over a run, clear of windows, doors, the range, the fridge and tall units. */
function upperRun(span: Span, t0: number, t1: number, skip: Array<[number, number]>, room: string | null, ceiling: number): DesignItem[] {
  const h = ceiling >= 108 ? 42 : ceiling >= 96 ? 36 : 30;
  const blocks = [...skip, ...span.doors.map(([a, b]) => [a - 1, b + 1] as [number, number]), ...span.windows.filter((w) => w[2] < UPPER_Z + h).map(([a, b]) => [a - 2, b + 2] as [number, number])]
    .map(([a, b]) => [Math.max(t0, a), Math.min(t1, b)] as [number, number])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  const free: Array<[number, number]> = [];
  let t = t0;
  for (const [a, b] of blocks) {
    if (a > t) free.push([t, a]);
    t = Math.max(t, b);
  }
  if (t < t1) free.push([t, t1]);
  const out: DesignItem[] = [];
  for (const [a, b] of free) {
    if (b - a < 12) continue;
    const { widths, filler } = fillWidths(b - a, { min: 12 });
    let x = a + filler / 2;
    for (const w of widths) {
      const it = place(span, x, w, "W", room, 12, UPPER_Z, h);
      if (it) out.push(it);
      x += w;
    }
  }
  return out;
}

/* ── Lights and stools ─────────────────────────────────────────────────────────────────────────────────────────── */

function islandExtras(isl: DesignItem, ceiling: number, room: string | null): DesignItem[] {
  const out: DesignItem[] = [];
  const { f, u } = frameOf(isl);
  // Pendants over the island: two, three from 84 in, 30 in above the counter.
  const n = isl.w >= 84 ? 3 : 2;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n - 0.5;
    const c = add({ x: isl.x, y: isl.y }, mulP(u, t * isl.w * 0.9));
    const p = newItemFrom("PEN", { x: c.x, y: c.y, rot: isl.rot, room }, newId("i"));
    if (p) {
      p.z = Math.min(ceiling - 18, 36 + 30);
      out.push(p);
    }
  }
  // Stools at the seating side (the back, past the overhang), 24 in apart.
  if (isl.opts?.seats) {
    const count = Math.max(1, Math.floor(isl.w / 24));
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count - 0.5;
      const c = add(add({ x: isl.x, y: isl.y }, mulP(u, t * isl.w)), mulP(f, -(isl.d / 2 + 4)));
      const s = newItemFrom("STL", { x: c.x, y: c.y, rot: isl.rot, room }, newId("i"));
      if (s) out.push(s);
    }
  }
  return out;
}

/** Recessed lights over the working part of the room: about every 5 ft, 2 ft off the walls. */
function cans(zone: { x0: number; y0: number; x1: number; y1: number }, roomPoly: P[], ceiling: number, room: string | null): DesignItem[] {
  const out: DesignItem[] = [];
  const W = zone.x1 - zone.x0;
  const H = zone.y1 - zone.y0;
  const nx = Math.max(1, Math.round(W / 60));
  const ny = Math.max(1, Math.round(H / 60));
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++) {
      const p = { x: zone.x0 + ((i + 0.5) * W) / nx, y: zone.y0 + ((j + 0.5) * H) / ny };
      if (!pointInPoly(p, roomPoly)) continue;
      const c = newItemFrom("CAN", { x: p.x, y: p.y, rot: 0, room }, newId("i"));
      if (c) {
        c.z = ceiling - 1;
        out.push(c);
      }
    }
  return out;
}

/* ── An empty room → a kitchen ─────────────────────────────────────────────────────────────────────────────────── */

export type KitchenResult = { items: DesignItem[]; notes: string[] };

/** The kitchen for an empty room — laid out once for each open end the fridge could take, keeping the layout whose
 *  work triangle (sink, cooking surface, fridge) best keeps NKBA's 4–9 ft legs and 26 ft around; the first choice
 *  wins a tie. */
export function autoKitchen(doc: DesignDoc, room: Room, labelId: string | null): KitchenResult {
  let best: { r: KitchenResult; score: number } | null = null;
  for (const rangeFirst of [false, true])
    for (let pick = 0; pick < 4; pick++) {
      const r = layoutKitchen(doc, room, labelId, pick, rangeFirst);
      const score = layoutScore(r);
      if (!best || score < best.score - 0.5) best = { r: { items: r.items, notes: r.notes }, score };
      if (pick + 1 >= (r.picks ?? 0)) break;
    }
  return best!.r;
}

/** Counter beside an item along its run, each side (touching counters with the same back line). */
function sideCounter(it: DesignItem, items: DesignItem[]): [number, number] {
  const { f, u } = frameOf(it);
  const back = (o: DesignItem) => dot({ x: o.x, y: o.y }, f) - o.d / 2;
  const span = (o: DesignItem): [number, number] => {
    const c = dot({ x: o.x, y: o.y }, u);
    return [c - o.w / 2, c + o.w / 2];
  };
  const run = items.filter((o) => o.id !== it.id && lib(o.lib)?.counter && Math.abs((((o.rot - it.rot) % 360) + 540) % 360 - 180) < 2 && Math.abs(back(o) - back(it)) < 4).map(span);
  const [t0, t1] = span(it);
  let lo = t0;
  let hi = t1;
  for (let moved = true; moved; ) {
    moved = false;
    for (const [a, b] of run) {
      if (b >= lo - 1.5 && a < lo - 0.01) {
        lo = a;
        moved = true;
      }
      if (a <= hi + 1.5 && b > hi + 0.01) {
        hi = b;
        moved = true;
      }
    }
  }
  return [t0 - lo, hi - t1];
}

/** How far a layout misses the guidelines it can: the triangle's legs and loop, and the counter beside the range
 *  (12 + 15 in) and the fridge (15 in), inches short or over; a missing sink, range or fridge counts heavily. */
function layoutScore(r: KitchenResult): number {
  const one = (id: string) => r.items.find((i) => i.lib === id);
  const s = one("SB");
  const c = one("RNG") ?? one("CT");
  const f = one("REF");
  // Missing pieces outrank everything; a kitchen without a range is worse than one without a built-in fridge spot.
  if (!s || !c || !f) return 5000 + (s ? 0 : 3000) + (c ? 0 : 2000) + (f ? 0 : 1500);
  const fm = (it: DesignItem) => {
    const { f: dir } = frameOf(it);
    return { x: it.x + (dir.x * it.d) / 2, y: it.y + (dir.y * it.d) / 2 };
  };
  const [ps, pc, pf] = [fm(s), fm(c), fm(f)];
  const legs = [Math.hypot(ps.x - pc.x, ps.y - pc.y), Math.hypot(pc.x - pf.x, pc.y - pf.y), Math.hypot(pf.x - ps.x, pf.y - ps.y)];
  const off = legs.reduce((sum, l) => sum + Math.max(0, 48 - l) + Math.max(0, l - 108), 0);
  const [ca, cb] = c.lib === "RNG" ? sideCounter(c, r.items) : [15, 15];
  const [fa, fb] = sideCounter(f, r.items);
  const landing = Math.max(0, 12 - Math.min(ca, cb)) + Math.max(0, 15 - Math.max(ca, cb)) + Math.max(0, 15 - Math.max(fa, fb));
  return off + Math.max(0, legs.reduce((a, b) => a + b, 0) - 312) + landing;
}

function layoutKitchen(doc: DesignDoc, room: Room, labelId: string | null, pick: number, rangeFirst: boolean): KitchenResult & { picks?: number } {
  const notes: string[] = [];
  const ceiling = room.ceiling || DEFAULT_CEILING;
  const label = doc.labels.find((l) => l.id === labelId);
  const anchor = label?.at ?? centroid(room.poly);
  let spans = roomSpans(doc, room).filter((s) => s.len >= 30);
  // An open plan (a kitchen in a living space): only the walls near the kitchen's name.
  if (room.names.length > 1) {
    const nearSpans = spans.filter((s) => project(s.a, s.b, anchor).off <= 16 * 12);
    if (nearSpans.length) spans = nearSpans;
  }
  if (!spans.length) return { items: [], notes: ["No wall here is long enough for cabinets."] };
  // Usable stretch of a span between its doors (the longest piece).
  const freeOf = (s: Span): Array<[number, number]> => {
    const out: Array<[number, number]> = [];
    let t = 0;
    for (const [a, b] of s.doors) {
      if (a - t >= 24) out.push([t, a - 3]);
      t = Math.max(t, b + 3);
    }
    if (s.len - t >= 24) out.push([t, s.len]);
    return out;
  };
  const longestFree = (s: Span) => freeOf(s).reduce<[number, number] | null>((m, p) => (!m || p[1] - p[0] > m[1] - m[0] ? p : m), null);
  // The sink wall: a window with the most room around it; else the longest free stretch.
  const scored = spans
    .map((s) => {
      const lf = longestFree(s);
      const win = s.windows.find((w) => lf && w[0] >= lf[0] && w[1] <= lf[1] && w[2] >= 30);
      return { s, lf, win, score: (lf ? lf[1] - lf[0] : 0) + (win ? 120 : 0) };
    })
    .filter((x) => x.lf)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return { items: [], notes: ["Every wall here is broken by doors — draw the kitchen's walls first."] };
  const main = scored[0];
  const used: Array<{ s: Span; t0: number; t1: number; fixed: Fixed[]; range?: number }> = [{ s: main.s, t0: main.lf![0], t1: main.lf![1], fixed: [] }];
  // An L: a span meeting the sink wall at an inside corner, using its stretch that reaches that corner (not the
  // longest stretch somewhere past a door); in an open kitchen-living room at most 10 ft of it.
  type Leg = { s: Span; lf: [number, number] };
  let side: Leg | null = null;
  for (const x of scored.slice(1)) {
    const c = cornerBetween(main.s, x.s);
    if (!c) continue;
    const atCorner = freeOf(x.s).find((p) => (c.end2 === "a" ? p[0] <= 6 : p[1] >= x.s.len - 6));
    if (!atCorner) continue;
    const lf: [number, number] = [atCorner[0], atCorner[1]];
    if (room.names.length > 1) {
      if (c.end2 === "a") lf[1] = Math.min(lf[1], 120);
      else lf[0] = Math.max(lf[0], x.s.len - 120);
    }
    if (lf[1] - lf[0] >= 54 && (!side || lf[1] - lf[0] > side.lf[1] - side.lf[0])) side = { s: x.s, lf };
  }
  if (side) used.push({ s: side.s, t0: side.lf[0], t1: side.lf[1], fixed: [] });
  // Corners: the longer run takes the corner with a blind corner cabinet; the other starts at its face (24 in out).
  if (side) {
    const c = cornerBetween(main.s, side.s)!;
    const [own, other, eOwn, eOther] = main.lf![1] - main.lf![0] >= side.lf[1] - side.lf[0] ? [used[0], used[1], c.end1, c.end2] : [used[1], used[0], c.end2, c.end1];
    const bw = 42;
    if (eOwn === "a" && own.t0 < 1) own.fixed.push({ t0: 0, t1: bw, lib: "BC", w: bw });
    else if (eOwn === "b" && own.t1 > own.s.len - 1) own.fixed.push({ t0: own.s.len - bw, t1: own.s.len, lib: "BC", w: bw });
    if (eOther === "a" && other.t0 < 1) other.t0 = 24;
    else if (eOther === "b" && other.t1 > other.s.len - 1) other.t1 = other.s.len - 24;
  }
  const m = used[0];
  // Sink: centered under the window (or the stretch), a 36 in sink base; the dishwasher on the side with more room.
  const sinkW = 36;
  const sc = main.win ? (main.win[0] + main.win[1]) / 2 : (m.t0 + m.t1) / 2;
  const blocked = (u: (typeof used)[number], a: number, b: number) => a < u.t0 - 0.5 || b > u.t1 + 0.5 || u.fixed.some((f) => f.t1 > a + 0.5 && f.t0 < b - 0.5);
  let s0 = on3(sc - sinkW / 2, m.t0);
  s0 = Math.max(m.t0, Math.min(m.t1 - sinkW, s0));
  // Off a corner cabinet when it would sit in one.
  for (const f of m.fixed) if (s0 < f.t1 && s0 + sinkW > f.t0) s0 = f.t0 >= s0 ? f.t0 - sinkW : f.t1;
  if (!blocked(m, s0, s0 + sinkW)) m.fixed.push({ t0: s0, t1: s0 + sinkW, lib: "SB", w: sinkW, opts: { sink: "double" } });
  else notes.push("No room for a 36 in sink base on the sink wall.");
  // The dishwasher beside the sink: the side with more room first, else the other.
  const right = m.t1 - (s0 + sinkW);
  const left = s0 - m.t0;
  const sides = right >= left ? [s0 + sinkW, s0 - 24] : [s0 - 24, s0 + sinkW];
  const dwAt = sides.find((t) => !blocked(m, t, t + 24));
  if (dwAt != null) m.fixed.push({ t0: dwAt, t1: dwAt + 24, lib: "DW", w: 24 });
  else notes.push("No 24 in beside the sink for a dishwasher — place it by hand.");
  const items: DesignItem[] = [];
  // The fridge at an open end (not a corner), 36 in. Placed before the range (so the range is centered in what's
  // left and keeps its counter) or after it (a small room: the range first); autoKitchen tries both.
  const fw = 36;
  let picks = 0;
  const placeFridge = () => {
  // Every open end it could take, the L's leg first; `pick` chooses among them (autoKitchen tries each).
  const ends: Array<{ run: (typeof used)[number]; t0: number }> = [];
  for (const u of [...used].reverse()) {
    const corner = used.some((o) => o !== u && cornerBetween(o.s, u.s));
    const c = corner ? cornerBetween(used[0].s, used[1]?.s ?? used[0].s) : null;
    const endFree = (end: "a" | "b") => !(c && ((u === used[0] && c.end1 === end) || (u === used[1] && c.end2 === end)));
    if (endFree("b") && !blocked(u, u.t1 - fw, u.t1)) ends.push({ run: u, t0: u.t1 - fw });
    if (endFree("a") && !blocked(u, u.t0, u.t0 + fw)) ends.push({ run: u, t0: u.t0 });
  }
  picks = ends.length;
  const fridge = ends[pick] ?? ends[0] ?? null;
  if (fridge) {
    const f = place(fridge.run.s, fridge.t0, fw, "REF", labelId);
    if (f) items.push(f);
    // The counter run stops at the fridge.
    if (fridge.t0 <= fridge.run.t0 + 0.5) fridge.run.t0 = fridge.t0 + fw;
    else fridge.run.t1 = fridge.t0;
    const over = place(fridge.run.s, fridge.t0, fw, "WR", labelId, 24, 72, Math.max(12, Math.min(24, ceiling - 72 - 6)));
    if (over) items.push(over);
  } else notes.push("No open end for a 36 in fridge — place it by hand.");
  };
  // Range: centered on the L's other run (counter both sides), else on the sink wall away from the sink.
  const rw = 30;
  const rangeRun = used[1] ?? m;
  const placeRange = () => {
  // NKBA landing at a cooking surface: 12 in on one side, 15 in on the other (the corner cabinet's counter counts).
  const fits = (u: (typeof used)[number], t: number, need = { lo: 12, hi: 15 }) => {
    const a = t - u.t0;
    const b = u.t1 - (t + rw);
    return !blocked(u, t, t + rw) && Math.min(a, b) >= need.lo && Math.max(a, b) >= need.hi;
  };
  // Every spot on the run's 3 in grid that fits, the best by `score` (lower is better).
  const bestOn = (u: (typeof used)[number], score: (t: number) => number, need?: { lo: number; hi: number }) => {
    let best: number | null = null;
    for (let t = u.t0; t <= u.t1 - rw + 0.01; t += 3) {
      const tt = on3(t, u.t0);
      if (fits(u, tt, need) && (best == null || score(tt) < score(best))) best = tt;
    }
    return best;
  };
  const middle = (u: (typeof used)[number]) => (t: number) => Math.abs(t + rw / 2 - (u.t0 + u.t1) / 2);
  // On the sink wall: as far from the sink as it fits.
  const awayFromSink = (t: number) => -Math.abs(t + rw / 2 - (s0 + sinkW / 2));
  const spot =
    rangeRun !== m
      ? (() => {
          const leg = bestOn(rangeRun, middle(rangeRun));
          return leg != null ? { u: rangeRun, t: leg } : null;
        })() ?? (() => {
          const wall = bestOn(m, awayFromSink);
          return wall != null ? { u: m, t: wall } : null;
        })()
      : (() => {
          const wall = bestOn(m, awayFromSink);
          return wall != null ? { u: m, t: wall } : null;
        })();
  if (spot) {
    spot.u.fixed.push({ t0: spot.t, t1: spot.t + rw, lib: "RNG", w: rw });
    spot.u.range = spot.t;
  } else {
    // A range with short counter beats no range: the Checks tab says so.
    const tight = bestOn(rangeRun, middle(rangeRun), { lo: 6, hi: 6 });
    if (tight != null) {
      rangeRun.fixed.push({ t0: tight, t1: tight + rw, lib: "RNG", w: rw });
      rangeRun.range = tight;
      notes.push("The range has less counter beside it than the guideline (12 in one side, 15 in the other) — see Checks.");
    } else notes.push("No 30 in stretch with counter both sides for the range — place it by hand.");
  }
  };
  if (rangeFirst) {
    placeRange();
    placeFridge();
  } else {
    placeFridge();
    placeRange();
  }
  // Base runs, then uppers.
  for (const u of used) {
    items.push(...baseRun(u.s, u.t0, u.t1, u.fixed, labelId, { range: u.range }));
    const skip: Array<[number, number]> = [];
    if (u.range != null) skip.push([u.range - 1, u.range + rw + 1]);
    items.push(...upperRun(u.s, u.t0, u.t1, skip, labelId, ceiling));
    if (u.range != null) {
      const hd = place(u.s, u.range, rw, "HD", labelId, 20, 66, Math.min(18, ceiling - 66));
      if (hd) items.push(hd);
    }
  }
  // Island: parallel to the sink wall, 42 in clear on every side, 12 in seating overhang.
  const isl = fitIsland(room, main.s, items, anchor, labelId);
  if (isl) {
    items.push(isl, ...islandExtras(isl, ceiling, labelId));
  } else notes.push("No island: it needs about 11½ ft from the counter to the far wall for 42 in walkways and seats.");
  // Recessed lights over the kitchen part.
  const pts = items.flatMap((it) => cornersOf(it));
  const zone = { x0: Math.min(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)), x1: Math.max(...pts.map((p) => p.x)), y1: Math.max(...pts.map((p) => p.y)) };
  items.push(...cans(zone, room.poly, ceiling, labelId));
  return { items, notes, picks };
}

/** The biggest island (48–96 in) that keeps 42 in walkways, square to the sink wall, near the kitchen. */
function fitIsland(room: Room, main: Span, placed: DesignItem[], anchor: P, labelId: string | null): DesignItem | null {
  const D = 24 + 12; // cabinets + seating overhang
  for (let w = 96; w >= 48; w -= 6) {
    for (let off = 24 + 42 + D / 2; off <= 24 + 42 + D / 2 + 60; off += 6) {
      // Slide along the sink wall from its middle outward.
      for (const shift of [0, 12, -12, 24, -24, 36, -36]) {
        const c = spanAt(main, main.len / 2 + shift, off);
        const cand: DesignItem = { id: "x", lib: "ISL", x: c.x, y: c.y, rot: rotOf(mulP(main.n, -1)), w, d: D, h: BASE_H, z: 0 };
        // Clear: 42 in around it inside the room, and nothing within 42 in.
        const grown = { ...cand, w: w + 84, d: D + 84 };
        const corners = cornersOf(grown);
        if (!corners.every((p) => pointInPoly(p, room.poly))) continue;
        if (placed.some((it) => (lib(it.lib)?.cat === "base" || lib(it.lib)?.cat === "tall" || it.lib === "REF" || it.lib === "RNG" || it.lib === "DW") && overlaps(grown, it))) continue;
        if (room.names.length > 1 && dist(c, anchor) > 20 * 12) continue;
        const isl = newItemFrom("ISL", { x: c.x, y: c.y, rot: cand.rot, room: labelId }, newId("i"), w);
        if (isl) {
          isl.d = D;
          isl.opts = { seats: true };
        }
        return isl;
      }
    }
  }
  return null;
}

/* ── What the architect drew → a kitchen ───────────────────────────────────────────────────────────────────────── */

export function kitchenFromPlan(doc: DesignDoc, room: Room, labelId: string | null): KitchenResult {
  const notes: string[] = [];
  const ceiling = room.ceiling || DEFAULT_CEILING;
  const spans = roomSpans(doc, room);
  const inside = (p: P) => pointInPoly(p, room.poly);
  const marks = doc.marks.filter((m) => inside({ x: m.box.x + m.box.w / 2, y: m.box.y + m.box.h / 2 }));
  if (!marks.length) return { items: [], notes: ["The plan draws nothing inside this room — try Auto layout."] };
  const lines = marks.flatMap((m) => m.lines.map((l) => ({ a: l[0], b: l[1], role: m.role, mark: m })));
  // Base runs: the counter's front edge, a cabinet depth (21–27 in) off a wall face, parallel to it.
  type Run = { s: Span; t0: number; t1: number };
  const runs: Run[] = [];
  const uppersDrawn: Run[] = [];
  for (const s of spans) {
    const iv: Array<[number, number]> = [];
    const up: Array<[number, number]> = [];
    for (const l of lines) {
      if (l.role !== "cabinet") continue;
      const d = sub(l.b, l.a);
      const L = Math.hypot(d.x, d.y);
      if (L < 2) continue;
      if (Math.abs(dot({ x: d.x / L, y: d.y / L }, s.dir)) < 0.995) continue;
      const offA = dot(sub(l.a, s.a), s.n);
      const offB = dot(sub(l.b, s.a), s.n);
      if (Math.abs(offA - offB) > 1) continue;
      const ta = dot(sub(l.a, s.a), s.dir);
      const tb = dot(sub(l.b, s.a), s.dir);
      const lo = Math.max(0, Math.min(ta, tb));
      const hi = Math.min(s.len, Math.max(ta, tb));
      if (hi - lo < 1) continue;
      if (offA >= 21 && offA <= 27) iv.push([lo, hi]);
      else if (offA >= 10 && offA <= 14) up.push([lo, hi]);
    }
    const union = (xs: Array<[number, number]>, gap: number) => {
      const out: Array<[number, number]> = [];
      for (const [a, b] of xs.sort((x, y) => x[0] - y[0])) {
        const last = out[out.length - 1];
        if (last && a <= last[1] + gap) last[1] = Math.max(last[1], b);
        else out.push([a, b]);
      }
      return out;
    };
    for (const [a, b] of union(iv, 4)) if (b - a >= 12) runs.push({ s, t0: a < 3 ? 0 : a, t1: b > s.len - 3 ? s.len : b });
    for (const [a, b] of union(up, 8)) if (b - a >= 12) uppersDrawn.push({ s, t0: a < 3 ? 0 : a, t1: b > s.len - 3 ? s.len : b });
  }
  // Burners: four small circles together → a range or a cooktop.
  const small = marks.filter((m) => m.box.w >= 3 && m.box.w <= 9 && m.box.h >= 3 && m.box.h <= 9 && m.lines.length >= 12);
  const box = (m: (typeof marks)[number]) => ({ x0: m.box.x, y0: m.box.y, x1: m.box.x + m.box.w, y1: m.box.y + m.box.h });
  const cooks = marks
    .filter((m) => {
      const b = box(m);
      const W = Math.max(m.box.w, m.box.h);
      const H = Math.min(m.box.w, m.box.h);
      return W >= 20 && W <= 40 && H >= 16 && H <= 32 && small.filter((c) => c.box.x >= b.x0 - 1 && c.box.x + c.box.w <= b.x1 + 1 && c.box.y >= b.y0 - 1 && c.box.y + c.box.h <= b.y1 + 1).length >= 3;
    })
    .map((m) => ({ c: { x: m.box.x + m.box.w / 2, y: m.box.y + m.box.h / 2 }, w: Math.max(m.box.w, m.box.h), mark: m }));
  // Sinks: one or two bowls — a busy outline 20–42 in by 14–24 in.
  const sinks = marks
    .filter((m) => {
      const W = Math.max(m.box.w, m.box.h);
      const H = Math.min(m.box.w, m.box.h);
      return m.lines.length >= 20 && W >= 20 && W <= 42 && H >= 14 && H <= 24 && !cooks.some((k) => dist(k.c, { x: m.box.x + m.box.w / 2, y: m.box.y + m.box.h / 2 }) < 6);
    })
    .map((m) => ({ c: { x: m.box.x + m.box.w / 2, y: m.box.y + m.box.h / 2 }, w: Math.max(m.box.w, m.box.h) }));
  // Fridges: a plain box 28–44 in square-ish, its back near a wall face — not a range's outline, not over a sink;
  // the biggest such box first.
  const isCookOrSink = (m: (typeof marks)[number]) => {
    const c = { x: m.box.x + m.box.w / 2, y: m.box.y + m.box.h / 2 };
    return cooks.some((k) => k.mark === m || dist(k.c, c) < 8) || sinks.some((k) => dist(k.c, c) < 8);
  };
  const fridges = marks
    .filter((m) => {
      const W = Math.max(m.box.w, m.box.h);
      const H = Math.min(m.box.w, m.box.h);
      return m.role !== "cabinet" && m.lines.length <= 10 && W >= 28 && W <= 44 && H >= 24 && H <= 36 && !isCookOrSink(m);
    })
    .sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h)
    .map((m) => {
      const c = { x: m.box.x + m.box.w / 2, y: m.box.y + m.box.h / 2 };
      const s = spans.map((sp) => ({ sp, off: dot(sub(c, sp.a), sp.n), t: dot(sub(c, sp.a), sp.dir) })).filter((x) => x.off > 0 && x.off < 30 && x.t > -6 && x.t < x.sp.len + 6).sort((a, b) => a.off - b.off)[0];
      return s ? { s: s.sp, t: s.t, w: Math.max(m.box.w, m.box.h) } : null;
    })
    .filter((x): x is { s: Span; t: number; w: number } => !!x);
  // Islands: a cabinet block standing free of the walls.
  const islands = marks
    .filter((m) => m.role === "cabinet" && m.box.w >= 30 && m.box.h >= 24)
    .filter((m) => {
      const c = { x: m.box.x + m.box.w / 2, y: m.box.y + m.box.h / 2 };
      return spans.every((sp) => {
        const off = dot(sub(c, sp.a), sp.n);
        const t = dot(sub(c, sp.a), sp.dir);
        return off > Math.min(m.box.w, m.box.h) / 2 + 24 || t < -12 || t > sp.len + 12;
      });
    });

  const items: DesignItem[] = [];
  const std = (w: number, list: number[]) => list.reduce((m, x) => (Math.abs(x - w) < Math.abs(m - w) ? x : m), list[0]);
  // The fridge first: the counter run stops at it.
  for (const f of fridges.slice(0, 1)) {
    const fw = std(f.w, [30, 33, 36, 42, 48]);
    const t0 = Math.max(0, Math.min(f.s.len - fw, f.t - fw / 2));
    const it = place(f.s, t0, fw, "REF", labelId);
    if (it) items.push(it);
    for (const r of runs) if (r.s === f.s && r.t1 > t0 && r.t0 < t0 + fw) {
      if (t0 - r.t0 > r.t1 - (t0 + fw)) r.t1 = t0;
      else r.t0 = t0 + fw;
    }
    const over = place(f.s, t0, fw, "WR", labelId, 24, 72, Math.max(12, Math.min(24, ceiling - 78)));
    if (over) items.push(over);
  }
  // Corners between runs. In an L the architect's two front edges stop a counter depth short of the corner, so a run
  // within 30 in of it reaches it: the longer run takes the corner (a blind corner cabinet), the other starts at its face.
  for (let i = 0; i < runs.length; i++)
    for (let j = i + 1; j < runs.length; j++) {
      const c = cornerBetween(runs[i].s, runs[j].s);
      if (!c) continue;
      const nearEnd = (r: Run, e: "a" | "b") => (e === "a" ? r.t0 <= 30 : r.t1 >= r.s.len - 30);
      if (!nearEnd(runs[i], c.end1) || !nearEnd(runs[j], c.end2)) continue;
      const [own, other, eOwn, eOther] = runs[i].t1 - runs[i].t0 >= runs[j].t1 - runs[j].t0 ? [runs[i], runs[j], c.end1, c.end2] : [runs[j], runs[i], c.end2, c.end1];
      (own as Run & { corner?: "a" | "b" }).corner = eOwn;
      if (eOwn === "a") own.t0 = 0;
      else own.t1 = own.s.len;
      if (eOther === "a") other.t0 = Math.max(other.t0, 24);
      else other.t1 = Math.min(other.t1, other.s.len - 24);
    }
  const islandItems: DesignItem[] = [];
  for (const m of islands.slice(0, 1)) {
    const long = Math.max(m.box.w, m.box.h);
    const short = Math.min(m.box.w, m.box.h);
    const c = { x: m.box.x + m.box.w / 2, y: m.box.y + m.box.h / 2 };
    // Facing the nearest run: its cabinets toward the work, the seats away.
    const nearest = runs.map((r) => ({ r, off: dot(sub(c, r.s.a), r.s.n) })).filter((x) => x.off > 0).sort((a, b) => a.off - b.off)[0];
    const front = nearest ? mulP(nearest.r.s.n, -1) : m.box.w >= m.box.h ? { x: 0, y: -1 } : { x: -1, y: 0 };
    const seats = short > 44;
    const D = seats ? 36 : Math.min(42, short);
    const w = std(long, Array.from({ length: 13 }, (_, i) => 48 + i * 6));
    // Keep the work side where the plan has it; the stools' depth is not the island's.
    const shiftBack = seats ? (short - D) / 2 : 0;
    const cc = add(c, mulP(front, shiftBack));
    const isl = newItemFrom("ISL", { x: cc.x, y: cc.y, rot: rotOf(front), room: labelId }, newId("i"), w);
    if (isl) {
      isl.d = D;
      isl.opts = { seats };
      islandItems.push(isl, ...islandExtras(isl, ceiling, labelId));
    }
  }
  items.push(...islandItems);
  // Cooktops on the island; ranges in a run.
  const isl = islandItems.find((i) => i.lib === "ISL");
  const fixedBy = new Map<Run, Fixed[]>();
  const pushFixed = (r: Run, f: Fixed) => fixedBy.set(r, [...(fixedBy.get(r) ?? []), f]);
  const rangeAt = new Map<Run, number>();
  for (const k of cooks) {
    if (isl && overlaps({ ...isl, w: isl.w + 2, d: isl.d + 2 }, { x: k.c.x, y: k.c.y, rot: 0, w: 1, d: 1 })) {
      const ct = newItemFrom("CT", { x: k.c.x, y: k.c.y, rot: isl.rot, room: labelId }, newId("i"), std(k.w, [30, 36]));
      if (ct) items.push(ct);
      continue;
    }
    const r = runs.map((x) => ({ x, t: dot(sub(k.c, x.s.a), x.s.dir), off: dot(sub(k.c, x.s.a), x.s.n) })).find((y) => y.off > 0 && y.off < 30 && y.t > y.x.t0 - 6 && y.t < y.x.t1 + 6);
    if (r) {
      const w = std(k.w, [30, 36]);
      const t0 = Math.max(r.x.t0, Math.min(r.x.t1 - w, on3(r.t - w / 2, r.x.t0)));
      pushFixed(r.x, { t0, t1: t0 + w, lib: "RNG", w });
      rangeAt.set(r.x, t0);
    }
  }
  // Sinks: a sink base under the sink, the dishwasher beside it.
  for (const k of sinks) {
    if (isl && overlaps({ ...isl, w: isl.w + 2, d: isl.d + 2 }, { x: k.c.x, y: k.c.y, rot: 0, w: 1, d: 1 })) {
      isl.opts = { ...(isl.opts ?? {}), sink: k.w > 26 ? "double" : "single" };
      continue;
    }
    const r = runs.map((x) => ({ x, t: dot(sub(k.c, x.s.a), x.s.dir), off: dot(sub(k.c, x.s.a), x.s.n) })).find((y) => y.off > 0 && y.off < 30 && y.t > y.x.t0 - 6 && y.t < y.x.t1 + 6);
    if (!r) continue;
    const w = k.w > 33 ? 36 : k.w > 30 ? 33 : 30;
    const t0 = Math.max(r.x.t0, Math.min(r.x.t1 - w, on3(r.t - w / 2, r.x.t0)));
    pushFixed(r.x, { t0, t1: t0 + w, lib: "SB", w, opts: { sink: k.w > 26 ? "double" : "single" } });
    const fx = fixedBy.get(r.x) ?? [];
    const free = (a: number, b: number) => a >= r.x.t0 - 0.5 && b <= r.x.t1 + 0.5 && !fx.some((f) => f.t1 > a + 0.5 && f.t0 < b - 0.5);
    if (free(t0 + w, t0 + w + 24)) pushFixed(r.x, { t0: t0 + w, t1: t0 + w + 24, lib: "DW", w: 24 });
    else if (free(t0 - 24, t0)) pushFixed(r.x, { t0: t0 - 24, t1: t0, lib: "DW", w: 24 });
  }
  // The corner cabinet in the run that owns the corner.
  for (const r of runs as Array<Run & { corner?: "a" | "b" }>) {
    if (!r.corner) continue;
    const bw = 42;
    const at = r.corner === "a" ? 0 : r.s.len - bw;
    const fx = fixedBy.get(r) ?? [];
    if (!fx.some((f) => f.t1 > at && f.t0 < at + bw)) pushFixed(r, { t0: at, t1: at + bw, lib: "BC", w: bw });
  }
  for (const r of runs) {
    items.push(...baseRun(r.s, r.t0, r.t1, fixedBy.get(r) ?? [], labelId, { range: rangeAt.get(r) }));
    const rt = rangeAt.get(r);
    if (rt != null) {
      const hd = place(r.s, rt, 30, "HD", labelId, 20, 66, Math.min(18, ceiling - 66));
      if (hd) items.push(hd);
    }
  }
  // Uppers: where the plan draws them (dashed, 12 in deep); else over every run.
  const uppers = uppersDrawn.length ? uppersDrawn : runs;
  for (const u of uppers) {
    const skip: Array<[number, number]> = [];
    for (const r of runs) {
      const rt = rangeAt.get(r);
      if (r.s === u.s && rt != null) skip.push([rt - 1, rt + 31]);
    }
    for (const it of items) if (it.lib === "REF" && it.wallId === u.s.wallId) {
      const t = dot(sub({ x: it.x, y: it.y }, u.s.a), u.s.dir);
      skip.push([t - it.w / 2 - 1, t + it.w / 2 + 1]);
    }
    items.push(...upperRun(u.s, u.t0, u.t1, skip, labelId, ceiling));
  }
  const pts = items.flatMap((it) => cornersOf(it));
  if (pts.length) {
    const zone = { x0: Math.min(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)), x1: Math.max(...pts.map((p) => p.x)), y1: Math.max(...pts.map((p) => p.y)) };
    items.push(...cans(zone, room.poly, ceiling, labelId));
  }
  const len = (r: Run) => r.t1 - r.t0;
  const found: string[] = [];
  if (runs.length) found.push(`${runs.length === 1 ? "a" : runs.length === 2 ? "an L of" : `${runs.length}`} counter run${runs.length > 1 ? "s" : ""} (${runs.map((r) => `${Math.round(len(r) / 12 * 10) / 10} ft`).join(" + ")})`);
  if (isl) found.push(`a ${Math.round(isl.w)} in island${isl.opts?.seats ? " with seats" : ""}`);
  if (cooks.length) found.push(items.some((i) => i.lib === "CT") ? "a cooktop on the island" : "a range");
  if (sinks.length) found.push(isl?.opts?.sink ? "the sink in the island" : "the sink");
  if (fridges.length) found.push("the fridge");
  if (uppersDrawn.length) found.push("the wall cabinets drawn");
  notes.push(found.length ? `From the plan: ${found.join(", ")}.` : "The plan's drawings here didn't read as a kitchen — try Auto layout.");
  if (!sinks.length && runs.length) notes.push("No sink found in the plan's drawing — add a sink base where it goes.");
  return { items, notes };
}

/* ── Dragging an item: its back to the nearest wall face, square to it ─────────────────────────────────────────── */

export function snapToWall(doc: DesignDoc, room: Room | null, it: DesignItem, p: P): Pick<DesignItem, "x" | "y" | "rot" | "wallId"> {
  const e = lib(it.lib);
  if (!room || !e?.wall) return { x: p.x, y: p.y, rot: it.rot, wallId: null };
  let best: { s: Span; t: number; off: number } | null = null;
  for (const s of roomSpans(doc, room)) {
    const t = dot(sub(p, s.a), s.dir);
    const off = dot(sub(p, s.a), s.n);
    if (t < -it.w / 2 || t > s.len + it.w / 2 || off < -6 || off > it.d / 2 + 18) continue;
    if (!best || Math.abs(off - it.d / 2) < Math.abs(best.off - it.d / 2)) best = { s, t, off };
  }
  if (!best) return { x: p.x, y: p.y, rot: it.rot, wallId: null };
  const t = Math.max(it.w / 2, Math.min(best.s.len - it.w / 2, Math.round(best.t * 2) / 2));
  const c = spanAt(best.s, t, it.d / 2);
  return { x: c.x, y: c.y, rot: rotOf(best.s.n), wallId: best.s.wallId };
}

/** Line an item's edges up with a neighbour's on the same wall, when within 3 in. */
export function snapToNeighbours(items: DesignItem[], it: DesignItem): DesignItem {
  const { u } = frameOf(it);
  let best: { shift: number } | null = null;
  for (const o of items) {
    if (o.id === it.id || o.wallId !== it.wallId || !it.wallId || Math.abs(o.rot - it.rot) > 1) continue;
    const ta = dot({ x: it.x, y: it.y }, u);
    const tb = dot({ x: o.x, y: o.y }, u);
    for (const shift of [tb + o.w / 2 - (ta - it.w / 2), tb - o.w / 2 - (ta + it.w / 2)]) if (Math.abs(shift) <= 3 && (!best || Math.abs(shift) < Math.abs(best.shift))) best = { shift };
  }
  return best ? { ...it, x: it.x + u.x * best.shift, y: it.y + u.y * best.shift } : it;
}

