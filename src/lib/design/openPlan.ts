// CLOSING A ROOM OF AN OPEN PLAN (Home Design Studio, 2026-10-18). A kitchen that opens to a nook and a great room has
// no wall between them — the plan reads one space, or (on a sheet whose openings broke its walls) none — so "design the
// kitchen" found nothing to open. With the room's extent read from the picture (roughly), its sides are SNAPPED to the
// walls the read did find (a side within 30 in of a wall that runs along it becomes that wall), and only the stretches
// no wall covers get a ROOM BOUNDARY (Wall.boundary: a line on the floor, never built). Accepted only when it closes a
// room around the label of about the size the picture said. Pure.
import type { DesignDoc, P, Wall } from "./model";
import { DEFAULT_CEILING, newId } from "./model";
import { dist, pointInPoly, roomsOf } from "./geometry";

export type RoomBox = { x0: number; y0: number; x1: number; y1: number };

const SIDE_SNAP = 30; // inches: a wall this near a side of the extent, running along it, is that side
const ON_LINE = 3; // inches: a wall this near the side's line covers it
const GAP_MIN = 6; // inches: a shorter uncovered stretch is a joint, not an opening
const END_SNAP = 6; // inches: a boundary's end this near a wall's end joins it

type Line = { c: number; lo: number; hi: number };

export function closeRoom(doc: DesignDoc, at: P, box: RoomBox, ceiling = DEFAULT_CEILING, why?: (reason: string, tried?: DesignDoc) => void): DesignDoc | null {
  const walls = doc.walls;
  const axis = (w: Wall) => {
    const dx = Math.abs(w.b.x - w.a.x);
    const dy = Math.abs(w.b.y - w.a.y);
    return dx <= 0.17 * (dx + dy) ? "v" : dy <= 0.17 * (dx + dy) ? "h" : null;
  };
  const vert: Line[] = walls.filter((w) => axis(w) === "v").map((w) => ({ c: (w.a.x + w.b.x) / 2, lo: Math.min(w.a.y, w.b.y), hi: Math.max(w.a.y, w.b.y) }));
  const horz: Line[] = walls.filter((w) => axis(w) === "h").map((w) => ({ c: (w.a.y + w.b.y) / 2, lo: Math.min(w.a.x, w.b.x), hi: Math.max(w.a.x, w.b.x) }));
  // Each side to the nearest wall running along it (overlapping at least a quarter of the side).
  const snap = (lines: Line[], c: number, lo: number, hi: number) => {
    let best: { c: number; d: number } | null = null;
    for (const l of lines) {
      if (Math.min(hi, l.hi) - Math.max(lo, l.lo) < 0.25 * (hi - lo)) continue;
      const d = Math.abs(l.c - c);
      if (d <= SIDE_SNAP && (!best || d < best.d)) best = { c: l.c, d };
    }
    return best ? best.c : c;
  };
  let x0 = Math.min(box.x0, box.x1);
  let x1 = Math.max(box.x0, box.x1);
  let y0 = Math.min(box.y0, box.y1);
  let y1 = Math.max(box.y0, box.y1);
  if (x1 - x0 < 24 || y1 - y0 < 24) return why?.("tiny box"), null;
  x0 = snap(vert, x0, y0, y1);
  x1 = snap(vert, x1, y0, y1);
  y0 = snap(horz, y0, x0, x1);
  y1 = snap(horz, y1, x0, x1);
  if (!(at.x > x0 && at.x < x1 && at.y > y0 && at.y < y1)) return why?.(`label outside the snapped box ${JSON.stringify({ x0, y0, x1, y1, at })}`), null;

  // The wall ends a boundary may join.
  const ends: P[] = walls.flatMap((w) => [w.a, w.b]);
  const join = (p: P): P => {
    let best: P | null = null;
    let bd = END_SNAP;
    for (const e of ends) {
      const d = dist(e, p);
      if (d <= bd) {
        bd = d;
        best = e;
      }
    }
    return best ? { ...best } : p;
  };
  const add: Wall[] = [];
  const sides: Array<{ lines: Line[]; c: number; lo: number; hi: number; pt: (t: number) => P }> = [
    { lines: vert, c: x0, lo: y0, hi: y1, pt: (t) => ({ x: x0, y: t }) },
    { lines: vert, c: x1, lo: y0, hi: y1, pt: (t) => ({ x: x1, y: t }) },
    { lines: horz, c: y0, lo: x0, hi: x1, pt: (t) => ({ x: t, y: y0 }) },
    { lines: horz, c: y1, lo: x0, hi: x1, pt: (t) => ({ x: t, y: y1 }) },
  ];
  for (const s of sides) {
    const cover = s.lines
      .filter((l) => Math.abs(l.c - s.c) <= ON_LINE)
      .map((l) => [Math.max(s.lo, l.lo), Math.min(s.hi, l.hi)] as [number, number])
      .filter(([a, b]) => b > a)
      .sort((p, q) => p[0] - q[0]);
    let t = s.lo;
    const gaps: Array<[number, number]> = [];
    for (const [a, b] of cover) {
      if (a - t > GAP_MIN) gaps.push([t, a]);
      t = Math.max(t, b);
    }
    if (s.hi - t > GAP_MIN) gaps.push([t, s.hi]);
    for (const [a, b] of gaps) add.push({ id: newId("w"), a: join(s.pt(a)), b: join(s.pt(b)), thick: 1, height: ceiling, boundary: true });
  }
  if (!add.length) return why?.("no side left open"), null;
  const next: DesignDoc = { ...doc, walls: [...walls, ...add] };
  const room = roomsOf(next).find((r) => pointInPoly(at, r.poly));
  if (!room) return why?.(`no room around the label after ${add.length} boundaries · box ${[x0, y0, x1, y1].map(Math.round).join(",")}`, next), null;
  // About the size the picture said — not the whole floor leaking through a gap, not a sliver.
  const want = ((x1 - x0) * (y1 - y0)) / 144;
  if (room.sqft > want * 1.6 || room.sqft < want * 0.4) return why?.(`closed ${Math.round(room.sqft)} sq ft for a ${Math.round(want)} box`), null;
  return next;
}

