// HVAC estimator — the building model and the engine's contracts.
//
// One object, two front doors. The retrofit intake (address facts, photos,
// the video walk, typed answers) and, later, the blueprint intake both fill a
// BuildingModel; everything downstream — the block load, Manual S selection,
// the duct and electrical checks, the price — reads it and never asks where a
// value came from. Where it came from is recorded beside it: every field can
// carry a provenance entry (`measured`, `read`, `stated`, `default`, `plan`)
// with a confidence, and the screens show that badge next to the number.
//
// Pure types, no imports: the engine, the actions, the page and the QA
// scripts all share this file.

export type Source =
  /** An instrument, a scan, a plan dimension, a parcel or footprint record. */
  | "measured"
  /** Read off a photo, a nameplate, a public record. */
  | "read"
  /** The contractor or the customer said so. */
  | "stated"
  /** A table default (era, state, climate); `note` names the table. */
  | "default"
  /** Taken from construction documents. */
  | "plan";

export type Confidence = "high" | "medium" | "low";

export interface Provenance {
  source: Source;
  confidence: Confidence;
  /** Typed by the contractor: no reading overrides it. */
  entered?: true;
  /** The table, photo or sentence the value came from. */
  note?: string;
}

/** Dotted field paths: "conditionedSqft", "existing.tons", "electrical.mainAmps". */
export type ProvenanceMap = Record<string, Provenance>;

export type WindowType = "single" | "double" | "double-lowe" | "triple";
export type WallInsulation = "none" | "r11" | "r13" | "r19" | "r21";
export type CeilingInsulation = "none" | "r11" | "r19" | "r30" | "r38" | "r49";
export type Foundation = "slab" | "crawl-vented" | "crawl-sealed" | "basement-unconditioned" | "basement-conditioned";
export type Tightness = "leaky" | "average" | "tight" | "very-tight";
export type DuctLocation = "conditioned" | "attic" | "crawl" | "basement" | "none";
export type DuctCondition = "good" | "fair" | "poor" | "unknown";
export type RoofColor = "dark" | "medium" | "light";
export type Shading = "none" | "some" | "heavy";
/** What the exterior walls are built of (2026-10-18): it moves the wall's heat flow and, with mass, softens the peak. */
export type WallConstruction = "wood-frame" | "brick-veneer" | "masonry" | "sip-icf";
/** The siding's (or the brick's) colour — light, medium or dark — for the sun on the walls. */
export type SidingColor = "light" | "medium" | "dark";
export type DoorType = "insulated" | "solid-wood" | "old-hollow";
export type Fuel = "gas" | "electric" | "propane" | "oil" | "none";
export type ExistingKind =
  | "split-ac-furnace"
  | "split-heat-pump"
  | "furnace-only"
  | "package-unit"
  | "ductless"
  | "boiler"
  | "none";

/** One exterior wall of the footprint, for window orientation. */
export interface FootprintEdge {
  /** Compass bearing of the outward normal, degrees clockwise from north. */
  bearingDeg: number;
  lengthFt: number;
}

export interface ExistingSystem {
  kind: ExistingKind;
  brand?: string;
  model?: string;
  serial?: string;
  /** Nominal cooling tons (a 036 is 3). */
  tons?: number;
  /** Furnace input, BTU/h. */
  btuInput?: number;
  fuel?: Fuel;
  refrigerant?: "R-22" | "R-410A" | "R-454B" | "R-32" | "other";
  seer?: number;
  afue?: number;
  yearMade?: number;
  /** Did it keep up on the hottest days? The one load check no table beats
   *  (2026-10-08): "yes" says the house is no bigger than the old unit. */
  keptUp?: "yes" | "no";
}

export interface Electrical {
  mainAmps?: number;
  freeSlots?: number;
  /** Existing 240 V loads that stay, for the NEC 220.83 check. */
  electricRange?: boolean;
  electricDryer?: boolean;
  electricWaterHeater?: boolean;
  evCharger?: boolean;
  /** Breaker feeding the existing outdoor unit, if known. */
  existingHvacAmps?: number;
}

