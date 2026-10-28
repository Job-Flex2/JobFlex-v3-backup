import type { BuildingInsights, SolarDate } from "@/lib/solar";

const M2_TO_SQFT = 1 / (0.3048 * 0.3048);
const EARTH_RADIUS_M = 6_371_008.8;
const RAD = Math.PI / 180;
// Product acceptance gates, not measured accuracy or confidence percentages.
const MIN_MODELED_COVERAGE = 0.85;
const MAX_MODELED_COVERAGE = 1.05;
const PIN_MARGIN_M = 8;
const MAX_CENTER_DISTANCE_M = 50;
const MAX_PITCH_DEGREES = 75;

type Location = { lat: number; lng: number };

export interface SolarRoofEstimate {
  /** Sloped roof surface, with Google's ground-area correction when needed. No waste. */
  areaSqft: number;
  footprintSqft: number;
  predominantPitch12: number;
  pitchLabel: string;
  /** Google's modeled segments, not a verified architectural facet count. */
  segmentCount: number;
  /** Modeled areas only. Use surfaceSqft shares for roofing prices; planSqft is diagnostic. */
  pitchFamilies: { pitch12: number; planSqft: number; surfaceSqft: number }[];
  imageryDate: string | null;
  imageryQuality: string;
  /** Modeled ground footprint / Google's full-building ground footprint. */
  coverageRatio: number;
  areaMethod: "google-modeled-roof" | "google-ground-area-ratio";
  warnings: string[];
  center: Location;
  buildingName: string | null;
  rawAreaSqft: number;
}

export type SolarRoofEstimateResult =
  | { ok: true; estimate: SolarRoofEstimate }
  | { ok: false; error: string };

function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function validLocation(location: Location | null | undefined): location is Location {
  return !!location && Number.isFinite(location.lat) && Number.isFinite(location.lng) &&
    Math.abs(location.lat) <= 90 && Math.abs(location.lng) <= 180;
}

