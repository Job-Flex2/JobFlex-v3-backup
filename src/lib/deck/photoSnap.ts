// THE READ SNAPPED TO THE PHOTO (2026-10-23). Pure. Owner, with a screenshot of the live read: "it's still converting,
// but wrong" — the vision model found the windows but drew them shifted and shrunk, and read a row of four as one.
// A model says roughly where a thing is; the picture says exactly where its edges are. So the windows and doors move
// together first — every box's own best fit tried on the whole pattern, the one that puts the most boxes on frames at
// once wins — then each side onto the strongest edge near it; the wall's two corners, its base and each step's corner
// board move the same way, each only within a short reach and only when the edge there is clearly stronger than the
// wall around it (otherwise the line stays). A box that holds a row of windows — strong frames standing up inside it
// at a steady pitch — is split into them. The eave stays where the model put it (gutter, fascia and soffit are a stack
// of edges a few pixels apart), only never below a window head.
//
// Works on a grey picture (luminance 0…1, row by row) the browser makes of the photo; fractions in, fractions out.

import type { HouseRead } from "./houseRead";

export interface Gray {
  w: number;
  h: number;
  /** Luminance 0…1, row by row. */
  data: Float32Array;
}

/** |∂/∂x| and |∂/∂y| of the picture (a Sobel operator), the same size; the border is 0. */
export function gradients(g: Gray): { gx: Float32Array; gy: Float32Array } {
  const { w, h, data: d } = g;
  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const a = d[i - w - 1], b = d[i - w], c = d[i - w + 1];
      const l = d[i - 1], r = d[i + 1];
      const e = d[i + w - 1], f = d[i + w], k = d[i + w + 1];
      gx[i] = Math.abs(c + 2 * r + k - a - 2 * l - e) / 4;
      gy[i] = Math.abs(e + 2 * f + k - a - 2 * b - c) / 4;
    }
  }
  return { gx, gy };
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const r3 = (n: number) => Math.round(n * 1000) / 1000;

interface Field {
  w: number;
  h: number;
  gx: Float32Array;
  gy: Float32Array;
}

/** How strongly a vertical line at column x stands out between rows y0…y1 (the mean |∂x|). */
function colScore(f: Field, x: number, y0: number, y1: number): number {
  if (x < 1 || x > f.w - 2) return 0;
  let s = 0;
  let n = 0;
  for (let y = Math.max(1, y0); y <= Math.min(f.h - 2, y1); y++) {
    s += f.gx[y * f.w + x];
    n++;
  }
  return n ? s / n : 0;
}
/** How strongly a horizontal line at row y stands out between columns x0…x1 (the mean |∂y|). */
function rowScore(f: Field, y: number, x0: number, x1: number): number {
  if (y < 1 || y > f.h - 2) return 0;
  let s = 0;
  let n = 0;
  for (let x = Math.max(1, x0); x <= Math.min(f.w - 2, x1); x++) {
    s += f.gy[y * f.w + x];
    n++;
  }
  return n ? s / n : 0;
}

/**
 * The best line near `at` (px) within ±reach: the strongest of the candidates, taken only when it beats the typical
 * line there by `lift` (so a plain stretch of siding does not pull a line about). Null to stay put.
 */
function bestNear(at: number, reach: number, lo: number, hi: number, score: (p: number) => number, lift = 1.35): number | null {
  const a = Math.round(clamp(at - reach, lo, hi));
  const b = Math.round(clamp(at + reach, lo, hi));
  if (b - a < 2) return null;
  const vals: Array<[number, number]> = [];
  for (let p = a; p <= b; p++) vals.push([p, score(p)]);
  const sorted = vals.map((v) => v[1]).sort((m, n) => m - n);
  const typical = sorted[Math.floor(sorted.length / 2)];
  // Nearest of the strongest: within 8% of the best, the one closest to where the model put it.
  const top = Math.max(...sorted);
  if (!(top > 0.02) || top < typical * lift) return null;
  let pick: number | null = null;
  for (const [p, v] of vals) if (v >= top * 0.92 && (pick === null || Math.abs(p - at) < Math.abs(pick - at))) pick = p;
  return pick;
}

