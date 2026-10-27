// THE HOMEOWNER'S ROOF RANGE (owner, 2026-10-27: "the estimators in the home portal — type the address, pick what you
// want, see a range"). A Google Solar roof read (lib/roofSolarEstimate) — or, when the sky can't see the roof, the
// home's size — and three picture answers become the roof package's own facts (lib/roofPackage/takeoff), priced by
// the same package builder the contractor's estimator uses, at the default catalog × the city's construction index.
//
// The homeowner sees a RANGE, never a number: mid × 0.90 to mid × 1.15 — Solar's area is a read, not a measurement,
// and the catalog's own waste and material spread sits inside that. The whole estimate (facts, spec, every line) rides
// along HIDDEN: the contractor who buys the lead opens it; the homeowner never sees a line or a rate.
//
// Pure and client-safe: the range screen re-prices in the browser when a chip changes; the server re-runs the same
// function on a submit and keeps its own result. Two callers share it — the home portal (the lead goes to the Lead
// Center) and the contractor-website estimators (the lead goes to that contractor).
import { BUILTIN_LISTS, ROOF_SYSTEMS, type RoofSystem } from "@/lib/roofPackage/catalog";
import { buildRoofPackage, defaultSpecWith, type RoofFacts, type RoofPackage, type RoofPackageSpec } from "@/lib/roofPackage/takeoff";
import type { SolarRoofEstimate } from "@/lib/roofSolarEstimate";

export type ExistingKey = "asphalt" | "metal" | "tile" | "shake" | "flat" | "unsure";
export type MaterialId = "architectural" | "standing_seam" | "impact_resistant" | "designer" | "three_tab";

/** What's on the roof now — the words the package builder reads as the existing material (familyOfMaterial). */
export const EXISTING: ReadonlyArray<{ id: ExistingKey; label: string; material: string | null }> = [
  { id: "asphalt", label: "Asphalt shingle", material: "Asphalt shingle" },
  { id: "metal", label: "Metal", material: "Metal" },
  { id: "tile", label: "Tile", material: "Tile" },
  { id: "shake", label: "Wood shake", material: "Wood shake" },
  { id: "flat", label: "Flat / rubber", material: "Flat / rubber" },
  { id: "unsure", label: "Not sure", material: null },
];

/** What they would like — five catalog systems, the one most homes get first. */
export const MATERIALS: ReadonlyArray<{ id: MaterialId; label: string; blurb: string }> = [
  { id: "architectural", label: "Architectural shingle", blurb: "Most homes · 30-year" },
  { id: "standing_seam", label: "Standing-seam metal", blurb: "Lasts longest · costs most" },
  { id: "impact_resistant", label: "Impact-resistant shingle", blurb: "Hail and wind · Class 4" },
  { id: "designer", label: "Designer shingle", blurb: "Thick, slate-look" },
  { id: "three_tab", label: "3-tab shingle", blurb: "Keep it simple" },
];

export type RoofAnswers = {
  existing: ExistingKey;
  storeys: 1 | 2 | 3;
  material: MaterialId;
  tearOffLayers: 0 | 1 | 2;
  leaks: boolean;
  skylights: boolean;
  solarPanels: boolean;
};

export const DEFAULT_ANSWERS: RoofAnswers = { existing: "asphalt", storeys: 2, material: "architectural", tearOffLayers: 1, leaks: false, skylights: false, solarPanels: false };

/** A home's footprint to its roof: a 6/12 slope plus the eaves past the walls. */
const SIZE_ROOF_FACTOR = 1.15;

const round100 = (n: number) => Math.round(n / 100) * 100;
const r1 = (n: number) => Math.round(n * 10) / 10;

function existingMaterialOf(answers: RoofAnswers): string | null {
  return EXISTING.find((e) => e.id === answers.existing)?.material ?? null;
}

