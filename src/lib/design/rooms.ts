// EVERY ROOM, DESIGNED (Home Design Studio, 2026-10-18 — owner: "build in 3D any room and start design … make it
// a designer program, not only estimate"). What kind of room a name is, the pieces that room is furnished with, and
// a first layout a designer would sketch — laid on the room's own wall faces (kitchen.roomSpans), clear of its
// doors, inside its walls, nothing on top of anything else. The kitchen keeps its own layout (kitchen.autoKitchen).
// Pure.
import type { DesignDoc, DesignItem, P, RoomKind } from "./model";
import { newId } from "./model";
import { dot, pointInPoly, sub, wallDir, type Room } from "./geometry";
import { autoKitchen, cornersOf, overlaps, roomSpans, spanAt, type KitchenResult, type Span } from "./kitchen";
import { lib, newItemFrom } from "./library";
import { roomChecks } from "./checks";
import { roomKind } from "./roomKinds";

export type { RoomKind };
export { roomKind, kindOfRoom, KIND_LABEL } from "./roomKinds";

/** The library pieces a room of this kind is furnished from — first in the Add list. */
export const KIT: Record<RoomKind, string[]> = {
  kitchen: ["B", "SB", "W", "ISL", "RNG", "REF", "DW", "HD", "PEN", "STL", "TBL", "CHR"],
  bath: ["VAN", "WC", "TUB", "FTUB", "SHW", "MIR", "CAN", "RUG", "PLT"],
  bedroom: ["BED", "NS", "DRS", "SHF", "ARM", "BNC", "RUG", "PLT", "CAN"],
  living: ["SOFA", "ARM", "CTB", "STB", "TVC", "SHF", "RUG", "PLT", "CAN", "PEN"],
  dining: ["TBL", "CHR", "SBD", "PEN", "RUG", "PLT"],
  laundry: ["WSH", "DRY", "USK", "B", "W", "SHU"],
  office: ["DSK", "OCH", "SHF", "ARM", "RUG", "PLT"],
  closet: ["CLS", "SHU", "DRS", "BNC"],
  pantry: ["SHU", "CLS", "P"],
  entry: ["BNC", "CON", "PLT", "RUG", "SHU"],
  garage: ["WBN", "SHU", "USK"],
  outdoor: ["TBL", "CHR", "LNG", "GRL", "PLT"],
  other: ["SOFA", "ARM", "SHF", "RUG", "PLT"],
};

const CLEAR_OF_DOOR = 4; // inches past a door's jambs nothing stands against the wall
/** Pieces that tuck under a table or desk: their footprints may overlap it. */
const TUCKS = new Set(["CHR", "STL", "OCH"]);
const UNDER = new Set(["TBL", "DSK", "ISL", "CTB"]);
type Zone = { x: number; y: number; rot: number; w: number; d: number };

/** The way through each door and opening: its width, 30 in out on both sides (what checks.ts holds a room to). */
function doorZones(doc: DesignDoc, room: Room): Zone[] {
  const out: Zone[] = [];
  for (const o of doc.openings) {
    if (o.kind === "window" || !room.wallIds.includes(o.wallId)) continue;
    const w = doc.walls.find((x) => x.id === o.wallId);
    if (!w) continue;
    const d = wallDir(w);
    out.push({ x: w.a.x + d.x * o.at, y: w.a.y + d.y * o.at, rot: (Math.atan2(d.x, -d.y) * 180) / Math.PI, w: o.width, d: w.thick + 60 });
  }
  return out;
}

type Seg = { span: Span; t0: number; t1: number; windows: boolean };

