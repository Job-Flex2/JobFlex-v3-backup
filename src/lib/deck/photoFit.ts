// THE SMART FIT — the deck finds the wall by itself (2026-10-10). Pure.
//
// Owner: "when I upload a picture of the house where the deck is supposed to
// be, it should find by itself where it's supposed to be — that wall on the
// picture — and if there is a jog on the house, an L shape, it should
// identify that and fit in; address the windows' height and everything you
// see on the wall; the picture adapted so only the wall is on the screen."
// And the same evening: "the door can be in the jog" — a back door is often
// in the recessed part of the wall, under the upper floor or a roof.
//
// The vision model reads the picture once (actions/deckEstimator readDeckPhoto)
// and answers with the wall's geometry as fractions of the picture: where
// the wall meets the ground, its eave, any jog, the back door, the windows,
// a patio, and any black bars or a phone's status bar around the picture.
// Everything after that is arithmetic here, so the same read always places
// the deck the same way and the QA script can prove it:
//
//   · the SCALE — pixels per foot — from the back door (80 in. is the door
//     every house has) or, failing that, the wall's height to the eave;
//   · the WALL'S PARTS — between its steps, each nearer or farther than the
//     last; the farthest is the recess a covered patio and its door sit in;
//   · the CROP — the wall and what will stand against it, the bars gone;
//   · the PLACEMENT — the elevation's ground line on the wall's base, the
//     deck centred on the door, else in the recess, else on the patio, as
//     wide as its feet say at that scale; an L's back notch set on the step
//     it wraps;
//   · the HEIGHT the door asks for — its threshold above the ground is where
//     the deck's floor belongs — and whether a window sill is in the way;
//   · an OFFER when the house steps into the deck: notch the deck around
//     the step, or fit it into the recess.
//
// Fractions throughout: x to the right, y down, 0…1 of the picture they
// were read on. The studio crops the picture to `crop`, keeps the placement
// in the cropped picture's own fractions, and keeps the read itself said in
// those fractions (`readInCrop`), so a later fit — after a shape change, or
// the 3D's picture of the wall — needs no second read.

import type { DeckPhoto, DeckShape, NotchCorner } from "./design";

export interface Pt {
  x: number;
  y: number;
}

export interface ScaleLine {
  a: Pt;
  b: Pt;
  lengthIn: number;
}

export interface WallJog {
  x: number;
  y: number;
  /** Which way the part of the wall to the RIGHT of the step goes: toward the camera (a bump-out) or away (a recess). */
  dir: "toward" | "away";
  depthFt: number | null;
}

/** What the vision model reads off the picture, validated. */
export interface WallRead {
  /** The wall's bottom edge, where it meets the ground (or the slab there), left end and right end. */
  base: { left: Pt; right: Pt };
  /** The top of that wall above each base end — the eave, or the top of the first storey. */
  eave: { left: Pt; right: Pt } | null;
  storeys: 1 | 2 | null;
  /** Where the wall steps (an L-shaped house, a bump-out, a covered patio), left to right. */
  jogs: WallJog[];
  /** The back door in that wall (a sliding or patio door), if seen. */
  door: { x0: number; x1: number; bottom: number; top: number } | null;
  windows: Array<{ x0: number; x1: number; sill: number; head: number }>;
  /** A patio or slab at the wall's base, if seen: its left and right ends. */
  patio: { x0: number; x1: number } | null;
  /** A line the contractor drew on the picture as a measure: two ends and the real length between them. Null unless drawn. */
  scaleLine: ScaleLine | null;
  /** Black bands or a phone's status bar at the top and the bottom, as fractions of the height. */
  bars: { top: number; bottom: number };
  confidence: number;
  note: string | null;
}

/** The door every house has: 6 ft 8 in. */
export const DOOR_HEIGHT_FT = 80 / 12;
/** A storey of wall to the eave when there is no door to measure by. */
export const STOREY_FT = 9;
/** A step in the wall the model saw but could not size. */
export const JOG_DEFAULT_FT = 2;
/** A read this unsure is shown, not trusted: the outline is centred and the contractor drags it. */
export const MIN_CONFIDENCE = 0.35;

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const frac = (v: unknown, d: number) => clamp(num(v, d), -0.5, 1.5);
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const half = (n: number) => Math.round(n * 2) / 2;
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const pt = (v: unknown): Pt | null => {
  const o = obj(v);
  if (typeof o.x !== "number" || typeof o.y !== "number" || !Number.isFinite(o.x) || !Number.isFinite(o.y)) return null;
  return { x: frac(o.x, 0), y: frac(o.y, 0) };
};
const span = (v: unknown, minW: number): { x0: number; x1: number } | null => {
  const o = obj(v);
  if (typeof o.x0 !== "number" || typeof o.x1 !== "number" || !Number.isFinite(o.x0) || !Number.isFinite(o.x1)) return null;
  const x0 = frac(Math.min(o.x0, o.x1), 0);
  const x1 = frac(Math.max(o.x0, o.x1), 0);
  return x1 - x0 >= minW ? { x0, x1 } : null;
};

