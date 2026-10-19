import "server-only";
// READING A PROPERTY FROM ITS ADDRESS (2026-10-18). The address → the point (Google, else the Census geocoder) → the
// lot and its buildings from the county records (ReportAll, cache first) → the newest USDA aerial photo over it, the
// trees' heights and the ground's slope (USGS 3DEP lidar), fetched side by side → every pixel classed → the yard's
// numbers. With no parcel, a quarter-acre square around the point stands in, flagged red, for the contractor to drag.
import { geocodePlace } from "@/lib/maps";
import { censusGeocode, countyAtPoint } from "@/lib/hvac/publicGeo";
import { lookupParcelByPoint } from "@/lib/parcelLookup";
import { locationIndex } from "@/lib/estimate/location-index";
import { resolveStateCode, stateFromAddress } from "@/lib/pricing/salesTax";
import { sample3depElevations } from "@/lib/elevation3dep";
import type { LatLng } from "./geo";
import { boxAround, boxOfRings, fillRings, fromPx, ftPerPx, gridFor, M_TO_FT, mercScale, toMerc, fromMerc, toPx } from "./geo";
import { classify, CLS } from "./classify";
import { findHouse, slopeBands, type SlopeBands } from "./measure";
import { findPhoto, readCanopy, readPhoto, readStructures } from "./aerial";
import { encodeLabels, type LawnSite } from "./site";

export type ReadInput = { address?: string | null; lat?: number | null; lng?: number | null; /** The contractor's own lot line. */ ring?: LatLng[] | null };

export class ReadError extends Error {}

/** The house the address means: an address geocoded to the street's centreline (the Census geocoder interpolates
 *  along it) is moved onto the building — the one whose address has the same house number within 60 m, else the
 *  nearest home. Null when there's no building to go by. */
export async function snapToHouse(p: LatLng, address: string): Promise<{ at: LatLng; ring: LatLng[] } | null> {
  const box = boxAround(p, 60);
  const sw = fromMerc({ x: box[0], y: box[1] });
  const ne = fromMerc({ x: box[2], y: box[3] });
  const all = await readStructures({ west: sw.lng, south: sw.lat, east: ne.lng, north: ne.lat });
  if (!all.length) return null;
  const number = address.match(/^\s*(\d+)/)?.[1] ?? null;
  const centre = (r: LatLng[]) => ({ lat: r.reduce((s, q) => s + q.lat, 0) / r.length, lng: r.reduce((s, q) => s + q.lng, 0) / r.length });
  const dist = (a: LatLng, b: LatLng) => Math.hypot((a.lat - b.lat) * 111320, (a.lng - b.lng) * 111320 * Math.cos((a.lat * Math.PI) / 180));
  const homes = all.filter((s) => s.residential && (s.sqft ?? 1000) >= 450);
  const byNumber = number ? homes.filter((s) => s.address && s.address.split(/\s+/)[0] === number) : [];
  const pool = byNumber.length ? byNumber : homes;
  const best = pool.map((s) => ({ s, c: centre(s.ring) })).sort((a, b) => dist(a.c, p) - dist(b.c, p))[0];
  if (!best || (!byNumber.length && dist(best.c, p) > 45)) return null;
  return { at: best.c, ring: best.s.ring };
}

/** A lot around a house when the county has none: its footprint's box and 30 ft of yard all round. */
function lotAroundHouse(house: LatLng[], yardFt = 30): LatLng[] {
  const m = house.map(toMerc);
  const lat = house[0].lat;
  const pad = (yardFt / M_TO_FT) / mercScale(lat);
  const x0 = Math.min(...m.map((q) => q.x)) - pad;
  const x1 = Math.max(...m.map((q) => q.x)) + pad;
  const y0 = Math.min(...m.map((q) => q.y)) - pad;
  const y1 = Math.max(...m.map((q) => q.y)) + pad;
  return [
    { x: x0, y: y1 },
    { x: x1, y: y1 },
    { x: x1, y: y0 },
    { x: x0, y: y0 },
  ].map(fromMerc);
}

