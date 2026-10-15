// House outlines from Google's aerial building mask (2026-09-24): the UTM
// inverse that brings a raster corner back to lat/lng, every structure in a
// drawn mask found where it was drawn with the area it was drawn at, the
// speck under the floor dropped, and OSM's heights lent to the right roof.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/solar-houses.check.ts
import { latLngToUtm, parseUtmEpsg, utmEpsg, utmToLatLng, utmZoneFor } from "../../../src/lib/utm";
import { maskToHouses, withOsmHeights, DEFAULT_BUILDING_FT } from "../../../src/lib/solarHouses";
import type { Raster } from "../../../src/lib/solar";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const D2R = Math.PI / 180;
const metres = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
  Math.hypot((b.lng - a.lng) * D2R * Math.cos(a.lat * D2R) * 6378137, (b.lat - a.lat) * D2R * 6378137);

// ── UTM ─────────────────────────────────────────────────────────────────────
const points = [
  { name: "Seattle", lat: 47.6205, lng: -122.3493 },
  { name: "Miami", lat: 25.7617, lng: -80.1918 },
  { name: "Denver", lat: 39.7392, lng: -104.9903 },
  { name: "Sydney", lat: -33.8688, lng: 151.2093 },
];
const worst = Math.max(
  ...points.map((p) => {
    const z = utmZoneFor(p.lat, p.lng);
    const { e, n } = latLngToUtm(p.lat, p.lng, z);
    return metres(p, utmToLatLng(e, n, z));
  }),
);
check("lat/lng → UTM → lat/lng comes back within a millimetre on four continents' worth of points", worst < 0.001, `${(worst * 1000).toFixed(3)} mm`);
check("zones: Seattle is 10 N, Sydney is 56 S, EPSG codes round-trip", utmZoneFor(47.62, -122.35).zone === 10 && utmZoneFor(47.62, -122.35).north && utmZoneFor(-33.87, 151.21).zone === 56 && !utmZoneFor(-33.87, 151.21).north && utmEpsg({ zone: 56, north: false }) === 32756 && parseUtmEpsg(32610)?.zone === 10 && parseUtmEpsg(32610)?.north === true && parseUtmEpsg(4326) === null);
const onMeridian = latLngToUtm(47, -123, { zone: 10, north: true });
check("a point on the central meridian has the false easting exactly", Math.abs(onMeridian.e - 500000) < 1e-6 && onMeridian.n > 5.2e6 && onMeridian.n < 5.3e6, `${onMeridian.e.toFixed(6)} ${onMeridian.n.toFixed(1)}`);

// ── a drawn mask: a house under the pin, a garage 15 m east, a turned shed, a speck ──
const pin = { lat: 47.6205, lng: -122.3493 };
const zone = utmZoneFor(pin.lat, pin.lng);
const centre = latLngToUtm(pin.lat, pin.lng, zone);
const px = 0.1;
const w = 600;
const h = 600;
const data = new Float32Array(w * h);
const put = (col: number, row: number) => {
  if (col >= 0 && row >= 0 && col < w && row < h) data[row * w + col] = 1;
};
// house: 12 m × 9 m, centred on the tile centre
for (let r = 255; r < 345; r++) for (let c = 240; c < 360; c++) put(c, r);
// garage: 6 m × 6 m, centre 15 m east of the pin
for (let r = 270; r < 330; r++) for (let c = 420; c < 480; c++) put(c, r);
// shed: 10 m × 8 m turned 30°, centre 18 m north-west
const cx = 120;
const cy = 120;
const cosA = Math.cos(30 * D2R);
const sinA = Math.sin(30 * D2R);
for (let r = 40; r < 200; r++)
  for (let c = 40; c < 200; c++) {
    const dx = c + 0.5 - cx;
    const dy = r + 0.5 - cy;
    const u = dx * cosA + dy * sinA;
    const v = -dx * sinA + dy * cosA;
    if (Math.abs(u) <= 50 && Math.abs(v) <= 40) put(c, r);
  }
