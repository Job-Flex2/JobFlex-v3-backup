// Pure procedural fence geometry — the core engine. THREE-free: given the path
// points (local feet) and optional gates, it returns flat per-instance arrays the
// 3D component streams straight into InstancedMesh matrices, plus the single
// source of truth for total length (reused by pricing so the number can't drift).
//
// Output is HEIGHT- and MATERIAL-independent: posts/pickets/rails are authored at
// unit size and aligned by yaw, so height changes are a cheap matrix re-write
// and material changes a cheap material swap. Only a change in instance COUNT
// (the path, the gates or the build) forces a rebuild.
//
// BUILD (2026-09-28). With `build` (lib/fence/build — the catalog type's own
// parts) the layout is the fence as the crew builds it: posts at the type's
// spacing, its rails at their heights, its infill — butted boards on the
// rails' outside face, spaced pickets, a shadowbox's two interleaved faces,
// board-on-board's two layers, horizontal boards stacked up the face, bars
// through channel rails, mesh, or nothing on a rail fence. Line posts and
// heavier terminal posts (run ends, corners) are told apart. Without `build`
// the old studio's privacy run comes out unchanged.
//
// GROUND. With `groundAt` the layout also carries where the fence meets the
// land: the ground under every post, and per BAY (post to post) the panel's
// base at each end. A bay follows the ground (racked — rails parallel to the
// grade) unless its segment is priced STEPPED, in which case the bay is level
// at its uphill end and the run drops a step at every post — and a bay that
// would drop more than one code step (MAX_STEP_DROP_FT) is split into shorter
// bays with extra posts, exactly the steps the takeoff charges for. A post
// carries the highest panel of the bays it holds, so a step post is the
// taller one. Without `groundAt` every height is 0 and the result is the old
// flat fence.
import type { PathPoint, GateSpec, OpeningKind, OpeningVariant } from "./fenceTypes";
import { DEFAULT_FENCE_BUILD, type FenceBuild } from "@/lib/fence/build";
import { panelBase, stepStations } from "@/lib/fence/slope";

export const POST_SPACING_FT = 8; // max bay width; runs subdivide evenly to stay ≤ this
export const PICKET_WIDTH_FT = 0.46; // ~5.5"
export const PICKET_GAP_FT = 0.04; // small reveal so butted privacy pickets don't z-fight
export const PICKET_PITCH_FT = PICKET_WIDTH_FT + PICKET_GAP_FT;

/**
 * Bays and posts for runs measured by HAND (the blueprint page's ledger types
 * a length per run and never builds a layout). Same rule the layout below
 * uses — bays of at most the spacing, evenly divided, one post per bay
 * edge — so the estimate's post count matches the fence in the 3D view.
 * Each run is its own fence: it carries a post at both ends.
 */
export function baysForRuns(runsFt: readonly number[], spacingFt = POST_SPACING_FT): number {
  let bays = 0;
  for (const len of runsFt) if (len > 0) bays += Math.max(1, Math.ceil(len / spacingFt));
  return bays;
}

export function postsForRuns(runsFt: readonly number[], spacingFt = POST_SPACING_FT): number {
  let posts = 0;
  for (const len of runsFt) if (len > 0) posts += Math.max(1, Math.ceil(len / spacingFt)) + 1;
  return posts;
}

const EPS = 1e-4;
const CLOSE_TOL_FT = 0.5; // last point within this of the first ⇒ closed loop
/** A turn sharper than this between two segments makes the shared post a corner post. */
const CORNER_DEG = 12;
/** Butted boards keep a hair of daylight, as a real fence does. */
const MIN_REVEAL_FT = 0.02;

// A rendered gate opening, in world feet: centre of the opening + run heading.
export interface GateUnit {
  x: number;
  y: number;
  yaw: number;
  widthFt: number;
  kind: OpeningKind;
  variant: OpeningVariant;
  /** Level base of the leaf: gates hang level, clear of the uphill edge. */
  base: number;
}

export type BayClass = "level" | "racked" | "stepped";

