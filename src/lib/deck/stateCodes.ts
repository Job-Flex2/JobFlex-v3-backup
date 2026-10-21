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

// Re-checked state by state against the adopting agencies' own pages on 2026-10-20 (the county research,
// lib/deck/countyCodes): editions, years, stair amendments and the deck-relevant notes.
export const CODES_AS_OF = 2026;

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
const local = (state: string, examples: string, more: string[] = [], basis: DeckStateCode["basis"] = 2021): DeckStateCode => ({
  state,
  name: `International Residential Code as the cities and counties of ${STATE_NAME[state]} adopt it (${examples})`,
  short: "IRC",
  basis,
  since: null,
  statewide: false,
  guardIn: 36,
  riserMaxIn: 7.75,
  treadMinIn: 10,
  lateral: true,
  notes: [`${STATE_NAME[state]} has no statewide residential code: the city or county that issues the permit names the IRC edition and its amendments — the figures here are the ${basis ?? 2021} IRC's.`, ...more],
  verify: true,
});
const STAIR_8_25 = (who: string) => `Stairs: risers up to 8¼ in. on treads at least 9 in. deep (${who}'s amendment to R311.7.5); the IRC's 7¾ and 10 are the stricter figure where an inspector asks for it.`;

/** The plain IRC, for a job with no state: what most of the country's offices enforce. */
export const IRC_CODE: DeckStateCode = irc("", "2021 International Residential Code, as commonly adopted", "IRC", 2021, null, { statewide: false, verify: true, notes: ["No state is set: the figures are the 2021 IRC's. Set the job address and the state's own code is used."] });


