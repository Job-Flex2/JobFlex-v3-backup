// THE FRAMING CODE BY STATE (owner, 2026-10-11: "use the framing code for
// structures for all states"). Every state adopts the International
// Residential Code in its own edition and with its own amendments — or
// leaves it to its cities, or (Wisconsin) writes its own. What changes for a
// deck: the guard's height (California asks 42 in., not 36), the stair's
// riser and tread (New Jersey, New York, Pennsylvania, Massachusetts,
// Virginia, North Carolina and Ohio allow 8¼-in. risers on 9-in. treads;
// Wisconsin and Utah 8 on 9), whether a statewide code exists at all, and
// the hazards the state's amendments add (wind, seismic, wildfire). The
// span tables themselves (joists, beams, posts, footings) are the IRC's
// R507 and AWC DCA 6 in every state; North Carolina's Appendix M and the
// Wisconsin UDC run close to them and are named where they govern.
//
// Pure. The figures are as of CODES_AS_OF; a state marked `verify` has an
// edition in adoption or leaves the code to its cities — the strip says so,
// and every line says to confirm the edition with the building office.

export const CODES_AS_OF = 2025;

export interface DeckStateCode {
  /** Two letters, or "" for the plain IRC. */
  state: string;
  /** "2021 Virginia Residential Code — USBC (2021 IRC with Virginia amendments)". */
  name: string;
  /** For a citation: "VRC 2021 R311.7.5.1". */
  short: string;
  /** The IRC edition under it; null for a code of its own. */
  basis: 2015 | 2018 | 2021 | 2024 | null;
  /** The year the edition took effect, when known. */
  since: number | null;
  /** False: no statewide residential code — the city or county adopts one. */
  statewide: boolean;
  /** The guard's least height where the surface is more than 30 in. up. */
  guardIn: 36 | 42;
  /** The stair's most riser and least tread. */
  riserMaxIn: 7.75 | 8 | 8.25;
  treadMinIn: 9 | 10;
  /** The ledger's lateral-load connection is required (every edition from 2015 on). */
  lateral: boolean;
  /** Deck-relevant amendments and hazards, in plain words. */
  notes: string[];
  /** The edition in force should be confirmed: a new one is in adoption, or the adoption is local. */
  verify: boolean;
}

const STATE_NAME: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "the District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};
export const stateName = (state: string | null | undefined): string | null => (state ? STATE_NAME[state.toUpperCase()] ?? null : null);

type Extra = Partial<Omit<DeckStateCode, "state" | "name" | "short" | "basis" | "since">>;
const irc = (state: string, name: string, short: string, basis: DeckStateCode["basis"], since: number | null, extra: Extra = {}): DeckStateCode => ({ state, name, short, basis, since, statewide: true, guardIn: 36, riserMaxIn: 7.75, treadMinIn: 10, lateral: true, notes: [], verify: false, ...extra });
const local = (state: string, examples: string, more: string[] = []): DeckStateCode => ({
  state,
  name: `2021 International Residential Code as the cities and counties of ${STATE_NAME[state]} adopt it (${examples})`,
  short: "IRC",
  basis: 2021,
  since: null,
  statewide: false,
  guardIn: 36,
  riserMaxIn: 7.75,
  treadMinIn: 10,
  lateral: true,
  notes: [`${STATE_NAME[state]} has no statewide residential code: the city or county that issues the permit names the IRC edition and its amendments — the figures here are the 2021 IRC's.`, ...more],
  verify: true,
});
const STAIR_8_25 = (who: string) => `Stairs: risers up to 8¼ in. on treads at least 9 in. deep (${who}'s amendment to R311.7.5); the IRC's 7¾ and 10 are the stricter figure where an inspector asks for it.`;

/** The plain IRC, for a job with no state: what most of the country's offices enforce. */
export const IRC_CODE: DeckStateCode = irc("", "2021 International Residential Code, as commonly adopted", "IRC", 2021, null, { statewide: false, verify: true, notes: ["No state is set: the figures are the 2021 IRC's. Set the job address and the state's own code is used."] });