export interface FenceLayoutOptions {
  /** Ground height (ft, any datum) at a local-feet point. Absent ⇒ flat at 0. */
  groundAt?: (x: number, y: number) => number;
  /** The priced slope class of the segment points[i] → points[i + 1]. */
  segClass?: (segIndex: number) => BayClass | null | undefined;
  /** The priced step count of a stepped segment (lib/fence/slope segmentSteps).
   *  Given, the segment is drawn in exactly that many equal steps; absent, each
   *  bay is split by the ground under it. */
  segSteps?: (segIndex: number) => number | null | undefined;
  /** Where a run ends ON a house wall: the post there becomes a wall mount. */
  wallMounts?: PathPoint[];
  /** The parts the fence is built from; the old privacy run without it. */
  build?: FenceBuild | null;
}

/** A run end within this of a wall-mount point is that mount. */
const MOUNT_TOL_FT = 0.35;

/** One horizontal member per bay: height of its centre above the panel base,
 *  its cross-section and its offset across the fence line (feet; negative =
 *  the outside face). The same rows run in every bay. */
export interface RailRow {
  off: number;
  h: number;
  d: number;
  z: number;
}

export interface FenceLayout {
  posts: Float32Array; // [x, y, yaw] × postCount   — ground-plane local feet
  pickets: Float32Array; // [x, y, yaw] × picketCount
  rails: Float32Array; // [x, y, yaw, len, top] × railCount  (top: 1 = top rail, 0 = bottom)
  segments: Float32Array; // [midX, midY, yaw, len] × segCount  (for chain-link infill)
  /** Ground height under each post (same order as `posts`). */
  postBase: Float32Array;
  /** Highest panel base among the bays each post carries. */
  postPanel: Float32Array;
  /** 1 where the post is a wall mount on a house (nothing set in the ground). */
  postMount: Uint8Array;
  /** 1 where the post is a terminal — a run end or a corner — at the heavier stock. */
  postTerminal: Uint8Array;
  /** Panel base under each picket (same order as `pickets`). */
  picketBase: Float32Array;
  /** Each picket's offset across the fence line, feet (negative = outside face). */
  picketOffset: Float32Array;
  /** [x0, y0, z0, x1, y1, z1, stepped] × bayCount — z = panel base at each end. */
  bays: Float32Array;
  bayCount: number;
  steppedBays: number;
  /** Where the boards' face sits across the line, feet — the bracket line for wall mounts. */
  boardZ: number;
  /** The parts this layout was built from. */
  build: FenceBuild;
  gateUnits: GateUnit[];
  postCount: number;
  picketCount: number;
  railCount: number;
  segCount: number;
  totalLengthFt: number;
  closed: boolean;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

function emptyLayout(build: FenceBuild): FenceLayout {
  return {
    posts: new Float32Array(0),
    pickets: new Float32Array(0),
    rails: new Float32Array(0),
    segments: new Float32Array(0),
    postBase: new Float32Array(0),
    postPanel: new Float32Array(0),
    postMount: new Uint8Array(0),
    postTerminal: new Uint8Array(0),
    picketBase: new Float32Array(0),
    picketOffset: new Float32Array(0),
    bays: new Float32Array(0),
    bayCount: 0,
    steppedBays: 0,
    boardZ: 0,
    build,
    gateUnits: [],
    postCount: 0,
    picketCount: 0,
    railCount: 0,
    segCount: 0,
    totalLengthFt: 0,
    closed: false,
    bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  };
}

/** Where the rails sit across the line. A stick-built fence's rails are set
 *  inside the posts, flush with the outside face, and the boards go on the
 *  rails; a shadowbox and board-on-board centre the rails so both faces
 *  clear the posts; routed, channelled and mesh systems run through the
 *  post's centre line. */
export function railZOf(b: FenceBuild): number {
  if (b.kind !== "stick") return 0;
  if (b.infill === "shadowbox" || b.infill === "board-on-board") return 0;
  return -(b.postWidthFt / 2 - b.railDepthFt / 2);
}

/** The horizontal members of one bay, for a fence height. */
export function railRowsFor(b: FenceBuild, fenceH: number): RailRow[] {
  const railZ = railZOf(b);
  const rows: RailRow[] = [];
  if (b.infill === "horizontal") {
    // The boards are the horizontals: stacked up the outside face from the
    // bottom, the last one landing under the fence top.
    const pitch = b.boardWidthFt + Math.max(0, b.boardGapFt);
    const n = Math.max(1, Math.floor((fenceH + Math.max(0, b.boardGapFt) + 1e-6) / pitch));
    const z = -(b.postWidthFt / 2 + b.boardDepthFt / 2);
    for (let k = 0; k < n; k++) rows.push({ off: b.boardWidthFt / 2 + k * pitch, h: b.boardWidthFt, d: b.boardDepthFt, z });
    return rows;
  }
  const n = b.rails;
  if (n <= 0) return rows;
  const h = b.railHeightFt;
  if (b.kind === "mesh") {
    // The top rail at the fabric's top; the bottom tension wire a hand above the ground.
    rows.push({ off: fenceH - h / 2, h, d: b.railDepthFt, z: 0 });
    rows.push({ off: 0.15, h: 0.02, d: 0.02, z: 0 });
    return rows;
  }
  if (b.kind === "rail") {
    // Ranch and split rail: from a knee-high bottom rail to a top rail just
    // under the post top, evenly between. Ranch boards are face-nailed to
    // the posts; split rails sit in their mortises.
    const z = b.railDepthFt < 0.1 ? -(b.postWidthFt / 2 + b.railDepthFt / 2) : 0;
    for (let k = 0; k < n; k++) {
      const f = n === 1 ? 0.9 : 0.28 + (0.62 * k) / (n - 1);
      rows.push({ off: fenceH * f, h, d: b.railDepthFt, z });
    }
    return rows;
  }
  if (b.kind === "panel") {
    // Pocket rails: the bottom rail just off the ground, the top rail flush
    // with the fence top, any others evenly between.
    const lo = h / 2 + 0.1;
    const hi = fenceH - h / 2;
    for (let k = 0; k < n; k++) rows.push({ off: n === 1 ? hi : lo + ((hi - lo) * k) / (n - 1), h, d: b.railDepthFt, z: railZ });
    return rows;
  }
  // Stick-built: a bottom rail a foot up, a top rail a hand under the boards'
  // top, the rest evenly between (a 6 ft privacy fence carries three).
  const lo = Math.min(1.0, fenceH * 0.15);
  const hi = fenceH - Math.min(0.8, fenceH * 0.13);
  for (let k = 0; k < n; k++) rows.push({ off: n === 1 ? hi : lo + ((hi - lo) * k) / (n - 1), h, d: b.railDepthFt, z: railZ });
  return rows;
}

/** The boards' faces across the line: an offset per face, and a phase that
 *  shifts that face's boards along the run by a fraction of the pitch. */
function facesOf(b: FenceBuild, railZ: number): Array<{ z: number; phase: number }> {
  const out = railZ - b.railDepthFt / 2 - b.boardDepthFt / 2;
  const inn = railZ + b.railDepthFt / 2 + b.boardDepthFt / 2;
  switch (b.infill) {
    case "boards":
    case "pickets":
      return [{ z: b.kind === "stick" ? out : 0, phase: 0 }];
    case "shadowbox":
      return [
        { z: out, phase: 0 },
        { z: inn, phase: 0.5 },
      ];
    case "board-on-board":
      return [
        { z: out, phase: 0 },
        { z: out - b.boardDepthFt, phase: 0.5 },
      ];
    case "bars":
      return [{ z: 0, phase: 0 }];
    default:
      return [];
  }
}

/** Centre-to-centre pitch of the boards on ONE face. */
function pitchOf(b: FenceBuild): number {
  if (b.infill === "board-on-board") {
    // Two layers: each covers the other's gaps, overlapping by the catalog's
    // overlap on both sides — so one layer's pitch is twice (width − overlap).
    const overlap = Math.max(0, -b.boardGapFt);
    return Math.max(b.boardWidthFt + MIN_REVEAL_FT, 2 * (b.boardWidthFt - overlap));
  }
  return b.boardWidthFt + Math.max(MIN_REVEAL_FT, b.boardGapFt);
}

export function computeFenceLayout(
  points: PathPoint[],
  gates: GateSpec[] = [],
  opts: FenceLayoutOptions = {},
): FenceLayout {
  const build = opts.build ?? DEFAULT_FENCE_BUILD;
  if (!points || points.length < 2) return emptyLayout(build);
  const groundAt = opts.groundAt;
  const g = (x: number, y: number) => {
    const v = groundAt ? groundAt(x, y) : 0;
    return Number.isFinite(v) ? v : 0;
  };
  const mounts = opts.wallMounts ?? [];
  const isMount = (x: number, y: number) =>
    mounts.some((m) => Math.hypot(m.x - x, m.y - y) <= MOUNT_TOL_FT);
  const spacing = Math.max(2, build.spacingFt);
  const railZ = railZOf(build);
  const faces = facesOf(build, railZ);
  const pitch = pitchOf(build);
  const boardZ = faces.length ? faces[0].z : railZ;
  // A board whose thickness crosses a post's footprint is not nailed through
  // the post: it is left out where a post stands, and the post shows there.
  const boardHitsPost = (z: number) => Math.abs(z) - build.boardDepthFt / 2 < build.postWidthFt / 2;

  const first = points[0];
  const last = points[points.length - 1];
  const closed = points.length > 2 && Math.hypot(last.x - first.x, last.y - first.y) < CLOSE_TOL_FT;

  const posts: number[] = [];
  const pickets: number[] = [];
  const rails: number[] = [];
  const segments: number[] = [];
  const postBase: number[] = [];
  const postPanel: number[] = [];
  const postMount: number[] = [];
  const postTerminal: number[] = [];
  const picketBase: number[] = [];
  const picketOffset: number[] = [];
  const bays: number[] = [];
  let steppedBays = 0;
  const gateUnits: GateUnit[] = [];
  let totalLengthFt = 0;
  const pushPost = (x: number, y: number, yaw: number, panel: number, terminal: boolean) => {
    posts.push(x, y, yaw);
    const base = g(x, y);
    postBase.push(base);
    postPanel.push(Math.max(base, panel));
    // Only a run END can sit on a wall; a mid-run post near a house is a post.
    postMount.push(0);
    postTerminal.push(terminal ? 1 : 0);
    return posts.length / 3 - 1;
  };

  // Multi-run support: a point with `gap` starts a NEW disconnected run — no
  // segment is emitted between it and the previous point. Each run manages its
  // own closure (last ≈ first ⇒ closed) and its own trailing end post.
  let runStart = 0; // index of the current run's first point
  let runLastYaw = 0;
  let runHasSegment = false;
  let runFirstPost = -1; // post index of the run's first post
  /** Panel base the previous bay left at the corner the next segment starts on. */
  let cornerPanel = -Infinity;
  const endRun = (runEnd: number) => {
    if (!runHasSegment) return;
    const rs = points[runStart];
    const re = points[runEnd];
    const runClosed = runEnd - runStart > 1 && Math.hypot(re.x - rs.x, re.y - rs.y) < CLOSE_TOL_FT;
    // Open runs need the trailing corner post; closed runs already have it (the
    // final segment returns to the run's first point, emitted by its first bay).
    if (!runClosed) {
      const idx = pushPost(re.x, re.y, runLastYaw, cornerPanel, true);
      if (isMount(re.x, re.y)) postMount[idx] = 1;
      if (runFirstPost >= 0 && isMount(rs.x, rs.y)) postMount[runFirstPost] = 1;
    } else if (runFirstPost >= 0) {
      // The closing bay ends on the run's first post.
      postPanel[runFirstPost] = Math.max(postPanel[runFirstPost], cornerPanel);
    }
  };

  // Iterate ORIGINAL point indices so gate.segmentIndex maps correctly even when
  // a degenerate (zero-length) or gap segment is skipped.
  let prevYaw: number | null = null; // heading of the previous segment in this run
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (b.gap) {
      // Run boundary: finish the current run, start the next at b.
      endRun(i);
      runStart = i + 1;
      runHasSegment = false;
      runFirstPost = -1;
      cornerPanel = -Infinity;
      prevYaw = null;
      continue;
    }
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < EPS) continue; // skip duplicate consecutive points