/** The free stretches of each wall face: the face less its doors (and its windows, for anything tall). */
function freeSegs(spans: Span[], avoidWindows: boolean): Seg[] {
  const out: Seg[] = [];
  for (const s of spans) {
    const cuts: Array<[number, number]> = s.doors.map(([a, b]) => [a - CLEAR_OF_DOOR, b + CLEAR_OF_DOOR]);
    if (avoidWindows) for (const [a, b] of s.windows) cuts.push([a - 2, b + 2]);
    cuts.sort((x, y) => x[0] - y[0]);
    let t = 0;
    for (const [a, b] of cuts) {
      if (a - t >= 12) out.push({ span: s, t0: t, t1: a, windows: s.windows.some(([w0, w1]) => w1 > t && w0 < a) });
      t = Math.max(t, b);
    }
    if (s.len - t >= 12) out.push({ span: s, t0: t, t1: s.len, windows: s.windows.some(([w0, w1]) => w1 > t && w0 < s.len) });
  }
  return out.sort((x, y) => y.t1 - y.t0 - (x.t1 - x.t0));
}

const rotOf = (v: P) => Math.round(((Math.atan2(v.y, v.x) * 180) / Math.PI) * 100) / 100;

class Layout {
  items: DesignItem[] = [];
  notes: string[] = [];
  /** How far inside the loop (the walls' centerlines) their faces stand, less an inch of play. */
  private pad: number;
  constructor(
    private room: Room,
    private focus: string | null,
    private zones: Zone[] = [],
    halfWall = 2.25,
  ) {
    this.pad = Math.max(0, halfWall - 1);
  }
  /** A copy to try a placement on, without touching this one. */
  clone(): Layout {
    const c = new Layout(this.room, this.focus, this.zones);
    c.pad = this.pad;
    c.items = [...this.items];
    c.notes = [...this.notes];
    return c;
  }
  /** Take what a trial placed. */
  adopt(c: Layout) {
    this.items = c.items;
    this.notes = c.notes;
  }
  /** Inside the room's walls (their faces, not their centerlines), out of the doorways, clear of what's placed. */
  fits(it: DesignItem): boolean {
    const grown = cornersOf({ ...it, w: it.w + 2 * this.pad, d: it.d + 2 * this.pad });
    if (!grown.every((p) => pointInPoly(p, this.room.poly))) return false;
    // A rug lies under things; nothing else may overlap (a lamp above is a light, not checked).
    if (it.lib === "RUG") return true;
    const onFloor = it.z < 30 && lib(it.lib)?.cat !== "light";
    if (onFloor && this.zones.some((z) => overlaps(z, it, 1))) return false;
    return !this.items.some((o) => {
      if (o.lib === "RUG" || lib(o.lib)?.cat === "light") return false;
      if (o.z >= it.z + it.h || it.z >= o.z + o.h) return false;
      if ((TUCKS.has(it.lib) && UNDER.has(o.lib)) || (TUCKS.has(o.lib) && UNDER.has(it.lib))) return false;
      return overlaps(o, it);
    });
  }
  make(id: string, at: P, rot: number, w?: number, d?: number, wallId: string | null = null): DesignItem | null {
    const it = newItemFrom(id, { x: at.x, y: at.y, rot, wallId, room: this.focus }, newId("i"), w);
    if (!it) return null;
    if (d) it.d = d;
    return it;
  }
  /** Put it if it fits; true when placed. */
  put(it: DesignItem | null): DesignItem | null {
    if (!it || !this.fits(it)) return null;
    this.items.push(it);
    return it;
  }
  /** Against a wall face, its back to the face, centred at t (or at the stretch's middle). */
  onWall(id: string, seg: Seg, t: number | null, w?: number, d?: number): DesignItem | null {
    const e = lib(id);
    if (!e) return null;
    const ww = w ?? e.w;
    const dd = d ?? e.d;
    const tc = t ?? (seg.t0 + seg.t1) / 2;
    if (tc - ww / 2 < seg.t0 - 0.5 || tc + ww / 2 > seg.t1 + 0.5) return null;
    return this.put(this.make(id, spanAt(seg.span, tc, dd / 2), rotOf(seg.span.n), ww, dd, seg.span.wallId));
  }
  /** The stretches of a free wall face that nothing placed stands in front of (within `depth` in of the face). A
   *  toilet keeps 15 in each side of its center (IRC R307.1). Longest first. */
  runs(seg: Seg, depth: number): Seg[] {
    const cuts: Array<[number, number]> = [];
    for (const o of this.items) {
      if (o.lib === "RUG" || lib(o.lib)?.cat === "light" || o.z >= 40) continue;
      const cs = cornersOf(o);
      const ds = cs.map((p) => dot(sub(p, seg.span.a), seg.span.n));
      if (Math.min(...ds) > depth) continue;
      const ts = cs.map((p) => dot(sub(p, seg.span.a), seg.span.dir));
      let a = Math.min(...ts);
      let b = Math.max(...ts);
      if (o.lib === "WC") {
        const c = (a + b) / 2;
        a = Math.min(a, c - 16);
        b = Math.max(b, c + 16);
      }
      cuts.push([a, b]);
    }
    cuts.sort((x, y) => x[0] - y[0]);
    const out: Seg[] = [];
    let t = seg.t0;
    for (const [a, b] of cuts) {
      if (b <= t) continue;
      if (a - t >= 12) out.push({ ...seg, t0: t, t1: Math.min(a, seg.t1) });
      t = Math.max(t, b);
      if (t >= seg.t1) break;
    }
    if (seg.t1 - t >= 12) out.push({ ...seg, t0: t, t1: seg.t1 });
    return out.filter((r) => r.t1 - r.t0 >= 12).sort((x, y) => y.t1 - y.t0 - (x.t1 - x.t0));
  }
  /** The widest of `widths` that fits the stretch with `spare` inches left over. */
  static widest(widths: number[], room: number, spare = 0): number | null {
    return [...widths].sort((a, b) => b - a).find((w) => w + spare <= room) ?? null;
  }
}

