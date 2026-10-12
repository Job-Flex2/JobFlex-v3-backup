// THE HOUSE THE DECK STANDS AGAINST (2026-10-11; owner: "let's not use the
// picture at all — use the 3D model and draw the house; make it look like a
// house, not a shed; one or two storeys; a tool to adjust the 3D home — jogs,
// move the walls left and right; start from the shape of the back wall where
// the deck will be attached, then set the deck in; make it smart"). Pure.
//
// The house is the deck's: its back wall runs along the house line, past the
// deck's two ends by `leftFt` and `rightFt`; it steps where the contractor
// says (a jog: to the RIGHT of `atFt` the wall comes `depthFt` toward the
// yard, or steps back), measured in the deck's feet from its left end, so
// the deck's own knobs never move them. The part of the wall under the deck's
// main back edge is the house line; a bump-out at the deck's end notches the
// deck around it on its own, and a step the deck cannot frame around is said
// in a note instead of being drawn wrong.
import type { DeckShape } from "./design";

export type HouseRoof = "hip" | "gable";
export const HOUSE_ROOFS: readonly HouseRoof[] = ["hip", "gable"];
export const HOUSE_ROOF_LABEL: Record<HouseRoof, string> = { hip: "Hip", gable: "Gable" };
export type JogDir = "toward" | "away";
export interface HouseJog {
  id: string;
  /** Along the house, in the deck's feet from its left end (negative past the left end, past `widthFt` beyond the right). */
  atFt: number;
  /** What the wall to the RIGHT of the step does: comes toward the yard, or steps back. */
  dir: JogDir;
  depthFt: number;
}
export interface HouseDesign {
  storeys: 1 | 2;
  roof: HouseRoof;
  /** How far the back wall runs past the deck's left and right ends, ft. */
  leftFt: number;
  rightFt: number;
  jogs: HouseJog[];
  /** The look (2026-10-11, "the client would say: this is my house"): the siding's colour and the roof's. */
  siding: SidingId;
  roofColour: RoofColourId;
}

export type SidingId = "white" | "cream" | "grey" | "blue" | "sage";
export type RoofColourId = "charcoal" | "brown" | "slate" | "forest" | "terracotta";
export const SIDINGS: ReadonlyArray<{ id: SidingId; label: string; hex: string }> = [
  { id: "white", label: "White", hex: "#f2f0ea" },
  { id: "cream", label: "Cream", hex: "#e9e5db" },
  { id: "grey", label: "Grey", hex: "#b7babb" },
  { id: "blue", label: "Blue-grey", hex: "#8ea3b1" },
  { id: "sage", label: "Sage", hex: "#a7b39b" },
];
export const ROOF_COLOURS: ReadonlyArray<{ id: RoofColourId; label: string; hex: string }> = [
  { id: "charcoal", label: "Charcoal", hex: "#55524c" },
  { id: "brown", label: "Brown", hex: "#5b4a3b" },
  { id: "slate", label: "Slate", hex: "#6b7280" },
  { id: "forest", label: "Forest", hex: "#4a5e4f" },
  { id: "terracotta", label: "Terracotta", hex: "#9a5a44" },
];
export const sidingHex = (id: SidingId) => SIDINGS.find((c) => c.id === id)?.hex ?? SIDINGS[1].hex;
export const roofHex = (id: RoofColourId) => ROOF_COLOURS.find((c) => c.id === id)?.hex ?? ROOF_COLOURS[0].hex;

/** A step shallower than half a foot is no step: it is dropped, which is how a wall dragged level loses its step. */
export const HOUSE_LIMITS = { extendFt: { min: 0, max: 60 }, depthFt: { min: 0.5, max: 12 }, jogs: 4 } as const;
/** Floor to floor. */
export const STOREY_FT = 9.5;
/** How deep the house is drawn behind its back wall. */
export const HOUSE_BODY_FT = 24;
/** The notch a bump-out makes: never narrower than this, never deeper than the deck less this. */
const NOTCH_MIN_FT = 2;
const NOTCH_KEEP_FT = 3;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const half = (n: number) => Math.round(n * 2) / 2;
const r2 = (n: number) => Math.round(n * 100) / 100;
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export function defaultHouse(): HouseDesign {
  return { storeys: 1, roof: "hip", leftFt: 4, rightFt: 4, jogs: [], siding: "cream", roofColour: "charcoal" };
}

