// Plane geometry for the plan set (2026-10-23) — pure.
export type V2 = { x: number; y: number };

/** The polygon `subject` clipped to the convex-or-not polygon `clip` (Sutherland–Hodgman: right for a convex clip; a
 *  deck's outline with clipped corners or a bow is convex, an L is not — an L's zones are clipped one by one). */
export function clipPoly(subject: V2[], clip: V2[]): V2[] {
  if (subject.length < 3 || clip.length < 3) return [];
  // Orient the clip counter-clockwise in a y-down plane (positive signed area).
  const c = signedArea(clip) < 0 ? [...clip].reverse() : clip;
  let out = subject;
  for (let i = 0; i < c.length && out.length; i++) {
    const a = c[i];
    const b = c[(i + 1) % c.length];
    const inside = (p: V2) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= -1e-9;
    const cross = (p: V2, q: V2): V2 => {
      const a1 = b.y - a.y;
      const b1 = a.x - b.x;
      const c1 = a1 * a.x + b1 * a.y;
      const a2 = q.y - p.y;
      const b2 = p.x - q.x;
      const c2 = a2 * p.x + b2 * p.y;
      const det = a1 * b2 - a2 * b1;
      if (Math.abs(det) < 1e-12) return p;
      return { x: (b2 * c1 - b1 * c2) / det, y: (a1 * c2 - a2 * c1) / det };
    };
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j];
      const q = input[(j + 1) % input.length];
      if (inside(q)) {
        if (!inside(p)) out.push(cross(p, q));
        out.push(q);
      } else if (inside(p)) out.push(cross(p, q));
    }
  }
  return out;
}

export function signedArea(p: V2[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length];
    a += p[i].x * q.y - q.x * p[i].y;
  }
  return a / 2;
}

export function centroid(p: V2[]): V2 {
  const A = signedArea(p);
  if (Math.abs(A) < 1e-9) {
    const n = p.length || 1;
    return { x: p.reduce((s, v) => s + v.x, 0) / n, y: p.reduce((s, v) => s + v.y, 0) / n };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length];
    const f = p[i].x * q.y - q.x * p[i].y;
    cx += (p[i].x + q.x) * f;
    cy += (p[i].y + q.y) * f;
  }
  return { x: cx / (6 * A), y: cy / (6 * A) };
}

export const flat = (p: V2[]): number[] => p.flatMap((v) => [v.x, v.y]);
export const rectPts = (x0: number, y0: number, x1: number, y1: number): V2[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/** Values within `tol` of each other merged (the posts of two beams that line up share a grid line). */
export function clusterValues(values: number[], tol: number): number[] {
  const s = [...values].sort((a, b) => a - b);
  const out: number[][] = [];
  for (const v of s) {
    const last = out[out.length - 1];
    if (last && v - last[last.length - 1] <= tol) last.push(v);
    else out.push([v]);
  }
  return out.map((g) => g.reduce((a, b) => a + b, 0) / g.length);
}

/** A rotated rectangle's corners: centre, length along `yaw` (radians from +x), width across. */
export function orientedRect(cx: number, cy: number, len: number, wid: number, yaw: number): V2[] {
  const ux = Math.cos(yaw);
  const uy = Math.sin(yaw);
  const vx = -uy;
  const vy = ux;
  const h = len / 2;
  const w = wid / 2;
  return [
    { x: cx - ux * h - vx * w, y: cy - uy * h - vy * w },
    { x: cx + ux * h - vx * w, y: cy + uy * h - vy * w },
    { x: cx + ux * h + vx * w, y: cy + uy * h + vy * w },
    { x: cx - ux * h + vx * w, y: cy - uy * h + vy * w },
  ];
}

/** Letters for grid lines: A … Z, then AA … */
export function gridLetter(i: number): string {
  let s = "";
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}