/** The model's JSON, checked field by field; null when there is no usable wall in it. */
export function parseWallRead(raw: unknown): WallRead | null {
  const r = obj(raw);
  const base = obj(r.base);
  const left = pt(base.left);
  const right = pt(base.right);
  if (!left || !right) return null;
  // Left is left: a read with the ends swapped is turned around, not refused.
  const [bl, br] = left.x <= right.x ? [left, right] : [right, left];
  if (br.x - bl.x < 0.08) return null;
  const e = obj(r.eave);
  const el = pt(e.left);
  const er = pt(e.right);
  const eave = el && er && el.y < bl.y - 0.03 && er.y < br.y - 0.03 ? { left: el.x <= er.x ? el : er, right: el.x <= er.x ? er : el } : null;
  const storeys = r.storeys === 2 ? 2 : r.storeys === 1 ? 1 : null;
  const jogs: WallJog[] = (Array.isArray(r.jogs) ? r.jogs : [])
    .map((j) => {
      const o = obj(j);
      if (typeof o.x !== "number" || !Number.isFinite(o.x)) return null;
      const x = frac(o.x, 0);
      if (x <= bl.x + 0.02 || x >= br.x - 0.02) return null;
      const t = (x - bl.x) / (br.x - bl.x);
      const y = typeof o.y === "number" && Number.isFinite(o.y) ? frac(o.y, 0) : bl.y + (br.y - bl.y) * t;
      const depthFt = typeof o.depthFt === "number" && Number.isFinite(o.depthFt) && o.depthFt > 0 ? clamp(o.depthFt, 0.5, 40) : null;
      return { x, y, dir: o.dir === "away" ? ("away" as const) : ("toward" as const), depthFt };
    })
    .filter((j): j is WallJog => !!j)
    .sort((a, b) => a.x - b.x)
    .slice(0, 4);
  const d = obj(r.door);
  const doorSpan = span(r.door, 0.015);
  const door =
    doorSpan && typeof d.bottom === "number" && typeof d.top === "number" && Number.isFinite(d.bottom) && Number.isFinite(d.top)
      ? (() => {
          const bottom = frac(Math.max(d.bottom as number, d.top as number), 0);
          const top = frac(Math.min(d.bottom as number, d.top as number), 0);
          // A door is taller than it is wide, and it stands on the wall.
          return bottom - top >= 0.04 && doorSpan.x0 >= bl.x - 0.05 && doorSpan.x1 <= br.x + 0.05 ? { ...doorSpan, bottom, top } : null;
        })()
      : null;
  const windows = (Array.isArray(r.windows) ? r.windows : [])
    .map((w) => {
      const o = obj(w);
      const s = span(w, 0.01);
      if (!s || typeof o.sill !== "number" || typeof o.head !== "number" || !Number.isFinite(o.sill) || !Number.isFinite(o.head)) return null;
      const sill = frac(Math.max(o.sill, o.head), 0);
      const head = frac(Math.min(o.sill, o.head), 0);
      return sill - head >= 0.02 ? { ...s, sill, head } : null;
    })
    .filter((w): w is NonNullable<typeof w> => !!w)
    .slice(0, 12);
  const patio = span(r.patio, 0.03);
  const sl = obj(r.scaleLine);
  const la = pt(sl.a);
  const lb = pt(sl.b);
  const scaleLine = la && lb && typeof sl.lengthIn === "number" && Number.isFinite(sl.lengthIn) && sl.lengthIn >= 6 && sl.lengthIn <= 600 && Math.hypot(lb.x - la.x, lb.y - la.y) >= 0.01 ? { a: la, b: lb, lengthIn: Math.round(sl.lengthIn) } : null;
  const b = obj(r.bars);
  const bars = { top: clamp(num(b.top, 0), 0, 0.35), bottom: clamp(num(b.bottom, 0), 0, 0.35) };
  const confidence = clamp(num(r.confidence, 0.5), 0, 1);
  const note = typeof r.note === "string" && r.note.trim() ? r.note.trim().slice(0, 240) : null;
  return { base: { left: bl, right: br }, eave, storeys, jogs, door, windows, patio, scaleLine, bars, confidence, note };
}

/** The base line's y at a given x (the wall may run a little uphill in the picture). */
export function baseYAt(read: WallRead, x: number): number {
  const { left, right } = read.base;
  if (right.x - left.x < 1e-6) return left.y;
  const t = clamp((x - left.x) / (right.x - left.x), 0, 1);
  return left.y + (right.y - left.y) * t;
}

/** The read said in a cut of its picture: every coordinate mapped into the crop's own fractions. */
export function readInCrop(read: WallRead, crop: Crop): WallRead {
  const fx = (x: number) => r3((x - crop.x) / crop.w);
  const fy = (y: number) => r3((y - crop.y) / crop.h);
  const p = (q: Pt): Pt => ({ x: fx(q.x), y: fy(q.y) });
  return {
    base: { left: p(read.base.left), right: p(read.base.right) },
    eave: read.eave ? { left: p(read.eave.left), right: p(read.eave.right) } : null,
    storeys: read.storeys,
    jogs: read.jogs.map((j) => ({ ...j, x: fx(j.x), y: fy(j.y) })),
    door: read.door ? { x0: fx(read.door.x0), x1: fx(read.door.x1), bottom: fy(read.door.bottom), top: fy(read.door.top) } : null,
    windows: read.windows.map((w) => ({ x0: fx(w.x0), x1: fx(w.x1), sill: fy(w.sill), head: fy(w.head) })),
    patio: read.patio ? { x0: fx(read.patio.x0), x1: fx(read.patio.x1) } : null,
    scaleLine: read.scaleLine ? { a: p(read.scaleLine.a), b: p(read.scaleLine.b), lengthIn: read.scaleLine.lengthIn } : null,
    bars: { top: 0, bottom: 0 },
    confidence: read.confidence,
    note: read.note,
  };
}

export interface PhotoScale {
  /** Pixels per foot in the picture the read was made on. 0 when nothing in it gives a size. */
  pxPerFt: number;
  by: "line" | "door" | "eave" | "none";
}

/** A foot in pixels: a measure the contractor drew, else the door's 80 in., else the wall's storeys to the eave. */
export function scaleFromRead(read: WallRead, photoW: number, photoH: number): PhotoScale {
  if (read.scaleLine && read.scaleLine.lengthIn > 0) {
    const px = Math.hypot((read.scaleLine.b.x - read.scaleLine.a.x) * photoW, (read.scaleLine.b.y - read.scaleLine.a.y) * photoH);
    if (px > 4) return { pxPerFt: px / (read.scaleLine.lengthIn / 12), by: "line" };
  }
  if (read.door) {
    const px = (read.door.bottom - read.door.top) * photoH;
    if (px > 8) return { pxPerFt: px / DOOR_HEIGHT_FT, by: "door" };
  }
  if (read.eave) {
    const px = ((read.base.left.y - read.eave.left.y + (read.base.right.y - read.eave.right.y)) / 2) * photoH;
    if (px > 8) return { pxPerFt: px / (STOREY_FT * (read.storeys ?? 1)), by: "eave" };
  }
  void photoW;
  return { pxPerFt: 0, by: "none" };
}

/** One part of the wall between two steps. `depthFt` is how far it stands toward the camera, against the leftmost part. */
export interface WallSegment {
  x0: number;
  x1: number;
  depthFt: number;
}

/** The wall's parts, left to right, each with its depth: a "toward" step brings the next part nearer, an "away" step sends it back. */
export function wallSegments(read: WallRead): WallSegment[] {
  const xs = [read.base.left.x, ...read.jogs.map((j) => j.x), read.base.right.x];
  const out: WallSegment[] = [];
  let depth = 0;
  for (let i = 0; i + 1 < xs.length; i++) {
    if (i > 0) {
      const j = read.jogs[i - 1];
      depth += (j.dir === "toward" ? 1 : -1) * (j.depthFt ?? JOG_DEFAULT_FT);
    }
    if (xs[i + 1] > xs[i]) out.push({ x0: xs[i], x1: xs[i + 1], depthFt: r3(depth) });
  }
  return out;
}