    const ux = dx / len;
    const uy = dy / len;
    const yaw = Math.atan2(dy, dx);
    // The post this segment starts on: a run end, or a corner when the line turns.
    let turn = prevYaw == null ? Math.PI : Math.abs(yaw - prevYaw);
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    const startsTerminal = prevYaw == null || (turn * 180) / Math.PI >= CORNER_DEG;
    prevYaw = yaw;
    runLastYaw = yaw;
    runHasSegment = true;
    totalLengthFt += len;

    // Post stations along the segment: bays ≤ spacing, remainder distributed
    // evenly. A STEPPED bay dropping more than one code step is split into
    // shorter bays with extra posts, as the takeoff charges. Stations run
    // 0..len; the end station's post belongs to the next segment (or endRun).
    const stepped = opts.segClass?.(i) === "stepped";
    const bayN = Math.max(1, Math.ceil(len / spacing));
    const step = len / bayN;
    let stations: number[] = [];
    for (let k = 0; k <= bayN; k++) stations.push(k === bayN ? len : step * k);
    const priced = stepped ? opts.segSteps?.(i) : null;
    // A stepped segment on real ground: the posts where the ground spends a step (lib/fence/slope stepStations) —
    // close down the steep part, a bay apart on the flat — exactly the ticket's count when there is one.
    let profile: number[] | null = null;
    let profileDs = 1;
    if (stepped && groundAt) {
      const nS = Math.max(2, Math.ceil(len));
      profileDs = len / nS;
      profile = [];
      for (let k = 0; k <= nS; k++) profile.push(g(a.x + ux * profileDs * k, a.y + uy * profileDs * k));
      stations = stepStations(profile, profileDs, spacing, { count: priced });
    }
    const first = posts.length / 3;
    for (let k = 0; k < stations.length - 1; k++) {
      const d = stations[k];
      const idx = pushPost(a.x + ux * d, a.y + uy * d, yaw, k === 0 ? cornerPanel : -Infinity, k === 0 && startsTerminal);
      if (runFirstPost < 0) runFirstPost = idx;
    }
    // Bays: the panel base at each end — on the ground, or level at the uphill
    // end of a stepped segment.
    const endGround = g(b.x, b.y);
    const segBays: Array<[number, number, number, number]> = []; // [s0, s1, za, zb]
    const bayCountHere = stations.length - 1;
    for (let k = 0; k < bayCountHere; k++) {
      const s0 = stations[k];
      const s1 = stations[k + 1];
      const ga = postBase[first + k];
      const gb = k + 1 < bayCountHere ? postBase[first + k + 1] : endGround;
      // A stepped bay is level on the HIGH ground under it (not only at its ends): it never buries, and hangs at most
      // one step over the dips.
      const level = stepped ? (profile ? panelBase(profile, profileDs, s0, s1) : Math.max(ga, gb)) : 0;
      const za = stepped ? level : ga;
      const zb = stepped ? level : gb;
      segBays.push([s0, s1, za, zb]);
      bays.push(a.x + ux * s0, a.y + uy * s0, za, a.x + ux * s1, a.y + uy * s1, zb, stepped ? 1 : 0);
      if (stepped) steppedBays++;
      postPanel[first + k] = Math.max(postPanel[first + k], za);
      if (k + 1 < bayCountHere) postPanel[first + k + 1] = Math.max(postPanel[first + k + 1], zb);
      else cornerPanel = zb;
    }
    const baseAt = (d: number) => {
      let k = 0;
      while (k + 1 < segBays.length && d > segBays[k][1]) k++;
      const [s0, s1, za, zb] = segBays[k];
      const t = s1 > s0 ? Math.min(1, Math.max(0, (d - s0) / (s1 - s0))) : 0;
      return za + (zb - za) * t;
    };