/** The room's bounding box, inches. */
function boxOf(room: Room) {
  const xs = room.poly.map((p) => p.x);
  const ys = room.poly.map((p) => p.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const x1 = Math.max(...xs);
  const y1 = Math.max(...ys);
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, c: { x: (x0 + x1) / 2, y: (y0 + y1) / 2 } };
}

/** In front of an item (along its front), `gap` inches past its front edge, for a piece `d` deep. */
const inFront = (it: DesignItem, gap: number, d: number): P => {
  const r = (it.rot * Math.PI) / 180;
  const f = { x: Math.cos(r), y: Math.sin(r) };
  const k = it.d / 2 + gap + d / 2;
  return { x: it.x + f.x * k, y: it.y + f.y * k };
};
/** Beside an item (along its width), `gap` inches past its side, for a piece `w` wide. */
const beside = (it: DesignItem, side: -1 | 1, gap: number, w: number): P => {
  const r = (it.rot * Math.PI) / 180;
  const u = { x: -Math.sin(r), y: Math.cos(r) };
  const k = side * (it.w / 2 + gap + w / 2);
  return { x: it.x + u.x * k, y: it.y + u.y * k };
};

/* ── The layouts ─────────────────────────────────────────────────────────────────────────────────────────────── */

function bedroom(L: Layout, room: Room, spans: Span[]) {
  const b = boxOf(room);
  const short = Math.min(b.w, b.h);
  const want = short >= 150 ? 76 : short >= 118 ? 60 : short >= 104 ? 54 : 39;
  const depth = want >= 60 ? 80 : 75;
  // The headboard on the longest free wall, a window over it only when no wall without one is long enough.
  const segs = freeSegs(spans, false);
  let bed: DesignItem | null = null;
  for (const pass of [false, true]) {
    for (const seg of segs) {
      if (!pass && seg.windows) continue;
      const room2 = seg.t1 - seg.t0;
      const w = Layout.widest([76, 60, 54, 39].filter((x) => x <= want), room2, 2 * 22 + 6) ?? Layout.widest([76, 60, 54, 39].filter((x) => x <= want), room2, 2);
      if (!w) continue;
      const tc = (seg.t0 + seg.t1) / 2;
      bed = L.onWall("BED", seg, tc, w, w === 39 || w === 54 ? 75 : depth);
      if (bed) {
        // At the headboard, on the wall — not at the bed's middle.
        for (const side of [-1, 1] as const) L.onWall("NS", seg, tc + side * (w / 2 + 2 + 11), 22, 16);
        L.put(L.make("RUG", inFront(bed, -bed.d * 0.62, 72), bed.rot, Math.min(120, bed.w + 48), 72));
        break;
      }
    }
    if (bed) break;
  }
  if (!bed) L.notes.push("No wall here is long enough for a bed and its nightstands — place one by hand.");
  // The dresser on another wall, clear of the windows.
  for (const seg of freeSegs(spans, true)) {
    if (bed && seg.span.wallId === bed.wallId) continue;
    const w = Layout.widest([72, 60, 48, 36], seg.t1 - seg.t0, 4);
    if (w && L.onWall("DRS", seg, null, w)) break;
  }
}

