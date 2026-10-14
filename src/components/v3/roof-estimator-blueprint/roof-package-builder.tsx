"use client";

// Roof package builder — the contractor picks what goes on the roof and the
// measured figures do the takeoff (lib/roofPackage). The DEFAULT way to price
// a measured roof since 2026-09-12 (owner: "very plain, no details into the
// roof — not going to work for a client and contractor"); the AI path stays
// beside it.
//
// THE CATALOG IS THE CONTRACTOR'S. Roof types and underlayments are editable
// lists (Edit → rename, price, add, remove) and every other item has an
// editable unit price. "Save as defaults" writes the lists and the standing
// prices to the org (actions/roofCatalog) so the whole crew prices the same
// way; the browser keeps a copy so a device that cannot reach the table — or
// an environment where it is not pushed yet — still works.
//
// Two kinds of state live in the spec. PREFERENCES — selections and unit
// prices — persist. PER-ROOF entries — counts and lengths — start from this
// roof's facts and reset when another measurement opens.
//
// LAYOUT (redesigned 2026-09-12, owner's critique: "overload of information").
// The builder reads like an estimate sheet: a ticket on top with the running
// total and the two actions, one mono line of the roof's facts, then seven
// ledger rows — one per part of the roof — each CLOSED by default and summed
// up in a single line (what is picked, how much of it). Opening a row shows
// this roof's entries first (counts, lengths, toggles) and the contractor's
// RATES in a quieter strip under them, because the rates are set once and the
// entries change on every roof. Nothing was removed: every field the old
// wall-of-inputs had is still here, just behind the row that owns it.

import * as React from "react";
import { nanoid } from "nanoid";
import { toast } from "@/components/ui/Toast";
import { getRoofCatalog, saveRoofCatalog } from "@/actions/roofCatalog";
import {
  BUILTIN_LISTS,
  CHIMNEY_SIZES,
  DRIP_EDGE_PROFILES,
  DRIP_EDGE_SIZES,
  familyOfMaterial,
  ICE_WATER,
  likeForLikeSystem,
  PIPE_BOOT_SIZES,
  PKG_UNITS,
  ROOF_FAMILIES,
  STEP_FLASHING_SIZES,
  VALLEY_TYPES,
  VENT_TYPES,
  WASTE_OPTIONS,
  type CatalogLists,
  type IceWaterCoverage,
  type PkgUnit,
  type RoofFamily,
  type RoofSystem,
  type Underlayment,
  displayPitch12,
} from "@/lib/roofPackage/catalog";
import {
  buildRoofPackage,
  checkVentilation,
  defaultSpec,
  estimateEdges,
  openingSystem,
  withSystem,
  type RoofFacts,
  type RoofPackage,
  type RoofPackageSpec,
} from "@/lib/roofPackage/takeoff";
import { isFlatRoof } from "@/lib/roofPackage/flatRule";
import { PRE_FLAT_RELEASE_IDS } from "@/lib/roofPackage/catalog";
import { lowSlopeSystemForMaterial } from "@/lib/roofPackage/lowSlope";
import { SHIFTS, WAGE_REGIMES } from "@/lib/roofPackage/commercial";

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
  "tearOffPerSqLayer", "disposalPerSqLayer", "plywoodEach", "plywoodLabor", "plywoodQuote", "plywoodUnit", "plywoodBoardId", "plywoodSize",
  "nailsPerSq", "sealantPerSq", "cleanupLump", "safetyLump", "permitLump", "deliveryLump",
  // Fascia & gutters (2026-09-19): the board this shop fits and its rates,
  // and what they do with the gutters. The LENGTHS are per roof, never saved.
  "fasciaOn", "fasciaOptionId", "fasciaRun", "fasciaPerFt", "fasciaLaborPerFt",
  "gutterPlan", "gutterResetPerFt", "gutterPerFt", "gutterLaborPerFt",
] as const satisfies ReadonlyArray<keyof RoofPackageSpec>;

export type Prefs = Partial<Pick<RoofPackageSpec, (typeof PREF_KEYS)[number]>> & {
  /** Vent unit prices by vent id — quantities are per roof. */
  ventPrices?: Record<string, { each: number; labor: number }>;
  /** The flat system this contractor usually installs, for a roof the data only calls "flat". */
  lowSlopeSystemId?: string;
  /** Underlayment and valley picks per roof family: a tile roof's high-temp underlayment never lands on the next shingle house. */
  families?: Record<string, { underlaymentId?: string; underlaymentName?: string; underlaymentPerSq?: number; valleyTypeId?: string; valleyMatPerFt?: number; valleyLaborPerFt?: number }>;
  /** Flat-roof standing preferences: rates, habits and the prices of each option they picked — never a roof's counts. */
  flat?: {
    rates?: Record<string, number>;
    drainWork?: string;
    boardPrices?: Record<string, { mat: number; labor: number }>;
    warrantyPrices?: Record<string, number>;
    tearOffPrices?: Record<string, { tearOff: number; disposal: number }>;
  };
  /** Commercial rates and the shop's wage regime — never whether a job is commercial. */
  commercial?: { rates?: Record<string, number>; wage?: string };
};

/** The system fields: a pick, not a price. */
const SYSTEM_KEYS: ReadonlyArray<(typeof PREF_KEYS)[number]> = [
  "systemId", "systemName", "systemFamily", "systemMatPerSq", "systemLaborPerSq", "capPerFt", "wastePct",
];
/** Picks that belong to a roof FAMILY, saved per family (Prefs.families). */
const FAMILY_KEYS: ReadonlyArray<(typeof PREF_KEYS)[number]> = [
  "underlaymentId", "underlaymentName", "underlaymentPerSq", "valleyTypeId", "valleyMatPerFt", "valleyLaborPerFt",
];
/**
 * What only means something on a STEEP roof. A flat job never saves these and
 * never takes them: before 2026-09-14 one TPO estimate rewrote the standing
 * shingle defaults (ice & water off, no vents, no nails) for every house after.
 */
const STEEP_ONLY: ReadonlyArray<(typeof PREF_KEYS)[number]> = [
  ...SYSTEM_KEYS,
  ...FAMILY_KEYS,
  "iceWater", "iceWaterPerSqft",
  "dripEdgeOn", "dripProfileId", "dripSizeId", "dripPerFt", "starterOn", "starterPerFt",
  "stepSizeId", "stepPerPiece", "stepLaborPerFt",
  "apronPerFt", "apronLaborPerFt", "counterPerFt", "counterLaborPerFt", "pipeBootPrices",
  "chimneySizeId", "chimneyEach", "chimneyLabor", "curbEach", "curbLabor", "ventBalanced",
  "tearOffPerSqLayer", "disposalPerSqLayer", "nailsPerSq", "sealantPerSq", "safetyLump", "deliveryLump",
  // A flat roof's edge metal carries its own fascia, so a flat job neither
  // saves nor takes the steep fascia habit.
  "fasciaOn", "fasciaOptionId", "fasciaRun", "fasciaPerFt", "fasciaLaborPerFt",
  "gutterPlan", "gutterResetPerFt", "gutterPerFt", "gutterLaborPerFt",
];

/**
 * The standing preferences this spec implies, MERGED over what is already
 * saved (the browser's copy unless `base` is given; pass null for none). The
 * merge is what lets a flat job save its flat rates without erasing the
 * shingle defaults it has no opinion about, and every card that writes
 * `prefsOf(next)` gets that for free.
 *
 * Reviewed 2026-09-14: the system is saved as the contractor's USUAL one only
 * when they picked it — never when the roof picked it like-for-like. A
 * system's PRICE is never saved here: it lives on its catalog row, which the
 * row-01 rates and Manage roof types both edit, so there is one truth.
 */