/** Solar's roof read → the package's facts. Shares by surface area (a steep wing is priced by its sloped area). */
export function roofFactsFromSolar(solar: SolarRoofEstimate, answers: RoofAnswers, state: string | null): RoofFacts {
  const surfaceTotal = solar.pitchFamilies.reduce((t, f) => t + f.surfaceSqft, 0);
  const pitchFamilies =
    surfaceTotal > 0
      ? solar.pitchFamilies.map((f) => ({ pitch12: f.pitch12, share: f.surfaceSqft / surfaceTotal }))
      : [{ pitch12: solar.predominantPitch12, share: 1 }];
  return {
    squares: r1(solar.areaSqft / 100),
    squaresBasis: "estimated",
    pitchFamilies,
    pitchBasis: "estimated",
    // Solar gives a bounding box, never an outline: the package builder's footprint approximation applies.
    perimeterFt: null,
    footprintSqft: solar.footprintSqft > 0 ? Math.round(solar.footprintSqft) : null,
    chimney: null,
    rooftopAcCount: null,
    shape: null,
    facetCount: null,
    facetCountEstimated: Number.isSafeInteger(solar.segmentCount) && solar.segmentCount > 0 ? solar.segmentCount : null,
    measured: null,
    existingMaterial: existingMaterialOf(answers),
    state,
    buildingUse: "residential",
    storeys: answers.storeys,
  };
}

/** No roof read: the home's size and floors → a footprint → a roof at a 6/12 slope with its eaves. */
export function roofFactsFromSize(homeSqft: number, answers: RoofAnswers, state: string | null): RoofFacts {
  const footprint = Math.max(200, Math.round(homeSqft / answers.storeys));
  return {
    squares: r1((footprint * SIZE_ROOF_FACTOR) / 100),
    squaresBasis: "estimated",
    pitchFamilies: [{ pitch12: 6, share: 1 }],
    pitchBasis: "estimated",
    perimeterFt: null,
    footprintSqft: footprint,
    chimney: null,
    rooftopAcCount: null,
    shape: null,
    facetCount: null,
    measured: null,
    existingMaterial: existingMaterialOf(answers),
    state,
    buildingUse: "residential",
    storeys: answers.storeys,
  };
}

type PkgLine = RoofPackage["materials"][number];

export type RoofRange = {
  low: number;
  mid: number;
  high: number;
  squares: number;
  pitchLabel: string;
  basis: "solar" | "size";
  /** For the homeowner: the work in plain sentences, every line that names a price left out. */
  scope: string[];
  cityFactor: number;
  cityWords: string | null;
  /** The whole estimate, for the contractor who buys the lead — never shown to the homeowner. */
  hidden: { facts: RoofFacts; spec: RoofPackageSpec; materials: PkgLine[]; labor: PkgLine[]; assumptions: string[]; scopeText: string };
};

function systemOf(material: MaterialId): RoofSystem {
  return ROOF_SYSTEMS.find((s) => s.id === material) ?? ROOF_SYSTEMS[0];
}

const pitchLabelOf = (facts: RoofFacts): string => {
  const main = facts.pitchFamilies.reduce<{ pitch12: number; share: number } | null>((a, f) => (a == null || f.share > a.share ? f : a), null);
  return `${Math.round(main?.pitch12 ?? 6)}/12`;
};

/**
 * The range for these facts and choices. `city.factor` scales every line (the hidden estimate matches the mid the
 * homeowner saw; the contractor's own rates apply once they open it); `basis` says where the facts came from.
 */
export function roofRange(facts: RoofFacts, answers: RoofAnswers, city: { factor: number; words: string } | null, basis: "solar" | "size"): RoofRange {
  const factor = city && Number.isFinite(city.factor) && city.factor > 0 ? city.factor : 1;
  const spec: RoofPackageSpec = { ...defaultSpecWith(facts, BUILTIN_LISTS, systemOf(answers.material)), tearOffLayers: answers.tearOffLayers };
  const pkg = buildRoofPackage(spec, facts);
  const scaled = (l: PkgLine): PkgLine => ({ ...l, unitPrice: Math.round(l.unitPrice * factor * 100) / 100 });
  const materials = pkg.materials.map(scaled);
  const labor = pkg.labor.map(scaled);
  const total = [...materials, ...labor].reduce((t, l) => t + l.quantity * l.unitPrice, 0);
  const mid = round100(total);
  return {
    low: round100(mid * 0.9),
    mid,
    high: round100(mid * 1.15),
    squares: facts.squares,
    pitchLabel: pitchLabelOf(facts),
    basis,
    scope: pkg.scope.filter((s) => !/\$/.test(s)),
    cityFactor: factor,
    cityWords: city?.words ?? null,
    hidden: { facts, spec, materials, labor, assumptions: pkg.assumptions, scopeText: pkg.scope.join(" ") },
  };
}

/** "$14,200–$19,800". */
export function moneyRange(r: Pick<RoofRange, "low" | "high">): string {
  const usd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
  return `${usd(r.low)}–${usd(r.high)}`;
}
