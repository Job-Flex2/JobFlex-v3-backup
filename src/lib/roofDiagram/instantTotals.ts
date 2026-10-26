// The figures a roof page shows, derived from an Instant answer — pure, so the
// server (persist) and the client (hero, estimate) compute the same numbers
// from the same rule. Client-safe: no env, no I/O, type-only import.
//
// WHY A MAIN STRUCTURE (audit 2026-09-08). EagleView answers with every
// structure on the parcel — 12117 202nd St SE came back as twenty, the house
// plus nineteen outbuildings — and the page summed them all: 11,675 sq ft and
// 116.8 squares for a 3,747 sq ft house. The page now prices ONE structure,
// the main one, and lists the rest with checkboxes the contractor turns on
// deliberately; a checked structure is added to the total and to the estimate
// in plain sight.

import type { InstantRoofData, InstantStructure } from "@/lib/eagleview";

/** The totals block, derived from a set of structures. */
export function instantTotalsOf(structures: readonly InstantStructure[]): InstantRoofData["totals"] {
  const areaSqft = structures.reduce((a, s) => a + (s.areaSqft ?? 0), 0);
  const main = structures.slice().sort((a, b) => (b.areaSqft ?? 0) - (a.areaSqft ?? 0))[0];
  const pitchLabel = main?.pitch ?? null;
  const pitchRise = pitchLabel ? Number(pitchLabel.split("/")[0]) : NaN;
  const eaves = structures.flatMap((s) => (s.eaveHeightFt ? Object.values(s.eaveHeightFt) : []));
  const facetCounts = structures.map((s) => s.facetCount).filter((n): n is number => n != null);
  const footprints = structures.map((s) => s.footprintSqft).filter((n): n is number => n != null);
  return {
    areaSqft,
    squares: areaSqft / 100,
    predominantPitch: Number.isFinite(pitchRise) ? pitchRise : null,
    pitchLabel,
    maxEaveFt: eaves.length ? Math.max(...eaves) : null,
    facetCount: facetCounts.length ? facetCounts.reduce((a, b) => a + b, 0) : null,
    footprintSqft: footprints.length ? footprints.reduce((a, b) => a + b, 0) : null,
  };
}

/**
 * "at-pin": the address pin stands on this building's outline (2026-10-16).
 * "user-pin" / "near-user-pin": the pin the person placed before ordering stands on it, or nearest it (ticket 8KETUL).
 * "chosen": the contractor picked this building on the page (2026-10-26) — "Make main", or "Measure this one" —
 * recorded by the server, never computed here.
 */
export type MainStructureHow = "single" | "user-pin" | "near-user-pin" | "chosen" | "at-pin" | "area+parcel" | "nearest-pin" | "area" | "none";

export interface MainStructurePick {
  /** Index into `structures`, or null when there are none. */
  index: number | null;
  how: MainStructureHow;
}

function centroid(ring: ReadonlyArray<{ lat: number; lng: number }>): { lat: number; lng: number } {
  const n = ring.length;
  return { lat: ring.reduce((a, p) => a + p.lat, 0) / n, lng: ring.reduce((a, p) => a + p.lng, 0) / n };
}

/**
 * A point that stands on the building — its centroid when that is inside, else the middle of the widest stretch of the
 * outline along the centroid's latitude (an L- or U-shaped roof's centroid can fall in its yard). What "Measure this
 * building instead" sends, so the at-pin rule finds this building and no other.
 */
export function pointOnRing(ring: ReadonlyArray<{ lat: number; lng: number }>): { lat: number; lng: number } {
  const c = centroid(ring);
  if (pointInRing(c, ring)) return c;
  const xs: number[] = [];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.lat > c.lat !== b.lat > c.lat) xs.push(((b.lng - a.lng) * (c.lat - a.lat)) / (b.lat - a.lat) + a.lng);
  }
  xs.sort((a, b) => a - b);
  let best: { lat: number; lng: number } = c;
  let width = -1;
  for (let k = 0; k + 1 < xs.length; k += 2) {
    if (xs[k + 1] - xs[k] > width) {
      width = xs[k + 1] - xs[k];
      best = { lat: c.lat, lng: (xs[k] + xs[k + 1]) / 2 };
    }
  }
  return best;
}

/** Whether a point stands inside a lat/lng ring (ray casting — a building is small enough to be flat). */
export function pointInRing(p: { lat: number; lng: number }, ring: ReadonlyArray<{ lat: number; lng: number }> | null | undefined): boolean {
  if (!ring || ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.lat > p.lat !== b.lat > p.lat && p.lng < ((b.lng - a.lng) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lng) inside = !inside;
  }
  return inside;
}