type Box = { x0: number; x1: number; top: number; bottom: number };

/** A box (a window, a door) moved onto its frame: each side to the strongest edge near it, the box kept a box. */
function snapBox(f: Field, b: Box): Box {
  const X0 = b.x0 * f.w, X1 = b.x1 * f.w, T = b.top * f.h, B = b.bottom * f.h;
  const bw = X1 - X0, bh = B - T;
  // Short reaches: the whole pattern was aligned first (alignBoxes), so a side only has a little way to go — and a long
  // reach would catch a window's own bars instead of its frame.
  const rx = Math.max(4, bw * 0.2);
  const ry = Math.max(4, bh * 0.18);
  const ys = [Math.round(T + bh * 0.15), Math.round(B - bh * 0.15)] as const;
  const col = (x: number) => colScore(f, x, ys[0], ys[1]);
  const left = outerEdge(bestNear(X0, rx, 1, f.w - 2, col), -1, bw, col);
  const right = outerEdge(bestNear(X1, rx, 1, f.w - 2, col), 1, bw, col);
  // No frame standing up at either side: this is not over a window's edges (siding courses alone do not move a box).
  if (left === null && right === null) return b;
  const nx0 = left ?? X0;
  const nx1 = right ?? X1;
  // The new sides must still make a box of about the model's size (a third to three times it).
  const okX = nx1 - nx0 > Math.max(4, bw / 3) && nx1 - nx0 < bw * 3;
  const fx0 = okX ? nx0 : X0;
  const fx1 = okX ? nx1 : X1;
  const xa = Math.round(fx0 + (fx1 - fx0) * 0.15), xb = Math.round(fx1 - (fx1 - fx0) * 0.15);
  const row = (y: number) => rowScore(f, y, xa, xb);
  const top = outerEdge(bestNear(T, ry, 1, f.h - 2, row), -1, bh, row);
  const bottom = outerEdge(bestNear(B, ry, 1, f.h - 2, row), 1, bh, row);
  const nt = top ?? T;
  const nb = bottom ?? B;
  const okY = nb - nt > Math.max(4, bh / 3) && nb - nt < bh * 3;
  return { x0: r3(fx0 / f.w), x1: r3(fx1 / f.w), top: r3((okY ? nt : T) / f.h), bottom: r3((okY ? nb : B) / f.h) };
}

/**
 * A window's frame shows as two edges — its outside against the wall, its inside against the glass, a few pixels apart:
 * from the edge found, a second strong edge just outward of it (2 px to an eighth of the box) is the frame's outside,
 * and that is the window's edge. Nothing found stays nothing.
 */
function outerEdge(p: number | null, dir: -1 | 1, size: number, score: (q: number) => number): number | null {
  if (p === null) return null;
  const v = score(p);
  const far = Math.max(4, Math.round(size * 0.12));
  for (let d = 2; d <= far; d++) {
    const q = p + dir * d;
    const sq = score(q);
    if (sq >= v * 0.45 && sq >= score(q - 1) && sq >= score(q + 1)) return q;
  }
  return p;
}

/**
 * A box that holds a row of windows split into them: inside it, frames standing up — columns whose edge is nearly as
 * strong as the box's own sides — at a steady pitch, each piece still window-shaped. One window, or a row the frames do
 * not show, comes back whole.
 */