export const DECK_STATE_CODES: Record<string, DeckStateCode> = {
  AL: irc("AL", "Alabama Residential Code (2021 IRC with Alabama amendments)", "ARC 2021", 2021, 2023, { verify: true, notes: ["Wind along the Gulf: Mobile and Baldwin counties ask for uplift connections on a roof."] }),
  AK: local("AK", "Anchorage: 2021 IRC", ["Frost runs 42 in. and deeper, and the seismic category is high: the posts braced to the beams."]),
  AZ: local("AZ", "Phoenix and Tucson: 2018 IRC; Mesa and Scottsdale: 2021"),
  AR: irc("AR", "Arkansas Fire Prevention Code, Volume III — Residential (2021 IRC)", "AFPC 2021", 2021, 2024, { verify: true }),
  CA: irc("CA", "2022 California Residential Code — Title 24, Part 2.5 (2021 IRC with California amendments)", "CRC 2022", 2021, 2023, {
    guardIn: 42,
    verify: true,
    notes: [
      "Guards 42 in. high at least (CRC R312.1.2), not the IRC's 36.",
      "In a Fire Hazard Severity Zone the decking and the deck's underside must meet Chapter 7A (ignition-resistant); the county's map says whether the lot is in one.",
      "Seismic Design Category D and up: the posts braced to the beams and the beams fastened, never toe-nailed.",
      "The 2025 CRC (on the 2024 IRC) takes over on January 1, 2026 — confirm which edition the permit is under.",
    ],
  }),
  CO: local("CO", "Denver, Boulder and most Front Range counties: 2021 IRC", ["Ground snow runs from 30 psf on the plains to 100 and more in the mountains; the county's figure governs the design load."]),
  CT: irc("CT", "2022 Connecticut State Building Code (2021 IRC with Connecticut amendments)", "CSBC 2022", 2021, 2022, { verify: true, notes: ["Connecticut's amendments may allow 8¼-in. risers on 9-in. treads in a dwelling — confirm with the building department before using them; the figures here are the IRC's 7¾ and 10."] }),
  DE: local("DE", "New Castle and Kent counties: 2018 IRC; Sussex County: 2021"),
  DC: irc("DC", "District of Columbia Residential Code (2017, on the 2015 IRC; a 2021-based edition is in adoption)", "DCRC", 2015, 2020, { verify: true }),
  FL: irc("FL", "Florida Building Code, Residential — 8th Edition (2023), on the 2021 IRC", "FBC-R 2023", 2021, 2023, {
    notes: [
      "Wind: a roof over the deck and its posts are designed to the ASCE 7-22 wind speeds — hurricane ties on every rafter, uplift connectors at every post.",
      "Miami-Dade and Broward are the High-Velocity Hurricane Zone: product approvals and the HVHZ sections apply.",
      "Termite hazard very heavy: treated or naturally durable wood throughout, flashed, and clear of the soil.",
    ],
  }),
  GA: irc("GA", "Georgia One- and Two-Family Dwelling Code (2018 IRC with Georgia amendments)", "GA IRC 2018", 2018, 2020, { verify: true, notes: ["Georgia has adopted the 2024 IRC with amendments for January 2026 — confirm which edition the county is enforcing."] }),
  HI: irc("HI", "Hawaii State Building Code — residential (2018 IRC, adopted by each county with its amendments)", "HI IRC 2018", 2018, null, { verify: true, notes: ["Wind and termite: each county's amendments govern; Honolulu's are the most detailed."] }),
  ID: irc("ID", "Idaho Residential Code (2018 IRC with Idaho amendments)", "IRC-ID 2018", 2018, 2021, { verify: true }),
  IL: local("IL", "Chicago has its own building code; the suburbs 2018 or 2021 IRC"),
  IN: irc("IN", "2020 Indiana Residential Code (2018 IRC with Indiana amendments)", "IRC-IN 2020", 2018, 2020),
  IA: irc("IA", "Iowa State Building Code — residential (2021 IRC)", "IA IRC 2021", 2021, null, { verify: true, notes: ["The state code binds only where a city or county enforces it; most of Iowa's cities do."] }),
  KS: local("KS", "Wichita, Overland Park and Johnson County: 2018 IRC"),
  KY: irc("KY", "Kentucky Residential Code (2018 IRC with Kentucky amendments)", "KRC 2018", 2018, 2019, { verify: true, notes: ["A 2021-based Kentucky Residential Code is in adoption — confirm the edition."] }),
  LA: irc("LA", "Louisiana State Uniform Construction Code — residential (2021 IRC)", "LSUCC 2021", 2021, 2023, { verify: true, notes: ["Wind in the coastal parishes: the roof's uplift connections follow the wind map."] }),
  ME: irc("ME", "Maine Uniform Building and Energy Code — MUBEC (2021 IRC)", "MUBEC 2021", 2021, null, { verify: true, notes: ["Towns under 4,000 people need not enforce MUBEC; the frost line runs 48 to 72 in."] }),
  MD: irc("MD", "Maryland Building Performance Standards (2021 IRC with Maryland amendments; the county adds its own)", "MBPS 2021", 2021, 2023, { verify: true }),
  MA: irc("MA", "780 CMR, Massachusetts State Building Code, 10th Edition — residential (2021 IRC with Massachusetts amendments)", "780 CMR 10", 2021, 2024, { riserMaxIn: 8.25, treadMinIn: 9, notes: [STAIR_8_25("Massachusetts")] }),
  MI: irc("MI", "Michigan Residential Code (2015 IRC with Michigan amendments)", "MRC 2015", 2015, 2016, { verify: true, notes: ["A 2021-based Michigan Residential Code is in adoption — confirm the edition."] }),
  MN: irc("MN", "Minnesota Residential Code, Chapter 1309 (the 2020 edition on the 2018 IRC; the 2024 edition on the 2021 IRC follows)", "MN 1309", 2018, 2020, { verify: true, notes: ["Frost 42 to 60 in. north of the Twin Cities; the footing depth is the county's call."] }),
  MS: local("MS", "the coastal counties and Jackson: 2018 IRC", ["Mississippi's state minimum code applies only where a county or city opts in."]),
  MO: local("MO", "St. Louis and Kansas City: 2018 IRC"),
  MT: irc("MT", "Montana residential code (2021 IRC with Montana amendments)", "MT IRC 2021", 2021, 2022, { verify: true }),
  NE: irc("NE", "Nebraska State Building Code — residential (2018 IRC)", "NE IRC 2018", 2018, 2020, { verify: true }),
  NV: local("NV", "Clark County and Southern Nevada: 2018 IRC; Washoe County: 2018"),
  NH: irc("NH", "New Hampshire State Building Code — residential (2018 IRC with New Hampshire amendments)", "NH IRC 2018", 2018, 2022, { verify: true }),
  NJ: irc("NJ", "International Residential Code, New Jersey Edition (2021 IRC with New Jersey amendments)", "IRC-NJ 2021", 2021, 2023, { riserMaxIn: 8.25, treadMinIn: 9, verify: true, notes: [STAIR_8_25("New Jersey")] }),
  NM: irc("NM", "New Mexico Residential Building Code (2021 IRC with New Mexico amendments)", "NMRBC 2021", 2021, null, { verify: true }),
  NY: irc("NY", "2020 Residential Code of New York State (2018 IRC with New York amendments)", "RCNYS 2020", 2018, 2020, { riserMaxIn: 8.25, treadMinIn: 9, verify: true, notes: [STAIR_8_25("New York"), "New York City has its own Building Code; this is the state code outside the five boroughs.", "A 2021-based Uniform Code is in adoption — confirm the edition."] }),
  NC: irc("NC", "2018 North Carolina Residential Code (2015 IRC with North Carolina amendments)", "NCRC 2018", 2015, 2019, { riserMaxIn: 8.25, treadMinIn: 9, verify: true, notes: [STAIR_8_25("North Carolina"), "Appendix M gives North Carolina's own deck span tables and details; where they differ from the IRC and DCA 6 tables used here, Appendix M governs.", "The 2024 North Carolina Residential Code (on the 2021 IRC) is in adoption — confirm the edition."] }),
  ND: irc("ND", "North Dakota State Building Code — residential (2021 IRC)", "ND IRC 2021", 2021, 2023, { verify: true }),
  OH: irc("OH", "Residential Code of Ohio (the 2024 edition on the 2021 IRC)", "RCO 2024", 2021, 2024, { riserMaxIn: 8.25, treadMinIn: 9, verify: true, notes: [STAIR_8_25("Ohio")] }),
  OK: irc("OK", "Oklahoma Residential Code (2018 IRC with Oklahoma amendments)", "OK IRC 2018", 2018, 2021, { verify: true, notes: ["The 2021 IRC with Oklahoma amendments is in adoption — confirm the edition."] }),
  OR: irc("OR", "2023 Oregon Residential Specialty Code (2021 IRC with Oregon amendments)", "ORSC 2023", 2021, 2023, { notes: ["Seismic: the posts braced to the beams; west of the Cascades the footings carry the wet-season soil figure."] }),
  PA: irc("PA", "Pennsylvania Uniform Construction Code — residential (2018 IRC with Pennsylvania amendments)", "PA UCC 2018", 2018, 2022, { riserMaxIn: 8.25, treadMinIn: 9, verify: true, notes: [STAIR_8_25("Pennsylvania"), "Philadelphia enforces its own amendments on top."] }),
  RI: irc("RI", "Rhode Island State Building Code, SBC-2 — residential (2021 IRC with Rhode Island amendments)", "RI SBC-2", 2021, null, { verify: true }),
  SC: irc("SC", "South Carolina Residential Code (2021 IRC with South Carolina modifications)", "SCRC 2021", 2021, 2024, { verify: true, notes: ["Wind along the coast: the roof's uplift connections follow the wind map."] }),
  SD: local("SD", "Sioux Falls and Rapid City: 2021 IRC"),
  TN: irc("TN", "Tennessee residential code (2018 IRC, adopted by the State Fire Marshal's Office; a city may adopt its own)", "TN IRC 2018", 2018, 2020, { verify: true }),
  TX: local("TX", "Austin, Dallas, Houston and San Antonio: 2021 IRC; the state names the IRC for its cities in Local Government Code 214.212", ["Along the coast the windstorm rules (TDI) ask for uplift connections on a roof."]),
  UT: irc("UT", "Utah residential code (2021 IRC with Utah amendments, Title 15A)", "UT IRC 2021", 2021, 2023, { riserMaxIn: 8, treadMinIn: 9, verify: true, notes: ["Stairs: risers up to 8 in. on treads at least 9 in. deep (Utah's amendment to R311.7.5)."] }),
  VT: local("VT", "no residential code for one- and two-family homes beyond fire and energy; Burlington adopts the IRC"),
  VA: irc("VA", "2021 Virginia Residential Code — USBC (2021 IRC with Virginia amendments)", "VRC 2021", 2021, 2024, { riserMaxIn: 8.25, treadMinIn: 9, notes: [STAIR_8_25("Virginia")] }),
  WA: irc("WA", "2021 Washington State Residential Code (2021 IRC with Washington amendments)", "WSRC 2021", 2021, 2024, { notes: ["Seismic: the posts braced to the beams and the beams fastened; the Puget Sound counties ask for it on every deck."] }),
  WV: irc("WV", "West Virginia State Building Code — residential (2018 IRC)", "WV IRC 2018", 2018, 2020, { verify: true }),
  WI: irc("WI", "Wisconsin Uniform Dwelling Code, SPS 320–325 (Wisconsin's own code, not the IRC)", "UDC", null, null, {
    riserMaxIn: 8,
    treadMinIn: 9,
    notes: ["Stairs: risers up to 8 in. on treads at least 9 in. deep (SPS 321.04).", "The UDC's own deck provisions and the state's sample deck plans govern the spans; the IRC and DCA 6 tables used here run close to them — confirm with the municipality.", "Guards 36 in. (SPS 321.04(3))."],
  }),
  WY: local("WY", "Cheyenne and Casper: 2018 IRC; Teton County: 2021"),
};