/** A square lot of `sideFt` around a point, when the county has none. */
function assumedLot(p: LatLng, sideFt = 104): LatLng[] {
  const c = toMerc(p);
  const h = ((sideFt / M_TO_FT) / 2) / mercScale(p.lat);
  return [
    { x: c.x - h, y: c.y + h },
    { x: c.x + h, y: c.y + h },
    { x: c.x + h, y: c.y - h },
    { x: c.x - h, y: c.y - h },
  ].map(fromMerc);
}

/** Bare-earth elevations on an `stepFt` grid over the lot's box; only lawn cells count for the slope. */
async function readSlope(grid: ReturnType<typeof gridFor>, labels: Uint8Array, lot: Uint8Array): Promise<{ slope: SlopeBands; ok: boolean }> {
  const fpp = ftPerPx(grid);
  let x0 = grid.w;
  let y0 = grid.h;
  let x1 = 0;
  let y1 = 0;
  for (let y = 0; y < grid.h; y++)
    for (let x = 0; x < grid.w; x++)
      if (lot[y * grid.w + x]) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
  if (x1 <= x0 || y1 <= y0) return { slope: slopeBands(null, 0, 0, 1), ok: false };
  let stepFt = 8;
  const span = Math.max((x1 - x0) * fpp, (y1 - y0) * fpp);
  if ((span / stepFt) ** 2 > 400) stepFt = span / 20;
  const stepPx = stepFt / fpp;
  const cols = Math.max(2, Math.floor((x1 - x0) / stepPx) + 1);
  const rows = Math.max(2, Math.floor((y1 - y0) / stepPx) + 1);
  const pts: LatLng[] = [];
  const isLawn: boolean[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const px = { x: x0 + c * stepPx, y: y0 + r * stepPx };
      pts.push(fromPx(grid, px));
      const k = Math.min(grid.h - 1, Math.floor(px.y)) * grid.w + Math.min(grid.w - 1, Math.floor(px.x));
      isLawn.push(labels[k] === CLS.LAWN && !!lot[k]);
    }
  const res = await sample3depElevations(pts).catch(() => ({ ok: false as const, reason: "error" as const }));
  if (!res.ok) return { slope: slopeBands(null, 0, 0, 1), ok: false };
  // Only lawn-to-lawn neighbours: a step at the house or a retaining wall isn't the lawn's slope.
  const elev = res.elevFt.map((z, i) => (isLawn[i] ? z : NaN));
  return { slope: slopeBands(elev, cols, rows, stepFt), ok: true };
}

