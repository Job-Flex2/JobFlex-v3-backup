// ROOFING BRANDS BY STATE (owner, 2026-10-16: "if they select shingles or any type of roof, show the brands most
// popular per state — the contractor clicks the brand, e.g. CertainTeed or IKO, and knows it's popular in the state;
// someone from Florida sees Florida's … make it smart, go deep"). Pure, browser-safe.
//
// THERE IS NO PUBLIC MARKET-SHARE TABLE BY STATE, so nothing here pretends to one. A product line is ranked for a
// state from signals that can be checked — and the picker says which ones, in words:
//   · the code: Florida Product Approval and Miami-Dade NOA (the HVHZ) — in Florida a line with an approval goes
//     first, one without any is held back; California's cool-roof rule (Title 24) lifts a cool-rated line;
//   · the weather and the insurers: where a Class 4 roof earns an insurance discount or a grant, or hail is heavy,
//     the Class 4 lines say so; on the hurricane coast a Miami-Dade-approved line rises; an SBS (flexible) shingle
//     rises in the cold north;
//   · supply: a plant in the state or in its region (Census division) — what the yards and distributors stock;
//   · reach: the three national shingle leaders everywhere; a regional maker only where it sells.
// Sources and the date they were read are in docs/roof-brands.md. Read 2026-10-16.
import type { RoofFamily } from "./catalog";

/** US Census divisions — "nearby" for a plant. */
export type RoofRegion = "new_england" | "mid_atlantic" | "east_north_central" | "west_north_central" | "south_atlantic" | "east_south_central" | "west_south_central" | "mountain" | "pacific";

export const STATE_REGION: Record<string, RoofRegion> = {
  CT: "new_england", ME: "new_england", MA: "new_england", NH: "new_england", RI: "new_england", VT: "new_england",
  NJ: "mid_atlantic", NY: "mid_atlantic", PA: "mid_atlantic",
  IL: "east_north_central", IN: "east_north_central", MI: "east_north_central", OH: "east_north_central", WI: "east_north_central",
  IA: "west_north_central", KS: "west_north_central", MN: "west_north_central", MO: "west_north_central", NE: "west_north_central", ND: "west_north_central", SD: "west_north_central",
  DE: "south_atlantic", DC: "south_atlantic", FL: "south_atlantic", GA: "south_atlantic", MD: "south_atlantic", NC: "south_atlantic", SC: "south_atlantic", VA: "south_atlantic", WV: "south_atlantic",
  AL: "east_south_central", KY: "east_south_central", MS: "east_south_central", TN: "east_south_central",
  AR: "west_south_central", LA: "west_south_central", OK: "west_south_central", TX: "west_south_central",
  AZ: "mountain", CO: "mountain", ID: "mountain", MT: "mountain", NV: "mountain", NM: "mountain", UT: "mountain", WY: "mountain",
  AK: "pacific", CA: "pacific", HI: "pacific", OR: "pacific", WA: "pacific",
};

export const STATE_NAME: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "D.C.",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska",
  NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio",
  OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas",
  UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

/** "Made near you" in a region's own words. */
const REGION_MADE: Record<RoofRegion, string> = {
  new_england: "Made in New England", mid_atlantic: "Made in the Mid-Atlantic", east_north_central: "Made in the Great Lakes states", west_north_central: "Made in the Plains",
  south_atlantic: "Made in the Southeast", east_south_central: "Made in the South", west_south_central: "Made in the South Central states", mountain: "Made in the Mountain West", pacific: "Made on the West Coast",
};

/** Every state in these divisions. */
const statesIn = (...regions: RoofRegion[]) => Object.keys(STATE_REGION).filter((s) => regions.includes(STATE_REGION[s]));
const WEST = statesIn("pacific", "mountain");
const NORTH_EAST = statesIn("new_england", "mid_atlantic", "east_north_central", "west_north_central");

export type RoofBrand = {
  id: string;
  name: string;
  /** Sold coast to coast through the big distributors. */
  national: boolean;
  /** One of the three national leaders in residential shingles (GAF, Owens Corning, CertainTeed). */
  leader?: boolean;
  /** States with a plant making this brand's residential roofing, by family. */
  plants: Partial<Record<RoofFamily, string[]>>;
  /** States where it is the known regional maker (documented, not guessed). */
  strongholds?: string[];
  /** Only sold in these states — not offered elsewhere. Absent: everywhere. */
  soldIn?: string[];
  /** Where it comes from when there is no US plant: "Made in Spain". */
  from?: string;
};

