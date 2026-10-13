// How each trade of a house built from plans is priced by the Smart Proposal estimator.
// Pure.
//
// The estimator was written for jobs on houses that stand: its procedures tear off,
// remove, protect and patch, its permit pass decides from a brief whether a repair
// needs a permit, and its remodel method adds demolition to anything that names a
// kitchen. A trade off a blueprint is none of that, so each one is pinned here:
//   · the specialty that prices it (detection is skipped — "new house" is a stop word
//     to the detector, and a brief listing six trades would pick whichever came first)
//   · that specialty's procedure without the steps a new house never has
//   · the permit: the electrical, plumbing and mechanical trades pull their own; every
//     other trade works under the building permit, which the general conditions carry
//   · the trade profile the validator checks it against, without its remodel phases
//   · the takeoff quantity the specialty's benchmark is measured in — only where that
//     benchmark is a new house's (a framing package, a roof), never a replacement's
import type { PermitCall } from "../estimate/permits";
import type { SpecialtyProcedure } from "../estimate/procedures/types";
import { excludedWork, tradeBrief, type HouseBrief } from "./tradeBrief";
import { TRADE_LABEL, type PlanTrade, type TakeoffItem } from "./takeoff";

export type TradeSetup = {
  specialtyId: string;
  /** lib/estimate/trade-knowledge profile the validator checks the lines against. */
  profileId: string;
  /** The profile's line quota for a trade this size ("8-16" when unset). */
  lineRange?: string;
  permit: PermitCall;
};

const UNDER_THE_BUILDING_PERMIT: PermitCall = { need: "not-needed", reason: "work under the new house's building permit" };

export const TRADE_SETUP: Record<PlanTrade, TradeSetup> = {
  general: {
    specialtyId: "residential-new-home-builder",
    profileId: "general",
    lineRange: "5-12",
    permit: { need: "required", reason: "a new house (the building permit, plan review and every inspection through the certificate of occupancy)" },
  },
  sitework: { specialtyId: "excavation-grading", profileId: "general", lineRange: "6-14", permit: UNDER_THE_BUILDING_PERMIT },
  foundation: { specialtyId: "concrete-contractor", profileId: "concrete", permit: UNDER_THE_BUILDING_PERMIT },
  framing: { specialtyId: "framing-contractor", profileId: "general", permit: UNDER_THE_BUILDING_PERMIT },
  roofing: { specialtyId: "roofing", profileId: "roofing", permit: UNDER_THE_BUILDING_PERMIT },
  gutters: { specialtyId: "gutter-installation", profileId: "gutters", lineRange: "4-10", permit: UNDER_THE_BUILDING_PERMIT },
  "windows-doors": { specialtyId: "window-door", profileId: "windows-doors", permit: UNDER_THE_BUILDING_PERMIT },
  siding: { specialtyId: "siding-installation", profileId: "siding", permit: UNDER_THE_BUILDING_PERMIT },
  insulation: { specialtyId: "insulation-weatherization", profileId: "insulation", lineRange: "5-12", permit: UNDER_THE_BUILDING_PERMIT },
  drywall: { specialtyId: "drywall", profileId: "drywall", permit: UNDER_THE_BUILDING_PERMIT },
  "interior-trim": { specialtyId: "finish-carpentry", profileId: "general", lineRange: "5-14", permit: UNDER_THE_BUILDING_PERMIT },
  flooring: { specialtyId: "flooring-installation", profileId: "flooring", permit: UNDER_THE_BUILDING_PERMIT },
  tile: { specialtyId: "tile-stone", profileId: "tile", permit: UNDER_THE_BUILDING_PERMIT },
  cabinets: { specialtyId: "millwork-cabinet", profileId: "general", lineRange: "5-14", permit: UNDER_THE_BUILDING_PERMIT },
  painting: { specialtyId: "painting", profileId: "painting", permit: UNDER_THE_BUILDING_PERMIT },
  plumbing: {
    specialtyId: "plumbing",
    profileId: "plumbing",
    permit: { need: "required", reason: "new plumbing throughout a new house (the plumbing permit with its underground, rough-in and final inspections)" },
  },
  electrical: {
    specialtyId: "residential-electrical",
    profileId: "electrical",
    permit: { need: "required", reason: "new wiring throughout a new house (the electrical permit with its rough-in and final inspections)" },
  },
  hvac: {
    specialtyId: "residential-hvac",
    profileId: "hvac",
    permit: { need: "required", reason: "a new heating and cooling system (the mechanical permit and its inspections)" },
  },
};

/**
 * The general conditions of a new house. The new-home builder's own procedure walks
 * every phase of the build, which on a trade-by-trade estimate would price the house
 * twice; this one is what the builder carries for the whole job. Three steps keep the
 * builder price book's exact wording, so the book prices them.
 */