export async function readProperty(inp: ReadInput): Promise<LawnSite> {
  let lat = Number.isFinite(inp.lat) ? Number(inp.lat) : NaN;
  let lng = Number.isFinite(inp.lng) ? Number(inp.lng) : NaN;
  let address = inp.address?.trim() ?? "";
  let state: string | null = null;
  let county: string | null = null;
  let place = "";
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    if (!address) throw new ReadError("Type the client's address.");
    const g = (await geocodePlace(address).catch(() => null)) ?? (await censusGeocode(address).catch(() => null));
    if (!g) throw new ReadError("That address wasn't found — check the spelling, the city and the state.");
    lat = g.lat;
    lng = g.lng;
    state = resolveStateCode(g.state ?? null) ?? stateFromAddress(address);
    county = g.county ?? null;
    place = [g.city, state].filter(Boolean).join(", ");
    if ("formatted" in g && typeof g.formatted === "string" && g.formatted) address = g.formatted;
  }
  if (lat < 17 || lat > 72 || lng > -64) throw new ReadError("The lawn estimator works in the United States only.");
  // Onto the house itself — the county's lot lookup and the stand-in lot both go by it.
  const house = address && !inp.ring ? await snapToHouse({ lat, lng }, address).catch(() => null) : null;
  if (house) {
    lat = house.at.lat;
    lng = house.at.lng;
  }

  // The lot and its buildings, from the county's records.
  let ring: LatLng[] | null = inp.ring && inp.ring.length >= 3 ? inp.ring : null;
  let source: "parcel" | "assumed" = ring ? "parcel" : "assumed";
  let buildings: LatLng[][] = [];
  let parcelId: string | null = null;
  let acreage: number | null = null;
  let stories: number | null = null;
  const parcel = await lookupParcelByPoint(lat, lng, { withRecord: true }).catch(() => null);
  if (parcel?.ok) {
    const p = parcel.parcel;
    if (!ring && p.rings[0]?.length >= 3) {
      ring = p.rings[0].map(([la, lo]) => ({ lat: la, lng: lo }));
      source = "parcel";
    }
    buildings = (p.buildings ?? []).filter((b) => b.length >= 3).map((b) => b.map(([la, lo]) => ({ lat: la, lng: lo })));
    parcelId = p.parcelId;
    acreage = p.acreage;
    stories = p.storeys;
    state = state ?? resolveStateCode(p.stateAbbr ?? null);
    county = county ?? p.countyName ?? null;
    if (!address && p.address) address = [p.address, p.city, p.stateAbbr].filter(Boolean).join(", ");
    if (!place) place = [p.city, p.stateAbbr].filter(Boolean).join(", ");
  }
  if (!ring) ring = house ? lotAroundHouse(house.ring) : assumedLot({ lat, lng });
  if (!state) state = stateFromAddress(address);
  if (!state) {
    const c = await countyAtPoint(lat, lng).catch(() => null);
    state = resolveStateCode(c?.state ?? null);
    county = county ?? c?.county ?? null;
    if (!place && c) place = `${c.county}, ${state ?? c.state}`;
  }
  if (!county && (state === "FL" || state === "MD")) county = (await countyAtPoint(lat, lng).catch(() => null))?.county ?? null;
  const loc = locationIndex(address || place);

  // The photo, the trees' height, on one grid around the lot.
  const box = boxOfRings([ring], 14, lat);
  const photo = await findPhoto({ lat, lng }).catch(() => null);
  if (!photo) throw new ReadError("There's no USDA aerial photo of this address yet.");
  const grid = gridFor(box, Math.min(0.3, photo.gsdM), lat, 1100);
  const sw = fromMerc({ x: box[0], y: box[1] });
  const ne = fromMerc({ x: box[2], y: box[3] });
  const [pix, chm, structures] = await Promise.all([readPhoto(photo, grid), readCanopy(grid, { lat, lng }), buildings.length ? Promise.resolve([]) : readStructures({ west: sw.lng, south: sw.lat, east: ne.lng, north: ne.lat })]);
  let footprintSource: "county" | "usa-structures" | null = buildings.length ? "county" : null;
  if (!buildings.length && structures.length) {
    buildings = structures.map((s) => s.ring);
    footprintSource = "usa-structures";
  }
  const lotPx = ring.map((p) => toPx(grid, p));
  const lot = fillRings(grid.w, grid.h, [lotPx]);
  const bmask = buildings.length ? fillRings(grid.w, grid.h, buildings.map((b) => b.map((p) => toPx(grid, p)))) : null;
  const { labels } = classify({ raster: { w: grid.w, h: grid.h, gsdM: grid.gsdM, rgb: pix.rgb, nir: pix.nir, chm }, lot, buildings: bmask });
  if (!bmask) findHouse(labels, lot, grid);
  const { slope, ok: lidar } = await readSlope(grid, labels, lot);
  const encoded = encodeLabels(labels);
  return {
    v: 1,
    address,
    lat,
    lng,
    state,
    county,
    place: place || loc.place,
    locationFactor: loc.factor,
    photo: { itemId: photo.id, date: photo.date, gsdM: photo.gsdM },
    grid: { box: grid.box, w: grid.w, h: grid.h, gsdM: grid.gsdM, lat },
    lot: { ring, source, parcelId, acreage, stories },
    labels: encoded,
    readLabels: encoded,
    slope,
    sources: { parcel: source === "parcel", footprints: !!bmask, footprintSource, canopyMap: !!chm, lidar },
    readAt: new Date().toISOString(),
  };
}