function distanceM(a: Location, b: Location): number {
  const lat = (b.lat - a.lat) * RAD;
  const lng = (b.lng - a.lng) * RAD;
  const h = Math.sin(lat / 2) ** 2 +
    Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(lng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}

function insideBox(point: Location, box: NonNullable<BuildingInsights["boundingBox"]>, marginM = 0): boolean {
  const latMargin = marginM / EARTH_RADIUS_M / RAD;
  const lngMargin = latMargin / Math.max(0.01, Math.cos(point.lat * RAD));
  return point.lat >= box.sw.lat - latMargin && point.lat <= box.ne.lat + latMargin &&
    point.lng >= box.sw.lng - lngMargin && point.lng <= box.ne.lng + lngMargin;
}

function imagery(date: SolarDate | null): { label: string; latestTime: number } | null {
  if (!date || !Number.isInteger(date.year) || !date.year || date.year < 1 || date.year > 9999) return null;
  const { year } = date;
  const month = date.month || undefined;
  const day = date.day || undefined;
  if (month !== undefined && (!Number.isInteger(month) || month < 1 || month > 12)) return null;
  if (day !== undefined && (!month || !Number.isInteger(day) || day < 1 || day > 31)) return null;
  const label = [String(year).padStart(4, "0"), ...(month ? [String(month).padStart(2, "0")] : []),
    ...(day ? [String(day).padStart(2, "0")] : [])].join("-");
  // With partial dates, age from the latest possible day to avoid overstating age.
  const latest = new Date(`${String(year).padStart(4, "0")}-${String(month || 12).padStart(2, "0")}-${String(day || 1).padStart(2, "0")}T00:00:00Z`);
  if (day && latest.getUTCDate() !== day) return null;
  if (!day) latest.setUTCMonth(latest.getUTCMonth() + 1, 0);
  return { label, latestTime: latest.getTime() };
}

/**
 * Pure estimate from Google's measured statistics; no raster, database, or API calls.
 * Official schema: https://developers.google.com/maps/documentation/solar/reference/rest/v1/buildingInsights/findClosest
 * areaMeters2 ALREADY accounts for tilt: applying another pitch multiplier is wrong.
 * Google recommends wholeRoof.area * building.groundArea / wholeRoof.groundArea
 * because wholeRoof excludes unmodeled parts. This extrapolates their average
 * slope, not their geometry; we allow it only with at least 85% modeled coverage.
 * Gates below are conservative consistency checks, not a calibrated error bound.
 */
export function estimateSolarRoof(
  insights: BuildingInsights,
  pin: Location,
  now: Date = new Date(),
  /** The homeowner's rough range (actions/publicEstimate, 2026-10-28) takes MEDIUM imagery too — many US homes have
   *  nothing better; a contractor's measurement keeps the default, HIGH only. */
  opts: { minQuality?: "HIGH" | "MEDIUM" } = {},
): SolarRoofEstimateResult {
  const fail = (error: string): SolarRoofEstimateResult => ({ ok: false, error });
  const qualityOk = insights.imageryQuality === "HIGH" || (opts.minQuality === "MEDIUM" && insights.imageryQuality === "MEDIUM");
  if (!qualityOk) {
    return fail("High-quality Google Solar imagery is required for this estimate.");
  }
  if (!validLocation(pin) || !validLocation(insights.center)) {
    return fail("The building location is missing or invalid. Confirm the pin on the roof and try again.");
  }
  const box = insights.boundingBox;
  if (!box || !validLocation(box.sw) || !validLocation(box.ne) ||
      box.sw.lat >= box.ne.lat || box.sw.lng >= box.ne.lng) {
    return fail("Google did not return a usable building boundary. The selected roof cannot be checked.");
  }
  const diagonalM = distanceM(box.sw, box.ne);
  const centerDistanceM = distanceM(pin, insights.center);
  if (!insideBox(insights.center, box, 2) || diagonalM > 2_000 ||
      !insideBox(pin, box, PIN_MARGIN_M) ||
      centerDistanceM > Math.min(MAX_CENTER_DISTANCE_M, diagonalM / 2 + PIN_MARGIN_M)) {
    return fail("Google returned a building that does not closely match the pin. Place the pin on the intended roof and try again.");
  }

  const wholeArea = insights.wholeRoofAreaM2;
  const modeledGround = insights.wholeRoofGroundAreaM2;
  const buildingGround = insights.buildingGroundAreaM2;
  if (!positive(wholeArea) || !positive(modeledGround) || !positive(buildingGround)) {
    return fail("Google did not return valid roof and footprint totals. Full-roof coverage cannot be verified.");
  }
  const coverageRatio = modeledGround / buildingGround;
  if (coverageRatio < MIN_MODELED_COVERAGE || coverageRatio > MAX_MODELED_COVERAGE) {
    return fail(`Google's modeled footprint covers ${(coverageRatio * 100).toFixed(0)}% of the building footprint; this estimate requires 85–105% consistent coverage. Use a manual measurement or report.`);
  }
  const boxWidthM = distanceM(box.sw, { lat: box.sw.lat, lng: box.ne.lng });
  const boxHeightM = distanceM(box.sw, { lat: box.ne.lat, lng: box.sw.lng });
  const slopeRatio = wholeArea / modeledGround;
  if (!Number.isFinite(slopeRatio) || slopeRatio < 0.98 ||
      slopeRatio > 1 / Math.cos(MAX_PITCH_DEGREES * RAD) ||
      buildingGround > boxWidthM * boxHeightM * 1.1) {
    return fail("Google's roof area, footprint, and boundary are inconsistent. Check this roof with a manual measurement or report.");
  }
  if (insights.invalidSegmentCount || !insights.segments.length) {
    return fail("Google returned missing or invalid roof-segment measurements. A reliable pitch estimate is unavailable.");
  }

  let segmentArea = 0;
  let segmentGround = 0;
  const families = new Map<number, { planArea: number; surfaceArea: number }>();
  let derivedGround = false;
  for (const segment of insights.segments) {
    if (!positive(segment.areaMeters2) || !Number.isFinite(segment.pitchDegrees) ||
        segment.pitchDegrees < 0 || segment.pitchDegrees > MAX_PITCH_DEGREES ||
        !Number.isFinite(segment.azimuthDegrees) || segment.azimuthDegrees < 0 || segment.azimuthDegrees > 360 ||
        !Number.isFinite(segment.planeHeightAtCenterMeters) ||
        !validLocation({ lat: segment.centerLat, lng: segment.centerLng }) ||
        !insideBox({ lat: segment.centerLat, lng: segment.centerLng }, box, 2)) {
      return fail("Google returned an invalid or unsupported roof segment. Verify this roof manually before estimating.");
    }
    const projectedGround = segment.areaMeters2 * Math.cos(segment.pitchDegrees * RAD);
    const planArea = segment.groundAreaMeters2 ?? projectedGround;
    if (!positive(planArea) || Math.abs(planArea - projectedGround) > Math.max(0.5, projectedGround * 0.1)) {
      return fail("Google's segment area and pitch disagree. Verify the roof before estimating.");
    }
    derivedGround ||= segment.groundAreaMeters2 === undefined;
    const pitch12 = Math.round(12 * Math.tan(segment.pitchDegrees * RAD));
    const family = families.get(pitch12) ?? { planArea: 0, surfaceArea: 0 };
    family.planArea += planArea;
    family.surfaceArea += segment.areaMeters2;
    families.set(pitch12, family);
    segmentArea += segment.areaMeters2;
    segmentGround += planArea;
  }
  // Catch incomplete segment lists and disagreement between independent totals.
  if (Math.abs(segmentArea / wholeArea - 1) > 0.1 || Math.abs(segmentGround / modeledGround - 1) > 0.1) {
    return fail("Google's segment totals do not match its roof totals. Complete roof coverage cannot be verified.");
  }

  const pitchFamilies = [...families].map(([pitch12, family]) => ({
    pitch12,
    planSqft: family.planArea * M2_TO_SQFT,
    surfaceSqft: family.surfaceArea * M2_TO_SQFT,
  })).sort((a, b) => b.surfaceSqft - a.surfaceSqft || a.pitch12 - b.pitch12);
  // Keep every family in the data; omit <3% groups only from the short pitch label.
  const significantFamilies = pitchFamilies.filter((family) => family.surfaceSqft >= segmentArea * M2_TO_SQFT * 0.03);
  const predominantPitch12 = pitchFamilies[0].pitch12;
  const pitchLabel = significantFamilies.length > 1
    ? `${predominantPitch12}/12 predominant · mixed pitches`
    : `${predominantPitch12}/12`;
  const warnings: string[] = [];
  if (!insideBox(pin, box)) {
    warnings.push("The address pin is just outside Google's building boundary. Confirm that the selected building is the intended roof.");
  }
  const adjusted = Math.abs(coverageRatio - 1) > 0.000001;
  if (adjusted) {
    warnings.push(`Roof area is adjusted by the building-to-modeled footprint ratio (${(1 / coverageRatio).toFixed(3)}×). Unmodeled sections are assumed to share the modeled roof's average slope.`);
  }
  if (coverageRatio > 1) {
    warnings.push("Google's modeled footprint slightly exceeds its full-building footprint; the area adjustment reduces the result.");
  }
  if (derivedGround) warnings.push("Some segment plan areas were derived from their reported surface area and pitch.");
  const date = imagery(insights.imageryDate);
  if (!date) warnings.push("The source imagery date is unavailable; recent roof changes cannot be checked.");
  else if (Number.isFinite(now.getTime()) && now.getTime() - date.latestTime > 3 * 365.25 * 24 * 60 * 60 * 1000) {
    warnings.push(`Source imagery is more than three years old (${date.label}); verify additions and roof changes.`);
  }
  warnings.push("Google roof segments are modeled surfaces, not a verified architectural facet count. Confirm the building and dimensions before ordering materials.");
  const areaSqft = wholeArea / coverageRatio * M2_TO_SQFT;
  if (!positive(areaSqft)) return fail("Google's roof estimate exceeds the supported numeric range.");
  if (areaSqft < 400) {
    warnings.push("This is a small roof (under 400 sq ft). Confirm that Google selected the intended structure rather than a shed or other outbuilding.");
  }
  return {
    ok: true,
    estimate: {
      areaSqft,
      footprintSqft: buildingGround * M2_TO_SQFT,
      predominantPitch12,
      pitchLabel,
      segmentCount: insights.segments.length,
      pitchFamilies,
      imageryDate: date?.label ?? null,
      imageryQuality: insights.imageryQuality,
      coverageRatio,
      areaMethod: adjusted ? "google-ground-area-ratio" : "google-modeled-roof",
      warnings,
      center: { ...insights.center },
      buildingName: insights.name ?? null,
      rawAreaSqft: wholeArea * M2_TO_SQFT,
    },
  };
}
