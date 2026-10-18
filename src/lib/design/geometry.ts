// The room model's geometry (Home Design Studio, 2026-10-17): vectors, the rooms the walls close, where a point
// falls, and the wall outline with its openings cut — shared by the 2D plan, the 3D room and the plan reader.
// Inches, plan axes (x right, y down). Pure.
import type { DesignDoc, Opening, P, RoomLabel, Wall } from "./model";
import { DEFAULT_CEILING } from "./model";

export const sub = (a: P, b: P): P => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a: P, b: P): P => ({ x: a.x + b.x, y: a.y + b.y });
export const mulP = (a: P, k: number): P => ({ x: a.x * k, y: a.y * k });
export const dot = (a: P, b: P) => a.x * b.x + a.y * b.y;
export const cross = (a: P, b: P) => a.x * b.y - a.y * b.x;
export const len = (a: P) => Math.hypot(a.x, a.y);
export const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);
export const unit = (a: P): P => {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l };
};
/** The left normal of a direction (x right, y down: "left" walking along it). */
export const leftN = (d: P): P => ({ x: d.y, y: -d.x });

export const wallLen = (w: Pick<Wall, "a" | "b">) => dist(w.a, w.b);
export const wallDir = (w: Pick<Wall, "a" | "b">) => unit(sub(w.b, w.a));
/** A point `t` inches along the wall from a. */
export const along = (w: Pick<Wall, "a" | "b">, t: number): P => add(w.a, mulP(wallDir(w), t));

/** Where p lands on the segment a→b: the distance along it (clamped) and how far off it is. */
export function project(a: P, b: P, p: P): { t: number; off: number; at: P; tRaw: number } {
  const d = sub(b, a);
  const L = len(d) || 1;
  const u = { x: d.x / L, y: d.y / L };
  const tRaw = dot(sub(p, a), u);
  const t = Math.max(0, Math.min(L, tRaw));
  const at = add(a, mulP(u, t));
  return { t, off: dist(p, at), at, tRaw };
}

/** Intersection of two infinite lines (null when parallel). */
export function lineX(a1: P, a2: P, b1: P, b2: P): P | null {
  const r = sub(a2, a1);
  const s = sub(b2, b1);
  const den = cross(r, s);
  if (Math.abs(den) < 1e-9) return null;
  const t = cross(sub(b1, a1), s) / den;
  return add(a1, mulP(r, t));
}