export function splitRow(f: Field, b: Box): Box[] {
  const X0 = Math.round(b.x0 * f.w), X1 = Math.round(b.x1 * f.w);
  const T = Math.round(b.top * f.h), B = Math.round(b.bottom * f.h);
  const bw = X1 - X0, bh = B - T;
  if (bw < 12 || bh < 8 || bw / bh < 1.3) return [b];
  const ya = Math.round(T + bh * 0.2), yb = Math.round(B - bh * 0.2);
  const sides = Math.max(colScore(f, X0, ya, yb), colScore(f, X1, ya, yb), colScore(f, X0 + 1, ya, yb), colScore(f, X1 - 1, ya, yb));
  const prof: number[] = [];
  for (let x = X0; x <= X1; x++) prof.push(colScore(f, x, ya, yb));
  const margin = Math.max(2, Math.round(bw * 0.1));
  const peaks: number[] = [];
  const floor = Math.max(0.03, sides * 0.55);
  for (let i = margin; i < prof.length - margin; i++) {
    if (prof[i] >= floor && prof[i] >= prof[i - 1] && prof[i] >= prof[i + 1]) peaks.push(i);
  }
  // A frame between two windows shows as one or two edges close together: those are one divider.
  const gap = Math.max(3, Math.round(bw * 0.05));
  const dividers: number[] = [];
  for (const p of peaks) {
    const last = dividers[dividers.length - 1];
    if (last !== undefined && p - last <= gap) dividers[dividers.length - 1] = Math.round((last + p) / 2);
    else dividers.push(p);
  }
  if (!dividers.length || dividers.length > 7) return [b];
  const edges = [0, ...dividers, bw];
  const half = Math.max(1, Math.round(gap / 2));
  const all = edges.slice(1).map((_, i) => ({ x0: r3((X0 + edges[i] + (i ? half : 0)) / f.w), x1: r3((X0 + edges[i + 1] - (i < edges.length - 2 ? half : 0)) / f.w), top: b.top, bottom: b.bottom }));
  // A piece is a window only with a frame: its head and its sill as strong as the strongest pieces' — a stretch of
  // siding the box ran over (its courses are faint beside white trim) is not one.
  const frame = (p: Box) => {
    const a = Math.round(p.x0 * f.w), c = Math.round(p.x1 * f.w);
    const near = (y: number) => Math.max(rowScore(f, y - 1, a, c), rowScore(f, y, a, c), rowScore(f, y + 1, a, c));
    return near(Math.round(p.top * f.h)) + near(Math.round(p.bottom * f.h));
  };
  const scores = all.map(frame);
  const strongest = Math.max(...scores);
  const pieces = all.filter((_, i) => scores[i] >= strongest * 0.5);
  // What is left must be a row: pieces of about one width, each window-shaped.
  const widths = pieces.map((p) => (p.x1 - p.x0) * f.w);
  if (pieces.length < 2) return [b];
  const mean = widths.reduce((a, w) => a + w, 0) / widths.length;
  const spread = Math.sqrt(widths.reduce((a, w) => a + (w - mean) ** 2, 0) / widths.length) / mean;
  if (spread > 0.3 || widths.some((w) => w < bh * 0.25)) return [b];
  return pieces;
}

/** How well one box's outline sits on the picture's edges: its standing sides on |∂x|, its head and sill on |∂y|. */
function outlineScore(f: Field, x0: number, x1: number, y0: number, y1: number): number {
  if (x0 < 1 || y0 < 1 || x1 > f.w - 2 || y1 > f.h - 2 || x1 - x0 < 4 || y1 - y0 < 4) return 0;
  return (sidesScore(f, x0, x1, y0, y1) + endsScore(f, x0, x1, y0, y1)) / 2;
}

/** A box's two standing sides on |∂x|, sampled down the middle 80 % of its height (a box a little high or low still counts). */
function sidesScore(f: Field, x0: number, x1: number, y0: number, y1: number): number {
  if (x0 < 1 || x1 > f.w - 2 || x1 - x0 < 4) return 0;
  const a = Math.max(1, Math.round(y0 + (y1 - y0) * 0.1)), b = Math.min(f.h - 2, Math.round(y1 - (y1 - y0) * 0.1));
  const s = Math.max(1, Math.round((b - a) / 12));
  let v = 0;
  let n = 0;
  for (let y = a; y <= b; y += s) {
    v += f.gx[y * f.w + x0] + f.gx[y * f.w + x1];
    n += 2;
  }
  return n ? v / n : 0;
}

/** A box's head and sill on |∂y|, sampled along the middle 80 % of its width. */
function endsScore(f: Field, x0: number, x1: number, y0: number, y1: number): number {
  if (y0 < 1 || y1 > f.h - 2 || y1 - y0 < 4) return 0;
  const a = Math.max(1, Math.round(x0 + (x1 - x0) * 0.1)), b = Math.min(f.w - 2, Math.round(x1 - (x1 - x0) * 0.1));
  const s = Math.max(1, Math.round((b - a) / 12));
  let v = 0;
  let n = 0;
  for (let x = a; x <= b; x += s) {
    v += f.gy[y0 * f.w + x] + f.gy[y1 * f.w + x];
    n += 2;
  }
  return n ? v / n : 0;
}

