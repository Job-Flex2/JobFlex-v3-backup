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
/** y on a line at x (fractions), the line given by its two ends. */
const lineY = (l: { left: { x: number; y: number }; right: { x: number; y: number } }, x: number) => l.left.y + ((l.right.y - l.left.y) * (x - l.left.x)) / Math.max(1e-6, l.right.x - l.left.x);

interface Field {
  w: number;
  h: number;
  gx: Float32Array;
  gy: Float32Array;
  /** The picture's luminance 0…1 (for what a box holds — glass is not siding). */
  lum: Float32Array;
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

/** The mean luminance of a rectangle (px), or null when nothing of it is in the picture. */
function meanLum(f: Field, x0: number, x1: number, y0: number, y1: number): number | null {
  let s = 0;
  let n = 0;
  for (let y = Math.max(0, y0); y < Math.min(f.h, y1); y++) for (let x = Math.max(0, x0); x < Math.min(f.w, x1); x++) [s, n] = [s + f.lum[y * f.w + x], n + 1];
  return n ? s / n : null;
}

/** What a box holds: the mean luminance of its inside (the middle 60 % each way) — a row's panes hold the same glass,
 *  dark by day or lit at dusk; a box over siding holds the wall. */
function insideLum(f: Field, b: Box): number {
  const X0 = Math.round(b.x0 * f.w), X1 = Math.round(b.x1 * f.w), T = Math.round(b.top * f.h), B = Math.round(b.bottom * f.h);
  const bw = X1 - X0, bh = B - T;
  return meanLum(f, Math.round(X0 + bw * 0.2), Math.round(X1 - bw * 0.2), Math.round(T + bh * 0.2), Math.round(B - bh * 0.2)) ?? 0.5;
}

/** The eave's shadow band, from the picture: how many px below (+) or above (−) the model's eave line the darkest run
 *  of rows lies, within a quarter of the wall's height of it, read along the line. Null when no row is plainly darker
 *  than the rest (the model's line stands then). */
function eaveBandOffset(read: HouseRead, g: Gray, xL: number, xR: number, H: number): number | null {
  if (!read.eave) return null;
  const { w, h, data } = g;
  const eaveAt = (x: number) => lineY(read.eave!, x / w) * h;
  const K = Math.round(H * 0.25);
  const prof: number[] = [];
  for (let k = -K; k <= K; k++) {
    let s = 0;
    let n = 0;
    for (let x = xL; x < xR; x += 2) {
      const y = Math.round(eaveAt(x)) + k;
      if (y >= 0 && y < h) [s, n] = [s + data[y * w + x], n + 1];
    }
    prof.push(n ? s / n : 1);
  }
  const sm = prof.map((_, i) => {
    let s = 0;
    let n = 0;
    for (let d = -2; d <= 2; d++) if (prof[i + d] !== undefined) [s, n] = [s + prof[i + d], n + 1];
    return s / n;
  });
  let kMin = 0;
  let vMin = Infinity;
  sm.forEach((v, i) => {
    if (v < vMin) [vMin, kMin] = [v, i - K];
  });
  const rowMed = [...sm].sort((p, q) => p - q)[Math.floor(sm.length / 2)];
  return rowMed - vMin > 0.08 ? kMin : null;
}

/**
 * THE WINDOWS OFF THE PICTURE ITSELF (2026-10-25 — owner, the live review: "why is it still wrong, the windows are
 * from the pic"). The vision model's boxes were too far off to snap: boxes over siding, a three-pane window as two, a
 * box past the house's corner. The picture says where the windows are: inside the wall (between the read's eave and
 * base, within its ends), what is not siding — lit glass at dusk, dark glass by day, white trim — grouped into blobs,
 * bright and dark apart (a dark band must not glue bright frames together); a blob the size and shape of a window,
 * solid or framed on three sides at least, not running into the eave's shadow, is a window. Boards and bands — a
 * corner board or downspout covering most of the height, the soffit's shadow or a porch roof's edge covering most of
 * the width — are cleared first. A box in a row of like boxes that took in a lamp beside it is cut to the row's width;
 * a lone blob far smaller than the rest (a lamp, a vent) is dropped. Fractions out.
 */
export function findWindows(read: HouseRead, g: Gray, f: Field, opts: { diff?: number; edge?: number } = {}): Box[] {
  if (!read.eave) return [];
  const { w, h, data } = g;
  const { gx, gy } = f;
  const xL = Math.round(Math.min(read.base.left.x, read.base.right.x) * w), xR = Math.round(Math.max(read.base.left.x, read.base.right.x) * w);
  const eaveAt = (x: number) => lineY(read.eave!, x / w) * h, baseAt = (x: number) => lineY(read.base, x / w) * h;
  const H = baseAt((xL + xR) / 2) - eaveAt((xL + xR) / 2);
  if (H < 40 || xR - xL < 40) return [];
  // The top of the wall is the eave's own shadow band, found in the picture (eaveBandOffset): nothing above that band
  // is a window — the roof, the sky beyond a corner — and a window just under it is not cut off.
  const bandK = eaveBandOffset(read, g, xL, xR, H) ?? 0;
  const topAt = (x: number) => eaveAt(x) + bandK + H * 0.015;
  // Down to a wall's height below the model's base: its base line can sit far too high (on a porch roof); what lies
  // below the real base — the ground, a patio — is thrown out by its shape here and by the base found later (snapRead).
  const bottomAt = (x: number) => Math.min(h - 1, baseAt(x) + H);
  const inWall = (x: number, y: number) => x >= xL && x < xR && y >= topAt(x) && y < bottomAt(x);
  // The siding's typical luminance: the wall between the band and the model's base — never the ground below it, which
  // the region reaches down to.
  const sample: number[] = [];
  for (let y = 0; y < h; y += 2) for (let x = xL; x < xR; x += 2) if (inWall(x, y) && y < baseAt(x) - H * 0.03) sample.push(data[y * w + x]);
  sample.sort((a, b) => a - b);
  const med = sample[Math.floor(sample.length / 2)] ?? 0.5;
  const diff = opts.diff ?? 0.16, edge = opts.edge ?? 0.1;
  const out: Box[] = [];
  // Bright and dark apart: a dark band (the soffit's shadow, a porch roof's underside) must not glue bright frames
  // together, nor white trim the dark glass of two rooms.
  for (const bright of [true, false]) {
    const mask = new Uint8Array(w * h);
    for (let y = 1; y < h - 1; y++) for (let x = xL; x < xR; x++) {
      const i = y * w + x;
      if (!inWall(x, y)) continue;
      const d = data[i] - med;
      const far = bright ? d > diff : d < -diff;
      const edgy = gx[i] + gy[i] > edge && (bright ? d >= 0 : d < 0);
      if (far || edgy) mask[i] = 1;
    }
    // What runs most of the wall is no window: a column (a corner board, a downspout) or a row (the eave's shadow, a
    // porch roof's edge, a belt board) covered along more than half its length is cleared, two pixels either way.
    const colN = new Int32Array(w), colAll = new Int32Array(w);
    for (let x = xL; x < xR; x++) for (let y = 0; y < h; y++) if (inWall(x, y)) { colAll[x]++; if (mask[y * w + x]) colN[x]++; }
    const clearCols = new Uint8Array(w);
    for (let x = xL; x < xR; x++) if (colAll[x] && colN[x] / colAll[x] > 0.85) for (let k = -2; k <= 2; k++) clearCols[x + k] = 1;
    const rowN = new Int32Array(h), rowAll = new Int32Array(h);
    for (let y = 0; y < h; y++) for (let x = xL; x < xR; x++) if (inWall(x, y)) { rowAll[y]++; if (mask[y * w + x]) rowN[y]++; }
    const clearRows = new Uint8Array(h);
    for (let y = 0; y < h; y++) if (rowAll[y] && rowN[y] / rowAll[y] > 0.7) for (let k = -2; k <= 2; k++) if (y + k >= 0 && y + k < h) clearRows[y + k] = 1;
    for (let y = 0; y < h; y++) for (let x = xL; x < xR; x++) if (clearCols[x] || clearRows[y]) mask[y * w + x] = 0;
    const seen = new Uint8Array(w * h);
    const stack: number[] = [];
    for (let y = 0; y < h; y++) for (let x = xL; x < xR; x++) {
      const i0 = y * w + x;
      if (!mask[i0] || seen[i0]) continue;
      const px: number[] = [];
      let minX = x, maxX = x, minY = y, maxY = y;
      stack.push(i0); seen[i0] = 1;
      while (stack.length) {
        const i = stack.pop()!; px.push(i);
        const cx = i % w, cy = (i - cx) / w;
        if (cx < minX) minX = cx; if (cx > maxX) maxX = cx; if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
        for (const j of [i - 1, i + 1, i - w, i + w]) if (j >= 0 && j < w * h && mask[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
      }
      const bw = maxX - minX + 1, bh = maxY - minY + 1;
      if (bh < H * 0.05 || bw < (xR - xL) * 0.025 || bw / bh > 7 || bh / bw > 4) continue;
      // No window is most of the wall: a stretch of wall that read dark or bright as a whole (a porch's shadow).
      if (bw > (xR - xL) * 0.45 || bh > H * 0.75) continue;
      // Along the eave or an end, a wide-and-low or tall-and-thin thing is the band or the board, not a window.
      // Nothing a window: it never runs out of the top of the region (what does is the eave's band, the roof beyond a
      // corner, the sky), nor out of its bottom (the ground, a patio).
      if (minY <= topAt((minX + maxX) / 2) + 1 || maxY >= bottomAt((minX + maxX) / 2) - 2) continue;
      // At an end of the wall, a tall thin thing is the corner board, not a window.
      if ((minX <= xL + 1 || maxX >= xR - 2) && bh > 2.5 * bw) continue;
      const fill = px.length / (bw * bh);
      const band = Math.max(3, Math.round(Math.min(bw, bh) * 0.12));
      const cover = (sideOf: (cx: number, cy: number) => boolean, len: number, along: (cx: number, cy: number) => number) => { const hit = new Set<number>(); for (const i of px) { const cx = i % w, cy = (i - cx) / w; if (sideOf(cx, cy)) hit.add(along(cx, cy)); } return hit.size / len; };
      const sides = [cover((cx) => cx < minX + band, bh, (_, cy) => cy), cover((cx) => cx > maxX - band, bh, (_, cy) => cy), cover((_, cy) => cy < minY + band, bw, (cx) => cx), cover((_, cy) => cy > maxY - band, bw, (cx) => cx)];
      // Three sides plainly there and the fourth at least begun (a frame beside a corner board loses a side to the clearing).
      const framed = sides.filter((c) => c >= 0.5).length >= 3 && sides.every((c) => c >= 0.15);
      if (fill < 0.5 && !framed) continue;
      out.push({ x0: minX / w, x1: (maxX + 1) / w, top: minY / h, bottom: (maxY + 1) / h });
    }
  }
  // The same window found bright (its frame) and dark (its glass): the larger one stands.
  out.sort((p, q) => (q.x1 - q.x0) * (q.bottom - q.top) - (p.x1 - p.x0) * (p.bottom - p.top));
  let kept: Box[] = [];
  for (const b of out) { const inside = kept.some((k) => b.x0 >= k.x0 - 0.004 && b.x1 <= k.x1 + 0.004 && b.top >= k.top - 0.004 && b.bottom <= k.bottom + 0.004); if (!inside) kept.push(b); }
  // In a row of like windows, one much wider than the rest took in what stood beside it (a lamp, a post): cut to the
  // row's width on the side the row is.
  const rowOf = (b: Box) => kept.filter((k) => k !== b && Math.min(k.bottom, b.bottom) - Math.max(k.top, b.top) > 0.6 * Math.min(k.bottom - k.top, b.bottom - b.top));
  kept = kept.map((b) => {
    const row = rowOf(b).filter((k) => (k.x1 - k.x0) < (b.x1 - b.x0) / 1.4);
    if (row.length < 2) return b;
    // Only a row this box stands in — its nearest like box within a pane or so, not a row across the wall.
    const near = Math.min(...row.map((k) => Math.max(0, Math.max(k.x0 - b.x1, b.x0 - k.x1))));
    if (near > 1.5 * (row.map((k) => k.x1 - k.x0).sort((p, q) => p - q)[Math.floor(row.length / 2)])) return b;
    const widths = row.map((k) => k.x1 - k.x0).sort((p, q) => p - q);
    const wMed = widths[Math.floor(widths.length / 2)];
    const rowCx = row.reduce((t, k) => t + (k.x0 + k.x1) / 2, 0) / row.length;
    // The cut edge onto the frame's own line: the strongest standing edge within a few pixels of the row's width.
    const ya = Math.round((b.top + (b.bottom - b.top) * 0.15) * h), yb = Math.round((b.bottom - (b.bottom - b.top) * 0.15) * h);
    const settle = (xf: number) => { const x = Math.round(xf * w); let best = x, bv = -1; for (let d = -4; d <= 4; d++) { const v = colScore(f, x + d, ya, yb); if (v > bv) [best, bv] = [x + d, v]; } return best / w; };
    return rowCx < (b.x0 + b.x1) / 2 ? { ...b, x1: settle(b.x0 + wMed) } : { ...b, x0: settle(b.x1 - wMed) };
  });
  // A lone blob far smaller than the rest (a lamp, a vent) is no window; small windows in a row of their like stay.
  const areas = kept.map((k) => (k.x1 - k.x0) * (k.bottom - k.top)).sort((p, q) => p - q);
  const aMed = areas[Math.floor(areas.length / 2)] ?? 0;
  // Down at the base, a blob far wider and flatter than the windows is the ground or a patio seen past the model's line.
  const widths = kept.map((k) => k.x1 - k.x0).sort((p, q) => p - q);
  const wMedAll = widths[Math.floor(widths.length / 2)] ?? 0;
  kept = kept.filter((b) => !(b.bottom * h >= baseAt(((b.x0 + b.x1) / 2) * w) - H * 0.1 && b.x1 - b.x0 > 2 * wMedAll && (b.bottom - b.top) * h < H * 0.2));
  const like = (k: Box, b: Box) => Math.abs((k.x1 - k.x0) - (b.x1 - b.x0)) < 0.2 * (b.x1 - b.x0) && Math.abs((k.bottom - k.top) - (b.bottom - b.top)) < 0.3 * (b.bottom - b.top);
  kept = kept.filter((b) => (b.x1 - b.x0) * (b.bottom - b.top) >= aMed * 0.35 || rowOf(b).some((k) => like(k, b)));
  return kept;
}
/** A box's outline on the picture, in fractions. */
const boxScore = (f: Field, b: Box) => outlineScore(f, Math.round(b.x0 * f.w), Math.round(b.x1 * f.w), Math.round(b.top * f.h), Math.round(b.bottom * f.h));

/**
 * ROWS OF WINDOWS, TOGETHER (2026-10-24 — owner, the live read: "make windows read right"). The model read a row of
 * four panes one pane to the right: three boxes on panes, the fourth past the house's corner, the first pane bare —
 * and each box alone, snapping a short way, found a frame under it and stayed. A row of windows — boxes of one height
 * and one width at a steady pitch — is moved as a row: by whole panes either way, the move that puts every box on a
 * frame wins (one box on siding sinks a wrong one). Then the row runs on: a pane the model missed, a pitch past either
 * end with a frame as plain as the row's, is added; a box with no frame to speak of under it (a quarter of the row's)
 * is dropped; so is any box past the wall's end.
 */
function fitRows(f: Field, boxes: Box[], span: { x0: number; x1: number }): Box[] {
  const h = (b: Box) => b.bottom - b.top;
  const w = (b: Box) => b.x1 - b.x0;
  const cx = (b: Box) => (b.x0 + b.x1) / 2;
  const alike = (a: Box, b: Box) => {
    const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return iy > 0.6 * Math.min(h(a), h(b)) && w(a) / w(b) > 0.7 && w(a) / w(b) < 1.4;
  };
  // Boxes of one height and width, in order across the wall; a gap of most of a box between two of them ends a row (a
  // row's panes share a mullion — the windows of two rooms stand apart).
  const groups: Box[][] = [];
  for (const b of [...boxes].sort((p, q) => p.x0 - q.x0)) {
    const g = groups.find((r) => alike(r[0], b));
    if (g) g.push(b);
    else groups.push([b]);
  }
  const rows: Box[][] = [];
  for (const g of groups) {
    let run: Box[] = [];
    for (const b of g) {
      if (run.length && b.x0 - run[run.length - 1].x1 > 0.8 * w(b)) {
        rows.push(run);
        run = [];
      }
      run.push(b);
    }
    rows.push(run);
  }
  // A box's weaker side on the picture: the lesser of its two standing edges (a frame has both; the wall's corner
  // board, a downspout, the edge of a porch roof has one).
  const weakSide = (b: Box) => {
    const X0 = Math.round(b.x0 * f.w), X1 = Math.round(b.x1 * f.w), T = Math.round(b.top * f.h), B = Math.round(b.bottom * f.h);
    const y0 = Math.round(T + (B - T) * 0.1), y1 = Math.round(B - (B - T) * 0.1);
    const at = (x: number) => Math.max(colScore(f, x - 1, y0, y1), colScore(f, x, y0, y1), colScore(f, x + 1, y0, y1));
    return Math.min(at(X0), at(X1));
  };
  const out: Box[] = [];
  for (const row of rows) {
    if (row.length < 2) {
      out.push(...row);
      continue;
    }
    // A row's steady pitch — or, with an end box off it (the box a shifted row left past the row's end, snapped onto
    // the last pane's frame and overlapping it), the pitch of the rest; that end box is then judged with the rest.
    const pitchOf = (bs: Box[]) => {
      const gaps = bs.slice(1).map((b, i) => cx(b) - cx(bs[i]));
      const pitch = [...gaps].sort((p, q) => p - q)[Math.floor(gaps.length / 2)];
      return pitch > w(bs[0]) * 0.7 && gaps.every((gp) => Math.abs(gp - pitch) < pitch * 0.25) ? pitch : null;
    };
    let core = row;
    let loose: Box[] = [];
    let pitch = pitchOf(row);
    if (pitch === null && row.length >= 3) {
      for (const trial of [row.slice(0, -1), row.slice(1)]) {
        const p2 = pitchOf(trial);
        if (p2 !== null) {
          [core, loose, pitch] = [trial, row.filter((b) => !trial.includes(b)), p2];
          break;
        }
      }
    }
    if (pitch === null) {
      out.push(...row);
      continue;
    }
    const pitchFt = pitch;
    const moved = (bs: Box[], dx: number) => bs.map((b) => ({ ...b, x0: b.x0 + dx, x1: b.x1 + dx }));
    const total = (bs: Box[]) => bs.reduce((t, b) => t + boxScore(f, b), 0);
    let best = core;
    let top = total(core);
    for (const k of [-2, -1, 1, 2]) {
      for (let fine = -6; fine <= 6; fine++) {
        const c = moved(core, k * pitchFt + fine / f.w);
        if (c[0].x0 < span.x0 - w(c[0]) * 0.5 || c[c.length - 1].x1 > span.x1 + w(c[0]) * 0.5) continue;
        const v = total(c);
        if (v > top) [best, top] = [c, v];
      }
    }
    // The row moves only when it clearly sits better, by panes; a move of less than a quarter pane is no move.
    let fitted = top >= total(core) * 1.3 && Math.abs(cx(best[0]) - cx(core[0])) > pitchFt * 0.25 ? best : core;
    const median = (xs: number[]) => [...xs].sort((p, q) => p - q)[Math.floor(xs.length / 2)];
    const typical = () => median(fitted.map(weakSide));
    // The row's glass, and how much its panes differ among themselves: a box holding something else — the wall — is no
    // pane of it.
    const glassOf = () => {
      const lums = fitted.map((b) => insideLum(f, b));
      const med = median(lums);
      const spread = median(lums.map((l) => Math.abs(l - med)));
      return { med, tol: Math.max(0.1, 4 * spread) };
    };
    const holdsGlass = (b: Box) => {
      const { med, tol } = glassOf();
      return Math.abs(insideLum(f, b) - med) <= tol;
    };
    const mean = () => total(fitted) / fitted.length;
    // A pane the model missed at either end: a pitch on, settled a few pixels either way, with a frame as plain as the
    // row's — both its sides standing.
    for (const dir of [-1, 1]) {
      for (let n = 0; n < 2; n++) {
        const end = dir < 0 ? fitted[0] : fitted[fitted.length - 1];
        const c0 = { ...end, x0: end.x0 + dir * pitchFt, x1: end.x1 + dir * pitchFt };
        if (c0.x0 < span.x0 - w(c0) * 0.25 || c0.x1 > span.x1 + w(c0) * 0.25) break;
        let c = c0;
        let v = 0;
        for (let fine = -6; fine <= 6; fine++) {
          const t = { ...c0, x0: c0.x0 + fine / f.w, x1: c0.x1 + fine / f.w };
          const tv = boxScore(f, t);
          if (tv > v) [c, v] = [t, tv];
        }
        // Each side then onto its own frame edge (the end pane can be narrower than the one it was copied from).
        c = snapBox(f, c);
        v = boxScore(f, c);
        if (v < 0.03 || v < mean() * 0.7 || weakSide(c) < typical() * 0.5 || !holdsGlass(c)) break;
        fitted = dir < 0 ? [c, ...fitted] : [...fitted, c];
      }
    }
    // A box with nothing like a window under it: a weak outline, one side only, or siding where the glass would be
    // (the last pane's frame and the wall's corner board make two sides of a box with nothing in it).
    const scores = fitted.map((b) => boxScore(f, b));
    const m = scores.reduce((p, v) => p + v, 0) / scores.length;
    const typ = typical();
    let kept = fitted.filter((b, i) => scores[i] >= m * 0.25 && (fitted.length < 3 || (weakSide(b) >= typ * 0.35 && holdsGlass(b))));
    // The loose end box: kept only as a window in its own right — a frame on both sides, the row's glass, not on a
    // pane the row already has.
    for (const b of loose) {
      const onRow = kept.some((k) => Math.min(k.x1, b.x1) - Math.max(k.x0, b.x0) > w(b) * 0.4);
      if (!onRow && boxScore(f, b) >= m * 0.25 && weakSide(b) >= typ * 0.35 && holdsGlass(b)) kept = [...kept, b].sort((p, q) => p.x0 - q.x0);
    }
    // The row's end box riding the wall's corner board — its outer side within a hair of the wall's end — holds no
    // window: a window stops short of the corner by its trim at least (the last pane's frame and the corner board made
    // the two sides of it).
    const hair = 0.012;
    while (kept.length >= 3 && kept[kept.length - 1].x1 > span.x1 - hair) kept = kept.slice(0, -1);
    while (kept.length >= 3 && kept[0].x0 < span.x0 + hair) kept = kept.slice(1);
    out.push(...kept);
  }
  // Past the wall's end — more than half of it — is no window of this wall.
  return out.filter((b) => Math.min(b.x1, span.x1) - Math.max(b.x0, span.x0) >= w(b) * 0.5).map((b) => ({ x0: r3(b.x0), x1: r3(b.x1), top: r3(b.top), bottom: r3(b.bottom) }));
}

/**
 * THE WHOLE WINDOW (2026-10-24 — owner: "and shape"): the model boxes a window short — the upper sash, or the glass
 * without its sill — and a box snaps only a little way. A window's frame is a closed rectangle: from the box's two
 * sides, which stand on the frame, the box grows down and up while those sides keep running (a few rows at a time,
 * while the edge there stays over half as strong as inside the box), and each end then sits on the strongest row edge
 * near where the sides stop — the sill, the head. Sides not on a frame grow nothing.
 */
function growToFrame(f: Field, b: Box): Box {
  const X0 = Math.round(b.x0 * f.w), X1 = Math.round(b.x1 * f.w);
  const T = Math.round(b.top * f.h), B = Math.round(b.bottom * f.h);
  const bh = B - T;
  if (bh < 6 || X1 - X0 < 6) return b;
  const col = (x: number, y0: number, y1: number) => Math.max(colScore(f, x - 1, y0, y1), colScore(f, x, y0, y1), colScore(f, x + 1, y0, y1));
  const side = (y0: number, y1: number) => col(X0, Math.round(y0), Math.round(y1)) + col(X1, Math.round(y0), Math.round(y1));
  const inside = side(T + bh * 0.1, B - bh * 0.1);
  if (inside < 0.06) return b;
  const step = Math.max(2, Math.round(bh * 0.08));
  const down = Math.max(bh * 1.6, f.h * 0.06), up = Math.max(bh, f.h * 0.04);
  let nb = B;
  for (let y = B; y + step <= Math.min(f.h - 2, B + down); y += step) {
    if (side(y, y + step) < inside * 0.55) break;
    nb = y + step;
  }
  let nt = T;
  for (let y = T; y - step >= Math.max(1, T - up); y -= step) {
    if (side(y - step, y) < inside * 0.55) break;
    nt = y - step;
  }
  if (nb === B && nt === T) return b;
  const xa = Math.round(X0 + (X1 - X0) * 0.15), xb = Math.round(X1 - (X1 - X0) * 0.15);
  const row = (y: number) => rowScore(f, y, xa, xb);
  // The frame's outside edge, not its inside against the glass (outerEdge, as a box's own snap).
  if (nb !== B) nb = outerEdge(bestNear(nb, step + 2, 1, f.h - 2, row, 1.2), 1, bh, row) ?? nb;
  if (nt !== T) nt = outerEdge(bestNear(nt, step + 2, 1, f.h - 2, row, 1.2), -1, bh, row) ?? nt;
  return { ...b, top: r3(nt / f.h), bottom: r3(nb / f.h) };
}

/**
 * The read moved onto the picture's edges: windows and doors (a row of windows split), the wall's corners, its base,
 * its eave and each step. Back come the read and how many lines moved.
 */
export function snapRead(read: HouseRead, g: Gray): { read: HouseRead; moved: number; split: number; /** Windows read off the picture itself (findWindows), 0 when the model's boxes were lined up instead. */ found: number } {
  const { gx, gy } = gradients(g);
  const f: Field = { w: g.w, h: g.h, gx, gy, lum: g.data };
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
  // The picture's own windows first (findWindows): where it shows three or more, they stand and the model's boxes are
  // left aside; where it shows fewer (low glass against a dark wall, a photo of a different kind), the model's boxes
  // are lined up as before.
  const pixel = findWindows(read, g, f);
  const found = pixel.length >= 3 ? pixel.length : 0;
  const source = found ? pixel.map((b) => ({ x0: b.x0, x1: b.x1, head: b.top, sill: b.bottom })) : read.windows;
  for (const w of source) {
    const box0 = found ? growToFrame(f, { x0: w.x0, x1: w.x1, top: w.head, bottom: w.sill }) : growToFrame(f, snapBox(f, own(align({ x0: w.x0, x1: w.x1, top: w.head, bottom: w.sill }))));
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
  // The model's boxes: the rows moved as rows and run on, phantoms dropped; the picture's own windows stand as found
  // (a blob solid or framed on three sides is a window — the model-minded tests would throw a pane beside a lamp out).
  // Then each window grown to its whole frame.
  {
    const span = { x0: Math.min(read.base.left.x, read.base.right.x), x1: Math.max(read.base.left.x, read.base.right.x) };
    const boxes = windows.map((w) => ({ x0: w.x0, x1: w.x1, top: w.head, bottom: w.sill }));
    const fitted = (found ? boxes : fitRows(f, boxes, span)).map((b) => growToFrame(f, b));
    windows.splice(0, windows.length, ...fitted.map((b) => ({ x0: b.x0, x1: b.x1, head: b.top, sill: b.bottom })));
    windows.sort((a, b) => a.x0 - b.x0 || a.head - b.head);
  }
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
  let base2 = { left: { x: lx, y: base.left.y }, right: { x: rx, y: base.right.y } };
  let eave2 = eave ? { left: { x: lx, y: eave.left.y }, right: { x: rx, y: eave.right.y } } : null;
  const jogs = read.jogs.map((j) => {
    const x = snapX(j.x, reachX);
    if (!near(x, j.x)) moved++;
    return { ...j, x };
  });
  // THE SCALE, THE BASE AND THE EAVE OFF THE PICTURE (2026-10-25 — owner, a live run: a 104-ft wall, a door the photo
  // hasn't got, windows the size of garage doors; the model's base line sat on the porch roof and its door box set the
  // scale). With the picture's own windows in two rows, one storey stands between the rows' heads — a measure the
  // model's lines can't spoil; the eave is its shadow band; the base is the strongest row edge under the lowest sills,
  // where the siding meets the ground; a door the model drew over the picture's windows is no door.
  let scaleLine = read.scaleLine;
  let storeys = read.storeys;
  let doors2 = doors;
  let door2 = door;
  if (found && windows.length >= 3) {
    // The rows: windows whose heads lie within most of a window's height of each other; the two fullest rows are the
    // storeys, one above the other (a patio or the ground found below the wall makes a thin third row, left out).
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const medH = median(windows.map((w) => w.sill - w.head));
    const byHead = [...windows].sort((a, b) => a.head - b.head);
    const rows: Array<HouseRead["windows"]> = [];
    for (const w of byHead) {
      const last = rows[rows.length - 1];
      if (last && w.head - last[last.length - 1].head <= 0.8 * medH) last.push(w);
      else rows.push([w]);
    }
    const [rowA, rowB] = [...rows].sort((a, b) => b.length - a.length).slice(0, 2).sort((a, b) => a[0].head - b[0].head);
    const upperHead = rowA && rowB ? median(rowA.map((w) => w.head)) : 0;
    const lowerHead = rowA && rowB ? median(rowB.map((w) => w.head)) : 0;
    const storey = lowerHead - upperHead;
    if (rowA && rowB && storey > medH && storey > 0.08 && storey < 0.5) {
      const xm = r3((lx + rx) / 2);
      if (!scaleLine) scaleLine = { a: { x: xm, y: r3(upperHead) }, b: { x: xm, y: r3(lowerHead) }, lengthIn: 114, kind: "storey" };
      if (!storeys || storeys < 2) storeys = 2;
      // The base: the strongest row edge under the lowest sill, from a sixth to a storey and a tenth below it, read along
      // the model's base line's own slope over the columns clear of windows — and only when one row plainly stands out
      // (twice the typical row), else the model's base stands.
      const lowest = Math.max(...rowB.map((w) => w.sill));
      let baseFound = false;
      const slope = (base2.right.y - base2.left.y) / Math.max(1e-6, base2.right.x - base2.left.x);
      const cols: number[] = [];
      for (let x = Math.round(lx * g.w); x < Math.round(rx * g.w); x += 2) if (!windows.some((w) => x / g.w >= w.x0 && x / g.w <= w.x1)) cols.push(x);
      if (cols.length >= 20) {
        const y0 = Math.round((lowest + storey * 0.15) * g.h), y1 = Math.min(g.h - 2, Math.round((lowest + storey * 1.1) * g.h));
        const scores: Array<[number, number]> = [];
        for (let y = y0; y <= y1; y++) {
          let s = 0;
          let n = 0;
          for (const x of cols) {
            const yy = Math.round(y + ((x / g.w - xm) * slope) * g.h);
            if (yy >= 1 && yy < g.h - 1) [s, n] = [s + f.gy[yy * g.w + x], n + 1];
          }
          scores.push([y, n ? s / n : 0]);
        }
        if (scores.length > 6) {
          const best = scores.reduce((m, c) => (c[1] > m[1] ? c : m));
          const typical = median(scores.map((c) => c[1]));
          // One row standing clear of every other (a course of siding is a strong edge too, but its neighbours a few rows
          // on are just as strong; the ground line has no twin).
          const second = scores.filter((c) => Math.abs(c[0] - best[0]) >= 6).reduce((m, c) => Math.max(m, c[1]), 0);
          const standsOut = best[1] > 1.5 * second;
          if (best[1] > 2 * typical && best[1] > 0.03 && standsOut) {
            const yb = best[0] / g.h;
            const dy = yb - (base2.left.y + (xm - base2.left.x) * slope);
            baseFound = true;
            if (Math.abs(dy) * g.h > 1.5) {
              base2 = { left: { x: lx, y: r3(base2.left.y + dy) }, right: { x: rx, y: r3(base2.right.y + dy) } };
              moved++;
            }
          }
        }
      }
      // What lies at or below the base found — the patio, the ground — is no window. Where no base was found and the
      // model's sits up above the lower row (on a porch roof), the base goes under the lowest sill instead.
      if (baseFound) {
        const slope2 = (base2.right.y - base2.left.y) / Math.max(1e-6, base2.right.x - base2.left.x);
        const kept = windows.filter((w) => w.sill < base2.left.y + ((w.x0 + w.x1) / 2 - base2.left.x) * slope2 - 0.01);
        if (kept.length !== windows.length) windows.splice(0, windows.length, ...kept);
      } else if (base2.left.y < lowest + storey * 0.1 || base2.right.y < lowest + storey * 0.1) {
        const yb = r3(lowest + storey * 0.3);
        base2 = { left: { x: lx, y: Math.max(base2.left.y, yb) }, right: { x: rx, y: Math.max(base2.right.y, yb) } };
        moved++;
      }
      // The eave: its shadow band.
      if (eave2) {
        const H2 = (lineY(base2, xm) - lineY(eave2, xm)) * g.h;
        const k = H2 > 40 ? eaveBandOffset({ ...read, eave: eave2, base: base2 }, g, Math.round(lx * g.w), Math.round(rx * g.w), H2) : null;
        if (k !== null && Math.abs(k) > 1.5) {
          eave2 = { left: { x: lx, y: r3(eave2.left.y + k / g.h) }, right: { x: rx, y: r3(eave2.right.y + k / g.h) } };
          moved++;
        }
      }
    }
    // A door the model drew where the picture shows windows is no door.
    const overlapArea = (d: { x0: number; x1: number; top: number; bottom: number }, w: HouseRead["windows"][number]) => Math.max(0, Math.min(d.x1, w.x1) - Math.max(d.x0, w.x0)) * Math.max(0, Math.min(d.bottom, w.sill) - Math.max(d.top, w.head));
    const area = (d: { x0: number; x1: number; top: number; bottom: number }) => Math.max(1e-6, (d.x1 - d.x0) * (d.bottom - d.top));
    doors2 = doors.filter((d) => windows.reduce((t, w) => t + overlapArea(d, w), 0) < 0.5 * area(d));
    door2 = door && doors2.some((d) => Math.abs((d.x0 + d.x1) / 2 - (door.x0 + door.x1) / 2) < 0.03) ? door : null;
  }
  return { read: { ...read, base: base2, eave: eave2, jogs, windows: windows.slice(0, 30), doors: doors2, door: door2, scaleLine, storeys }, moved, split, found };
}
