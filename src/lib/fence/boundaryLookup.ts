import "server-only";
// THE LOT LINES AND THE BUILDINGS AROUND A PIN, GATE-FREE (2026-10-28, moved out of actions/fenceBoundary
// fetchPropertyBoundary): the parcel ring the pin is in (the county's record), the building footprints (Regrid's
// survey-matched ones, OpenStreetMap as the fill for the neighbours), the street centrelines. Two callers, each
// behind its own gate, brakes and caps: the dashboard's fence and HVAC estimators and the shop's website
// (actions/webEstimator webFenceLot).
import {
  isRegridEnabled,
  outerRing,
  pointInRing,
  fetchRegridPoint,
  type LatLngPoint,
  type RegridResponse,
} from "@/lib/parcel";
import { lookupParcelByPoint } from "@/lib/parcelLookup";
import type { RoadLine } from "@/lib/parcels";
import { readOsmPoint, writeOsmPoint } from "@/lib/overpassStore";
import { askOverpass } from "@/lib/overpass";

export type { LatLngPoint };

// A nearby building footprint in lat/lng (client converts to local feet with the
// same origin it uses for the parcel ring, so both land in one frame).
export interface BuildingRing {
  ring: LatLngPoint[];
  heightFt: number;
  /** True when the height came from a real `height` / `building:levels` tag; false = the one-storey default. */
  heightTagged?: boolean;
}

// ── Building footprints ────────────────────────────────────────────────────
// Two sources, merged: Regrid's `buildings` collection (returned in the SAME
// point response as the parcels — survey-matched footprints, no extra request)
// and OSM Overpass as a free fill-in for neighbours Regrid misses. OSM often
// carries height / building:levels tags; everything else gets a one-story default.

const DEFAULT_BUILDING_FT = 13; // single-story walls + eave, in feet
const FT_PER_M = 3.28084;
const OSM_RADIUS_M = 130; // ≈ 425 ft — the subject lot + immediate neighbours
const MAX_BUILDINGS = 40;

function heightFromTags(tags: Record<string, unknown> | undefined): number {
  return taggedHeight(tags) ?? DEFAULT_BUILDING_FT;
}

/** The height a real tag states, in feet; undefined when nothing is tagged. */
function taggedHeight(tags: Record<string, unknown> | undefined): number | undefined {
  if (!tags) return undefined;
  // OSM `height` is metres by default; honour an explicit ft/' suffix.
  const h = tags["height"];
  if (typeof h === "string" || typeof h === "number") {
    const s = String(h);
    const n = parseFloat(s);
    if (Number.isFinite(n) && n > 0) return /'|ft/i.test(s) ? n : n * FT_PER_M;
  }
  const levels = parseFloat(String(tags["building:levels"] ?? ""));
  if (Number.isFinite(levels) && levels > 0) return levels * 10 + 3; // 10 ft/story + roof structure
  return undefined;
}

function regridBuildings(data: RegridResponse): BuildingRing[] {
  const feats = data.buildings?.features ?? [];
  const out: BuildingRing[] = [];
  for (const f of feats) {
    const ring = outerRing(f?.geometry);
    if (ring.length >= 3) out.push({ ring, heightFt: heightFromTags(f?.properties), heightTagged: taggedHeight(f?.properties) !== undefined });
  }
  return out;
}

interface OverpassElement {
  type?: string;
  geometry?: Array<{ lat?: number; lon?: number }>;
  tags?: Record<string, unknown>;
}

// ── Streets ────────────────────────────────────────────────────────────────
// Which side of a lot faces the street is decided by where the ROAD is, and OSM
// already has the road centrelines. They ride along in the SAME Overpass query
// the building footprints use — one round trip, one bbox, no extra service.

/** OSM `highway` values that are not a street a fence would front onto. A
 *  `service` way counts only when it is a driveway: an alley or a parking aisle
 *  behind a lot would otherwise read as its frontage. */
const NON_STREET_HIGHWAYS = new Set([
  "footway",
  "path",
  "cycleway",
  "steps",
  "track",
  "bridleway",
  "corridor",
  "pedestrian",
  "proposed",
  "construction",
  "raceway",
  "platform",
]);

function isStreet(tags: Record<string, unknown> | undefined): boolean {
  const h = tags?.["highway"];
  if (typeof h !== "string" || NON_STREET_HIGHWAYS.has(h)) return false;
  if (h === "service") return String(tags?.["service"] ?? "") === "driveway";
  return true;
}

const MAX_ROADS = 40;