export type RoofProduct = {
  id: string;
  brand: string;
  /** The line as the proposal names it after the brand: "Timberline HDZ". Empty: the maker's panels/tile by name. */
  line: string;
  /** The catalog systems it is (lib/roofPackage/catalog ROOF_SYSTEMS ids). */
  systems: string[];
  /** UL 2218 Class 4 impact rating. */
  class4?: boolean;
  /** Florida Product Approval: true = on file; false = known to have none; absent = not on our list (check it). */
  flApproved?: boolean;
  /** Miami-Dade NOA — needed in the HVHZ (Miami-Dade, Broward). Implies Florida approval. */
  hvhz?: boolean;
  /** The NOA covers only some plants — said next to it. */
  hvhzNote?: string;
  /** Rated for cool roofs (CRRC) — California Title 24. */
  cool?: boolean;
  /** SBS / flexible, made for cold climates. */
  cold?: boolean;
  /** This line's own plants when they differ from the brand's for the family. */
  plants?: string[];
  /** Sold mostly in these states; elsewhere it is listed after the rest with a note. */
  soldIn?: string[];
  /** The words for `soldIn`: "the North and East". */
  soldWords?: string;
};

/* ── The signals by state ─────────────────────────────────────────────────────────────────────────────────────── */

/** An insurance discount or credit (by law or offered) or a state grant program for an impact-resistant roof. */
export const CLASS4_CREDIT_STATES: ReadonlySet<string> = new Set<string>(["AL", "MS", "MN", "KY", "LA", "GA", "NC", "OK", "SC", "AR", "CO", "TX"]);
/** The heaviest hail states (NOAA storm reports / insurer hail-claim counts). */
export const HAIL_STATES: ReadonlySet<string> = new Set<string>(["TX", "KS", "OK", "NE", "MO", "CO", "SD", "TN", "IL", "AR", "MN"]);
/** Hurricane coast: a line with a Miami-Dade wind approval rises. (Florida has its own rule below.) */
export const HURRICANE_STATES: ReadonlySet<string> = new Set<string>(["FL", "TX", "LA", "MS", "AL", "SC", "NC"]);
/** Cool-roof rule for steep-slope reroofs (Title 24: climate zones 4 and 8–15). */
export const COOL_ROOF_STATES: ReadonlySet<string> = new Set<string>(["CA"]);
/** Cold winters: an SBS / flexible shingle earns a mention. */
export const COLD_STATES: ReadonlySet<string> = new Set<string>(["AK", "ME", "NH", "VT", "MN", "WI", "MI", "ND", "SD", "MT", "WY", "ID"]);

/* ── The data (docs/roof-brands.md) ───────────────────────────────────────────────────────────────────────────── */

