// WHAT A COMPANY KEEPS IN STOCK BY DEFAULT (2026-09-23) — pure.
//
// Owner: "not every contractor stocks everything to get the job done … let
// them check-box what they're stocking, then calculate on that … make it
// understandable how to set up the inventory." The stock list starts from a
// suggestion per trade, one rule a contractor can read in a sentence:
//   roof   the small stuff every truck carries — underlayment, ice & water,
//          drip edge, starter, flashing, boots, vents, nails, sealants — is
//          kept in stock; shingles, membranes and coatings are bought per
//          job: the colour and the system change with every roof.
//   fence  posts, rails, concrete, fasteners, caps and gate hardware are
//          kept in stock; pickets, boards, panels and fabric — and the vinyl,
//          composite, aluminum, steel and chain-link systems — per job.
//   hvac   the parts a service truck carries — capacitors, contactors,
//          motors, thermostats, line sets, disconnects, drains — are kept in
//          stock; the equipment (condensers, furnaces, coils, air handlers,
//          water heaters) is ordered per job.
// A suggestion only: the checklist is the contractor's to change, and an
// item they add by hand is stocked — they added it to track it.

import { itemCategory } from "@/lib/inventoryCategories";
import type { TradeId } from "@/lib/inventory";

/** Low-slope lines that are consumables, not the membrane itself. */
const ROOF_CONSUMABLE = /fastener|plate|adhesive|tape|primer|cleaner|sealant|cement|nail|reinforcement|closure/i;
const ROOF_PER_JOB_CATEGORY = new Set(["Shingles & coverings", "Coatings & restoration"]);

/** Fence hardware every crew keeps, whatever the fence is made of. */
const FENCE_STOCKED = /nail|screw|\bties?\b|concrete|gravel|hinge|latch|gate kit|\bcaps?\b/i;
/** The boards and panels a job is priced in, and the non-wood systems. */
const FENCE_PER_JOB = /picket|board|panel|slat|fabric|mesh|vinyl|composite|aluminum|ornamental|steel|galvanized|polymer|chain|\bOD\b|tension|brace band|rail end|mid-bay|split cedar|mortised/i;

const HVAC_EQUIPMENT = /-ton\b|\bton\b|furnace|heat pump|air handler|condenser(?! fan)|coil(?! (?:cleaner|lamp))|ductless|water heater|heat kit|\bbtu\b|seer|afue|^starter\b/i;
/** A part on a service truck, even when its name says "condenser" or "coil". */
const HVAC_PART = /fan motor|blade|cleaner|lamp|capacitor|contactor|ignit|sensor|control board|switch|valve|filter|relay|transformer|fuse|thermostat/i;

/** The suggested policy for an item named like this: true = kept in stock, false = bought per job. */
export function defaultStocked(trade: TradeId, name: string): boolean {
  const category = itemCategory(trade, name);
  if (trade === "roof") {
    if (ROOF_PER_JOB_CATEGORY.has(category)) return false;
    if (category === "Low-slope roofing") return ROOF_CONSUMABLE.test(name);
    return true;
  }
  if (trade === "fence") {
    if (FENCE_STOCKED.test(name)) return true;
    return !FENCE_PER_JOB.test(name);
  }
  if (trade === "deck") {
    // Hardware, fasteners, flashing, tape, concrete and the rough electrical live on the shelf; lumber, boards, roofing,
    // rail systems and fixtures (lit or decorative caps among them) are bought per job.
    if (/\b(lit|decorative|composite|aluminum|vinyl|glass|cable|transformer|receptacles? for|heater|light|fan|chandelier)\b/i.test(name)) return false;
    return /\b(hangers?|ties?|screws?|lags?|bolts?|anchors?|flashing|membrane|tape|nails|concrete|tubes?|post bases?|post caps?|hold-downs?|connectors?|brackets?|gfci|box(?:es)?|switch(?:es)?|breakers?|wire|conduit)\b/i.test(name);
  }
  return !(category === "Equipment" && HVAC_EQUIPMENT.test(name) && !HVAC_PART.test(name));
}

/** The one sentence that explains the suggestion, shown over the checklist. */
export const STOCK_DEFAULT_NOTE: Record<TradeId, string> = {
  roof: "Suggested: the small stuff every truck carries is kept in stock — underlayment, ice & water, drip edge, starter, flashing, boots, vents, nails and sealants. Shingles, membranes and coatings are bought per job: the color and the system change with every roof.",
  fence: "Suggested: posts, rails, concrete, fasteners, caps and gate hardware are kept in stock. Pickets, boards, panels and fabric — and the vinyl, composite, aluminum, steel and chain-link systems — are bought per job.",
  hvac: "Suggested: the parts a service truck carries are kept in stock — capacitors, contactors, motors, thermostats, line sets, disconnects, drains. Equipment — condensers, furnaces, coils, air handlers, water heaters — is ordered per job.",
  deck: "Suggested: hangers, ties, screws, lags, bolts, bases, caps, flashing, tape, concrete and the electrical boxes and wire are kept in stock. Lumber, deck boards, roofing, rail systems and fixtures are bought per job: the species and the product change with every deck.",
};

/** One row of the stock checklist: a standard item or one already on the list. */
export type StockChoice = {
  key: string;
  name: string;
  unit: string;
  /** Not on the company's list yet — saving the checklist adds it. */
  isNew: boolean;
  /** The current policy for an item on the list; the suggestion for a new one. */
  stocked: boolean;
  /** What the suggestion says, so "Reset to suggested" has something to reset to. */
  suggested: boolean;
  category: string;
};
