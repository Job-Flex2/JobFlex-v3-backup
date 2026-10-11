// THE DECK IN 3D, AS DATA (2026-10-04; roofs 2026-10-10; version 3 M3 2026-10-10) — pure, no three.js.
//
// Owner: "it starts building in actual kind of a 3D … show it as it is made
// in real, show the bolts, the hangers and the rest, zoom in any part." The
// whole structure (structure.ts) becomes a list of boxes and polygons in
// feet, each filed under the layer it belongs to, in the order a crew builds
// them — and, since version 3, each box carries a TAG into a legend that
// says what the piece is, its size, its length, how it is cut and what
// fastens it, so the 3D can name any part a finger lands on and fly to it.
// CALLOUTS mark the connections worth looking at: the ledger on the house,
// a hanger, a post on its footing, the beam on its post, the roof's ledger,
// a hurricane tie, the stair's connectors, a rail post's bolts.
//
// The same list rides with the proposal (lib/deck/convertSchema), so the
// client's page shows the deck that was priced — frozen, like the fence's
// scene: a later change to the engine never redraws a deck a client has
// already seen. Nothing is uploaded for it.
//
// VERSION 3: eight more layers (stairs, rails, glass, screen, walls,
// hardware, lights, wires), the ground's fall, the legend and tags, the
// callouts, the glowing fixtures for the night view, boards cut to a shaped
// front. Versions 1 and 2 still read: their layers are the first ten and
// twenty of these, in order.

import type { DeckFrame } from "./frame";
import type { DeckSurface } from "./surface";
import type { RoofMember, RoofPlane } from "./roof";
import { ROOFING_LABEL, hasDeck, shapeOutline, sizeWords, structureWords, type DeckDesign } from "./design";
import type { DeckStructure } from "./structure";
import { structureLevels } from "./structure";
import type { StairMember } from "./stairs";
import type { RailMember } from "./rails";
import { railWords } from "./rails";
import { electricalWords } from "./electrical";

export const DECK_SCENE_VERSION = 3;

/** The layers. A box's first number is its index here; the first ten are version 1's, the first twenty version 2's, in their order. */
export const SCENE_LAYERS = [
  "footing",
  "post",
  "beam",
  "ledger",
  "joist",
  "rim",
  "blocking",
  "brace",
  "decking",
  "fascia",
  "slab",
  "roof-post",
  "header",
  "ridge",
  "rafter",
  "sheathing",
  "roofing",
  "trim",
  "gutter",
  "ceiling",
  "stair",
  "rail",
  "glass",
  "screen",
  "wall",
  "hardware",
  "light",
  "wire",
] as const;
export type SceneLayer = (typeof SCENE_LAYERS)[number];
export const SCENE_LAYER_LABEL: Record<SceneLayer, string> = {
  footing: "Footings",
  post: "Posts",
  beam: "Beams",
  ledger: "Ledger",
  joist: "Joists",
  rim: "Rim",
  blocking: "Blocking",
  brace: "Braces",
  decking: "Decking",
  fascia: "Fascia",
  slab: "Slab",
  "roof-post": "Roof posts",
  header: "Headers",
  ridge: "Ridge and hips",
  rafter: "Rafters",
  sheathing: "Sheathing",
  roofing: "Roofing",
  trim: "Fascia and soffit",
  gutter: "Gutters",
  ceiling: "Ceiling",
  stair: "Stairs",
  rail: "Railing",
  glass: "Glass panels",
  screen: "Screens",
  wall: "Walls",
  hardware: "Bolts and hangers",
  light: "Lights and fixtures",
  wire: "Wiring",
};
/** The order the build-up slider stands the layers up in (a slab goes down first; the hardware goes on with the frame). */
export const SCENE_BUILD_ORDER: readonly SceneLayer[] = ["slab", "footing", "post", "beam", "ledger", "joist", "rim", "blocking", "brace", "hardware", "decking", "fascia", "stair", "rail", "glass", "roof-post", "header", "ridge", "rafter", "sheathing", "roofing", "trim", "gutter", "ceiling", "wall", "screen", "wire", "light"];
/** A layer's step in the build-up. */
export const buildRank = (layer: SceneLayer) => SCENE_BUILD_ORDER.indexOf(layer);
/** The layers a scene actually has, in build order — the slider runs over these. */
export function sceneBuildLayers(scene: DeckScene): SceneLayer[] {
  const present = new Set<number>();
  for (const b of scene.boxes) present.add(b[0]);
  for (const p of scene.polys) present.add(p[0]);
  if (scene.footings.length) present.add(SCENE_LAYERS.indexOf("footing"));
  if (scene.diagonal?.boards.length) present.add(SCENE_LAYERS.indexOf("decking"));
  return SCENE_BUILD_ORDER.filter((l) => present.has(SCENE_LAYERS.indexOf(l)));
}

/** The most a stored scene may carry. */
export const SCENE_MAX_BOXES = 12000;
export const SCENE_MAX_FOOTINGS = 400;
export const SCENE_MAX_DIAGONALS = 1500;
export const SCENE_MAX_POLYS = 600;
export const SCENE_MAX_LEGEND = 400;
export const SCENE_MAX_CALLOUTS = 40;
export const SCENE_MAX_GLOWS = 120;

/** A handle: dragging it along `axis` (scene feet) changes `kind` from `value` by the distance dragged. */
export interface SceneHandle {
  kind: "width" | "depth" | "height" | "eave" | "stair" | "lower-depth" | "roof-width" | "roof-depth";
  id: string;
  x: number;
  y: number;
  z: number;
  axis: "x" | "y" | "z";
  /** The design's number the handle moves: feet for sizes, inches for heights. */
  value: number;
  /** Feet of drag per unit of value (12 for an inches value). */
  perUnit: number;
  label: string;
}

/** One kind of part: what it is, how it is cut, what fastens it. The 3D shows this when a part is touched. */
export interface SceneLegend {
  /** "rafter", "joist hanger", "connection"… */
  role: string;
  /** "2x8", "LUS28", "½-in. lag"… */
  nominal: string;
  /** The length of this part, ft (0 for hardware). */
  lengthFt: number;
  /** How many of them. */
  count: number;
  /** One or two sentences: the cut angles, the fasteners, the rule. */
  note: string;
}

export interface DeckScene {
  v: typeof DECK_SCENE_VERSION;
  /** The outline's bounding size and the walking surface's height, ft; the roof's peak when there is one. */
  widthFt: number;
  depthFt: number;
  heightFt: number;
  peakFt: number;
  /**
   * Boxes: [layer, cx, cy, cz, sx, sy, sz, lean] or, with a direction,
   * [layer, cx, cy, cz, sx, sy, sz, lean, yaw, tilt]. Feet; x along the
   * house, y out from it, z up. `lean`: 0 for a square box; 1–4 for a knee
   * brace drawn as the diagonal of its box (1 = rising toward +x, 2 = toward
   * −x, 3 = toward +y, 4 = toward −y). With a yaw and a tilt (radians) the
   * box is `sx` long along an axis that points `yaw` from +x in plan and
   * rises `tilt`; `sy` is its width across, `sz` its depth.
   */
  boxes: number[][];
  /** Per box, its legend entry (−1 for none). Same length as `boxes`, or empty. */
  tags: number[];
  legend: SceneLegend[];
  /** Connections worth a look: [x, y, z, legend index], ft. */
  callouts: number[][];
  /** Footings: [x, y, pad diameter, pad thickness, pier diameter, depth below the house-line ground, top above it], ft. */
  footings: number[][];
  /** Boards laid on the diagonal or cut to a shaped front: each a flat ring [x0, y0, x1, y1, …] at the walking surface (version 3: `z` per ring in `diagonal.zs`). */
  diagonal: { thickFt: number; boards: number[][]; zs?: number[] } | null;
  /** Flat polygons in space: [layer, x, y, z, x, y, z, …], ft — the roof's faces, the ceiling, the soffit, a slab, glass, screens, walls. */
  polys: number[][];
  /** Per poly, its legend entry (−1 for none). Same length as `polys`, or empty. */
  polyTags: number[];
  /** The outline as a flat ring, ft (the deck's, or the roof's posts when there is no deck). */
  outline: number[];
  /** The house, where the deck touches one: blocks [x0, y0, x1, y1], its height, and a door on the main wall [centre x, width, height]. */
  house: { blocks: number[][]; heightFt: number; door: number[] | null } | null;
  /** The ground's fall across the deck, ft: out from the house over its depth, left to right over its width (null = flat). */
  ground: { outDropFt: number; acrossDropFt: number } | null;
  /** Fixtures that glow in the night view: [x, y, z, colour as 0xRRGGBB, sample (1 = the client's own fixture)], ft. */
  glows: number[][];
  /** Handles the 3D's edit mode drags (M3): what each one changes, where it sits (ft), along which axis, and the value it starts from. */
  handles: SceneHandle[];
  colors: { frame: string; decking: string; fascia: string; roofing: string; rail: string };
  /** What the client reads under the picture. */
  facts: string;
}

