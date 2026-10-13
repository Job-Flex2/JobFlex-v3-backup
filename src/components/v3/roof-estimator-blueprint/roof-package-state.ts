import type { CatalogLists } from "@/lib/roofPackage/catalog";
import type { RoofFacts, RoofPackageSpec } from "@/lib/roofPackage/takeoff";

export const PREFS_KEY = "jf.roofPackage.prefs.v1";
export const LISTS_KEY = "jf.roofPackage.lists.v1";

/** The spec fields that are the contractor's standing preferences, not this roof's entries. */
export const PREF_KEYS = [
  "systemId", "systemName", "systemFamily", "systemMatPerSq", "systemLaborPerSq", "capPerFt", "wastePct",
  "underlaymentId", "underlaymentName", "underlaymentPerSq", "iceWater", "iceWaterPerSqft",
  "dripEdgeOn", "dripProfileId", "dripSizeId", "dripPerFt", "starterOn", "starterPerFt",
  "valleyTypeId", "valleyMatPerFt", "valleyLaborPerFt", "stepSizeId", "stepPerPiece", "stepLaborPerFt",
  "apronPerFt", "apronLaborPerFt", "counterPerFt", "counterLaborPerFt", "pipeBootPrices",
  "chimneySizeId", "chimneyEach", "chimneyLabor", "curbEach", "curbLabor", "ventBalanced",
  "tearOffPerSqLayer", "disposalPerSqLayer", "plywoodEach", "plywoodLabor", "plywoodQuote", "plywoodUnit",
  "nailsPerSq", "sealantPerSq", "cleanupLump", "safetyLump", "permitLump", "deliveryLump",
] as const satisfies ReadonlyArray<keyof RoofPackageSpec>;

export type Prefs = Partial<Pick<RoofPackageSpec, (typeof PREF_KEYS)[number]>> & {
  /** Vent unit prices by vent id — quantities are per roof. */
  ventPrices?: Record<string, { each: number; labor: number }>;
};

export function prefsOf(spec: RoofPackageSpec): Prefs {
  const p: Prefs = {};
  for (const k of PREF_KEYS) (p as Record<string, unknown>)[k] = spec[k];
  p.ventPrices = Object.fromEntries(spec.vents.map((v) => [v.id, { each: v.each, labor: v.labor }]));
  return p;
}
export function readLocal<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
export function writeLocal(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private window, blocked storage — the builder still works, it just forgets */
  }
}
/** Overlay saved preferences, field by field, only where the saved value has the field's type. */
export function applyPrefs(spec: RoofPackageSpec, p: Prefs | Record<string, unknown> | null | undefined): RoofPackageSpec {
  if (!p) return spec;
  const out: RoofPackageSpec = { ...spec };
  const src = p as Record<string, unknown>;
  for (const k of PREF_KEYS) {
    const v = src[k];
    if (v === undefined || v === null) continue;
    if (typeof v !== typeof spec[k]) continue;
    (out as unknown as Record<string, unknown>)[k] = v;
  }
  const vp = src.ventPrices as Prefs["ventPrices"];
  if (vp && typeof vp === "object") {
    out.vents = out.vents.map((v) => {
      const s = vp[v.id];
      return s && typeof s.each === "number" && typeof s.labor === "number" ? { ...v, each: s.each, labor: s.labor } : v;
    });
  }
  return out;
}
/** A saved list is only trusted when it still reads like one. */
export function saneLists(l: unknown): CatalogLists | null {
  const x = l as CatalogLists | null;
  if (!x || !Array.isArray(x.systems) || !Array.isArray(x.underlayments) || !x.systems.length || !x.underlayments.length) return null;
  const okSys = x.systems.every((s) => s && typeof s.id === "string" && typeof s.label === "string" && typeof s.matPerSq === "number" && typeof s.laborPerSq === "number");
  const okUnd = x.underlayments.every((u) => u && typeof u.id === "string" && typeof u.label === "string" && typeof u.perSq === "number");
  return okSys && okUnd ? x : null;
}
/** Keep the spec's picks pointing at rows that exist in the lists. */
export function reconcile(spec: RoofPackageSpec, lists: CatalogLists): RoofPackageSpec {
  let out = spec;
  if (!lists.systems.some((s) => s.id === spec.systemId)) {
    const s = lists.systems[0];
    out = { ...out, systemId: s.id, systemName: s.label, systemFamily: s.family, systemMatPerSq: s.matPerSq, systemLaborPerSq: s.laborPerSq, capPerFt: s.capPerFt, wastePct: s.wastePct };
  }
  if (!lists.underlayments.some((u) => u.id === spec.underlaymentId)) {
    const u = lists.underlayments[0];
    out = { ...out, underlaymentId: u.id, underlaymentName: u.label, underlaymentPerSq: u.perSq };
  }
  return out;
}

/** Facts that, when they change, mean a different roof is open. */
export const factsKey = (f: RoofFacts) =>
  [f.squares, f.perimeterFt, f.footprintSqft, f.chimney, f.rooftopAcCount, f.shape, f.pitchFamilies.map((p) => `${p.pitch12}:${p.share}`).join(",")].join("|");

export const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
export const fmt = (n: number) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