/** Feet between two points (equirectangular — exact enough across one block). */
export function feetBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const D2R = Math.PI / 180;
  const dx = (b.lng - a.lng) * Math.cos(((a.lat + b.lat) / 2) * D2R) * D2R * 6378137;
  const dy = (b.lat - a.lat) * D2R * 6378137;
  return Math.sqrt(dx * dx + dy * dy) * 3.28084;
}

/** Feet from a point to a building's outline — 0 inside it; Infinity without an outline. */
export function feetToRing(p: { lat: number; lng: number }, ring: ReadonlyArray<{ lat: number; lng: number }> | null | undefined): number {
  if (!ring || ring.length < 3) return Infinity;
  if (pointInRing(p, ring)) return 0;
  const D2R = Math.PI / 180;
  const kx = Math.cos(p.lat * D2R) * D2R * 6378137 * 3.28084;
  const ky = D2R * 6378137 * 3.28084;
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = (ring[j].lng - p.lng) * kx, ay = (ring[j].lat - p.lat) * ky;
    const bx = (ring[i].lng - p.lng) * kx, by = (ring[i].lat - p.lat) * ky;
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1e-12)));
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

export type OtherStructure = {
  /** Index into `structures` — what a tick is saved as. */
  i: number;
  s: InstantStructure;
  /** Wholly outside the lot by the parcel check (provenance.parcelVeto) — a neighbour's, not this property's. */
  offLot: boolean;
  /** From the main building (or the pin), centre to centre; null without an outline. */
  feet: number | null;
};

/**
 * The structures besides the main one, in the order the page lists them (2026-10-16, owner: "it's a single family,
 * but it shows two dozen buildings"): the ones on this lot first, then the ones the parcel check put outside it —
 * each group nearest the house first, buildings with no outline last. The page numbers them in this order, so a
 * row's number is its pin's.
 */
export function otherStructuresOf(input: {
  structures: readonly InstantStructure[];
  mainIndex: number | null;
  foreign?: readonly number[];
  origin?: { lat: number; lng: number } | null;
}): OtherStructure[] {
  const foreign = new Set(input.foreign ?? []);
  const main = input.mainIndex != null ? input.structures[input.mainIndex] : null;
  const from = main?.outline && main.outline.length >= 3 ? centroid(main.outline) : input.origin ?? null;
  const rows = input.structures
    .map((s, i) => ({ i, s, offLot: foreign.has(i), feet: from && s.outline && s.outline.length >= 3 ? feetBetween(from, centroid(s.outline)) : null }))
    .filter((r) => r.i !== input.mainIndex);
  return rows.sort((a, b) => Number(a.offLot) - Number(b.offLot) || (a.feet ?? Infinity) - (b.feet ?? Infinity) || a.i - b.i);
}

/**
 * Which structure the page is about.
 *   · one structure → it;
 *   · the pin the person placed on the map before ordering (`userPin`) stands on a building → that one (the
 *     largest, where outlines overlap), whatever the lot check said: the person pointed at it; on none → the
 *     building nearest the pin among this lot's (2026-10-26, ticket 8KETUL: EagleView's own point for an
 *     apartment complex stood on its garage, and nothing the person did could change it);
 *   · then the rules below, with EagleView's own point as `origin`:
 *   · the parcel is known (mask applied) → the largest by roof area among the
 *     structures NOT vetoed as someone else's;
 *   · no parcel → the structure whose outline centroid is nearest the geocode
 *     pin (a farm's barns are bigger than its house; the pin is on the house);
 *   · no outlines to measure distance with → the largest by area.
 */
