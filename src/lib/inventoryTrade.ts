// WHICH TRADE A PROPOSAL BELONGS TO (2026-09-20) — pure, no database.
//
// Proposals made since the trade boards exist carry Proposal.trade. Older
// ones do not, and the owner wants every roofing, fence and HVAC proposal on
// its board: "make sure all proposals that belong to those estimators showed
// up in the inventory as well." So a proposal with no stamp is read three
// ways, strongest first:
//   1. the estimator's own record points at it — an HVAC estimate converted
//      into it, a roof measurement's site photo filed under it;
//   2. its material lines are the trade's materials: the names the
//      estimators price (lib/inventoryPresets, plurals and trailing detail
//      forgiven), a fence package line, or the trade's own words;
//   3. failing both, its title and description name the trade, by the Smart
//      Proposal's trade detector — so a "Deck rebuild" with a gate on it is
//      decking, not a fence, and a "Kitchen backsplash" is nobody's.

import { detectTrade } from "@/lib/estimate/trade-knowledge";
import { fenceTypeForLine } from "@/lib/inventoryBom";
import { presetItems } from "@/lib/inventoryPresets";
import { isTradeId, stockKey, type StockLine, type TradeId } from "@/lib/inventory";

export type TradeEvidence = {
  trade?: string | null;
  title?: string | null;
  description?: string | null;
  lines: readonly StockLine[];
  /** An HVAC estimate was converted into this proposal. */
  hvacEstimate?: boolean;
  /** A roof measurement's site photo is filed under this proposal. */
  roofMeasurement?: boolean;
};

const ALL: readonly TradeId[] = ["roof", "fence", "hvac", "deck"];
const PROFILE: Record<string, TradeId> = { roofing: "roof", fencing: "fence", hvac: "hvac", decking: "deck" };

/** Trade words a material line can carry even when its name drifted from the estimator's. */
const WORDS: Record<TradeId, RegExp> = {
  roof: /\b(shingles?|underlayment|ridge vent|ridge cap|hip (?:&|and) ridge|drip edge|flashing|ice (?:&|and) water|tpo|epdm|roofing|starter strip|pipe boots?|valley metal)\b/i,
  fence: /\b(fence|fencing|pickets?|line posts?|corner posts?|end posts?|gate posts?|chain ?link|privacy panels?|fence boards?)\b/i,
  hvac: /\b(furnace|heat pumps?|condensers?|air handlers?|evaporator|thermostats?|line sets?|refrigerant|duct(?:work)?|btu|seer2?|afue|mini.?splits?|ductless|b-vent)\b/i,
  deck: /\b(joists?|ledger|deck(?:ing)? boards?|rim joist|post caps?|post bases?|joist hangers?|hurricane ties?|stringers?|balusters?|rail posts?|rafters?|ridge beam|hip rafters?|pergola|gazebo|deck screws)\b/i,
};

/** A key with plurals flattened, so "shingles" and "shingle" read the same. */
const flat = (key: string) => key.split(" ").map((t) => t.replace(/s$/, "")).join(" ");

let keys: Record<TradeId, string[]> | null = null;
function presetKeys(): Record<TradeId, string[]> {
  keys ??= {
    roof: presetItems("roof").map((p) => flat(stockKey(p.name))),
    fence: presetItems("fence").map((p) => flat(stockKey(p.name))),
    hvac: presetItems("hvac").map((p) => flat(stockKey(p.name))),
    deck: presetItems("deck").map((p) => flat(stockKey(p.name))),
  };
  return keys;
}

/** A line names one of the trade's materials: its key is a preset key, or one begins with the other, whole words. */
function namesPreset(lineKey: string, trade: TradeId): boolean {
  const k = flat(lineKey);
  if (k.length < 6) return false;
  return presetKeys()[trade].some((p) => p === k || (p.length >= 6 && (k.startsWith(p + " ") || p.startsWith(k + " "))));
}

/** The votes each trade gets from a proposal's material lines. */
export function lineVotes(lines: readonly StockLine[]): Record<TradeId, number> {
  const votes: Record<TradeId, number> = { roof: 0, fence: 0, hvac: 0, deck: 0 };
  for (const l of lines) {
    if (!(l.quantity > 0)) continue;
    const key = stockKey(l.name);
    if (!key) continue;
    if (fenceTypeForLine(l.name)) {
      votes.fence += 2;
      continue;
    }
    for (const t of ALL) if (namesPreset(key, t) || WORDS[t].test(l.name)) votes[t] += 1;
  }
  return votes;
}

/** The trade a proposal belongs to, or null when it belongs to none of the three. */
export function proposalTrade(p: TradeEvidence): TradeId | null {
  if (isTradeId(p.trade)) return p.trade;
  if (p.hvacEstimate) return "hvac";
  if (p.roofMeasurement) return "roof";
  const lines = p.lines.filter((l) => l.quantity > 0 && stockKey(l.name));
  const votes = lineVotes(lines);
  const best = ALL.reduce((a, t) => (votes[t] > votes[a] ? t : a), ALL[0]);
  const top = votes[best];
  const tied = ALL.filter((t) => votes[t] === top).length > 1;
  // One line decides a one- or two-line proposal; a longer one needs two.
  const need = lines.length <= 2 ? 1 : 2;
  if (top >= need && !tied) return best;
  const profile = detectTrade(`${p.title ?? ""} ${p.description ?? ""}`);
  return PROFILE[profile.id] ?? null;
}
