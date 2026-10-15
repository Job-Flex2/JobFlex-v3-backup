// Synthetic check of the Regrid record reader — no network.
//   npx tsx --tsconfig tsconfig.json qa/tests/logic/hvac-regrid.check.ts
import { regridFields, regridRecordOf } from "../../../src/lib/hvac/regridRecord";

let failures = 0;
let passes = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) passes++;
  else failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

const resp = { parcels: { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Polygon", coordinates: [] }, properties: { headline: "6232 195TH AVE SE", path: "/us/wa/snohomish/snohomish/12345", fields: { yearbuilt: 1996, numstories: "1.5", recrdareno: "2,210", area_building: 2655, structstyle: "Single Family", usedesc: "Residential", ll_bldg_count: 2, ll_bldg_footprint_sqft: 2655 } } }] } };
const r = regridRecordOf(resp as never)!;
ok("Fields found under properties.fields", regridFields(resp as never)?.yearbuilt === 1996);
ok("Year built, fractional storeys, recorded area first", r.yearBuilt === 1996 && r.storeys === 1.5 && r.livingSqft === 2210 && r.areaField === "recrdareno", JSON.stringify(r));
ok("Building count, style and use", r.buildingCount === 2 && r.structStyle === "Single Family" && r.useDesc === "Residential");
const r2 = regridRecordOf({ parcels: { features: [{ properties: { fields: { yearbuilt: "0", numstories: null, recrdareno: "", area_building: "1,900" } } }] } } as never)!;
ok("Falls back to area_building; zero year is no year", r2.livingSqft === 1900 && r2.areaField === "area_building" && r2.yearBuilt === undefined && r2.storeys === undefined);
ok("Flat properties (no fields wrapper) still read", regridRecordOf({ features: [{ properties: { yearbuilt: 1978 } }] } as never)?.yearBuilt === 1978);
ok("Empty / missing → null", regridRecordOf({ parcels: { features: [] } } as never) === null && regridRecordOf(null) === null && regridRecordOf({ parcels: { features: [{ properties: { fields: { foo: 1 } } }] } } as never) === null);
ok("Out-of-range area ignored", regridRecordOf({ parcels: { features: [{ properties: { fields: { recrdareno: 50, area_building: 90000 } } }] } } as never) === null);

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