export function pickMainStructure(
  structures: readonly InstantStructure[],
  opts: {
    foreign?: readonly number[];
    origin?: { lat: number; lng: number } | null;
    parcelKnown: boolean;
    userPin?: { lat: number; lng: number } | null;
  },
): MainStructurePick {
  if (!structures.length) return { index: null, how: "none" };
  if (structures.length === 1) return { index: 0, how: "single" };
  const foreign = new Set(opts.foreign ?? []);
  const candidates = structures.map((s, i) => i).filter((i) => !foreign.has(i));
  const pool = candidates.length ? candidates : structures.map((_, i) => i);
  const byArea = (idx: readonly number[]) =>
    idx.slice().sort((a, b) => (structures[b].areaSqft ?? structures[b].footprintSqft ?? -1) - (structures[a].areaSqft ?? structures[a].footprintSqft ?? -1))[0];
  const pin = opts.userPin;
  if (pin && Number.isFinite(pin.lat) && Number.isFinite(pin.lng)) {
    const under = structures.map((_, i) => i).filter((i) => pointInRing(pin, structures[i].outline));
    if (under.length) return { index: byArea(under), how: "user-pin" };
    const near = pool
      .map((i) => ({ i, ft: feetToRing(pin, structures[i].outline) }))
      .filter((r) => Number.isFinite(r.ft))
      .sort((a, b) => a.ft - b.ft || a.i - b.i)[0];
    if (near) return { index: near.i, how: "near-user-pin" };
  }
  // The address pin standing on a building is the strongest word there is about which one this is — stronger than
  // size: the largest roof in reach can be a neighbour's when the lot check misses it (2026-10-16).
  if (opts.origin) {
    const o = opts.origin;
    const under = pool.filter((i) => pointInRing(o, structures[i].outline));
    if (under.length) return { index: byArea(under), how: "at-pin" };
  }
  if (opts.parcelKnown) return { index: byArea(pool), how: "area+parcel" };
  if (opts.origin) {
    const withOutline = pool.filter((i) => (structures[i].outline?.length ?? 0) >= 3);
    if (withOutline.length) {
      const o = opts.origin;
      const d2 = (i: number) => {
        const c = centroid(structures[i].outline!);
        const dx = (c.lng - o.lng) * Math.cos((o.lat * Math.PI) / 180);
        const dy = c.lat - o.lat;
        return dx * dx + dy * dy;
      };
      return { index: withOutline.slice().sort((a, b) => d2(a) - d2(b))[0], how: "nearest-pin" };
    }
  }
  return { index: byArea(pool), how: "area" };
}

/**
 * The pick the server records (2026-10-26, a contractor's ticket: "wrong building — the apartment building needs to be
 * measured, not the garage"): at the contractor's pin — the address they confirmed, or a building they chose on the
 * page ("chosen") — when it stands on a building; else at the vendor's point for the address, which can stand on the
 * garage of a lot with several buildings.
 */
export function pickMainStructureAt(
  structures: readonly InstantStructure[],
  opts: { pin?: { lat: number; lng: number } | null; vendor?: { lat: number; lng: number } | null; chosen?: boolean; foreign?: readonly number[]; parcelKnown: boolean },
): MainStructurePick {
  const at = (origin: { lat: number; lng: number } | null) => pickMainStructure(structures, { foreign: opts.foreign, origin, parcelKnown: opts.parcelKnown });
  const pin = opts.pin ?? null;
  const vendor = opts.vendor ?? null;
  const pick = at(pin ?? vendor);
  if (pin && pick.how !== "at-pin" && vendor) return at(vendor);
  return opts.chosen && pin && pick.how === "at-pin" ? { ...pick, how: "chosen" } : pick;
}

/** `provenance.parcelVeto.foreignStructures` ("s3") → indices (3). */
export function foreignIndices(foreign: readonly string[] | undefined): number[] {
  return (foreign ?? []).map((s) => Number(String(s).replace(/^s/, ""))).filter((n) => Number.isInteger(n));
}

/**
 * THE main-structure rule, in one place (audit 2026-09-17).
 *
 * The server records its pick on the row (`provenance.mainStructure`) and that
 * recorded index is what every reader must honour — the row's columns, the
 * hero, the estimate and the provenance API are all about that one building.
 * Only a row saved before the pick was recorded falls back to computing it,
 * and then by ONE rule, not two: the page used to re-derive it with
 * `parcelKnown: !!parcelVeto` while the server had used `parcelKnown: lot != null`,
 * so a row with a known parcel but no vetoed neighbours could be re-derived by
 * the nearest-pin rule instead of the area rule the server had applied.
 */
export function mainStructureOf(input: {
  structures: readonly InstantStructure[];
  provenance?: Record<string, unknown> | null;
  origin?: { lat?: number | null; lng?: number | null } | null;
}): MainStructurePick {
  const prov = input.provenance ?? {};
  const recorded = (prov.mainStructure as { index?: number; how?: string } | undefined) ?? undefined;
  if (recorded?.index != null && input.structures[recorded.index]) {
    return { index: recorded.index, how: (recorded.how as MainStructureHow) ?? "area+parcel" };
  }
  const veto = prov.parcelVeto as { foreignStructures?: string[] } | undefined;
  const o = input.origin;
  return pickMainStructure(input.structures, {
    foreign: foreignIndices(veto?.foreignStructures),
    origin: o?.lat != null && o?.lng != null ? { lat: o.lat, lng: o.lng } : null,
    parcelKnown: !!veto,
  });
}