/** The wall's part a point along the base belongs to. */
export function segmentAt(segments: WallSegment[], x: number): WallSegment | null {
  return segments.find((s) => x >= s.x0 && x <= s.x1) ?? (segments.length ? (x < segments[0].x0 ? segments[0] : segments[segments.length - 1]) : null);
}

/** The farthest part of the wall between steps — the covered patio a back door is often in. Null without a step, or when too narrow for a deck (6 ft). */
export function recessOf(read: WallRead, scale: PhotoScale, photoW: number): WallSegment | null {
  const segments = wallSegments(read);
  if (segments.length < 2) return null;
  const farthest = Math.min(...segments.map((s) => s.depthFt));
  const deep = segments.filter((s) => s.depthFt === farthest).sort((a, b) => b.x1 - b.x0 - (a.x1 - a.x0));
  const minW = scale.pxPerFt > 0 ? (6 * scale.pxPerFt) / photoW : 0.1;
  return deep[0] && deep[0].x1 - deep[0].x0 >= minW ? deep[0] : null;
}

export interface Anchor {
  x: number;
  by: "door" | "recess" | "patio" | "run" | "wall";
}

/** Where the deck's middle belongs along the wall: the door, else the recess, else the patio, else the longest run, else the wall's middle. */
export function anchorOn(read: WallRead, scale: PhotoScale, photoW: number): Anchor {
  if (read.door) return { x: (read.door.x0 + read.door.x1) / 2, by: "door" };
  const recess = recessOf(read, scale, photoW);
  if (recess) return { x: (recess.x0 + recess.x1) / 2, by: "recess" };
  if (read.patio) return { x: (read.patio.x0 + read.patio.x1) / 2, by: "patio" };
  if (read.jogs.length) {
    const longest = wallSegments(read).sort((a, b) => b.x1 - b.x0 - (a.x1 - a.x0))[0];
    return { x: (longest.x0 + longest.x1) / 2, by: "run" };
  }
  return { x: (read.base.left.x + read.base.right.x) / 2, by: "wall" };
}

export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What the fit is sized for: the deck's elevation as lib/deck/elevation measures it. */
export interface FitDeck {
  shape: DeckShape;
  /** Out from the house, ft (the deck's, for the depth a notch may take). */
  depthFt: number;
  /** The elevation's width and height, ft (a roof's overhang can reach past the deck). */
  elevWidthFt: number;
  elevHeightFt: number;
  /** Where the deck's x = 0 lands in the elevation, ft. */
  elevLeftFt: number;
}

export interface Placed {
  x: number;
  y: number;
  w: number;
}

/** The outline's bounds on the read's picture, in fractions, for a placement in that picture. */
function outlineBox(placed: Placed, deck: FitDeck, photoW: number, photoH: number): { x0: number; x1: number; y0: number; y1: number } {
  const sx = placed.w / deck.elevWidthFt; // fraction of width per ft
  const sy = sx * (photoW / photoH); // fraction of height per ft (a foot is the same pixels both ways)
  return { x0: placed.x, x1: placed.x + placed.w, y1: placed.y, y0: placed.y - deck.elevHeightFt * sy };
}

/**
 * Where the deck goes on the read's picture: the ground line on the wall's
 * base, its middle on the anchor (the door, the recess…), as wide as the
 * elevation's feet at the scale. An L with a back notch is slid so the
 * notch's edge meets the step it wraps: a back-left notch the step whose
 * left side is nearer, a back-right notch the step whose right side is.
 * Null without a scale.
 */
export function placeOnWall(read: WallRead, scale: PhotoScale, deck: FitDeck, photoW: number, photoH: number): Placed | null {
  if (!(scale.pxPerFt > 0) || !(deck.elevWidthFt > 0) || !(photoW > 0)) return null;
  void photoH; // the ground line is read off the base, which already carries the picture's height
  const ftX = scale.pxPerFt / photoW; // fraction of width per ft
  const w = deck.elevWidthFt * ftX;
  const deckW = deck.shape.widthFt;
  const anchor = anchorOn(read, scale, photoW);
  let cx = anchor.x;
  if (deck.shape.kind === "L" && deck.shape.notch.corner.startsWith("back")) {
    const nw = deck.shape.notch.widthFt;
    if (deck.shape.notch.corner === "back-left") {
      const j = [...read.jogs].reverse().find((g) => g.x <= anchor.x + 1e-9 && g.dir === "away");
      if (j) cx = j.x + (deckW / 2 - nw) * ftX;
    } else {
      const j = read.jogs.find((g) => g.x >= anchor.x - 1e-9 && g.dir === "toward");
      if (j) cx = j.x - (deckW - nw) * ftX + (deckW / 2) * ftX;
    }
  }
  const x = cx - (deck.elevLeftFt + deckW / 2) * ftX;
  const y = baseYAt(read, cx);
  return { x: r3(x), y: r3(y), w: r3(w) };
}

/**
 * The picture cut to the wall: the base and the eave (or the structure's
 * height when there is no eave) with room around them, the bars gone, and
 * never less than three fifths of the picture wide. The outline's own box
 * is kept inside it, so a deck wider than the wall still shows whole.
 */
export function cropForWall(read: WallRead, scale: PhotoScale, placed: Placed | null, deck: FitDeck, photoW: number, photoH: number): Crop {
  const ftY = scale.pxPerFt > 0 ? scale.pxPerFt / photoH : 0;
  const top = clamp(read.bars.top, 0, 0.35);
  const bottom = 1 - clamp(read.bars.bottom, 0, 0.35);
  let x0 = read.base.left.x;
  let x1 = read.base.right.x;
  const baseY = Math.max(read.base.left.y, read.base.right.y);
  let y0 = read.eave ? Math.min(read.eave.left.y, read.eave.right.y) : baseY - (ftY > 0 ? (STOREY_FT + 1) * ftY : 0.45);
  let y1 = baseY;
  if (placed) {
    const box = outlineBox(placed, deck, photoW, photoH);
    x0 = Math.min(x0, box.x0);
    x1 = Math.max(x1, box.x1);
    y0 = Math.min(y0, box.y0);
    y1 = Math.max(y1, box.y1);
  }
  // Room around it: a tenth of the span each side, a little sky, two feet of yard.
  const mx = Math.max(0.04, (x1 - x0) * 0.1);
  const my = Math.max(0.04, (y1 - y0) * 0.12);
  x0 -= mx;
  x1 += mx;
  y0 -= my;
  y1 += ftY > 0 ? Math.max(my * 0.6, 2 * ftY) : my;
  // Never a sliver: at least three fifths of the picture wide, half of it tall.
  if (x1 - x0 < 0.6) {
    const c = (x0 + x1) / 2;
    x0 = c - 0.3;
    x1 = c + 0.3;
  }
  if (y1 - y0 < 0.5) {
    const c = (y0 + y1) / 2;
    y0 = c - 0.25;
    y1 = c + 0.25;
  }
  x0 = clamp(x0, 0, 1);
  x1 = clamp(x1, 0, 1);
  y0 = clamp(y0, top, bottom);
  y1 = clamp(y1, top, bottom);
  if (x1 - x0 < 0.2 || y1 - y0 < 0.2) return { x: 0, y: top, w: 1, h: r3(bottom - top) };
  return { x: r3(x0), y: r3(y0), w: r3(x1 - x0), h: r3(y1 - y0) };
}