function bath(L: Layout, room: Room, spans: Span[], doc: DesignDoc) {
  const b = boxOf(room);
  const short = Math.min(b.w, b.h);
  const full = !/powder|half\s*bath/i.test(room.name);
  const segs = freeSegs(spans, false);
  // Every arrangement worth trying: the tub (or a shower) into each free corner, or none; with it, every spot the
  // toilet could take (18 in from a side wall — 15 in to its center is the code's least — or mid-wall); then the
  // widest vanity what's left holds, a mirror over it. Each is held to the code (IRC R307.1 clearances, the doorways)
  // and the best kept: the code met, a tub before a shower, the widest vanity. A powder room's vanity stops at 36 in.
  type Wet = { id: "TUB" | "SHW"; seg: Seg; t: number } | null;
  const wets: Wet[] = [];
  if (full && short >= 60) for (const seg of segs) if (seg.t1 - seg.t0 >= 60) wets.push({ id: "TUB", seg, t: seg.t0 + 30 }, { id: "TUB", seg, t: seg.t1 - 30 });
  if (full && short >= 40) for (const seg of segs) if (seg.t1 - seg.t0 >= 36) wets.push({ id: "SHW", seg, t: seg.t0 + 18 }, { id: "SHW", seg, t: seg.t1 - 18 });
  wets.push(null);
  // A powder room takes the slimmer vanities: 18 in deep, down to 18 in wide (12 in deep for an 18).
  const widths = full ? [72, 60, 48, 36, 30, 24] : [36, 30, 24, 18];
  const depthOf = (w: number) => (full ? 21 : w <= 18 ? 12 : 18);
  const vanityOn = (T: Layout): DesignItem | null => {
    const open = freeSegs(spans, false)
      .flatMap((seg) => T.runs(seg, full ? 22 : 19))
      .sort((x, y) => y.t1 - y.t0 - (x.t1 - x.t0));
    for (const run of open) {
      const w = Layout.widest(widths, run.t1 - run.t0, 2);
      if (!w) continue;
      const tc = (run.t0 + run.t1) / 2;
      const v = T.onWall("VAN", run, tc, w, depthOf(w));
      if (v) {
        T.put(T.make("MIR", spanAt(run.span, tc, 0.5), v.rot, Math.min(w, 60), 1, run.span.wallId));
        return v;
      }
    }
    return null;
  };
  const others = (doc.items ?? []).filter((i) => i.room !== room.labelId);
  const faults = (T: Layout) =>
    room.labelId
      ? roomChecks({ ...doc, items: [...others, ...T.items.map((i) => ({ ...i, room: room.labelId }))] }, room.labelId).filter((c) => !c.ok && (c.level === "code" || c.level === "fit")).length
      : 0;
  let best: { T: Layout; wc: DesignItem | null; van: DesignItem | null; score: number } | null = null;
  for (const wet of wets) {
    const W0 = L.clone();
    const placedWet = wet ? (wet.id === "TUB" ? W0.onWall("TUB", wet.seg, wet.t, 60, 30) : W0.onWall("SHW", wet.seg, wet.t, 36, 36)) : null;
    if (wet && !placedWet) continue;
    const wcSpots = freeSegs(spans, false).flatMap((seg) => [seg.t0 + 18, seg.t1 - 18, (seg.t0 + seg.t1) / 2].map((t) => ({ seg, t })));
    for (const spot of [...wcSpots, null]) {
      const T = W0.clone();
      const wc = spot ? T.onWall("WC", spot.seg, spot.t) : null;
      if (spot && !wc) continue;
      const van = vanityOn(T);
      const score = -1000 * faults(T) + (placedWet ? (placedWet.lib === "TUB" ? 300 : 250) : 0) + (wc ? 200 : 0) + (van ? 100 + van.w : 0);
      if (!best || score > best.score) best = { T, wc, van, score };
    }
  }
  if (!best) return;
  L.adopt(best.T);
  const { wc, van } = best;
  if (!van) L.notes.push("No free wall for a vanity — place one by hand.");
  if (!wc) L.notes.push("The toilet needs 30 in of wall clear of the door — place it by hand.");
}