    // Gate openings on this segment → emit gate units + intervals to skip pickets.
    const openings: Array<[number, number]> = [];
    for (const gate of gates) {
      if (gate.segmentIndex !== i) continue;
      const w = Math.min(gate.widthFt, len);
      const c = Math.min(Math.max(gate.t, 0), 1) * len;
      const half = w / 2;
      openings.push([c - half, c + half]);
      const s0 = Math.max(0, c - half);
      const s1 = Math.min(len, c + half);
      const base = Math.max(g(a.x + ux * s0, a.y + uy * s0), g(a.x + ux * s1, a.y + uy * s1));
      gateUnits.push({ x: a.x + ux * c, y: a.y + uy * c, yaw, widthFt: w, kind: gate.kind, variant: gate.variant, base });
    }

    // Boards: per face, evenly distributed and centred on the segment, skipping
    // gate openings and any station whose post they would run through.
    if (faces.length) {
      const n = Math.floor(len / pitch);
      const slack = len - n * pitch;
      const half = build.boardWidthFt / 2;
      for (const face of faces) {
        const hits = boardHitsPost(face.z);
        for (let j = 0; j < n; j++) {
          const d = (j + 0.5 + face.phase) * pitch + slack / 2;
          if (d + half > len || d - half < 0) continue;
          if (openings.some(([s0, s1]) => d >= s0 && d <= s1)) continue;
          if (hits && stations.some((s) => Math.abs(s - d) < build.postWidthFt / 2 + half)) continue;
          pickets.push(a.x + ux * d, a.y + uy * d, yaw);
          picketBase.push(baseAt(d));
          picketOffset.push(face.z);
        }
      }
    }