/** A placement on the read's picture, said in the cropped picture's fractions. */
export function placedInCrop(placed: Placed, crop: Crop): Placed {
  return { x: r3((placed.x - crop.x) / crop.w), y: r3((placed.y - crop.y) / crop.h), w: r3(placed.w / crop.w) };
}

/** The door's threshold above the ground, in inches — where the deck's floor belongs. Null without a door or a scale. */
export function heightFromDoor(read: WallRead, scale: PhotoScale, photoH: number): number | null {
  if (!read.door || !(scale.pxPerFt > 0)) return null;
  const cx = (read.door.x0 + read.door.x1) / 2;
  const px = (baseYAt(read, cx) - read.door.bottom) * photoH;
  const inches = Math.round((px / scale.pxPerFt) * 12);
  if (inches < 4 || inches > 360) return null;
  return inches;
}

/** The lowest window sill above the ground, in inches, among the windows over the deck's span. Null when none. */
export function lowestSillIn(read: WallRead, scale: PhotoScale, placed: Placed | null, photoH: number): number | null {
  if (!(scale.pxPerFt > 0) || !read.windows.length) return null;
  const inSpan = placed ? read.windows.filter((w) => w.x1 > placed.x && w.x0 < placed.x + placed.w) : read.windows;
  if (!inSpan.length) return null;
  const sills = inSpan.map((w) => Math.round((((baseYAt(read, (w.x0 + w.x1) / 2) - w.sill) * photoH) / scale.pxPerFt) * 12));
  return Math.min(...sills);
}

/** "18 in.", "3 ft", "2'-10"" — the studio's own way of saying a height. */
const inWords = (n: number) => (n < 24 ? `${n} in.` : n % 12 === 0 ? `${n / 12} ft` : `${Math.floor(n / 12)}'-${n % 12}"`);
/** "6 ft", "6 ft 6 in." for a length in feet. */
const ftWords = (ft: number) => {
  const inches = Math.round(ft * 12);
  return inches % 12 === 0 ? `${inches / 12} ft` : `${Math.floor(inches / 12)} ft ${inches % 12} in.`;
};

/** What to do about the house stepping into the deck: notch the deck around the step, or fit it into the recess. */
export type JogOffer =
  | { kind: "notch"; corner: Extract<NotchCorner, "back-left" | "back-right">; widthFt: number; depthFt: number; text: string }
  | { kind: "recess"; widthFt: number; text: string };

/**
 * The house's steps against a rectangular deck placed on the wall: a nearer
 * part of the wall (a bump-out) overlapping the deck's back edge becomes a
 * back notch of that overlap and that depth; bump-outs on both sides mean
 * the deck sits in a recess narrower than itself. Null when the deck clears
 * the steps, is an L already, or there is no scale.
 */
export function jogOffer(read: WallRead, scale: PhotoScale, onWall: Placed | null, deck: FitDeck, photoW: number): JogOffer | null {
  if (!onWall || !(scale.pxPerFt > 0) || deck.shape.kind !== "rect") return null;
  const segments = wallSegments(read);
  if (segments.length < 2) return null;
  const ftX = scale.pxPerFt / photoW;
  const toFt = (f: number) => f / ftX;
  // The deck's own span (the roof's overhang is not the deck).
  const dx0 = onWall.x + deck.elevLeftFt * ftX;
  const dx1 = dx0 + deck.shape.widthFt * ftX;
  const mine = segmentAt(segments, (dx0 + dx1) / 2);
  if (!mine) return null;
  const nearer = segments.filter((s) => s.depthFt > mine.depthFt + 0.4 && s.x1 > dx0 + 1e-9 && s.x0 < dx1 - 1e-9);
  if (!nearer.length) return null;
  const leftBump = nearer.find((s) => s.x1 <= mine.x0 + 1e-9);
  const rightBump = nearer.find((s) => s.x0 >= mine.x1 - 1e-9);
  if (leftBump && rightBump) {
    const widthFt = Math.floor(toFt(mine.x1 - mine.x0) * 2) / 2;
    if (widthFt < 4) return null;
    return { kind: "recess", widthFt, text: `The house's recess is ${ftWords(widthFt)} wide and the deck is ${ftWords(deck.shape.widthFt)} — fit the deck into the recess?` };
  }
  const bump = leftBump ?? rightBump;
  if (!bump) return null;
  const widthFt = half(toFt(Math.min(dx1, bump.x1) - Math.max(dx0, bump.x0)));
  const depthFt = half(clamp(bump.depthFt - mine.depthFt, 1, Math.max(1, deck.depthFt - 3)));
  if (widthFt < 2 || deck.shape.widthFt - widthFt < 3 || deck.depthFt - depthFt < 3) return null;
  const corner = leftBump ? ("back-left" as const) : ("back-right" as const);
  return { kind: "notch", corner, widthFt, depthFt, text: `The house steps ${ftWords(depthFt)} into the deck's ${leftBump ? "left" : "right"} back corner over ${ftWords(widthFt)} — notch the deck around it?` };
}

/** The deck's shape with an offer taken. */
export function shapeWithOffer(shape: DeckShape, offer: JogOffer): DeckShape {
  if (offer.kind === "recess") return { ...shape, widthFt: offer.widthFt };
  return { kind: "L", widthFt: shape.widthFt, depthFt: shape.depthFt, notch: { corner: offer.corner, widthFt: offer.widthFt, depthFt: offer.depthFt } };
}