function living(L: Layout, room: Room, spans: Span[]) {
  const dirOf = (rot: number) => ({ x: Math.cos((rot * Math.PI) / 180), y: Math.sin((rot * Math.PI) / 180) });
  // The sofa and the TV as a pair: the sofa on a free wall, the TV on a wall facing it and in front of it, about
  // twice the screen's diagonal away. A long room (a great room) has no such pair: there the sofa floats out toward
  // the TV instead of watching from 20 ft.
  type Pick = { T: Layout; sofa: DesignItem; tv: DesignItem | null; score: number };
  let best: Pick | null = null;
  const consider = (p: Pick) => {
    if (!best || p.score < best.score) best = p;
  };
  for (const seg of freeSegs(spans, false)) {
    const w = Layout.widest([96, 84, 72, 60], seg.t1 - seg.t0, 12);
    if (!w) continue;
    const T0 = L.clone();
    const sofa = T0.onWall("SOFA", seg, null, w);
    if (!sofa) continue;
    const fs = dirOf(sofa.rot);
    const us = { x: -fs.y, y: fs.x };
    consider({ T: T0, sofa, tv: null, score: 1e6 - w });
    for (const tseg of spans.filter((sp) => sp.n.x * fs.x + sp.n.y * fs.y < -0.8).flatMap((sp) => freeSegs([sp], false))) {
      const tw = Layout.widest([72, 60, 48], tseg.t1 - tseg.t0, 4);
      if (!tw) continue;
      const T = T0.clone();
      const tv = T.onWall("TVC", tseg, null, tw);
      if (!tv) continue;
      const rel = { x: tv.x - sofa.x, y: tv.y - sofa.y };
      // In front of the sofa, not off to one side.
      if (Math.abs(rel.x * us.x + rel.y * us.y) > sofa.w / 2) continue;
      const diag = Math.min(65, tw - 4);
      // From the sofa to the screen (at the console's back).
      const dist = rel.x * fs.x + rel.y * fs.y - tv.d / 2;
      if (dist <= diag * 3) {
        consider({ T, sofa, tv, score: Math.abs(dist - diag * 2.2) - tw / 10 });
        continue;
      }
      // Too far: float the sofa toward the TV, its back to the room.
      const T2 = T0.clone();
      T2.items = T2.items.filter((i) => i !== sofa);
      const tv2 = T2.onWall("TVC", tseg, null, tw);
      if (!tv2) continue;
      const tf = dirOf(tv2.rot);
      for (const m of [2.2, 2.6, 3]) {
        const k = diag * m + tv2.d / 2;
        const moved = T2.put(T2.make("SOFA", { x: tv2.x + tf.x * k, y: tv2.y + tf.y * k }, tv2.rot + 180, sofa.w, sofa.d));
        if (moved) {
          consider({ T: T2, sofa: moved, tv: tv2, score: 40 + Math.abs(m - 2.2) * 10 - tw / 10 });
          break;
        }
      }
    }
  }
  let sofa: DesignItem | null = null;
  let tv: DesignItem | null = null;
  if (best) {
    const pick: Pick = best;
    L.adopt(pick.T);
    sofa = pick.sofa;
    tv = pick.tv;
  } else {
    // An open plan's living room may have no free wall: float the sofa in the room, facing its middle.
    const b = boxOf(room);
    sofa = L.put(L.make("SOFA", { x: b.c.x, y: b.c.y + Math.min(60, b.h / 4) }, -90, 84));
  }
  if (!sofa) return void L.notes.push("No room for a sofa here — place one by hand.");
  const ctb = L.put(L.make("CTB", inFront(sofa, 18, 24), sofa.rot, Math.min(54, Math.max(36, sofa.w * 0.55)), 24));
  const anchor = ctb ?? sofa;
  for (const side of [-1, 1] as const) {
    const at = beside(anchor, side, 18, 34);
    // Turned to face the coffee table: the one on the −u side looks along +u.
    L.put(L.make("ARM", at, sofa.rot + (side === -1 ? 90 : -90), 32, 34));
  }
  L.put(L.make("RUG", ctb ? { x: ctb.x, y: ctb.y } : inFront(sofa, 24, 72), sofa.rot, Math.min(120, sofa.w + 24), 96));
  if (!tv) L.notes.push("No wall faces the sofa for a TV — add one where it suits.");
  // A plant in a corner.
  for (const seg of freeSegs(spans, true)) if (L.onWall("PLT", seg, seg.t0 + 10)) break;
}

