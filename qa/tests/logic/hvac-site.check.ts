// Synthetic check of the HVAC site geometry — no network, no browser.
//   npx tsx --tsconfig tsconfig.json qa/tests/logic/hvac-site.check.ts
import { pickBuilding, pointInRing, ringGeometry, storeysFromHeight } from "../../../src/lib/hvac/site";

let failures = 0;
let passes = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) passes++;
  else failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

// A 100 ft × 60 ft house near Frisco, TX (33.15 N): 1 ft of latitude is
// 1/364000 °, 1 ft of longitude is that ÷ cos(33.15°).
const lat0 = 33.15;
const lng0 = -96.82;
const dLat = 1 / 364000;
const dLng = dLat / Math.cos((lat0 * Math.PI) / 180);
const house = [
  { lat: lat0, lng: lng0 },
  { lat: lat0, lng: lng0 + 100 * dLng },
  { lat: lat0 + 60 * dLat, lng: lng0 + 100 * dLng },
  { lat: lat0 + 60 * dLat, lng: lng0 },
];
const g = ringGeometry(house);
ok("Area of a 100 × 60 ft ring", Math.abs(g.areaSqft - 6000) <= 30, String(g.areaSqft));
ok("Perimeter 320 ft", Math.abs(g.perimeterFt - 320) <= 2, String(g.perimeterFt));
// The walls FACE south, east, north, west (the ring is traced from the south-west corner eastward): the outward normal, not the direction of travel.
ok("Four walls facing S, E, N, W", g.edges.length === 4 && g.edges.map((e) => e.bearingDeg).join(",") === "180,90,0,270", g.edges.map((e) => e.bearingDeg).join(","));
ok("Wall lengths", g.edges.map((e) => Math.round(e.lengthFt)).join(",") === "100,60,100,60", g.edges.map((e) => e.lengthFt).join(","));
ok("Degenerate ring → zeros", ringGeometry([house[0], house[1]]).areaSqft === 0);
ok("Point inside", pointInRing(lat0 + 30 * dLat, lng0 + 50 * dLng, house));
ok("Point outside", !pointInRing(lat0 + 90 * dLat, lng0 + 50 * dLng, house));

const shed = house.map((p) => ({ lat: p.lat + 200 * dLat, lng: p.lng }));
const picked = pickBuilding([{ ring: shed, heightFt: 10 }, { ring: house, heightFt: 22 }], lat0 + 30 * dLat, lng0 + 50 * dLng);
ok("Pin inside the house picks the house", picked?.inside === true && picked.building.heightFt === 22);
const near = pickBuilding([{ ring: shed, heightFt: 10 }, { ring: house, heightFt: 22 }], lat0 + 70 * dLat, lng0 + 50 * dLng);
ok("Pin just outside picks the nearest, flagged", near?.inside === false && near.building.heightFt === 22);
ok("No buildings → null", pickBuilding([], lat0, lng0) === null);
ok("Storeys from height: 22 ft → 2, 10 ft → 1, 40 ft → 3, none → undefined", storeysFromHeight(22) === 2 && storeysFromHeight(10) === 1 && storeysFromHeight(40) === 3 && storeysFromHeight(null) === undefined);

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
