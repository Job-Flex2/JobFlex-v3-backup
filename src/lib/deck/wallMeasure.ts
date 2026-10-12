// THE BACK WALL, AS A HOMEOWNER MEASURES IT (2026-10-12; owner: "give the
// client more options — draw and move the deck and the house's jogs, so they
// can go outside, measure the wall's jogs and shape it on the design; make
// it smart"). Pure.
//
// Outside with a tape, a wall is walked from its LEFT corner (standing in the
// yard, facing the house): a straight stretch, a corner, the next stretch
// sticking out or sitting back, and so on to the right corner — and where the
// deck starts, from that left corner. The house model (lib/deck/house) keeps
// the same wall as steps measured from the deck's left end; this file turns
// one into the other, both ways, so the client can type what the tape says
// and the drawing, the 3D and the deck's notch follow.

import type { DeckShape } from "./design";
import { HOUSE_LIMITS, referencePartIndex, wallParts, type HouseDesign, type HouseJog } from "./house";

/** One straight stretch of the back wall, left to right. `offsetFt`: + sticks out toward the yard, − sits back, against the stretch the deck is on. */
export interface WallStretch {
  lengthFt: number;
  offsetFt: number;
}

export interface WallSheet {
  stretches: WallStretch[];
  /** From the house's left corner to the deck's left end, ft. */
  deckStartFt: number;
  /** Corner to corner along the wall, ft. */
  totalFt: number;
  /** The stretch the deck's back edge is on — its offset is 0 by definition. */
  mainIndex: number;
}

/** The most stretches a wall can have (four steps). */
export const STRETCH_MAX = HOUSE_LIMITS.jogs + 1;
/** A stretch is never shorter than this. */
export const STRETCH_MIN_FT = 1;

const half = (n: number) => Math.round(n * 2) / 2;

/** What a tape says, typed: "12", "12.5", "12'6", "12 ft 6 in", "12 6" → feet. Null when it is not a length. */
export function parseLength(text: string): number | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  const m = /^(\d+(?:\.\d+)?)\s*(?:'|ft|feet|foot)?\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in|inches|inch)?)?$/.exec(t);
  if (!m) return null;
  const feet = Number(m[1]) + (m[2] ? Number(m[2]) / 12 : 0);
  return Number.isFinite(feet) ? feet : null;
}
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** The wall as the tape reads it. */
export function wallSheet(house: HouseDesign, shape: DeckShape): WallSheet {
  const parts = wallParts(house, shape);
  return {
    stretches: parts.map((p) => ({ lengthFt: half(p.x1 - p.x0), offsetFt: half(p.depthFt) })),
    deckStartFt: house.leftFt,
    totalFt: half(house.leftFt + shape.widthFt + house.rightFt),
    mainIndex: referencePartIndex(parts, shape),
  };
}

export interface SheetResult {
  house: HouseDesign;
  /** Said when what was typed had to be bent to fit (the deck past a corner, a step too deep). */
  note: string | null;
}

/**
 * The house from what the tape read: the stretches left to right and where
 * the deck starts. The house keeps its storeys, roof and colours.
 */
export function houseFromSheet(house: HouseDesign, shape: DeckShape, sheet: { stretches: WallStretch[]; deckStartFt: number }): SheetResult {
  const W = shape.widthFt;
  const stretches = sheet.stretches.slice(0, STRETCH_MAX).map((s) => ({ lengthFt: half(Math.max(STRETCH_MIN_FT, s.lengthFt)), offsetFt: half(s.offsetFt) }));
  if (!stretches.length) stretches.push({ lengthFt: half(W + house.leftFt + house.rightFt), offsetFt: 0 });
  const notes: string[] = [];
  let total = stretches.reduce((a, s) => a + s.lengthFt, 0);
  let leftFt = half(clamp(sheet.deckStartFt, HOUSE_LIMITS.extendFt.min, HOUSE_LIMITS.extendFt.max));
  if (leftFt + W > total) {
    // What the tape said stands: the deck slides along the wall to stay on it; only a deck wider than the whole wall
    // makes the last part longer (the drawing cannot put a deck past the house's corner).
    if (W <= total) {
      const slid = half(total - W);
      notes.push(`The deck is ${W} ft wide, so it now starts ${slid} ft from the left corner to stay on the wall.`);
      leftFt = slid;
    } else {
      notes.push(`The deck is ${W} ft wide but the wall is ${total} ft — the last part of the wall is drawn to the deck's end. Check the wall or make the deck narrower.`);
      stretches[stretches.length - 1].lengthFt = half(stretches[stretches.length - 1].lengthFt + (W - total));
      total = W;
      leftFt = 0;
    }
  }
  const rightFt = Math.min(half(total - leftFt - W), HOUSE_LIMITS.extendFt.max);
  const jogs: HouseJog[] = [];
  let at = 0;
  for (let k = 1; k < stretches.length; k++) {
    at += stretches[k - 1].lengthFt;
    const delta = stretches[k].offsetFt - stretches[k - 1].offsetFt;
    if (Math.abs(delta) < HOUSE_LIMITS.depthFt.min) continue;
    const depth = half(Math.min(HOUSE_LIMITS.depthFt.max, Math.abs(delta)));
    if (Math.abs(delta) > HOUSE_LIMITS.depthFt.max) notes.push(`A step of ${Math.abs(delta)} ft is drawn as ${HOUSE_LIMITS.depthFt.max} ft — the most the drawing takes.`);
    jogs.push({ id: `j${jogs.length + 1}`, atFt: half(at - leftFt), dir: delta > 0 ? "toward" : "away", depthFt: depth });
  }
  return { house: { ...house, leftFt, rightFt, jogs }, note: notes.length ? notes.join(" ") : null };
}

/** The deck's start that centres it on a stretch (or on the whole wall when the deck is wider). */
export function centreOn(sheet: WallSheet, index: number, deckWidthFt: number): number {
  let x0 = 0;
  for (let i = 0; i < index && i < sheet.stretches.length; i++) x0 += sheet.stretches[i].lengthFt;
  const s = sheet.stretches[index];
  if (!s) return sheet.deckStartFt;
  const start = s.lengthFt >= deckWidthFt ? x0 + (s.lengthFt - deckWidthFt) / 2 : (sheet.totalFt - deckWidthFt) / 2;
  return half(clamp(start, 0, Math.max(0, sheet.totalFt - deckWidthFt)));
}

/** "Left corner → 8 ft sticking out 3 ft → 20 ft, the deck's wall → right corner". */
export function sheetWords(sheet: WallSheet): string {
  if (sheet.stretches.length === 1) return `A straight wall, ${sheet.totalFt} ft corner to corner`;
  return sheet.stretches
    .map((s, i) => `${s.lengthFt} ft${i === sheet.mainIndex ? " (the deck's wall)" : s.offsetFt > 0 ? ` sticking out ${s.offsetFt} ft` : s.offsetFt < 0 ? ` set back ${-s.offsetFt} ft` : ""}`)
    .join(" → ");
}
