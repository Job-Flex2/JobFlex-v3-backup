// The right measures, not only "unit" (2026-10-21, owner, on a blueprint plumbing estimate: "make sure it uses the
// right measures in the blueprint estimate, not only units"). A line held to the takeoff takes the takeoff's own
// measure — stub-outs "each", shingles "bundles", drywall "sheets", pipe "linear ft" — and a count left over reads
// "each"; the estimator keeps the real words for show while the price checks still read a count as "unit"; a
// proposal stores them (each, sheets, bundles, cubic yards — no longer cubic FEET) and the client reads them; the
// manual builder keeps a stored measure it has no option for.
//   npx tsx --tsconfig tsconfig.json qa/tests/logic/estimate-measures.check.ts
import { bindLinesToTakeoff } from "../../../src/lib/plans/tradeBrief";
import type { TakeoffItem } from "../../../src/lib/plans/takeoff";
import { measureUnit, normalizeUnit, unitSelectOptions } from "../../../src/lib/estimate/console-model";
import { measureWords } from "../../../src/lib/measureWords";
import { MEASUREMENT_TYPES } from "../../../src/lib/prismaEnums";
import { emptyDraft, measurementOf, payloadFromDraft, unitOf } from "../../../src/components/v3/manual-card-lab/manual-blueprint/manual-blueprint-bridge";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const item = (id: string, label: string, qty: number, unit: TakeoffItem["unit"], role: TakeoffItem["role"] = "labor"): TakeoffItem => ({ id, trade: "plumbing", label, qty, unit, source: "plan", basis: "", pages: [], role });
const line = (name: string, quantity: number, unit = "unit") => ({ name, unit, quantity, materialUnitPrice: 0, laborUnitPrice: 100 });

console.log("── a blueprint estimate's lines");
const items = [
  item("plumbing.water-stubs", "Water stub-outs (hot and cold) at each fixture", 63, "each"),
  item("plumbing.drain-stubs", "Drain stub-outs at each fixture", 35, "each"),
  item("plumbing.building-drain", "Underfloor building drain and branches", 116, "linear ft"),
  item("roofing.shingles", "Architectural shingles, 3 bundles a square", 155, "bundles", "material"),
  item("drywall.regular", "Drywall 1/2\" regular 4×12 sheets", 396, "sheets", "material"),
  item("foundation.concrete-fw", "Concrete 3,000 psi — footings and walls", 27.4, "cu yards", "material"),
];
const bound = bindLinesToTakeoff(
  [
    line("Water stub-outs (hot and cold) at each fixture (labor only)", 63),
    line("Drain stub-outs at each fixture (labor only)", 35),
    line("Underfloor/underground drain: building drain and branches (labor only)", 116, "linear ft"),
    line("Architectural shingles (material only)", 155),
    line("Drywall 1/2 in regular sheets (material only)", 396),
    line("Concrete for footings and walls", 27.4, "cu yards"),
    line("Water heater, 50 gal gas (material only)", 1),
    line("Pressure tests and inspections", 1, "fixed"),
  ],
  items,
).lines;
const u = (name: RegExp) => bound.find((l) => name.test(l.name))?.unit;
check("stub-outs: each, not unit", u(/^Water stub/) === "each" && u(/^Drain stub/) === "each", `${u(/^Water stub/)} / ${u(/^Drain stub/)}`);
check("pipe stays linear ft", u(/building drain/) === "linear ft");
check("shingles in bundles, drywall in sheets", u(/shingles/) === "bundles" && u(/Drywall/) === "sheets", `${u(/shingles/)} / ${u(/Drywall/)}`);
check("concrete in cubic yards", u(/Concrete/) === "cu yards");
check("a count held to nothing: each", u(/Water heater/) === "each");
check("a lump sum stays fixed", u(/Pressure tests/) === "fixed");

console.log("── the estimator's words");
check("real measures kept for show: ea → each, bundle → bundles, pcs → pieces, gal → gallons", measureUnit("ea") === "each" && measureUnit("bundle") === "bundles" && measureUnit("pcs") === "pieces" && measureUnit("gal") === "gallons");
check("the picker's words unchanged: sq ft → sqft, hr → hour", measureUnit("sq ft") === "sqft" && measureUnit("hr") === "hour");
check("…while the price checks still read a count as unit", normalizeUnit("each") === "unit" && normalizeUnit("bundles") === "unit" && normalizeUnit("sheets") === "unit" && normalizeUnit("sqft") === "sqft");
check("the unit picker offers the real measures", ["each", "sheets", "bundles", "gallons"].every((w) => unitSelectOptions("unit").some((o) => o.value === w)));

console.log("── the proposal");
check("the proposal's list takes them", ["EACH", "SHEET", "BUNDLE", "CU_YARD", "SQ_YARD", "SQUARE"].every((t) => (MEASUREMENT_TYPES as readonly string[]).includes(t)));
check("the client reads them: 63 each, 155 bundles, 1 sheet, 27 cubic yards", measureWords("EACH", 63) === "each" && measureWords("BUNDLE", 155) === "bundles" && measureWords("SHEET", 1) === "sheet" && measureWords("CU_YARD", 27) === "cubic yards");

console.log("── the manual builder");
check("cubic yards and square yards stored exactly (not cubic feet, square feet)", measurementOf("CU_YARDS") === "CU_YARD" && measurementOf("SQ_YARDS") === "SQ_YARD" && unitOf("CU_YARD") === "CU_YARDS" && unitOf("SQ_YARD") === "SQ_YARDS");
check("roofing squares as squares", measurementOf("SQ_BOARDS") === "SQUARE" && unitOf("SQUARE") === "SQ_BOARDS");
const d = emptyDraft({ taxPct: 0, materialMarkupPct: 0, laborMarkupPct: 0 });
const base = { description: "", quantity: 1, materialCost: 10, laborCost: 0 };
const draft = {
  ...d,
  title: "t",
  lines: [
    { ...base, id: "a", name: "Toilets", unit: unitOf("EACH"), measure: "EACH" },
    { ...base, id: "b", name: "Shingles", unit: "SQFT" as const, measure: "BUNDLE" },
    { ...base, id: "c", name: "Sheets", unit: unitOf("SHEET") },
  ],
};
const saved = payloadFromDraft(draft).lineItems.map((l) => l.measurementType).join(",");
check("a stored measure it has no option for is saved back as it was; a changed unit wins", saved === "EACH,SQFT,UNIT", saved);

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