export const ROOF_BRANDS: RoofBrand[] = [
  // Shingles — the three national leaders, then the national makers, then the regional ones.
  { id: "gaf", name: "GAF", national: true, leader: true, plants: { asphalt: ["FL", "IN", "MD", "PA", "TX", "AL", "CA", "MN"] } },
  { id: "owens_corning", name: "Owens Corning", national: true, leader: true, plants: { asphalt: ["FL", "TN", "GA", "TX", "NJ", "OH", "IN", "CO", "IL", "MN", "OR", "CA"] } },
  { id: "certainteed", name: "CertainTeed", national: true, leader: true, plants: { asphalt: ["CA", "GA", "LA", "MA", "MO", "MN", "NC", "OH", "OR", "TX"] } },
  { id: "iko", name: "IKO", national: true, plants: { asphalt: ["FL", "AL", "TX", "IL", "WA"] } },
  { id: "atlas", name: "Atlas", national: true, plants: { asphalt: ["GA", "MS", "TX", "OK", "OH"] } },
  { id: "tamko", name: "TAMKO", national: true, plants: { asphalt: ["MO", "KS", "TX", "AL", "MD"] }, strongholds: ["MO", "KS", "TX", "AR", "OK"] },
  { id: "malarkey", name: "Malarkey", national: false, plants: { asphalt: ["OR", "OK", "CA"] }, strongholds: ["OR", "WA"], soldIn: [...WEST, "OK"] },
  { id: "pabco", name: "PABCO", national: false, plants: { asphalt: ["WA"] }, soldIn: WEST },
  // Metal.
  { id: "mcelroy", name: "McElroy Metal", national: true, plants: { metal: ["CA", "GA", "IL", "KY", "LA", "MI", "MO", "TX", "VA", "WI"] } },
  { id: "metal_sales", name: "Metal Sales", national: true, plants: { metal: ["AK", "CA", "CO", "IL", "IN", "MI", "MN", "MO", "AR", "PA", "TX", "WA"] } },
  { id: "pac_clad", name: "PAC-CLAD", national: true, plants: { metal: ["IL", "MD", "TX", "GA", "AZ"] } },
  { id: "englert", name: "Englert", national: true, plants: { metal: ["NJ"] } },
  { id: "sheffield", name: "Sheffield Metals", national: false, plants: { metal: ["OH", "GA", "TX", "CO", "IN", "CA", "FL"] } },
  { id: "central_states", name: "Central States", national: false, plants: { metal: ["AR", "TX", "PA", "SC", "SD", "AL", "IN", "NC", "KY", "MO", "UT"] } },
  { id: "union", name: "Union Corrugating", national: false, plants: { metal: ["NC", "OH", "TN", "FL", "PA", "GA", "MS"] } },
  { id: "fabral", name: "Fabral", national: false, plants: { metal: ["PA", "GA", "IL", "WI", "UT", "WA", "MN"] } },
  { id: "berridge", name: "Berridge", national: false, plants: { metal: ["TX"] } },
  { id: "western_states", name: "Western States Metal Roofing", national: false, plants: { metal: ["AZ", "TX", "WA"] }, soldIn: [...WEST, "TX", "OK", "NM"] },
  { id: "bridger", name: "Bridger Steel", national: false, plants: { metal: ["MT", "SD", "WY", "WA"] }, soldIn: [...WEST, "SD", "ND", "NE"] },
  { id: "classic_metal", name: "Classic Metal Roofing Systems", national: true, plants: { metal: ["OH"] } },
  { id: "decra", name: "DECRA", national: true, plants: { metal: ["TX"] } },
  { id: "westlake", name: "Westlake Royal", national: true, plants: {} },
  { id: "tilcor", name: "Tilcor", national: false, plants: {}, from: "Made in New Zealand" },
  // Tile.
  { id: "eagle", name: "Eagle Roofing", national: false, plants: { tile: ["CA", "AZ", "FL"] } },
  { id: "crown", name: "Crown Roof Tiles", national: false, plants: { tile: ["FL", "TX"] } },
  { id: "ludowici", name: "Ludowici", national: true, plants: { tile: ["OH"] } },
  { id: "mca", name: "MCA", national: false, plants: { tile: ["CA"] } },
  { id: "santafe", name: "Santafé", national: false, plants: {}, from: "Made in Colombia" },
  { id: "verea", name: "Verea", national: false, plants: {}, from: "Made in Spain" },
  // Synthetic.
  { id: "davinci", name: "DaVinci", national: true, plants: { synthetic: ["KS"] } },
  { id: "brava", name: "Brava", national: true, plants: { synthetic: ["IA"] } },
  { id: "ecostar", name: "EcoStar", national: true, plants: { synthetic: ["NY"] } },
  { id: "cedur", name: "CeDUR", national: false, plants: { synthetic: ["CO"] } },
  // Natural slate — the Slate Valley quarries on the Vermont–New York line.
  { id: "greenstone", name: "Greenstone Slate", national: true, plants: { slate: ["VT"] } },
  { id: "vermont_structural", name: "Vermont Structural Slate", national: true, plants: { slate: ["VT"] } },
  { id: "camara", name: "Camara Slate", national: true, plants: { slate: ["VT"] } },
  { id: "evergreen", name: "Evergreen Slate", national: true, plants: { slate: ["NY"] } },
  { id: "sheldon", name: "Sheldon Slate", national: true, plants: { slate: ["NY"] } },
  // Flat / low slope.
  { id: "carlisle", name: "Carlisle", national: true, plants: {} },
  { id: "elevate", name: "Elevate", national: true, plants: {} },
  { id: "jm", name: "Johns Manville", national: true, plants: {} },
  { id: "polyglass", name: "Polyglass", national: true, plants: { "low-slope": ["FL", "NV", "PA", "TX", "AZ"] } },
];

const STD = ["standing_seam", "standing_seam_low"];
const TPO = ["tpo", "tpo_45", "tpo_60_adhered", "tpo_80", "tpo_fleece_adhered", "tpo_induction"];
const EPDM = ["epdm", "epdm_mech", "epdm_45", "epdm_90", "epdm_ballast"];
const PVC = ["pvc", "pvc_adhered", "pvc_80", "pvc_fleece_adhered"];

