"use server";
// Property parcel boundary for the fence studio.
//
// PARCEL SOURCE: ReportAll USA (2026-08-24). It replaces Regrid, which replaced
// the SAM 2 aerial-trace — surveyed polygons beat visual segmentation for thin
// or tree-covered fence lines, and that reasoning is unchanged; only the vendor
// moved. Two reasons for the swap:
//   · Regrid issues 30-DAY JWTs, so "Load property lines" broke roughly monthly
//     until somebody minted a new token. ReportAll uses a static client key.
//   · ReportAll is already wired, cached and paid for here (/api/parcels,
//     ParcelCache, ParcelMiss), so this stops the app carrying two parcel
//     vendors that answer the same question.
//
// The lookup goes through @/lib/parcelLookup, NOT the ReportAll client directly:
// the quota is ALLTIME, and that module owns the one cache policy every caller
// shares. No longer stateless as a result — a cache miss writes the parcel back.
//
// Regrid is still imported for BUILDING FOOTPRINTS only (see mergeBuildings):
// ReportAll returns parcel geometry, not structures. With no Regrid key the
// footprints come from OpenStreetMap alone, which is a degradation in footprint
// quality but never blocks the parcel ring.
import { requireEstimatorOrManager } from "@/lib/orgContext";
import { lookupPropertyBoundary, type BuildingRing, type LatLngPoint } from "@/lib/fence/boundaryLookup";
// Parcel parsing lives in @/lib/parcel so the roof reconstruction and the
// out-of-request eval script can share it (a "use server" file may only export
// async functions, so these could not be exported from here).
// The street centrelines this action now returns are consumed by the parcel
// geometry lib, which owns the type.
import type { RoadLine } from "@/lib/parcels";
import { enforceRateLimit, HOUR } from "@/lib/rateLimit";
import { readOsmPoint } from "@/lib/overpassStore";
import { solarHousesAt, withOsmHeights } from "@/lib/solarHouses";
import { takeTrialCap, trialPointKey } from "@/lib/trialMeter";
import type { PlanLimitFailure } from "@/lib/planLimits";
import { requirePage } from "@/lib/customPageAccess";

export type { LatLngPoint, BuildingRing } from "@/lib/fence/boundaryLookup";

export async function fetchPropertyBoundary(
  lat: number,
  lng: number,
): Promise<
  | { ok: true; ring: LatLngPoint[]; buildings: BuildingRing[]; roads: RoadLine[] }
  | { ok: false; error: string; buildings: BuildingRing[]; roads: RoadLine[]; code?: PlanLimitFailure["code"]; trialCap?: PlanLimitFailure["trialCap"]; trialEnded?: boolean }
> {
  const { organizationId: rlOrg } = await requireEstimatorOrManager();
  await requirePage(rlOrg, ["fence-estimator", "hvac-estimator"]);
  await enforceRateLimit(`parcels:${rlOrg}`, 30, HOUR, "property lookups");
  // The card-less trial's fence ceiling (lib/trialMeter), counted once per
  // point — /api/parcels asks for the same pin at the same moment. Inside an
  // HVAC site lookup or a roof measurement the outline is theirs, not a fence's.
  const trial = await takeTrialCap(rlOrg, "fenceLookups", { dedupe: trialPointKey(lat, lng), coveredBy: ["hvacLookups", "roofMeasurements"] });
  if (!trial.ok) return { ...trial.failure, buildings: [], roads: [] };
  return lookupPropertyBoundary(lat, lng);
}

/**
 * The better house outlines (2026-09-24): every structure in Google's aerial
 * building mask around the pin, in lat/lng, with OpenStreetMap's heights where
 * an OSM building sits under the same roof (lib/solarHouses). `ok: false`
 * says why there are none — no key, no Google coverage here, or a failed call
 * — and the fence page keeps the OSM outlines it already has. Asked beside
 * the OSM lookup, so a cached OSM answer may or may not be there yet; the page
 * merges heights again when it is.
 */
export async function fetchHouseFootprints(
  lat: number,
  lng: number,
  radiusM?: number,
): Promise<
  | { ok: true; source: "solar"; buildings: BuildingRing[]; imageryDate: string | null; imageryQuality: string; cached: boolean }
  | { ok: false; reason: "off" | "no-coverage" | "failed"; error?: string }
> {
  const { organizationId } = await requireEstimatorOrManager();
  await requirePage(organizationId, "fence-estimator");
  await enforceRateLimit(`solar-houses:${organizationId}`, 30, HOUR, "house outline lookups");
  // Google Solar, at the fence page's point: the same trial use as its lot.
  const trial = await takeTrialCap(organizationId, "fenceLookups", { dedupe: trialPointKey(lat, lng) });
  if (!trial.ok) return { ok: false, reason: "failed", error: trial.failure.error };
  const answer = await solarHousesAt({ lat, lng }, { radiusM });
  if (!answer.ok) return answer;
  const osm = await readOsmPoint<{ buildings: BuildingRing[]; roads: RoadLine[] }>(lat, lng).catch(() => null);
  return {
    ok: true,
    source: "solar",
    buildings: withOsmHeights(answer.buildings, osm?.buildings ?? []),
    imageryDate: answer.imageryDate,
    imageryQuality: answer.imageryQuality,
    cached: answer.cached,
  };
}