export function prefsOf(spec: RoofPackageSpec, base?: Prefs | null): Prefs {
  const saved = base === undefined ? (typeof window === "undefined" ? null : readLocal<Prefs>(PREFS_KEY)) : base;
  const p: Prefs = saved && typeof saved === "object" ? { ...saved } : {};
  const low = spec.systemFamily === "low-slope";
  // A steep system left on a spec that was flattened for a flat roof (a
  // preview card that swaps systems without withSystem) carries no shingle
  // opinion worth keeping: saving it would switch off ice & water, vents and
  // nails for every house after.
  const flattened = !low && spec.underlaymentId === "none" && spec.iceWater === "none" && spec.nailsPerSq === 0 && spec.sealantPerSq === 0;
  const rec = p as Record<string, unknown>;
  for (const k of PREF_KEYS) {
    if ((low || flattened) && STEEP_ONLY.includes(k)) continue;
    if (SYSTEM_KEYS.includes(k) && spec.systemAuto) continue;
    if (FAMILY_KEYS.includes(k)) continue;
    rec[k] = spec[k];
  }
  if (low) {
    if (!spec.systemAuto) p.lowSlopeSystemId = spec.systemId;
    if (spec.flat) {
      const prev = p.flat ?? {};
      p.flat = {
        rates: { ...spec.flat.rates },
        drainWork: spec.flat.drainWork,
        boardPrices: {
          ...(prev.boardPrices ?? {}),
          ...(spec.flat.insulationId !== "none" ? { [`ins:${spec.flat.insulationId}`]: { mat: spec.flat.insulationMatPerSq, labor: spec.flat.insulationLaborPerSq } } : {}),
          ...(spec.flat.coverBoardId !== "none" ? { [`cover:${spec.flat.coverBoardId}`]: { mat: spec.flat.coverBoardMatPerSq, labor: spec.flat.coverBoardLaborPerSq } } : {}),
        },
        warrantyPrices: { ...(prev.warrantyPrices ?? {}), ...(spec.flat.warrantyId !== "none" ? { [spec.flat.warrantyId]: spec.flat.warrantyPerSq } : {}) },
        tearOffPrices: { ...(prev.tearOffPrices ?? {}), [spec.flat.existing]: { tearOff: spec.tearOffPerSqLayer, disposal: spec.disposalPerSqLayer } },
      };
    }
  } else if (!flattened) {
    p.ventPrices = { ...(p.ventPrices ?? {}), ...Object.fromEntries(spec.vents.map((v) => [v.id, { each: v.each, labor: v.labor }])) };
    p.families = {
      ...(p.families ?? {}),
      [spec.systemFamily]: {
        underlaymentId: spec.underlaymentId, underlaymentName: spec.underlaymentName, underlaymentPerSq: spec.underlaymentPerSq,
        valleyTypeId: spec.valleyTypeId, valleyMatPerFt: spec.valleyMatPerFt, valleyLaborPerFt: spec.valleyLaborPerFt,
      },
    };
  }
  if (spec.commercial) p.commercial = { rates: { ...spec.commercial.rates }, wage: spec.commercial.wage };
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

const numOk = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

/**
 * The prices this contractor last set for the flat-roof options picked on the
 * spec now: the insulation, cover board, warranty and existing-roof tear-off.
 * Called after every pick and every re-seed, so a price edit follows the
 * option, not the roof. (System prices live on the catalog row — reconcile.)
 */
export function applyPickedPrices(spec: RoofPackageSpec, p: Prefs | Record<string, unknown> | null | undefined): RoofPackageSpec {
  if (!p) return spec;
  const src = p as Prefs;
  let out = spec;
  if (out.systemFamily === "low-slope" && src.flat) {
    const f = { ...out.flat };
    const ins = src.flat.boardPrices?.[`ins:${f.insulationId}`];
    if (f.insulationId !== "none" && ins && numOk(ins.mat) && numOk(ins.labor)) Object.assign(f, { insulationMatPerSq: ins.mat, insulationLaborPerSq: ins.labor });
    const cov = src.flat.boardPrices?.[`cover:${f.coverBoardId}`];
    if (f.coverBoardId !== "none" && cov && numOk(cov.mat) && numOk(cov.labor)) Object.assign(f, { coverBoardMatPerSq: cov.mat, coverBoardLaborPerSq: cov.labor });
    const wp = src.flat.warrantyPrices?.[f.warrantyId];
    if (f.warrantyId !== "none" && numOk(wp)) f.warrantyPerSq = wp;
    out = { ...out, flat: f };
    const tp = src.flat.tearOffPrices?.[f.existing];
    if (tp && numOk(tp.tearOff) && numOk(tp.disposal)) out = { ...out, tearOffPerSqLayer: tp.tearOff, disposalPerSqLayer: tp.disposal };
  }
  return out;
}

/**
 * Overlay saved preferences, field by field, only where the saved value has
 * the field's type. A flat spec takes no steep-only field; `keepSystem`
 * leaves the system pick alone (used after the system was chosen on purpose).
 */
export function applyPrefs(spec: RoofPackageSpec, p: Prefs | Record<string, unknown> | null | undefined, opts: { keepSystem?: boolean } = {}): RoofPackageSpec {
  if (!p) return spec;
  let out: RoofPackageSpec = { ...spec };
  const src = p as Record<string, unknown>;
  const low = spec.systemFamily === "low-slope";
  const legacyFamily = src.systemFamily;
  const takeSystem = !low && !opts.keepSystem && typeof src.systemId === "string" && typeof src.systemFamily === "string" && src.systemFamily !== "low-slope";
  const targetFamily = takeSystem ? legacyFamily : spec.systemFamily;
  for (const k of PREF_KEYS) {
    if (low && STEEP_ONLY.includes(k)) continue;
    if (SYSTEM_KEYS.includes(k) && !takeSystem) continue;
    if (FAMILY_KEYS.includes(k) && legacyFamily !== targetFamily) continue;
    const v = src[k];
    if (v === undefined || v === null) continue;
    if (typeof v !== typeof spec[k]) continue;
    (out as unknown as Record<string, unknown>)[k] = v;
  }
  if (takeSystem) out.systemAuto = false;
  // The family's own underlayment and valley, over any legacy top-level pick.
  const fam = (src.families as Prefs["families"])?.[out.systemFamily];
  if (!low && fam && typeof fam === "object") {
    if (typeof fam.underlaymentId === "string" && typeof fam.underlaymentName === "string" && numOk(fam.underlaymentPerSq)) {
      out = { ...out, underlaymentId: fam.underlaymentId, underlaymentName: fam.underlaymentName, underlaymentPerSq: fam.underlaymentPerSq };
    }
    if (typeof fam.valleyTypeId === "string" && numOk(fam.valleyMatPerFt) && numOk(fam.valleyLaborPerFt)) {
      out = { ...out, valleyTypeId: fam.valleyTypeId, valleyMatPerFt: fam.valleyMatPerFt, valleyLaborPerFt: fam.valleyLaborPerFt };
    }
  }
  const nums = (r: unknown) =>
    r && typeof r === "object" ? Object.fromEntries(Object.entries(r as Record<string, unknown>).filter(([, v]) => numOk(v))) : {};
  const fp = src.flat as Prefs["flat"];
  if (fp && typeof fp === "object" && out.flat) {
    out.flat = {
      ...out.flat,
      rates: { ...out.flat.rates, ...nums(fp.rates) },
      ...(fp.drainWork === "insert" || fp.drainWork === "new" || fp.drainWork === "ring" ? { drainWork: fp.drainWork } : {}),
    };
  }
  const cp = src.commercial as Prefs["commercial"];
  if (cp && typeof cp === "object" && out.commercial) {
    out.commercial = {
      ...out.commercial,
      rates: { ...out.commercial.rates, ...nums(cp.rates) },
      ...(WAGE_REGIMES.some((w) => w.id === cp.wage) ? { wage: cp.wage as RoofPackageSpec["commercial"]["wage"] } : {}),
    };
  }
  const vp = low ? null : (src.ventPrices as Prefs["ventPrices"]);
  if (vp && typeof vp === "object") {
    out.vents = out.vents.map((v) => {
      const s = vp[v.id];
      return s && typeof s.each === "number" && typeof s.labor === "number" ? { ...v, each: s.each, labor: s.labor } : v;
    });
  }
  return applyPickedPrices(out, p);
}
/**
 * The flat rows as they were priced before 2026-09-14 — ALL-IN figures, from
 * before insulation, cover board, fasteners, edge metal and the rest became
 * lines of their own. A saved catalog still carrying one of these at exactly
 * this price was never re-priced by the contractor, so it is swapped for
 * today's membrane-only row; leaving it would count the assembly twice.
 */
const OLD_ALL_IN_FLAT: Record<string, { mat: number; labor: number }> = {
  tpo: { mat: 250, labor: 250 },
  epdm: { mat: 220, labor: 230 },
  pvc: { mat: 300, labor: 270 },
  mod_bit: { mat: 220, labor: 240 },
  bur: { mat: 260, labor: 300 },
  rolled: { mat: 90, labor: 120 },
  green_roof: { mat: 1500, labor: 1200 },
};

/** A saved list is only trusted when it still reads like one — and it is brought up to date on the way in. */
export function saneLists(l: unknown): CatalogLists | null {
  const x = l as CatalogLists | null;
  if (!x || !Array.isArray(x.systems) || !Array.isArray(x.underlayments) || !x.systems.length || !x.underlayments.length) return null;
  const okSys = x.systems.every((s) => s && typeof s.id === "string" && typeof s.label === "string" && typeof s.matPerSq === "number" && typeof s.laborPerSq === "number");
  const okUnd = x.underlayments.every((u) => u && typeof u.id === "string" && typeof u.label === "string" && typeof u.perSq === "number");
  if (!okSys || !okUnd) return null;
  // A row saved before wastePct / capPerFt existed reads as NaN in the
  // takeoff (review 2026-09-17): fill the two from the built-in row of the
  // same id, else the catalog's plain defaults.
  const builtin = new Map(BUILTIN_LISTS.systems.map((s) => [s.id, s]));
  const systems = x.systems.map((s) => {
    const b = builtin.get(s.id);
    return {
      ...s,
      wastePct: typeof s.wastePct === "number" && Number.isFinite(s.wastePct) ? s.wastePct : b?.wastePct ?? 10,
      capPerFt: typeof s.capPerFt === "number" && Number.isFinite(s.capPerFt) ? s.capPerFt : b?.capPerFt ?? 0,
    };
  });
  return upgradeLists({ ...x, systems });
}

/** Swap untouched all-in flat rows for today's rows, and add the built-in
 *  systems a saved catalog does not have yet (the flat list grew from 7 to
 *  37). The contractor's own rows and re-priced rows are never touched. */
export function upgradeLists(x: CatalogLists): CatalogLists {
  const builtin = new Map(BUILTIN_LISTS.systems.map((s) => [s.id, s]));
  let changed = false;
  const systems = x.systems.map((s) => {
    const old = OLD_ALL_IN_FLAT[s.id];
    const now = builtin.get(s.id);
    if (old && now && s.matPerSq === old.mat && s.laborPerSq === old.labor) {
      changed = true;
      return now;
    }
    return s;
  });
  // Only a catalog saved before the flat-roof release (it holds none of the
  // systems added since) gets them, once. After that, a built-in the
  // contractor deleted stays deleted.
  const have = new Set(systems.map((s) => s.id));
  const preRelease = !systems.some((s) => !PRE_FLAT_RELEASE_IDS.has(s.id) && builtin.has(s.id));
  const missing = preRelease ? BUILTIN_LISTS.systems.filter((s) => !have.has(s.id) && !PRE_FLAT_RELEASE_IDS.has(s.id)) : [];
  if (missing.length) changed = true;
  return changed ? { ...x, systems: [...systems, ...missing] } : x;
}
/** Keep the spec's picks pointing at rows that exist in the lists. */
export function reconcile(spec: RoofPackageSpec, lists: CatalogLists): RoofPackageSpec {
  let out = spec;
  if (!lists.systems.some((s) => s.id === spec.systemId)) {
    // Same family first: a removed TPO row falls back to another flat system,
    // never to a shingle on a flattened spec. (Card C crosses families itself,
    // through withSystem, when a family has no rows left.)
    const s = lists.systems.find((x) => x.family === spec.systemFamily) ?? lists.systems[0];
    out = { ...out, systemId: s.id, systemName: s.label, systemFamily: s.family, systemMatPerSq: s.matPerSq, systemLaborPerSq: s.laborPerSq, capPerFt: s.capPerFt, wastePct: s.wastePct };
  }
  // The row is there: its label and prices are the truth (the contractor edits
  // them in row 01 or Manage roof types). Waste stays the job's own pick.
  const row = lists.systems.find((s) => s.id === out.systemId);
  if (row && (row.label !== out.systemName || row.matPerSq !== out.systemMatPerSq || row.laborPerSq !== out.systemLaborPerSq || (out.systemFamily !== "low-slope" && row.capPerFt !== out.capPerFt))) {
    out = { ...out, systemName: row.label, systemMatPerSq: row.matPerSq, systemLaborPerSq: row.laborPerSq, capPerFt: out.systemFamily === "low-slope" ? 0 : row.capPerFt };
  }
  if (!lists.underlayments.some((u) => u.id === spec.underlaymentId)) {
    const u = lists.underlayments[0];
    out = { ...out, underlaymentId: u.id, underlaymentName: u.label, underlaymentPerSq: u.perSq };
  }
  return out;
}

/** Facts that, when they change, mean a different roof is open. The
 *  contractor's commercial answer is NOT one of them — answering must not
 *  wipe their entries (withJobClass applies it in place). */
export const factsKey = (f: RoofFacts) =>
  [
    f.squares, f.perimeterFt, f.footprintSqft, f.chimney, f.rooftopAcCount, f.shape, f.existingMaterial ?? "",
    f.facetCount ?? "", f.facetConfidence ?? "",
    f.pitchFamilies.map((p) => `${p.pitch12}:${p.share}`).join(","),
  ].join("|");

/**
 * Make the spec fit THIS roof after the saved preferences were laid over it.
 * A flat roof opens on a flat system (their usual one when the data only says
 * "flat"); a steep roof never opens on a flat system just because the last
 * job was one; like-for-like wins within steep roofs (a tile roof starts as
 * tile even when their usual pick is shingle, and a pick already in the family
 * is kept). After a flat/steep crossing the saved preferences for the new side
 * are laid back on, so their rates survive.
 */
export function familyFit(spec: RoofPackageSpec, facts: RoofFacts, lists: CatalogLists, prefs?: Prefs | null): RoofPackageSpec {
  const flat = isFlatRoof(facts);
  const lowSpec = spec.systemFamily === "low-slope";
  const materialFam = familyOfMaterial(facts.existingMaterial);
  const auto = (next: RoofPackageSpec) => applyPickedPrices({ ...next, systemAuto: true }, prefs);
  const cross = (s: RoofSystem) => {
    const next = withSystem(spec, s, facts, lists);
    return auto(prefs ? applyPrefs(next, prefs, { keepSystem: true }) : next);
  };
  if (flat && !lowSpec) {
    const s = openingSystem(facts, lists, prefs?.lowSlopeSystemId);
    if (s.family === "low-slope") return cross(s);
    return s.id !== spec.systemId ? auto(applyPrefs(withSystem(spec, s, facts, lists), prefs, { keepSystem: true })) : spec;
  }
  if (!flat && lowSpec && materialFam !== "low-slope") {
    const s = openingSystem(facts, lists);
    return s.family !== "low-slope" ? cross(s) : spec;
  }
  if (lowSpec) {
    const named = materialFam === "low-slope" ? lowSlopeSystemForMaterial(facts.existingMaterial) : null;
    const want = named ?? prefs?.lowSlopeSystemId ?? null;
    const s = want ? lists.systems.find((x) => x.id === want && x.family === "low-slope") : null;
    return s && s.id !== spec.systemId ? auto(withSystem(spec, s, facts, lists)) : spec;
  }
  if (materialFam && materialFam !== "low-slope" && spec.systemFamily !== materialFam) {
    const s = likeForLikeSystem(materialFam, lists);
    if (s) return auto(applyPrefs(withSystem(spec, s, facts, lists), prefs, { keepSystem: true }));
  }
  return spec;
}
/**
 * Put a system the contractor picked on the spec, the way every card should:
 * through withSystem (steep and flat share almost nothing), with the saved
 * picks for the new side laid back on, marked as their own choice.
 */
export function pickSystemOn(prev: RoofPackageSpec, s: RoofSystem, facts: RoofFacts, lists: CatalogLists, opts: { auto?: boolean } = {}): RoofPackageSpec {
  const saved = typeof window === "undefined" ? null : readLocal<Prefs>(PREFS_KEY);
  return { ...applyPrefs(withSystem(prev, s, facts, lists), saved, { keepSystem: true }), systemAuto: !!opts.auto };
}

/** The earlier name, kept for the cards that import it. */
export const likeForLike = (spec: RoofPackageSpec, facts: RoofFacts, lists: CatalogLists) => familyFit(spec, facts, lists, null);

/** The shift options, re-exported for the cards. */
export { SHIFTS, WAGE_REGIMES };

export const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
export const fmt = (n: number) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
/** A price in a summary line: $125, $4.50 — no trailing .00. */
export const rate = (n: number) => "$" + (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ""));