/**
 * One line pair's best place near where it was: a centre `c` and half-size `h` moved by up to `reach` and sized within
 * `sizes`, at one pixel and 2 %, scored by `score(lo, hi)`. Of two fits within 2 % the nearer wins: a box finds its own window
 * before its neighbour's.
 */
function bestPair(c: number, h: number, reach: number, sizes: [number, number], score: (lo: number, hi: number) => number, prior: (s: number) => number = () => 1): { d: number; s: number; clear: boolean } {
  let best = { d: 0, s: 1, v: score(Math.round(c - h), Math.round(c + h)) * prior(1) };
  const all: number[] = [];
  for (let s = sizes[0]; s <= sizes[1] + 1e-9; s += 0.02) {
    for (let d = -reach; d <= reach; d++) {
      const v = score(Math.round(c + d - h * s), Math.round(c + d + h * s)) * prior(s);
      all.push(v);
      const nearer = Math.abs(d) + Math.abs(s - 1) * h < Math.abs(best.d) + Math.abs(best.s - 1) * h;
      if (v > best.v * 1.02 || (v >= best.v * 0.98 && nearer)) best = { d, s, v: Math.max(v, best.v) };
    }
  }
  all.sort((p, q) => p - q);
  return { d: best.d, s: best.s, clear: best.v > 0.02 && best.v >= all[Math.floor(all.length / 2)] * 1.35 };
}

/**
 * One box's best fit near where the model put it — its shift and its size against a window's frame, and how much better
 * that sits. Left and right first (the sides alone), then up and down along the sides just found (the head and sill
 * alone), once more each: two cheap searches instead of one four-way one, fine enough that head and sill land on their
 * edges together. `near`: after the whole pattern has moved — a shorter reach, the size nearly kept.
 */
function bestFit(f: Field, b: Box, near = false): { dx: number; dy: number; sw: number; sh: number; gain: number } | null {
  let cx = ((b.x0 + b.x1) / 2) * f.w, cy = ((b.top + b.bottom) / 2) * f.h;
  let hw = ((b.x1 - b.x0) / 2) * f.w, hh = ((b.bottom - b.top) / 2) * f.h;
  const cx0 = cx, cy0 = cy, hw0 = hw, hh0 = hh;
  const at = outlineScore(f, Math.round(cx - hw), Math.round(cx + hw), Math.round(cy - hh), Math.round(cy + hh));
  const rx = Math.round(Math.max(6, f.w * (near ? 0.025 : 0.05))), ry = Math.round(Math.max(6, f.h * (near ? 0.02 : 0.035)));
  const sizes: [number, number] = near ? [0.86, 1.2] : [0.8, 1.5];
  // The model's box keeps its shape: of a height (or width) that fits about as well as another, the one that leaves the
  // box its shape — a double-hung window's upper sash, head to meeting rail, is a box too.
  const keep = (r: number) => 1 / (1 + 0.3 * Math.abs(Math.log(r)));
  for (let pass = 0; pass < 2; pass++) {
    const x = bestPair(cx, hw, pass ? 3 : rx, sizes, (lo, hi) => sidesScore(f, lo, hi, Math.round(cy - hh), Math.round(cy + hh)), pass ? (s) => keep((hw * s) / hw0 / (hh / hh0)) : undefined);
    if (!pass && near && !x.clear) return null;
    cx += x.d;
    hw *= x.s;
    const y = bestPair(cy, hh, pass ? 3 : ry, sizes, (lo, hi) => endsScore(f, Math.round(cx - hw), Math.round(cx + hw), lo, hi), (s) => keep((hh * s) / hh0 / (hw / hw0)));
    if (!pass && near && !y.clear) return null;
    cy += y.d;
    hh *= y.s;
  }
  const v = outlineScore(f, Math.round(cx - hw), Math.round(cx + hw), Math.round(cy - hh), Math.round(cy + hh));
  if (v <= 0.03 || v < at) return null;
  return { dx: cx - cx0, dy: cy - cy0, sw: hw / hw0, sh: hh / hh0, gain: at > 0 ? v / at : 10 };
}

