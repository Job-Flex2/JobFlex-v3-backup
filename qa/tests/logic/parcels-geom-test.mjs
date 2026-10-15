// Unit tests for src/lib/parcels.ts — parseWkt / segments / perimeterFt.
// No network, no framework: plain node asserts over a REAL fixture (the
// Microsoft Redmond parcel, robust_id AADPKaW0FvTJ_Xms, captured from a live
// ReportAll response on 2026-08-19; ~6.17 acres per the same response).
//
// Run:  node qa/tests/logic/parcels-geom-test.mjs
// (Node ≥23 strips the .ts types on import — no build step.)

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  parseWkt,
  segments,
  perimeterFt,
  bearingLabel,
  haversineFt,
  groupSides,
  polygonCentroid,
  detectFrontSides,
} from "../../../src/lib/parcels.ts";

const here = dirname(fileURLToPath(import.meta.url));
const wkt = readFileSync(join(here, "..", "_lib", "fixtures", "microsoft-parcel.wkt"), "utf8").trim();

let passed = 0;
function ok(name, fn) {
  fn();
  passed++;
  console.log("  ✓ " + name);
}

console.log("parseWkt — real MULTIPOLYGON fixture");
const rings = parseWkt(wkt);
ok("returns exactly one outer ring", () => assert.equal(rings.length, 1));
const ring = rings[0];
ok("ring has the response's 22 vertices (closing point trimmed)", () =>
  assert.equal(ring.length, 22));
ok("vertices are [lat, lng] (lat ≈ 47.64, lng ≈ −122.13)", () => {
  for (const [lat, lng] of ring) {
    assert.ok(lat > 47.6 && lat < 47.7, `lat out of band: ${lat}`);
    assert.ok(lng > -122.2 && lng < -122.1, `lng out of band: ${lng}`);
  }
});

console.log("segments / perimeterFt — the same ring");
const sides = segments(ring);
ok("one side per vertex (ring closes back to the start)", () =>
  assert.equal(sides.length, 22));
ok("every side has finite positive feet and a [0,360) bearing", () => {
  for (const s of sides) {
    assert.ok(Number.isFinite(s.feet) && s.feet > 0);
    assert.ok(s.bearing >= 0 && s.bearing < 360);
  }
});
ok("sides chain: each side's `to` is the next side's `from`", () => {
  for (let i = 0; i < sides.length; i++) {
    assert.deepEqual(sides[i].to, sides[(i + 1) % sides.length].from);
  }
});
const perim = perimeterFt(ring);
ok("perimeter equals the sum of the sides", () =>
  assert.ok(Math.abs(perim - sides.reduce((a, s) => a + s.feet, 0)) < 1e-6));
ok("perimeter is plausible for a 6.17-acre lot (1900–2900 ft)", () =>
  // A perfect 6.17-ac square is ≈2074 ft around; this lot is an L, so longer.
  assert.ok(perim > 1900 && perim < 2900, `perimeter ${perim}`));

console.log("holes and plain POLYGONs — synthetic");
ok("POLYGON with a hole keeps only the outer ring", () => {
  const r = parseWkt("POLYGON((0 0, 0.001 0, 0.001 0.001, 0 0.001, 0 0),(0.0002 0.0002, 0.0004 0.0002, 0.0004 0.0004, 0.0002 0.0002))");
  assert.equal(r.length, 1);
  assert.equal(r[0].length, 4);
});
ok("MULTIPOLYGON with two polygons yields two outer rings, holes dropped", () => {
  const r = parseWkt(
    "MULTIPOLYGON(((0 0, 0.001 0, 0.001 0.001, 0 0)),((1 1, 1.001 1, 1.001 1.001, 1 1),(1.0002 1.0002, 1.0004 1.0002, 1.0004 1.0004, 1.0002 1.0002)))",
  );
  assert.equal(r.length, 2);
});
ok("garbage input yields []", () => {
  assert.deepEqual(parseWkt("LINESTRING(0 0, 1 1)"), []);
  assert.deepEqual(parseWkt(""), []);
});

console.log("haversine / bearings — known values");
ok("1 degree of latitude ≈ 364,000 ft (±1%)", () => {
  const ft = haversineFt([47, -122], [48, -122]);
  assert.ok(Math.abs(ft - 364000) / 364000 < 0.01, `got ${ft}`);
});
ok("due north/east/south/west label correctly", () => {
  assert.equal(bearingLabel(0), "N");
  assert.equal(bearingLabel(90), "E");
  assert.equal(bearingLabel(180), "S");
  assert.equal(bearingLabel(270), "W");
  assert.equal(bearingLabel(359), "N");
});

