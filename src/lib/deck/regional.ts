// WHAT DECKS ARE BUILT OF, REGION BY REGION (2026-10-12, owner: "check all the lists — the most popular materials,
// brands for decking, and what is most popular per state"). Pure data.
//
// No public source counts deck materials state by state (Home Innovation sells that by county, for a fee). What is
// public, and what this table reads, region = the Census division the state is in:
//  - the NAHB / Home Innovation Builder Practices Survey: the leading deck material on NEW homes, by division, for
//    homes built in 2022, 2023 and 2024 (eyeonhousing.org, Dec 2023, Oct 2024, Nov 2025);
//  - the USDA Forest Service / CINTRAFOR deck surveys (Brackley & Eastin, 2005): what deck surfaces are made of — the
//    East 47% treated, 32% composite, 9% cedar; the West Coast 41% composite, 20% redwood, 16% cedar, 7% treated;
//  - where treated lumber is made and stocked: Southern pine east of the Rockies (about 85% of all treated wood),
//    hem-fir and Douglas fir in the West; Douglas fir for California's joists and for Hawaii's treated stock.
// Wood is still about three quarters of REMODEL decking, so a new design starts on the region's treated board except
// where treated decking is a small share (the Pacific coast and Hawaii), and the list shows the region's leaders first.
// The research and its links: the session notes of 2026-10-12 (regional-sources.md).

import type { FramingSpeciesId } from "./catalog";

export type DeckRegion =
  | "new-england"
  | "mid-atlantic"
  | "great-lakes"
  | "plains"
  | "south-atlantic"
  | "south-central-east"
  | "south-central-west"
  | "mountain"
  | "california"
  | "northwest"
  | "alaska"
  | "hawaii";

export interface RegionalPicks {
  region: DeckRegion;
  /** Reads after "in": "in the Mountain states". */
  name: string;
  /** The treated framing lumber the region's yards stock. */
  framing: FramingSpeciesId;
  /** The region's treated deck board — the Good tier. */
  treatedBoard: string;
  /** Where a new design starts. */
  defaultBoard: string;
  /** The boards most used there, most used first (catalog ids). */
  decking: readonly string[];
}

const STATE_REGION: Readonly<Record<string, DeckRegion>> = {
  CT: "new-england", ME: "new-england", MA: "new-england", NH: "new-england", RI: "new-england", VT: "new-england",
  NJ: "mid-atlantic", NY: "mid-atlantic", PA: "mid-atlantic",
  OH: "great-lakes", IN: "great-lakes", IL: "great-lakes", MI: "great-lakes", WI: "great-lakes",
  MN: "plains", IA: "plains", MO: "plains", KS: "plains", NE: "plains", ND: "plains", SD: "plains",
  DE: "south-atlantic", DC: "south-atlantic", FL: "south-atlantic", GA: "south-atlantic", MD: "south-atlantic", NC: "south-atlantic", SC: "south-atlantic", VA: "south-atlantic", WV: "south-atlantic",
  AL: "south-central-east", KY: "south-central-east", MS: "south-central-east", TN: "south-central-east",
  AR: "south-central-west", LA: "south-central-west", OK: "south-central-west", TX: "south-central-west",
  AZ: "mountain", CO: "mountain", ID: "mountain", MT: "mountain", NV: "mountain", NM: "mountain", UT: "mountain", WY: "mountain",
  CA: "california",
  OR: "northwest", WA: "northwest",
  AK: "alaska",
  HI: "hawaii",
};

const EAST = { framing: "southern-pine", treatedBoard: "pt-pine-54", defaultBoard: "pt-pine-54" } as const;
const WEST = { framing: "hem-fir", treatedBoard: "pt-hemfir-2x6" } as const;