/** Each brand's flagship line first — a tie in the ranking keeps this order. */
export const ROOF_PRODUCTS: RoofProduct[] = [
  /* Architectural */
  { id: "gaf_hdz", brand: "gaf", line: "Timberline HDZ", systems: ["architectural"], flApproved: true, hvhz: true },
  { id: "oc_duration", brand: "owens_corning", line: "TruDefinition Duration", systems: ["architectural"], flApproved: true, hvhz: true },
  { id: "ct_landmark", brand: "certainteed", line: "Landmark", systems: ["architectural"], flApproved: true },
  { id: "iko_dynasty", brand: "iko", line: "Dynasty", systems: ["architectural"], flApproved: true, hvhz: true },
  { id: "iko_cambridge", brand: "iko", line: "Cambridge", systems: ["architectural"], flApproved: true, hvhz: true },
  { id: "atlas_pristine", brand: "atlas", line: "Pinnacle Pristine", systems: ["architectural"], flApproved: true },
  { id: "tamko_heritage", brand: "tamko", line: "Heritage", systems: ["architectural"], flApproved: true, hvhz: true },
  { id: "tamko_titan", brand: "tamko", line: "Titan XT", systems: ["architectural"], flApproved: true, hvhz: true },
  { id: "malarkey_highlander", brand: "malarkey", line: "Highlander AR", systems: ["architectural"] },
  { id: "pabco_premier", brand: "pabco", line: "Premier", systems: ["architectural"], flApproved: false },
  { id: "pabco_radiance", brand: "pabco", line: "Premier Radiance", systems: ["architectural"], cool: true, flApproved: false },
  { id: "gaf_uhdz", brand: "gaf", line: "Timberline UHDZ", systems: ["architectural"], flApproved: true, hvhz: true },
  { id: "gaf_cs", brand: "gaf", line: "Timberline CS", systems: ["architectural"], cool: true, flApproved: true, hvhz: true },
  { id: "gaf_hdz_rs", brand: "gaf", line: "Timberline HDZ RS", systems: ["architectural"], cool: true },
  { id: "oc_oakridge", brand: "owens_corning", line: "Oakridge", systems: ["architectural"], flApproved: true, hvhz: true },
  { id: "oc_cool", brand: "owens_corning", line: "Duration Premium COOL", systems: ["architectural"], cool: true, flApproved: true },
  { id: "ct_landmark_pro", brand: "certainteed", line: "Landmark PRO", systems: ["architectural"], flApproved: true, hvhz: true, hvhzNote: "from its Georgia, Missouri and North Carolina plants" },
  { id: "ct_landmark_premium", brand: "certainteed", line: "Landmark Premium", systems: ["architectural"], flApproved: true },
  { id: "ct_solaris", brand: "certainteed", line: "Landmark Solaris", systems: ["architectural"], cool: true, flApproved: true },
  { id: "iko_cool", brand: "iko", line: "Cambridge Cool Colors Plus", systems: ["architectural"], cool: true },
  { id: "atlas_prolam", brand: "atlas", line: "ProLAM", systems: ["architectural"] },
  { id: "atlas_briarwood", brand: "atlas", line: "Briarwood Pro", systems: ["architectural"] },
  { id: "atlas_castlebrook", brand: "atlas", line: "Castlebrook", systems: ["architectural"] },
  { id: "atlas_sun", brand: "atlas", line: "Pinnacle Sun", systems: ["architectural"], cool: true },
  /* 3-tab */
  { id: "gaf_royal_sovereign", brand: "gaf", line: "Royal Sovereign", systems: ["three_tab"], flApproved: true, hvhz: true },
  { id: "oc_supreme", brand: "owens_corning", line: "Supreme", systems: ["three_tab"], flApproved: true },
  { id: "ct_xt25", brand: "certainteed", line: "XT 25", systems: ["three_tab"], flApproved: true },
  { id: "iko_marathon", brand: "iko", line: "Marathon Plus AR", systems: ["three_tab"] },
  { id: "atlas_glassmaster", brand: "atlas", line: "GlassMaster", systems: ["three_tab"], flApproved: true },
  { id: "tamko_elite", brand: "tamko", line: "Elite Glass-Seal", systems: ["three_tab"] },
  /* Class 4 */
  { id: "gaf_as2", brand: "gaf", line: "Timberline AS II", systems: ["impact_resistant"], class4: true, cold: true, flApproved: true },
  { id: "oc_storm", brand: "owens_corning", line: "Duration STORM", systems: ["impact_resistant"], class4: true, flApproved: true, hvhz: true },
  { id: "oc_flex", brand: "owens_corning", line: "Duration FLEX", systems: ["impact_resistant"], class4: true, cold: true, flApproved: true, hvhz: true },
  { id: "ct_climateflex", brand: "certainteed", line: "Landmark ClimateFlex", systems: ["impact_resistant"], class4: true, cold: true, flApproved: true, soldIn: NORTH_EAST, soldWords: "the North and East" },
  { id: "ct_northgate", brand: "certainteed", line: "NorthGate ClimateFlex", systems: ["impact_resistant"], class4: true, cold: true, soldIn: NORTH_EAST, soldWords: "the North and East" },
  { id: "iko_nordic", brand: "iko", line: "Nordic", systems: ["impact_resistant"], class4: true, flApproved: true, hvhz: true },
  { id: "atlas_impact", brand: "atlas", line: "Pinnacle Impact", systems: ["impact_resistant"], class4: true },
  { id: "tamko_stormfighter", brand: "tamko", line: "StormFighter FLEX", systems: ["impact_resistant"], class4: true, cold: true, flApproved: true, hvhz: true },
  { id: "tamko_hailguard", brand: "tamko", line: "HailGuard", systems: ["impact_resistant"], class4: true, flApproved: true, hvhz: true },
  { id: "malarkey_vista", brand: "malarkey", line: "Vista AR", systems: ["impact_resistant"], class4: true, cold: true },
  { id: "malarkey_legacy", brand: "malarkey", line: "Legacy", systems: ["impact_resistant"], class4: true, cold: true },
  { id: "pabco_prestige", brand: "pabco", line: "Prestige", systems: ["impact_resistant"], class4: true, flApproved: false },
  { id: "pabco_paramount", brand: "pabco", line: "Paramount Advantage", systems: ["impact_resistant"], class4: true, flApproved: false },
  /* Designer */
  { id: "ct_presidential", brand: "certainteed", line: "Presidential Shake", systems: ["designer"], flApproved: true },
  { id: "gaf_camelot", brand: "gaf", line: "Camelot II", systems: ["designer"] },
  { id: "oc_berkshire", brand: "owens_corning", line: "Berkshire", systems: ["designer"] },
  { id: "ct_grand_manor", brand: "certainteed", line: "Grand Manor", systems: ["designer"], flApproved: true },
  { id: "ct_belmont", brand: "certainteed", line: "Belmont", systems: ["designer"], flApproved: true },
  { id: "ct_carriage_house", brand: "certainteed", line: "Carriage House", systems: ["designer"], flApproved: true },
  { id: "ct_highland_slate", brand: "certainteed", line: "Highland Slate", systems: ["designer"], flApproved: true },
  { id: "ct_presidential_solaris", brand: "certainteed", line: "Presidential Solaris", systems: ["designer"], cool: true, flApproved: true },
  { id: "gaf_grand_sequoia", brand: "gaf", line: "Grand Sequoia", systems: ["designer"] },
  { id: "gaf_slateline", brand: "gaf", line: "Slateline", systems: ["designer"] },
  { id: "gaf_woodland", brand: "gaf", line: "Woodland", systems: ["designer"] },
  { id: "oc_woodcrest", brand: "owens_corning", line: "Woodcrest", systems: ["designer"] },
  { id: "oc_woodmoor", brand: "owens_corning", line: "Woodmoor", systems: ["designer"] },
  { id: "malarkey_windsor", brand: "malarkey", line: "Windsor", systems: ["designer"], class4: true },
  /* Standing seam */
  { id: "mcelroy_medallion", brand: "mcelroy", line: "Medallion-Lok", systems: ["standing_seam"] },
  { id: "mcelroy_maxima", brand: "mcelroy", line: "Maxima", systems: STD },
  { id: "metal_sales_magna", brand: "metal_sales", line: "Magna-Loc", systems: STD },
  { id: "pac_clad_snap", brand: "pac_clad", line: "Snap-Clad", systems: ["standing_seam"] },
  { id: "pac_clad_tite", brand: "pac_clad", line: "Tite-Loc Plus", systems: STD },
  { id: "englert_ss", brand: "englert", line: "", systems: STD },
  { id: "sheffield_ss", brand: "sheffield", line: "", systems: STD },
  { id: "central_states_ss", brand: "central_states", line: "", systems: STD },
  { id: "union_ss", brand: "union", line: "", systems: STD },
  { id: "fabral_ss", brand: "fabral", line: "", systems: STD },
  { id: "berridge_ss", brand: "berridge", line: "", systems: STD, flApproved: true, hvhz: true },
  { id: "western_states_ss", brand: "western_states", line: "", systems: STD },
  { id: "bridger_ss", brand: "bridger", line: "", systems: STD },
  /* Exposed-fastener panel */
  { id: "mcelroy_maxrib", brand: "mcelroy", line: "Max-Rib", systems: ["metal_panel"] },
  { id: "metal_sales_classic_rib", brand: "metal_sales", line: "Classic Rib", systems: ["metal_panel"] },
  { id: "union_panel", brand: "union", line: "", systems: ["metal_panel"] },
  { id: "central_states_panel", brand: "central_states", line: "", systems: ["metal_panel"] },
  { id: "fabral_panel", brand: "fabral", line: "", systems: ["metal_panel"] },
  { id: "western_states_panel", brand: "western_states", line: "", systems: ["metal_panel"] },
  { id: "bridger_panel", brand: "bridger", line: "", systems: ["metal_panel"] },
  /* Stone-coated steel */
  { id: "decra_tile", brand: "decra", line: "Tile", systems: ["stone_coated_steel"], flApproved: true, hvhz: true },
  { id: "decra_shake", brand: "decra", line: "Shake", systems: ["stone_coated_steel"], flApproved: true, hvhz: true },
  { id: "westlake_unified", brand: "westlake", line: "Unified Steel", systems: ["stone_coated_steel"], flApproved: true, hvhz: true },
  { id: "tilcor_sc", brand: "tilcor", line: "", systems: ["stone_coated_steel"], flApproved: true },
  /* Metal shingle / shake */
  { id: "classic_oxford", brand: "classic_metal", line: "Oxford Shingle", systems: ["metal_shingle"] },
  { id: "classic_country_manor", brand: "classic_metal", line: "Country Manor Shake", systems: ["metal_shingle"] },
  /* Concrete tile */
  { id: "eagle_capistrano", brand: "eagle", line: "Capistrano", systems: ["concrete_tile"] },
  { id: "eagle_malibu", brand: "eagle", line: "Malibu", systems: ["concrete_tile"] },
  { id: "westlake_newpoint", brand: "westlake", line: "Newpoint", systems: ["concrete_tile"], plants: ["FL", "AZ"] },
  { id: "crown_concrete", brand: "crown", line: "", systems: ["concrete_tile"] },
  /* Clay tile */
  { id: "ludowici_clay", brand: "ludowici", line: "", systems: ["clay_tile"], flApproved: true, hvhz: true },
  { id: "westlake_us_tile", brand: "westlake", line: "US Tile", systems: ["clay_tile"], plants: ["CA"] },
  { id: "mca_clay", brand: "mca", line: "", systems: ["clay_tile"] },
  { id: "santafe_clay", brand: "santafe", line: "", systems: ["clay_tile"], flApproved: true, hvhz: true },
  { id: "verea_clay", brand: "verea", line: "", systems: ["clay_tile"], flApproved: true, hvhz: true },
  /* Synthetic */
  { id: "davinci_multi_slate", brand: "davinci", line: "Multi-Width Slate", systems: ["synthetic_slate"], class4: true, flApproved: true, hvhz: true },
  { id: "davinci_bellaforte", brand: "davinci", line: "Bellaforté Slate", systems: ["synthetic_slate"], class4: true },
  { id: "brava_slate", brand: "brava", line: "Old World Slate", systems: ["synthetic_slate"], class4: true, flApproved: true, hvhz: true },
  { id: "ecostar_majestic", brand: "ecostar", line: "Majestic Slate", systems: ["synthetic_slate"], class4: true },
  { id: "davinci_multi_shake", brand: "davinci", line: "Multi-Width Shake", systems: ["synthetic_shake"], class4: true, flApproved: true, hvhz: true },
  { id: "brava_shake", brand: "brava", line: "Cedar Shake", systems: ["synthetic_shake"], class4: true, flApproved: true, hvhz: true },
  { id: "ecostar_seneca", brand: "ecostar", line: "Seneca Shake", systems: ["synthetic_shake"], class4: true },
  { id: "cedur_shake", brand: "cedur", line: "", systems: ["synthetic_shake"] },
  /* Natural slate */
  { id: "greenstone", brand: "greenstone", line: "", systems: ["slate"] },
  { id: "vermont_structural", brand: "vermont_structural", line: "", systems: ["slate"] },
  { id: "camara", brand: "camara", line: "", systems: ["slate"] },
  { id: "evergreen", brand: "evergreen", line: "", systems: ["slate"] },
  { id: "sheldon", brand: "sheldon", line: "", systems: ["slate"] },
  /* Flat — self-adhered and torch mod bit */
  { id: "gaf_liberty", brand: "gaf", line: "Liberty SBS", systems: ["mod_bit_sa"] },
  { id: "ct_flintlastic", brand: "certainteed", line: "Flintlastic SA", systems: ["mod_bit_sa"] },
  { id: "oc_deckseal", brand: "owens_corning", line: "DeckSeal SA", systems: ["mod_bit_sa"] },
  { id: "polyglass_mb", brand: "polyglass", line: "", systems: ["mod_bit_sa", "mod_bit"] },
  /* Flat — single ply */
  { id: "gaf_everguard_tpo", brand: "gaf", line: "EverGuard TPO", systems: TPO },
  { id: "carlisle_tpo", brand: "carlisle", line: "Sure-Weld TPO", systems: TPO },
  { id: "elevate_tpo", brand: "elevate", line: "UltraPly TPO", systems: TPO },
  { id: "jm_tpo", brand: "jm", line: "JM TPO", systems: TPO },
  { id: "carlisle_epdm", brand: "carlisle", line: "Sure-Seal EPDM", systems: EPDM },
  { id: "elevate_epdm", brand: "elevate", line: "RubberGard EPDM", systems: EPDM },
  { id: "carlisle_pvc", brand: "carlisle", line: "Sure-Flex PVC", systems: PVC },
  { id: "gaf_everguard_pvc", brand: "gaf", line: "EverGuard PVC", systems: PVC },
];