    // Rails: continuous top + bottom per straight run.
    const mx = a.x + ux * (len / 2);
    const my = a.y + uy * (len / 2);
    rails.push(mx, my, yaw, len, 1);
    rails.push(mx, my, yaw, len, 0);
    segments.push(mx, my, yaw, len);
  }

  // Detached openings (dropped away from any run): emit standalone units with a
  // default east-west heading. They carry no picket-skipping (not on a segment).
  for (const gate of gates) {
    if (gate.segmentIndex >= 0) continue;
    if (typeof gate.x !== "number" || typeof gate.y !== "number") continue;
    const half = gate.widthFt / 2;
    const base = Math.max(g(gate.x - half, gate.y), g(gate.x + half, gate.y));
    gateUnits.push({ x: gate.x, y: gate.y, yaw: 0, widthFt: gate.widthFt, kind: gate.kind, variant: gate.variant, base });
  }

  // Final run's end post (earlier runs got theirs at each gap boundary).
  endRun(points.length - 1);

  // Posts at the same spot (a run joining another, a T) must stand identical:
  // with different panel heights their faces overlap and textured materials
  // flicker. All take the tallest; a wall mount survives only if every post
  // there is one; a shared post is a terminal if any of them is.
  {
    const byKey = new Map<string, number[]>();
    for (let i = 0; i < posts.length / 3; i++) {
      const k = `${Math.round(posts[i * 3] * 1000)}_${Math.round(posts[i * 3 + 1] * 1000)}`;
      const arr = byKey.get(k);
      if (arr) arr.push(i);
      else byKey.set(k, [i]);
    }
    for (const group of byKey.values()) {
      if (group.length < 2) continue;
      const panel = Math.max(...group.map((i) => postPanel[i]));
      const base = Math.min(...group.map((i) => postBase[i]));
      const allMount = group.every((i) => postMount[i] === 1);
      const anyTerminal = group.some((i) => postTerminal[i] === 1);
      for (const i of group) {
        postPanel[i] = panel;
        postBase[i] = base;
        postMount[i] = allMount ? 1 : 0;
        postTerminal[i] = anyTerminal ? 1 : 0;
      }
    }
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  // Fold detached openings into the bounds so the 3D view frames them too.
  for (const gate of gates) {
    if (gate.segmentIndex >= 0 || typeof gate.x !== "number" || typeof gate.y !== "number") continue;
    if (gate.x < minX) minX = gate.x;
    if (gate.y < minY) minY = gate.y;
    if (gate.x > maxX) maxX = gate.x;
    if (gate.y > maxY) maxY = gate.y;
  }

  return {
    posts: new Float32Array(posts),
    pickets: new Float32Array(pickets),
    rails: new Float32Array(rails),
    segments: new Float32Array(segments),
    postBase: new Float32Array(postBase),
    postPanel: new Float32Array(postPanel),
    postMount: new Uint8Array(postMount),
    postTerminal: new Uint8Array(postTerminal),
    picketBase: new Float32Array(picketBase),
    picketOffset: new Float32Array(picketOffset),
    bays: new Float32Array(bays),
    bayCount: bays.length / 7,
    steppedBays,
    boardZ,
    build,
    gateUnits,
    postCount: posts.length / 3,
    picketCount: pickets.length / 3,
    railCount: rails.length / 5,
    segCount: segments.length / 4,
    totalLengthFt,
    closed,
    bounds: { minX, minY, maxX, maxY },
  };
}