/** The design read back: numbers held to their limits, the steps sorted and kept inside the wall, a back notch of the shape given its step. */
export function normalizeHouse(raw: unknown, shape: DeckShape): HouseDesign {
  const d = defaultHouse();
  const r = obj(raw);
  const storeys: 1 | 2 = r.storeys === 2 ? 2 : 1;
  const roof: HouseRoof = r.roof === "gable" ? "gable" : "hip";
  const leftFt = half(clamp(num(r.leftFt, d.leftFt), HOUSE_LIMITS.extendFt.min, HOUSE_LIMITS.extendFt.max));
  const rightFt = half(clamp(num(r.rightFt, d.rightFt), HOUSE_LIMITS.extendFt.min, HOUSE_LIMITS.extendFt.max));
  const W = shape.widthFt;
  const seen = new Set<string>();
  const jogs: HouseJog[] = (Array.isArray(r.jogs) ? r.jogs : [])
    .map((j, i) => {
      const o = obj(j);
      const id = typeof o.id === "string" && o.id && !seen.has(o.id) ? o.id : `j${i + 1}`;
      seen.add(id);
      return { id, atFt: half(num(o.atFt, 0)), dir: (o.dir === "away" ? "away" : "toward") as JogDir, depthFt: half(clamp(num(o.depthFt, 2), 0, HOUSE_LIMITS.depthFt.max)) };
    })
    .filter((j) => j.depthFt >= HOUSE_LIMITS.depthFt.min && j.atFt > -leftFt + 0.5 && j.atFt < W + rightFt - 0.5)
    .sort((a, b) => a.atFt - b.atFt)
    .slice(0, HOUSE_LIMITS.jogs);
  // Two steps on one spot: the second is dropped.
  const spaced = jogs.filter((j, i) => i === 0 || j.atFt - jogs[i - 1].atFt >= 1);
  const siding = SIDINGS.some((c) => c.id === r.siding) ? (r.siding as SidingId) : d.siding;
  const roofColour = ROOF_COLOURS.some((c) => c.id === r.roofColour) ? (r.roofColour as RoofColourId) : d.roofColour;
  // The steps are kept exactly as given: the read-back never adds one for a back notch (the studio does that once, when
  // a design opens) and never drops one (a step just removed must stay removed, so the deck can go back to a rectangle).
  return { storeys, roof, leftFt, rightFt, jogs: spaced, siding, roofColour };
}

/** One part of the back wall between two steps, in the deck's feet; `depthFt` is how far it stands toward the yard against the house line (the part under the deck's main back edge). */
export interface WallPart {
  x0: number;
  x1: number;
  depthFt: number;
}

/** The deck's main back edge along the house, in the deck's feet: a back notch takes its corner off it. */
export function mainSpan(shape: DeckShape): { x0: number; x1: number } {
  const W = shape.widthFt;
  if (shape.kind === "L" && shape.notch.corner === "back-right") return { x0: 0, x1: W - shape.notch.widthFt };
  if (shape.kind === "L" && shape.notch.corner === "back-left") return { x0: shape.notch.widthFt, x1: W };
  return { x0: 0, x1: W };
}
/** The middle of that edge. */
export function referenceX(shape: DeckShape): number {
  const m = mainSpan(shape);
  return (m.x0 + m.x1) / 2;
}
/** Which part of the wall the deck's main back edge mostly runs along — the house line. */
export function referencePartIndex(parts: ReadonlyArray<{ x0: number; x1: number }>, shape: DeckShape): number {
  const m = mainSpan(shape);
  let best = 0;
  let most = -Infinity;
  parts.forEach((p, i) => {
    const overlap = Math.min(p.x1, m.x1) - Math.max(p.x0, m.x0);
    if (overlap > most) {
      most = overlap;
      best = i;
    }
  });
  return best;
}
function referencePart<T extends { x0: number; x1: number }>(parts: T[], shape: DeckShape): T {
  return parts[referencePartIndex(parts, shape)];
}

/** The back wall as parts, left to right, each at its depth against the house line. */
export function wallParts(house: HouseDesign, shape: DeckShape): WallPart[] {
  const W = shape.widthFt;
  const xs = [-house.leftFt, ...house.jogs.map((j) => j.atFt), W + house.rightFt];
  const depths = [0];
  for (const j of house.jogs) depths.push(depths[depths.length - 1] + (j.dir === "toward" ? j.depthFt : -j.depthFt));
  const parts: WallPart[] = [];
  for (let i = 0; i + 1 < xs.length; i++) parts.push({ x0: xs[i], x1: xs[i + 1], depthFt: depths[i] });
  const base = referencePart(parts, shape).depthFt;
  return parts.map((p) => ({ x0: r2(p.x0), x1: r2(p.x1), depthFt: r2(p.depthFt - base) }));
}

/** The parts the deck's back edge runs along, clipped to its span. */
function partsUnderDeck(parts: WallPart[], W: number): WallPart[] {
  return parts.map((p) => ({ x0: Math.max(p.x0, 0), x1: Math.min(p.x1, W), depthFt: p.depthFt })).filter((p) => p.x1 - p.x0 > 0.5);
}

const ftWords = (n: number) => `${Math.round(n * 2) / 2} ft`;

/**
 * The deck's shape made to fit the wall: a bump-out that takes one END of
 * the deck's back edge becomes a back notch of that size; no bump-out under
 * the deck takes a back notch away; anything else (a bump-out in the middle,
 * two of them, a part that steps back under the deck) leaves the shape and
 * says why in a note, so the contractor can move the step or the deck.
 */