/** The code a job is checked against: its state's, or the plain IRC when there is none. */
export function deckCodeFor(state: string | null | undefined): DeckStateCode {
  const s = (state ?? "").trim().toUpperCase();
  return DECK_STATE_CODES[s] ?? IRC_CODE;
}

/** 7.75 → "7¾ in.", 8.25 → "8¼ in.", 8 → "8 in." */
export function inFrac(n: number): string {
  const whole = Math.floor(n);
  const f = Math.round((n - whole) * 4);
  return `${f === 0 ? whole : `${whole}${f === 1 ? "¼" : f === 2 ? "½" : "¾"}`} in.`;
}

/** "VRC 2021 R311.7.5.1 — risers no more than 8¼ in." */
export const cite = (code: DeckStateCode, section: string, words?: string): string => `${code.short} ${section}${words ? ` — ${words}` : ""}`;

/** The code in a sentence for the strip, the notes and the permit set. */
export function codeWords(code: DeckStateCode): string {
  const since = code.since ? `, in force since ${code.since}` : "";
  const where = code.statewide ? "" : code.state ? " — no statewide code: the city or county names the edition" : " — set the job address for the state's own code";
  const check = code.verify && code.statewide ? " — confirm the edition in force with the building office" : "";
  return `Builds to the ${code.name}${since}: guards ${code.guardIn} in., risers no more than ${inFrac(code.riserMaxIn)}, treads at least ${code.treadMinIn} in.${where}${check} (as of ${CODES_AS_OF}).`;
}