/**
 * The other structures ticked into the estimate, as the row keeps them (`provenance.included`, 2026-10-26):
 * valid indices only, never the main one, each once, in the order given. Rows saved before then have none.
 */
export function includedIndicesOf(
  provenance: Record<string, unknown> | null | undefined,
  structureCount: number,
  mainIndex: number | null,
): number[] {
  const raw = provenance?.included;
  if (!Array.isArray(raw)) return [];
  const out: number[] = [];
  for (const v of raw) {
    if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < structureCount && v !== mainIndex && !out.includes(v)) out.push(v);
  }
  return out;
}

/** The pin the person placed before ordering, as the row keeps it (`provenance.userPin`); null on older rows. */
export function userPinOf(provenance: Record<string, unknown> | null | undefined): { lat: number; lng: number } | null {
  const p = provenance?.userPin as { lat?: unknown; lng?: unknown } | null | undefined;
  return p && typeof p.lat === "number" && typeof p.lng === "number" && Number.isFinite(p.lat) && Number.isFinite(p.lng) ? { lat: p.lat, lng: p.lng } : null;
}

const FT_PER_M = 3.28084;
const EARTH_R_M = 6378137;

/**
 * Plan area of a lat/lng ring, sq ft — equirectangular about the ring's own
 * centre, which is exact enough for one building at any US latitude.
 */
export function outlineAreaSqft(ring: ReadonlyArray<{ lat: number; lng: number }> | null | undefined): number | null {
  if (!ring || ring.length < 3) return null;
  if (ring.some((p) => !Number.isFinite(p.lat) || !Number.isFinite(p.lng))) return null;
  const D2R = Math.PI / 180;
  const lat0 = ring.reduce((a, p) => a + p.lat, 0) / ring.length;
  const lng0 = ring.reduce((a, p) => a + p.lng, 0) / ring.length;
  const kx = D2R * Math.cos(lat0 * D2R) * EARTH_R_M * FT_PER_M;
  const ky = D2R * EARTH_R_M * FT_PER_M;
  const pts = ring.map((p) => ({ x: (p.lng - lng0) * kx, y: (p.lat - lat0) * ky }));
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  const sqft = Math.abs(s / 2);
  return Number.isFinite(sqft) && sqft > 0 ? sqft : null;
}

export type FootprintSource = "eagleview" | "outline" | "none";

export interface FootprintRead {
  /** The footprint the estimate should use, sq ft. */
  sqft: number | null;
  source: FootprintSource;
  reportedSqft: number | null;
  outlineSqft: number | null;
  /** How far the reported figure sits from the building's own outline, share. */
  delta: number | null;
}

/** Past this much disagreement the building's own outline is believed. */
export const FOOTPRINT_OUTLINE_TOLERANCE = 0.1;

/**
 * The footprint of one structure, and where it came from.
 *
 * WHY (audit 2026-09-17). EagleView's `structure_footprint_sqft` normally sits
 * within a few percent of the building outline it ships alongside — five of
 * the six measured addresses agree to 3-7%. On 12117 202nd St SE it reported
 * 2,580 sq ft for a building whose own outline encloses 3,456: a 25% gap that
 * silently drives the edge estimate, the valley model and the attic
 * ventilation count. Past FOOTPRINT_OUTLINE_TOLERANCE the outline wins — it is
 * the geometry the drawing, the perimeter and the areas are all built on — and
 * the swap is recorded so nobody has to guess which number was used.
 */
export function footprintRead(structure: InstantStructure | null | undefined): FootprintRead {
  const reported = structure?.footprintSqft ?? null;
  const outline = outlineAreaSqft(structure?.outline);
  if (reported == null && outline == null) return { sqft: null, source: "none", reportedSqft: null, outlineSqft: null, delta: null };
  if (reported == null) return { sqft: outline, source: "outline", reportedSqft: null, outlineSqft: outline, delta: null };
  if (outline == null || outline <= 0) return { sqft: reported, source: "eagleview", reportedSqft: reported, outlineSqft: outline, delta: null };
  const delta = (reported - outline) / outline;
  return Math.abs(delta) > FOOTPRINT_OUTLINE_TOLERANCE
    ? { sqft: outline, source: "outline", reportedSqft: reported, outlineSqft: outline, delta }
    : { sqft: reported, source: "eagleview", reportedSqft: reported, outlineSqft: outline, delta };
}