export interface Ducts {
  location: DuctLocation;
  condition: DuctCondition;
  insulated?: boolean;
  /** Total free area of the return grille(s), square inches. */
  returnGrilleSqIn?: number;
  /** Measured total external static pressure, inches of water column. */
  measuredTespInWc?: number;
  supplyRegisters?: number;
  /** The supply trunk at the plenum, as typed: "16" (a round, inches) or
   *  "20x8" (rectangular) — lib/hvac/ductCalc reads it (2026-10-08). */
  supplyTrunk?: string;
  /** The return duct — not the grille — the same way. */
  returnDuct?: string;
  /** The branch runs' diameter, inches (6 in most houses). */
  branchIn?: number;
  /** A duct-leakage test (2026-10-18): leakage to OUTSIDE at 25 Pa, CFM25. It replaces the location's typical
   *  leakage in the duct loss and gain — the condition guess stands aside. */
  leakageCfm25?: number;
}

export interface Gas {
  available: boolean;
  /** Pipe size at the appliance branch, inches (0.5, 0.75, 1). */
  pipeIn?: number;
  /** Longest run from the meter, feet. */
  longestRunFt?: number;
}

export interface Preferences {
  allElectric?: boolean;
  keepGas?: boolean;
  budgetCeiling?: number;
  noiseSensitive?: boolean;
  brands?: string[];
}

export interface Room {
  name: string;
  areaSqft: number;
  ceilingFt?: number;
  /** Exterior wall length by orientation, feet. */
  exteriorWalls?: FootprintEdge[];
  windowSqft?: number;
  source: Source;
}

export interface InputConflict {
  /** The field, as a provenance path ("conditionedSqft", "storeys"). */
  path: string;
  /** The record's value, kept. */
  kept: string;
  /** What the walk said. */
  walk: string;
}

export interface BuildingModel {
  address: string;
  state: string;
  county?: string;
  lat?: number;
  lng?: number;
  elevationFt?: number;

  conditionedSqft: number;
  storeys: number;
  ceilingHeightFt: number;
  yearBuilt?: number;
  /** Exterior perimeter at the ground, feet (from the footprint). */
  perimeterFt?: number;
  footprintEdges?: FootprintEdge[];

  /** Window area as a share of floor area (0.12 = 12%) — the era default
   *  the load falls back on when nobody has counted the glass. */
  windowToFloor: number;
  /** The glass area itself, sq ft, counted on the walk or typed (2026-10-14):
   *  it outranks the ratio. The single biggest lever on a cooling load. */
  windowSqft?: number;
  windowType: WindowType;
  wallInsulation: WallInsulation;
  ceilingInsulation: CeilingInsulation;
  foundation: Foundation;
  tightness: Tightness;
  roofColor: RoofColor;
  shading: Shading;
  occupants: number;

  /* THE ENVELOPE IN DETAIL (2026-10-18, an HVAC pro on the ad: "you need insulation amount and type, window type
     and size, roof colour, siding colour and more"). All optional: a field left empty is the default the load has
     always used, so every older estimate prices the same. */
  /** Glass facing each way, sq ft. Any of them set: their sum is the window area and the sun is split by them,
   *  instead of the total spread along the walls by their length. */
  glassNorthSqft?: number;
  glassEastSqft?: number;
  glassSouthSqft?: number;
  glassWestSqft?: number;
  /** Skylights, sq ft of glass (an average skylight is about 8). Default none. */
  skylightSqft?: number;
  /** Exterior doors, counted (default two a storey, up to two storeys), and what they are. */
  doorCount?: number;
  doorType?: DoorType;
  /** Default wood frame. */
  wallConstruction?: WallConstruction;
  /** Default medium. */
  sidingColor?: SidingColor;
  /** A blower-door test: CFM50 as read off the gauge (the house's volume turns it into ACH50), or ACH50 from the
   *  report. Either replaces the tightness class. */
  blowerDoorCfm50?: number;
  blowerDoorAch50?: number;

  /** A whole-house ventilation fan (exhaust, supply, HRV / ERV). Unset = the
   *  era rule (tight, or built 2012 or later, runs one); false = none, so no
   *  ventilation load; true = one is there (2026-10-08). */
  ventilationFan?: boolean;