export function deckShapeForHouse(shape: DeckShape, house: HouseDesign): { shape: DeckShape; note: string | null } {
  const W = shape.widthFt;
  const D = shape.depthFt;
  const under = partsUnderDeck(wallParts(house, shape), W);
  const out = under.filter((p) => p.depthFt > 0.5);
  const back = under.filter((p) => p.depthFt < -0.5);
  const hasBackNotch = shape.kind === "L" && shape.notch.corner.startsWith("back");
  const rect = (): DeckShape => (hasBackNotch ? { kind: "rect", widthFt: W, depthFt: D } : shape);
  if (!out.length && !back.length) return { shape: rect(), note: null };
  if (back.length) {
    const b = back[0];
    return { shape, note: `The wall steps back ${ftWords(-b.depthFt)} under the deck between ${ftWords(b.x0)} and ${ftWords(b.x1)} — the deck's ledger needs the wall right behind it. Move that step past the deck's end, or make the wall come out instead.` };
  }
  if (out.length > 1) return { shape, note: `The wall comes out twice under the deck — a deck frames around one bump-out at its end. Keep one step under the deck, or move the others past its ends.` };
  const t = out[0];
  const atRight = t.x1 >= W - 0.01 && t.x0 > 0.01;
  const atLeft = t.x0 <= 0.01 && t.x1 < W - 0.01;
  if (!atRight && !atLeft) {
    if (t.x0 <= 0.01 && t.x1 >= W - 0.01) return { shape: rect(), note: null };
    return { shape, note: `The wall comes out ${ftWords(t.depthFt)} between ${ftWords(t.x0)} and ${ftWords(t.x1)}, inside the deck — a deck frames around a bump-out at its end. Move the step to the deck's end, or make the deck end there.` };
  }
  const width = half(atRight ? W - t.x0 : t.x1);
  if (width < NOTCH_MIN_FT || width > W - NOTCH_KEEP_FT) return { shape: rect(), note: `The bump-out leaves ${ftWords(width)} at the deck's ${atRight ? "right" : "left"} end — too little to notch; the deck ends at the step instead.` };
  const depth = half(clamp(t.depthFt, NOTCH_MIN_FT, D - NOTCH_KEEP_FT));
  const note = t.depthFt > D - NOTCH_KEEP_FT ? `The bump-out comes out ${ftWords(t.depthFt)}, more than a ${ftWords(D)} deck can wrap — the notch is held at ${ftWords(depth)}.` : null;
  return { shape: { kind: "L", widthFt: W, depthFt: D, notch: { corner: atRight ? "back-right" : "back-left", widthFt: width, depthFt: depth } }, note };
}

/**
 * The house made to show the deck's shape: a back notch picked in the Shape
 * step gets its step in the wall (the one that would make that notch), and a
 * deck set back to a rectangle loses the step that notched it.
 */
export function houseForShape(house: HouseDesign, shape: DeckShape, opts: { drop?: boolean } = {}): HouseDesign {
  const W = shape.widthFt;
  const want = shape.kind === "L" && shape.notch.corner.startsWith("back") ? shape.notch : null;
  const underBefore = partsUnderDeck(wallParts(house, shape), W).filter((p) => p.depthFt > 0.5);
  if (!want) {
    // A rectangle (or a front notch) picked in the Shape step: drop the one step that notched the deck's end, keep every other.
    if (opts.drop === false || underBefore.length !== 1) return house;
    const t = underBefore[0];
    const atRight = t.x1 >= W - 0.01 && t.x0 > 0.01;
    const atLeft = t.x0 <= 0.01 && t.x1 < W - 0.01;
    if (!atRight && !atLeft) return house;
    const edge = atRight ? t.x0 : t.x1;
    const dir: JogDir = atRight ? "toward" : "away";
    return { ...house, jogs: house.jogs.filter((j) => !(Math.abs(j.atFt - edge) < 0.6 && j.dir === dir)) };
  }
  const right = want.corner === "back-right";
  const edge = half(right ? W - want.widthFt : want.widthFt);
  const dir: JogDir = right ? "toward" : "away";
  const depth = half(clamp(want.depthFt, HOUSE_LIMITS.depthFt.min, HOUSE_LIMITS.depthFt.max));
  const have = house.jogs.find((j) => Math.abs(j.atFt - edge) < 0.6 && j.dir === dir);
  if (have) {
    if (Math.abs(have.depthFt - depth) < 0.01) return house;
    return { ...house, jogs: house.jogs.map((j) => (j === have ? { ...j, depthFt: depth } : j)) };
  }
  // The step that makes this notch owns the wall under the deck: the other steps inside the deck's span go, the ones
  // past its ends stay.
  const kept = house.jogs.filter((j) => j.atFt < -0.6 || j.atFt > W + 0.6);
  const jogs = [...kept, { id: nextJogId(kept), atFt: edge, dir, depthFt: depth }].sort((a, b) => a.atFt - b.atFt).slice(0, HOUSE_LIMITS.jogs);
  return { ...house, jogs };
}

export function nextJogId(jogs: HouseJog[]): string {
  let n = jogs.length + 1;
  while (jogs.some((j) => j.id === `j${n}`)) n++;
  return `j${n}`;
}

/** What the House step says about the wall and the deck together. */
export function houseNotes(shape: DeckShape, house: HouseDesign): string[] {
  const notes: string[] = [];
  const fit = deckShapeForHouse(shape, house);
  if (fit.note) notes.push(fit.note);
  return notes;
}

/* ------------------------------------------------------------------ */
/*  What the 3D draws                                                   */
/* ------------------------------------------------------------------ */