export interface PitchFamily {
  pitch12: number;
  planSqft: number;
}

/**
 * The pitch the page SHOWS, in one place: the measured families rounded to
 * whole /12 and joined ("4/12 + 9/12"), else EagleView's published figure,
 * else null. Persist writes this so the Recent list and the hero agree
 * (audit finding 4: 12958 read 5/12 in the list and 4/12 + 9/12 on the page).
 */
export function displayedPitchLabel(
  measured: { source: string; families: readonly PitchFamily[] } | null | undefined,
  instantLabel: string | null | undefined,
): string | null {
  if (measured?.source === "measured" && measured.families.length) {
    return [...new Set(measured.families.map((f) => `${Math.round(f.pitch12)}/12`))].join(" + ");
  }
  return instantLabel ?? null;
}

/** Families with their share of the measured plan area, largest first. */
export function pitchFamilyShares(families: readonly PitchFamily[]): Array<{ pitch12: number; share: number }> {
  const total = families.reduce((a, f) => a + f.planSqft, 0);
  if (!total) return [];
  return families
    .slice()
    .sort((a, b) => b.planSqft - a.planSqft)
    .map((f) => ({ pitch12: f.pitch12, share: f.planSqft / total }));
}

export type PitchKind = "measured" | "eagleview" | "solar" | "none" | "legacy";

export interface RowFigures {
  areaSqft: number | null;
  squares: number | null;
  facetCount: number | null;
  predominantPitch: string | null;
  /** Where the pitch comes from; `legacy` = a drawing-pipeline row with no EagleView answer. */
  pitchKind: PitchKind;
  /** Index of the main structure the figures are about (null without an answer). */
  mainIndex: number | null;
}

/**
 * THE rule for a saved row's figures — the Recent list, the persisted columns
 * and the backfill all go through here, so a list entry can never disagree
 * with the page it opens (audit 2026-09-09: Recent carried drawn facet counts
 * and EagleView pitches while the hero showed EagleView facets and measured
 * pitches).
 *
 *   · with an EagleView answer: the MAIN structure's area / squares / facet
 *     count, the pitch as the page shows it (measured families, else the
 *     structure's published pitch);
 *   · without one (the Aug 2026 drawing pipelines, "[V2]" rows): the row's
 *     own area / squares, no facet count, and a pitch only when the stored
 *     provenance says it was measured — a pitch nobody measured is not data.
 */
export function rowFigures(input: {
  instant: InstantRoofData | null;
  provenance: Record<string, unknown> | null;
  columns: { areaSqft: number | null; squares: number | null; lat?: number | null; lng?: number | null };
}): RowFigures {
  const prov = input.provenance ?? {};
  const measured = prov.pitchMeasurement as { source: string; families: PitchFamily[] } | undefined;
  const legacyPs = prov.pitchSource as { source?: string; pitch12?: number } | undefined;
  const legacyMeasured =
    !measured && legacyPs?.source === "measured" && typeof legacyPs.pitch12 === "number" ? `${Math.round(legacyPs.pitch12)}/12` : null;
  const inst = input.instant;
  if (inst?.structures?.length) {
    const index = mainStructureOf({
      structures: inst.structures,
      provenance: prov,
      origin: { lat: input.columns.lat, lng: input.columns.lng },
    }).index;
    const main = index != null ? inst.structures[index] : null;
    const t = main ? instantTotalsOf([main]) : inst.totals;
    const fromMeasured = displayedPitchLabel(measured, null);
    const pitch = fromMeasured ?? legacyMeasured ?? t.pitchLabel ?? null;
    return {
      areaSqft: t.areaSqft,
      squares: t.squares,
      facetCount: t.facetCount,
      predominantPitch: pitch,
      pitchKind: prov.solar && pitch ? "solar" : fromMeasured || legacyMeasured ? "measured" : pitch ? "eagleview" : "none",
      mainIndex: index,
    };
  }
  return {
    areaSqft: input.columns.areaSqft,
    squares: input.columns.squares,
    facetCount: null,
    predominantPitch: legacyMeasured,
    pitchKind: legacyMeasured ? "measured" : "legacy",
    mainIndex: null,
  };
}
