// Synthetic check of the county assessor layer registry — no network.
//   npx tsx --tsconfig tsconfig.json qa/tests/logic/hvac-assessors.check.ts
// (The live smoke test against the real county services is
//   npx tsx --tsconfig tsconfig.json qa/tests/logic/hvac-assessors.live.ts)
import { ASSESSOR_LAYERS, assessorLayerFor, pickNearest, recordFromAttributes, storeysFromStyle } from "../../../src/lib/hvac/assessors";

let failures = 0;
let passes = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) passes++;
  else failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};
const layer = (key: string) => ASSESSOR_LAYERS.find((l) => l.key === key)!;

ok("Skagit resolves with or without 'County'", assessorLayerFor("WA", "Skagit County")?.key === "WA:Skagit" && assessorLayerFor("wa", "skagit")?.key === "WA:Skagit");
ok("Six WA counties registered", ["WA:Skagit", "WA:King", "WA:Whatcom", "WA:Clark", "WA:Thurston", "WA:Snohomish"].every((k) => ASSESSOR_LAYERS.some((l) => l.key === k)));
ok("Unknown county → null", assessorLayerFor("WA", "Pierce") === null && assessorLayerFor("TX", "Skagit") === null && assessorLayerFor("WA", undefined) === null);

const cases: Array<[string, number | undefined]> = [
  // Skagit
  ["ONE STORY", 1], ["TWO STORY", 2], ["THREE STORY", 3], ["1 & 1/2 STORY", 1.5], ["1 STRY FIN BSMT", 1], ["1.5 STRY FIN BSMT", 1.5], ["2 STRY UNDEV BSMT", 2], ["2.5", 2.5], ["2.5 STY FIN BSMT", 2.5], ["3 STRY FIN BSMT", 3], ["1B", 1], ["1.5B", 1.5], ["2B", 2], ["SPLIT ENTRY", 2], ["BI OR SPLIT LEVEL ENTRY", 2], ["TRI LEVEL", 2], ["SINGLE FAMILY RESIDENCE", undefined], ["DOUBLE WIDE", undefined], ["", undefined],
  // Whatcom (space-padded to 5)
  ["1 STY", 1], ["2 STY", 2], ["1&H F", 1.5], ["1&H U", 1.5], ["BI/LV", 2], ["D1STY", 1], ["D2STY", 2], ["D1&HF", 1.5], ["F1.5F", 1.5], ["T2STY", 2], ["CNDO ", undefined], ["C-MUR", undefined], ["SG MH", undefined],
  // Clark
  ["RANCH", 1], ["2 STORY", 2], ["1 1/2 STORY", 1.5],
  // Snohomish recent sales
  ["1 Sty", 1], ["2 Sty", 2], ["Dbl Wide", undefined],
];
const bad = cases.filter(([s, want]) => storeysFromStyle(s) !== want).map(([s, want]) => `${JSON.stringify(s)}→${storeysFromStyle(s)}≠${want}`);
ok("Style strings → storeys across the four vocabularies", bad.length === 0, bad.join(", "));

const r = recordFromAttributes(layer("WA:Skagit"), { PNumber: "P72695", YearBuilt: "1912", EffYearBuilt: "1988", LivingArea: "1255", GarageSqFt: "440", BuildingStyle: "1 & 1/2 STORY", LandUse: "(111) HOUSEHOLD SFR" })!;
ok("Skagit attributes → record", r.yearBuilt === 1912 && r.livingSqft === 1255 && r.storeys === 1.5 && r.landUse === "(111) HOUSEHOLD SFR" && r.parcelId === "P72695" && /Skagit/.test(r.source), JSON.stringify(r));
ok("Vacant lot → null", recordFromAttributes(layer("WA:Skagit"), { YearBuilt: null, LivingArea: "0", BuildingStyle: null }) === null);
ok("Garage-only area under 200 is ignored", recordFromAttributes(layer("WA:Skagit"), { YearBuilt: "2001", LivingArea: "120" })?.livingSqft === undefined);
const k = recordFromAttributes(layer("WA:King"), { PIN: "2825059063", YrBuilt: 1977, SqFtTotLiv: 2160, Stories: 1.5, BldgNbr: 1, SITETYPE_D: "Single Family" })!;
ok("King attributes → record with numeric storeys", k.yearBuilt === 1977 && k.livingSqft === 2160 && k.storeys === 1.5 && k.buildingCount === 1 && k.landUse === "Single Family" && k.parcelId === "2825059063");
const w = recordFromAttributes(layer("WA:Whatcom"), { prop_id: 51019, yr_blt: 1974, sqft_la: 876.0, imprv_type: "1&H F", property_use_cd: "1112" })!;
ok("Whatcom attributes → record", w.yearBuilt === 1974 && w.livingSqft === 876 && w.storeys === 1.5 && w.parcelId === "51019");
const c = recordFromAttributes(layer("WA:Clark"), { Prop_id: 91057124, BldgYrBlt: 1975, BldgSqft: 1875, BldgStyle: "RANCH", BldgCount: 1, PropertyUseClass: "Rural Residential" })!;
ok("Clark attributes → record", c.yearBuilt === 1975 && c.livingSqft === 1875 && c.storeys === 1 && c.buildingCount === 1);
const t = recordFromAttributes(layer("WA:Thurston"), { PARCEL_NO: "09450002001", YEAR_BUILT: "1993", USE_CODE: "11" })!;
ok("Thurston: year built only", t.yearBuilt === 1993 && t.livingSqft === undefined && t.storeys === undefined);
const s = recordFromAttributes(layer("WA:Snohomish"), { PARCEL_ID: "00839200003600", YEAR_BUILT: "1996", STYLE: "2 Sty", PROP_CLASS: "111" })!;
ok("Snohomish recent sale: year built + storeys", s.yearBuilt === 1996 && s.storeys === 2);

// nearest address point wins on the King point layer
const near = pickNearest(layer("WA:King"), [
  { attributes: { LAT: 47.6181, LON: -122.1652, ADDR_FULL: "far" } },
  { attributes: { LAT: 47.61801, LON: -122.16501, ADDR_FULL: "near" } },
  { attributes: { ADDR_FULL: "no coords" } },
], 47.6180, -122.1650);
ok("Nearest point by LAT/LON attributes", near?.attributes?.ADDR_FULL === "near");
ok("Falls back to geometry when attributes lack coords", pickNearest(layer("WA:King"), [{ attributes: {}, geometry: { x: -122.1650, y: 47.6180 } }], 47.618, -122.165)?.geometry?.y === 47.618);
ok("No features → null", pickNearest(layer("WA:King"), [], 47.6, -122.1) === null);

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