export interface HouseScene {
  /** Blocks [x0, y0, x1, y1, heightFt], ft, in the deck's frame (y out from the house line). */
  blocks: number[][];
  heightFt: number;
  /** The door onto the deck: [centre x, width, height, the face's y], ft. */
  door: number[] | null;
  storeys: 1 | 2;
  roof: HouseRoof;
  /** Windows on the back faces: [centre x, the face's y, width, height, sill], ft. */
  windows: number[][];
  /** The siding's and the roof's colours, hex. */
  siding: string;
  roofColour: string;
}

/**
 * The house as blocks and openings: one block per part of the back wall,
 * the body behind it; a two-storey house keeps its bump-outs one storey
 * tall; the door on the part under the deck's main back edge, windows along
 * every face per storey, clear of the door.
 */
export function houseScene(shape: DeckShape, house: HouseDesign, ctx: { deckHeightFt: number; peakFt: number; mainEdge: { x0: number; x1: number } | null }): HouseScene {
  const parts = impliedParts(wallParts(house, shape), shape, house);
  const storeyTop = (n: number) => n * STOREY_FT + 0.5;
  const mainH = r2(Math.max(storeyTop(house.storeys), ctx.deckHeightFt + 9, ctx.peakFt + 2.5));
  const lowH = r2(Math.max(storeyTop(1), ctx.deckHeightFt + 9));
  const blocks = parts.map((p) => {
    const low = house.storeys === 2 && p.depthFt > 0.5;
    return [p.x0, r2(p.depthFt - HOUSE_BODY_FT), p.x1, p.depthFt, low ? lowH : mainH];
  });
  // The door: on the house line, centred on the deck's main back edge.
  const underRef = referencePart(parts, shape);
  const edge = ctx.mainEdge ?? { x0: Math.max(0, underRef.x0), x1: Math.min(shape.widthFt, underRef.x1) };
  const span = edge.x1 - edge.x0;
  const doorW = span >= 10 ? 6 : 3;
  const door = span >= doorW + 2 ? [r2((edge.x0 + edge.x1) / 2), doorW, 6.67, underRef.depthFt] : null;
  // Windows: 3 ft wide, 4 ft tall, every 5 ft along the free runs of each face (the door and its trim left clear),
  // the sills above the deck's floor on the first storey.
  const windows: number[][] = [];
  const WIN_W = 3;
  const PITCH = 5;
  const EDGE = 1;
  parts.forEach((p, i) => {
    const h = blocks[i][4];
    const storeys = h >= storeyTop(2) - 0.01 ? 2 : 1;
    for (let st = 1; st <= storeys; st++) {
      const sill = st === 1 ? Math.max(3, ctx.deckHeightFt + 1.2) : STOREY_FT + 3;
      const top = st === 1 && storeys === 2 ? STOREY_FT - 0.8 : h - 1;
      const wh = Math.min(4, top - sill);
      if (wh < 2) continue;
      const runs: Array<{ x0: number; x1: number }> = [];
      if (door && st === 1 && p === underRef) {
        const d0 = door[0] - door[1] / 2 - 1.5;
        const d1 = door[0] + door[1] / 2 + 1.5;
        runs.push({ x0: p.x0, x1: Math.min(p.x1, d0) }, { x0: Math.max(p.x0, d1), x1: p.x1 });
      } else runs.push({ x0: p.x0, x1: p.x1 });
      for (const run of runs) {
        for (let x = run.x0 + EDGE + WIN_W / 2; x + WIN_W / 2 <= run.x1 - EDGE + 1e-9; x += PITCH) windows.push([r2(x), p.depthFt, WIN_W, r2(wh), r2(sill)]);
      }
    }
  });
  return { blocks, heightFt: mainH, door, storeys: house.storeys, roof: house.roof, windows: windows.slice(0, 60), siding: sidingHex(house.siding), roofColour: roofHex(house.roofColour) };
}

/** A back notch on a wall with no steps at all (an older design, or the Shape step ahead of the house) is drawn as the bump-out it wraps. */
function impliedParts(parts: WallPart[], shape: DeckShape, house: HouseDesign): WallPart[] {
  if (house.jogs.length || shape.kind !== "L" || !shape.notch.corner.startsWith("back") || parts.length !== 1) return parts;
  const W = shape.widthFt;
  const nw = shape.notch.widthFt;
  const nd = shape.notch.depthFt;
  const p = parts[0];
  if (shape.notch.corner === "back-right") return [{ x0: p.x0, x1: r2(W - nw), depthFt: 0 }, { x0: r2(W - nw), x1: p.x1, depthFt: nd }];
  return [{ x0: p.x0, x1: r2(nw), depthFt: nd }, { x0: r2(nw), x1: p.x1, depthFt: 0 }];
}

