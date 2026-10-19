// FROM PIXELS TO OUTLINES (2026-10-18). A class's pixels traced into closed outlines along the pixel edges (the region
// always on the left), then smoothed of their stair-steps — for the map, and for the edges a crew trims: each stretch
// of a lawn's outline is named by what lies just outside it (a driveway is hard edging, a bed is a soft edge, the house
// is the foundation line). Areas are counted from the pixels themselves, never from the smoothed outline. Pure.
import type { Pt } from "./geo";
import { distanceTo, simplify } from "./geo";

/** Closed loops around every region of `mask` (1 = in), in pixel-corner coordinates; outer loops counter-clockwise on
 *  screen (y down) — the region on the left — and holes the other way. */
export function traceLoops(mask: Uint8Array, w: number, h: number): Pt[][] {
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
  // Directed boundary edges, keyed by their start corner; the region stays on the left of each.
  const next = new Map<number, number[]>();
  const key = (x: number, y: number) => y * (w + 1) + x;
  const add = (x0: number, y0: number, x1: number, y1: number) => {
    const k = key(x0, y0);
    const list = next.get(k);
    if (list) list.push(key(x1, y1));
    else next.set(k, [key(x1, y1)]);
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!at(x, y)) continue;
      if (!at(x, y - 1)) add(x + 1, y, x, y); // top edge, walking west
      if (!at(x - 1, y)) add(x, y, x, y + 1); // left edge, walking south
      if (!at(x, y + 1)) add(x, y + 1, x + 1, y + 1); // bottom edge, walking east
      if (!at(x + 1, y)) add(x + 1, y + 1, x + 1, y); // right edge, walking north
    }
  const loops: Pt[][] = [];
  const corner = (k: number): Pt => ({ x: k % (w + 1), y: Math.floor(k / (w + 1)) });
  for (const [start] of next) {
    while ((next.get(start)?.length ?? 0) > 0) {
      const loop: Pt[] = [];
      let k = start;
      let prev: Pt | null = null;
      for (let guard = 0; guard < 4 * (w + 1) * (h + 1); guard++) {
        const list = next.get(k);
        if (!list || !list.length) break;
        // At a pinch corner (two regions touching diagonally) take the turn that keeps the region on the left.
        let pick = 0;
        if (list.length > 1 && prev) {
          const here = corner(k);
          const din = { x: here.x - prev.x, y: here.y - prev.y };
          let best = -Infinity;
          for (let i = 0; i < list.length; i++) {
            const to = corner(list[i]);
            const dout = { x: to.x - here.x, y: to.y - here.y };
            const turn = din.x * dout.y - din.y * dout.x; // >0: a left turn on screen
            if (turn > best) {
              best = turn;
              pick = i;
            }
          }
        }
        const n = list.splice(pick, 1)[0];
        const p = corner(k);
        loop.push(p);
        prev = p;
        k = n;
        if (k === start) break;
      }
      if (loop.length >= 4) loops.push(loop);
    }
  }
  return loops;
}

/** Signed area on screen axes: positive for the outer loops traceLoops makes, negative for holes. */
export function signedArea(r: Pt[]): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j].x * r[i].y - r[i].x * r[j].y;
  return -a / 2;
}

/** Corners kept, stair-steps gone: a closed loop simplified, never below a triangle. */
export function smoothLoop(loop: Pt[], tolPx = 0.75): Pt[] {
  if (loop.length < 8) return loop;
  // Split a closed loop at its farthest pair so Douglas–Peucker sees two open paths.
  let far = 0;
  let best = -1;
  for (let i = 1; i < loop.length; i++) {
    const d = (loop[i].x - loop[0].x) ** 2 + (loop[i].y - loop[0].y) ** 2;
    if (d > best) {
      best = d;
      far = i;
    }
  }
  const a = simplify(loop.slice(0, far + 1), tolPx);
  const b = simplify([...loop.slice(far), loop[0]], tolPx);
  const out = [...a.slice(0, -1), ...b.slice(0, -1)];
  return out.length >= 3 ? out : loop;
}