// ── Field primitives (the page's est-field / est-in / bp-sel classes) ──────
function Num({ label, value, onChange, unit, disabled, min = 0, wide }: { label: string; value: number; onChange: (n: number) => void; unit?: string; disabled?: boolean; min?: number; wide?: boolean }) {
  const [txt, setTxt] = React.useState(String(value));
  // The prop moved away from what is typed (a pick reset the price, another
  // roof opened): adopt it. Done during render, not in an effect.
  const [seen, setSeen] = React.useState(value);
  if (value !== seen) {
    setSeen(value);
    if (Number(txt) !== value) setTxt(String(value));
  }
  return (
    <label className={"est-field pk-f" + (label ? "" : " pk-f--bare") + (wide ? " pk-f--wide" : "")}>
      {label && <span className="est-lbl">{label}</span>}
      <span className={"pk-in" + (unit ? " has-unit" : "")}>
        <input
          className="est-in"
          inputMode="decimal"
          value={txt}
          disabled={disabled}
          aria-label={label || undefined}
          onChange={(e) => {
            const v = e.target.value;
            setTxt(v);
            const n = Number(v.replace(/,/g, ""));
            if (v.trim() !== "" && Number.isFinite(n) && n >= min) onChange(n);
          }}
          onBlur={() => {
            if (txt.trim() === "" || !Number.isFinite(Number(txt))) setTxt(String(value));
          }}
        />
        {unit && <span className="pk-unit">{unit}</span>}
      </span>
    </label>
  );
}

function Sel<T extends string>({ label, value, options, onChange, disabled, wide }: { label: string; value: T; options: ReadonlyArray<{ id: T; label: string }>; onChange: (v: T) => void; disabled?: boolean; wide?: boolean }) {
  return (
    <label className={"est-field pk-f" + (label ? "" : " pk-f--bare") + (wide ? " pk-f--wide" : "")}>
      {label && <span className="est-lbl">{label}</span>}
      <span className="bp-sel">
        <select className="bp-sel-in est-in" value={value} disabled={disabled} aria-label={label || undefined} onChange={(e) => onChange(e.target.value as T)}>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </span>
    </label>
  );
}