/** The 3D's knobs for the house: each step along the wall, and the house's two corners. Positions in the deck's feet. */
export function houseHandles(shape: DeckShape, house: HouseDesign, zFt: number): Array<{ kind: "jog" | "house-left" | "house-right"; id: string; x: number; y: number; z: number; axis: "x"; value: number; perUnit: 1; label: string }> {
  const parts = wallParts(house, shape);
  const W = shape.widthFt;
  const depthAt = (x: number) => parts.find((p) => x >= p.x0 && x <= p.x1)?.depthFt ?? 0;
  const out: ReturnType<typeof houseHandles> = [];
  for (const j of house.jogs) {
    const left = depthAt(j.atFt - 0.01);
    const right = depthAt(j.atFt + 0.01);
    out.push({ kind: "jog", id: j.id, x: j.atFt, y: Math.max(left, right), z: zFt, axis: "x", value: j.atFt, perUnit: 1, label: `Step in the wall — the wall to its right ${j.dir === "toward" ? "comes out" : "steps back"} ${j.depthFt} ft` });
  }
  out.push({ kind: "house-left", id: "house-left", x: -house.leftFt, y: depthAt(-house.leftFt + 0.01), z: zFt, axis: "x", value: -house.leftFt, perUnit: 1, label: "The house's left corner" });
  out.push({ kind: "house-right", id: "house-right", x: W + house.rightFt, y: depthAt(W + house.rightFt - 0.01), z: zFt, axis: "x", value: W + house.rightFt, perUnit: 1, label: "The house's right corner" });
  return out;
}

/** The words under the step's title. */
export function houseWords(house: HouseDesign): string {
  const steps = house.jogs.length === 0 ? "a straight back wall" : `${house.jogs.length} ${house.jogs.length === 1 ? "step" : "steps"} in the back wall`;
  return `${house.storeys === 2 ? "Two storeys" : "One storey"} · ${HOUSE_ROOF_LABEL[house.roof].toLowerCase()} roof · ${steps}`;
}

/* ------------------------------------------------------------------ */
/*  One-click walls, and what the wall does to the deck, in words       */
/* ------------------------------------------------------------------ */

export type QuickWall = "straight" | "bump-right" | "bump-left" | "nook";
export const QUICK_WALLS: readonly QuickWall[] = ["straight", "bump-right", "bump-left", "nook"];
export const QUICK_WALL_LABEL: Record<QuickWall, string> = { straight: "Straight wall", "bump-right": "Bump-out at the right end", "bump-left": "Bump-out at the left end", nook: "The deck in a nook" };

/** The wall shaped in one click: the steps a bump-out at either end of the deck, or a nook around it, take. */
export function quickWall(kind: QuickWall, shape: DeckShape, house: HouseDesign): HouseDesign {
  const W = shape.widthFt;
  const d = 3;
  const w = half(Math.min(6, Math.max(NOTCH_MIN_FT, W / 4)));
  if (kind === "straight") return { ...house, jogs: [] };
  if (kind === "bump-right") return { ...house, jogs: [{ id: "j1", atFt: half(W - w), dir: "toward", depthFt: d }] };
  if (kind === "bump-left") return { ...house, jogs: [{ id: "j1", atFt: w, dir: "away", depthFt: d }] };
  return { ...house, leftFt: Math.max(house.leftFt, 4), rightFt: Math.max(house.rightFt, 4), jogs: [{ id: "j1", atFt: 0, dir: "away", depthFt: d }, { id: "j2", atFt: W, dir: "toward", depthFt: d }] };
}

/** Which one-click wall the house is, if any. */
export function quickWallOf(shape: DeckShape, house: HouseDesign): QuickWall | null {
  if (!house.jogs.length) return "straight";
  const fit = deckShapeForHouse(shape, house);
  if (fit.shape.kind === "L" && fit.shape.notch.corner === "back-right" && house.jogs.length === 1) return "bump-right";
  if (fit.shape.kind === "L" && fit.shape.notch.corner === "back-left" && house.jogs.length === 1) return "bump-left";
  const W = shape.widthFt;
  if (house.jogs.length === 2 && house.jogs[0].dir === "away" && Math.abs(house.jogs[0].atFt) < 0.6 && house.jogs[1].dir === "toward" && Math.abs(house.jogs[1].atFt - W) < 0.6) return "nook";
  return null;
}

/** One line on what the wall does to the deck. */
export function wallWords(shape: DeckShape, house: HouseDesign): string {
  const fit = deckShapeForHouse(shape, house);
  if (fit.note) return fit.note;
  if (quickWallOf(shape, house) === "nook") return "The deck sits in a nook: the house wraps both its ends, its back edge on the wall.";
  if (fit.shape.kind === "L" && fit.shape.notch.corner.startsWith("back")) return `The deck wraps the bump-out at its ${fit.shape.notch.corner === "back-right" ? "right" : "left"} end: a ${ftWords(fit.shape.notch.widthFt)} × ${ftWords(fit.shape.notch.depthFt)} notch, framed around it.`;
  return house.jogs.length ? "The wall's steps are past the deck's ends — the deck's back edge runs straight along the house." : "A straight wall behind the deck.";
}

/** A step, in words: where it is and what the wall does there. */
export function stepWords(j: HouseJog, shape: DeckShape): string {
  const W = shape.widthFt;
  const where = j.atFt < 0 ? `${ftWords(-j.atFt)} left of the deck` : j.atFt > W ? `${ftWords(j.atFt - W)} right of the deck` : j.atFt === 0 ? "at the deck's left end" : j.atFt === W ? "at the deck's right end" : `${ftWords(j.atFt)} from the deck's left end`;
  return `${where}, the wall to the right ${j.dir === "toward" ? "comes out" : "steps back"} ${ftWords(j.depthFt)}`;
}