const r3 = (inches: number) => Math.round((inches / 12) * 1000) / 1000;
const r4 = (rad: number) => Math.round(rad * 10000) / 10000;
const LEAN: Record<string, number> = { "x:1": 1, "x:-1": 2, "y:1": 3, "y:-1": 4 };
const deg = (rad: number) => `${Math.round(Math.abs(rad) * (180 / Math.PI) * 10) / 10}°`;

/** Treated lumber's green-brown, or the heartwood's own colour. */
function frameColor(speciesId: string, group: string): string {
  if (speciesId === "redwood") return "#a4573e";
  if (speciesId === "western-cedar") return "#b5764a";
  return group === "SP" ? "#a59863" : "#9d8c62";
}

/** The roofing's colour in the 3D. */
export function roofingColor(roofing: DeckDesign["roof"]["roofing"]): string {
  switch (roofing) {
    case "3tab-shingle":
      return "#5b5651";
    case "designer-shingle":
      return "#4a4642";
    case "cedar-shake":
      return "#9a7a52";
    case "metal-panel":
      return "#6f7478";
    case "standing-seam":
      return "#3f4a55";
    case "none":
      return "#9d8c62";
    default:
      return "#565250";
  }
}

/** The rail's colour by system. */
export function railColor(type: DeckDesign["rail"]["type"], deckColor: string, frame: string): string {
  switch (type) {
    case "aluminum":
    case "cable":
      return "#2b2e33";
    case "glass":
      return "#30343a";
    case "vinyl":
      return "#f2f0ea";
    case "composite":
      return deckColor;
    case "cedar":
      return "#b5764a";
    default:
      return frame;
  }
}

/** A convex ring clipped to a rectangle (Sutherland–Hodgman). */
function clipToRect(ring: Array<[number, number]>, x0: number, y0: number, x1: number, y1: number): Array<[number, number]> {
  const edges: Array<{ inside: (p: [number, number]) => boolean; cross: (a: [number, number], b: [number, number]) => [number, number] }> = [
    { inside: (p) => p[0] >= x0, cross: (a, b) => [x0, a[1] + ((b[1] - a[1]) * (x0 - a[0])) / (b[0] - a[0])] },
    { inside: (p) => p[0] <= x1, cross: (a, b) => [x1, a[1] + ((b[1] - a[1]) * (x1 - a[0])) / (b[0] - a[0])] },
    { inside: (p) => p[1] >= y0, cross: (a, b) => [a[0] + ((b[0] - a[0]) * (y0 - a[1])) / (b[1] - a[1]), y0] },
    { inside: (p) => p[1] <= y1, cross: (a, b) => [a[0] + ((b[0] - a[0]) * (y1 - a[1])) / (b[1] - a[1]), y1] },
  ];
  let out = ring;
  for (const e of edges) {
    const src = out;
    out = [];
    for (let i = 0; i < src.length; i++) {
      const a = src[i];
      const b = src[(i + 1) % src.length];
      const ain = e.inside(a);
      const bin = e.inside(b);
      if (ain && bin) out.push(b);
      else if (ain && !bin) out.push(e.cross(a, b));
      else if (!ain && bin) out.push(e.cross(a, b), b);
    }
    if (out.length === 0) break;
  }
  return out;
}

const ringArea = (ring: Array<[number, number]>) => Math.abs(ring.reduce((a, p, i) => a + p[0] * ring[(i + 1) % ring.length][1] - ring[(i + 1) % ring.length][0] * p[1], 0)) / 2;

/** Boards at 45° across the deck (a herringbone: each half its own way), each clipped to the rectangles of the outline. Inches in, feet out. */
function diagonalBoards(frame: DeckFrame, surface: DeckSurface, offX: number, offY: number): number[][] {
  const zones = frame.zones.map((z) => z.zone);
  const width = Math.max(...zones.map((z) => z.x1));
  const depth = Math.max(...zones.map((z) => z.y1));
  const w = surface.product.widthIn;
  const pitch = w + surface.product.gapIn;
  const out: number[][] = [];
  const step = pitch * Math.SQRT2;
  const band = w * Math.SQRT2;
  const far = width + depth;
  const inset = surface.border * pitch;
  const halves: Array<{ x0: number; x1: number; dir: 1 | -1 }> = surface.pattern === "herringbone" ? [{ x0: inset, x1: width / 2, dir: 1 }, { x0: width / 2, x1: width - inset, dir: -1 }] : [{ x0: inset, x1: width - inset, dir: 1 }];
  for (const h of halves) {
    for (let c = -depth - width; c < width + depth && out.length < SCENE_MAX_DIAGONALS; c += step) {
      // A board is the strip between two lines x − dir·y = c.
      const strip: Array<[number, number]> = h.dir === 1 ? [[c - far, -far], [c + band - far, -far], [c + band + far, far], [c + far, far]] : [[c + far, -far], [c + band + far, -far], [c + band - far, far], [c - far, far]];
      for (const z of zones) {
        const ring = clipToRect(strip, Math.max(z.x0, h.x0), z.y0, Math.min(z.x1, h.x1), z.y1 - inset);
        if (ring.length >= 3 && ringArea(ring) > 2) out.push(ring.flatMap((p) => [r3(p[0] + offX), r3(p[1] + offY)]));
      }
    }
  }
  return out;
}

/** Which layer a roof member is drawn in. */
const ROOF_MEMBER_LAYER: Record<RoofMember["role"], SceneLayer> = {
  "roof-post": "roof-post",
  header: "header",
  "roof-ledger": "header",
  "roof-brace": "header",
  rafter: "rafter",
  jack: "rafter",
  fly: "rafter",
  tie: "rafter",
  purlin: "rafter",
  slat: "rafter",
  hip: "ridge",
  ridge: "ridge",
  king: "ridge",
  ring: "ridge",
  "tier-post": "ridge",
  subfascia: "trim",
  "fascia-eave": "trim",
  "fascia-rake": "trim",
  cupola: "trim",
  gutter: "gutter",
  downspout: "gutter",
  kneewall: "wall",
  stud: "wall",
  door: "wall",
  fixture: "light",
};
const ROOF_PLANE_LAYER: Record<RoofPlane["kind"], SceneLayer> = { sheathing: "sheathing", roofing: "roofing", ceiling: "ceiling", soffit: "trim", slab: "slab", wall: "wall", screen: "screen", louver: "roofing", fixture: "light" };
const STAIR_LAYER: Record<StairMember["role"], SceneLayer> = { stringer: "stair", tread: "stair", riser: "stair", kicker: "stair", "stair-post": "stair", "stair-beam": "stair", "landing-frame": "stair", "landing-tread": "stair", "box-frame": "stair", "box-tread": "stair", "stair-rail": "rail", "stair-rail-post": "rail", "stair-baluster": "rail", pad: "slab" };
const RAIL_LAYER: Record<RailMember["role"], SceneLayer> = { "rail-post": "rail", "rail-top": "rail", "rail-bottom": "rail", "rail-cap": "rail", baluster: "rail", cable: "rail", "rail-panel": "glass" };