console.log("groupSides — merging the survey into readable walls");
const grouped = groupSides(ring);
// This fixture is a big L-shaped COMMERCIAL campus lot: 22 surveyed segments,
// of which 9 are collinear continuations and 13 are genuine 86–98° corners. So
// 13 walls is the honest answer here — the 4–8 target in the brief is about
// residential lots, which is what the live checks cover.
ok("collinear continuations are merged away (22 → 13)", () =>
  assert.equal(grouped.length, 13, `got ${grouped.length}`));
ok("every junction that survives is a REAL corner (≥ 20° turn)", () => {
  for (let i = 0; i < grouped.length; i++) {
    const a = grouped[i].bearing;
    const b = grouped[(i + 1) % grouped.length].bearing;
    let t = b - a;
    while (t > 180) t -= 360;
    while (t <= -180) t += 360;
    assert.ok(Math.abs(t) >= 20, `junction ${i} turns only ${t.toFixed(1)}°`);
  }
});
ok("spans cover every ring segment exactly once", () =>
  assert.equal(grouped.reduce((a, s) => a + s.span, 0), ring.length));
ok("sides chain: each side's `to` is the next side's `from`", () => {
  for (let i = 0; i < grouped.length; i++) {
    assert.deepEqual(grouped[i].to, grouped[(i + 1) % grouped.length].from);
  }
});
ok("boundary length is conserved by the merge", () =>
  assert.ok(Math.abs(grouped.reduce((a, s) => a + s.boundaryFeet, 0) - perim) < 0.001));
ok("a merged chord is never longer than the boundary it replaces", () => {
  for (const s of grouped) assert.ok(s.feet <= s.boundaryFeet + 1e-6);
});
ok("the merge loses under 2% of length (the bend cap holds)", () => {
  const chords = grouped.reduce((a, s) => a + s.feet, 0);
  assert.ok(chords > perim * 0.98, `chords ${chords} vs boundary ${perim}`);
});

// A square whose south wall was digitised as four near-collinear segments —
// what a county ring looks like along a straight back fence. The jitter is
// ±1e-6° of latitude (±0.37 ft over a 27 ft step ≈ 0.8°), i.e. survey noise.
const noisySquare = [
  [47.6, -122.2],
  [47.600001, -122.199889],
  [47.599999, -122.199778],
  [47.600001, -122.199667],
  [47.6, -122.199556],
  [47.6003, -122.199556],
  [47.6003, -122.2],
];
ok("four near-collinear segments become ONE side (4 walls, not 7)", () => {
  const g = groupSides(noisySquare);
  assert.equal(g.length, 4, `expected 4 walls, got ${g.length}`);
});
ok("…and that merged wall spans all four surveyed segments", () => {
  const g = groupSides(noisySquare);
  assert.ok(g.some((s) => s.span === 4), `spans: ${g.map((s) => s.span).join(",")}`);
});
// A corner CLIP — the 4 ft diagonal a plat puts across a corner. Short, at a
// real angle to both neighbours, so it survives the merge as its own side.
const clippedLot = [
  [47.6, -122.2],
  [47.6, -122.19957],
  [47.600008, -122.19956],
  [47.6003, -122.19956],
  [47.6003, -122.2],
];
ok("a 4 ft corner clip is marked short, not listed as a wall", () => {
  const g = groupSides(clippedLot);
  const shorts = g.filter((s) => s.short);
  assert.equal(shorts.length, 1);
  assert.ok(shorts[0].feet < 10, `clip was ${shorts[0].feet} ft`);
  assert.ok(g.filter((s) => !s.short).length >= 3);
});

console.log("polygonCentroid");
// 197 × 109 ft rectangle at Redmond latitude.
const lot = [
  [47.6, -122.2],
  [47.6, -122.1992],
  [47.6003, -122.1992],
  [47.6003, -122.2],
];
ok("centroid of a rectangle is its middle", () => {
  const c = polygonCentroid(lot);
  assert.ok(Math.abs(c[0] - 47.60015) < 1e-6, `lat ${c[0]}`);
  assert.ok(Math.abs(c[1] + 122.1996) < 1e-6, `lng ${c[1]}`);
});

console.log("detectFrontSides — the street side, from OSM road centrelines");
// The lot's south edge is at lat 47.6; this road runs east–west ~40 ft south of
// it, i.e. where NE-something St would be.
const southRoad = {
  name: "NE 100th St",
  points: [
    [47.59989, -122.2004],
    [47.59989, -122.1988],
  ],
};
// …and this one runs north–south ~40 ft east of the lot's east edge.
const eastRoad = {
  name: "170th Ave NE",
  points: [
    [47.5998, -122.19904],
    [47.6005, -122.19904],
  ],
};

const midLat = (s) => (s.from[0] + s.to[0]) / 2;
const midLng = (s) => (s.from[1] + s.to[1]) / 2;