/* ------------------------------------------------------------------ */
/*  Shaping the wall by hand (2026-10-11: "shape the house in any       */
/*  direction, inside, outside, wider, narrower — easy")                */
/* ------------------------------------------------------------------ */

/** The steps as signed depths: + comes out toward the yard, − steps back. */
const signed = (j: HouseJog) => (j.dir === "toward" ? j.depthFt : -j.depthFt);
const fromSigned = (j: HouseJog, d: number): HouseJog => ({ ...j, dir: d >= 0 ? "toward" : "away", depthFt: half(Math.min(HOUSE_LIMITS.depthFt.max, Math.abs(d))) });

/**
 * One part of the wall pushed out (+) or pulled in (−) by `deltaFt`: the step at each of its ends changes by that much,
 * and a step driven to nothing is dropped on the read-back. The part the deck stands on is the house line and stays —
 * null says so.
 */
export function moveWallPart(house: HouseDesign, shape: DeckShape, part: number, deltaFt: number): HouseDesign | null {
  const parts = wallParts(house, shape);
  if (part < 0 || part >= parts.length || part === referencePartIndex(parts, shape)) return null;
  const d = half(deltaFt);
  if (d === 0) return house;
  const jogs = house.jogs.map((j, i) => {
    if (i === part - 1) return fromSigned(j, signed(j) + d);
    if (i === part) return fromSigned(j, signed(j) - d);
    return j;
  });
  return { ...house, jogs };
}

/**
 * A step put in where the wall was tapped: past the deck's right end the wall beyond comes out 2 ft; at the deck's
 * left end the wall to the left comes out 2 ft (the step there steps back); anywhere else the wall to the right comes
 * out 2 ft. Nothing on top of a step already there, nothing past four.
 */
export function addStepAt(house: HouseDesign, shape: DeckShape, xFt: number): HouseDesign {
  const W = shape.widthFt;
  const x = half(clamp(xFt, -house.leftFt + 1, W + house.rightFt - 1));
  if (house.jogs.length >= HOUSE_LIMITS.jogs || house.jogs.some((j) => Math.abs(j.atFt - x) < 1)) return house;
  const dir: JogDir = x <= 0.01 ? "away" : "toward";
  const jogs = [...house.jogs, { id: nextJogId(house.jogs), atFt: x, dir, depthFt: 2 }].sort((a, b) => a.atFt - b.atFt);
  return { ...house, jogs };
}

/** A step moved along the wall: kept a foot clear of its neighbours and the wall's ends, snapped to the deck's ends when near them. */
export function moveJogTo(house: HouseDesign, shape: DeckShape, id: string, xFt: number): HouseDesign {
  const W = shape.widthFt;
  const i = house.jogs.findIndex((j) => j.id === id);
  if (i < 0) return house;
  let x = half(xFt);
  if (Math.abs(x) < 0.75) x = 0;
  else if (Math.abs(x - W) < 0.75) x = W;
  const lo = i > 0 ? house.jogs[i - 1].atFt + 1 : -house.leftFt + 1;
  const hi = i + 1 < house.jogs.length ? house.jogs[i + 1].atFt - 1 : W + house.rightFt - 1;
  x = clamp(x, lo, hi);
  if (x === house.jogs[i].atFt) return house;
  return { ...house, jogs: house.jogs.map((j, k) => (k === i ? { ...j, atFt: x } : j)) };
}

/* ------------------------------------------------------------------ */
/*  The deck moved and sized on the same drawing (2026-10-11: "I can    */
/*  move the deck size at the same time … move it anywhere I want")    */
/* ------------------------------------------------------------------ */

/**
 * The deck slid along the wall by `deltaFt` (+ to the right): the house stays where it is, so the wall's reach past
 * the deck's ends and every step move the other way in the deck's own feet. Held where either end would run out.
 */
export function slideDeck(house: HouseDesign, deltaFt: number): HouseDesign {
  // The deck right by d with the house still: more wall past its left end by d, less past its right — both held between
  // 0 and the most a wall reaches; the steps, fixed in the world, move the other way in the deck's feet.
  const lo = Math.max(-house.leftFt, house.rightFt - HOUSE_LIMITS.extendFt.max);
  const hi = Math.min(HOUSE_LIMITS.extendFt.max - house.leftFt, house.rightFt);
  const d = half(clamp(deltaFt, lo, hi));
  if (d === 0) return house;
  return { ...house, leftFt: half(house.leftFt + d), rightFt: half(house.rightFt - d), jogs: house.jogs.map((j) => ({ ...j, atFt: half(j.atFt - d) })) };
}

/**
 * The deck's LEFT end moved to a new width while its right end stays put: the house stays too, so the wall's left
 * reach and every step shift by the change. Returns the shape and the house together.
 */
