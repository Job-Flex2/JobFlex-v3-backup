// The homeowner's roof range (lib/publicEstimate/roof, 2026-10-27): a Google Solar roof read (or a home's size) and
// three picture answers → the roof package's facts → the package priced at the default catalog × the city factor →
// a RANGE, never a number. Pure.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/public-roof-range.check.ts
import type { SolarRoofEstimate } from "../../../src/lib/roofSolarEstimate";
import { DEFAULT_ANSWERS, MATERIALS, roofFactsFromSize, roofFactsFromSolar, roofRange, type RoofAnswers } from "../../../src/lib/publicEstimate/roof";
import { roofGuideRange } from "../../../src/lib/publicEstimate/guide";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

// A synthetic house (never a real address): 2,100 sq ft of roof over an 1,800 sq ft footprint, mostly 6/12 with a 9/12 wing.
const solar: SolarRoofEstimate = {
  areaSqft: 2100,
  footprintSqft: 1800,
  predominantPitch12: 6,
  pitchLabel: "6/12",
  segmentCount: 8,
  pitchFamilies: [
    { pitch12: 6, planSqft: 1500, surfaceSqft: 1680 },
    { pitch12: 9, planSqft: 300, surfaceSqft: 420 },
  ],
  imageryDate: "2025-06-01",
  imageryQuality: "HIGH",
  coverageRatio: 1,
  areaMethod: "google-modeled-roof",
  warnings: [],
  center: { lat: 42.948, lng: -78.853 },
  buildingName: null,
  rawAreaSqft: 2100,
};
const a: RoofAnswers = { ...DEFAULT_ANSWERS, storeys: 2, material: "architectural", tearOffLayers: 1 };

const f = roofFactsFromSolar(solar, a, "NY");
check("solar → facts: 21 squares, pitch shares by surface area, 2 storeys, no perimeter, estimated", f.squares === 21 && f.squaresBasis === "estimated" && Math.abs(f.pitchFamilies[0].share - 0.8) < 1e-9 && f.perimeterFt === null && f.footprintSqft === 1800 && f.storeys === 2 && f.facetCountEstimated === 8, JSON.stringify({ squares: f.squares, shares: f.pitchFamilies, storeys: f.storeys }));
check("…the existing material and the state ride along; 'not sure' is unknown", f.existingMaterial === "Asphalt shingle" && f.state === "NY" && roofFactsFromSolar(solar, { ...a, existing: "unsure" }, null).existingMaterial === null);
const sizeFacts = roofFactsFromSize(2400, { ...a, storeys: 2 }, "NY");
check("size → facts: 2,400 sq ft home on 2 floors ≈ 13.8 squares at 6/12", Math.abs(sizeFacts.squares - 13.8) < 0.05 && sizeFacts.pitchFamilies[0].pitch12 === 6 && sizeFacts.footprintSqft === 1200, `${sizeFacts.squares} sq`);

const r = roofRange(f, a, null, "solar");
check("the range: mid is the package total × the city factor, rounded to $100; low 90%, high 115%", r.mid % 100 === 0 && r.low === Math.round((r.mid * 0.9) / 100) * 100 && r.high === Math.round((r.mid * 1.15) / 100) * 100 && r.mid > 0, `${r.low}–${r.mid}–${r.high}`);
check("the city factor moves the number", roofRange(f, a, { factor: 1.2, words: "Bellevue, WA" }, "solar").mid > r.mid && roofRange(f, a, { factor: 1.2, words: "Bellevue, WA" }, "solar").cityWords === "Bellevue, WA" && r.cityWords === null);
const metal = roofRange(f, { ...a, material: "standing_seam" }, null, "solar");
const two = roofRange(f, { ...a, tearOffLayers: 2 }, null, "solar");
const oneStorey = roofRange(roofFactsFromSolar(solar, { ...a, storeys: 1 }, "NY"), { ...a, storeys: 1 }, null, "solar");
const three = roofRange(roofFactsFromSolar(solar, { ...a, storeys: 3 }, "NY"), { ...a, storeys: 3 }, null, "solar");
check("metal costs more than architectural; 2 layers of tear-off more than 1; 3 storeys more than 1", metal.mid > r.mid && two.mid > r.mid && three.mid > oneStorey.mid, `${metal.mid} / ${two.mid} / ${three.mid} vs ${oneStorey.mid}`);
check("no tear-off: no tear-off line in the scope", !roofRange(f, { ...a, tearOffLayers: 0 }, null, "solar").scope.some((s) => /tear-off|tear off/i.test(s)));
check("the scope never shows a price", r.scope.length >= 4 && !r.scope.some((s) => /\$/.test(s)), r.scope.join(" | ").slice(0, 200));
check("basis travels; squares and the pitch label ride with the range", roofRange(sizeFacts, a, null, "size").basis === "size" && r.basis === "solar" && r.squares === 21 && r.pitchLabel === "6/12");
check("the whole estimate rides hidden: the spec with the choices, every line, the assumptions", r.hidden.spec.systemId === "architectural" && r.hidden.spec.tearOffLayers === 1 && r.hidden.materials.length > 3 && r.hidden.labor.length > 2 && r.hidden.assumptions.length > 0 && r.hidden.scopeText.length > 40);
check("…and the hidden lines add up to the mid before rounding and the city factor", Math.abs([...r.hidden.materials, ...r.hidden.labor].reduce((t, l) => t + l.quantity * l.unitPrice, 0) - r.mid) <= 50);
check("the five materials, architectural first", MATERIALS.length === 5 && MATERIALS[0].id === "architectural" && MATERIALS.every((m) => m.label && m.blurb));

check("the guide range: only the architectural shingle, only a known city", roofGuideRange("Bellevue, WA", "architectural") !== null && roofGuideRange("Bellevue, WA", "standing_seam") === null && roofGuideRange("Nowhere, ZZ", "architectural") === null, JSON.stringify(roofGuideRange("Bellevue, WA", "architectural")));
const g = roofGuideRange("Bellevue, WA", "architectural")!;
check("…a whole-job range in dollars, low under high, with the city's words", g.low > 1000 && g.high > g.low && g.cityWords === "Bellevue, WA");

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
