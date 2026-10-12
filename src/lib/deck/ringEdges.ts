// THE OUTLINE'S EDGES, SIDED (2026-10-11) — pure.
//
// shapeOutline's rings run counter-clockwise in plan (x along the house, y out from it): the deck lies on the left of
// every edge and the yard on its right. Two parts were laid on the wrong side — the fascia on the left, inside the rim
// with its face in the rim's own plane (the 3D flickered between the two; owner, 2026-10-11: "fix flickering on the 3D
// around the rim joist fascia"), and the picture-frame border on the right, outside the deck. This reads the sides
// from the ring itself, whatever way it runs, and the turn at each corner, so parts laid along the edges meet there
// without overlapping.

export interface RingPoint {
  x: number;
  y: number;
}

export interface RingEdge {
  A: RingPoint;
  B: RingPoint;
  /** Its length, its direction as a unit vector, and that direction as an angle from +x (radians). */
  length: number;
  ux: number;
  uy: number;
  yaw: number;
  /** The unit normal pointing out of the deck. */
  outX: number;
  outY: number;
  /** The turn at B onto the next edge, radians: positive where the outline turns around the deck (a convex corner), negative at an inside corner. */
  turnAtB: number;
}

/** +1 when the ring runs counter-clockwise (x right, y up), −1 when it runs clockwise. */
export function ringWinding(ring: readonly RingPoint[]): 1 | -1 {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    s += p.x * q.y - q.x * p.y;
  }
  return s >= 0 ? 1 : -1;
}

/** Every edge of the ring with the side the yard is on and the turn at its far corner. */
export function ringEdges(ring: readonly RingPoint[]): RingEdge[] {
  const n = ring.length;
  const w = ringWinding(ring);
  const base = ring.map((A, i) => {
    const B = ring[(i + 1) % n];
    const length = Math.hypot(B.x - A.x, B.y - A.y);
    const ux = length > 0 ? (B.x - A.x) / length : 1;
    const uy = length > 0 ? (B.y - A.y) / length : 0;
    // Counter-clockwise: the deck on the left (−uy, ux), the yard on the right (uy, −ux).
    return { A, B, length, ux, uy, yaw: Math.atan2(uy, ux), outX: w * uy, outY: -w * ux };
  });
  return base.map((e, i) => {
    const next = base[(i + 1) % n];
    const turn = Math.atan2(e.ux * next.uy - e.uy * next.ux, e.ux * next.ux + e.uy * next.uy);
    return { ...e, turnAtB: w * turn };
  });
}

/**
 * How far a board laid OUTSIDE an edge (thickness `t`) runs past the edge's far corner: on past a convex corner, to
 * close it against the next board's back; short of an inside corner, to stop at the next board's face. Negative =
 * stops short. The next edge's board starts at the corner itself.
 */
export function outsideRunOn(turnAtB: number, t: number): number {
  if (!Number.isFinite(turnAtB) || Math.abs(turnAtB) < 1e-6 || Math.abs(turnAtB) > 2.6) return 0;
  return turnAtB > 0 ? t * Math.tan(turnAtB / 2) : -t * Math.tan(-turnAtB / 2);
}