export function resizeDeckLeft(house: HouseDesign, shape: DeckShape, newWidthFt: number, minWidthFt: number, maxWidthFt: number): { house: HouseDesign; shape: DeckShape } {
  const W = shape.widthFt;
  const w2 = half(clamp(newWidthFt, minWidthFt, maxWidthFt));
  const d = W - w2; // the left end moves right by this much
  if (d === 0) return { house, shape };
  const leftFt = clamp(half(house.leftFt + d), HOUSE_LIMITS.extendFt.min, HOUSE_LIMITS.extendFt.max);
  const moved = { ...house, leftFt, jogs: house.jogs.map((j) => ({ ...j, atFt: half(j.atFt - d) })) };
  return { house: moved, shape: { ...shape, widthFt: w2 } };
}


/* ------------------------------------------------------------------ */
/*  Shifting a part sideways, levelling it, and the one-tap fixes       */
/*  (2026-10-11 afternoon; owner: "make it smart to shift the walls     */
/*  back, front, right, left — easier")                                 */
/* ------------------------------------------------------------------ */

/**
 * A part of the wall moved sideways as one piece by `deltaFt` (+ to the right), keeping its width: a middle part's two
 * steps move together; the first or last part moves its one step and the house's end with it. Held a foot clear of the
 * neighbouring steps, the house's ends inside their reach (0–60 ft past the deck). A straight wall has nothing to shift.
 */
export function shiftWallPart(house: HouseDesign, shape: DeckShape, part: number, deltaFt: number): HouseDesign {
  const W = shape.widthFt;
  const n = house.jogs.length;
  if (part < 0 || part > n || n === 0) return house;
  const d0 = half(deltaFt);
  if (d0 === 0) return house;
  const L = HOUSE_LIMITS.extendFt;
  const leftI = part - 1; // the step at the part's left end, if any
  const rightI = part; // the step at its right end, if any
  let lo = -Infinity;
  let hi = Infinity;
  if (leftI >= 0) {
    const j = house.jogs[leftI];
    lo = Math.max(lo, (leftI > 0 ? house.jogs[leftI - 1].atFt + 1 : -house.leftFt + 1) - j.atFt);
  } else {
    // The first part: the house's left end moves with it, between 0 and the most a wall reaches past the deck.
    lo = Math.max(lo, -(L.max - house.leftFt));
    hi = Math.min(hi, house.leftFt - L.min);
  }
  if (rightI < n) {
    const j = house.jogs[rightI];
    hi = Math.min(hi, (rightI + 1 < n ? house.jogs[rightI + 1].atFt - 1 : W + house.rightFt - 1) - j.atFt);
  } else {
    // The last part: the house's right end moves with it.
    lo = Math.max(lo, -(house.rightFt - L.min));
    hi = Math.min(hi, L.max - house.rightFt);
  }
  const d = half(clamp(d0, lo, hi));
  if (d === 0 || !Number.isFinite(d)) return house;
  return {
    ...house,
    leftFt: leftI < 0 ? half(house.leftFt - d) : house.leftFt,
    rightFt: rightI >= n ? half(house.rightFt + d) : house.rightFt,
    jogs: house.jogs.map((j, i) => (i === leftI || i === rightI ? { ...j, atFt: half(j.atFt + d) } : j)),
  };
}

/** The part set level with the house line: its steps shrink by its depth (one driven to nothing is dropped on the read-back). Null for the house line itself. */
export function levelWallPart(house: HouseDesign, shape: DeckShape, part: number): HouseDesign | null {
  const parts = wallParts(house, shape);
  const p = parts[part];
  if (!p || part === referencePartIndex(parts, shape)) return null;
  if (Math.abs(p.depthFt) < 0.01) return house;
  return moveWallPart(house, shape, part, -p.depthFt);
}

/** The deck ended at `widthFt` with the house left where it is: the wall past its right end grows by what the deck gave up. */
function endDeckAt(house: HouseDesign, shape: DeckShape, widthFt: number): { house: HouseDesign; shape: DeckShape } {
  const w = half(widthFt);
  return { house: { ...house, rightFt: half(clamp(house.rightFt + (shape.widthFt - w), HOUSE_LIMITS.extendFt.min, HOUSE_LIMITS.extendFt.max)) }, shape: { ...shape, widthFt: w } };
}

/** One tap that answers the wall's note: what it does, and the house and the deck after it. */
export interface WallFix {
  id: string;
  label: string;
  house: HouseDesign;
  shape: DeckShape;
}

/**
 * The fixes for a wall the deck cannot frame around, each one tried and kept only when the note goes away: a recess
 * under the deck brought out level, the deck slid or ended clear of it; a second bump-out levelled; a bump-out inside
 * the deck levelled, or the deck slid so it sits at an end, or the step moved to that end.
 */