// Best-effort — it fails soft to empty and never blocks the parcel result for
// long. An answer is remembered for the point (lib/overpassStore): the same
// address asked again reads it back and nothing leaves the server.
export async function fetchOsmContext(
  lat: number,
  lng: number,
): Promise<{ buildings: BuildingRing[]; roads: RoadLine[] }> {
  const empty = { buildings: [] as BuildingRing[], roads: [] as RoadLine[] };
  try {
    const kept = await readOsmPoint<{ buildings: BuildingRing[]; roads: RoadLine[] }>(lat, lng);
    if (kept && Array.isArray(kept.buildings) && Array.isArray(kept.roads)) return kept;
    // One union query: footprints AND street centrelines in the same bbox.
    const q =
      // the server-side cap; how long WE wait is lib/overpass's budget
      `[out:json][timeout:10];(` +
      `way["building"](around:${OSM_RADIUS_M},${lat},${lng});` +
      `way["highway"](around:${OSM_RADIUS_M},${lat},${lng});` +
      `);out geom ${(MAX_BUILDINGS + MAX_ROADS) * 2};`;
    // The main host, then the fallbacks, inside one 12 s budget — see lib/overpass.
    const { data } = await askOverpass<{ elements?: OverpassElement[] }>(q);
    if (!data) return empty;
    const buildings: BuildingRing[] = [];
    const roads: RoadLine[] = [];
    for (const el of data.elements ?? []) {
      if (el.type !== "way" || !Array.isArray(el.geometry)) continue;
      const pts: Array<[number, number]> = [];
      for (const g of el.geometry) {
        if (typeof g?.lat === "number" && typeof g?.lon === "number") pts.push([g.lat, g.lon]);
      }
      if (isStreet(el.tags)) {
        // A centreline needs two points to be a line at all.
        if (pts.length >= 2 && roads.length < MAX_ROADS) {
          const name = el.tags?.["name"];
          roads.push({ name: typeof name === "string" ? name : null, points: pts });
        }
        continue;
      }
      if (el.tags?.["building"] === undefined) continue;
      if (pts.length >= 3) {
        buildings.push({
          ring: pts.map(([la, ln]) => ({ lat: la, lng: ln })),
          heightFt: heightFromTags(el.tags),
          heightTagged: taggedHeight(el.tags) !== undefined,
        });
      }
    }
    // A place with neither a building nor a street within 130 m is a lookup
    // that went wrong more often than it is a real place: not remembered.
    if (buildings.length || roads.length) await writeOsmPoint(lat, lng, { buildings, roads });
    return { buildings, roads };
  } catch {
    return empty;
  }
}

function centroid(ring: LatLngPoint[]): LatLngPoint {
  let lat = 0;
  let lng = 0;
  for (const p of ring) {
    lat += p.lat;
    lng += p.lng;
  }
  return { lat: lat / ring.length, lng: lng / ring.length };
}

// Regrid footprints win; OSM ones are kept only where no Regrid footprint
// already covers that spot (centroid-in-ring test — cheap and good enough at
// house scale). Result is capped to the nearest MAX_BUILDINGS.
function mergeBuildings(primary: BuildingRing[], fill: BuildingRing[], lat: number, lng: number): BuildingRing[] {
  const merged = [...primary];
  for (const b of fill) {
    const c = centroid(b.ring);
    if (!primary.some((p) => pointInRing(c.lat, c.lng, p.ring))) merged.push(b);
  }
  const dist = (b: BuildingRing) => {
    const c = centroid(b.ring);
    return (c.lat - lat) ** 2 + (c.lng - lng) ** 2;
  };
  return merged.sort((a, b) => dist(a) - dist(b)).slice(0, MAX_BUILDINGS);
}

/**
 * Site context for a point: the Regrid parcel ring (when a key is configured),
 * nearby building footprints, and the STREET centrelines around the lot.
 *
 * `roads` is the signal the fence studio uses to decide which side of a parcel
 * faces the street. It is independent of `ok`: a Regrid failure says nothing
 * about OSM, and the front-side decision must not be collateral damage.
 */

export type BoundaryLookupResult =
  | { ok: true; ring: LatLngPoint[]; buildings: BuildingRing[]; roads: RoadLine[] }
  | { ok: false; error: string; buildings: BuildingRing[]; roads: RoadLine[] };

/** The lot the pin is in, its buildings and its streets — the lookups themselves. */
export async function lookupPropertyBoundary(lat: number, lng: number): Promise<BoundaryLookupResult> {
  // Three independent lookups, and they stay independent: OSM context, the
  // parcel, and Regrid footprints. A failure in any one must not take the other
  // two down — the front-side decision in particular is derived from `roads`
  // and has to survive a parcel outage.
  const osmPromise = fetchOsmContext(lat, lng);
  // Footprints only, and only if a Regrid key happens to still be valid. Its
  // rejection is swallowed: OSM covers this, and an expired Regrid token is no
  // longer a reason to tell anyone anything.
  const regridPromise = isRegridEnabled()
    ? fetchRegridPoint(lat, lng).catch(() => ({ data: null, status: 0 }))
    : Promise.resolve({ data: null as RegridResponse | null, status: 0 });

  const parcel = await lookupParcelByPoint(lat, lng);
  const [osm, regrid] = await Promise.all([
    osmPromise.catch(() => ({ buildings: [], roads: [] })),
    regridPromise,
  ]);
  const buildings = mergeBuildings(
    regrid.data ? regridBuildings(regrid.data) : [],
    osm.buildings,
    lat,
    lng,
  );

  if (!parcel.ok) {
    const error =
      parcel.reason === "disabled"
        ? "Set REPORTALL_CLIENT_KEY in .env.local to load property lines (get a key at reportallusa.com)."
        : parcel.reason === "not-found"
          ? "No parcel found here — this county may not be covered. Drop the pin inside the lot, or draw the fence manually."
          : (parcel.error ?? "Failed to load property lines.");
    return { ok: false, error, buildings, roads: osm.roads };
  }

  // The FIRST outer ring. A MULTIPOLYGON parcel is usually one lot recorded in
  // parts; the studio traces a single boundary, and the ring containing the
  // dropped pin is the one the user meant.
  const rings = parcel.parcel.rings;
  // parseWkt emits [lat, lng] tuples; the studio speaks { lat, lng }.
  const toLatLng = (r: (typeof rings)[number]): LatLngPoint[] =>
    r.map(([pLat, pLng]) => ({ lat: pLat, lng: pLng }));
  const hit = rings.find((r) => pointInRing(lat, lng, toLatLng(r)));
  const ring: LatLngPoint[] = toLatLng(hit ?? rings[0] ?? []);

  if (ring.length < 3) {
    return {
      ok: false,
      error:
        "The parcel came back without a usable boundary. Drop the pin inside the lot, or draw the fence manually.",
      buildings,
      roads: osm.roads,
    };
  }
  return { ok: true, ring, buildings, roads: osm.roads };
}