  existing: ExistingSystem;
  electrical: Electrical;
  ducts: Ducts;
  gas: Gas;
  preferences: Preferences;
  rooms?: Room[];
  /** Where the walk's transcribed figure disagreed with a high-confidence
   *  record and the record was kept (2026-10-08): the card says "confirm". */
  conflicts?: InputConflict[];

  provenance: ProvenanceMap;
}

// ── design conditions ───────────────────────────────────────────────────────

export type HumidityClass = "dry" | "moderate" | "humid";

export interface DesignConditions {
  state: string;
  county: string;
  /** 1% cooling design dry bulb, °F. */
  coolingF: number;
  /** 99% heating design dry bulb, °F. */
  heatingF: number;
  hddCddRatio: number;
  humidity: HumidityClass;
  /** Outdoor − indoor moisture at the cooling design, grains per lb. */
  grainsDiff: number;
  elevationFt: number;
  source: string;
  verifiedOn: string;
}

// ── engine results ──────────────────────────────────────────────────────────

export interface LoadComponent {
  name: string;
  heatingBtuh: number;
  coolingSensibleBtuh: number;
  coolingLatentBtuh: number;
}

export interface LoadResult {
  /** Rounded to 500 BTU/h. */
  heatingBtuh: number;
  coolingSensibleBtuh: number;
  coolingLatentBtuh: number;
  coolingTotalBtuh: number;
  /** coolingTotal / 12,000. */
  coolingTons: number;
  sensibleHeatRatio: number;
  /** Design supply airflow for cooling, CFM. */
  coolingCfm: number;
  /** Airflow per nominal ton the climate wants (350 humid … 450 dry). */
  cfmPerTon: number;
  components: LoadComponent[];
  /** Every default the calculation leaned on, in plain words. */
  assumptions: string[];
  /** Indoor 75 °F cooling / 70 °F heating; the design ΔTs used. */
  deltaTCooling: number;
  deltaTHeating: number;
  /** Duct loss share applied to heating / cooling (0.15 = 15%). */
  ductLossHeating: number;
  ductGainCooling: number;
}

export type EquipmentKind = "heat-pump" | "air-conditioner" | "furnace" | "air-handler" | "coil" | "ductless" | "package" | "water-heater";
export type Refrigerant = "R-410A" | "R-454B" | "R-32" | "R-22" | "other";
export type Staging = "single" | "two-stage" | "variable";

/** A catalog row: what the shop installs, or a licensed directory record. */
export interface CatalogItem {
  id: string;
  kind: EquipmentKind;
  brand: string;
  model: string;
  /** Matched-system reference (AHRI certified reference number) when known. */
  ahriRef?: string;
  refrigerant?: Refrigerant;
  staging?: Staging;
  /** Nominal cooling tons (heat pump, AC, package, ductless). */
  tons?: number;
  /** Rated cooling capacity, BTU/h (AHRI 95 °F). */
  coolingBtuh?: number;
  /** Heating capacity at 47 / 17 / 5 °F, BTU/h (heat pumps). */
  heat47Btuh?: number;
  heat17Btuh?: number;
  heat5Btuh?: number;
  /** Furnace input and AFUE. */
  btuInput?: number;
  afue?: number;
  seer2?: number;
  eer2?: number;
  hspf2?: number;
  coldClimate?: boolean;
  /** Rated external static, in. w.c. (indoor units). */
  ratedStaticInWc?: number;
  /** Minimum circuit ampacity of the outdoor unit. */
  mcaAmps?: number;
  /** Furnaces / air handlers: the largest coil the blower moves air for. */
  maxTons?: number;
  /** Water heaters: tank size, kind, fuel, efficiency and first-hour rating. */
  gallons?: number;
  whType?: "tank" | "heat-pump" | "tankless";
  fuel?: "gas" | "electric" | "propane";
  uef?: number;
  firstHourGal?: number;
  vent?: "atmospheric" | "power" | "direct" | "none";
  /** Package units: what makes the heat. */
  heatKind?: "gas" | "electric" | "heat-pump";
  /** Gas NOx certification, ng/J; 14 or less is "ultra-low". */
  noxNgJ?: number;
  /** Sales tier the shop sees on the pick list. */
  tier?: "value" | "mid" | "premium";
  /** Typed in by the contractor for one estimate, not a catalog row. */
  typed?: true;
  /** Sold or permitted only in these states (two-letter); empty = everywhere. */
  states?: string[];
  /** Not sold or not permitted in these states, with the reason on the row. */
  notStates?: string[];
  /** Why the row is limited, in the contractor's words ("SCAQMD ultra-low NOx"). */
  availabilityNote?: string;
  /** Shop cost. */
  cost?: number;
  source: "shop" | "ahri" | "neep" | "manufacturer";
  verifiedOn?: string;
  /** The product line the row belongs to ("XR14", "GLXT7C"); a shop row without one is grouped by its model with the size code stripped. */
  family?: string;
  /** Off the engine's pick list — the shop does not sell it, or the state does not allow it. The row stays in the catalog (2026-10-09). */
  offList?: boolean;
  /** The shop's own note on the row ("our volume box", "ask Johnstone for the suffix"). */
  shopNote?: string;
}