export function wallFixes(shape: DeckShape, house: HouseDesign, limits: { minWidthFt: number; maxWidthFt: number }): WallFix[] {
  const fit = deckShapeForHouse(shape, house);
  if (!fit.note) return [];
  const W = shape.widthFt;
  const parts = wallParts(house, shape);
  const under = parts.map((p, i) => ({ i, x0: Math.max(p.x0, 0), x1: Math.min(p.x1, W), depthFt: p.depthFt })).filter((p) => p.x1 - p.x0 > 0.5);
  const out = under.filter((p) => p.depthFt > 0.5);
  const back = under.filter((p) => p.depthFt < -0.5);
  const fixes: WallFix[] = [];
  const offer = (id: string, label: string, change: { house?: HouseDesign | null; shape?: DeckShape }) => {
    if (change.house === null) return;
    const h = change.house ?? house;
    const s = change.shape ?? shape;
    if (h === house && s === shape) return;
    if (deckShapeForHouse(s, h).note) return;
    if (fixes.some((f) => f.id === id)) return;
    fixes.push({ id, label, house: h, shape: s });
  };
  if (back.length) {
    const b = back[0];
    offer("level", `Bring that part of the wall out level with the house (${ftWords(-b.depthFt)})`, { house: levelWallPart(house, shape, b.i) });
    if (b.x0 <= 0.01) offer("slide-right", `Slide the deck ${ftWords(b.x1)} to the right, clear of the recess`, { house: slideDeck(house, b.x1) });
    if (b.x1 >= W - 0.01) offer("slide-left", `Slide the deck ${ftWords(W - b.x0)} to the left, clear of the recess`, { house: slideDeck(house, -(W - b.x0)) });
    if (b.x0 >= limits.minWidthFt) offer("end-at", `End the deck where the wall steps back — ${ftWords(b.x0)} wide`, endDeckAt(house, shape, b.x0));
    if (W - b.x1 >= limits.minWidthFt) offer("start-after", `Start the deck past the recess — ${ftWords(W - b.x1)} wide`, resizeDeckLeft(house, shape, W - b.x1, limits.minWidthFt, limits.maxWidthFt));
  } else if (out.length > 1) {
    const atEnd = out.find((p) => p.x0 <= 0.01 || p.x1 >= W - 0.01);
    const keep = atEnd ?? out.reduce((a, b) => (b.x1 - b.x0 > a.x1 - a.x0 ? b : a));
    let h: HouseDesign | null = house;
    for (const p of out) if (p !== keep && h) h = levelWallPart(h, shape, p.i);
    offer("level-others", `Level the other bump-out${out.length > 2 ? "s" : ""} with the house — keep the one at ${keep.x0 <= 0.01 ? "the left end" : keep.x1 >= W - 0.01 ? "the right end" : ftWords(keep.x0)}`, { house: h });
    let all: HouseDesign | null = house;
    for (const p of out) if (all) all = levelWallPart(all, shape, p.i);
    offer("level-all", `Level every bump-out under the deck with the house`, { house: all });
    const first = out[0];
    const last = out[out.length - 1];
    if (last.x1 >= W - 0.01 && first.x0 >= limits.minWidthFt) offer("end-at", `End the deck at the first bump-out — ${ftWords(first.x0)} wide`, endDeckAt(house, shape, first.x0));
    if (first.x0 <= 0.01 && W - last.x1 >= limits.minWidthFt) offer("start-after", `Start the deck past the last bump-out — ${ftWords(W - last.x1)} wide`, resizeDeckLeft(house, shape, W - last.x1, limits.minWidthFt, limits.maxWidthFt));
  } else if (out.length === 1) {
    const t = out[0];
    const toRight = t.x0;
    const toLeft = W - t.x1;
    if (toRight > 0.01 && toLeft > 0.01) {
      // Slid the shorter way first; the house stays put, so a slide the wall's reach cannot give is not offered (the note would stay).
      const ways: Array<["slide-right" | "slide-left", number, string]> = [["slide-right", toRight, `Slide the deck ${ftWords(toRight)} to the right, so the bump-out is at its left end`], ["slide-left", -toLeft, `Slide the deck ${ftWords(toLeft)} to the left, so the bump-out is at its right end`]];
      if (toRight > toLeft) ways.reverse();
      for (const [id, by, label] of ways) offer(id, label, { house: slideDeck(house, by) });
      // The bump-out moved whole (its width kept) to the deck's nearer end, where the deck notches around it; the far end if the near one has no room.
      const shifts: Array<[number, string]> = [[-toRight, "left"], [toLeft, "right"]];
      if (toRight > toLeft) shifts.reverse();
      for (const [by, end] of shifts) offer("shift-to-end", `Shift the bump-out to the deck's ${end} end — the deck notches around it`, { house: shiftWallPart(house, shape, t.i, by) });
    }
    offer("level", `Level the bump-out with the house`, { house: levelWallPart(house, shape, t.i) });
    if (toRight >= limits.minWidthFt) offer("end-at", `End the deck at the bump-out — ${ftWords(toRight)} wide`, endDeckAt(house, shape, toRight));
    if (toLeft >= limits.minWidthFt) offer("start-after", `Start the deck past the bump-out — ${ftWords(toLeft)} wide`, resizeDeckLeft(house, shape, toLeft, limits.minWidthFt, limits.maxWidthFt));
  }
  return fixes;
}

/** One part of the wall in words: "8 ft wide · comes out 4 ft" / "the house line" / "steps back 2 ft". */
export function wallPartWords(p: WallPart): string {
  const width = ftWords(p.x1 - p.x0);
  if (Math.abs(p.depthFt) < 0.01) return `${width} wide · the house line`;
  return `${width} wide · ${p.depthFt > 0 ? "comes out" : "steps back"} ${ftWords(Math.abs(p.depthFt))}`;
}