export interface PhotoFit {
  scale: PhotoScale;
  crop: Crop;
  /** In the CROPPED picture's fractions — what the design keeps. */
  placed: Placed;
  /** The read's wall, said in feet when there is a scale. */
  wallFt: number | null;
  anchor: Anchor["by"];
  suggestedHeightIn: number | null;
  lowestSillIn: number | null;
  offer: JogOffer | null;
  door: boolean;
  windows: number;
  jog: boolean;
  confidence: number;
  /** What was found and what to do about it, one line each, for the strip under the photo. */
  notes: string[];
  /** The read was too unsure to place by: the outline is centred and the notes say so. */
  unsure: boolean;
}

const ANCHOR_WORDS: Record<Anchor["by"], string> = {
  door: "The deck is centred on the door",
  recess: "No door seen — the deck is set in the house's recess, the covered part a back door is usually in; drag it if the door is elsewhere",
  patio: "No door seen — the deck is set on the patio; drag it where the door is",
  run: "No door seen — the deck sits on the longest run of wall; drag it where the door is",
  wall: "No door seen — the deck is centred on the wall; drag it where the door is",
};

/**
 * Everything the studio needs from one read of the picture. `recrop: false`
 * fits a picture already cut to the wall (its read in its own fractions)
 * and leaves it whole; `fallback` is the outline as it stands, kept at its
 * width and set on the wall's base when nothing in the read gives a scale;
 * `hand` says the read is the contractor's own marks.
 */
export function fitPhoto(read: WallRead, deck: FitDeck, heightIn: number, photoW: number, photoH: number, opts: { recrop?: boolean; fallback?: Placed; hand?: boolean } = {}): PhotoFit {
  const scale = scaleFromRead(read, photoW, photoH);
  const unsure = read.confidence < MIN_CONFIDENCE;
  const onWall = unsure ? null : placeOnWall(read, scale, deck, photoW, photoH);
  const crop = opts.recrop === false ? { x: 0, y: 0, w: 1, h: 1 } : cropForWall(read, scale, onWall, deck, photoW, photoH);
  const fallbackOn = !onWall && !unsure && opts.fallback ? (() => { const ax = anchorOn(read, scale, photoW).x; return { x: r3(ax - opts.fallback.w / 2), y: r3(baseYAt(read, ax)), w: opts.fallback.w }; })() : null;
  const placed = onWall ? placedInCrop(onWall, crop) : fallbackOn ? placedInCrop(fallbackOn, crop) : { x: 0.1, y: r3(clamp((baseYAt(read, 0.5) - crop.y) / crop.h, 0.3, 0.98)), w: 0.8 };
  const wallFt = scale.pxPerFt > 0 ? Math.round(((read.base.right.x - read.base.left.x) * photoW) / scale.pxPerFt) : null;
  const anchor = anchorOn(read, scale, photoW).by;
  const suggestedHeightIn = heightFromDoor(read, scale, photoH);
  const sill = lowestSillIn(read, scale, onWall, photoH);
  const offer = unsure ? null : jogOffer(read, scale, onWall, deck, photoW);
  const notes: string[] = [];
  if (unsure) notes.push("The wall could not be read with confidence — the outline is centred; drag it to the wall and pull the handle to size it.");
  else {
    const found = [wallFt ? `the wall, about ${wallFt} ft wide` : "the wall", read.door ? "the back door" : null, read.windows.length ? `${read.windows.length} window${read.windows.length === 1 ? "" : "s"}` : null, read.jogs.length ? (read.jogs.length === 1 ? "a step in the wall" : `${read.jogs.length} steps in the wall`) : null, read.patio ? "a patio" : null, read.scaleLine ? `a measure of ${inWords(read.scaleLine.lengthIn)}` : null].filter(Boolean);
    const by = scale.by === "line" ? "measure you drew" : scale.by === "door" ? "door (80 in.)" : scale.by === "eave" ? "wall's height to the eave" : "picture: none, so the size is yours to pull";
    notes.push(`${opts.hand ? "The wall as you marked it: " : "Found "}${found.join(", ")} — scale from the ${by}.`);
    const l = deck.shape.kind === "L" && deck.shape.notch.corner.startsWith("back") && read.jogs.length ? ", its notch on the house's step" : "";
    notes.push(`${ANCHOR_WORDS[anchor]}${l}.`);
    if (suggestedHeightIn !== null && Math.abs(suggestedHeightIn - heightIn) >= 2) notes.push(`The door's threshold is ${inWords(suggestedHeightIn)} above the ground — that is where the floor belongs (the design says ${inWords(Math.round(heightIn))}).`);
    else if (suggestedHeightIn !== null) notes.push(`The door's threshold is ${inWords(suggestedHeightIn)} up — the floor height matches it.`);
    if (sill !== null && heightIn + 2 > sill) notes.push(`A window sill is only ${inWords(sill)} up — a ${inWords(Math.round(heightIn))} floor would come above it: lower the deck, or that window becomes a door.`);
    else if (sill !== null) notes.push(`The lowest window sill is ${inWords(sill)} up — the floor stays below it.`);
    if (offer) notes.push(offer.text);
    const angled = obliqueness(read);
    if (angled !== null && angled >= 12) notes.push(`The picture was taken at an angle — the wall stands ${angled}% taller at one end than the other. Straighten the picture for a true wall before trusting the size.`);
  }
  if (read.note) notes.push(read.note);
  return { scale, crop, placed, wallFt, anchor, suggestedHeightIn, lowestSillIn: sill, offer, door: !!read.door, windows: read.windows.length, jog: read.jogs.length > 0, confidence: read.confidence, notes: notes.slice(0, 8), unsure };
}

/** The record the design keeps of a fit: what the strip says, and the read in the cropped picture's own fractions, so the next fit needs no model. */
export function fitSummary(fit: PhotoFit, read: WallRead, hand = false): NonNullable<DeckPhoto["fit"]> {
  const whole = fit.crop.w === 1 && fit.crop.h === 1 && fit.crop.x === 0 && fit.crop.y === 0;
  return {
    hand,
    by: fit.scale.by,
    pxPerFt: Math.round(fit.scale.pxPerFt * 100) / 100,
    wallFt: fit.wallFt,
    suggestedHeightIn: fit.suggestedHeightIn,
    door: fit.door,
    windows: fit.windows,
    jog: fit.jog,
    confidence: Math.round(fit.confidence * 100) / 100,
    notes: fit.notes,
    offer: fit.offer,
    read: whole ? read : readInCrop(read, fit.crop),
  };
}

/* ------------------------------------------------------------------ */
/*  The wall marked by hand (owner, 2026-10-10: "start drawing the lines   */
/*  right on that picture — the house wall where the deck is supposed to   */
/*  be — kind of measures, and build everything right on that wall")       */
/* ------------------------------------------------------------------ */