type Move = { dx: number; dy: number; sw: number; sh: number };

function moveBox(f: Field, b: Box, m: Move): Box {
  const cx = ((b.x0 + b.x1) / 2) * f.w + m.dx, cy = ((b.top + b.bottom) / 2) * f.h + m.dy;
  const hw = ((b.x1 - b.x0) / 2) * f.w * m.sw, hh = ((b.bottom - b.top) / 2) * f.h * m.sh;
  return { x0: (cx - hw) / f.w, x1: (cx + hw) / f.w, top: (cy - hh) / f.h, bottom: (cy + hh) / f.h };
}

/** How well the whole pattern sits moved by `m`: the mean of its best three quarters, so a box over something else doesn't sink a right move. */
function patternScore(f: Field, boxes: Box[], m: Move): number {
  const v = boxes
    .map((b) => {
      const o = moveBox(f, b, m);
      return outlineScore(f, Math.round(o.x0 * f.w), Math.round(o.x1 * f.w), Math.round(o.top * f.h), Math.round(o.bottom * f.h));
    })
    .sort((a, b) => b - a);
  const k = Math.max(1, Math.ceil(v.length * 0.75));
  return v.slice(0, k).reduce((a, x) => a + x, 0) / k;
}

/**
 * THE WHOLE PATTERN FIRST: a model tends to put every window off by the same amount — shifted, each box a little
 * shrunk. Every box finds its own best fit near where it was put, and each of those fits is tried on the WHOLE pattern:
 * the moves that put the most boxes on frames at once are tuned a pixel and 2 % at a time, and the best tuned one wins.
 * A box that alone would have caught its neighbour's frame (windows in pairs, the read off by half their spacing) can't
 * win that way — the others land on siding. A model that shrinks a box keeps its shape, so a move that squashes the
 * boxes pays for it: a double-hung window's upper sash, head to meeting rail, is a box too. The pattern moves only when
 * it clearly sits better.
 */
export function alignBoxes(f: Field, boxes: Box[]): (b: Box) => Box {
  const same = (b: Box) => b;
  if (boxes.length < 2) return same;
  const none: Move = { dx: 0, dy: 0, sw: 1, sh: 1 };
  const base = patternScore(f, boxes, none);
  const shape = (m: Move) => 1 / (1 + 0.3 * Math.abs(Math.log(m.sw / m.sh))); // the box's shape kept, as in bestFit
  const worth = (m: Move) => patternScore(f, boxes, m) * shape(m);
  const tries = boxes
    .map((b) => bestFit(f, b))
    .filter((x): x is NonNullable<typeof x> => !!x && x.gain >= 1.15)
    .map((m) => ({ m: { dx: m.dx, dy: m.dy, sw: m.sw, sh: m.sh }, v: worth(m) }))
    .sort((p, q) => q.v - p.v);
  if (tries.length < 2) return same;
  // The leaders, a few that differ, each tuned: one number at a time, a few steps either way, while it sits better.
  const leaders: typeof tries = [];
  for (const t of tries) {
    if (leaders.length >= 4) break;
    if (leaders.some((l) => Math.abs(l.m.dx - t.m.dx) < 3 && Math.abs(l.m.dy - t.m.dy) < 3 && Math.abs(l.m.sw - t.m.sw) < 0.05 && Math.abs(l.m.sh - t.m.sh) < 0.05)) continue;
    leaders.push(t);
  }
  const steps: Array<[keyof Move, number]> = [["dx", 1], ["dy", 1], ["sw", 0.02], ["sh", 0.02]];
  let best = none;
  let top = base;
  for (const l of leaders) {
    let m = l.m;
    let v = l.v;
    for (let round = 0, better = true; round < 4 && better; round++) {
      better = false;
      for (const [k, st] of steps) {
        for (let n = -4; n <= 4; n++) {
          if (!n) continue;
          const c = { ...m, [k]: m[k] + n * st };
          const cv = worth(c);
          if (cv > v * 1.001) [m, v, better] = [c, cv, true];
        }
      }
    }
    if (v > top) [best, top] = [m, v];
  }
  if (top < base * 1.12) return same;
  return (b: Box) => {
    const o = moveBox(f, b, best);
    return { x0: r3(o.x0), x1: r3(o.x1), top: r3(o.top), bottom: r3(o.bottom) };
  };
}