/** EVERY ROOM THE PLAN NAMES, CLOSED (2026-10-18, owner: "build in 3D any room and start design"). A room its walls
 *  didn't close — open to the rooms beside it (a kitchen in a great room, a foyer open to the dining), or closed as
 *  one space with them — is closed
 *  where the picture of the plan puts it, room boundaries across its open sides. The smallest first: a kitchen
 *  inside a great room closes before the great room around it, which then closes on the kitchen's boundaries. A room
 *  already closed by its walls is left as the walls make it. `found`: the named rooms in sheet points, with the box
 *  the picture gave each; `region`/`k`: sheet points → plan inches. */
export function closeOpenRooms(
  doc: DesignDoc,
  found: ReadonlyArray<{ at: { x: number; y: number }; box?: RoomBox }>,
  region: { x: number; y: number },
  k: number,
  ceiling = DEFAULT_CEILING,
): DesignDoc {
  const toIn = (p: { x: number; y: number }): P => ({ x: (p.x - region.x) * k, y: (p.y - region.y) * k });
  const boxed = found
    .filter((f): f is { at: { x: number; y: number }; box: RoomBox } => !!f.box)
    .sort((a, b) => (a.box.x1 - a.box.x0) * (a.box.y1 - a.box.y0) - (b.box.x1 - b.box.x0) * (b.box.y1 - b.box.y0));
  let d = doc;
  const named = found.map((f) => toIn(f.at));
  for (const f of boxed) {
    const at = toIn(f.at);
    // Closed by its walls, and its own: left as it is. Closed but sharing one space with other named rooms (the
    // kitchen, nook and great room of an open plan read as one room): carved out of it.
    const holder = roomsOf(d).find((r) => pointInPoly(at, r.poly));
    if (holder && named.filter((p) => pointInPoly(p, holder.poly)).length <= 1) continue;
    const a = toIn({ x: f.box.x0, y: f.box.y0 });
    const b = toIn({ x: f.box.x1, y: f.box.y1 });
    const next = closeRoom(d, at, { x0: a.x, y0: a.y, x1: b.x, y1: b.y }, ceiling);
    if (next) d = next;
  }
  return d;
}