/** A handle on the picture: the wall's base ends, the door's threshold and top, the measure's ends, a step. */
export type MarkId = "base-left" | "base-right" | "door-bottom" | "door-top" | "scale-a" | "scale-b" | `jog-${number}`;

/** A read to start marking from when the model found nothing: the base along the lower part of the picture, nothing else. */
export function blankRead(): WallRead {
  return { base: { left: { x: 0.1, y: 0.8 }, right: { x: 0.9, y: 0.8 } }, eave: null, storeys: null, jogs: [], door: null, windows: [], patio: null, scaleLine: null, bars: { top: 0, bottom: 0 }, confidence: 1, note: null };
}

/** A read as the contractor's own marks: sure, with no bands to cut. */
export function markedRead(read: WallRead): WallRead {
  return { ...read, confidence: 1, bars: { top: 0, bottom: 0 } };
}

const inside = (p: Pt): Pt => ({ x: r3(clamp(p.x, 0, 1)), y: r3(clamp(p.y, 0, 1)) });

/** One handle moved to `p` (fractions of the picture); the rest of the read stands. */
export function moveMark(read: WallRead, mark: MarkId, p: Pt): WallRead {
  const q = inside(p);
  if (mark === "base-left") return { ...read, base: { ...read.base, left: { x: Math.min(q.x, read.base.right.x - 0.05), y: q.y } } };
  if (mark === "base-right") return { ...read, base: { ...read.base, right: { x: Math.max(q.x, read.base.left.x + 0.05), y: q.y } } };
  if (mark === "door-bottom" && read.door) {
    const d = read.door;
    const half = (d.x1 - d.x0) / 2;
    const h = d.bottom - d.top;
    const cx = clamp(q.x, half, 1 - half);
    const bottom = clamp(q.y, h + 0.02, 1);
    return { ...read, door: { x0: r3(cx - half), x1: r3(cx + half), bottom: r3(bottom), top: r3(bottom - h) } };
  }
  if (mark === "door-top" && read.door) return { ...read, door: { ...read.door, top: r3(Math.min(q.y, read.door.bottom - 0.03)) } };
  if (mark === "scale-a" && read.scaleLine) return { ...read, scaleLine: { ...read.scaleLine, a: q } };
  if (mark === "scale-b" && read.scaleLine) return { ...read, scaleLine: { ...read.scaleLine, b: q } };
  const jog = /^jog-(\d+)$/.exec(mark);
  if (jog) {
    const i = Number(jog[1]);
    if (!read.jogs[i]) return read;
    const x = r3(clamp(q.x, read.base.left.x + 0.02, read.base.right.x - 0.02));
    const jogs = read.jogs.map((j, k) => (k === i ? { ...j, x, y: r3(baseYAt(read, x)) } : j)).sort((a, b) => a.x - b.x);
    return { ...read, jogs };
  }
  return read;
}

/** A door put on the wall's base at its middle: 80 in. tall at the picture's scale when there is one, else a fifth of the picture. */
export function addDoor(read: WallRead, photoW: number, photoH: number): WallRead {
  const scale = scaleFromRead(read, photoW, photoH);
  const cx = (read.base.left.x + read.base.right.x) / 2;
  const bottom = baseYAt(read, cx);
  const h = scale.pxPerFt > 0 ? (DOOR_HEIGHT_FT * scale.pxPerFt) / photoH : 0.2;
  const w = (h * photoH * 0.45) / photoW;
  return { ...read, door: { x0: r3(cx - w / 2), x1: r3(cx + w / 2), bottom: r3(bottom), top: r3(Math.max(0.02, bottom - h)) } };
}
export const removeDoor = (read: WallRead): WallRead => ({ ...read, door: null });

/** A measure line put in the middle of the picture, 3 ft long until the contractor says otherwise. */
export function addScaleLine(read: WallRead, lengthIn = 36): WallRead {
  return { ...read, scaleLine: { a: { x: 0.5, y: 0.45 }, b: { x: 0.5, y: 0.65 }, lengthIn: Math.round(clamp(lengthIn, 6, 600)) } };
}
export const removeScaleLine = (read: WallRead): WallRead => ({ ...read, scaleLine: null });
export function setScaleLength(read: WallRead, lengthIn: number): WallRead {
  return read.scaleLine ? { ...read, scaleLine: { ...read.scaleLine, lengthIn: Math.round(clamp(lengthIn, 6, 600)) } } : read;
}

/** A step in the wall put at its middle (or at `x`), the part to the right 2 ft nearer until the contractor says otherwise. */
export function addJog(read: WallRead, x?: number): WallRead {
  if (read.jogs.length >= 4) return read;
  const at = r3(clamp(x ?? (read.base.left.x + read.base.right.x) / 2, read.base.left.x + 0.02, read.base.right.x - 0.02));
  const jogs = [...read.jogs, { x: at, y: r3(baseYAt(read, at)), dir: "toward" as const, depthFt: JOG_DEFAULT_FT }].sort((a, b) => a.x - b.x);
  return { ...read, jogs };
}
export function setJog(read: WallRead, i: number, patch: Partial<Pick<WallJog, "dir" | "depthFt">>): WallRead {
  if (!read.jogs[i]) return read;
  return { ...read, jogs: read.jogs.map((j, k) => (k === i ? { ...j, ...patch, depthFt: patch.depthFt !== undefined ? (patch.depthFt === null ? null : clamp(patch.depthFt, 0.5, 40)) : j.depthFt } : j)) };
}
export const removeJog = (read: WallRead, i: number): WallRead => ({ ...read, jogs: read.jogs.filter((_, k) => k !== i) });

/**
 * Black bands at the top and the bottom of a picture (a phone's screenshot
 * of a photo): how many rows to cut from each end, from each row's
 * brightness (0…255 — the studio sends the row's median, so a status
 * bar's white glyphs on black still count as black). A band is contiguous
 * rows darker than `dark`, at most a third of the picture from either end.
 */
export function letterboxRows(rowBrightness: ArrayLike<number>, dark = 22): { top: number; bottom: number } {
  const n = rowBrightness.length;
  const cap = Math.floor(n / 3);
  let top = 0;
  while (top < cap && rowBrightness[top] <= dark) top++;
  let bottom = 0;
  while (bottom < cap && rowBrightness[n - 1 - bottom] <= dark) bottom++;
  // A band thinner than a hair is noise, not a bar.
  if (top < Math.max(4, n * 0.01)) top = 0;
  if (bottom < Math.max(4, n * 0.01)) bottom = 0;
  return { top, bottom };
}

