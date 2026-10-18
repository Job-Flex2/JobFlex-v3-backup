// READ A FLOOR PLAN INTO ROOMS (Home Design Studio, 2026-10-17). From the plan's own lines (lib/design/pdfVector):
//   1. the scale, from the sheet's own note ("1/4" = 1'-0"");
//   2. walls — an architect draws a wall as two parallel lines a wall's thickness apart: the lines are paired,
//      the pairs become centerlines with a thickness, and pieces on one line are joined into one wall;
//   3. openings — where a wall's lines break, a window drawn in the gap makes a window, a door swing near it a
//      door (which jamb it hangs on, which way it swings), nothing a cased opening;
//   4. corners — wall ends are carried to where the centerlines meet, so the rooms close;
//   5. what the plan drew inside: cabinet runs, appliances, fixtures, kept as their lines.
// With CAD layers (walls, doors, windows by name) every step reads the right lines; without them only a region the
// contractor boxes is read, and walls come from line pairs alone. Pure; the browser runs it on the sheet it opened.
import type { DesignDoc, MarkRole, Opening, P, PlanMark, RoomLabel, Wall } from "./model";
import { DEFAULT_CEILING, DOOR_HEIGHT, WINDOW_HEIGHT, WINDOW_SILL, newId } from "./model";
import { cross, dist, lineX, outsideWallIds, project, roomsOf, sub } from "./geometry";
import { layerRole, type LayerRole, type VectorSheet, type VSeg } from "./pdfVector";

export type SheetText = { str: string; x: number; y: number; /** glyph height, points */ h?: number };

/* ── Scale ─────────────────────────────────────────────────────────────────────────────────────────────────────── */

const FRAC: Record<string, number> = { "¼": 0.25, "½": 0.5, "¾": 0.75, "⅛": 0.125, "⅜": 0.375, "⅝": 0.625, "⅞": 0.875, "⅙": 1 / 6 };