function dining(L: Layout, room: Room, spans: Span[]) {
  const b = boxOf(room);
  // Inside the walls' faces, roughly (the loop runs on their centerlines).
  const long = Math.max(b.w, b.h) - 6;
  const short = Math.min(b.w, b.h) - 6;
  // The table along the room's long way, 36 in round it.
  const len = Layout.widest([96, 84, 72, 60, 48], long - 72) ?? 42;
  const wid = short - 72 >= 42 ? 42 : 36;
  // Its width runs along the item's u axis: rot 90 puts u along x.
  const along = b.w >= b.h;
  const rot = along ? 90 : 0;
  // A sideboard on a long wall first, when the room has its 18 in as well as 36 in each side of the table — the
  // table then sits half the sideboard's depth off the middle, away from it.
  let at = b.c;
  if (short - wid - 72 >= 18) {
    for (const seg of freeSegs(spans, true)) {
      const across = along ? Math.abs(seg.span.n.y) > 0.7 : Math.abs(seg.span.n.x) > 0.7;
      const w = across ? Layout.widest([72, 60, 48], seg.t1 - seg.t0, 6) : null;
      if (w && L.onWall("SBD", seg, null, w)) {
        at = { x: b.c.x + seg.span.n.x * 9.5, y: b.c.y + seg.span.n.y * 9.5 };
        break;
      }
    }
  }
  const table = L.put(L.make("TBL", at, rot, len, wid));
  if (!table) return void L.notes.push("The table doesn't fit inside the walls here — place it by hand.");
  const perSide = Math.max(1, Math.min(4, Math.floor(len / 24)));
  for (const side of [-1, 1] as const) {
    for (let i = 0; i < perSide; i++) {
      const t = -len / 2 + (len / perSide) * (i + 0.5);
      const r = (rot * Math.PI) / 180;
      const f = { x: Math.cos(r), y: Math.sin(r) };
      const u = { x: -Math.sin(r), y: Math.cos(r) };
      // Pulled in: the seat's front 2 in under the table's edge.
      const c = { x: table.x + u.x * t + f.x * side * (wid / 2 + 8), y: table.y + u.y * t + f.y * side * (wid / 2 + 8) };
      L.put(L.make("CHR", c, rot + (side === 1 ? 180 : 0), 18, 20));
    }
  }
  for (const side of [-1, 1] as const) L.put(L.make("CHR", beside(table, side, -2, 20), rot + (side === -1 ? 90 : -90), 18, 20));
}

function laundry(L: Layout, _room: Room, spans: Span[]) {
  for (const seg of freeSegs(spans, false)) {
    if (seg.t1 - seg.t0 < 55) continue;
    const t0 = seg.t0 + 13.5;
    const w = L.onWall("WSH", seg, t0);
    const d = w ? L.onWall("DRY", seg, t0 + 28) : null;
    if (w && d) {
      if (seg.t1 - seg.t0 >= 55 + 26) L.onWall("USK", seg, t0 + 28 + 26);
      return;
    }
  }
  L.notes.push("No 55 in of free wall for a washer and dryer side by side — place them by hand.");
}