ok("a road along the south → exactly the south wall, with its name", () => {
  const sides = groupSides(lot);
  const fronts = detectFrontSides(sides, [southRoad]);
  assert.equal(fronts.length, 1);
  assert.ok(Math.abs(midLat(sides[fronts[0].index]) - 47.6) < 1e-6, "not the south wall");
  assert.equal(fronts[0].streetName, "NE 100th St");
  assert.ok(fronts[0].distanceFt < 60, `distance ${fronts[0].distanceFt}`);
});
ok("corner lot (roads south AND east) → BOTH walls are frontage", () => {
  const sides = groupSides(lot);
  const fronts = detectFrontSides(sides, [southRoad, eastRoad]);
  assert.equal(fronts.length, 2);
  const names = fronts.map((f) => f.streetName).sort();
  assert.deepEqual(names, ["170th Ave NE", "NE 100th St"]);
  // One is the south wall, the other the east wall.
  assert.ok(fronts.some((f) => Math.abs(midLat(sides[f.index]) - 47.6) < 1e-6));
  assert.ok(fronts.some((f) => Math.abs(midLng(sides[f.index]) + 122.1992) < 1e-6));
});
ok("the far side of the lot is never dragged in by the tie ratio", () => {
  const sides = groupSides(lot);
  const fronts = detectFrontSides(sides, [southRoad]);
  for (const f of fronts) {
    assert.ok(Math.abs(midLat(sides[f.index]) - 47.6003) > 1e-6, "north wall was tagged");
  }
});
ok("no roads at all → nothing tagged (caller must not guess)", () =>
  assert.deepEqual(detectFrontSides(groupSides(lot), []), []));
ok("a road 300 ft away is not this lot's frontage", () => {
  const farRoad = { name: "Far Rd", points: [[47.5990, -122.2004], [47.5990, -122.1988]] };
  assert.deepEqual(detectFrontSides(groupSides(lot), [farRoad]), []);
});
ok("an unnamed street still tags the side, with a null name", () => {
  const fronts = detectFrontSides(groupSides(lot), [{ name: null, points: southRoad.points }]);
  assert.equal(fronts.length, 1);
  assert.equal(fronts[0].streetName, null);
});
ok("stubs are never nominated as the frontage", () => {
  // The 4 ft corner clip sits on the street side of the clipped lot.
  const sides = groupSides(clippedLot);
  const clipRoad = { name: "Clip St", points: [[47.59989, -122.2004], [47.59989, -122.1988]] };
  for (const f of detectFrontSides(sides, [clipRoad])) {
    assert.equal(sides[f.index].short, false);
  }
});
ok("a degenerate one-point 'road' cannot crash or match", () =>
  assert.deepEqual(detectFrontSides(groupSides(lot), [{ name: "X", points: [[47.6, -122.2]] }]), []));

// The 75 ft cap, exercised either side of the line. The lot's south edge is at
// lat 47.6, so a road offset purely in latitude sits at a known distance from
// that side's midpoint: 1 degree of latitude is 364,824 ft.
const FT_PER_DEG_LAT = 20902231 * (Math.PI / 180);
const roadSouthOf = (ft) => ({
  name: `${ft} ft away`,
  points: [
    [47.6 - ft / FT_PER_DEG_LAT, -122.2004],
    [47.6 - ft / FT_PER_DEG_LAT, -122.1988],
  ],
});
ok("a street 60 ft from the side IS its frontage (inside the 75 ft cap)", () => {
  const sides = groupSides(lot);
  const fronts = detectFrontSides(sides, [roadSouthOf(60)]);
  assert.equal(fronts.length, 1, `expected 1 front, got ${fronts.length}`);
  assert.ok(Math.abs(midLat(sides[fronts[0].index]) - 47.6) < 1e-6, "not the south wall");
  assert.ok(Math.abs(fronts[0].distanceFt - 60) < 1, `distance ${fronts[0].distanceFt}`);
});
ok("a street 90 ft away is NOT — nothing is tagged", () => {
  const fronts = detectFrontSides(groupSides(lot), [roadSouthOf(90)]);
  assert.deepEqual(fronts, [], `tagged ${fronts.length} side(s) at 90 ft`);
});
ok("the cap is the only thing separating those two cases", () => {
  // Same 90 ft road, cap lifted past it → the side comes back. Proves the
  // rejection is the threshold, not a geometry accident.
  const fronts = detectFrontSides(groupSides(lot), [roadSouthOf(90)], { maxDistanceFt: 150 });
  assert.equal(fronts.length, 1);
  assert.ok(Math.abs(fronts[0].distanceFt - 90) < 1, `distance ${fronts[0].distanceFt}`);
});

console.log(`\n${passed} checks passed`);