export type Outline = {
  /** Pixel coordinates (corners). */
  ring: Pt[];
  hole: boolean;
};

/** Every outline of a class, smoothed; specks under `minPx` pixels dropped. */
export function outlinesOf(labels: Uint8Array, w: number, h: number, cls: number, minPx = 6, tolPx = 0.75): Outline[] {
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = labels[i] === cls ? 1 : 0;
  return traceLoops(mask, w, h)
    .map((loop) => ({ loop, a: signedArea(loop) }))
    .filter(({ a }) => Math.abs(a) >= minPx)
    .map(({ loop, a }) => ({ ring: smoothLoop(loop, tolPx), hole: a < 0 }));
}

/** Each stretch of a region's outline named by the class just outside it: { class: length in pixels }. The outline
 *  runs with the region on its left, so outside is to the right. */
export function edgeNeighbours(outlines: Outline[], labels: Uint8Array, w: number, h: number, self: number, stepPx = 1): Map<number, number> {
  const out = new Map<number, number>();
  for (const o of outlines) {
    const r = o.ring;
    for (let i = 0; i < r.length; i++) {
      const a = r[i];
      const b = r[(i + 1) % r.length];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (!len) continue;
      // The region is on the left of travel; outside, on screen (y down), is the right normal (−dy, dx).
      const nx = -(b.y - a.y) / len;
      const ny = (b.x - a.x) / len;
      const steps = Math.max(1, Math.round(len / stepPx));
      for (let s = 0; s < steps; s++) {
        const t = (s + 0.5) / steps;
        // Just across the line; a little further where the smoothing cut a corner and the first look is still inside.
        let c = self;
        for (const off of [0.6, 1.4, 2.2]) {
          const x = Math.floor(a.x + (b.x - a.x) * t + nx * off);
          const y = Math.floor(a.y + (b.y - a.y) * t + ny * off);
          c = x >= 0 && y >= 0 && x < w && y < h ? labels[y * w + x] : 0;
          if (c !== self) break;
        }
        out.set(c, (out.get(c) ?? 0) + len / steps);
      }
    }
  }
  return out;
}

/** Corner-cutting (Chaikin): a closed ring's stair-steps and sharp turns eased into curves — for drawing only; areas
 *  and edges are measured from the pixels and the unsmoothed outline. */
export function chaikin(r: Pt[], passes = 2): Pt[] {
  let p = r;
  for (let k = 0; k < passes && p.length >= 3; k++) {
    const q: Pt[] = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[i];
      const b = p[(i + 1) % p.length];
      q.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 }, { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    p = q;
  }
  return p;
}

/** Where to write each piece's size: every 4-connected piece of `cls` of `minPx` pixels or more, its pixel count and
 *  the point deepest inside it (so the label sits on the piece, not on a hole or a neighbour). */
export function pieceSpots(labels: Uint8Array, w: number, h: number, cls: number, minPx: number): Array<{ x: number; y: number; px: number }> {
  const N = w * h;
  const off = new Uint8Array(N);
  for (let i = 0; i < N; i++) off[i] = labels[i] === cls ? 0 : 1;
  const depth = distanceTo(off, w, h);
  const seen = new Uint8Array(N);
  const out: Array<{ x: number; y: number; px: number }> = [];
  for (let i = 0; i < N; i++) {
    if (seen[i] || labels[i] !== cls) continue;
    const q = [i];
    seen[i] = 1;
    let n = 0;
    let best = i;
    while (q.length) {
      const p = q.pop()!;
      n++;
      if (depth[p] > depth[best]) best = p;
      const x = p % w;
      const y = (p - x) / w;
      for (const [xx, yy] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const k = yy * w + xx;
        if (!seen[k] && labels[k] === cls) {
          seen[k] = 1;
          q.push(k);
        }
      }
    }
    if (n >= minPx) out.push({ x: (best % w) + 0.5, y: Math.floor(best / w) + 0.5, px: n });
  }
  return out;
}