export function polyArea(poly: P[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function pointInPoly(p: P, poly: P[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function centroid(poly: P[]): P {
  const A = polyArea(poly);
  if (Math.abs(A) < 1e-6) {
    const n = poly.length || 1;
    return { x: poly.reduce((s, p) => s + p.x, 0) / n, y: poly.reduce((s, p) => s + p.y, 0) / n };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  return { x: cx / (6 * A), y: cy / (6 * A) };
}

/* ── Rooms: the loops the walls close ──────────────────────────────────────────────────────────────────────────── */

export type Room = {
  /** The label that names it (null: an unnamed space). */
  labelId: string | null;
  name: string;
  /** Every label inside — an open kitchen + living space carries both. */
  names: string[];
  /** The loop along the wall CENTERLINES (positive shoelace area in plan axes). */
  poly: P[];
  /** The floor inside the walls (centerline area less half of each bounding wall) — sq ft. */
  sqft: number;
  ceiling: number;
  /** The walls on its edge. */
  wallIds: string[];
  key: string;
};

const SNAP = 1; // inches: two wall ends this close are one corner

/**
 * The rooms the walls enclose. Walls are split where another wall ends on them (a T), every corner is a node, and
 * the loops are walked keeping the wall on the right — the classic planar-face walk. The outside loop is dropped.
 */
export function roomsOf(doc: Pick<DesignDoc, "walls" | "labels">): Room[] {
  return facesOf(doc).rooms;
}

/** The rooms, and the walls on the outside loop(s). */
export function facesOf(doc: Pick<DesignDoc, "walls" | "labels">): { rooms: Room[]; outer: Set<string> } {
  const walls = doc.walls.filter((w) => wallLen(w) > 0.5);
  if (walls.length < 3) return { rooms: [], outer: new Set() };
  // Nodes: every wall end, merged when within SNAP.
  const nodes: P[] = [];
  const nodeOf = (p: P) => {
    for (let i = 0; i < nodes.length; i++) if (dist(nodes[i], p) <= SNAP) return i;
    nodes.push({ ...p });
    return nodes.length - 1;
  };
  type E = { a: number; b: number; wall: string };
  const ends = walls.map((w) => [nodeOf(w.a), nodeOf(w.b)] as const);
  // Split each wall at every node that lies on it (a T-junction, or a crossing wall's end).
  const edges: E[] = [];
  walls.forEach((w, i) => {
    const on: Array<{ t: number; n: number }> = [
      { t: 0, n: ends[i][0] },
      { t: wallLen(w), n: ends[i][1] },
    ];
    nodes.forEach((p, n) => {
      if (n === ends[i][0] || n === ends[i][1]) return;
      const pr = project(w.a, w.b, p);
      if (pr.off <= SNAP && pr.tRaw > SNAP && pr.tRaw < wallLen(w) - SNAP) on.push({ t: pr.tRaw, n });
    });
    on.sort((x, y) => x.t - y.t);
    for (let k = 1; k < on.length; k++) if (on[k].n !== on[k - 1].n) edges.push({ a: on[k - 1].n, b: on[k].n, wall: w.id });
  });
  // Outgoing half-edges per node, sorted by angle.
  const out = new Map<number, Array<{ to: number; ang: number; wall: string }>>();
  for (const e of edges) {
    for (const [u, v] of [
      [e.a, e.b],
      [e.b, e.a],
    ] as const) {
      const d = sub(nodes[v], nodes[u]);
      const list = out.get(u) ?? [];
      if (!list.some((h) => h.to === v)) list.push({ to: v, ang: Math.atan2(d.y, d.x), wall: e.wall });
      out.set(u, list);
    }
  }
  for (const l of out.values()) l.sort((x, y) => x.ang - y.ang);
  const used = new Set<string>();
  const faces: Array<{ nodes: number[]; walls: string[] }> = [];
  for (const [u0, list] of out) {
    for (const h0 of list) {
      const k0 = `${u0}>${h0.to}`;
      if (used.has(k0)) continue;
      const loop: number[] = [];
      const ws: string[] = [];
      let u = u0;
      let h = h0;
      for (let guard = 0; guard < 4000; guard++) {
        const key = `${u}>${h.to}`;
        if (used.has(key)) break;
        used.add(key);
        loop.push(u);
        ws.push(h.wall);
        const v = h.to;
        // Arriving at v from u: the next edge is the one just clockwise of the way back (keeps the face on the left).
        const back = Math.atan2(nodes[u].y - nodes[v].y, nodes[u].x - nodes[v].x);
        const cand = out.get(v) ?? [];
        let best = cand[0];
        let bestTurn = Infinity;
        for (const c of cand) {
          let turn = back - c.ang;
          while (turn <= 1e-9) turn += Math.PI * 2;
          if (c.to === u && cand.length > 1) turn = Math.PI * 2 + 1; // only go back on a dead end
          if (turn < bestTurn) {
            bestTurn = turn;
            best = c;
          }
        }
        u = v;
        h = best;
        if (u === u0 && h.to === h0.to) break;
      }
      if (loop.length >= 3) faces.push({ nodes: loop, walls: ws });
    }
  }
  const byId = new Map(walls.map((w) => [w.id, w]));
  // The outside loop of each building runs the other way round from its rooms: the biggest loop shows which way.
  const areas = faces.map((f) => polyArea(f.nodes.map((n) => nodes[n])));
  const biggest = areas.reduce((m, a, i) => (Math.abs(a) > Math.abs(areas[m]) ? i : m), 0);
  const outsideSign = Math.sign(areas[biggest] || 1);
  const rooms: Room[] = [];
  const outer = new Set<string>();
  faces.forEach((f, fi) => {
    const A = areas[fi];
    if (Math.sign(A) === outsideSign) {
      for (const w of f.walls) outer.add(w);
      return;
    }
    if (Math.abs(A) < 144 * 4) return; // a sliver under 4 sq ft
    const poly = f.nodes.map((n) => nodes[n]);
    // Floor inside the walls: centerline area less half of each bounding wall's thickness along its length here.
    let lessSq = 0;
    for (let i = 0; i < poly.length; i++) lessSq += dist(poly[i], poly[(i + 1) % poly.length]) * ((byId.get(f.walls[i])?.thick ?? 4.5) / 2);
    const ring = A > 0 ? poly : [...poly].reverse();
    const wallIds = [...new Set(f.walls)];
    const sqft = Math.max(0, (Math.abs(A) - lessSq) / 144);
    const inside = doc.labels.filter((l) => pointInPoly(l.at, ring));
    const first: RoomLabel | undefined = inside[0];
    rooms.push({
      labelId: first?.id ?? null,
      name: first?.name ?? "Room",
      names: inside.map((l) => l.name),
      poly: ring,
      sqft: Math.round(sqft * 10) / 10,
      ceiling: first?.ceiling ?? DEFAULT_CEILING,
      wallIds,
      key: wallIds.slice().sort().join("|"),
    });
  });
  // Unnamed spaces get a number; tiny ones (a chase, a shaft) stay but say so.
  let n = 1;
  for (const r of rooms) if (!r.labelId) r.name = r.sqft < 12 ? "Chase" : `Space ${n++}`;
  return { rooms, outer };
}

/** The room a label names, or the room holding a point. */
export const roomAt = (rooms: Room[], p: P) => rooms.find((r) => pointInPoly(p, r.poly)) ?? null;

/** The walls on the outside loop — exterior walls. */
export const outsideWallIds = (doc: Pick<DesignDoc, "walls" | "labels">): Set<string> => facesOf(doc).outer;

/* ── A wall's solid parts around its openings ──────────────────────────────────────────────────────────────────── */

export type WallPiece = { t0: number; t1: number; z0: number; z1: number };

/** The wall cut around its openings, as pieces along it (t, inches from a) and up it (z, inches from the floor). */
export function wallPieces(w: Wall, openings: Opening[]): WallPiece[] {
  const L = wallLen(w);
  const H = w.height;
  const ops = openings
    .filter((o) => o.wallId === w.id)
    .map((o) => ({ t0: Math.max(0, o.at - o.width / 2), t1: Math.min(L, o.at + o.width / 2), z0: o.sill, z1: Math.min(H, o.sill + o.height) }))
    .filter((o) => o.t1 - o.t0 > 0.5)
    .sort((x, y) => x.t0 - y.t0);
  const out: WallPiece[] = [];
  let t = 0;
  for (const o of ops) {
    if (o.t0 > t) out.push({ t0: t, t1: o.t0, z0: 0, z1: H });
    if (o.z0 > 0.5) out.push({ t0: o.t0, t1: o.t1, z0: 0, z1: o.z0 });
    if (o.z1 < H - 0.5) out.push({ t0: o.t0, t1: o.t1, z0: o.z1, z1: H });
    t = Math.max(t, o.t1);
  }
  if (t < L) out.push({ t0: t, t1: L, z0: 0, z1: H });
  return out;
}

/** The four corners of a wall's footprint (centerline ± half thickness), a→b on the left first. */
export function wallQuad(w: Pick<Wall, "a" | "b" | "thick">, t0 = 0, t1 = wallLen(w)): P[] {
  const d = wallDir(w);
  const n = mulP(leftN(d), w.thick / 2);
  const p0 = add(w.a, mulP(d, t0));
  const p1 = add(w.a, mulP(d, t1));
  return [add(p0, n), add(p1, n), sub(p1, n), sub(p0, n)];
}

/** The bounding box of every wall. */
export function planBounds(doc: Pick<DesignDoc, "walls">): { x: number; y: number; w: number; h: number } {
  if (!doc.walls.length) return { x: 0, y: 0, w: 240, h: 180 };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const w of doc.walls) for (const p of [w.a, w.b]) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