/** The scene the whole structure stands up. */
export function deckScene(s: DeckStructure): DeckScene {
  const { design, frame, roof } = s;
  const layer = (name: SceneLayer) => SCENE_LAYERS.indexOf(name);
  const boxes: number[][] = [];
  const tags: number[] = [];
  const polys: number[][] = [];
  const polyTags: number[] = [];
  const legend: SceneLegend[] = [];
  const legendIndex = new Map<string, number>();
  const callouts: number[][] = [];
  const glows: number[][] = [];
  const footings: number[][] = [];

  /** The legend entry for a kind of part (one per role + stock + length to the half foot). */
  const tagFor = (role: string, nominal: string, lengthIn: number, note: string): number => {
    const lengthFt = Math.round((lengthIn / 12) * 2) / 2;
    const key = `${role}|${nominal}|${lengthFt}|${note.slice(0, 40)}`;
    const found = legendIndex.get(key);
    if (found !== undefined) {
      legend[found].count += 1;
      return found;
    }
    if (legend.length >= SCENE_MAX_LEGEND) return -1;
    legend.push({ role, nominal, lengthFt, count: 1, note: note.slice(0, 240) });
    legendIndex.set(key, legend.length - 1);
    return legend.length - 1;
  };
  const callout = (x: number, y: number, z: number, role: string, nominal: string, note: string) => {
    if (callouts.length >= SCENE_MAX_CALLOUTS) return;
    legend.push({ role, nominal, lengthFt: 0, count: 1, note: note.slice(0, 240) });
    callouts.push([r3(x), r3(y), r3(z), legend.length - 1]);
  };
  const box = (name: SceneLayer, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, tag: number, lean = 0, yaw = 0, tilt = 0) => {
    if (boxes.length >= SCENE_MAX_BOXES) return;
    const yw = r4(yaw);
    const tl = r4(tilt);
    if (yw === 0 && tl === 0) boxes.push([layer(name), r3(cx), r3(cy), r3(cz), r3(sx), r3(sy), r3(sz), lean]);
    else boxes.push([layer(name), r3(cx), r3(cy), r3(cz), r3(sx), r3(sy), r3(sz), lean, yw, tl]);
    tags.push(tag);
  };
  const poly = (name: SceneLayer, ring: number[], tag = -1) => {
    if (polys.length >= SCENE_MAX_POLYS) return;
    polys.push([layer(name), ...ring.map((v) => r3(v))]);
    polyTags.push(tag);
  };

  const levels = structureLevels(s);
  let width = 0;
  let depth = 0;
  let heightIn = 0;
  const shapedBoards: number[][] = [];
  const shapedZs: number[] = [];

  /* ── The deck, level by level ──────────────────────────────────────── */
  for (const level of levels) {
    const f = level.frame;
    const surface = level.surface;
    const ox = level.offsetXIn;
    const oy = level.offsetYIn;
    const zones = f.zones.map((z) => z.zone);
    width = Math.max(width, Math.max(...zones.map((z) => z.x1)) + ox);
    depth = Math.max(depth, Math.max(...zones.map((z) => z.y1)) + oy);
    if (level.id === "upper") heightIn = f.surfaceIn;
    const lvl = level.id === "lower" ? "lower level " : "";
    const noteFor = (st: typeof f.sticks[number]): string => {
      switch (st.role) {
        case "joist":
          return `${lvl}${st.nominal} joist, ${f.spacingIn} in. on centre, ${f.species.short.toLowerCase()}. Square-cut both ends; ${f.beamStyle === "flush" ? "hung in a hanger at each beam" : f.design.placement === "attached" ? "a hanger at the ledger, a hurricane tie at each beam" : "a hurricane tie at each beam"}.`;
        case "rim":
          return st.curved ? `${lvl}Curved rim: three plies of ½-in. treated plywood bent to the arc, glued and screwed to every joist end.` : `${lvl}${st.nominal} rim across the joist ends${st.yaw ? ", mitred at the clipped corner (22.5° each face)" : ""}: three structural screws into each joist.`;
        case "ledger":
          return `${lvl}${st.nominal} ledger on the house: ${f.ledgers[0] ? `${f.ledgers[0].fasteners} ${f.design.ledger.fastener === "lag" ? "½-in. lags" : f.design.ledger.fastener === "bolt" || f.design.ledger.fastener === "bolt-gap" ? "½-in. through-bolts" : "structural screws"} every ${f.ledgers[0].spacingIn} in. in two staggered rows` : "fastened by the table"}, flashed over, membrane behind.`;
        case "beam":
          return `${lvl}${st.nominal}${f.beams.find((b) => b.id === st.of)?.spec.plies && (f.beams.find((b) => b.id === st.of)?.spec.plies ?? 1) > 1 ? ` ply of a ${f.beams.find((b) => b.id === st.of)?.spec.size} beam` : " beam"}, ${f.beamStyle === "flush" ? "flush with the joists, which hang on it" : "under the joists on post caps"}; plies nailed 16d at 16 in., staggered.`;
        case "post":
          return `${lvl}${st.nominal} post on a stand-off base, ${f.beamStyle === "dropped" ? "notched or capped for the beam (two ½-in. bolts)" : "capped for the beam"}; cut square to length.`;
        case "blocking":
          return `${lvl}${st.nominal} blocking between the joists, square-cut to the bay, toe-nailed.`;
        case "brace":
          return `${lvl}2x4 knee brace cut at 45° both ends, a ½-in. lag at each end.`;
        default:
          return st.role;
      }
    };
    for (const st of f.sticks) box(st.role, st.cx + ox, st.cy + oy, st.cz, st.sx, st.sy, st.sz, tagFor(`${lvl}${st.role}`, st.nominal, st.lengthIn, noteFor(st)), st.lean ? LEAN[`${st.lean.axis}:${st.lean.dir}`] ?? 0 : 0, st.yaw ?? 0, 0);

    // Hardware: lag heads along the ledger, hangers at the joists, ties over the beams, bases and caps at the posts, hold-downs, flashing.
    const hwTag = (role: string, nominal: string, note: string) => tagFor(role, nominal, 0, note);
    for (const l of f.ledgers) {
      const n = Math.max(2, l.fasteners);
      const perRow = Math.ceil(n / 2);
      const lagTag = hwTag("ledger fastener", f.design.ledger.fastener === "lag" ? "½-in. lag with washer" : f.design.ledger.fastener === "bolt" || f.design.ledger.fastener === "bolt-gap" ? "½-in. through-bolt" : "structural screw", `Every ${l.spacingIn} in., two staggered rows, 2 in. from the ledger's top, ¾ in. from its bottom, 2 in. from its ends (IRC R507.9.1.3).`);
      for (let k = 0; k < perRow; k++) {
        const t = (k + 0.5) / perRow;
        const x = l.x0 + (l.x1 - l.x0) * t;
        const zTop = f.joistTopIn - 2.25;
        const zBot = f.joistBottomIn + 2;
        box("hardware", x + ox, l.y + oy + 1.9, k % 2 === 0 ? zTop : zBot, 1.2, 0.8, 1.2, lagTag);
        box("hardware", x + ox + 0.5 * l.spacingIn * 0.5, l.y + oy + 1.9, k % 2 === 0 ? zBot : zTop, 1.2, 0.8, 1.2, lagTag);
      }
      // Flashing over the ledger's top, up behind the siding.
      box("hardware", (l.x0 + l.x1) / 2 + ox, l.y + oy + 0.75, f.joistTopIn + 0.15, l.lengthIn + 8, 2.2, 0.3, hwTag("ledger flashing", "metal cap flashing", "Cap flashing over the ledger, 4 in. past each end, tucked behind the siding; self-adhered membrane behind the ledger and over its top. No aluminum against copper-treated lumber."));
      // Hold-downs at each end.
      const hdTag = hwTag("hold-down", f.hardware.lateralTies === 4 ? "750-lb tension tie" : "1,500-lb hold-down with ½-in. rod", f.hardware.lateralTies === 4 ? "Four 750-lb tension ties, screwed to the joists and the house framing (IRC R507.9.2)." : "Two 1,500-lb hold-downs within 2 ft of each end of the ledger, a ½-in. rod through to the house's floor joists (IRC R507.9.2).");
      for (const x of [l.x0 + 18, l.x1 - 18]) box("hardware", x + ox, l.y + oy + 6, f.joistBottomIn + f.joistTopIn > 0 ? (f.joistBottomIn + f.joistTopIn) / 2 : 0, 2.5, 9, 3, hdTag);
      callout(((l.x0 + l.x1) / 2 + ox) / 1, l.y + oy, (f.joistTopIn + f.joistBottomIn) / 2, "connection", "Ledger to the house", `${l.fasteners} ${f.design.ledger.fastener === "lag" ? "½-in. lags" : f.design.ledger.fastener.startsWith("bolt") ? "½-in. through-bolts" : "structural screws"} every ${l.spacingIn} in. in two staggered rows, cap flashing over, membrane behind, ${f.hardware.lateralTies} hold-downs to the house. The joists hang on it in hangers.`);
    }
    const joistDepth = f.joistTopIn - f.joistBottomIn;
    const hangerTag = hwTag("joist hanger", `LUS-type ${f.joistSize}`, `Galvanized face-mount hanger, ${joistDepth > 9 ? "ten" : "eight"} 10d nails into the ledger or beam, 10d×1½ into the joist. Hangers at least 60% of the joist's depth (AWC DCA 6).`);
    const tieTag = hwTag("hurricane tie", "H2.5A", "Galvanized tie, joist to beam, five 8d nails each leg — keeps the joists from lifting or rolling (IRC R507.6.2).");
    for (const j of f.joists) {
      if (j.sister) continue;
      const zf = f.zones.find((z) => z.zone.id === j.zoneId);
      if (!zf) continue;
      if (zf.back === "ledger") box("hardware", j.x + ox, zf.zone.y0 + oy + 1.5 + 0.9, f.joistBottomIn + joistDepth * 0.5, 2.4, 1.8, joistDepth * 0.75, hangerTag);
      for (const by of zf.beamYs) {
        const b = f.beams.find((bb) => Math.abs(bb.lineY - by) < 0.6 && bb.zoneIds.includes(j.zoneId));
        if (!b) continue;
        if (b.style === "flush") {
          box("hardware", j.x + ox, b.y + oy - b.spec.thickIn / 2 - 0.9, f.joistBottomIn + joistDepth * 0.5, 2.4, 1.8, joistDepth * 0.75, hangerTag);
          if (b.role === "middle") box("hardware", j.x + ox, b.y + oy + b.spec.thickIn / 2 + 0.9, f.joistBottomIn + joistDepth * 0.5, 2.4, 1.8, joistDepth * 0.75, hangerTag);
        } else box("hardware", j.x + ox + 1.2, b.y + oy, f.joistBottomIn - 0.1, 1.2, 2.5, 3, tieTag);
      }
    }
    if (f.joists.length && f.beams.length) {
      const j0 = f.joists[Math.floor(f.joists.length / 2)];
      const zf = f.zones.find((z) => z.zone.id === j0.zoneId);
      if (zf && zf.back === "ledger") callout(j0.x + ox, zf.zone.y0 + oy + 3, f.joistBottomIn + joistDepth / 2, "connection", "Joist hanger at the ledger", `Each ${f.joistSize} joist sits in a galvanized face-mount hanger nailed to the ledger: ${joistDepth > 9 ? "ten" : "eight"} 10d nails into the ledger, 10d×1½ into the joist.`);
      const b = f.beams[f.beams.length - 1];
      callout(j0.x + ox, b.y + oy, f.joistBottomIn, "connection", b.style === "flush" ? "Joists hung on the flush beam" : "Joists over the beam", b.style === "flush" ? `The joists hang on the ${b.spec.size} beam in hangers; the beam is the deck's rim.` : `The joists bear on the ${b.spec.size} beam and run ${Math.round((zf?.frontCantIn ?? 0) / 12 * 10) / 10} ft past it; an H2.5A tie at every joist, blocking over the beam.`);
    }
    const baseTag = hwTag("post base", `ABU-type ${f.design.framing.post}`, "Galvanized stand-off base on a ½-in. anchor bolt set in the footing; it holds the post 1 in. off the concrete so its end stays dry.");
    const capTag = hwTag("post cap", `BC/PC-type ${f.design.framing.post}`, "Galvanized cap, post to beam, nailed both ways; a three-ply beam needs the wide cap (AWC DCA 6).");
    for (const p of f.posts) {
      const bottom = p.footing.groundIn + p.footing.topIn;
      box("hardware", p.x + ox, p.y + oy, bottom + 0.6, 7, 7, 1.2, baseTag);
      if (!p.roof && p.heightIn >= 1) box("hardware", p.x + ox, p.y + oy, bottom + p.heightIn - 0.5, 6.5, 6.5, 2.2, capTag);
    }
    if (f.posts.length) {
      const p = f.posts.find((pp) => !pp.roof) ?? f.posts[0];
      callout(p.x + ox, p.y + oy, p.footing.groundIn + p.footing.topIn + 2, "connection", "Post on its footing", `${p.size} post on a galvanized stand-off base, ½-in. anchor bolt into a ${p.footing.padIn}-in. footing ${p.footing.depthIn} in. deep (${Math.round(p.tributarySqFt)} sq ft of deck on it).`);
      if (p.heightIn >= 1 && f.beamStyle === "dropped") callout(p.x + ox, p.y + oy, p.footing.groundIn + p.footing.topIn + p.heightIn, "connection", "Beam on the post", `The ${f.beams.find((b) => b.id === p.beamId)?.spec.size ?? "beam"} sits in a galvanized post cap on the ${p.size} post (or in a notch with two ½-in. through-bolts); never bolted to the side of an un-notched post.`);
    }
    if (f.hardware.rimScrews) {
      const rimStick = f.sticks.find((st) => st.role === "rim");
      if (rimStick) callout(rimStick.cx + ox, rimStick.cy + oy, rimStick.cz, "connection", "Rim to the joists", `Three structural screws (#10 × 3 in.) through the rim into every joist end${f.design.framing.doubleRim ? "; the rim doubled on the open sides" : ""}.`);
    }

    // The boards on top.
    const boardZ = f.surfaceIn - surface.product.thickIn / 2;
    const boardTag = tagFor(`${lvl}deck board`, surface.product.nominal, 0, `${surface.product.label}, ${surface.product.gapIn}-in. gaps, ${surface.fastening === "hidden" ? "hidden clips in the grooves" : "two coated screws at every joist"}${surface.pattern !== "straight" ? `, laid ${surface.pattern === "diagonal" ? "on the diagonal" : "in a herringbone"}` : ""}.`);
    const borderTag = tagFor(`${lvl}border board`, surface.product.nominal, 0, "Picture-frame border: mitred 45° at the corners, two screws or plugs at every joist.");
    for (const p of surface.pieces) box("decking", p.cx + ox, p.cy + oy, boardZ, p.sx, p.sy, surface.product.thickIn, p.border ? borderTag : boardTag, 0, p.yaw ?? 0, 0);
    for (const ring of surface.shaped) {
      shapedBoards.push(ring.map((v, i) => r3(v + (i % 2 === 0 ? ox : oy))));
      shapedZs.push(r3(f.surfaceIn));
    }
    if (surface.pattern !== "straight") {
      for (const ring of diagonalBoards(f, surface, ox, oy)) {
        shapedBoards.push(ring);
        shapedZs.push(r3(f.surfaceIn));
      }
    }
    if (surface.fascia.on) {
      const t = 0.75;
      const h = surface.fascia.heightIn;
      const z = f.joistBottomIn + h / 2;
      const fasciaTag = tagFor(`${lvl}fascia`, surface.fascia.kind === "composite" ? "composite 1x" : "wood 1x", 0, "Fascia over the rim, mitred at the corners, screwed every 16 in.");
      const ring = shapeOutline(f.design.shape);
      for (let i = 0; i < ring.length; i++) {
        const A = ring[i];
        const B = ring[(i + 1) % ring.length];
        const house = f.edges.some((e) => e.house && Math.abs((A.x + B.x) / 2 - (e.x0 + e.x1) / 2) < 0.6 && Math.abs((A.y + B.y) / 2 - (e.y0 + e.y1) / 2) < 0.6) || (A.y < 0.5 && B.y < 0.5 && f.design.placement !== "detached") || (level.id === "lower" && A.y < 0.5 && B.y < 0.5);
        if (house) continue;
        const L = Math.hypot(B.x - A.x, B.y - A.y);
        if (L < 1) continue;
        const yaw = Math.atan2(B.y - A.y, B.x - A.x);
        const nx = -Math.sin(yaw);
        const ny = Math.cos(yaw);
        box("fascia", (A.x + B.x) / 2 + ox + nx * (t / 2), (A.y + B.y) / 2 + oy + ny * (t / 2), z, L, t, h, fasciaTag, 0, yaw, 0);
      }
    }
    for (const p of f.posts) footings.push([r3(p.x + ox), r3(p.y + oy), r3(p.footing.padIn), r3(p.footing.padThickIn), r3(p.footing.pierIn), r3(p.footing.depthIn - p.footing.groundIn), r3(p.footing.topIn + p.footing.groundIn)]);
  }

  /* ── The stairs ───────────────────────────────────────────────────── */
  for (const st of s.stairs) {
    const slopeDeg = st.risers ? deg(Math.atan2(st.riserIn, st.runIn)) : "";
    const noteFor = (m: StairMember): string => {
      switch (m.role) {
        case "stringer":
          return `2x12 cut stringer: ${st.risers} risers of ${st.riserIn.toFixed(2)} in. and treads of ${st.runIn} in. sawn out (${slopeDeg} to the ground), a plumb cut at the top, a level cut at the kicker; at least 5 in. of throat left. Hung on a stringer connector at the rim.`;
        case "tread":
          return `Tread of two deck boards, ${st.runIn + 1} in. deep with a 1-in. nosing, two screws into each stringer.`;
        case "riser":
          return "1x8 riser board behind the nosing, screwed to the stringers.";
        case "kicker":
          return "Treated 2x4 kicker across the stringers' feet, two anchors into the pad.";
        case "stair-post":
          return "4x4 post on a base and its own footing, carrying the landing or the mid-flight beam.";
        case "stair-beam":
          return "2x8 beam under the stringers midway: a cut stringer spans 6 ft at most.";
        case "landing-frame":
          return "2x8 landing frame on four posts, 36 in. deep.";
        case "landing-tread":
          return "The landing's boards.";
        case "box-frame":
          return `2x6 box frame, ${st.runIn} in. deep, joists at 16 in., mitred 45° at the corners and double-blocked; the level below carries it.`;
        case "box-tread":
          return "Treads of the deck's boards over the box frame, a 1-in. nosing.";
        case "stair-rail":
          return `2x4 stair rail at ${slopeDeg}, 36 in. above the nosings, on brackets to the posts.`;
        case "stair-rail-post":
          return "4x4 stair rail post bolted to the stringer, two ½-in. carriage bolts.";
        case "stair-baluster":
          return "2x2 baluster, cut plumb top and bottom to the rail's slope, 5 in. on centre.";
        case "pad":
          return `Concrete pad ${st.pad ? `${st.pad.widthIn} × ${st.pad.lengthIn} in., ${st.pad.thickIn} in. thick` : "of pavers on sand"} at the foot of the stairs.`;
        default:
          return m.role;
      }
    };
    for (const m of st.members) box(STAIR_LAYER[m.role], m.cx, m.cy, m.cz, m.sx, m.sy, m.sz, tagFor(m.role.replace(/-/g, " "), m.nominal, m.lengthIn, noteFor(m)), 0, m.yaw, m.tilt);
    for (const ft of st.footings) footings.push([r3(ft.x), r3(ft.y), r3(ft.padIn), r3(ft.padThickIn), r3(ft.pierIn), r3(ft.depthIn - ft.groundIn), r3(ft.topIn + ft.groundIn)]);
    const top = st.members.find((m) => m.role === "stringer");
    if (top && st.kind === "flight") {
      const connTag = tagFor("stringer connector", "LSC-type", 0, "Galvanized stringer connector at the top of each stringer, nailed to the rim; the stringers never hang on screws alone.");
      for (const m of st.members.filter((mm) => mm.role === "stringer")) {
        const dx = Math.cos(m.yaw) * (m.sx / 2) * Math.cos(m.tilt);
        const dy = Math.sin(m.yaw) * (m.sx / 2) * Math.cos(m.tilt);
        const dz = Math.sin(m.tilt) * (m.sx / 2);
        box("hardware", m.cx - dx, m.cy - dy, m.cz - dz + 2, 2, 2.5, 6, connTag);
      }
      callout(top.cx - Math.cos(top.yaw) * (top.sx / 2) * Math.cos(top.tilt), top.cy - Math.sin(top.yaw) * (top.sx / 2) * Math.cos(top.tilt), top.cz - Math.sin(top.tilt) * (top.sx / 2) + 2, "connection", "Stair stringers at the rim", `${st.stringers.count} 2x12 stringers on galvanized stringer connectors at the rim (never on screws alone), cut ${st.risers} × ${st.riserIn.toFixed(2)} in. rise over ${st.runIn} in. run — ${slopeDeg}; a treated kicker at the foot, ${st.pad ? "bolted to the pad" : "on the landing"}.`);
    }
  }

  /* ── The rails ────────────────────────────────────────────────────── */
  const rails = s.rails;
  if (rails.on) {
    const noteFor = (m: RailMember): string => {
      switch (m.role) {
        case "rail-post":
          return rails.system === "wood" ? `4x4 rail post, notched over the rim and bolted through it with two ½-in. carriage bolts and a pair of tension ties into the joist; ${rails.heightIn} in. above the boards.` : `${rails.label} post on its base plate, four structural screws through the deck boards into the rim or a blocked joist.`;
        case "rail-top":
          return rails.system === "wood" ? "2x4 top rail on edge between the posts, on rail brackets or toe-screwed." : `${rails.label} top rail in its brackets.`;
        case "rail-bottom":
          return "Bottom rail 3½ in. above the boards (a 4-in. gap at most).";
        case "rail-cap":
          return "Flat 2x6 drink cap over the posts and the top rail, mitred at the corners.";
        case "baluster":
          return rails.system === "wood" ? "2x2 baluster, 5 in. on centre (a 4-in. gap), two screws each end." : "Picket in the rail's own slots.";
        case "cable":
          return "Stainless cable, 3 in. on centre, tensioned at the end posts so a 4-in. sphere cannot pass.";
        default:
          return m.role;
      }
    };
    for (const m of rails.members) box(RAIL_LAYER[m.role], m.cx, m.cy, m.cz, m.sx, m.sy, m.sz, tagFor(m.role.replace(/-/g, " "), m.nominal, m.lengthIn, noteFor(m)), 0, m.yaw, m.tilt);
    for (const p of rails.panelsOut) poly(p.kind === "glass" ? "glass" : "wall", p.ring, tagFor(p.kind === "glass" ? "glass panel" : "rail panel", p.kind === "glass" ? "tempered glass" : "panel", 0, p.kind === "glass" ? "Tempered glass panel in the rail's channels." : "Solid panel in the rail's frame."));
    const tieTag = tagFor("rail post tie", "DTT1Z pair", 0, "Two tension ties at the base of each rail post, ½-in. through-bolts into the joist and blocking: the 200-lb rail load goes into the frame, not just the rim.");
    for (const m of rails.members.filter((mm) => mm.role === "rail-post")) box("hardware", m.cx, m.cy, m.cz - m.sz / 2 + 4, 3, 3, 6, tieTag);
    const firstPost = rails.members.find((m) => m.role === "rail-post");
    if (firstPost) callout(firstPost.cx, firstPost.cy, firstPost.cz - firstPost.sz / 2 + 6, "connection", "Rail post to the frame", rails.system === "wood" ? "Each 4x4 post is bolted through the rim with two ½-in. carriage bolts and a pair of tension ties into the joist and blocking, so a 200-lb push on the rail goes into the frame." : `Each ${rails.label.toLowerCase()} post sits on its base plate, screwed through the boards into the rim or a blocked joist with the maker's structural screws.`);
  }

  /* ── The roof ─────────────────────────────────────────────────────── */
  let peakIn = heightIn;
  if (roof) {
    const r = roof.roof;
    const pitchDeg = deg(roof.pitchAngle);
    const noteFor = (m: RoofMember): string => {
      switch (m.role) {
        case "rafter":
          return roof.kind === "pergola" ? `${m.nominal} pergola rafter, square-cut, notched over the headers, a hurricane tie each end.` : `${m.nominal} common rafter: plumb cut at the ridge and the tail (${pitchDeg} from vertical), a birdsmouth seat cut over the header (level ${pitchDeg} / plumb ${deg(Math.PI / 2 - roof.pitchAngle)}), ${r.rafterSpacingIn} in. on centre, a hurricane tie at the header${roof.ridge?.kind === "beam" ? ", a hanger at the ridge beam" : ""}.`;
        case "jack":
          return `${m.nominal} jack rafter: the ridge-end cut is a compound cut — plumb ${pitchDeg} and bevelled 45° to lie on the hip; seat cut over the header like a common.`;
        case "fly":
          return `${m.nominal} fly rafter at the rake overhang, on the lookouts; carries the rake board.`;
        case "hip":
          return `${m.nominal} hip rafter, one size deeper than the commons (IRC R802.3): plumb cut at the peak at ${deg(m.tilt)} (the hip's own pitch), a double side bevel where it meets the ridge, backing bevels along its top edges.`;
        case "ridge":
          return roof.ridge?.kind === "beam" ? `${m.nominal} ridge BEAM: the rafters bear on it in hangers; it carries the roof to the king posts or the wall, so the ceiling can stay open.` : `${m.nominal} ridge board, one size deeper than the rafters: the pairs nail through it, the ties take their thrust.`;
        case "king":
          return "4x4 king post under the ridge beam, in a post bracket on the gable-end header.";
        case "tie":
          return roof.kind === "gambrel" ? "2x6 tie across at the gambrel's break, through-bolted to the rafter pair with plywood gussets." : "2x6 rafter tie at the header line, every 4 ft, three 16d nails each end — it takes the rafters' thrust (IRC R802.5.2).";
        case "header":
          return m.nominal.startsWith("LVL") ? `Engineered LVL header post to post: the sawn tables did not reach, so a ${m.nominal.replace("LVL1.75x", "1¾ × ")}-in. ply beam is sized by the usual LVL figures; on post caps, plies bolted.` : `${m.nominal} header (beam) on the posts, in post caps${roof.ring.length > 4 ? `, mitred ${Math.round(180 / roof.ring.length)}° where two meet at a corner post` : ", square-cut"}; the rafters bear on it.`;
        case "roof-ledger":
          return `${m.nominal} roof ledger on the house, two structural screws every 16 in. into the studs or the rim; the rafters hang on it in hangers; step flashing over.`;
        case "roof-post":
          return `${m.nominal} roof post, ${roof.floor === "deck" ? "from its own footing up through the deck" : roof.floor === "slab" ? "on a base anchored to the slab" : "on its footing"}, capped for the header.`;
        case "roof-brace":
          return "4x4 knee brace, 45° cuts both ends, a ½-in. lag each end — holds the roof square.";
        case "purlin":
          return "2x4 purlin across the rafters at 24 in., the metal panels screwed to it.";
        case "slat":
          return `${m.nominal} slat, ${r.slats.spacingIn} in. apart, two screws at every rafter.`;
        case "ring":
          return roof.kind === "dutch-gable" ? "2x6 cap beam where the hips stop; the gablet's studs stand on it." : "2x8 ring beam at the lower tier's top, between the hips.";
        case "tier-post":
          return "4x4 tier post, 2 ft, carrying the upper roof over the open band.";
        case "subfascia":
          return `${m.nominal} sub-fascia across the rafter tails, each tail cut plumb; mitred at the corners.`;
        case "fascia-eave":
          return `${m.nominal} fascia board over the sub-fascia${r.fascia.finish === "aluminum-wrap" ? ", aluminum wrap over it" : ""}, mitred at the corners.`;
        case "fascia-rake":
          return `${m.nominal} rake board on the fly rafter, cut plumb at the ridge (${pitchDeg}) and square at the eave.`;
        case "gutter":
          return `${r.gutters.kind === "k6" ? "6" : "5"}-in. gutter on hidden hangers every ${roof.roofLoad >= 30 ? 18 : 24} in., ⅛ in. per 10 ft of fall to the downspout.`;
        case "downspout":
          return "Downspout to a splash block, three elbows, strapped to the post.";
        case "stud":
          return "2x4 gablet stud at 16 in., cut to the roof's angle at the top.";
        case "kneewall":
          return "2x4 plate for the wall panels between the posts.";
        case "door":
          return "Screen door, hung on a 2x4 jamb.";
        default:
          return m.role;
      }
    };
    for (const m of roof.members) box(ROOF_MEMBER_LAYER[m.role], m.cx, m.cy, m.cz, m.sx, m.sy, m.sz, tagFor(m.role.replace(/-/g, " "), m.nominal, m.lengthIn, noteFor(m)), 0, m.yaw, m.tilt);
    for (const p of roof.planes) poly(ROOF_PLANE_LAYER[p.kind], p.ring, tagFor(p.kind, p.kind === "roofing" ? ROOFING_LABEL[r.roofing] : p.kind === "sheathing" ? "½-in. sheathing" : p.kind === "ceiling" ? "ceiling boards" : p.kind === "soffit" ? "vented soffit" : p.kind === "slab" ? "4-in. concrete" : p.kind === "screen" ? "screen" : p.kind === "louver" ? "louver blade" : "wall panel", 0, p.kind === "roofing" ? `${ROOFING_LABEL[r.roofing]} over synthetic underlayment, drip edge at the eaves and rakes.` : p.kind === "sheathing" ? "½-in. sheathing, H-clips between the rafters, 8d nails at 6 in. edges / 12 in. field." : p.kind === "ceiling" ? "Ceiling boards nailed to the undersides of the rafters." : p.kind === "soffit" ? "Vented soffit panels in J-channel under the eaves." : p.kind === "slab" ? "4-in. slab on a gravel base with wire mesh." : p.kind === "screen" ? "Fiberglass screen in a spline-framed panel." : p.kind === "louver" ? "Aluminum louver blade on a pivot bar; the set turns together." : p.kind === "wall" ? "Framed panel between the posts." : p.kind));
    // Hardware: hurricane ties at every rafter over the header, caps on the posts, hangers at the ridge beam, step flashing on the house.
    const hTie = tagFor("hurricane tie", "H2.5A", 0, "Galvanized tie, rafter to header, five 8d nails each leg — against wind uplift (IRC R802.11).");
    for (const m of roof.members.filter((mm) => mm.role === "rafter" || mm.role === "jack")) {
      // The seat sits over the header, one overhang in from the tail.
      const t = Math.min(0.9, (r.overhangIn + 2) / Math.max(1, m.sx * Math.cos(m.tilt)));
      const x = m.x0 + (m.x1 - m.x0) * t;
      const y = m.y0 + (m.y1 - m.y0) * t;
      box("hardware", x, y, roof.headerTopIn + 1.5, 1.5, 2.5, 3, hTie);
    }
    const rcap = tagFor("post cap", `${r.post} cap`, 0, "Galvanized post cap, header to post, nailed both ways.");
    for (const p of roof.posts) box("hardware", p.x, p.y, p.topIn - 0.6, 6, 6, 2, rcap);
    if (roof.ledger) {
      const led = roof.members.find((m) => m.role === "roof-ledger");
      if (led) {
        box("hardware", led.cx, led.cy + 0.8, led.cz + led.sz / 2 + 0.2, led.sx + 6, 2, 0.3, tagFor("step flashing", "metal", 0, "Step and counter flashing where the roof meets the siding: the siding cut back, flashing up the wall 2 in. and out over the roofing."));
        const scr = tagFor("roof ledger screw", "SDWS-type", 0, "Two structural screws every 16 in., into the studs or the rim behind the siding.");
        for (let x = led.x0 + 8; x < led.x1 - 4; x += 16) {
          box("hardware", x, led.cy + 0.9, led.cz + 2.5, 1, 0.8, 1, scr);
          box("hardware", x + 2, led.cy + 0.9, led.cz - 2.5, 1, 0.8, 1, scr);
        }
        callout(led.cx, led.cy, led.cz, "connection", "Roof ledger on the house", `${roof.ledger.nominal} ledger, ${roof.ledger.fasteners} structural screws (two every 16 in.) into the house framing; the rafters hang on it in hangers; step flashing tucked under the siding above.`);
      }
    }
    if (roof.headers[0] && roof.posts[0]) {
      const h = roof.headers[0];
      callout(h.x0 + (h.x1 - h.x0) * 0.5, h.y0 + (h.y1 - h.y0) * 0.5, roof.headerTopIn + 1, "connection", "Rafters on the header", `Each rafter is seat-cut over the ${h.spec.size} header and held with a hurricane tie (five 8d nails a leg); the header sits in post caps on the ${r.post} posts${roof.hardware.braces ? ", knee braces at the posts" : ""}.`);
    }
    if (roof.ridge) {
      const rm = roof.members.find((m) => m.role === "ridge");
      if (rm) callout(rm.cx, rm.cy, rm.cz, "connection", roof.ridge.kind === "beam" ? "Rafters on the ridge beam" : "Rafters at the ridge board", roof.ridge.kind === "beam" ? `The rafters bear on the ${roof.ridge.spec?.size ?? roof.ridge.nominal} ridge beam in hangers; the beam rests ${roof.kingPosts ? `on ${roof.kingPosts === 2 ? "two 4x4 king posts in post brackets on the gable-end headers" : "a 4x4 king post and a bracket on the house wall"}` : "on the hips' meeting points"}.` : `Each rafter pair meets through the ${roof.ridge.nominal} ridge board, nailed 16d; ${roof.ties ? `${roof.ties} 2x6 ties at the header line take the thrust` : "the hips take the thrust to the corners"}.`);
    }
    peakIn = Math.max(peakIn, roof.peakIn);
    const xs = roof.eaveRing.map((p) => p.x);
    const ys = roof.eaveRing.map((p) => p.y);
    width = Math.max(width, Math.max(...xs));
    depth = Math.max(depth, Math.max(...ys));
    if (!frame) heightIn = roof.floorIn;
    for (const p of roof.posts) if (p.footing) footings.push([r3(p.x), r3(p.y), r3(p.footing.padIn), r3(p.footing.padThickIn), r3(p.footing.pierIn), r3(p.footing.depthIn - p.footing.groundIn), r3(p.footing.topIn + p.footing.groundIn)]);
  }

  /* ── The electrical ───────────────────────────────────────────────── */
  const el = s.electrical;
  if (el.on) {
    for (const fx of el.fixtures) {
      const note = `${fx.label}${fx.supply === "client" ? " — the client's own, shown as a sample, to be determined" : ""}: ${fx.lv ? "low voltage, 16/2 from the transformer" : fx.kind === "heater" ? `hard-wired on its own ${fx.volts240 ? "30-A two-pole" : "20-A"} circuit, weatherproof box` : "on a 20-A GFCI circuit, weatherproof box with an in-use cover"}${fx.placed ? ", placed by hand" : ""}.`;
      box("light", fx.x, fx.y, fx.z, fx.sx, fx.sy, fx.sz, tagFor(fx.supply === "client" ? `${fx.kind.replace(/-/g, " ")} (client's)` : fx.kind.replace(/-/g, " "), fx.kind === "led-strip" ? `${Math.round(fx.runFt)} ft strip` : fx.kind === "heater" ? (fx.volts240 ? "4 kW 240 V" : "1.5 kW 120 V") : "fixture", 0, note), 0, fx.yaw, 0);
      if (glows.length < SCENE_MAX_GLOWS) glows.push([r3(fx.x), r3(fx.y), r3(fx.z), parseInt(fx.glow.slice(1), 16), fx.supply === "client" ? 1 : 0]);
    }
    const wireTag = (k: string) => tagFor("wire", k, 0, k === "lv" ? "16/2 low-voltage wire, stapled along the frame to each fixture." : `${k} UF-B wire in conduit along the frame, into a weatherproof box at each device.`);
    for (const w of el.wires) {
      for (let i = 0; i + 1 < w.path.length; i++) {
        const [ax, ay, az] = w.path[i];
        const [bx, by, bz] = w.path[i + 1];
        const L = Math.hypot(bx - ax, by - ay, bz - az);
        if (L < 1) continue;
        const yaw = Math.atan2(by - ay, bx - ax);
        const tilt = Math.atan2(bz - az, Math.hypot(bx - ax, by - ay));
        box("wire", (ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, L, w.kind === "lv" ? 0.4 : 0.9, w.kind === "lv" ? 0.4 : 0.9, wireTag(w.kind), 0, Math.abs(bx - ax) + Math.abs(by - ay) < 0.01 ? 0 : yaw, Math.abs(bx - ax) + Math.abs(by - ay) < 0.01 ? Math.PI / 2 : tilt);
      }
    }
    box("light", el.feedAt[0], el.feedAt[1] + 2, el.feedAt[2], 6, 3.5, 8, tagFor("feed", "panel feed", 0, `The feed from the house's panel, ${el.feedFt} ft; ${el.circuits.length} ${el.circuits.length === 1 ? "circuit" : "circuits"} in a weatherproof junction box here.`));
    callout(el.feedAt[0], el.feedAt[1], el.feedAt[2], "connection", "Feed from the panel", `${el.circuits.map((c) => `${c.amps}-A ${c.kind === "lights-outlets" ? "GFCI circuit" : "heater circuit"}`).join(", ")} from the house's panel, ${el.feedFt} ft; ${el.trenchFt ? `${el.trenchFt} ft underground in conduit; ` : ""}weatherproof boxes with in-use covers at every device.`);
    if (el.transformerAt) box("light", el.transformerAt[0], el.transformerAt[1], el.transformerAt[2], 7, 4, 10, tagFor("transformer", "150 W, 12 V", 0, `Low-voltage transformer with a timer and photocell, plugged into a GFCI receptacle, feeding ${el.lv?.watts ?? 0} W of lights.`));
  }

  /* ── The house ────────────────────────────────────────────────────── */
  let house: DeckScene["house"] = null;
  const onWall = frame ? design.placement !== "detached" : roof?.attach === "wall";
  if (onWall) {
    const margin = 48;
    const blocks: number[][] = [[r3(-margin), r3(-144), r3(width + margin), 0]];
    if (frame && design.shape.kind === "L" && design.shape.notch.corner.startsWith("back")) {
      const b = frame.zones[1].zone;
      const left = design.shape.notch.corner.endsWith("left");
      blocks.push([r3(left ? -margin : b.x0), 0, r3(left ? b.x1 : width + margin), r3(b.y0)]);
    }
    const main = frame ? frame.edges.filter((e) => e.house && e.side === "back" && Math.abs(e.y0) < 0.01).sort((a, b) => b.lengthIn - a.lengthIn)[0] : { x0: 0, x1: width, lengthIn: width };
    const doorWidth = main && main.lengthIn >= 120 ? 72 : 36;
    const door = main && main.lengthIn >= doorWidth + 24 ? [r3((main.x0 + main.x1) / 2), r3(doorWidth), r3(80)] : null;
    const wallTop = Math.max(heightIn + 108, peakIn + 30);
    house = { blocks, heightFt: Math.max(10, r3(wallTop)), door };
  }

  const outline = frame ? shapeOutline(design.shape).flatMap((p) => [r3(p.x), r3(p.y)]) : (roof?.ring ?? []).flatMap((p) => [r3(p.x), r3(p.y)]);
  const height = heightIn >= 24 ? `${Math.floor(heightIn / 12)} ft${heightIn % 12 ? ` ${Math.round(heightIn % 12)} in.` : ""}` : `${heightIn} in.`;
  const factParts = [structureWords(design)];
  if (frame) factParts.push(`${Math.round(levels.reduce((a, l) => a + l.frame.areaSqFt, 0))} sq ft`, `${height} high`, frame.decking.label);
  if (roof) {
    if (roof.kind === "pergola") factParts.push(`${roof.rafters.size} rafters, ${roof.louvers ? "louvers" : `${design.roof.slats.size} slats`}`);
    else factParts.push(`${roof.kind === "double-tier" ? "double-tier" : roof.kind === "dutch-gable" ? "Dutch gable" : roof.kind} roof ${design.roof.pitch}:12`, ROOFING_LABEL[design.roof.roofing].toLowerCase());
  }
  if (s.stairs.length) factParts.push(`${s.stairs.length === 1 ? "stairs" : `${s.stairs.length} stairs`}`);
  if (rails.on) factParts.push(railWords(rails).split(",")[0].toLowerCase());
  if (el.on) factParts.push(electricalWords(el).split(" · ")[0]);
  const deckColor = s.surface?.product.color ?? "#a58a5c";
  const frameC = frameColor(design.framing.species, frame?.group ?? roof?.group ?? "SP");
  const colors = { frame: frameC, decking: deckColor, fascia: deckColor, roofing: roofingColor(design.roof.roofing), rail: railColor(design.rail.type, deckColor, frameC) };
  const slope = design.site.slope;
  const ground = slope.outDropIn || slope.acrossDropIn ? { outDropFt: r3(slope.outDropIn), acrossDropFt: r3(slope.acrossDropIn) } : null;
  // The handles (edit mode): the deck's width, depth and height at its front-right corner, the roof's eave, each stair along its edge, the lower level's depth.
  const handles: SceneHandle[] = [];
  if (frame) {
    const Wd = Math.max(...frame.zones.map((z) => z.zone.x1));
    const Dd = Math.max(...frame.zones.map((z) => z.zone.y1));
    handles.push({ kind: "width", id: "width", x: r3(Wd), y: r3(Dd / 2), z: r3(frame.surfaceIn + 1), axis: "x", value: design.shape.widthFt, perUnit: 1, label: "Width along the house" });
    handles.push({ kind: "depth", id: "depth", x: r3(Wd / 2), y: r3(Dd), z: r3(frame.surfaceIn + 1), axis: "y", value: design.shape.depthFt, perUnit: 1, label: "Depth out from the house" });
    handles.push({ kind: "height", id: "height", x: r3(Wd), y: r3(Dd), z: r3(frame.surfaceIn), axis: "z", value: design.heightIn, perUnit: 1 / 12, label: "Deck height" });
    if (s.lower) handles.push({ kind: "lower-depth", id: "lower-depth", x: r3(s.lower.offsetXIn + (design.lower.widthFt * 12) / 2), y: r3(s.lower.offsetYIn + design.lower.depthFt * 12), z: r3(s.lower.frame.surfaceIn + 1), axis: "y", value: design.lower.depthFt, perUnit: 1, label: "Lower level depth" });
  }
  if (roof) {
    const corner = roof.posts.find((p) => p.corner) ?? roof.posts[0];
    if (corner) handles.push({ kind: "eave", id: "eave", x: r3(corner.x), y: r3(corner.y), z: r3(roof.headerBottomIn), axis: "z", value: design.roof.eaveHeightIn, perUnit: 1 / 12, label: "Height to the headers" });
    if (!frame) {
      const xs = roof.ring.map((p) => p.x);
      const ys = roof.ring.map((p) => p.y);
      handles.push({ kind: "roof-width", id: "roof-width", x: r3(Math.max(...xs)), y: r3((Math.min(...ys) + Math.max(...ys)) / 2), z: r3(roof.floorIn + 1), axis: "x", value: design.roof.plan.shape === "hexagon" || design.roof.plan.shape === "octagon" || design.roof.plan.shape === "round" ? design.roof.plan.acrossFt : design.roof.plan.widthFt, perUnit: 1, label: "Roof width" });
      if (design.roof.plan.shape === "rect") handles.push({ kind: "roof-depth", id: "roof-depth", x: r3((Math.min(...xs) + Math.max(...xs)) / 2), y: r3(Math.max(...ys)), z: r3(roof.floorIn + 1), axis: "y", value: design.roof.plan.depthFt, perUnit: 1, label: "Roof depth" });
    }
  }
  for (const st of s.stairs) {
    const [a, b] = st.footprint;
    if (!a || !b) continue;
    handles.push({ kind: "stair", id: st.design.id, x: r3((a.x + b.x) / 2), y: r3((a.y + b.y) / 2), z: r3((st.level === "lower" && s.lower ? s.lower.frame.surfaceIn : frame?.surfaceIn ?? 0) + 2), axis: st.design.side === "front" ? "x" : "y", value: st.design.atFt, perUnit: 1, label: `Stairs along the ${st.design.side}` });
  }
  return {
    v: DECK_SCENE_VERSION,
    widthFt: r3(Math.max(width, 48)),
    depthFt: r3(Math.max(depth, 48)),
    heightFt: r3(heightIn),
    peakFt: r3(peakIn),
    boxes,
    tags,
    legend,
    callouts,
    footings: footings.slice(0, SCENE_MAX_FOOTINGS),
    diagonal: shapedBoards.length ? { thickFt: r3(s.surface?.product.thickIn ?? 1), boards: shapedBoards.slice(0, SCENE_MAX_DIAGONALS), zs: shapedZs.slice(0, SCENE_MAX_DIAGONALS) } : null,
    polys,
    polyTags,
    outline,
    house,
    ground,
    glows,
    handles,
    colors,
    facts: factParts.join(" · "),
  };
}

/** The words the figure's caption uses when there is no deck under it. */
export const sceneSizeWords = sizeWords;
export const sceneHasDeck = hasDeck;

/* ------------------------------------------------------------------ */
/*  Reading a stored scene back                                        */
/* ------------------------------------------------------------------ */

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const HEX = /^#[0-9a-f]{6}$/i;
const inside = (n: number, min: number, max: number) => n >= min && n <= max;
/** Nothing in a deck scene is farther than this from its origin, ft. */
const REACH = 400;
/** Version 1 knew only the first ten layers, version 2 the first twenty. */
const V1_LAYERS = 10;
const V2_LAYERS = 20;

const numbers = (raw: unknown, length: number, min = -REACH, max = REACH): number[] | null => {
  if (!Array.isArray(raw) || raw.length !== length) return null;
  const out: number[] = [];
  for (const v of raw) {
    if (!fin(v) || !inside(v, min, max)) return null;
    out.push(v);
  }
  return out;
};

/** A stored scene, read back defensively: a bad shape is no scene, never a crash. Reads versions 1, 2 and 3. */
export function parseDeckScene(raw: unknown): DeckScene | null {
  const r = (raw && typeof raw === "object" ? raw : null) as Record<string, unknown> | null;
  if (!r || (r.v !== 1 && r.v !== 2 && r.v !== DECK_SCENE_VERSION)) return null;
  const v = r.v as 1 | 2 | 3;
  const maxLayer = (v === 1 ? V1_LAYERS : v === 2 ? V2_LAYERS : SCENE_LAYERS.length) - 1;
  if (!fin(r.widthFt) || !fin(r.depthFt) || !fin(r.heightFt)) return null;
  if (!inside(r.widthFt, 1, REACH) || !inside(r.depthFt, 1, REACH) || !inside(r.heightFt, 0, 60)) return null;
  const peakFt = fin(r.peakFt) && inside(r.peakFt, 0, 120) ? r.peakFt : r.heightFt;
  if (!Array.isArray(r.boxes) || r.boxes.length > SCENE_MAX_BOXES) return null;
  const boxes: number[][] = [];
  for (const b of r.boxes) {
    const long = Array.isArray(b) && b.length === 10 && v !== 1;
    const n = numbers(b, long ? 10 : 8);
    if (!n || !Number.isInteger(n[0]) || !inside(n[0], 0, maxLayer) || !Number.isInteger(n[7]) || !inside(n[7], 0, 4)) return null;
    if (n[4] <= 0 || n[5] <= 0 || n[6] <= 0) return null;
    if (long && (!inside(n[8], -7, 7) || !inside(n[9], -1.6, 1.6))) return null;
    boxes.push(n);
  }
  if (!Array.isArray(r.footings) || r.footings.length > SCENE_MAX_FOOTINGS) return null;
  const footings: number[][] = [];
  for (const f of r.footings) {
    const n = numbers(f, 7);
    if (!n || n[2] <= 0 || n[4] <= 0) return null;
    footings.push(n);
  }
  let diagonal: DeckScene["diagonal"] = null;
  const d = (r.diagonal && typeof r.diagonal === "object" ? r.diagonal : null) as Record<string, unknown> | null;
  if (d) {
    if (!fin(d.thickFt) || !inside(d.thickFt, 0.01, 1) || !Array.isArray(d.boards) || d.boards.length > SCENE_MAX_DIAGONALS) return null;
    const boards: number[][] = [];
    for (const ring of d.boards) {
      if (!Array.isArray(ring) || ring.length < 6 || ring.length > 40 || ring.length % 2 !== 0) return null;
      const n = numbers(ring, ring.length);
      if (!n) return null;
      boards.push(n);
    }
    const zs = Array.isArray(d.zs) && d.zs.length === boards.length ? numbers(d.zs, boards.length, -10, 120) ?? undefined : undefined;
    diagonal = { thickFt: d.thickFt, boards, zs };
  }
  const polys: number[][] = [];
  if (v !== 1) {
    if (r.polys !== undefined && (!Array.isArray(r.polys) || r.polys.length > SCENE_MAX_POLYS)) return null;
    for (const p of (r.polys as unknown[]) ?? []) {
      if (!Array.isArray(p) || p.length < 10 || p.length > 1 + 3 * 16 || (p.length - 1) % 3 !== 0) return null;
      const n = numbers(p, p.length);
      if (!n || !Number.isInteger(n[0]) || !inside(n[0], 0, maxLayer)) return null;
      polys.push(n);
    }
  }
  const outline = Array.isArray(r.outline) && r.outline.length >= 6 && r.outline.length <= 40 && r.outline.length % 2 === 0 ? numbers(r.outline, r.outline.length) : null;
  if (!outline) return null;
  let house: DeckScene["house"] = null;
  const h = (r.house && typeof r.house === "object" ? r.house : null) as Record<string, unknown> | null;
  if (h) {
    if (!fin(h.heightFt) || !inside(h.heightFt, 1, 120) || !Array.isArray(h.blocks) || h.blocks.length > 4) return null;
    const blocks: number[][] = [];
    for (const b of h.blocks) {
      const n = numbers(b, 4);
      if (!n) return null;
      blocks.push(n);
    }
    const door = h.door === null || h.door === undefined ? null : numbers(h.door, 3);
    if (h.door !== null && h.door !== undefined && !door) return null;
    house = { blocks, heightFt: h.heightFt, door };
  }
  // Version 3: the legend, the tags, the callouts, the ground, the glows. Anything malformed is dropped, not fatal.
  let legend: SceneLegend[] = [];
  let tags: number[] = [];
  let polyTags: number[] = [];
  let callouts: number[][] = [];
  let glows: number[][] = [];
  let ground: DeckScene["ground"] = null;
  const handles: SceneHandle[] = [];
  if (v === 3) {
    if (Array.isArray(r.legend) && r.legend.length <= SCENE_MAX_LEGEND) {
      for (const e of r.legend) {
        const o = (e && typeof e === "object" ? e : null) as Record<string, unknown> | null;
        if (!o || typeof o.role !== "string" || typeof o.nominal !== "string" || typeof o.note !== "string" || !fin(o.lengthFt) || !fin(o.count)) {
          legend = [];
          break;
        }
        legend.push({ role: o.role.slice(0, 60), nominal: o.nominal.slice(0, 60), lengthFt: o.lengthFt, count: o.count, note: o.note.slice(0, 240) });
      }
    }
    if (Array.isArray(r.tags) && r.tags.length === boxes.length && r.tags.every((t) => Number.isInteger(t) && (t as number) >= -1 && (t as number) < legend.length)) tags = r.tags as number[];
    if (Array.isArray(r.polyTags) && r.polyTags.length === polys.length && r.polyTags.every((t) => Number.isInteger(t) && (t as number) >= -1 && (t as number) < legend.length)) polyTags = r.polyTags as number[];
    if (Array.isArray(r.callouts) && r.callouts.length <= SCENE_MAX_CALLOUTS) {
      for (const c of r.callouts) {
        const n = numbers(c, 4);
        if (!n || !Number.isInteger(n[3]) || n[3] < 0 || n[3] >= legend.length) {
          callouts = [];
          break;
        }
        callouts.push(n);
      }
    }
    if (Array.isArray(r.glows) && r.glows.length <= SCENE_MAX_GLOWS) {
      for (const g of r.glows) {
        const n = numbers(g, 5, -REACH, 16777215);
        if (!n) {
          glows = [];
          break;
        }
        glows.push(n);
      }
    }
    const gr = (r.ground && typeof r.ground === "object" ? r.ground : null) as Record<string, unknown> | null;
    if (gr && fin(gr.outDropFt) && fin(gr.acrossDropFt) && inside(gr.outDropFt, -10, 10) && inside(gr.acrossDropFt, -10, 10)) ground = { outDropFt: gr.outDropFt, acrossDropFt: gr.acrossDropFt };
    if (Array.isArray(r.handles) && r.handles.length <= 40) {
      for (const h of r.handles) {
        const o = (h && typeof h === "object" ? h : null) as Record<string, unknown> | null;
        if (!o || typeof o.kind !== "string" || typeof o.id !== "string" || !fin(o.x) || !fin(o.y) || !fin(o.z) || !fin(o.value) || !fin(o.perUnit) || (o.axis !== "x" && o.axis !== "y" && o.axis !== "z")) continue;
        handles.push({ kind: o.kind as SceneHandle["kind"], id: o.id.slice(0, 20), x: o.x, y: o.y, z: o.z, axis: o.axis, value: o.value, perUnit: o.perUnit, label: typeof o.label === "string" ? o.label.slice(0, 60) : "" });
      }
    }
  }
  const c = (r.colors && typeof r.colors === "object" ? r.colors : {}) as Record<string, unknown>;
  const color = (x: unknown, fallback: string) => (typeof x === "string" && HEX.test(x) ? x : fallback);
  return {
    v: DECK_SCENE_VERSION,
    widthFt: r.widthFt,
    depthFt: r.depthFt,
    heightFt: r.heightFt,
    peakFt,
    boxes,
    tags,
    legend,
    callouts,
    footings,
    diagonal,
    polys,
    polyTags,
    outline,
    house,
    ground,
    glows,
    handles,
    colors: { frame: color(c.frame, "#9d8c62"), decking: color(c.decking, "#a58a5c"), fascia: color(c.fascia, "#a58a5c"), roofing: color(c.roofing, "#565250"), rail: color(c.rail, "#9d8c62") },
    facts: typeof r.facts === "string" ? r.facts.slice(0, 200) : "",
  };
}
