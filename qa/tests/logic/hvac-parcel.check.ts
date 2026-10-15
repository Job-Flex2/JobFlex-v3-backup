// Synthetic check of the parcel record → site facts path — no network.
//   npx tsx --tsconfig tsconfig.json qa/tests/logic/hvac-parcel.check.ts
// ReportAll's row (with the assessor fields the client now reads) maps to a
// Parcel; buildings_poly is read as WKT strings, {geom_as_wkt} objects or
// GeoJSON; the intake takes the record's living area over footprint × storeys.
import { buildingsWktOf, parcelFromRaw } from "../../../src/lib/reportall";
import { modelFromSite } from "../../../src/lib/hvac/intake";

let failures = 0;
let passes = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) passes++;
  else failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

const raw = {
  robust_id: "WA-1", parcel_id: "00512300", owner: "MORGAN ALEX", address: "6232 9TH ST NE", addr_city: "LAKE STEVENS", addr_zip: "98258",
  acreage_calc: "0.21", geom_as_wkt: "POLYGON((-122.1002 48.0038,-122.1000 48.0038,-122.1000 48.0040,-122.1002 48.0040,-122.1002 48.0038))",
  latitude: "48.00385", longitude: "-122.1001",
  bldg_sqft: "2,140", year_built: "1998", story_height: "2", buildings: "1", county_name: "Snohomish", state_abbr: "wa", land_use_class: "Residential",
  buildings_poly: ["POLYGON((-122.10015 48.00385,-122.10005 48.00385,-122.10005 48.00395,-122.10015 48.00395,-122.10015 48.00385))"],
};
const p = parcelFromRaw(raw as never)!;
ok("Record fields mapped", p.bldgSqft === 2140 && p.yearBuilt === 1998 && p.storeys === 2 && p.buildingCount === 1 && p.countyName === "Snohomish" && p.stateAbbr === "WA" && p.landUseClass === "Residential", JSON.stringify({ b: p.bldgSqft, y: p.yearBuilt, s: p.storeys }));
ok("buildings_poly as WKT strings", p.buildingsWkt.length === 1 && p.buildingsWkt[0].startsWith("POLYGON"));
ok("Old-style row (no record fields) still maps with nulls", (() => { const q = parcelFromRaw({ robust_id: "x", geom_as_wkt: "POLYGON((0 0,1 0,1 1,0 0))" } as never)!; return q.bldgSqft === null && q.yearBuilt === null && q.buildingsWkt.length === 0; })());
ok("Bad years and zero sqft are nulls", (() => { const q = parcelFromRaw({ ...raw, year_built: "0", bldg_sqft: "0" } as never)!; return q.yearBuilt === null && q.bldgSqft === null; })());
ok("buildings_poly as {geom_as_wkt} objects", buildingsWktOf([{ geom_as_wkt: "POLYGON((0 0,1 0,1 1,0 0))" }]).length === 1);
ok("buildings_poly as GeoJSON polygon", buildingsWktOf([{ type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }])[0] === "POLYGON((0 0,1 0,1 1,0 0))", buildingsWktOf([{ type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }])[0]);
ok("buildings_poly as GeoJSON multipolygon and feature", buildingsWktOf({ type: "MultiPolygon", coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]], [[[2, 2], [3, 2], [3, 3], [2, 2]]]] }).length === 2 && buildingsWktOf([{ geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } }]).length === 1);
ok("buildings_poly as a JSON string", buildingsWktOf('{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]}').length === 1);
ok("buildings_poly missing → none", buildingsWktOf(undefined).length === 0 && buildingsWktOf(null).length === 0);

// intake: the record's living area wins over footprint × storeys
const m = modelFromSite({ address: "6232 9th St NE, Lake Stevens, WA 98258", state: "WA", county: "Snohomish", livingSqft: 2140, footprintSqft: 1300, storeys: 2, yearBuilt: 1998, sources: { living: "county parcel record", storeys: "county parcel record: 2 storeys", yearBuilt: "county parcel record" } });
ok("Living area from the record, badged read/high", m.conditionedSqft === 2140 && m.provenance.conditionedSqft.source === "read" && m.provenance.conditionedSqft.confidence === "high", `${m.conditionedSqft} ${m.provenance.conditionedSqft.source}`);
ok("Storeys from the record are read/high", m.storeys === 2 && m.provenance.storeys.source === "read" && m.provenance.storeys.confidence === "high");
ok("Year built from the record", m.yearBuilt === 1998 && m.provenance.yearBuilt.source === "read");
ok("1998 era defaults follow", m.windowType === "double" && m.wallInsulation === "r13", `${m.windowType} ${m.wallInsulation}`);
const m2 = modelFromSite({ address: "x", state: "WA", footprintSqft: 1300, storeys: 2, sources: { storeys: "building height 22 ft" } });
ok("Without a record: footprint × storeys, measured/medium", m2.conditionedSqft === 2600 && m2.provenance.conditionedSqft.source === "measured" && m2.provenance.storeys.source === "measured");

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