/* ── Ranking ──────────────────────────────────────────────────────────────────────────────────────────────────── */

export type RankedProduct = {
  product: RoofProduct;
  brand: RoofBrand;
  /** "GAF Timberline HDZ" — how the proposal names it. */
  name: string;
  score: number;
  /** Why it is here, best first, in the contractor's words ("Florida Product Approved", "Made in Texas"…). */
  reasons: string[];
  /** Held back in this state (no Florida approval; not sold here) — listed after the rest, said why. */
  held?: string;
};

const brandOf = (id: string) => ROOF_BRANDS.find((b) => b.id === id) ?? null;
export const productName = (p: RoofProduct) => `${brandOf(p.brand)?.name ?? p.brand} ${p.line}`.trim();
export const productById = (id: string | null | undefined) => (id ? ROOF_PRODUCTS.find((p) => p.id === id) ?? null : null);
export const productFits = (productId: string | null | undefined, systemId: string) => !!productById(productId)?.systems.includes(systemId);

const wordsList = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** Families Florida's product approval covers on a steep roof. */
const FL_FAMILIES: ReadonlySet<RoofFamily> = new Set<RoofFamily>(["asphalt", "metal", "tile", "synthetic"]);

/** Every product line that IS this system, ranked for the state (no state: the national order). */
export function rankBrandsFor(systemId: string, family: RoofFamily, stateRaw: string | null | undefined): RankedProduct[] {
  const state = (stateRaw ?? "").trim().toUpperCase() || null;
  const known = state && STATE_NAME[state] ? state : null;
  const name = known ? STATE_NAME[known] : "";
  const region = known ? STATE_REGION[known] ?? null : null;
  const out: RankedProduct[] = [];
  for (const product of ROOF_PRODUCTS) {
    if (!product.systems.includes(systemId)) continue;
    const brand = brandOf(product.brand);
    if (!brand) continue;
    // A regional maker is not offered where it does not sell.
    if (known && brand.soldIn && !brand.soldIn.includes(known)) continue;
    const shingle = family === "asphalt";
    let score = brand.leader && shingle ? 3 : brand.national ? 1.5 : 0;
    // Reasons in the order a contractor weighs them: the state's rule, the insurer, the code, the neighbours,
    // the supply, the coast, the brand's reach.
    const said: Array<[number, string]> = [];
    const say = (rank: number, text: string) => said.push([rank, text]);
    let held: string | undefined;

    if (known === "FL" && FL_FAMILIES.has(family)) {
      if (product.hvhz) {
        score += 4;
        say(0, product.hvhzNote ? `Miami-Dade approved (HVHZ) ${product.hvhzNote}` : "Miami-Dade approved (HVHZ)");
      } else if (product.flApproved) {
        score += 3;
        say(0, "Florida Product Approved");
      } else if (product.flApproved === false) {
        score -= 6;
        held = "No Florida Product Approval — not for Florida roofs";
      } else {
        // The one thing the contractor must do before quoting the line — so it leads.
        say(0, "Check its Florida approval before quoting");
      }
    } else if (known && HURRICANE_STATES.has(known) && product.hvhz && family !== "low-slope") {
      score += 1;
      say(6, "Miami-Dade wind approval — for the coast");
    }
    if (known && product.class4) {
      if (CLASS4_CREDIT_STATES.has(known)) {
        score += 2.5;
        say(1, `Insurance discount or grant in ${name}`);
      } else if (HAIL_STATES.has(known)) {
        score += 2;
        say(1, `Built for ${name}'s hail`);
      }
    }
    if (known && COOL_ROOF_STATES.has(known) && product.cool) {
      score += 1.5;
      say(2, "Cool-roof rated (Title 24)");
    }
    if (known && COLD_STATES.has(known) && product.cold) {
      score += 1;
      say(3, "Flexible (SBS) — made for cold winters");
    }
    if (known && brand.strongholds?.includes(known)) {
      score += 1.5;
      say(4, `Local favorite in ${name}`);
    }
    const plants = product.plants ?? brand.plants[family] ?? [];
    if (known && plants.includes(known)) {
      score += 2;
      say(5, `Made in ${name}`);
    } else if (region && plants.some((p) => STATE_REGION[p] === region)) {
      score += 1;
      say(5, REGION_MADE[region]);
    }
    if (brand.leader && shingle) say(7, "National top-3 shingle maker");
    else if (brand.national) say(7, "Sold nationwide");
    // A regional maker with nothing else to say here says where it ships from.
    if (!said.length && plants.length) say(8, `Made in ${wordsList(plants.slice(0, 3).map((p) => STATE_NAME[p] ?? p))}`);
    else if (!said.length && brand.from) say(8, brand.from);
    if (!held && known && product.soldIn && !product.soldIn.includes(known)) {
      score -= 4;
      held = `Sold mostly in ${product.soldWords ?? "other states"} — ask your yard`;
    }
    const reasons = said.map((x, i) => ({ x, i })).sort((a, b) => a.x[0] - b.x[0] || a.i - b.i).map(({ x }) => x[1]);
    out.push({ product, brand, name: productName(product), score, reasons, held });
  }
  // Best first; a tie keeps the data's order (each brand's flagship line first). Held lines go last.
  return out
    .map((r, i) => ({ r, i }))
    .sort((a, b) => Number(!!a.r.held) - Number(!!b.r.held) || b.r.score - a.r.score || a.i - b.i)
    .map(({ r }) => r);
}