/* ------------------------------------------------------------------ */
/*  The picture straightened (owner, 2026-10-11: an angled shot of the    */
/*  house "still can't work and build the deck with this pic")            */
/* ------------------------------------------------------------------ */
//
// A photo taken from the side of the yard shows the wall in perspective: a
// foot of wall is more pixels at the near end than the far end, the eave
// and the base converge, and one scale cannot fit it. The contractor puts
// four corners on the wall — where it meets the ground at each end and the
// top of the wall above each — and the picture is warped so that quad
// becomes a rectangle: a true elevation, which the read, the fit and the 3D
// then take as any square-on photo. The maths here is pure: a homography
// from four point pairs, its inverse, the output's size (its width from the
// wall's typed width or a measure across the wall when there is one, else
// the quad's own average edges), and every line of a read carried through
// it so a door marked before stays on the door after.

/** Four corners of the wall on the picture: top-left, top-right, bottom-right, bottom-left, as fractions. */
export type Quad = [Pt, Pt, Pt, Pt];

/**
 * The 3×3 homography (row-major, h33 = 1) taking each `src` point to its
 * `dst` point — eight unknowns from four pairs, by elimination. Null when
 * the points do not make a proper quadrilateral.
 */
export function homography(src: readonly Pt[], dst: readonly Pt[]): number[] | null {
  if (src.length !== 4 || dst.length !== 4) return null;
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const n = 8;
  for (let c = 0; c < n; c++) {
    let best = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[best][c])) best = r;
    if (Math.abs(A[best][c]) < 1e-12) return null;
    [A[c], A[best]] = [A[best], A[c]];
    [b[c], b[best]] = [b[best], b[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      if (f === 0) continue;
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const h = b.map((v, i) => v / A[i][i]);
  if (!h.every(Number.isFinite)) return null;
  return [...h, 1];
}

/** A point through the homography. */
export function applyHomography(H: readonly number[], p: Pt): Pt {
  const w = H[6] * p.x + H[7] * p.y + H[8];
  const d = Math.abs(w) < 1e-12 ? 1e-12 : w;
  return { x: (H[0] * p.x + H[1] * p.y + H[2]) / d, y: (H[3] * p.x + H[4] * p.y + H[5]) / d };
}

/** The homography going the other way. Null when it has none. */
export function invertHomography(H: readonly number[]): number[] | null {
  const [a, b, c, d, e, f, g, h, i] = H;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-18) return null;
  const inv = [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map((v) => v / det);
  const k = inv[8] === 0 ? 1 : inv[8];
  return inv.map((v) => v / k);
}

/** Corners to start from: the read's base and eave, or a box in the middle of the picture when there is no read. */
export function wallQuadFromRead(read: WallRead | null): Quad {
  if (!read) return [{ x: 0.15, y: 0.2 }, { x: 0.85, y: 0.2 }, { x: 0.85, y: 0.85 }, { x: 0.15, y: 0.85 }];
  const bl = inside(read.base.left);
  const br = inside(read.base.right);
  const tl = read.eave ? inside(read.eave.left) : { x: bl.x, y: r3(Math.max(0.02, bl.y - 0.45)) };
  const tr = read.eave ? inside(read.eave.right) : { x: br.x, y: r3(Math.max(0.02, br.y - 0.45)) };
  return [tl, tr, br, bl];
}

/** How much taller the wall stands at one end than the other in the picture, percent — the sign of an angled shot. */
export function obliqueness(read: WallRead): number | null {
  if (!read.eave) return null;
  const hl = read.base.left.y - read.eave.left.y;
  const hr = read.base.right.y - read.eave.right.y;
  if (hl <= 0.02 || hr <= 0.02) return null;
  return Math.round((Math.abs(hl - hr) / Math.max(hl, hr)) * 100);
}

export interface RectifyPlan {
  /** Source pixels → output pixels. */
  H: number[];
  /** The output picture's size, px. */
  w: number;
  h: number;
  /** What set the output's width against its height. */
  by: "width" | "measure" | "edges";
  /** Pixels per foot in the output, when something in the read gives one. */
  pxPerFt: number | null;
  /** The quad's two sides' difference, percent — how angled the shot was. */
  obliquePct: number;
}

/**
 * The warp for four corners of the wall. Its height is the average of the
 * quad's two sides; its width is the wall's typed width at the vertical
 * scale (the door's 80 in., else the eave by storeys), else a measure drawn
 * across the wall against that scale, else the quad's own average top and
 * bottom. The long side is held to `maxSide`.
 */
export function rectifyPlan(quad: Quad, read: WallRead | null, photoW: number, photoH: number, opts: { wallWidthFt?: number | null; maxSide?: number } = {}): RectifyPlan | null {
  if (!(photoW > 0 && photoH > 0)) return null;
  const px = quad.map((p) => ({ x: p.x * photoW, y: p.y * photoH }));
  const [tl, tr, br, bl] = px;
  const len = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);
  const top = len(tl, tr);
  const bottom = len(bl, br);
  const left = len(tl, bl);
  const right = len(tr, br);
  if (top < 8 || bottom < 8 || left < 8 || right < 8) return null;
  // Left of right, top above bottom, no bow tie.
  if (tl.x >= tr.x || bl.x >= br.x || tl.y >= bl.y || tr.y >= br.y) return null;
  const h0 = (left + right) / 2;
  let w0 = (top + bottom) / 2;
  let by: RectifyPlan["by"] = "edges";
  let pxPerFt: number | null = null;
  const H0 = homography(px, [{ x: 0, y: 0 }, { x: w0, y: 0 }, { x: w0, y: h0 }, { x: 0, y: h0 }]);
  if (!H0) return null;
  if (read) {
    // The read in the first output: a door's height there gives the vertical scale; a measure says which way it runs.
    const r0 = transformRead(read, H0, photoW, photoH, w0, h0);
    let vy: number | null = null;
    let vx: number | null = null;
    if (r0.door && (r0.door.bottom - r0.door.top) * h0 > 8) vy = ((r0.door.bottom - r0.door.top) * h0) / DOOR_HEIGHT_FT;
    else if (r0.eave) {
      const hp = ((r0.base.left.y - r0.eave.left.y + (r0.base.right.y - r0.eave.right.y)) / 2) * h0;
      if (hp > 8) vy = hp / (STOREY_FT * (r0.storeys ?? 1));
    }
    if (r0.scaleLine && r0.scaleLine.lengthIn > 0) {
      const dx = (r0.scaleLine.b.x - r0.scaleLine.a.x) * w0;
      const dy = (r0.scaleLine.b.y - r0.scaleLine.a.y) * h0;
      const ft = r0.scaleLine.lengthIn / 12;
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 4) vx = Math.abs(dx) / ft;
      else if (Math.abs(dy) > 4 && vy === null) vy = Math.abs(dy) / ft;
    }
    if (opts.wallWidthFt && opts.wallWidthFt > 0 && vy) {
      w0 = opts.wallWidthFt * vy;
      by = "width";
    } else if (vx && vy) {
      w0 = w0 * (vy / vx);
      by = "measure";
    }
    pxPerFt = vy;
  }
  const maxSide = opts.maxSide ?? 1600;
  const k = Math.min(1, maxSide / Math.max(w0, h0));
  const w = Math.max(32, Math.round(w0 * k));
  const h = Math.max(32, Math.round(h0 * k));
  const H = homography(px, [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }]);
  if (!H) return null;
  return { H, w, h, by, pxPerFt: pxPerFt === null ? null : Math.round(pxPerFt * k * 100) / 100, obliquePct: Math.round((Math.abs(left - right) / Math.max(left, right)) * 100) };
}