export const REGIONS: Readonly<Record<DeckRegion, RegionalPicks>> = {
  // Treated wood led new-home decks for 2022 and 2024 homes, composite for 2023; PVC is used here more than anywhere.
  "new-england": { region: "new-england", name: "New England", ...EAST, decking: ["pt-pine-54", "composite-better", "pvc"] },
  // Composite led all three years.
  "mid-atlantic": { region: "mid-atlantic", name: "New York, New Jersey and Pennsylvania", ...EAST, decking: ["composite-better", "pt-pine-54", "pvc"] },
  "great-lakes": { region: "great-lakes", name: "the Great Lakes states", ...EAST, decking: ["composite-better", "pt-pine-54", "cedar-54"] },
  // Treated for 2022 and 2023 homes, composite for 2024.
  plains: { region: "plains", name: "the Plains states", ...EAST, decking: ["pt-pine-54", "composite-better", "cedar-54"] },
  // Treated led all three years; the East's decks overall: 47% treated, 32% composite, 9% cedar.
  "south-atlantic": { region: "south-atlantic", name: "the South Atlantic states", ...EAST, decking: ["pt-pine-54", "composite-better", "cedar-54"] },
  "south-central-east": { region: "south-central-east", name: "Alabama, Kentucky, Mississippi and Tennessee", ...EAST, decking: ["pt-pine-54", "composite-better", "cedar-54"] },
  // Composite for 2022 homes, treated for 2023 and 2024.
  "south-central-west": { region: "south-central-west", name: "Texas, Oklahoma, Arkansas and Louisiana", ...EAST, decking: ["pt-pine-54", "composite-better", "cedar-54"] },
  // Composite for 2022 and 2023 homes, treated for 2024; the West's decks overall: 34% composite, 21% treated.
  mountain: { region: "mountain", name: "the Mountain states", ...WEST, defaultBoard: "pt-hemfir-2x6", decking: ["composite-better", "pt-hemfir-2x6", "cedar-54"] },
  // The West Coast's decks: 41% composite, 20% redwood, 16% cedar, 7% treated; joists in Douglas fir.
  california: { region: "california", name: "California", ...WEST, framing: "douglas-fir", defaultBoard: "composite-better", decking: ["composite-better", "redwood-2x6", "cedar-54"] },
  // Composite is now the main board on new decks; cedar the traditional one.
  northwest: { region: "northwest", name: "Oregon and Washington", ...WEST, defaultBoard: "composite-better", decking: ["composite-better", "cedar-2x6", "pt-hemfir-2x6"] },
  // No Alaska-specific source: the Northwest's supply.
  alaska: { region: "alaska", name: "Alaska", ...WEST, defaultBoard: "pt-hemfir-2x6", decking: ["pt-hemfir-2x6", "composite-better", "cedar-2x6"] },
  // Termites: structural wood is treated (Douglas fir from the Northwest); composite is termite-proof; ipe is favoured.
  hawaii: { region: "hawaii", name: "Hawaii", ...WEST, framing: "douglas-fir", defaultBoard: "composite-better", decking: ["composite-better", "ipe-1x6", "pt-hemfir-2x6"] },
};

/** The region a state's decks are built like; null for an unknown state. */
export function regionalPicks(state: string | null | undefined): RegionalPicks | null {
  const region = STATE_REGION[(state ?? "").trim().toUpperCase()];
  return region ? REGIONS[region] : null;
}

/** Every state (and DC) the table knows. */
export const REGIONAL_STATES: readonly string[] = Object.keys(STATE_REGION);

/** How a board is named in "most used here" — the material, not the product. */
export const REGIONAL_BOARD_WORDS: Readonly<Record<string, string>> = {
  "pt-pine-54": "treated pine",
  "pt-hemfir-2x6": "treated hem-fir or fir 2x6",
  "composite-better": "capped composite",
  pvc: "PVC",
  "cedar-54": "cedar",
  "cedar-2x6": "cedar",
  "redwood-2x6": "redwood",
  "ipe-1x6": "ipe",
};

/** "Most used on decks in the Mountain states: capped composite, then treated hem-fir or fir 2x6, then cedar." */
export function regionalWords(picks: RegionalPicks): string {
  return `Most used on decks in ${picks.name}: ${picks.decking.map((id) => REGIONAL_BOARD_WORDS[id] ?? id).join(", then ")}.`;
}