/** The picks up front: each brand once (its best line here), best brand first, none held back. */
export function topPicks(ranked: readonly RankedProduct[], n: number): RankedProduct[] {
  const seen = new Set<string>();
  const out: RankedProduct[] = [];
  for (const r of ranked) {
    if (out.length >= n) break;
    if (r.held || seen.has(r.brand.id)) continue;
    seen.add(r.brand.id);
    out.push(r);
  }
  return out;
}

/** The line the estimate starts on: the contractor's own for this system when it is made for it, else the state's
 *  first that is not held back. Null: no brand data for this system. */
export function brandPickFor(systemId: string, family: RoofFamily, state: string | null | undefined, usual?: string | null): RankedProduct | null {
  const ranked = rankBrandsFor(systemId, family, state);
  if (!ranked.length) return null;
  const own = usual ? ranked.find((r) => r.product.id === usual) : null;
  return own ?? ranked.find((r) => !r.held) ?? null;
}

/** The line over the picks: "Top picks for architectural shingle in Florida". */
export function brandHeadline(systemLabel: string, state: string | null | undefined): string {
  const st = (state ?? "").trim().toUpperCase();
  const what = systemLabel.split(" · ")[0].toLowerCase();
  return st && STATE_NAME[st] ? `Top picks for ${what} in ${STATE_NAME[st]}` : `Top picks for ${what}`;
}