export const GENERAL_CONDITIONS_PROCEDURE: SpecialtyProcedure = {
  basis: "permits and fees fixed; temporary facilities and supervision by the month; utility laterals by linear ft; final cleaning by sqft of the house",
  steps: [
    { item: "Permits, plan review and impact fees: building permit, school and utility impact fees, energy compliance and the stamped structural set filed", unit: "fixed" },
    { item: "Survey and staking: lot corners, house corners and the foundation location set by a licensed surveyor, with the foundation location survey", unit: "fixed" },
    { item: "Temporary power pole with meter, temporary water and a portable toilet serviced weekly, by the month on site", unit: "unit" },
    { item: "Site supervision: superintendent visits, trade scheduling and inspection coordination, by the month", unit: "unit" },
    { item: "Underground utilities: water and sewer or septic laterals, gas and electric conduit from the street to the house", unit: "linear ft" },
    { item: "Final construction clean: windows, floors, cabinets, fixtures and surfaces cleaned before the owner walk-through", unit: "sqft" },
    { item: "Builder warranty: one-year workmanship, two-year systems and ten-year structural, with manufacturer registrations", unit: "fixed", when: "the builder offers the structural warranty" },
  ],
  avoid: [
    "any trade's own work — framing, roofing, plumbing and every other trade is priced on its own",
    "a markup, overhead or profit line — the proposal applies the company's markup",
  ],
  notes: ["Utility connection and tap fees billed by the utilities are not included unless listed."],
};

/** Steps of a replacement, a repair or a lived-in house — a house built from plans never has them. */
const NOT_NEW_BUILD =
  /^(?:saw-cut,?\s+break out|tear-off|remov(?:e|al of) (?:the )?(?:existing|damaged|old)|remove (?:existing|damaged)|old\b|demolition:|refrigerant recovered|diagnosis:|stoppage|code corrections|wire fished|access openings|drywall patch|patch repairs|floors?,? (?:furniture|and cabinets)[^.]{0,30}protected|energy assessment|move furniture|toilets and appliances pulled|deck repair|rough-opening repair|sheathing repair|lead-safe|detach and reset|chimney and skylight re-flashing|utility coordination: meter pull)/i;

export function newBuildProcedure(p: SpecialtyProcedure): SpecialtyProcedure {
  return { ...p, steps: p.steps.filter((s) => !NOT_NEW_BUILD.test(s.item.trim())) };
}

/** A trade profile's phases without the ones that only exist on a house that stands. */
const REMODEL_PHASE = /\b(?:remov\w*|demoli\w*|tear[- ]?off|existing|repair allowance|patching|access openings|old)\b/i;
export function newBuildPhases(phases: readonly string[]): string[] {
  return phases.filter((p) => !REMODEL_PHASE.test(p));
}

/**
 * The quantity a trade's specialty benchmark is measured in, from the takeoff — null
 * where the benchmark describes some other job (a window REPLACEMENT, a commercial
 * build-out, a repaint) and would mislead the model about a new house.
 */
export function benchmarkQty(trade: PlanTrade, h: HouseBrief, items: TakeoffItem[]): number | null {
  const q = (id: string) => items.find((i) => i.id === id)?.qty ?? 0;
  const sum = (pred: (i: TakeoffItem) => boolean) => items.filter(pred).reduce((a, i) => a + i.qty, 0);
  let n = 0;
  switch (trade) {
    case "framing":
      n = h.livingSqFt + h.garageSqFt;
      break;
    case "roofing":
      n = q("roofing.area") / 100; // the roofing book sells by the square
      break;
    case "gutters":
      n = q("gutters.gutter");
      break;
    case "siding":
      n = q("siding.net");
      break;
    case "drywall":
      n = sum((i) => i.trade === "drywall" && i.unit === "sq ft");
      break;
    case "interior-trim":
      n = q("interior-trim.base") + q("interior-trim.casing");
      break;
    case "tile":
      n = sum((i) => i.trade === "tile" && i.unit === "sq ft");
      break;
    case "foundation":
      n = h.foundation === "slab" ? q("foundation.slab") : 0;
      break;
    default:
      n = 0;
  }
  return n > 0 ? Math.round(n * 10) / 10 : null;
}

/** Everything the estimate action needs to price one trade, from what the client sent. */
export type PlanTradeRun = {
  trade: PlanTrade;
  label: string;
  setup: TradeSetup;
  brief: string;
  block: string;
  items: TakeoffItem[];
  benchmarkQty: number | null;
  /** The neighbours' work this trade was told to leave out (for the estimate's notes). */
  leftOut: string[];
};

export function planTradeRun(input: { trade: PlanTrade; house: HouseBrief; items: TakeoffItem[]; alsoPriced: readonly PlanTrade[] }): PlanTradeRun {
  const b = tradeBrief(input.trade, input.house, input.items, input.alsoPriced);
  return {
    trade: input.trade,
    label: TRADE_LABEL[input.trade],
    setup: TRADE_SETUP[input.trade],
    brief: b.brief,
    block: b.takeoffBlock,
    items: b.items,
    benchmarkQty: benchmarkQty(input.trade, input.house, b.items),
    leftOut: excludedWork(input.trade, input.alsoPriced).map((o) => `${o.work} (${TRADE_LABEL[o.owner]})`),
  };
}
