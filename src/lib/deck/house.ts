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
}

export const HOUSE_LIMITS = { extendFt: { min: 0, max: 60 }, depthFt: { min: 1, max: 12 }, jogs: 4 } as const;
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
  return { storeys: 1, roof: "hip", leftFt: 4, rightFt: 4, jogs: [] };
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
      return { id, atFt: half(num(o.atFt, 0)), dir: (o.dir === "away" ? "away" : "toward") as JogDir, depthFt: half(clamp(num(o.depthFt, 2), HOUSE_LIMITS.depthFt.min, HOUSE_LIMITS.depthFt.max)) };
    })
    .filter((j) => j.atFt > -leftFt + 0.5 && j.atFt < W + rightFt - 0.5)
    .sort((a, b) => a.atFt - b.atFt)
    .slice(0, HOUSE_LIMITS.jogs);
  // Two steps on one spot: the second is dropped.
  const spaced = jogs.filter((j, i) => i === 0 || j.atFt - jogs[i - 1].atFt >= 1);
  // The steps are kept exactly as given: the read-back never adds one for a back notch (the studio does that once, when
  // a design opens) and never drops one (a step just removed must stay removed, so the deck can go back to a rectangle).
  return { storeys, roof, leftFt, rightFt, jogs: spaced };
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
/** The part of the wall the deck's main back edge mostly runs along — the house line. */
function referencePart<T extends { x0: number; x1: number }>(parts: T[], shape: DeckShape): T {
  const m = mainSpan(shape);
  let best = parts[0];
  let most = -1;
  for (const p of parts) {
    const overlap = Math.min(p.x1, m.x1) - Math.max(p.x0, m.x0);
    if (overlap > most) {
      most = overlap;
      best = p;
    }
  }
  return best;
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
  // The step that makes this notch — any other step under the deck's end that contradicts it goes.
  const kept = house.jogs.filter((j) => !(right ? j.atFt > edge - 0.6 && j.atFt <= W + 0.01 : j.atFt < edge + 0.6 && j.atFt >= -0.01));
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
  return { blocks, heightFt: mainH, door, storeys: house.storeys, roof: house.roof, windows: windows.slice(0, 60) };
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