/** What the state asks of this roof that the picks alone don't say — with the system to switch to, when one fits. */
export type BrandHint = { text: string; switchTo?: string; switchLabel?: string };

export function brandHint(systemId: string, state: string | null | undefined): BrandHint | null {
  const st = (state ?? "").trim().toUpperCase();
  const name = STATE_NAME[st];
  if (!name) return null;
  const plainShingle = systemId === "architectural" || systemId === "three_tab" || systemId === "designer";
  if (plainShingle && CLASS4_CREDIT_STATES.has(st))
    return { text: `${name} has insurance discounts or grants for a Class 4 roof — worth offering the homeowner.`, switchTo: "impact_resistant", switchLabel: "See Class 4 shingles" };
  if (plainShingle && HAIL_STATES.has(st))
    return { text: `${name} is hail country — a Class 4 shingle is worth offering the homeowner.`, switchTo: "impact_resistant", switchLabel: "See Class 4 shingles" };
  if (st === "CA" && (systemId === "architectural" || systemId === "three_tab" || systemId === "impact_resistant" || systemId === "designer"))
    return { text: "California (Title 24): a steep reroof in climate zones 4 and 8–15 needs a cool-rated shingle — those lines rise to the top." };
  if (st === "FL" && systemId !== "slate")
    return { text: "In Miami-Dade and Broward (the HVHZ) only lines with a Miami-Dade approval go on — they're first here." };
  return null;
}