/**
 * The read moved onto the picture's edges: windows and doors (a row of windows split), the wall's corners, its base,
 * its eave and each step. Back come the read and how many lines moved.
 */
export function snapRead(read: HouseRead, g: Gray): { read: HouseRead; moved: number; split: number } {
  const { gx, gy } = gradients(g);
  const f: Field = { w: g.w, h: g.h, gx, gy };
  let moved = 0;
  let split = 0;
  const near = (a: number, b: number) => Math.abs(a - b) < 0.0015;
  // The windows and doors: the whole pattern aligned, then each box snapped to its frame, a row split, each piece snapped.
  const align = alignBoxes(f, [...read.windows.map((w) => ({ x0: w.x0, x1: w.x1, top: w.head, bottom: w.sill })), ...read.doors]);
  // Each box then on its own window — what's left after the pattern moved is each box's own small miss.
  const own = (b: Box): Box => {
    const m = bestFit(f, b, true);
    return m && m.gain >= 1.1 ? moveBox(f, b, m) : b;
  };
  const windows: HouseRead["windows"] = [];
  for (const w of read.windows) {
    const box0 = snapBox(f, own(align({ x0: w.x0, x1: w.x1, top: w.head, bottom: w.sill })));
    const parts = splitRow(f, box0);
    if (parts.length > 1) split += parts.length - 1;
    for (const p of parts) {
      const box = parts.length > 1 ? snapBox(f, p) : p;
      if (!near(box.x0, w.x0) || !near(box.x1, w.x1) || !near(box.top, w.head) || !near(box.bottom, w.sill)) moved++;
      windows.push({ x0: box.x0, x1: box.x1, head: box.top, sill: box.bottom });
    }
  }
  // Two boxes on one window (a piece of a split row landing on a window already there): the first is kept.
  const overlap = (a: HouseRead["windows"][number], b: HouseRead["windows"][number]) => {
    const ix = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
    const iy = Math.min(a.sill, b.sill) - Math.max(a.head, b.head);
    if (ix <= 0 || iy <= 0) return 0;
    return (ix * iy) / Math.min((a.x1 - a.x0) * (a.sill - a.head), (b.x1 - b.x0) * (b.sill - b.head));
  };
  for (let i = windows.length - 1; i >= 0; i--) if (windows.slice(0, i).some((o) => overlap(o, windows[i]) > 0.6)) windows.splice(i, 1);
  windows.sort((a, b) => a.x0 - b.x0 || a.head - b.head);
  // Two windows side by side never overlap: where each one's side ran past the mullion onto the other's frame, the two
  // sides trade places — each back on its own side of the mullion.
  for (const a of windows) {
    for (const b of windows) {
      if (a === b || a.x0 >= b.x0 || a.x1 <= b.x0 || a.x1 >= b.x1) continue;
      const iy = Math.min(a.sill, b.sill) - Math.max(a.head, b.head);
      if (iy < 0.5 * Math.min(a.sill - a.head, b.sill - b.head)) continue;
      [a.x1, b.x0] = [b.x0, a.x1];
    }
  }
  const doors = read.doors.map((d) => {
    const box = snapBox(f, own(align(d)));
    if (!near(box.x0, d.x0) || !near(box.bottom, d.bottom)) moved++;
    return { ...d, ...box };
  });
  const door = read.door ? (doors.find((d) => Math.abs((d.x0 + d.x1) / 2 - (read.door!.x0 + read.door!.x1) / 2) < 0.03) ?? read.door) : null;
  // The wall: its base as a line across it, its corners and its steps as lines up it. A window's sill is a stronger edge
  // than the ground line, so the base is measured only where it crosses no window or door, and never rises above the
  // lowest sill.
  const L = read.base.left, R = read.base.right;
  const xa = Math.round(Math.min(L.x, R.x) * g.w), xb = Math.round(Math.max(L.x, R.x) * g.w);
  const pad = 0.015;
  const openings = [...windows.map((w) => ({ x0: w.x0, x1: w.x1, top: w.head, bottom: w.sill })), ...doors];
  const crosses = (x: number, y: number) => openings.some((o) => x >= o.x0 * g.w && x <= o.x1 * g.w && y >= (o.top - pad) * g.h && y <= (o.bottom + pad) * g.h);
  const lineScore = (yl: number, yr: number) => {
    // A sloped line's strength: sampled along it.
    let s = 0;
    let n = 0;
    for (let x = xa + Math.round((xb - xa) * 0.05); x <= xb - Math.round((xb - xa) * 0.05); x += 2) {
      const t = (x - xa) / Math.max(1, xb - xa);
      const y = Math.round(yl + (yr - yl) * t);
      if (y < 1 || y > g.h - 2 || crosses(x, y)) continue;
      s += gy[y * g.w + x];
      n++;
    }
    return n >= 8 ? s / n : 0;
  };
  const shiftLine = (yl: number, yr: number, reach: number, lo: number, hi: number) => bestNear(0, reach, Math.max(-reach, lo), Math.min(reach, hi), (d) => lineScore(yl + d, yr + d), 1.25) ?? 0;
  const highestHead = windows.length ? Math.min(...windows.map((w) => w.head)) * g.h : Infinity;
  const lowestSill = windows.length ? Math.max(...windows.map((w) => w.sill)) * g.h : -Infinity;
  const dyBase = shiftLine(L.y * g.h, R.y * g.h, g.h * 0.025, lowestSill + 3 - Math.min(L.y, R.y) * g.h, Infinity);
  const base = { left: { x: L.x, y: r3(L.y + dyBase / g.h) }, right: { x: R.x, y: r3(R.y + dyBase / g.h) } };
  if (dyBase) moved++;
  // The eave is NOT moved onto an edge: gutter, fascia, drip edge and soffit shadow are a stack of lines a few pixels
  // apart, and the strongest of them is anyone's guess. It only never sits below the highest window head.
  let eave = read.eave;
  if (eave && Math.max(eave.left.y, eave.right.y) * g.h > highestHead - 3) {
    const lift = Math.max(eave.left.y, eave.right.y) - (highestHead - 3) / g.h + 0.01;
    eave = { left: { x: eave.left.x, y: r3(eave.left.y - lift) }, right: { x: eave.right.x, y: r3(eave.right.y - lift) } };
    moved++;
  }
  const top = eave ? Math.round(Math.min(eave.left.y, eave.right.y) * g.h) : Math.round((base.left.y - 0.25) * g.h);
  const bot = Math.round(Math.max(base.left.y, base.right.y) * g.h);
  const rowsA = Math.round(top + (bot - top) * 0.1), rowsB = Math.round(bot - (bot - top) * 0.1);
  const snapX = (x: number, reach: number) => {
    const best = bestNear(x * g.w, reach, 1, g.w - 2, (c) => colScore(f, c, rowsA, rowsB), 1.4);
    return best === null ? x : r3(best / g.w);
  };
  const reachX = g.w * 0.025;
  const lx = snapX(L.x, reachX), rx = snapX(R.x, reachX);
  if (!near(lx, L.x) || !near(rx, R.x)) moved++;
  const base2 = { left: { x: lx, y: base.left.y }, right: { x: rx, y: base.right.y } };
  const eave2 = eave ? { left: { x: lx, y: eave.left.y }, right: { x: rx, y: eave.right.y } } : null;
  const jogs = read.jogs.map((j) => {
    const x = snapX(j.x, reachX);
    if (!near(x, j.x)) moved++;
    return { ...j, x };
  });
  return { read: { ...read, base: base2, eave: eave2, jogs, windows: windows.slice(0, 30), doors, door }, moved, split };
}