export const DECK_STATE_CODES: Record<string, DeckStateCode> = {
  AL: local("AL", "Mobile County: 2024 IRC since July 2026; Birmingham: 2021 IRC; the state-level code on record is the 2015 IRC with Alabama changes", ["Only local governments with a permit program enforce a residential code; from January 1, 2027 builders follow the code the Home Builders Licensure Board adopts, or the local code.", "Wind along the Gulf: Mobile and Baldwin counties ask for uplift connections on a roof (160 mph in Mobile County)."], 2015),
  AK: local("AK", "Anchorage: 2024 IRC (2026); the City of Fairbanks: 2018 IRC; the Fairbanks North Star Borough has no building code", ["Anchorage asks deck piers and free-standing footings 120 in. deep (60 in. in soil that does not heave), not the house's 42 in.; an attached deck up to 72 in. high may sit on the ground unless a door swings onto it.", "The seismic category is high: the posts braced to the beams and every connection fastened, never toe-nailed."], 2024),
  AZ: local("AZ", "Phoenix: 2024 IRC since August 2025; Pima County: 2024 IRC since 2026; unincorporated Maricopa County: 2018 IRC", [], 2024),
  AR: irc("AR", "Arkansas Fire Prevention Code, Volume III — Residential (2021 IRC)", "AFPC 2021", 2021, null, { verify: true, notes: ["Enforced by 2023 in Little Rock; the exact state start date is unconfirmed."] }),
  CA: irc("CA", "2025 California Residential Code — Title 24, Part 2.5 (2024 IRC with California amendments)", "CRC 2025", 2024, 2026, {
    guardIn: 42,
    notes: [
      "Guards 42 in. high at least (CRC R321.1.2), not the IRC's 36; a guard on the open side of a stair may be 34 in.",
      "In a Fire Hazard Severity Zone or a wildland-urban interface area the decking must meet the 2025 California Wildland-Urban Interface Code (Title 24, Part 7); the county's map says whether the lot is in one.",
      "Seismic Design Category D and up: the posts braced to the beams and the beams fastened, never toe-nailed.",
      "California keeps its rule on ventilation beneath balconies and elevated walking surfaces (CRC R304.1.3).",
    ],
  }),
  CO: local("CO", "Denver: 2025 Denver Building Code on the 2024 IRC; Jefferson County: 2024 IRC; Pikes Peak Regional and Arapahoe County: 2021 IRC", ["Ground snow: 43 psf in Denver, Colorado Springs (below 7,000 ft) and Jefferson County (below 6,500 ft), rising with elevation to 100 psf and more in the mountains — the county's figure sets the deck's design load.", "Arapahoe and Jefferson counties permit every deck; Denver and Pikes Peak keep the 200 sq ft / 30 in. exemption."], 2024),
  CT: irc("CT", "2022 Connecticut State Building Code (2021 IRC with Connecticut amendments)", "CSBC 2022", 2021, 2022, { riserMaxIn: 8.25, treadMinIn: 9, notes: [STAIR_8_25("Connecticut"), "The 2026 Connecticut code (on the 2024 IRC) is waiting on the legislature — confirm the edition once it takes effect."] }),
  DE: local("DE", "New Castle County: 2021 IRC since 2024 (the 2024 IRC reported from 2026); Kent County: 2018 IRC; Sussex County: 2021 IRC", ["Kent County asks a permit for any deck over 16 sq ft."]),
  DC: irc("DC", "District of Columbia Residential Code (2017, on the 2015 IRC)", "DCRC 2017", 2015, 2020, { verify: true, notes: ["DC is moving straight to the 2024 codes (a first proposal in fall 2026) — confirm the edition.", "Every deck needs a permit in DC: there is no size exemption."] }),
  FL: irc("FL", "Florida Building Code, Residential — 8th Edition (2023), on the 2021 IRC", "FBC-R 2023", 2021, 2023, {
    notes: [
      "Wind: a roof over the deck and its posts are designed to the ASCE 7-22 wind speeds — hurricane ties on every rafter, uplift connectors at every post.",
      "Miami-Dade and Broward are the High-Velocity Hurricane Zone: product approvals and the HVHZ sections apply.",
      "Termite hazard very heavy: treated or naturally durable wood throughout, flashed, and clear of the soil.",
      "No frost line in Florida, but deck footings still go at least 12 in. below grade (R403.1.4). The 9th edition (on the 2024 IRC) takes effect December 31, 2026.",
    ],
  }),
  GA: irc("GA", "Georgia State Minimum Standard One- and Two-Family Dwelling Code (2024 IRC with Georgia amendments)", "GA IRC 2024", 2024, 2026, { notes: ["Georgia rewrites R507.9.1.3: ½-in. ledger lags are predrilled ½ in. through the ledger and 5/16–3/8 in. into the band.", "Georgia redraws the lateral-load figures R507.9.2(1) and (2): hold-downs of at least 750 lb at four places where the house joists run parallel to and offset from the deck's."] }),
  HI: irc("HI", "Hawaii State Residential Code (2018 IRC with state amendments, adopted by each county with its own)", "HI IRC 2018", 2018, 2020, { verify: true, notes: ["Termite protection by one of termiticide, baiting or a physical barrier, plus pressure-treated, naturally durable wood or steel framing (state amendment R318.1).", "Raised floors on post or pier foundations are designed to accepted engineering practice (state amendment R401.5) — the county may ask an engineer's letter for a deck."] }),
  ID: irc("ID", "Idaho Residential Code (2018 IRC with Idaho amendments)", "IRC-ID 2018", 2018, 2021, { verify: true }),
  IL: local("IL", "unincorporated Cook County: 2021 IRC; DuPage County: its own county building code; Chicago: the Chicago Building Code", ["Footings around Chicago go 42 in. deep."]),
  IN: irc("IN", "2020 Indiana Residential Code, 675 IAC 14-4.4 (2018 IRC with Indiana amendments)", "IRC-IN 2020", 2018, 2019, { riserMaxIn: 8.25, treadMinIn: 9, notes: [STAIR_8_25("Indiana"), "Indiana publishes one statewide table with each county's footing depth and snow load (675 IAC 14-4.4-5).", "Deck posts on concrete footings need manufactured connectors or at least 12 in. of embedment against lateral movement (675 IAC 14-4.4-69)."] }),
  IA: irc("IA", "Iowa State Building Code, 481 IAC ch. 301 — residential (2024 IRC with Iowa amendments)", "IA IRC 2024", 2024, 2025, { statewide: false, verify: true, notes: ["The state code binds only where a city or county adopts it: Des Moines and Cedar Rapids are on the 2024 IRC, Davenport on the 2021.", "Iowa sets no statewide design table: the city gives the frost line (42 in. around Des Moines and Cedar Rapids)."] }),
  KS: local("KS", "Wichita, Sedgwick County and unincorporated Johnson County: 2018 IRC; Topeka: 2021 IRC", ["Johnson County votes on the 2024 codes on October 22, 2026 (effective January 1, 2027 if adopted); its deck guidelines are used by every Johnson County city.", "Wichita and Sedgwick County use a 24-in. frost depth."], 2018),
  KY: irc("KY", "2018 Kentucky Residential Code, Third Edition (2015 IRC with Kentucky amendments, 815 KAR 7:125)", "KRC 2018", 2015, 2018, { riserMaxIn: 8.25, treadMinIn: 9, notes: [STAIR_8_25("Kentucky"), "The Third Edition took effect December 3, 2024; Kentucky publishes each county's frost, snow and wind in a statewide table."] }),
  LA: irc("LA", "Louisiana State Uniform Construction Code — residential (2021 IRC)", "LSUCC 2021", 2021, 2023, { verify: true, notes: ["Wind in the coastal parishes: the roof's uplift connections follow the wind map.", "Louisiana has published notice to adopt the 2024 IRC effective January 1, 2027."] }),
  ME: irc("ME", "Maine Uniform Building and Energy Code — MUBEC (2021 IRC with Maine amendments)", "MUBEC 2021", 2021, 2025, { notes: ["Towns of more than 4,000 people must enforce MUBEC; a smaller town may choose not to — the town office says who permits decks.", "Maine fills in no statewide design table: the town sets the frost depth (48 in. on the coast, 60 in. inland around Bangor), the snow and the wind."] }),
  MD: irc("MD", "Maryland Building Performance Standards (2021 IRC with Maryland amendments; the county adds its own)", "MBPS 2021", 2021, 2023, { verify: true }),
  MA: irc("MA", "780 CMR, Massachusetts State Building Code, 10th Edition — residential (2021 IRC with Massachusetts amendments)", "780 CMR 10", 2021, 2024, { riserMaxIn: 8.25, treadMinIn: 9, notes: [STAIR_8_25("Massachusetts")] }),
  MI: irc("MI", "2015 Michigan Residential Code (2015 IRC with Michigan amendments)", "MRC 2015", 2015, 2016, { riserMaxIn: 8.25, treadMinIn: 9, notes: [STAIR_8_25("Michigan"), "Exterior footings 42 in. below grade statewide (R 408.30522); ground snow by county (Table R301.2(5)).", "The 2021 Michigan Residential Code was stopped by a court order in July 2025 — the 2015 code is still in force."] }),
  MN: irc("MN", "2020 Minnesota Residential Code, Chapter 1309 (2018 IRC with Minnesota amendments)", "MN 1309", 2018, 2020, { notes: ["Frost: 42 in. in Zone II (the Twin Cities and the south), 60 in. in Zone I (the north), by county (1303.1600).", "Minnesota rewrites the deck footing, joist, beam and ledger tables for 40 psf live + 10 psf dead (1309.0507).", "The next code (on the 2024 IRC) is only at the comment stage."] }),
  MS: local("MS", "the City of Jackson: 2018 IRC", ["Mississippi's state minimum code applies only where a county or city opts in."]),
  MO: local("MO", "St. Louis County: 2015 IRC with county amendments; Independence: 2024 IRC; St. Charles County: 2021 IRC", ["Deck permit exemptions vary: St. Louis County and Independence permit every deck; unincorporated Jackson County exempts decks up to 36 in. above grade."], 2015),
  MT: irc("MT", "Montana state building code (2024 IRC as amended by ARM 24.301.154)", "MT IRC 2024", 2024, 2026, { riserMaxIn: 8.25, treadMinIn: 9, verify: true, notes: [STAIR_8_25("Montana"), "Guards wherever the drop is more than 30 in., without the IRC's 36-in. horizontal clause.", "Snow loads are set by the building official (ASCE 7-22 hazard tool, 30 psf least roof snow); Billings and Missoula still enforce the 2021 IRC."] }),
  NE: irc("NE", "Nebraska State Building Code (2018 IRC, less R313 and chapters 25–33)", "NE IRC 2018", 2018, 2019, { verify: true, notes: ["The state does not inspect homes: a county, city or village that enforces a code adopts the state code or one that conforms to it (Lincoln is on the 2021 IRC)."] }),
  NV: local("NV", "Clark County (Southern Nevada amendments) and Washoe County: 2024 IRC since 2025–2026", ["The regional committees' amendments can change the guard, stair and snow figures — the county's adopted package governs; northern Nevada's snow loads are strength-level figures, so confirm them with plan review."], 2024),
  NH: irc("NH", "New Hampshire State Building Code (2024 IRC with New Hampshire amendments)", "NH IRC 2024", 2024, 2026, { notes: ["Through December 31, 2026 an applicant may still build to the 2021 IRC edition (RSA 155-A:2)."] }),
  NJ: irc("NJ", "International Residential Code/2024, New Jersey Edition", "IRC-NJ 2024", 2024, 2026, { riserMaxIn: 8.25, treadMinIn: 9, notes: [STAIR_8_25("New Jersey"), "Until about February 17, 2027 a complete application may still be reviewed under the 2021 New Jersey edition.", "The state's table sets a 36-in. frost depth."] }),
  NM: irc("NM", "2021 New Mexico Residential Building Code, 14.7.3 NMAC (2021 IRC with New Mexico amendments)", "NMRBC 2021", 2021, 2023, { riserMaxIn: 8, treadMinIn: 9, notes: ["Stairs: risers up to 8 in. on treads at least 9 in. deep (New Mexico's amendment to R311.7.5).", "Guards wherever the drop is more than 30 in., without the IRC's 36-in. horizontal clause; the state's Construction Industries Division permits where there is no local department."] }),
  NY: irc("NY", "2025 Residential Code of New York State (2024 IRC with New York amendments)", "RCNYS 2025", 2024, 2025, { riserMaxIn: 8.25, treadMinIn: 9, notes: [STAIR_8_25("New York"), "New York City has its own Building Code: there a deck's guards are 42 in. high and its footings 48 in. deep."] }),
  NC: irc("NC", "2018 North Carolina Residential Code (2015 IRC with North Carolina amendments)", "NCRC 2018", 2015, 2019, { riserMaxIn: 8.25, treadMinIn: 9, verify: true, notes: [STAIR_8_25("North Carolina"), "Appendix M gives North Carolina's own deck span tables and details; where they differ from the IRC and DCA 6 tables used here, Appendix M governs.", "The 2024 North Carolina Residential Code (on the 2021 IRC) is delayed by law (S.L. 2025-2) — May 2027 at the earliest; it moves the deck rules from Appendix M into a Chapter 47, \"Wood Decks\"."] }),
  ND: irc("ND", "North Dakota State Building Code (2024 IRC with North Dakota amendments)", "ND IRC 2024", 2024, 2026, { riserMaxIn: 8, treadMinIn: 9, notes: ["Stairs: risers up to 8 in. on treads at least 9 in. deep (North Dakota's amendment to R318.7.5).", "A free-standing deck need not have footings below the frost line (R507.3 amendment).", "The deck permit exemption is narrowed to 120 sq ft and 7 in. above grade; the code binds where a city, county or township enforces codes."] }),
  OH: irc("OH", "Residential Code of Ohio (2019 RCO on the 2018 IRC, amended March 1, 2024)", "RCO 2019", 2018, 2019, { riserMaxIn: 8.25, treadMinIn: 9, notes: [STAIR_8_25("Ohio"), "A deck not supported by the house need not have footings below the frost line (RCO 403.1.4.1, exception 3).", "No plan approval for a deck of 200 sq ft or less, 30 in. or less above grade, not attached and not at the required exit door (RCO 102.10)."] }),
  OK: irc("OK", "Oklahoma Residential Code (2024 IRC with Oklahoma amendments, OAC 748:20-6)", "OK IRC 2024", 2024, 2026, { notes: ["In force since September 14, 2026 (the 2018 IRC before it); Oklahoma lets the top and bottom riser of each flight vary by ¾ in."] }),
  OR: irc("OR", "2026 Oregon Residential Specialty Code (2024 IRC with Oregon amendments; the 2023 ORSC may be used until April 1, 2027)", "ORSC 2026", 2024, 2026, { riserMaxIn: 8, treadMinIn: 9, verify: true, notes: ["Stairs: risers up to 8 in. on treads at least 9 in. deep (Oregon's amendment, verified in the 2023 ORSC and the state's permit-ready deck plan) — confirm in the 2026 text.", "Decks whose walking surface is no more than 30 in. above grade within 3 ft are exempt from permit, attached or not (ORSC R105.2).", "Oregon sets the snow, wind, seismic, frost and decay figures by site on the Building Codes Division's design-criteria map; west of the Cascades the posts are braced to the beams."] }),
  PA: irc("PA", "Pennsylvania Uniform Construction Code — residential (2021 IRC with Pennsylvania amendments)", "PA UCC 2021", 2021, 2026, { riserMaxIn: 8.25, treadMinIn: 9, notes: [STAIR_8_25("Pennsylvania"), "Philadelphia enforces its own amendments on top; its no-plans deck permit asks for 7¾-in. risers and 10-in. treads."] }),
  RI: irc("RI", "Rhode Island One- and Two-Family Dwelling Code, SBC-2 (2021 IRC with Rhode Island amendments)", "RI SBC-2", 2021, 2025, { riserMaxIn: 8.25, treadMinIn: 9, notes: [STAIR_8_25("Rhode Island")] }),
  SC: irc("SC", "2021 South Carolina Residential Code (2021 IRC with South Carolina modifications)", "SCRC 2021", 2021, 2023, { notes: ["Wind along the coast: the roof's uplift connections follow the wind map.", "A guard is also required where the ground within 36 in. of the deck's edge falls away steeper than 3:12.", "The 2024 South Carolina Residential Code (2024 IRC) takes effect January 1, 2027."] }),
  SD: local("SD", "Sioux Falls: 2024 IRC since July 2026, with 8-in. risers allowed; Rapid City: confirm locally", ["South Dakota's statewide building standard covers only non-residential buildings."], 2024),
  TN: irc("TN", "Tennessee residential code (2018 IRC, adopted by the State Fire Marshal's Office; a city may adopt its own)", "TN IRC 2018", 2018, 2020, { verify: true, notes: ["Nashville has enforced the 2024 IRC since July 16, 2025; Knox County the 2018 IRC.", "Seismic category C around Nashville and Knoxville, higher toward the New Madrid zone in the west: the posts braced to the beams."] }),
  TX: local("TX", "Austin, Dallas, Houston and San Antonio: 2021 IRC", ["Where a city has adopted nothing newer, Local Government Code §214.212 makes the IRC as it existed on May 1, 2012 the residential code; local amendments need a public hearing and an ordinance.", "Along the coast the windstorm rules (TDI) ask for uplift connections on a roof; Houston sets the wind speed per address from the ASCE hazard tool."]),
  UT: irc("UT", "Utah State Construction Code (2021 IRC with Utah amendments, Title 15A)", "UT IRC 2021", 2021, 2023, { riserMaxIn: 8, treadMinIn: 9, notes: ["Stairs: risers up to 8 in. on treads at least 9 in. deep (15A-3-202).", "No permit for a deck no more than 30 in. above grade that needs no guard and serves no required exit door (Utah's amendment to R105.2).", "Ground snow from Utah's own table by town and elevation (Salt Lake City 28 psf, Provo 31) or the Utah Snow Load Study."] }),
  VT: local("VT", "Burlington and Rutland City enforce the 2025 Vermont Fire & Building Safety Code; owner-occupied one- and two-family homes have no state residential code", ["A one- or two-family home that is rented needs a state permit under the Vermont Fire & Building Safety Code: guards 42 in. (NFPA 101), and Burlington asks footings 60 in. deep.", "Where the town enforces nothing, the IRC figures here are a floor, not a requirement — confirm with the town."]),
  VA: irc("VA", "2021 Virginia Residential Code — USBC (2021 IRC with Virginia amendments)", "VRC 2021", 2021, 2024, { riserMaxIn: 8.25, treadMinIn: 9, notes: [STAIR_8_25("Virginia")] }),
  WA: irc("WA", "2021 Washington State Residential Code, WAC 51-51 (2021 IRC with Washington amendments)", "WSRC 2021", 2021, 2024, { notes: ["Washington does not adopt the IRC's deck beam tables R507.5(1)–(4): deck beams are sized from Washington's own Table R507.5 (60 psf live or 70 psf ground snow, WAC 51-51-0507) — confirm the beam sizes here against it.", "King and Pierce counties' deck guides ask knee braces on posts taller than 4 ft.", "The 2024 Washington code (on the 2024 IRC) takes effect May 3, 2027."] }),
  WV: irc("WV", "West Virginia State Building Code, 87 CSR 4 (2018 IRC with state amendments), where a county or city adopts it", "WV IRC 2018", 2018, 2022, { statewide: false, verify: true, riserMaxIn: 8.25, treadMinIn: 9, notes: [STAIR_8_25("West Virginia"), "The state code binds only where a county or city adopts it; several large counties enforce no residential code at all."] }),
  WI: irc("WI", "Wisconsin Uniform Dwelling Code, SPS 320–325 (Wisconsin's own code, not the IRC)", "UDC", null, 1980, {
    riserMaxIn: 8,
    treadMinIn: 9,
    notes: [
      "Stairs: risers up to 8 in. on treads at least 9 in. deep (SPS 321.04(2)).",
      "Guards 36 in. on any deck more than 24 in. above grade — measured from the lowest point within 3 ft of the edge — not the IRC's 30 in. (SPS 321.04(3)).",
      "Footings below frost or at least 48 in. below grade, whichever is deeper, statewide (SPS 321.16).",
      "The UDC's own deck provisions and the state's sample deck plans govern the spans; the IRC and DCA 6 tables used here run close to them — confirm with the municipality.",
    ],
  }),
  WY: local("WY", "Cheyenne, Casper and Gillette: 2024 IRC; Teton County: confirm locally", ["Frost depths differ between the towns: Cheyenne and Casper 36 in., Gillette 42 in."], 2024),
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
