// A DECK'S SIZE — from the plans or from the contractor's words (2026-10-21). The light half of lib/plans/deckMaterials:
// no Deck Studio code in it, so the blueprint page can read a deck ask without loading the code tables. Pure.
import type { House } from "./takeoff";

export const DECK_BOARDS = ["composite", "treated", "cedar", "hardwood", "pvc"] as const;
export type DeckBoard = (typeof DECK_BOARDS)[number];
export const DECK_BOARD_LABEL: Record<DeckBoard, string> = {
  composite: "Capped composite",
  treated: "Pressure-treated wood",
  cedar: "Cedar",
  hardwood: "Ipe hardwood",
  pvc: "Capped PVC",
};

export type DeckSpec = {
  widthFt: number;
  depthFt: number;
  /** The walking surface above the ground, inches. */
  heightIn: number;
  board: DeckBoard;
  stairs: boolean;
  railing: boolean;
  /** The job's state (the code tables and the region's board). */
  state: string | null;
  /** Where the size came from: the plans, the contractor's words, or the form. */
  from: "plans" | "words" | "entered";
};

export type DeckMaterials = {
  spec: DeckSpec;
  /** "20' × 16' deck, 48 in. off the ground — capped composite" */
  words: string;
  groups: Array<{ label: string; lines: Array<{ label: string; qty: number; unit: string; note: string | null }> }>;
  /** What the code tables made the studio change ("Use 2x10 joists"). */
  fixes: string[];
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** The deck the plans draw: a room named deck (its own size), else the stated deck area as a 12-ft-deep rectangle. */
export function deckSpecFromPlans(h: House, state: string | null): DeckSpec | null {
  const room = h.levels.flatMap((l) => l.rooms).find((r) => /\bdeck\b/i.test(r.name) && r.widthFt && r.lengthFt);
  const base = { heightIn: 36, board: "composite" as DeckBoard, stairs: true, railing: true, state, from: "plans" as const };
  if (room?.widthFt && room.lengthFt) return { ...base, widthFt: Math.max(room.widthFt, room.lengthFt), depthFt: Math.min(room.widthFt, room.lengthFt) };
  if (h.deckSqFt > 20) {
    const depth = clamp(Math.round(Math.sqrt(h.deckSqFt / 1.4)), 6, 16);
    return { ...base, widthFt: Math.round(h.deckSqFt / depth), depthFt: depth };
  }
  return null;
}

/** What the contractor's words say about a deck: "16x20", "16 by 20", "4 ft high" / "30 in", the board, stairs, railing. */
export function deckSpecFromWords(text: string): Partial<DeckSpec> {
  const t = text.toLowerCase();
  const out: Partial<DeckSpec> = {};
  const size = /(\d{1,2}(?:\.\d+)?)\s*(?:'|ft|feet)?\s*(?:x|×|by)\s*(\d{1,2}(?:\.\d+)?)/.exec(t);
  if (size) {
    const a = Number(size[1]);
    const b = Number(size[2]);
    out.widthFt = Math.max(a, b);
    out.depthFt = Math.min(a, b);
  }
  const ft = /(\d{1,2}(?:\.\d+)?)\s*(?:'|ft|feet|foot)\s*(?:high|tall|off|above|up)/.exec(t);
  const inch = /(\d{1,3})\s*(?:"|in\b|inch(?:es)?)\s*(?:high|tall|off|above|up)?/.exec(t);
  if (ft) out.heightIn = Math.round(Number(ft[1]) * 12);
  else if (inch && !size?.[0].includes(inch[0])) out.heightIn = Number(inch[1]);
  if (/\b(composite|trex|timbertech|fiberon|deckorators)\b/.test(t)) out.board = "composite";
  else if (/\b(pvc|azek)\b/.test(t)) out.board = "pvc";
  else if (/\b(ipe|hardwood|cumaru|tigerwood)\b/.test(t)) out.board = "hardwood";
  else if (/\bcedar|redwood\b/.test(t)) out.board = "cedar";
  else if (/\b(treated|pt\b|pressure|pine|wood deck)\b/.test(t)) out.board = "treated";
  if (/\bno (stairs|steps)\b/.test(t)) out.stairs = false;
  else if (/\b(stairs|steps)\b/.test(t)) out.stairs = true;
  if (/\bno (rail|railing|guard)/.test(t)) out.railing = false;
  else if (/\b(rail|railing|guard)/.test(t)) out.railing = true;
  return out;
}

/** True when the words are about a deck (a pergola, porch or patio slab is not). */
export const isDeckAsk = (text: string) => /\bdecks?\b|\bdecking\b/i.test(text) && !/\bdeck (screws?|mud|paint)\b/i.test(text);