function office(L: Layout, _room: Room, spans: Span[]) {
  // The desk under the window when there is one — the light falls on the work.
  const segs = freeSegs(spans, false).sort((a, b) => Number(b.windows) - Number(a.windows));
  let desk: DesignItem | null = null;
  for (const seg of segs) {
    const w = Layout.widest([60, 48, 42], seg.t1 - seg.t0, 4);
    if (w && (desk = L.onWall("DSK", seg, null, w))) break;
  }
  if (desk) L.put(L.make("OCH", inFront(desk, 2, 24), desk.rot + 180, 24, 24));
  for (const seg of freeSegs(spans, true)) {
    if (desk && seg.span.wallId === desk.wallId) continue;
    if (L.onWall("SHF", seg, null, Layout.widest([36, 30, 24], seg.t1 - seg.t0, 2) ?? 24)) break;
  }
  L.put(L.make("RUG", desk ? inFront(desk, 18, 60) : boxOf(_room).c, desk?.rot ?? 0, 72, 60));
}

function closet(L: Layout, _room: Room, spans: Span[]) {
  let n = 0;
  for (const seg of freeSegs(spans, false)) {
    const w = Math.floor((seg.t1 - seg.t0 - 2) / 12) * 12;
    if (w >= 24 && L.onWall("CLS", seg, null, Math.min(120, w))) n++;
    if (n >= 3) break;
  }
  if (!n) L.notes.push("No wall long enough for a rod and shelf — place one by hand.");
}

function pantry(L: Layout, _room: Room, spans: Span[]) {
  for (const seg of freeSegs(spans, false)) {
    const w = Layout.widest([48, 36], seg.t1 - seg.t0, 2);
    if (w) L.onWall("SHU", seg, null, w);
  }
}

function entry(L: Layout, _room: Room, spans: Span[]) {
  for (const seg of freeSegs(spans, true)) {
    const w = Layout.widest([60, 48, 36], seg.t1 - seg.t0, 6);
    if (w && L.onWall("CON", seg, null, w)) break;
  }
  for (const seg of freeSegs(spans, true)) if (L.onWall("PLT", seg, seg.t1 - 10)) break;
}

function garage(L: Layout, _room: Room, spans: Span[]) {
  // The workbench on the longest wall without a door, shelving beside it.
  for (const seg of freeSegs(spans, true)) {
    const w = Layout.widest([96, 72, 48], seg.t1 - seg.t0, 54);
    if (!w) continue;
    const bench = L.onWall("WBN", seg, seg.t0 + w / 2 + 2, w);
    if (bench) {
      L.onWall("SHU", seg, seg.t0 + w + 2 + 2 + 24, 48);
      break;
    }
  }
}

function outdoor(L: Layout, room: Room, spans: Span[]) {
  const b = boxOf(room);
  // Two zones along the long way: a table for four at one end (36 in round it), two loungers past it.
  const along = b.w >= b.h;
  const start = (along ? b.x0 : b.y0) + 3.25;
  const end = (along ? b.x1 : b.y1) - 3.25;
  const mid = along ? b.c.y : b.c.x;
  const pt = (t: number) => (along ? { x: t, y: mid } : { x: mid, y: t });
  const tableAt = start + 36 + 30;
  const table = L.put(L.make("TBL", pt(tableAt), along ? 90 : 0, 60, 36));
  if (table) {
    const r = (table.rot * Math.PI) / 180;
    const f = { x: Math.cos(r), y: Math.sin(r) };
    const u = { x: -Math.sin(r), y: Math.cos(r) };
    for (const side of [-1, 1] as const)
      for (const t of [-15, 15]) L.put(L.make("CHR", { x: table.x + u.x * t + f.x * side * 26, y: table.y + u.y * t + f.y * side * 26 }, table.rot + (side === 1 ? 180 : 0), 18, 20));
  }
  // Loungers lie across the long way, side by side, 36 in past the table.
  let t = tableAt + 30 + 36;
  for (let i = 0; i < 2 && t + 26 <= end; i++, t += 26 + 12) L.put(L.make("LNG", pt(t + 13), along ? 90 : 0, 26, 72));
  // The grill against a wall at the far end, clear of the loungers.
  for (const seg of freeSegs(spans, true).filter((sg) => (along ? Math.abs(sg.span.n.y) > 0.7 : Math.abs(sg.span.n.x) > 0.7)))
    if (L.onWall("GRL", seg, seg.t1 - 31) ?? L.onWall("GRL", seg, seg.t0 + 31)) break;
}