/** Paper inches per foot from a scale note's left side: "1/4"", "3/16"", "¼"", "1 1/2"", "1"". */
function paperInches(s: string): number | null {
  const t = s.replace(/[⁄∕]/g, "/").replace(/\s+/g, " ").trim();
  let m = t.match(/(\d+)\s+(\d+)\/(\d+)\s*"?$/);
  if (m) return Number(m[1]) + Number(m[2]) / Number(m[3]);
  m = t.match(/(\d+)\/(\d+)\s*"?$/);
  if (m) return Number(m[1]) / Number(m[2]);
  m = t.match(/(\d*)\s*([¼½¾⅛⅜⅝⅞])\s*"?$/);
  if (m) return (m[1] ? Number(m[1]) : 0) + FRAC[m[2]];
  m = t.match(/(\d+(?:\.\d+)?)\s*"$/);
  if (m) return Number(m[1]);
  return null;
}

/** The architectural scales a floor plan is drawn at, paper inches per foot. */
export const PLAN_SCALES = [1 / 16, 3 / 32, 1 / 8, 3 / 16, 1 / 4, 3 / 8, 1 / 2, 3 / 4, 1];

/**
 * The sheet's scale note → paper inches per foot. CAD lettering often splits "1/4" = 1'-0"" into stacked "1" and
 * "4" items beside "" = 1'-0"", so the pieces just left of the "=" are read back together. Prefers the note nearest
 * a "FLOOR PLAN" title.
 */
export function scaleFromText(texts: SheetText[]): { paperInPerFt: number; text: string } | null {
  const notes: Array<{ v: number; text: string; at: P }> = [];
  for (const it of texts) {
    const s = it.str;
    if (!/=\s*1\s*'\s*-?\s*0?\s*"?/.test(s) && !/=\s*1'?$/.test(s)) continue;
    const [left] = s.split("=");
    let v = paperInches(left);
    let shown = s.trim();
    if (v == null) {
      // Stacked or split: the items just left of this one (within a glyph or two), top first.
      const h = it.h ?? 10;
      const near = texts
        .filter((o) => o !== it && o.x < it.x + 1 && o.x > it.x - h * 3 && Math.abs(o.y - it.y) < h * 1.6 && /^[\d¼½¾⅛⅜⅝⅞/⁄ ]+$/.test(o.str.trim()))
        .sort((a, b) => a.x - b.x || a.y - b.y);
      const digits = near.map((o) => o.str.trim());
      if (near.length === 2 && /^\d+$/.test(digits[0]) && /^\d+$/.test(digits[1])) {
        // Two numbers stacked: the upper is the numerator.
        const [top, bot] = [...near].sort((a, b) => a.y - b.y);
        v = Number(top.str) / Number(bot.str);
        shown = `${top.str.trim()}/${bot.str.trim()}${left.trim()} = 1'-0"`.replace(/""/, '"');
      } else if (near.length) v = paperInches(digits.join(" ") + left);
    }
    if (v && v > 0 && v <= 3) notes.push({ v, text: shown.replace(/\s+/g, " "), at: { x: it.x, y: it.y } });
  }
  if (!notes.length) return null;
  const title = texts.find((t) => /floor\s*plan/i.test(t.str));
  const pick = title ? notes.sort((a, b) => dist(a.at, title) - dist(b.at, title))[0] : notes[0];
  // A note that isn't one of the standard scales is still taken — it is what the sheet says.
  return { paperInPerFt: pick.v, text: pick.text.includes("=") ? pick.text : `${pick.text}` };
}

/** Real inches per sheet point at a paper scale. */
export const inchesPerPoint = (paperInPerFt: number) => 12 / (paperInPerFt * 72);

/* ── Lines in plan inches ──────────────────────────────────────────────────────────────────────────────────────── */

type L = { a: P; b: P; w: number; role: LayerRole; curve: boolean; path: number };

type Line = L & { u: P; n: P; c: number; t0: number; t1: number; ang: number };

const RAD = 180 / Math.PI;

function asLine(s: L): Line | null {
  const d = sub(s.b, s.a);
  const l = Math.hypot(d.x, d.y);
  if (l < 1e-6) return null;
  let u = { x: d.x / l, y: d.y / l };
  // One direction per orientation, so parallel lines share a normal.
  let ang = Math.atan2(u.y, u.x) * RAD;
  if (ang < 0) ang += 180;
  // One orientation, one angle: 179.9° is 0° — so parallel lines always share a normal and a side.
  if (ang >= 179.5) ang -= 180;
  const r = ang / RAD;
  u = { x: Math.cos(r), y: Math.sin(r) };
  const n = { x: u.y, y: -u.x };
  const c = n.x * s.a.x + n.y * s.a.y;
  const ta = u.x * s.a.x + u.y * s.a.y;
  const tb = u.x * s.b.x + u.y * s.b.y;
  return { ...s, u, n, c, t0: Math.min(ta, tb), t1: Math.max(ta, tb), ang };
}

/* ── The reader ────────────────────────────────────────────────────────────────────────────────────────────────── */

export type PlanRead = {
  doc: DesignDoc;
  /** Inches per sheet point used. */
  inPerPt: number;
  /** Where the plan sits on the sheet (points) — for the underlay and the label read. */
  region: { x: number; y: number; w: number; h: number };
  /** Plan inches → sheet points: sheet = region.xy + inches / inPerPt. */
  layered: boolean;
  scaleText: string | null;
  notes: string[];
};

export type PlanReadOptions = {
  /** Paper inches per foot when the contractor set it (or calibration gave it). */
  paperInPerFt?: number | null;
  /** Only read inside this box (sheet points) — required for a sheet without CAD layers. */
  region?: { x: number; y: number; w: number; h: number } | null;
  /** A sheet without CAD layers: only lines drawn with this pen or heavier are walls (see wallPen). */
  minWidth?: number;
  title?: string;
  fileName?: string;
  page?: number;
  /** For checks: the wall tracks before they became walls. */
  debug?: (info: { tracks: Array<{ ang: number; c: number; thick: number; runs: Array<{ t0: number; t1: number }> }> }) => void;
};

const WALL_MIN = 2.5; // inches: thinner pairs are trim, glazing or a countertop edge
const WALL_MAX = 16; // inches: thicker pairs are two walls with a chase, or furniture
const GAP_MERGE = 12; // inches: a break this short is a crossing wall, not an opening
const OPENING_MAX = 192; // 16 ft: a longer break is two walls
const COVERED_MAX = 228; // 19 ft: a break the sheet draws something across (a double garage door) is still one wall
const SLIDER_MIN = 84; // a glazed break wider than 7 ft is a slider (a window that wide is rare on a house)
const GARAGE_MIN = 156; // wider than 13 ft: a garage door
const WIDE_OPENING = 144; // an undrawn break up to 12 ft between two real stretches of one wall is a cased opening

export function readPlan(sheet: VectorSheet, texts: SheetText[], opts: PlanReadOptions = {}): PlanRead {
  const notes: string[] = [];
  const roleOf = (s: VSeg): LayerRole => layerRole(s.layer);
  const layered = sheet.segs.some((s) => roleOf(s) === "wall");

  // ── Scale ──
  const fromText = scaleFromText(texts);
  const paper = opts.paperInPerFt ?? fromText?.paperInPerFt ?? 0.25;
  if (!opts.paperInPerFt && !fromText) notes.push("No scale note found on the sheet — read at ¼\" = 1'-0\"; set the scale if the sizes look wrong.");
  const k = inchesPerPoint(paper);

  // ── Region ──
  let region = opts.region ?? null;
  if (!region) {
    const wallSegs = sheet.segs.filter((s) => roleOf(s) === "wall");
    if (wallSegs.length) {
      const xs = wallSegs.flatMap((s) => [s.x1, s.x2]);
      const ys = wallSegs.flatMap((s) => [s.y1, s.y2]);
      const m = 72 / k; // six feet of margin around the walls, in points
      region = { x: Math.min(...xs) - m, y: Math.min(...ys) - m, w: Math.max(...xs) - Math.min(...xs) + 2 * m, h: Math.max(...ys) - Math.min(...ys) + 2 * m };
    } else {
      region = { x: 0, y: 0, w: sheet.width, h: sheet.height };
      notes.push("This sheet keeps no CAD layers: box the floor plan so only its lines are read.");
    }
  }
  const R = region;
  const inR = (s: VSeg) => {
    const x0 = Math.min(s.x1, s.x2);
    const x1 = Math.max(s.x1, s.x2);
    const y0 = Math.min(s.y1, s.y2);
    const y1 = Math.max(s.y1, s.y2);
    return x1 >= R.x && x0 <= R.x + R.w && y1 >= R.y && y0 <= R.y + R.h;
  };
  const toIn = (x: number, y: number): P => ({ x: (x - R.x) * k, y: (y - R.y) * k });
  const minW = opts.minWidth ? opts.minWidth - 0.01 : 0;
  const lines: L[] = sheet.segs.filter((s) => inR(s) && (!minW || s.w >= minW)).map((s) => ({ a: toIn(s.x1, s.y1), b: toIn(s.x2, s.y2), w: s.w, role: roleOf(s), curve: !!s.curve, path: s.path }));
  // A sheet without CAD layers draws its windows, sliders and garage doors in a lighter pen than its walls: the pen
  // the walls were picked by left them out, and every one became a break that ended its wall — the rooms around it
  // never closed (2026-10-18, a real set: 20 rooms on the sheet, 5 closed). They are looked for in every lighter pen,
  // inside a wall's own thickness across a break; a grid keeps the hundred thousand strokes of such a sheet quick.
  const CELL = 36;
  const thinGrid = new Map<string, L[]>();
  if (!layered && minW) {
    for (const s of sheet.segs) {
      if (s.curve || s.w >= minW || !inR(s)) continue;
      const l: L = { a: toIn(s.x1, s.y1), b: toIn(s.x2, s.y2), w: s.w, role: "window", curve: false, path: s.path };
      if (dist(l.a, l.b) < 2) continue;
      const key = `${Math.floor((l.a.x + l.b.x) / 2 / CELL)}:${Math.floor((l.a.y + l.b.y) / 2 / CELL)}`;
      const cell = thinGrid.get(key);
      if (cell) cell.push(l);
      else thinGrid.set(key, [l]);
    }
  }
  const thinNear = (box: { x0: number; y0: number; x1: number; y1: number }): L[] => {
    const out: L[] = [];
    for (let gx = Math.floor(box.x0 / CELL) - 1; gx <= Math.floor(box.x1 / CELL) + 1; gx++)
      for (let gy = Math.floor(box.y0 / CELL) - 1; gy <= Math.floor(box.y1 / CELL) + 1; gy++) {
        const cell = thinGrid.get(`${gx}:${gy}`);
        if (cell) out.push(...cell);
      }
    return out;
  };

  // ── Walls: pair the parallel lines ──
  const wallLines = lines
    .filter((l) => !l.curve && (layered ? l.role === "wall" : l.role !== "elevation" && l.role !== "dims"))
    .map(asLine)
    .filter((l): l is Line => !!l && l.t1 - l.t0 >= (layered ? 1 : 6));
  type Piece = { ang: number; u: P; n: P; c: number; t0: number; t1: number; thick: number };
  const pieces: Piece[] = [];
  const near = (a: number, b: number) => Math.abs(a - b) <= 0.75;
  // Every parallel pair a wall's thickness apart, then matched NEAREST FIRST along each stretch of each line: a
  // short stub drawn on a wall claims only its own stretch of the wall's face, never the whole length.
  const cands: Array<{ i: number; j: number; d: number; o0: number; o1: number }> = [];
  for (let i = 0; i < wallLines.length; i++) {
    const s = wallLines[i];
    for (let j = i + 1; j < wallLines.length; j++) {
      const t = wallLines[j];
      if (!near(s.ang, t.ang)) continue;
      const d = s.n.x * t.a.x + s.n.y * t.a.y - s.c;
      const ad = Math.abs(d);
      if (ad < WALL_MIN || ad > WALL_MAX) continue;
      const ta = s.u.x * t.a.x + s.u.y * t.a.y;
      const tb = s.u.x * t.b.x + s.u.y * t.b.y;
      const o0 = Math.max(s.t0, Math.min(ta, tb));
      const o1 = Math.min(s.t1, Math.max(ta, tb));
      if (o1 - o0 < 2) continue;
      cands.push({ i, j, d, o0, o1 });
    }
  }
  cands.sort((x, y) => Math.abs(x.d) - Math.abs(y.d));
  type Iv = [number, number];
  const covered = new Map<string, Iv[]>();
  const minus = (iv: Iv, cut: Iv[]): Iv[] => {
    let out: Iv[] = [iv];
    for (const [c0, c1] of cut) {
      const next: Iv[] = [];
      for (const [a0, a1] of out) {
        if (c1 <= a0 || c0 >= a1) next.push([a0, a1]);
        else {
          if (c0 > a0) next.push([a0, c0]);
          if (c1 < a1) next.push([c1, a1]);
        }
      }
      out = next;
    }
    return out;
  };
  for (const c of cands) {
    const s = wallLines[c.i];
    const t = wallLines[c.j];
    const dJ = t.n.x * s.a.x + t.n.y * s.a.y - t.c;
    const kI = `${c.i}:${c.d > 0 ? "+" : "-"}`;
    const kJ = `${c.j}:${dJ > 0 ? "+" : "-"}`;
    const free = minus([c.o0, c.o1], covered.get(kI) ?? []).flatMap((iv) => minus(iv, covered.get(kJ) ?? []));
    for (const [f0, f1] of free) if (f1 - f0 >= 2) pieces.push({ ang: s.ang, u: s.u, n: s.n, c: s.c + c.d / 2, t0: f0, t1: f1, thick: Math.abs(c.d) });
    covered.set(kI, [...(covered.get(kI) ?? []), [c.o0, c.o1]]);
    covered.set(kJ, [...(covered.get(kJ) ?? []), [c.o0, c.o1]]);
  }

  // ── Join pieces on one line into runs ──
  /** `face`: no stretch of wall, the face of the crossing wall a line was carried to (a zero-length run). */
  type Run = { t0: number; t1: number; face?: boolean };
  type Track = { ang: number; u: P; n: P; c: number; thick: number; runs: Run[] };
  const tracks: Track[] = [];
  for (const p of pieces.sort((a, b) => a.ang - b.ang || a.c - b.c)) {
    let tr = tracks.find((t) => near(t.ang, p.ang) && Math.abs(t.c - p.c) <= 1 && Math.abs(t.thick - p.thick) <= 1.25);
    if (!tr) {
      tr = { ang: p.ang, u: p.u, n: p.n, c: p.c, thick: p.thick, runs: [] };
      tracks.push(tr);
    }
    tr.runs.push({ t0: p.t0, t1: p.t1 });
  }
  for (const tr of tracks) {
    const rs = tr.runs.sort((a, b) => a.t0 - b.t0);
    const merged: Run[] = [];
    for (const r of rs) {
      const last = merged[merged.length - 1];
      if (last && r.t0 <= last.t1 + 0.75) last.t1 = Math.max(last.t1, r.t1);
      else merged.push({ ...r });
    }
    tr.runs = merged;
  }

  opts.debug?.({ tracks: tracks.map((t) => ({ ang: t.ang, c: t.c, thick: t.thick, runs: t.runs })) });

  // ── Door swings: each arc fitted to its circle — the hinge is the center, the door's width the radius ──
  type Swing = { H: P; r: number; pts: P[] };
  const swings: Swing[] = [];
  for (const arc of sheet.arcs) {
    const role = layerRole(arc.layer);
    if (layered ? role !== "door" : role === "elevation" || role === "dims") continue;
    const pts = arc.pts.map((q) => toIn(q.x, q.y));
    if (pts.length < 3) continue;
    const [p1, p2, p3] = [pts[0], pts[Math.floor(pts.length / 2)], pts[pts.length - 1]];
    const H = circumcenter(p1, p2, p3);
    if (!H) continue;
    const r = dist(H, p1);
    if (r < 12 || r > 48) continue;
    // A door swing is about a quarter turn.
    const a1 = Math.atan2(p1.y - H.y, p1.x - H.x);
    const a3 = Math.atan2(p3.y - H.y, p3.x - H.x);
    let span = Math.abs(a3 - a1);
    if (span > Math.PI) span = Math.PI * 2 - span;
    if (span < (55 * Math.PI) / 180 || span > (125 * Math.PI) / 180) continue;
    if (H.x < -24 || H.y < -24 || H.x > R.w * k + 24 || H.y > R.h * k + 24) continue;
    swings.push({ H, r, pts });
  }

  const local = (tr: Track, p: P) => ({ t: tr.u.x * p.x + tr.u.y * p.y, o: tr.n.x * p.x + tr.n.y * p.y - tr.c });
  const world = (tr: Track, t: number, o = 0): P => ({ x: tr.u.x * t + tr.n.x * (tr.c + o), y: tr.u.y * t + tr.n.y * (tr.c + o) });

  // ── A short stub lying inside another wall's thickness is a jamb return drawn there — not a wall ──
  for (let i = tracks.length - 1; i >= 0; i--) {
    const tr = tracks[i];
    const total = tr.runs.reduce((s2, r) => s2 + (r.t1 - r.t0), 0);
    if (total > 14) continue;
    // Each piece of it lies wholly inside some other wall's thickness (a jamb return drawn in a crossing wall, or a
    // ghost pairing along a wall's face). A stub that sticks out of the wall it touches is a real wall's end.
    const hosted = tr.runs.every((run) => {
      const ends = [world(tr, run.t0), world(tr, run.t1)];
      return tracks.some((o) => {
        // Only a real wall hosts a stub — two stubs' end caps never vouch for each other.
        if (o === tr || o.runs.reduce((s2, r) => s2 + (r.t1 - r.t0), 0) < 24) return false;
        return ends.every((p) => {
          const q = local(o, p);
          return Math.abs(q.o) <= o.thick / 2 + 1.5 && o.runs.some((r) => q.t >= r.t0 - 3 && q.t <= r.t1 + 3);
        });
      });
    });
    if (hosted) tracks.splice(i, 1);
  }

  // ── Openings at a wall line's ends: carry the line to the crossing wall when a door or window is in between ──
  const winLines = lines.filter((l) => !l.curve && l.role === "window");
  const doorLines = lines.filter((l) => !l.curve && l.role === "door");
  const inBand = (tr: Track, g0: number, g1: number, p: P, extra = 0) => {
    const q = local(tr, p);
    return q.t >= g0 - 1 && q.t <= g1 + 1 && Math.abs(q.o) <= tr.thick / 2 + 2 + extra;
  };
  const swingsIn = (tr: Track, g0: number, g1: number) => swings.filter((sw) => inBand(tr, g0 - 1, g1 + 1, sw.H, 2));
  /** How much of the gap a window covers — the union along the wall (a window is drawn as three or four lines). */
  const coverage = (tr: Track, g0: number, g1: number, ls: L[]) => {
    const ivs = ls.map((l) => [Math.min(local(tr, l.a).t, local(tr, l.b).t), Math.max(local(tr, l.a).t, local(tr, l.b).t)] as [number, number]).sort((x, y) => x[0] - y[0]);
    let covered = 0;
    let reach = -Infinity;
    for (const [a0, a1] of ivs) {
      const s0 = Math.max(a0, reach, g0);
      const s1 = Math.min(a1, g1);
      if (s1 > s0) covered += s1 - s0;
      reach = Math.max(reach, a1);
    }
    return covered;
  };
  const windowIn = (tr: Track, g0: number, g1: number) => coverage(tr, g0, g1, winLines.filter((l) => inBand(tr, g0, g1, l.a) && inBand(tr, g0, g1, l.b)));
  /** What a sheet without layers draws across a break in a wall, in its lighter pens:
   *  "glass" — lines two or more deep with one inside the wall (the glass): a window, a slider, a garage door;
   *  "wall"  — just the wall's two faces, unbroken: the same wall drawn in a lighter pen, no opening at all;
   *  null    — nothing, or dashes (a beam or soffit above, the line of a floor below), or a single threshold line. */
  const thinIn = (tr: Track, g0: number, g1: number): "glass" | "wall" | null => {
    if (layered || !thinGrid.size || g1 - g0 < 6) return null;
    const A = world(tr, g0, -tr.thick / 2 - 2);
    const B = world(tr, g1, tr.thick / 2 + 2);
    const C = world(tr, g0, tr.thick / 2 + 2);
    const D = world(tr, g1, -tr.thick / 2 - 2);
    const xs = [A.x, B.x, C.x, D.x];
    const ys = [A.y, B.y, C.y, D.y];
    // Lines running ALONG the wall inside its thickness — a jamb tick across it says nothing about glass.
    const ls = thinNear({ x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }).filter((l) => {
      if (!inBand(tr, g0, g1, l.a) || !inBand(tr, g0, g1, l.b)) return false;
      const qa = local(tr, l.a);
      const qb = local(tr, l.b);
      return Math.abs(qb.t - qa.t) >= 3 * Math.abs(qb.o - qa.o);
    });
    const gap = g1 - g0;
    const byDepth = new Map<number, L[]>();
    for (const l of ls) {
      const d = Math.round(((local(tr, l.a).o + local(tr, l.b).o) / 2) * 2) / 2;
      byDepth.set(d, [...(byDepth.get(d) ?? []), l]);
    }
    // A depth counts when it is drawn across most of the break in a few long strokes — dashes are a beam above.
    const solid = [...byDepth.entries()].filter(([, g]) => {
      const cov = coverage(tr, g0, g1, g);
      return cov >= gap * 0.6 && !(g.length >= 4 && cov / g.length < 18);
    });
    if (solid.length < 2) return null;
    const inner = solid.some(([d]) => Math.abs(d) <= tr.thick * 0.3);
    return inner || solid.length >= 3 ? "glass" : "wall";
  };
  /** Door-layer lines along the wall (a slider's panels, a bifold's leaves) that cover at least half the gap. */
  const leafIn = (tr: Track, g0: number, g1: number) => {
    const ls = doorLines.filter((l) => inBand(tr, g0, g1, l.a, 14) && inBand(tr, g0, g1, l.b, 14));
    return coverage(tr, g0, g1, ls) >= (g1 - g0) * 0.5 ? ls : [];
  };
  /** Another wall on (nearly) this same line already holds this stretch. */
  const heldByTwin = (tr: Track, g0: number, g1: number) =>
    tracks.some((o) => o !== tr && near(o.ang, tr.ang) && Math.abs(o.c - tr.c) <= (o.thick + tr.thick) / 2 && o.runs.some((r) => r.t1 > g0 + 1 && r.t0 < g1 - 1));
  for (const tr of tracks) {
    if (!tr.runs.length) continue;
    for (const side of ["start", "end"] as const) {
      const edge = side === "start" ? tr.runs[0].t0 : tr.runs[tr.runs.length - 1].t1;
      // Every crossing wall present at this line beyond the end, nearest first. A wall that only reaches the line
      // (a T) lets the search go on past it; one that crosses the line stops it.
      const stops: Array<{ face: number; through: boolean; real: boolean }> = [];
      for (const cr of tracks) {
        if (cr === tr || near(cr.ang, tr.ang)) continue;
        const X = lineX(world(tr, 0), world(tr, 100), world(cr, 0), world(cr, 100));
        if (!X) continue;
        const tc = local(tr, X).t;
        const beyond = side === "start" ? edge - tc : tc - edge;
        if (beyond < -1 || beyond > COVERED_MAX) continue;
        const tcr = local(cr, X).t;
        const reach = tr.thick / 2 + 3;
        if (!cr.runs.some((r) => tcr >= r.t0 - reach && tcr <= r.t1 + reach)) continue;
        const through = cr.runs.some((r) => r.t0 < tcr - reach && r.t1 > tcr + reach);
        // A post or a jamb return is not a wall to run to — a beam drawn out to the porch posts is not a wall.
        const real = cr.runs.reduce((s2, r) => s2 + (r.t1 - r.t0), 0) >= 24;
        stops.push({ face: side === "start" ? tc + cr.thick / 2 : tc - cr.thick / 2, through, real });
      }
      stops.sort((x, y) => (side === "start" ? y.face - x.face : x.face - y.face));
      let bestB: number | null = null;
      for (const st of stops) {
        const g0 = side === "start" ? st.face : edge;
        const g1 = side === "start" ? edge : st.face;
        const gap = g1 - g0;
        const win = gap > 0.5 ? windowIn(tr, g0, g1) : 0;
        // A wall of its own (not a post, a jamb return or a pair of lettering strokes) may reach across.
        const real = tr.runs.reduce((s2, r) => s2 + (r.t1 - r.t0), 0) >= 24;
        const thin = real && gap > GAP_MERGE ? thinIn(tr, g0, g1) : null;
        // A break up to 4 ft at a wall's end that the sheet draws nothing across is a doorway, cased or doorless —
        // the wall still meets the one it runs into, with the opening in it (the room beyond it closes).
        const fits =
          gap <= GAP_MERGE ||
          win >= gap * 0.5 ||
          (!!thin && gap <= COVERED_MAX && st.real) ||
          (gap <= 96 && (swingsIn(tr, g0, g1).length || leafIn(tr, g0, g1).length)) ||
          (real && st.real && gap <= 48);
        if (gap > 0.5 && fits && !heldByTwin(tr, g0, g1)) {
          bestB = st.face;
          break;
        }
        if (st.through) break;
      }
      if (bestB == null) continue;
      if (side === "start") tr.runs.unshift({ t0: bestB, t1: bestB, face: true });
      else tr.runs.push({ t0: bestB, t1: bestB, face: true });
    }
  }

  // ── Openings in the breaks; walls from the runs ──
  const walls: Wall[] = [];
  const openings: Opening[] = [];
  for (const tr of tracks) {
    const rs = tr.runs;
    if (!rs.length) continue;
    let start = rs[0].t0;
    let pending: Array<Omit<Opening, "wallId" | "at"> & { t: number }> = [];
    const flush = (end: number) => {
      // A run shorter than its own thickness with nothing in it is a jamb return or a column, not a wall.
      if (end - start < Math.max(6, tr.thick + 1) && !pending.length) {
        pending = [];
        return;
      }
      const id = newId("w");
      walls.push({ id, a: world(tr, start), b: world(tr, end), thick: Math.round(tr.thick * 4) / 4, height: DEFAULT_CEILING, from: "plan" });
      for (const o of pending) openings.push({ ...o, wallId: id, at: o.t - start });
      pending = [];
    };
    for (let i = 0; i < rs.length - 1; i++) {
      const g0 = rs[i].t1;
      const g1 = rs[i + 1].t0;
      const gap = g1 - g0;
      if (gap <= GAP_MERGE) continue; // a crossing wall
      const sw = swingsIn(tr, g0, g1);
      const win = windowIn(tr, g0, g1);
      const leafs = leafIn(tr, g0, g1);
      const thin = sw.length ? null : thinIn(tr, g0, g1);
      // The same wall, drawn on in a lighter pen: no break at all.
      if (thin === "wall") continue;
      const made: Array<Omit<Opening, "wallId" | "at"> & { t: number }> = [];
      const glazed = !sw.length && (win >= gap * 0.6 || thin === "glass");
      if (glazed && gap > GARAGE_MIN) made.push({ id: newId("o"), kind: "opening", t: (g0 + g1) / 2, width: Math.round(gap), height: 96, sill: 0 });
      else if (glazed && gap > SLIDER_MIN) made.push({ id: newId("o"), kind: "slider", t: (g0 + g1) / 2, width: Math.round(gap), height: DOOR_HEIGHT, sill: 0 });
      else if (glazed) made.push({ id: newId("o"), kind: "window", t: (g0 + g1) / 2, width: Math.round(gap), height: WINDOW_HEIGHT, sill: WINDOW_SILL });
      else if (sw.length) {
        // Each swing: the hinge on one jamb, the door as wide as the swing. Two hinges facing → a pair of doors.
        const doors = sw
          .map((s) => {
            const h = local(tr, s.H).t;
            const toward = s.pts.reduce((m, p) => m + (local(tr, p).t - h), 0) >= 0 ? 1 : -1;
            const side = s.pts.reduce((m, p) => m + local(tr, p).o, 0) >= 0 ? "left" : "right";
            return { h, r: s.r, toward, side: side as "left" | "right" };
          })
          .sort((x, y) => x.h - y.h);
        const pair = doors.length >= 2 && doors[0].toward > 0 && doors[doors.length - 1].toward < 0 && doors[doors.length - 1].h - doors[0].h <= doors[0].r + doors[doors.length - 1].r + 4;
        if (pair) {
          const t0 = doors[0].h;
          const t1 = doors[doors.length - 1].h;
          made.push({ id: newId("o"), kind: "double", t: (t0 + t1) / 2, width: Math.round(t1 - t0), height: DOOR_HEIGHT, sill: 0, swing: doors[0].side });
        } else
          for (const d of doors) {
            const w = Math.min(Math.round(d.r), Math.round(gap));
            const t0 = d.toward > 0 ? d.h : d.h - w;
            made.push({ id: newId("o"), kind: "door", t: Math.max(g0 + w / 2, Math.min(g1 - w / 2, t0 + w / 2)), width: w, height: DOOR_HEIGHT, sill: 0, hinge: d.toward > 0 ? "a" : "b", swing: d.side });
          }
      } else if (leafs.length) made.push({ id: newId("o"), kind: gap >= 30 && leafs.some((l) => Math.abs(local(tr, l.b).o - local(tr, l.a).o) > 4) ? "door" : "slider", t: (g0 + g1) / 2, width: Math.round(gap), height: DOOR_HEIGHT, sill: 0 });
      else {
        // An undrawn break is a doorway only between two stretches of wall (or a wall's face it was carried to) — a
        // post standing on the wall's line (a porch column) is not the other jamb.
        const side = (r: Run, min: number) => !!r.face || r.t1 - r.t0 >= min;
        if ((gap <= 72 && side(rs[i], 16) && side(rs[i + 1], 16)) || (gap <= WIDE_OPENING && side(rs[i], 24) && side(rs[i + 1], 24)))
          made.push({ id: newId("o"), kind: "opening", t: (g0 + g1) / 2, width: Math.round(gap), height: DOOR_HEIGHT, sill: 0 });
      }
      if (!made.length || gap > (glazed ? COVERED_MAX : OPENING_MAX)) {
        flush(g0);
        start = g1;
        continue;
      }
      pending.push(...made);
    }
    flush(rs[rs.length - 1].t1);
  }

  // ── Drop a stub that sits inside another wall (a jamb return read as a wall of its own) ──
  for (let i = walls.length - 1; i >= 0; i--) {
    const w = walls[i];
    const L = dist(w.a, w.b);
    if (L > 14 || openings.some((o) => o.wallId === w.id)) continue;
    const mid = { x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 };
    const inside = walls.some((o) => o !== w && project(o.a, o.b, mid).off <= o.thick / 2 + 2 && project(o.a, o.b, mid).tRaw > -2 && project(o.a, o.b, mid).tRaw < dist(o.a, o.b) + 2);
    if (inside) walls.splice(i, 1);
  }

  // ── Corners: carry wall ends to where the centerlines meet ──
  for (let pass = 0; pass < 2; pass++) {
    for (const w of walls) {
      for (const end of ["a", "b"] as const) {
        const E = w[end];
        let bestX: { x: P; w2: Wall; end2: "a" | "b" | null; d: number } | null = null;
        for (const w2 of walls) {
          if (w2 === w) continue;
          const d1 = sub(w.b, w.a);
          const d2 = sub(w2.b, w2.a);
          const sin = Math.abs(cross(d1, d2)) / (Math.hypot(d1.x, d1.y) * Math.hypot(d2.x, d2.y) || 1);
          if (sin < 0.17) continue; // nearly parallel: not a corner
          const X = lineX(w.a, w.b, w2.a, w2.b);
          if (!X) continue;
          // A sheet without layers draws its corners less exactly (a jog for the siding, a pen's width): reach further.
          const reach = w.thick / 2 + w2.thick + (layered ? 3 : 9);
          const dE = dist(E, X);
          if (dE > reach) continue;
          // X must be on (or just past the end of) the other wall.
          const pr = project(w2.a, w2.b, X);
          const L2 = dist(w2.a, w2.b);
          if (pr.tRaw < -(w.thick + 3) || pr.tRaw > L2 + w.thick + 3) continue;
          const end2 = dist(w2.a, X) <= w.thick / 2 + w2.thick + 3 ? "a" : dist(w2.b, X) <= w.thick / 2 + w2.thick + 3 ? "b" : null;
          if (!bestX || dE < bestX.d) bestX = { x: X, w2, end2, d: dE };
        }
        if (bestX) {
          // Moving end a shifts every opening's distance along the wall.
          if (end === "a") {
            const before = dist(w.a, w.b);
            w.a = bestX.x;
            const delta = dist(w.a, w.b) - before;
            for (const o of openings) if (o.wallId === w.id) o.at += delta;
          } else w.b = bestX.x;
          if (bestX.end2) {
            const w2 = bestX.w2;
            if (bestX.end2 === "a") {
              const before = dist(w2.a, w2.b);
              w2.a = bestX.x;
              const delta = dist(w2.a, w2.b) - before;
              for (const o of openings) if (o.wallId === w2.id) o.at += delta;
            } else w2.b = bestX.x;
          }
        }
      }
    }
  }

  // ── Weld ends that nearly meet (two walls of different thickness lined up on one face) ──
  const allEnds = walls.flatMap((w) => [
    { w, end: "a" as const },
    { w, end: "b" as const },
  ]);
  for (let i = 0; i < allEnds.length; i++)
    for (let j = i + 1; j < allEnds.length; j++) {
      const A = allEnds[i];
      const B = allEnds[j];
      if (A.w === B.w) continue;
      const pa = A.w[A.end];
      const pb = B.w[B.end];
      const d = dist(pa, pb);
      if (d < 0.01 || d > Math.max(A.w.thick, B.w.thick) / 2 + 1) continue;
      const m = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
      for (const E of [A, B]) {
        if (E.end === "a") {
          const before = dist(E.w.a, E.w.b);
          E.w.a = m;
          const delta = dist(E.w.a, E.w.b) - before;
          for (const o of openings) if (o.wallId === E.w.id) o.at += delta;
        } else E.w.b = m;
      }
    }

  // ── A wall that touches nothing (a sheet without layers): the underline of a room name, or strokes of lettering
  //    drawn in the wall pen and paired up — never a wall of the house, which meets another at one end at least ──
  if (!layered) {
    const meets = (w: Wall, p: P) =>
      walls.some((o) => {
        if (o === w) return false;
        if (dist(o.a, p) <= 8 || dist(o.b, p) <= 8) return true;
        const pr = project(o.a, o.b, p);
        return pr.off <= o.thick / 2 + 8 && pr.tRaw > -8 && pr.tRaw < dist(o.a, o.b) + 8;
      });
    for (let i = walls.length - 1; i >= 0; i--) {
      const w = walls[i];
      if (dist(w.a, w.b) > 96 || openings.some((o) => o.wallId === w.id)) continue;
      if (!meets(w, w.a) && !meets(w, w.b)) walls.splice(i, 1);
    }
  }

  // ── What the plan drew inside: cabinets, appliances, fixtures ──
  const marks: PlanMark[] = [];
  for (const role of ["cabinet", "appliance", "plumbing"] as MarkRole[]) {
    const ls = lines.filter((l) => l.role === role);
    if (!ls.length) continue;
    // Group touching lines into objects.
    const parent = ls.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const box = (l: L) => ({ x0: Math.min(l.a.x, l.b.x) - 0.5, x1: Math.max(l.a.x, l.b.x) + 0.5, y0: Math.min(l.a.y, l.b.y) - 0.5, y1: Math.max(l.a.y, l.b.y) + 0.5 });
    const bx = ls.map(box);
    for (let i = 0; i < ls.length; i++)
      for (let j = i + 1; j < ls.length; j++) {
        const a = bx[i];
        const b = bx[j];
        if (ls[i].path === ls[j].path || (a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1)) parent[find(i)] = find(j);
      }
    const groups = new Map<number, L[]>();
    ls.forEach((l, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), l]));
    for (const g of groups.values()) {
      const xs = g.flatMap((l) => [l.a.x, l.b.x]);
      const ys = g.flatMap((l) => [l.a.y, l.b.y]);
      const b = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
      if (b.w < 4 && b.h < 4) continue;
      marks.push({ id: newId("m"), role, lines: g.map((l) => [l.a, l.b] as [P, P]), box: b });
    }
  }

  // ── Room names the text layer carries (a CAD font drawn as lines needs the label read) ──
  const ROOM_WORD = /kitchen|living|dining|family|great\s*room|bed\s*room|bedroom|master|primary|bath|powder|laundry|utility|mud\s*room|pantry|closet|\bclo\b|\bw\.?i\.?c\b|garage|entry|foyer|hall|office|den|study|nook|bonus|mech|storage/i;
  const labels: RoomLabel[] = texts
    .filter((t) => t.x >= R.x && t.x <= R.x + R.w && t.y >= R.y && t.y <= R.y + R.h && ROOM_WORD.test(t.str))
    .map((t) => ({ id: newId("r"), name: titleCase(t.str), at: toIn(t.x, t.y) }));

  const doc: DesignDoc = {
    v: 1,
    title: opts.title ?? "Floor plan",
    walls,
    openings,
    labels,
    marks,
    source: { kind: "pdf", fileName: opts.fileName, page: opts.page, scaleText: fromText?.text ?? null, scaleBy: opts.paperInPerFt ? "calibrated" : fromText ? "title" : "assumed", layers: layered },
  };
  const outside = outsideWallIds(doc);
  for (const w of doc.walls) if (outside.has(w.id)) w.exterior = true;
  if (!walls.length) notes.push("No walls were found in the lines read — draw them over the plan instead.");
  else if (!roomsOf(doc).length) notes.push("The walls read don't close into rooms yet — fix the open corners in the plan.");
  return { doc, inPerPt: k, region: R, layered, scaleText: fromText?.text ?? null, notes };
}

function circumcenter(a: P, b: P, c: P): P | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  return { x: (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d, y: (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d };
}

/** "(N) KITCHEN" → "Kitchen"; "BED ROOM 2" → "Bed Room 2". */
export function titleCase(s: string): string {
  return s
    .replace(/\((n|e|new|exist\.?|existing)\)\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

/** The pen a layer-less sheet draws its walls with (2026-10-18). Drafting draws walls heavier than the dimensions,
 *  notes and lettering — and a CAD export without layers draws even its lettering as lines, tens of thousands of them,
 *  which buried the walls. The heaviest pen that has enough long lines (a foot or more) to be a house's walls; 0 when
 *  no pen stands out (read every line, as before). */
export function wallPen(sheet: VectorSheet, region: { x: number; y: number; w: number; h: number } | null, enough = 100): number {
  const R = region ?? { x: 0, y: 0, w: sheet.width, h: sheet.height };
  const count = new Map<number, number>();
  for (const s of sheet.segs) {
    if (s.curve || Math.min(s.x1, s.x2) < R.x || Math.max(s.x1, s.x2) > R.x + R.w || Math.min(s.y1, s.y2) < R.y || Math.max(s.y1, s.y2) > R.y + R.h) continue;
    if (Math.hypot(s.x2 - s.x1, s.y2 - s.y1) < 18) continue;
    const w = Math.round(s.w * 100) / 100;
    count.set(w, (count.get(w) ?? 0) + 1);
  }
  const pens = [...count.keys()].sort((a, b) => b - a);
  if (pens.length < 2) return 0;
  let acc = 0;
  for (const w of pens) {
    acc += count.get(w)!;
    if (acc >= enough) return w === pens[pens.length - 1] ? 0 : w;
  }
  return 0;
}