// a speck: 3 × 3 px, under the 100 sq ft floor
for (let r = 500; r < 503; r++) for (let c = 500; c < 503; c++) put(c, r);
const mask: Raster = { width: w, height: h, data, pixelSizeM: px, originX: centre.e - (w / 2) * px, originY: centre.n + (h / 2) * px, epsg: utmEpsg(zone) };

const houses = maskToHouses(mask, pin);
const centroidOf = (ring: Array<{ lat: number; lng: number }>) => ({ lat: ring.reduce((s, p) => s + p.lat, 0) / ring.length, lng: ring.reduce((s, p) => s + p.lng, 0) / ring.length });
const house = houses.find((x) => x.underPin);
const garage = houses.find((x) => !x.underPin && Math.abs(metres(pin, centroidOf(x.ring)) - 15) < 1.5);
const shed = houses.find((x) => x !== house && x !== garage);
check("three structures come back and the speck does not", houses.length === 3 && !!house && !!garage && !!shed, `${houses.length} · ${houses.map((x) => x.areaSqft).join(",")} sq ft`);
check("the house sits under the pin, its centroid within 0.3 m of it, at the area it was drawn (108 m² ≈ 1,163 sq ft)", !!house && metres(pin, centroidOf(house.ring)) < 0.3 && Math.abs(house.areaSqft - 1163) / 1163 < 0.06, house ? `${metres(pin, centroidOf(house.ring)).toFixed(2)} m · ${house.areaSqft} sq ft · ${house.ring.length} corners` : "none");
check("the house is a four-cornered box", !!house && house.ring.length === 4);
if (garage) {
  const c = centroidOf(garage.ring);
  const east = (c.lng - pin.lng) * D2R * Math.cos(pin.lat * D2R) * 6378137;
  const north = (c.lat - pin.lat) * D2R * 6378137;
  check("the garage is 15 m due east (grid north converted to true north on the way back)", Math.abs(east - 15) < 0.5 && Math.abs(north) < 0.5 && Math.abs(garage.areaSqft - 388) / 388 < 0.08, `east ${east.toFixed(2)} north ${north.toFixed(2)} · ${garage.areaSqft} sq ft`);
}
check("the turned shed keeps its area and its corners", !!shed && Math.abs(shed.areaSqft - 861) / 861 < 0.08 && shed.ring.length >= 4 && shed.ring.length <= 8, shed ? `${shed.areaSqft} sq ft · ${shed.ring.length} corners` : "none");
check("the house comes first, then the nearest", houses[0] === house && houses[1] === garage);

// ── heights from OSM ────────────────────────────────────────────────────────
const osmAround = (c: { lat: number; lng: number }, m: number, heightFt: number, tagged: boolean) => {
  const dLat = m / 6378137 / D2R;
  const dLng = m / (6378137 * Math.cos(c.lat * D2R)) / D2R;
  return { ring: [{ lat: c.lat - dLat, lng: c.lng - dLng }, { lat: c.lat - dLat, lng: c.lng + dLng }, { lat: c.lat + dLat, lng: c.lng + dLng }, { lat: c.lat + dLat, lng: c.lng - dLng }], heightFt, heightTagged: tagged };
};
const shedC = centroidOf(shed!.ring);
const near = { lat: shedC.lat + 4 / 6378137 / D2R, lng: shedC.lng }; // 4 m north of the shed, not covering it
const merged = withOsmHeights(houses, [osmAround(pin, 5, 23, true), osmAround(near, 1, 33, true)]);
check("OSM's height lands on the roof it covers, the nearest within 10 m lends its own, the rest default", merged[0].heightFt === 23 && merged[0].heightTagged === true && merged.find((x) => x.ring === garage!.ring)!.heightFt === DEFAULT_BUILDING_FT && merged.find((x) => x.ring === shed!.ring)!.heightFt === 33, merged.map((x) => x.heightFt).join(","));

console.log(bad ? `\n${bad} check(s) FAILED` : "\nall checks passed");
process.exit(bad ? 1 : 0);