/** A read carried through a warp: every line's ends mapped, a box (a door, a window) kept as the box around its mapped corners. */
export function transformRead(read: WallRead, H: readonly number[], fromW: number, fromH: number, toW: number, toH: number): WallRead {
  const p = (q: Pt): Pt => {
    const m = applyHomography(H, { x: q.x * fromW, y: q.y * fromH });
    return { x: r3(m.x / toW), y: r3(m.y / toH) };
  };
  // A box (a door, a window) is read as an upright rectangle even on an angled shot, so its bottom edge cannot lean
  // with the base: it is carried by its middle — the bottom's centre stays on the base, the top's centre above it —
  // and its width by its two bottom corners.
  const box = (x0: number, x1: number, top: number, bottom: number) => {
    const cx = (x0 + x1) / 2;
    const bl = p({ x: x0, y: bottom });
    const br = p({ x: x1, y: bottom });
    const b = p({ x: cx, y: bottom });
    const t = p({ x: cx, y: top });
    return { x0: r3(Math.min(bl.x, br.x)), x1: r3(Math.max(bl.x, br.x)), top: r3(Math.min(t.y, b.y - 0.001)), bottom: r3(b.y) };
  };
  const base = { left: p(read.base.left), right: p(read.base.right) };
  const patioY = (x: number) => baseYAt(read, x);
  return {
    base,
    eave: read.eave ? { left: p(read.eave.left), right: p(read.eave.right) } : null,
    storeys: read.storeys,
    jogs: read.jogs.map((j) => ({ ...j, ...p({ x: j.x, y: j.y }) })).sort((a, b) => a.x - b.x),
    door: read.door ? box(read.door.x0, read.door.x1, read.door.top, read.door.bottom) : null,
    windows: read.windows.map((w) => { const b = box(w.x0, w.x1, w.head, w.sill); return { x0: b.x0, x1: b.x1, sill: b.bottom, head: b.top }; }),
    patio: read.patio ? { x0: p({ x: read.patio.x0, y: patioY(read.patio.x0) }).x, x1: p({ x: read.patio.x1, y: patioY(read.patio.x1) }).x } : null,
    scaleLine: read.scaleLine ? { a: p(read.scaleLine.a), b: p(read.scaleLine.b), lengthIn: read.scaleLine.lengthIn } : null,
    bars: { top: 0, bottom: 0 },
    confidence: read.confidence,
    note: read.note,
  };
}

/** A placement carried through a warp: its ground line's two ends mapped. */
export function transformPlaced(placed: Placed, H: readonly number[], fromW: number, fromH: number, toW: number, toH: number): Placed {
  const a = applyHomography(H, { x: placed.x * fromW, y: placed.y * fromH });
  const b = applyHomography(H, { x: (placed.x + placed.w) * fromW, y: placed.y * fromH });
  return { x: r3(a.x / toW), y: r3((a.y + b.y) / 2 / toH), w: r3(Math.max(0.05, (b.x - a.x) / toW)) };
}

/** The prompt the read runs on — the JSON the model must answer with, field by field. */
export const WALL_READ_PROMPT = `You read one photo of the back (or side) of a house, taken from the yard, for a deck builder. Answer with ONE JSON object and nothing else. Every coordinate is a FRACTION of the whole picture: x from 0 at the left edge to 1 at the right edge, y from 0 at the top edge to 1 at the bottom edge. Use the picture exactly as given, including any black bands.
{
  "base": {"left": {"x","y"}, "right": {"x","y"}},   // the two ends of the house wall's bottom edge where the wall meets the ground, the patio or the old deck — the wall a new deck would stand against (the main face toward the camera). Include the whole face, across any step in it.
  "eave": {"left": {"x","y"}, "right": {"x","y"}} | null,   // the top of that wall face above each base end: the eave, or the top of the first storey if the wall goes up two storeys.
  "storeys": 1 | 2 | null,   // storeys of wall between the base and the eave you gave.
  "jogs": [{"x", "y", "dir": "toward" | "away", "depthFt": number}],   // where the wall steps in or out (an L-shaped house, a bump-out, a bay, a covered patio set back under the upper floor or a roof): x along the base; "toward" when the part of the wall to the RIGHT of the step comes toward the camera, "away" when it steps back; depthFt your estimate of the step in feet — a covered patio is usually 8 to 12. [] when the wall is one flat face.
  "door": {"x0", "x1", "bottom", "top"} | null,   // the back door in that wall (a sliding, patio or hinged door): its left and right edges, the bottom of the door (its threshold) and the top of the door frame. The back door is often in the recessed part, under a roof or the upper floor — look there; a sliding glass door reflects the sky and the yard. Null when there is none in the wall.
  "windows": [{"x0", "x1", "sill", "head"}],   // each window in that wall: left and right edges, the sill (bottom) and the head (top). [] when none.
  "patio": {"x0", "x1"} | null,   // a concrete patio, a slab or an old deck at the wall's base, where a deck would go: its left and right ends along the wall. Null when none.
  "bars": {"top", "bottom"},   // black bands, a phone's status bar or another app's chrome at the top and the bottom of the picture, as fractions of the picture's height; 0 when the picture goes edge to edge.
  "confidence": 0..1,   // how sure you are of the base line and the door.
  "note": string | null   // one short sentence a builder should know (a hose bib in the way, a window well, the ground sloping), else null.
}
Rules: the base line is where the WALL meets the ground, not where the roof or a fence does; a standard exterior door is about 80 inches tall — use it to judge sizes; if the ground in front of the wall is hidden (a hedge, an old deck), give the base where the wall would meet it; never invent a door or a window you cannot see.`;