function Check({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="pk-check">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

/** A named cluster of this roof's fields inside an open row. */
function Group({ label, children, note }: { label?: string; children: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div className="pk-g">
      {label && <div className="pk-g-lbl">{label}</div>}
      <div className="pk-fields">{children}</div>
      {note}
    </div>
  );
}

/** The contractor's unit prices for a row — set once, kept. A rule and a
 *  tag, not a box: a frame inside a row inside a card was one frame too many. */
function Rates({ children }: { children: React.ReactNode }) {
  return (
    <div className="pk-rates">
      <div className="pk-rates-lbl">Rates · per unit, yours</div>
      <div className="pk-fields">{children}</div>
    </div>
  );
}

const Chevron = () => (
  <svg className="pk-chev" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** One ledger row: a header that reads the section in one line, a body on demand. */
function Row({ id, title, summary, chip, open, onToggle, children, action }: { id: string; title: string; summary: string; chip?: React.ReactNode; open: boolean; onToggle: () => void; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className={"pk-row" + (open ? " is-open" : "")}>
      <div className="pk-hd">
        <button type="button" className="pk-hd-btn" aria-expanded={open} aria-controls={`pk-body-${id}`} onClick={onToggle}>
          <span className="pk-hd-title">{title}</span>
          <span className="pk-hd-sum">{summary}</span>
          {chip}
          <Chevron />
        </button>
        {open && action && <div className="pk-hd-act">{action}</div>}
      </div>
      {open && (
        <div className="pk-body" id={`pk-body-${id}`}>
          {children}
        </div>
      )}
    </section>
  );
}

export function RoofPackageBuilder({
  facts,
  onBuild,
  onConvert,
  disabled,
  converting,
}: {
  facts: RoofFacts;
  /** The built package; the parent owns the estimate tables. */
  onBuild: (pkg: RoofPackage, spec: RoofPackageSpec) => void;
  /** "Convert to proposal": the package straight to a proposal. */
  onConvert: (pkg: RoofPackage, spec: RoofPackageSpec) => void;
  disabled?: boolean;
  converting?: boolean;
}) {
  const key = factsKey(facts);
  // The builder only mounts on the report panel, after a measurement is
  // opened client-side, so the browser's copy can be read at first render;
  // the window guard keeps a stray server render from throwing.
  const [lists, setLists] = React.useState<CatalogLists>(() =>
    (typeof window === "undefined" ? null : saneLists(readLocal<CatalogLists>(LISTS_KEY))) ?? BUILTIN_LISTS,
  );
  const [spec, setSpec] = React.useState<RoofPackageSpec>(() => {
    const l = (typeof window === "undefined" ? null : saneLists(readLocal<CatalogLists>(LISTS_KEY))) ?? BUILTIN_LISTS;
    const saved = typeof window === "undefined" ? null : readLocal<Prefs>(PREFS_KEY);
    return familyFit(reconcile(applyPrefs(defaultSpec(facts, l, saved?.lowSlopeSystemId), saved), l), facts, l, saved);
  });
  // A different roof opened: the per-roof entries start over from its facts,
  // the preferences stay. Adjusted during render, not in an effect.
  const [seenKey, setSeenKey] = React.useState(key);
  if (key !== seenKey) {
    setSeenKey(key);
    const saved = readLocal<Prefs>(PREFS_KEY);
    setSpec(familyFit(reconcile(applyPrefs(defaultSpec(facts, lists, saved?.lowSlopeSystemId), saved), lists), facts, lists, saved));
  }

  // The org's saved catalog, when the table exists and a save has happened:
  // its lists and prices win over the browser's copy.
  const [source, setSource] = React.useState<"loading" | "org" | "browser">("loading");
  const [saving, setSaving] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);
  React.useEffect(() => {
    let cancelled = false;
    getRoofCatalog()
      .then((doc) => {
        if (cancelled) return;
        if (doc) {
          const l = saneLists({ systems: doc.systems, underlayments: doc.underlayments }) ?? BUILTIN_LISTS;
          setLists(l);
          setSpec((s) => reconcile(applyPrefs(s, doc.prefs), l));
          writeLocal(LISTS_KEY, l);
          writeLocal(PREFS_KEY, doc.prefs);
          setSource("org");
        } else {
          setSource("browser");
        }
      })
      .catch(() => {
        if (!cancelled) setSource("browser");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const set = React.useCallback(<K extends keyof RoofPackageSpec>(k: K, v: RoofPackageSpec[K]) => {
    setSpec((s) => {
      const next = { ...s, [k]: v };
      writeLocal(PREFS_KEY, prefsOf(next));
      return next;
    });
    setDirty(true);
  }, []);
  const setEdge = (k: "eaveFt" | "rakeFt" | "ridgeFt" | "hipFt", v: number) => setSpec((s) => ({ ...s, [k]: v, edgesBasis: "entered" }));
  const resetEdges = () => {
    const e = estimateEdges(facts);
    if (e) setSpec((s) => ({ ...s, ...e, edgesBasis: "estimated" }));
  };
  const updateLists = (next: CatalogLists) => {
    setLists(next);
    setSpec((s) => reconcile(s, next));
    writeLocal(LISTS_KEY, next);
    setDirty(true);
  };

  async function saveDefaults() {
    setSaving(true);
    try {
      const res = await saveRoofCatalog({ version: 1, systems: lists.systems, underlayments: lists.underlayments, prefs: prefsOf(spec) });
      if (res.ok) {
        setSource("org");
        setDirty(false);
        toast.success("Defaults saved", "Your roof types, underlayments and rates now load for everyone in your company.");
      } else {
        toast.error("Couldn't save", res.error);
      }
    } finally {
      setSaving(false);
    }
  }

  const pkg = React.useMemo(() => buildRoofPackage(spec, facts), [spec, facts]);
  const vent = React.useMemo(() => checkVentilation(spec, facts), [spec, facts]);
  const total = [...pkg.materials, ...pkg.labor].reduce((a, l) => a + l.quantity * l.unitPrice, 0);
  const materialsTotal = pkg.materials.reduce((a, l) => a + l.quantity * l.unitPrice, 0);

  // ── Picks copy the catalog row's prices into the spec ──
  const pickSystem = (id: string, from: CatalogLists = lists) => {
    const s = from.systems.find((x) => x.id === id);
    if (!s) return;
    setSpec((prev) => {
      const next = pickSystemOn(prev, s, facts, from);
      writeLocal(PREFS_KEY, prefsOf(next));
      return next;
    });
    setDirty(true);
  };
  const pickUnderlayment = (id: string, from: CatalogLists = lists) => {
    const u = from.underlayments.find((x) => x.id === id);
    if (!u) return;
    set("underlaymentId", id);
    set("underlaymentName", u.label);
    set("underlaymentPerSq", u.perSq);
  };
  const pickDrip = (id: string) => {
    const d = DRIP_EDGE_PROFILES.find((x) => x.id === id);
    if (!d) return;
    set("dripProfileId", id);
    if (id !== "custom") set("dripPerFt", d.perFt);
  };
  const pickValley = (id: string) => {
    const v = VALLEY_TYPES.find((x) => x.id === id);
    if (!v) return;
    set("valleyTypeId", id);
    if (id !== "custom") {
      set("valleyMatPerFt", v.matPerFt);
      set("valleyLaborPerFt", v.laborPerFt);
    }
  };
  const pickStep = (id: string) => {
    const s = STEP_FLASHING_SIZES.find((x) => x.id === id);
    if (!s) return;
    set("stepSizeId", id);
    if (id !== "custom") set("stepPerPiece", s.perPiece);
  };
  const pickChimney = (id: string) => {
    const c = CHIMNEY_SIZES.find((x) => x.id === id);
    if (!c) return;
    set("chimneySizeId", id);
    set("chimneyEach", c.each);
    set("chimneyLabor", c.labor);
  };
  const setVent = (id: string, patch: Partial<{ qty: number; each: number; labor: number }>) => {
    setSpec((s) => {
      const t = VENT_TYPES.find((x) => x.id === id)!;
      const has = s.vents.some((v) => v.id === id);
      const vents = has ? s.vents.map((v) => (v.id === id ? { ...v, ...patch } : v)) : [...s.vents, { id, qty: 0, each: t.each, labor: t.labor, ...patch }];
      const next = { ...s, vents };
      writeLocal(PREFS_KEY, prefsOf(next));
      return next;
    });
    setDirty(true);
  };
  const ventOf = (id: string) => spec.vents.find((v) => v.id === id) ?? { id, qty: 0, each: VENT_TYPES.find((x) => x.id === id)!.each, labor: VENT_TYPES.find((x) => x.id === id)!.labor };
  const setCustom = (id: string, patch: Partial<RoofPackageSpec["custom"][number]>) => setSpec((s) => ({ ...s, custom: s.custom.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  const addCustom = (kind: "material" | "labor") => setSpec((s) => ({ ...s, custom: [...s.custom, { id: nanoid(6), name: "", qty: 1, unit: "each", unitPrice: 0, kind }] }));
  const removeCustom = (id: string) => setSpec((s) => ({ ...s, custom: s.custom.filter((c) => c.id !== id) }));

  // ── Manage the contractor's lists ──
  const [manage, setManage] = React.useState<null | "systems" | "underlayments">(null);
  const patchSystem = (id: string, patch: Partial<RoofSystem>) => {
    const next = { ...lists, systems: lists.systems.map((s) => (s.id === id ? { ...s, ...patch } : s)) };
    updateLists(next);
    if (id === spec.systemId) pickSystem(id, next);
  };
  const addSystem = () => {
    const s: RoofSystem = { id: "s_" + nanoid(6), label: "New roof type", family: "asphalt", matPerSq: 0, laborPerSq: 0, wastePct: 10, capPerFt: 0 };
    updateLists({ ...lists, systems: [...lists.systems, s] });
  };
  const removeSystem = (id: string) => {
    if (lists.systems.length <= 1) return;
    updateLists({ ...lists, systems: lists.systems.filter((s) => s.id !== id) });
  };
  const patchUnderlayment = (id: string, patch: Partial<Underlayment>) => {
    const next = { ...lists, underlayments: lists.underlayments.map((u) => (u.id === id ? { ...u, ...patch } : u)) };
    updateLists(next);
    if (id === spec.underlaymentId) pickUnderlayment(id, next);
  };
  const addUnderlayment = () => {
    updateLists({ ...lists, underlayments: [...lists.underlayments, { id: "u_" + nanoid(6), label: "New underlayment", perSq: 0 }] });
  };
  const removeUnderlayment = (id: string) => {
    if (lists.underlayments.length <= 1) return;
    updateLists({ ...lists, underlayments: lists.underlayments.filter((u) => u.id !== id) });
  };
  const resetLists = () => {
    updateLists(BUILTIN_LISTS);
    toast.info("Built-in roof types restored — save to keep them.");
  };

  // ── Which rows are open. The first one opens by default; the rest read
  //    from their summary line until the contractor needs them. ──
  const [open, setOpen] = React.useState<Record<string, boolean>>({ system: true });
  const toggle = (id: string) => setOpen((o) => ({ ...o, [id]: !o[id] }));
  const manageBtn = (which: "systems" | "underlayments", label: string) => (
    <button type="button" className="pk-link" onClick={() => setManage(manage === which ? null : which)} disabled={disabled}>
      {manage === which ? "Done" : label}
    </button>
  );

  // ── Summary lines: the row's content in one breath ──
  // The DISPLAYED pitch, the same number the package prices on
  // (catalog.displayPitch12) — a roof this card calls 8/12 is charged as 8/12.
  const steepest = facts.pitchFamilies.reduce((m, f) => Math.max(m, displayPitch12(f.pitch12)), 0);
  const lowSlope = spec.systemFamily === "low-slope";
  const sumSystem = [spec.systemName, `${rate(spec.systemMatPerSq)} + ${rate(spec.systemLaborPerSq)} /sq`, `${spec.wastePct}% waste`, !lowSlope && spec.capPerFt > 0 ? `cap ${rate(spec.capPerFt)}/ft` : null].filter(Boolean).join(" · ");
  const iceLabel = ICE_WATER.find((i) => i.id === spec.iceWater)?.label ?? spec.iceWater;
  const sumUnder = [spec.underlaymentName, `${rate(spec.underlaymentPerSq)}/sq`, spec.iceWater === "none" ? "no ice & water" : `ice & water · ${iceLabel.toLowerCase()}`].join(" · ");
  const noEdges = spec.eaveFt + spec.rakeFt + spec.ridgeFt + spec.hipFt <= 0;
  const sumEdges = [
    noEdges
      ? "No lengths yet — enter eave, rake and ridge"
      : `Eave ${fmt(spec.eaveFt)} · rake ${fmt(spec.rakeFt)} · ridge ${fmt(spec.ridgeFt)}${spec.hipFt > 0 ? ` · hip ${fmt(spec.hipFt)}` : ""} ft`,
    spec.dripEdgeOn ? "drip edge" : "no drip edge",
    !lowSlope && spec.systemFamily !== "metal" ? (spec.starterOn ? "starter" : "no starter") : null,
  ].filter(Boolean).join(" · ");
  const pipeTotal = PIPE_BOOT_SIZES.reduce((a, s) => a + (spec.pipeBoots[s.id] ?? 0), 0);
  const flashBits = [
    spec.valleyCount > 0 ? `${spec.valleyCount} valley${spec.valleyCount === 1 ? "" : "s"}` : null,
    spec.stepWallCount > 0 ? `${spec.stepWallCount} sidewall${spec.stepWallCount === 1 ? "" : "s"}` : null,
    spec.apronFt > 0 ? `apron ${fmt(spec.apronFt)} ft` : null,
    spec.counterFt > 0 ? `counter ${fmt(spec.counterFt)} ft` : null,
    pipeTotal > 0 ? `${pipeTotal} pipe boot${pipeTotal === 1 ? "" : "s"}` : null,
    spec.chimneyCount > 0 ? `${spec.chimneyCount} chimney${spec.chimneyCount === 1 ? "" : "s"}` : null,
    spec.curbCount > 0 ? `${spec.curbCount} curb${spec.curbCount === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  const sumFlash = flashBits.length ? flashBits.join(" · ") : "Nothing counted yet — valleys, walls, pipes, chimney";
  const ventsOn = VENT_TYPES.filter((t) => ventOf(t.id).qty > 0);
  const sumVents = [
    ventsOn.length
      ? ventsOn.map((t) => `${fmt(ventOf(t.id).qty)}${t.unit === "linear ft" ? " ft" : " ×"} ${t.label.split(" · ")[0].toLowerCase()}`).join(" · ")
      : "No vents yet",
    vent ? (vent.ok ? "balanced" : "short of the 1/300 rule") : null,
  ].filter(Boolean).join(" · ");
  const sumTear = [
    spec.tearOffLayers === 0 ? "Overlay, no tear-off" : `Tear-off ${spec.tearOffLayers} layer${spec.tearOffLayers === 1 ? "" : "s"}`,
    spec.plywoodSheets > 0 ? `${spec.plywoodSheets} deck sheet${spec.plywoodSheets === 1 ? "" : "s"}` : null,
    spec.cleanupLump > 0 ? `cleanup ${money(spec.cleanupLump)}` : null,
    steepest >= 8 && spec.safetyLump > 0 ? `steep safety ${money(spec.safetyLump)}` : null,
    spec.permitLump > 0 ? `permit ${money(spec.permitLump)}` : null,
  ].filter(Boolean).join(" · ");
  const sumCustom = spec.custom.length ? `${spec.custom.length} line${spec.custom.length === 1 ? "" : "s"}` : "None";

  const ventsToAdd = VENT_TYPES.filter((t) => ventOf(t.id).qty <= 0);
  const edgeEstimated = spec.edgesBasis === "estimated";

  const actions = (size: "lg") => (
    <div className={"pk-acts pk-acts--" + size}>
      <button type="button" className="btn btn-ghost btn--sm" disabled={disabled} onClick={() => onBuild(pkg, spec)} title="Fill the estimate tables below to review and adjust before converting">
        <svg className="ic"><use href="#i-file" /></svg>
        Review lines
      </button>
      <button type="button" className="btn btn-primary btn--sm" disabled={disabled || converting} onClick={() => onConvert(pkg, spec)} title="Straight to a proposal with these lines — you can still edit them there">
        <svg className="ic"><use href="#i-target" /></svg>
        {converting ? "Creating…" : "Convert to proposal"}
      </button>
    </div>
  );

  return (
    <div className="pk">
      {/* THE TICKET — the running total and the two ways out, first; the
          roof's facts and whose rates these are ride underneath in the same
          band, so the reader meets one header, not three. */}
      <div className="pk-ticket">
        <div className="pk-ticket-sum">
          <span className="pk-ticket-lbl">Package</span>
          <span className="pk-ticket-v">{money(total)}</span>
          <span className="pk-ticket-h">
            {money(materialsTotal)} materials · {money(total - materialsTotal)} labor · {pkg.materials.length + pkg.labor.length} lines
          </span>
        </div>
        {actions("lg")}
      </div>
      <div className="pk-basis">
        <span className="pk-facts">
          <b>{facts.squares.toFixed(1)} sq</b>
          <i>{facts.squaresBasis}</i>
          {facts.pitchFamilies.length > 0 && (
            <>
              <b>{facts.pitchFamilies.map((f) => `${Math.round(f.pitch12)}/12${facts.pitchFamilies.length > 1 ? ` ${Math.round(f.share * 100)}%` : ""}`).join(" + ")}</b>
              {steepest >= 8 && <i>steep</i>}
            </>
          )}
          {facts.perimeterFt != null && <b>{fmt(facts.perimeterFt)} ft outline</b>}
          {facts.footprintSqft != null && <b>{fmt(facts.footprintSqft)} sq ft footprint</b>}
          {facts.shape && <b>{facts.shape.toLowerCase()}</b>}
          {facts.chimney && <b>chimney</b>}
          {facts.rooftopAcCount != null && facts.rooftopAcCount > 0 && <b>{facts.rooftopAcCount} rooftop unit{facts.rooftopAcCount === 1 ? "" : "s"}</b>}
        </span>
        <span className="pk-catalog">
          <span className="pk-catalog-txt">
            {source === "loading" ? "Loading rates…" : source === "org" ? "Your company’s rates" : "Built-in rates"}
            {dirty && source !== "loading" ? <em> · unsaved</em> : null}
          </span>
          <button type="button" className={"btn btn--sm " + (dirty ? "btn-primary" : "btn-ghost")} disabled={disabled || saving || source === "loading"} onClick={() => void saveDefaults()}>
            {saving ? "Saving…" : "Save as defaults"}
          </button>
        </span>
      </div>

      {/* 1 · ROOF SYSTEM */}
      <Row id="system" title="Roof system" summary={sumSystem} open={!!open.system} onToggle={() => toggle("system")} action={manageBtn("systems", "Edit roof types")}>
        {manage === "systems" ? (
          <div className="pk-manage">
            <div className="pk-manage-row pk-manage-head">
              <span>Roof type</span><span>Family</span><span>Material $/sq</span><span>Labor $/sq</span><span>Waste %</span><span>Cap $/ft</span><span />
            </div>
            {lists.systems.map((s) => (
              <div className="pk-manage-row" key={s.id}>
                <input className="est-in" value={s.label} disabled={disabled} aria-label="Roof type name" onChange={(e) => patchSystem(s.id, { label: e.target.value })} />
                <Sel label="" value={s.family} options={ROOF_FAMILIES} onChange={(v) => patchSystem(s.id, { family: v as RoofFamily })} disabled={disabled} />
                <Num label="" value={s.matPerSq} onChange={(n) => patchSystem(s.id, { matPerSq: n })} disabled={disabled} />
                <Num label="" value={s.laborPerSq} onChange={(n) => patchSystem(s.id, { laborPerSq: n })} disabled={disabled} />
                <Num label="" value={s.wastePct} onChange={(n) => patchSystem(s.id, { wastePct: n })} disabled={disabled} />
                <Num label="" value={s.capPerFt} onChange={(n) => patchSystem(s.id, { capPerFt: n })} disabled={disabled} />
                <button type="button" className="pk-x" disabled={disabled || lists.systems.length <= 1} aria-label={`Remove ${s.label}`} title="Remove" onClick={() => removeSystem(s.id)}>×</button>
              </div>
            ))}
            <div className="pk-add">
              <button type="button" className="btn btn-ghost btn--sm" disabled={disabled} onClick={addSystem}>+ Roof type</button>
              <button type="button" className="pk-link" disabled={disabled} onClick={resetLists}>Restore built-in list</button>
            </div>
          </div>
        ) : (
          <>
            <Group>
              <Sel label="System" value={spec.systemId} options={lists.systems} onChange={(id) => pickSystem(id)} disabled={disabled} wide />
              <Sel label="Waste" value={String(spec.wastePct)} options={WASTE_OPTIONS.map((w) => ({ id: String(w), label: `${w}%` }))} onChange={(v) => set("wastePct", Number(v))} disabled={disabled} />
            </Group>
            <Rates>
              <Num label="Material" unit="$/sq" value={spec.systemMatPerSq} onChange={(v) => set("systemMatPerSq", v)} disabled={disabled} />
              <Num label="Install labor" unit="$/sq" value={spec.systemLaborPerSq} onChange={(v) => set("systemLaborPerSq", v)} disabled={disabled} />
              {!lowSlope && <Num label="Hip & ridge cap" unit="$/ft" value={spec.capPerFt} onChange={(v) => set("capPerFt", v)} disabled={disabled} />}
            </Rates>
          </>
        )}
      </Row>

      {/* 2 · UNDERLAYMENT */}
      <Row id="under" title="Underlayment" summary={sumUnder} open={!!open.under} onToggle={() => toggle("under")} action={manageBtn("underlayments", "Edit underlayments")}>
        {manage === "underlayments" ? (
          <div className="pk-manage pk-manage--und">
            <div className="pk-manage-row pk-manage-head">
              <span>Underlayment</span><span>$/sq</span><span />
            </div>
            {lists.underlayments.map((u) => (
              <div className="pk-manage-row" key={u.id}>
                <input className="est-in" value={u.label} disabled={disabled} aria-label="Underlayment name" onChange={(e) => patchUnderlayment(u.id, { label: e.target.value })} />
                <Num label="" value={u.perSq} onChange={(n) => patchUnderlayment(u.id, { perSq: n })} disabled={disabled} />
                <button type="button" className="pk-x" disabled={disabled || lists.underlayments.length <= 1} aria-label={`Remove ${u.label}`} title="Remove" onClick={() => removeUnderlayment(u.id)}>×</button>
              </div>
            ))}
            <div className="pk-add">
              <button type="button" className="btn btn-ghost btn--sm" disabled={disabled} onClick={addUnderlayment}>+ Underlayment</button>
            </div>
          </div>
        ) : (
          <>
            <Group>
              <Sel label="Underlayment" value={spec.underlaymentId} options={lists.underlayments} onChange={(id) => pickUnderlayment(id)} disabled={disabled} wide />
              <Sel label="Ice & water" value={spec.iceWater} options={ICE_WATER} onChange={(v) => set("iceWater", v as IceWaterCoverage)} disabled={disabled} wide />
            </Group>
            <Rates>
              <Num label="Underlayment" unit="$/sq" value={spec.underlaymentPerSq} onChange={(v) => set("underlaymentPerSq", v)} disabled={disabled} />
              {spec.iceWater !== "none" && <Num label="Ice & water" unit="$/sq ft" value={spec.iceWaterPerSqft} onChange={(v) => set("iceWaterPerSqft", v)} disabled={disabled} />}
            </Rates>
          </>
        )}
      </Row>

      {/* 3 · EDGES */}
      <Row
        id="edges"
        title="Edges"
        summary={sumEdges}
        chip={<span className={"chip " + (edgeEstimated ? "wait" : "")}>{edgeEstimated ? "from outline" : "entered"}</span>}
        open={!!open.edges}
        onToggle={() => toggle("edges")}
      >
        <Group
          label="Lengths"
          note={
            edgeEstimated ? (
              <div className="pk-note">Estimated from the building outline — check them against the photo.</div>
            ) : estimateEdges(facts) ? (
              <button type="button" className="pk-link" onClick={resetEdges} disabled={disabled}>Back to the outline estimate</button>
            ) : null
          }
        >
          <Num label="Eave" unit="ft" value={spec.eaveFt} onChange={(v) => setEdge("eaveFt", v)} disabled={disabled} />
          <Num label="Rake" unit="ft" value={spec.rakeFt} onChange={(v) => setEdge("rakeFt", v)} disabled={disabled} />
          <Num label="Ridge" unit="ft" value={spec.ridgeFt} onChange={(v) => setEdge("ridgeFt", v)} disabled={disabled} />
          <Num label="Hip" unit="ft" value={spec.hipFt} onChange={(v) => setEdge("hipFt", v)} disabled={disabled} />
        </Group>
        <Group label="Drip edge & starter">
          <Check label="Drip edge" checked={spec.dripEdgeOn} onChange={(v) => set("dripEdgeOn", v)} disabled={disabled} />
          {spec.dripEdgeOn && (
            <>
              <Sel label="Profile" value={spec.dripProfileId} options={DRIP_EDGE_PROFILES} onChange={pickDrip} disabled={disabled} wide />
              <Sel label="Size" value={spec.dripSizeId} options={DRIP_EDGE_SIZES} onChange={(v) => set("dripSizeId", v)} disabled={disabled} />
            </>
          )}
          {!lowSlope && spec.systemFamily !== "metal" && (
            <Check label="Starter strip" checked={spec.starterOn} onChange={(v) => set("starterOn", v)} disabled={disabled} />
          )}
        </Group>
        {(spec.dripEdgeOn || (spec.starterOn && !lowSlope && spec.systemFamily !== "metal")) && (
          <Rates>
            {spec.dripEdgeOn && <Num label="Drip edge" unit="$/ft" value={spec.dripPerFt} onChange={(v) => set("dripPerFt", v)} disabled={disabled} />}
            {spec.starterOn && !lowSlope && spec.systemFamily !== "metal" && (
              <Num label="Starter" unit="$/ft" value={spec.starterPerFt} onChange={(v) => set("starterPerFt", v)} disabled={disabled} />
            )}
          </Rates>
        )}
      </Row>

      {/* 4 · FLASHING */}
      <Row id="flash" title="Flashing" summary={sumFlash} open={!!open.flash} onToggle={() => toggle("flash")}>
        <Group label="Valleys">
          <Num label="Count" unit="each" value={spec.valleyCount} onChange={(v) => set("valleyCount", v)} disabled={disabled} />
          <Num label="Length each" unit="ft" value={spec.valleyFtEach} onChange={(v) => set("valleyFtEach", v)} disabled={disabled} />
          <Sel label="Type" value={spec.valleyTypeId} options={VALLEY_TYPES} onChange={pickValley} disabled={disabled} wide />
        </Group>
        <Group label="Sidewalls · step flashing">
          <Num label="Walls" unit="each" value={spec.stepWallCount} onChange={(v) => set("stepWallCount", v)} disabled={disabled} />
          <Num label="Length each" unit="ft" value={spec.stepWallFtEach} onChange={(v) => set("stepWallFtEach", v)} disabled={disabled} />
          <Sel label="Step size" value={spec.stepSizeId} options={STEP_FLASHING_SIZES} onChange={pickStep} disabled={disabled} wide />
        </Group>
        <Group label="Apron & counter">
          <Num label="Apron / headwall" unit="ft" value={spec.apronFt} onChange={(v) => set("apronFt", v)} disabled={disabled} />
          <Num label="Counter flashing" unit="ft" value={spec.counterFt} onChange={(v) => set("counterFt", v)} disabled={disabled} />
        </Group>
        <Group label="Pipe boots">
          {PIPE_BOOT_SIZES.map((s) => (
            <Num key={s.id} label={s.label} unit="each" value={spec.pipeBoots[s.id] ?? 0} onChange={(v) => set("pipeBoots", { ...spec.pipeBoots, [s.id]: v })} disabled={disabled} />
          ))}
        </Group>
        <Group label="Chimneys & curbs">
          <Num label="Chimneys" unit="each" value={spec.chimneyCount} onChange={(v) => set("chimneyCount", v)} disabled={disabled} />
          <Sel label="Chimney size" value={spec.chimneySizeId} options={CHIMNEY_SIZES} onChange={pickChimney} disabled={disabled} wide />
          <Num label="Curbs" unit="each" value={spec.curbCount} onChange={(v) => set("curbCount", v)} disabled={disabled} />
        </Group>
        <Rates>
          <Num label="Valley metal" unit="$/ft" value={spec.valleyMatPerFt} onChange={(v) => set("valleyMatPerFt", v)} disabled={disabled} />
          <Num label="Valley labor" unit="$/ft" value={spec.valleyLaborPerFt} onChange={(v) => set("valleyLaborPerFt", v)} disabled={disabled} />
          <Num label="Step piece" unit="$/ea" value={spec.stepPerPiece} onChange={(v) => set("stepPerPiece", v)} disabled={disabled} />
          <Num label="Step labor" unit="$/ft" value={spec.stepLaborPerFt} onChange={(v) => set("stepLaborPerFt", v)} disabled={disabled} />
          <Num label="Apron" unit="$/ft" value={spec.apronPerFt} onChange={(v) => set("apronPerFt", v)} disabled={disabled} />
          <Num label="Apron labor" unit="$/ft" value={spec.apronLaborPerFt} onChange={(v) => set("apronLaborPerFt", v)} disabled={disabled} />
          <Num label="Counter" unit="$/ft" value={spec.counterPerFt} onChange={(v) => set("counterPerFt", v)} disabled={disabled} />
          <Num label="Counter labor" unit="$/ft" value={spec.counterLaborPerFt} onChange={(v) => set("counterLaborPerFt", v)} disabled={disabled} />
          <Num label="Chimney kit" unit="$/ea" value={spec.chimneyEach} onChange={(v) => set("chimneyEach", v)} disabled={disabled} />
          <Num label="Chimney labor" unit="$/ea" value={spec.chimneyLabor} onChange={(v) => set("chimneyLabor", v)} disabled={disabled} />
          <Num label="Curb kit" unit="$/ea" value={spec.curbEach} onChange={(v) => set("curbEach", v)} disabled={disabled} />
          <Num label="Curb labor" unit="$/ea" value={spec.curbLabor} onChange={(v) => set("curbLabor", v)} disabled={disabled} />
        </Rates>
      </Row>

      {/* 5 · VENTS */}
      <Row
        id="vents"
        title="Vents"
        summary={sumVents}
        chip={vent ? <span className={"chip " + (vent.ok ? "ok" : "bad")}>{vent.ok ? "balanced" : "short"}</span> : undefined}
        open={!!open.vents}
        onToggle={() => toggle("vents")}
      >
        <div className="pk-note">
          {vent
            ? `The ${fmt(facts.footprintSqft ?? 0)} sq ft attic needs ${fmt(vent.requiredSqIn)} sq in of net free area. This package: ${fmt(vent.exhaustSqIn)} exhaust${vent.poweredExhaust ? ` + ${vent.poweredExhaust} powered` : ""}, ${fmt(vent.intakeSqIn)} intake.`
            : "This measurement has no footprint, so the attic check is off — add what the roof needs."}
        </div>
        {ventsOn.length > 0 && (
          <div className="pk-vents">
            <div className="pk-vent-row pk-vent-head">
              <span>Vent</span><span>Qty</span><span /><span>Material</span><span>Labor</span><span />
            </div>
            {ventsOn.map((t) => {
              const v = ventOf(t.id);
              return (
                <div className="pk-vent-row" key={t.id}>
                  <span className="pk-vent-name">{t.label}<em>{t.role}{t.nfaSqIn ? ` · ${t.nfaSqIn} sq in${t.unit === "linear ft" ? "/ft" : ""}` : " · powered"}</em></span>
                  <Num label="" value={v.qty} onChange={(n) => setVent(t.id, { qty: n })} disabled={disabled} />
                  <span className="pk-vent-unit">{t.unit === "each" ? "each" : "ft"}</span>
                  <Num label="" unit={t.unit === "each" ? "$/ea" : "$/ft"} value={v.each} onChange={(n) => setVent(t.id, { each: n })} disabled={disabled} />
                  <Num label="" unit={t.unit === "each" ? "$/ea" : "$/ft"} value={v.labor} onChange={(n) => setVent(t.id, { labor: n })} disabled={disabled} />
                  <button type="button" className="pk-x" disabled={disabled} aria-label={`Remove ${t.label}`} title="Remove" onClick={() => setVent(t.id, { qty: 0 })}>×</button>
                </div>
              );
            })}
          </div>
        )}
        <Check label="Balanced system · 1/300 rule" checked={spec.ventBalanced} onChange={(v) => set("ventBalanced", v)} disabled={disabled} />
        <div className="pk-add">
          {ventsToAdd.length > 0 && (
            <label className="est-field pk-f pk-f--wide pk-f--bare">
              <span className="bp-sel">
                <select
                  className="bp-sel-in est-in"
                  value=""
                  disabled={disabled}
                  aria-label="Add a vent"
                  onChange={(e) => {
                    if (e.target.value) setVent(e.target.value, { qty: 1 });
                  }}
                >
                  <option value="">+ Add vent…</option>
                  {ventsToAdd.map((t) => (
                    <option key={t.id} value={t.id}>{t.label}</option>
                  ))}
                </select>
              </span>
            </label>
          )}
        </div>
      </Row>

      {/* 6 · TEAR-OFF & EXTRAS */}
      <Row id="tear" title="Tear-off & extras" summary={sumTear} open={!!open.tear} onToggle={() => toggle("tear")}>
        <Group
          note={steepest < 8 ? <div className="pk-note">Steep safety is charged from 8/12 up — this roof is {steepest > 0 ? `${steepest}/12` : "flatter"}, so it stays off.</div> : null}
        >
          <Sel label="Tear-off" value={String(spec.tearOffLayers)} options={[{ id: "0", label: "None · overlay" }, { id: "1", label: "1 layer" }, { id: "2", label: "2 layers" }, { id: "3", label: "3 layers" }]} onChange={(v) => set("tearOffLayers", Number(v) as 0 | 1 | 2 | 3)} disabled={disabled} />
          <Num label="Deck sheets" unit="each" value={spec.plywoodSheets} onChange={(v) => set("plywoodSheets", v)} disabled={disabled} />
          <Num label="Cleanup" unit="$" value={spec.cleanupLump} onChange={(v) => set("cleanupLump", v)} disabled={disabled} />
          <Num label="Steep safety" unit="$" value={spec.safetyLump} onChange={(v) => set("safetyLump", v)} disabled={disabled} />
          <Num label="Permit" unit="$" value={spec.permitLump} onChange={(v) => set("permitLump", v)} disabled={disabled} />
        </Group>
        <Rates>
          <Num label="Tear-off labor" unit="$/sq·layer" value={spec.tearOffPerSqLayer} onChange={(v) => set("tearOffPerSqLayer", v)} disabled={disabled} />
          <Num label="Disposal" unit="$/sq·layer" value={spec.disposalPerSqLayer} onChange={(v) => set("disposalPerSqLayer", v)} disabled={disabled} />
          <Num label="Deck sheet" unit="$/ea" value={spec.plywoodEach} onChange={(v) => set("plywoodEach", v)} disabled={disabled} />
          <Num label="Sheet labor" unit="$/ea" value={spec.plywoodLabor} onChange={(v) => set("plywoodLabor", v)} disabled={disabled} />
          <Num label="Nails & fasteners" unit="$/sq" value={spec.nailsPerSq} onChange={(v) => set("nailsPerSq", v)} disabled={disabled} />
          <Num label="Sealant & collars" unit="$/sq" value={spec.sealantPerSq} onChange={(v) => set("sealantPerSq", v)} disabled={disabled} />
        </Rates>
      </Row>

      {/* 7 · CUSTOM LINES */}
      <Row id="custom" title="Custom lines" summary={sumCustom} open={!!open.custom} onToggle={() => toggle("custom")}>
        <div className="pk-custom">
          {spec.custom.map((c) => (
            <div className="pk-custom-row" key={c.id}>
              <input className="est-in" placeholder="Item — a skylight, gutters, a fascia repair" value={c.name} disabled={disabled} onChange={(e) => setCustom(c.id, { name: e.target.value })} aria-label="Custom item" />
              <Num label="" value={c.qty} onChange={(n) => setCustom(c.id, { qty: n })} disabled={disabled} />
              <span className="bp-sel">
                <select className="bp-sel-in est-in" value={c.unit} disabled={disabled} aria-label="Unit" onChange={(e) => setCustom(c.id, { unit: e.target.value as PkgUnit })}>
                  {PKG_UNITS.map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </span>
              <Num label="" unit="$" value={c.unitPrice} onChange={(n) => setCustom(c.id, { unitPrice: n })} disabled={disabled} />
              <span className="bp-sel">
                <select className="bp-sel-in est-in" value={c.kind} disabled={disabled} aria-label="Material or labor" onChange={(e) => setCustom(c.id, { kind: e.target.value as "material" | "labor" })}>
                  <option value="material">material</option>
                  <option value="labor">labor</option>
                </select>
              </span>
              <button type="button" className="pk-x" disabled={disabled} aria-label="Remove custom line" onClick={() => removeCustom(c.id)}>×</button>
            </div>
          ))}
          <div className="pk-add">
            <button type="button" className="btn btn-ghost btn--sm" disabled={disabled} onClick={() => addCustom("material")}>+ Material</button>
            <button type="button" className="btn btn-ghost btn--sm" disabled={disabled} onClick={() => addCustom("labor")}>+ Labor</button>
          </div>
        </div>
      </Row>

      {/* THE FOOT — the total again where the reader ends up, and only the
          primary action: the second pair of buttons read as a second toolbar. */}
      <div className="pk-foot">
        <span className="pk-foot-v">{money(total)}</span>
        <button type="button" className="btn btn-primary btn--sm" disabled={disabled || converting} onClick={() => onConvert(pkg, spec)}>
          <svg className="ic"><use href="#i-target" /></svg>
          {converting ? "Creating…" : "Convert to proposal"}
        </button>
      </div>

      <style jsx global>{`
        .jf-blueprint .content .pk {
          border-top: 2px solid var(--ink);
        }

        /* ── ticket ── */
        .jf-blueprint .content .pk-ticket {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 14px 16px 8px;
          background: var(--paper-deep);
        }
        .jf-blueprint .content .pk-ticket-sum {
          display: flex;
          align-items: baseline;
          flex-wrap: wrap;
          gap: 4px 12px;
          min-width: 0;
        }
        .jf-blueprint .content .pk-ticket-lbl {
          font-family: var(--font-mono);
          font-size: 10.5px;
          font-weight: 700;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: var(--ink);
        }
        .jf-blueprint .content .pk-ticket-v {
          font-size: 26px;
          font-weight: 900;
          letter-spacing: -0.005em;
          color: var(--blueprint);
          font-variant-numeric: tabular-nums;
          line-height: 1;
        }
        .jf-blueprint .content .pk-ticket-h {
          font-family: var(--font-mono);
          font-size: 10.5px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--muted);
          font-variant-numeric: tabular-nums;
        }
        .jf-blueprint .content .pk-acts {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          flex-shrink: 0;
        }

        /* ── basis line: the ticket's second line, same band ── */
        .jf-blueprint .content .pk-basis {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px 18px;
          flex-wrap: wrap;
          padding: 0 16px 12px;
          background: var(--paper-deep);
          border-bottom: 2px solid var(--ink);
        }
        .jf-blueprint .content .pk-facts {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 4px 0;
          min-width: 0;
          font-family: var(--font-mono);
          font-size: 10.5px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--ink);
          font-variant-numeric: tabular-nums;
        }
        .jf-blueprint .content .pk-facts b {
          font-weight: 700;
        }
        .jf-blueprint .content .pk-facts b + b::before,
        .jf-blueprint .content .pk-facts i + b::before {
          content: "·";
          margin: 0 8px;
          color: var(--muted-light);
          font-weight: 400;
        }
        .jf-blueprint .content .pk-facts i {
          font-style: normal;
          color: var(--muted);
          margin-left: 6px;
        }
        .jf-blueprint .content .pk-catalog {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-left: auto;
          flex-shrink: 0;
        }
        .jf-blueprint .content .pk-catalog-txt {
          font-family: var(--font-mono);
          font-size: 10.5px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--muted);
        }
        .jf-blueprint .content .pk-catalog-txt em {
          font-style: normal;
          color: var(--warning);
        }

        /* ── ledger rows ── */
        .jf-blueprint .content .pk-row {
          border-bottom: 1.5px solid var(--hair-soft);
        }
        .jf-blueprint .content .pk-row:last-of-type {
          border-bottom: 2px solid var(--ink);
        }
        .jf-blueprint .content .pk-hd {
          display: flex;
          align-items: center;
          gap: 12px;
          padding-right: 16px;
        }
        .jf-blueprint .content .pk-hd-btn {
          flex: 1 1 auto;
          min-width: 0;
          display: flex;
          align-items: center;
          gap: 14px;
          height: 48px;
          padding: 0 4px 0 16px;
          border: 0;
          background: none;
          color: var(--ink);
          text-align: left;
          cursor: pointer;
          transition: background 120ms var(--ease-out, ease-out);
        }
        .jf-blueprint .content .pk-hd-btn:hover {
          background: var(--paper-deep);
        }
        .jf-blueprint .content .pk-hd-btn:focus-visible {
          outline: 2px solid var(--blueprint);
          outline-offset: -2px;
        }
        .jf-blueprint .content .pk-hd-title {
          flex-shrink: 0;
          width: 150px;
          font-family: var(--font);
          font-size: 12.5px;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        /* The summary is a sentence, not an annotation: Inter, sentence case.
           Mono caps everywhere made title, summary, label and status one
           texture, and the eye had nothing to land on. */
        .jf-blueprint .content .pk-hd-sum {
          flex: 1 1 auto;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-family: var(--font);
          font-size: 13px;
          color: var(--muted);
          font-variant-numeric: tabular-nums;
        }
        .jf-blueprint .content .pk-row.is-open .pk-hd-sum {
          color: var(--ink);
        }
        .jf-blueprint .content .pk-hd .chip {
          flex-shrink: 0;
        }
        .jf-blueprint .content .pk-chev {
          flex-shrink: 0;
          width: 16px;
          height: 16px;
          color: var(--muted);
          transition: transform 180ms var(--ease-out, ease-out);
        }
        .jf-blueprint .content .pk-row.is-open .pk-chev {
          transform: rotate(180deg);
          color: var(--ink);
        }
        .jf-blueprint .content .pk-hd-act {
          flex-shrink: 0;
        }
        .jf-blueprint .content .pk-body {
          display: grid;
          gap: 14px;
          padding: 14px 16px 18px;
          animation: pk-open 180ms var(--ease-out, ease-out);
        }
        @keyframes pk-open {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: none; }
        }
        @media (prefers-reduced-motion: reduce) {
          .jf-blueprint .content .pk-body { animation: none; }
          .jf-blueprint .content .pk-chev { transition: none; }
        }

        /* ── groups & fields ── */
        .jf-blueprint .content .pk-g {
          display: grid;
          gap: 6px;
        }
        .jf-blueprint .content .pk-g-lbl,
        .jf-blueprint .content .pk-rates-lbl {
          font-family: var(--font-mono);
          font-size: 9.5px;
          font-weight: 600;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--muted);
        }
        .jf-blueprint .content .pk-fields {
          display: flex;
          flex-wrap: wrap;
          align-items: flex-end;
          gap: 10px 11px;
        }
        /* One field width. Mixed widths made every row a different rhythm;
           labels stay on one line so the field tops line up. */
        .jf-blueprint .content .pk-f {
          width: 168px;
          display: block;
        }
        .jf-blueprint .content .pk-f--wide {
          width: 240px;
        }
        .jf-blueprint .content .pk-f .est-lbl {
          display: block;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .jf-blueprint .content .pk-f--bare {
          display: block;
        }
        /* Inside a ledger grid the column sets the width, not the field. */
        .jf-blueprint .content .pk-vent-row .pk-f,
        .jf-blueprint .content .pk-manage-row .pk-f,
        .jf-blueprint .content .pk-custom-row .pk-f {
          width: auto;
          min-width: 0;
        }
        .jf-blueprint .content .pk-rates {
          display: grid;
          gap: 6px;
          padding-top: 10px;
          border-top: 1.5px dashed var(--hair-soft);
        }
        .jf-blueprint .content .pk-note {
          font-size: 12px;
          line-height: 1.5;
          color: var(--muted);
          max-width: 70ch;
        }
        .jf-blueprint .content .pk-in {
          position: relative;
          display: block;
        }
        .jf-blueprint .content .pk-in.has-unit .est-in {
          padding-right: 58px;
        }
        .jf-blueprint .content .pk-unit {
          position: absolute;
          right: 10px;
          top: 50%;
          transform: translateY(-50%);
          font-family: var(--font-mono);
          font-size: 10px;
          letter-spacing: 0.04em;
          color: var(--muted);
          pointer-events: none;
          white-space: nowrap;
        }
        .jf-blueprint .content .pk-check {
          display: flex;
          align-items: center;
          gap: 8px;
          height: var(--field-h);
          font-size: 13px;
          color: var(--ink);
          cursor: pointer;
          white-space: nowrap;
        }
        .jf-blueprint .content .pk-check input {
          width: 16px;
          height: 16px;
          accent-color: var(--ink);
        }
        .jf-blueprint .content .pk-link {
          height: var(--field-h);
          padding: 0;
          border: 0;
          background: none;
          font-family: var(--font-mono);
          font-size: 10.5px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--blueprint);
          text-decoration: underline;
          text-underline-offset: 3px;
          cursor: pointer;
          text-align: left;
          white-space: nowrap;
        }
        .jf-blueprint .content .pk-link:hover {
          color: var(--blueprint-dark, var(--ink));
        }
        .jf-blueprint .content .pk-link:disabled {
          opacity: 0.5;
          cursor: default;
        }
        .jf-blueprint .content .pk-add {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
          align-items: center;
        }

        /* ── list editors, vents, custom ── */
        .jf-blueprint .content .pk-manage {
          display: grid;
          gap: 6px;
        }
        .jf-blueprint .content .pk-manage-row {
          display: grid;
          grid-template-columns: minmax(180px, 2fr) 150px 110px 110px 90px 90px 32px;
          gap: 8px;
          align-items: center;
        }
        .jf-blueprint .content .pk-manage--und .pk-manage-row {
          grid-template-columns: minmax(180px, 2fr) 120px 32px;
        }
        .jf-blueprint .content .pk-manage-head,
        .jf-blueprint .content .pk-vent-head {
          font-family: var(--font-mono);
          font-size: 9.5px;
          font-weight: 600;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--muted);
          padding-bottom: 4px;
          border-bottom: 1.5px solid var(--hair-soft);
        }
        /* Left-packed: the inputs sit next to the name, not across a gulf. */
        .jf-blueprint .content .pk-vents {
          display: grid;
          gap: 6px;
          width: max-content;
          max-width: 100%;
        }
        .jf-blueprint .content .pk-vent-row {
          display: grid;
          grid-template-columns: 280px 96px 40px 132px 132px 32px;
          gap: 8px;
          align-items: center;
        }
        .jf-blueprint .content .pk-vent-name {
          font-size: 13px;
          color: var(--ink);
          line-height: 1.25;
        }
        .jf-blueprint .content .pk-vent-name em {
          display: block;
          font-style: normal;
          font-family: var(--font-mono);
          font-size: 10px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--muted);
        }
        .jf-blueprint .content .pk-vent-unit {
          font-family: var(--font-mono);
          font-size: 10.5px;
          color: var(--muted);
        }
        .jf-blueprint .content .pk-custom {
          display: grid;
          gap: 8px;
        }
        .jf-blueprint .content .pk-custom-row {
          display: grid;
          grid-template-columns: minmax(160px, 2fr) 92px 120px 120px 120px 32px;
          gap: 8px;
          align-items: center;
        }
        .jf-blueprint .content .pk-x {
          width: 32px;
          height: var(--field-h);
          border: 1.5px solid var(--hair-soft);
          border-radius: var(--radius);
          background: #fff;
          color: var(--muted);
          font-size: 16px;
          cursor: pointer;
        }
        .jf-blueprint .content .pk-x:hover:not(:disabled) {
          color: var(--ink);
          border-color: var(--ink);
        }
        .jf-blueprint .content .pk-x:disabled {
          opacity: 0.4;
          cursor: default;
        }

        /* ── foot ── */
        .jf-blueprint .content .pk-foot {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          padding: 12px 16px;
          background: var(--paper-deep);
        }
        .jf-blueprint .content .pk-foot-v {
          font-size: 18px;
          font-weight: 900;
          color: var(--ink);
          font-variant-numeric: tabular-nums;
        }

        @media (max-width: 768px) {
          .jf-blueprint .content .pk-ticket,
          .jf-blueprint .content .pk-foot,
          .jf-blueprint .content .pk-basis {
            flex-direction: column;
            align-items: stretch;
          }
          .jf-blueprint .content .pk-catalog {
            margin-left: 0;
            justify-content: space-between;
          }
          .jf-blueprint .content .pk-acts .btn {
            flex: 1;
            justify-content: center;
          }
          .jf-blueprint .content .pk-hd-btn {
            flex-wrap: wrap;
            height: auto;
            min-height: 48px;
            padding: 8px 4px 8px 12px;
            gap: 4px 12px;
          }
          .jf-blueprint .content .pk-hd-title {
            width: auto;
            flex: 1 1 auto;
          }
          .jf-blueprint .content .pk-hd-sum {
            flex-basis: 100%;
            order: 3;
            white-space: normal;
          }
          .jf-blueprint .content .pk-hd {
            flex-wrap: wrap;
            padding-right: 12px;
          }
          .jf-blueprint .content .pk-body {
            padding: 12px 12px 16px;
          }
          .jf-blueprint .content .pk-f,
          .jf-blueprint .content .pk-f--wide {
            width: calc(50% - 6px);
          }
          .jf-blueprint .content .pk-manage-row {
            grid-template-columns: minmax(0, 1fr) 110px 80px 80px 64px 64px 32px;
            gap: 6px;
          }
          .jf-blueprint .content .pk-vents {
            width: 100%;
          }
          .jf-blueprint .content .pk-vent-row {
            grid-template-columns: minmax(0, 1fr) 64px 32px 88px 88px 32px;
            gap: 6px;
          }
          .jf-blueprint .content .pk-custom-row {
            grid-template-columns: minmax(0, 1fr) 64px 88px 88px 88px 32px;
            gap: 6px;
          }
        }
      `}</style>
    </div>
  );
}