/* ── The brand on an estimate ─────────────────────────────────────────────────────────────────────────────────── */

type BrandSpec = { systemId: string; productId?: string | null; productName?: string | null; productFor?: string | null; productAuto?: boolean };

/** The spec with its brand settled for THIS system and state — applied as the estimate is built, so there is nothing
 *  to keep in step: the contractor's own pick for this system (null = "any brand") stands; else their usual line for
 *  the system; else the same brand they picked on another system, when it makes this one; else the state's first.
 *  `usual`: undefined = no habit; null = their habit is "any brand". */
export function withBrand<T extends BrandSpec>(spec: T, ranked: readonly RankedProduct[], usual?: string | null): T {
  if (spec.productFor === spec.systemId && spec.productAuto === false) return spec;
  const put = (r: RankedProduct | null, auto: boolean): T => ({ ...spec, productId: r?.product.id ?? null, productName: r?.name ?? null, productFor: spec.systemId, productAuto: auto });
  if (usual === null) return put(null, false);
  if (usual) {
    const own = ranked.find((r) => r.product.id === usual);
    if (own) return put(own, false);
  }
  if (spec.productAuto === false && spec.productId) {
    const brand = productById(spec.productId)?.brand;
    const same = brand ? ranked.find((r) => r.brand.id === brand && !r.held) : null;
    if (same) return put(same, false);
  }
  const first = ranked.find((r) => !r.held) ?? null;
  return first ? put(first, true) : { ...spec, productId: undefined, productName: undefined, productFor: undefined, productAuto: undefined };
}
