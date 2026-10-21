// A DECK'S MATERIALS FROM THE PLANS OR FROM ITS SIZE (owner, 2026-10-21: "calculate any materials needed — for drywall,
// deck, roof, any — make it smart"). The house's build list carries a deck as one line; the Deck Studio carries the
// whole frame. So a deck's size — the deck drawn on the plans (its room's dimensions, or its stated area), or the size
// the contractor types ("16x20 composite, 4 ft high") — becomes a Deck Studio design, the studio sizes every member to
// the code tables (settleDesign: joists, beams, posts for the span and the load), and its own yard list
// (lib/deck/materialList) is the answer: footings and posts, ledger and flashing, framing, decking, fascia, stairs,
// railing, with every hanger, tie, screw and bag of concrete. Pure; heavy (the code tables) — loaded when asked for.
import { defaultDeckDesign, defaultStair, stateCode, type DeckDesign } from "../deck/design";
import { defaultDecking, type RailTypeId } from "../deck/catalog";
import { settleDesign } from "../deck/settle";
import { priceDeck } from "../deck/pricing";
import { materialList } from "../deck/materialList";
import { DECK_BOARD_LABEL, type DeckBoard, type DeckMaterials, type DeckSpec } from "./deckSpec";

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const RAIL_FOR: Record<DeckBoard, RailTypeId> = { composite: "composite", pvc: "composite", treated: "treated", cedar: "cedar", hardwood: "aluminum" };

function boardId(board: DeckBoard, state: string | null): string {
  if (board === "composite") return "composite-better";
  if (board === "pvc") return "pvc";
  if (board === "hardwood") return "ipe-1x6";
  if (board === "cedar") return "cedar-54";
  const own = defaultDecking(state);
  return own.startsWith("pt-") ? own : "pt-pine-54";
}

/** The deck as a Deck Studio design, sized to the code, and its yard list. */
export function deckMaterials(spec: DeckSpec): DeckMaterials {
  const st = stateCode(spec.state);
  const base = defaultDeckDesign({ state: st });
  const heightIn = clamp(Math.round(spec.heightIn), 6, 144);
  const design: DeckDesign = {
    ...base,
    shape: { kind: "rect", widthFt: clamp(spec.widthFt, 4, 60), depthFt: clamp(spec.depthFt, 4, 40) },
    heightIn,
    decking: { ...base.decking, product: boardId(spec.board, st) },
    // The railing system that goes with the board (the studio starts with none chosen); "no railing" takes it off.
    rail: { ...base.rail, type: spec.railing ? RAIL_FOR[spec.board] : "none" },
    extras: { ...base.extras, railFt: spec.railing ? "auto" : 0 },
    // Stairs when asked for and the deck is more than a step up.
    stairs: spec.stairs && heightIn > 8 ? [defaultStair("s1", "front", 0)] : [],
  };
  const settled = settleDesign(design);
  const list = materialList(priceDeck(settled.design));
  const groups = list.groups.map((g) => ({ label: g.label, lines: g.lines.filter((l) => !l.byClient).map((l) => ({ label: l.label, qty: l.qty, unit: l.unit, note: l.note })) })).filter((g) => g.lines.length);
  const words = `${spec.widthFt}' × ${spec.depthFt}' deck, ${heightIn} in. off the ground — ${DECK_BOARD_LABEL[spec.board].toLowerCase()}${spec.stairs && heightIn > 8 ? ", stairs" : ""}${spec.railing ? ", railing" : ""}`;
  return { spec: { ...spec, heightIn }, words, groups, fixes: settled.fixes };
}
