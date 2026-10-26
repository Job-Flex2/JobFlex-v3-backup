// What the cost guides say about a place beyond its price (2026-10-26) —
// read from data JobFlex already keeps, never written for the page. A fact
// that is missing for a state is null, and the page leaves that block out
// instead of filling it with general words.
//
//   sales tax ........ lib/pricing/salesTax (the state's base rate)
//   labor taxed ...... lib/fence/market (states that tax installation labor)
//   frost depth ...... lib/fence/market (typical code frost depth, inches)
//   lumber region .... lib/fence/market (which wood is milled nearby)
//   deck code ........ lib/deck/stateCodes (edition, guard height, notes)
//   deck boards ...... lib/deck/regional (what decks are built of there)
//   design temps ..... lib/hvac/designConditions (ENERGY STAR county table, state median)
//   permits .......... lib/estimate/permits (the IRC exemptions JobFlex applies)
//
// Plain module, no I/O.

import { stateTaxRate } from "@/lib/pricing/salesTax";
import { STATE_MARKETS } from "@/lib/fence/market";
import { deckCodeFor, type DeckStateCode } from "@/lib/deck/stateCodes";
import { regionalPicks, regionalWords } from "@/lib/deck/regional";
import { designConditionsFor } from "@/lib/hvac/designConditions";
import { permitCall, type PermitCall } from "@/lib/estimate/permits";
import type { SeoTrade, SeoTradeSlug } from "./trades";

export type StateFacts = {
  /** Base state sales tax, 0.0625; 0 is a real answer (OR, MT, NH, DE, AK). */
  salesTax: number | null;
  /** Installation labor on real property is itself taxed there. */
  laborTaxed: boolean;
  /** Typical code frost depth, inches; 0 = no frost consideration. */
  frostIn: number | null;
  /** Which lumber is local: the fence market's basis region. */
  lumber: "pnw" | "west" | "south" | "midwest" | "northeast" | "alaska" | "hawaii" | null;
  deckCode: DeckStateCode | null;
  /** "Most used on decks in …: treated pine, then …". */
  deckBoards: string | null;
  /** The state median of the county design temperatures, °F, and the moisture class. */
  design: { coolingF: number; heatingF: number; humidity: string; median: boolean } | null;
};

const cache = new Map<string, StateFacts>();

export function stateFacts(state: string): StateFacts {
  const hit = cache.get(state);
  if (hit) return hit;
  const market = STATE_MARKETS[state];
  const code = deckCodeFor(state);
  const picks = regionalPicks(state);
  const d = designConditionsFor(state, null);
  const facts: StateFacts = {
    salesTax: stateTaxRate(state),
    laborTaxed: market?.laborTax === true,
    frostIn: market ? market.frost : null,
    lumber: market?.region ?? null,
    // deckCodeFor answers the plain IRC for a state it does not know.
    deckCode: code.state === state ? code : null,
    deckBoards: picks ? regionalWords(picks) : null,
    design: d.match === "none" ? null : { coolingF: d.conditions.coolingF, heatingF: d.conditions.heatingF, humidity: d.conditions.humidity, median: d.match === "state" },
  };
  cache.set(state, facts);
  return facts;
}

/** The permit rule JobFlex's estimator applies to this work, asked with a plain brief of it. */
const PERMIT_BRIEF: Record<SeoTradeSlug, string> = {
  "roof-replacement": "Roof replacement: tear off the old shingles and install a new roof",
  "fence-installation": "Install a new 6 ft privacy fence",
  "hvac-replacement": "Replace the furnace and air conditioner with a new system",
  "deck-building": "Build a new deck off the back of the house",
  "siding-installation": "Replace the siding on the house",
  "house-painting": "Paint the interior walls and ceilings",
};

export function permitFor(trade: SeoTrade): PermitCall | null {
  return permitCall({ text: PERMIT_BRIEF[trade.slug], specialtyId: trade.specialty, scope: "full" });
}

/** What the fence market's basis region says about the wood, in a homeowner's words. */
export const LUMBER_WORDS: Record<NonNullable<StateFacts["lumber"]>, string> = {
  pnw: "Western red cedar comes off Pacific Northwest mills, so cedar is the local fence wood and treated pine is shipped in",
  west: "both cedar and treated pine travel a long way to reach the yards here, so neither is a local bargain",
  south: "Southern yellow pine is milled in the region, so treated pine is the local fence wood and cedar is trucked in",
  midwest: "the region sits between the cedar and the pine mills, with no strong local advantage for either",
  northeast: "yards are close together but nearly all fence lumber is shipped in",
  alaska: "every fence material, cedar included, arrives by barge or truck",
  hawaii: "every fence material crosses the Pacific in a container",
};