export type FurnishResult = KitchenResult & { kind: RoomKind };

/** A first layout for the room, as a designer would sketch it. The kitchen keeps its own. */
export function autoFurnish(doc: DesignDoc, room: Room, focus: string | null, kind: RoomKind = roomKind(room.name)): FurnishResult {
  if (kind === "kitchen") return { ...autoKitchen(doc, room, focus), kind };
  const halfWall = Math.min(...room.wallIds.map((id) => (doc.walls.find((w) => w.id === id)?.thick ?? 4.5) / 2));
  const L = new Layout(room, focus, doorZones(doc, room), Number.isFinite(halfWall) ? halfWall : 2.25);
  const spans = roomSpans(doc, room);
  ({ bath, bedroom, living, dining, laundry, office, closet, pantry, entry, garage, outdoor, other: living } as Record<Exclude<RoomKind, "kitchen">, (l: Layout, r: Room, s: Span[], d: DesignDoc) => void>)[kind](L, room, spans, doc);
  if (!L.items.length && !L.notes.length) L.notes.push("Nothing fit on its own here — add pieces from the Add tab.");
  return { items: L.items, notes: L.notes, kind };
}

const PIECE_WORDS: Record<string, (i: DesignItem) => string> = {
  VAN: (i) => `${i.w} in vanity`,
  WC: () => "toilet",
  TUB: () => "tub",
  FTUB: () => "freestanding tub",
  SHW: (i) => `${i.w} × ${i.d} in shower`,
  MIR: () => "mirror",
  BED: (i) => (i.w >= 76 ? "king bed" : i.w >= 72 ? "California king bed" : i.w >= 60 ? "queen bed" : i.w >= 54 ? "full bed" : "twin bed"),
  NS: () => "nightstand",
  DRS: (i) => `${i.w} in dresser`,
  SOFA: (i) => `${i.w} in sofa`,
  ARM: () => "armchair",
  CTB: () => "coffee table",
  TVC: () => "TV console",
  RUG: () => "rug",
  PLT: () => "plant",
  TBL: (i) => `${i.w} × ${i.d} in table`,
  CHR: () => "chair",
  SBD: () => "sideboard",
  WSH: () => "washer",
  DRY: () => "dryer",
  USK: () => "utility sink",
  DSK: (i) => `${i.w} in desk`,
  OCH: () => "desk chair",
  SHF: () => "bookshelf",
  CLS: (i) => `${i.w} in rod and shelf`,
  SHU: () => "shelving unit",
  WBN: (i) => `${i.w} in workbench`,
  LNG: () => "lounge chair",
  GRL: () => "grill",
  CON: () => "console table",
  BNC: () => "bench",
};

/** In words, what a layout placed: "Laid out: a queen bed, 2 nightstands and a 60 in dresser." */
export function furnishedSummary(items: DesignItem[]): string {
  const groups = new Map<string, number>();
  for (const it of items) {
    const say = PIECE_WORDS[it.lib]?.(it) ?? lib(it.lib)?.name.toLowerCase() ?? it.lib;
    groups.set(say, (groups.get(say) ?? 0) + 1);
  }
  const many = (w: string) => (w.includes("rod and shelf") ? w.replace("rod and shelf", "rods and shelves") : /(sh|ch)$/.test(w) ? `${w}es` : `${w}s`);
  const one = (w: string) => `${/^[aeiou8]/i.test(w) || /^(11|18)\b/.test(w) ? "an" : "a"} ${w}`;
  const parts = [...groups].map(([w, n]) => (n > 1 ? `${n}${/^\d/.test(w) ? " ×" : ""} ${many(w)}` : one(w)));
  if (!parts.length) return "";
  return `Laid out: ${parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0]}.`;
}