export type CheckStatus = "pass" | "fix" | "verify";

export interface CheckResult {
  id: string;
  title: string;
  status: CheckStatus;
  /** One plain sentence the contractor can read to a customer. */
  detail: string;
  /** Rule or table the check applied, when one exists. */
  rule?: string;
}

export interface CapacityPoint {
  outdoorF: number;
  capacityBtuh: number;
  loadBtuh: number;
}

export interface SelectionCandidate {
  item: CatalogItem;
  /** 0–100, higher is a better fit; the engine's ranking, never a price. */
  score: number;
  coolingRatio?: number;
  /** Heating capacity at the 99% design temperature, BTU/h (heat pumps). */
  heatAtDesignBtuh?: number;
  balancePointF?: number;
  /** Electric backup needed at the design temperature, kW. */
  backupKw?: number;
  /** Furnace output at AFUE, BTU/h. */
  furnaceOutputBtuh?: number;
  outputRatio?: number;
  curve?: CapacityPoint[];
  reasons: string[];
  disqualified?: string;
  /** The engine ruled this unit out and the contractor chose it anyway: why it was ruled out. */
  overridden?: string;
}

export interface SelectionResult {
  chosen: SelectionCandidate | null;
  runnerUp: SelectionCandidate | null;
  candidates: SelectionCandidate[];
  /** Nominal size the load calls for, before any catalog. */
  targetTons: number;
  /** 1 for one system; 2 or 3 when the load is more than the largest
   *  residential unit and the house is split into zones, each with its own
   *  system. `chosen` is then ONE of them, sized to load ÷ systems. */
  systems: number;
  /** The load each system carries when `systems` > 1. */
  perSystem?: { coolingTotalBtuh: number; heatingBtuh: number };
}

/** Whether the ducts were held against the airflow, and what they carry
 *  (lib/hvac/ductCalc, 2026-10-08). */
export interface AirflowVerdict {
  /** The airflow the chosen unit (or, with none, the load) moves, CFM. */
  targetCfm: number;
  /** "static": a measured static reading; "sizes": the duct sizes; "none": nothing measured yet. */
  verifiedBy: "static" | "sizes" | "none";
  /** What the measured ducts carry, when sizes were entered. */
  capacityCfm?: number;
  limitedBy?: string;
  /** The chosen unit was stepped down to what the ducts carry. */
  sizedToDucts?: boolean;
}

export interface EngineResult {
  /** The job the engine ran for (src/lib/hvac/jobs.ts). */
  job: string;
  /** Water-heater jobs: the sized plan. */
  waterHeater?: import("./waterHeater").WaterHeaterPlan;
  /** Ductless jobs: the zone the load was run for. */
  zone?: { sqft: number; heads: number };
  /** A heat pump on a gas house: the furnace stays as backup below the balance point. */
  dualFuel?: boolean;
  conditions: DesignConditions;
  load: LoadResult;
  selection: SelectionResult;
  checks: CheckResult[];
  /** Everything a customer could ask about, with its date. */
  notes: Array<{ kind: "code" | "incentive" | "assumption" | "contractor"; text: string }>;
  /** The ducts against the airflow; absent on a result saved before 2026-10-08. */
  airflow?: AirflowVerdict;
  engineVersion: string;
}
