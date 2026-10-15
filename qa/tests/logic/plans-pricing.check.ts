// Blueprint pricing — no network, no model.
//   npx tsx --tsconfig tsconfig.json qa/tests/logic/plans-pricing.check.ts
// The Carter house's takeoff handed to the estimator one trade at a time: the brief
// carries no measured number (the brief binding would grab it), each trade's prompt
// is built as NEW construction (no remodel method, no tear-off, the trade's permit),
// neighbours are told what the other trades price, the answer's quantities are held
// to the takeoff, and the trades merge into one ledger with the price book's checks.
import { readBrief } from "../../../src/lib/estimate/brief";
import { buildLegacyEstimatePrompt, effectiveProcedure, legacyLineToItem } from "../../../src/lib/estimate/legacy-estimate";
import type { GeneratedEstimate } from "../../../src/lib/estimatorSchema";
import { cleanSheetRead } from "../../../src/lib/plans/sheet";
import { computeTakeoff, PLAN_TRADES, type PlanTrade } from "../../../src/lib/plans/takeoff";
import { bindLinesToTakeoff, excludedWork, houseBriefOf, tradeBrief } from "../../../src/lib/plans/tradeBrief";
import { GENERAL_CONDITIONS_PROCEDURE, newBuildProcedure, planTradeRun, TRADE_SETUP } from "../../../src/lib/plans/tradeSetup";
import { planPriceChecks } from "../../../src/lib/plans/priceChecks";
import { mergePlanEstimate, priceCheckNotes } from "../../../src/lib/plans/merge";
import { estimateFromLines } from "../../../src/lib/estimate/console-model";
import { takeoffItemSchema, tradePriceInput } from "../../../src/lib/plans/wire";
import { EAGLE_READS } from "./plans-eagle.fixture";

let failures = 0;
let passes = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) passes++;
  else failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

// The Carter house, as in plans-takeoff.check.ts (cover, main, upper, elevations, schedules).
const sheets = [
  cleanSheetRead(1, {
    kind: "cover",
    title: "A0 COVER",
    project: { name: "Carter Residence", address: "4411 Ridge View Ln, Kirkland, WA" },
    stated: { livingSqFt: "2,280 SF", mainSqFt: 1200, upperSqFt: 1080, garageSqFt: 576, porchSqFt: 96 },
    stories: 2,
    foundation: { type: "crawlspace" },
  }),
  cleanSheetRead(2, {
    kind: "floor",
    level: "Main",
    overall: { width: "40'-0\"", depth: "30'-0\"" },
    plateHeights: [{ level: "Main", height: "9'-0\"" }],
    rooms: [
      { name: "Great Room", size: "18'-0\" x 16'-0\"" },
      { name: "Kitchen", size: "12'-0\" x 14'-0\"" },
      { name: "Dining", size: "12'-0\" x 11'-0\"" },
      { name: "Powder", size: "6'-0\" x 8'-0\"" },
      { name: "Laundry", size: "6'-0\" x 9'-0\"" },
      { name: "Garage", size: "24'-0\" x 24'-0\"" },
      { name: "Porch", size: "12'-0\" x 8'-0\"" },
    ],
  }),
  cleanSheetRead(3, {
    kind: "floor",
    level: "Upper",
    overall: { width: "40'-0\"", depth: "27'-0\"" },
    plateHeights: [{ level: "Upper", height: "8'-0\"" }],
    rooms: [
      { name: "Primary Bedroom", size: "16'-0\" x 14'-0\"", floor: "carpet" },
      { name: "Primary Bath", size: "10'-0\" x 14'-0\"" },
      { name: "Bedroom 2", size: "14'-0\" x 14'-0\"", floor: "carpet" },
      { name: "Bedroom 3", size: "13'-0\" x 12'-0\"", floor: "carpet" },
      { name: "Bath 2", size: "8'-0\" x 9'-0\"" },
    ],
  }),
  cleanSheetRead(4, { kind: "elevation", roof: { pitch: "6:12", style: "gable", overhang: "18\"" } }),
  cleanSheetRead(5, {
    kind: "schedule",
    windows: [
      { tag: "W1", size: "3'-0\" x 5'-0\"", count: 10 },
      { tag: "W2", size: "4'-0\" x 4'-0\"", count: 4 },
      { tag: "W3", size: "2'-0\" x 3'-0\"", count: 3 },
    ],
    doors: [
      { tag: "D1", size: "3'-0\" x 6'-8\"", type: "Exterior fiberglass entry", count: 1 },
      { tag: "D2", size: "6'-0\" x 6'-8\"", type: "Sliding patio door", count: 1 },
      { tag: "D3", size: "2'-8\" x 6'-8\"", type: "Interior hollow core", count: 11 },
      { tag: "D4", size: "3'-0\" x 6'-8\"", type: "Exterior steel, garage to house", count: 1 },
      { tag: "OH", size: "16'-0\" x 7'-0\"", type: "Garage overhead sectional", count: 1 },
    ],
  }),
];
const t = computeTakeoff(sheets);
const house = houseBriefOf(t.house);
const ALL = [...PLAN_TRADES];

// ── 1. the brief has no measured number for the brief binding to grab
for (const trade of PLAN_TRADES) {
  const b = tradeBrief(trade, house, t.items, ALL);
  const f = readBrief(b.brief);
  ok(`${trade}: brief states no area, run or measure`, f.area === undefined && f.length === undefined && f.measures.length === 0, `${JSON.stringify(f.measures)} · "${b.brief}"`);
  ok(`${trade}: takeoff block lists every item of the trade`, b.items.length > 0 && b.items.every((i) => b.takeoffBlock.includes(i.label)), `${b.items.length} items`);
}
const plumbing = tradeBrief("plumbing", house, t.items, ALL);
ok("plumbing brief asks for the new water heater (the validator's out-of-scope rule)", /(install|new)[^.,;]{0,25}water heater/i.test(plumbing.brief));
ok("painting brief names the second story (lift and scaffold are in scope)", /two[- ]stor/i.test(tradeBrief("painting", house, t.items, ALL).brief));
ok("gutters brief names gutters", /gutter/i.test(tradeBrief("gutters", house, t.items, ALL).brief));
ok("units printed in the estimator's words (sqft, linear ft, unit)", /: 2,418 sqft/.test(tradeBrief("roofing", house, t.items, ALL).takeoffBlock) && /linear ft/.test(tradeBrief("framing", house, t.items, ALL).takeoffBlock));

// ── 2. what the neighbours price
const framingOut = excludedWork("framing", ["framing", "windows-doors", "siding"]).map((o) => o.owner);
ok("framing leaves the windows to the window trade and the wrap to the sider", framingOut.includes("windows-doors") && framingOut.includes("siding"), framingOut.join(","));
ok("a framer priced alone leaves nothing out", excludedWork("framing", ["framing"]).length === 0);
ok("every trade leaves the permit to the general conditions when they are priced", PLAN_TRADES.filter((x) => x !== "general").every((x) => excludedWork(x, ["general", x]).some((o) => o.owner === "general")));
ok("the excluded work is printed in the block", /NOT IN THIS TRADE[\s\S]*setting, flashing and sealing the windows/.test(tradeBrief("framing", house, t.items, ["framing", "windows-doors"]).takeoffBlock));

// ── 3. the procedure without the steps a new house never has
const NEVER = /tear-off of the existing|remove the existing|old fixtures|refrigerant recovered|wire fished|code corrections|remove existing flooring|removal of the existing/i;
for (const trade of ["roofing", "windows-doors", "siding", "flooring", "plumbing", "electrical", "hvac", "cabinets", "drywall", "gutters"] as PlanTrade[]) {
  const own = effectiveProcedure(TRADE_SETUP[trade].specialtyId, null);
  const nb = own ? newBuildProcedure(own) : null;
  ok(`${trade}: new-build procedure keeps its work and drops the tear-out`, !!own && !!nb && nb.steps.length >= Math.min(8, own.steps.length - 4) && !nb.steps.some((s) => NEVER.test(s.item)), own && nb ? `${own.steps.length} → ${nb.steps.length}` : "no procedure");
}
ok("concrete keeps 'dowels into existing concrete' reinforcing (a head match, not a word match)", newBuildProcedure(effectiveProcedure("concrete-contractor", null)!).steps.some((s) => /^Slab reinforcing/.test(s.item)));
ok("general conditions procedure: 7 steps, the permit first", GENERAL_CONDITIONS_PROCEDURE.steps.length === 7 && /^Permits, plan review/.test(GENERAL_CONDITIONS_PROCEDURE.steps[0].item));

// ── 4. the prompt as the estimator builds it for a blueprint trade
for (const trade of ["roofing", "tile", "drywall", "electrical", "cabinets", "insulation"] as PlanTrade[]) {
  const run = planTradeRun({ trade, house, items: t.items, alsoPriced: ALL });
  const own = effectiveProcedure(run.setup.specialtyId, null);
  const overrides = { specialties: { [run.setup.specialtyId]: { procedure: own ? newBuildProcedure(own) : undefined } } };
  const legacy = buildLegacyEstimatePrompt(
    { description: run.brief, location: "Kirkland, WA", projectType: run.label, companyName: "QA Builders" },
    { overrides, specialtyId: run.setup.specialtyId, newBuild: { permit: run.setup.permit, benchmarkQty: run.benchmarkQty } },
  );
  ok(`${trade}: pinned to ${run.setup.specialtyId}, whole job, no remodel method`, legacy.specialty.id === run.setup.specialtyId && legacy.scope === "full" && legacy.remodelDomains.length === 0, `${legacy.specialty.id} ${legacy.scope} [${legacy.remodelDomains}]`);
  ok(`${trade}: told it is new construction`, /Project type: New construction/.test(legacy.prompt));
  ok(`${trade}: the trade's permit decision`, legacy.permit?.need === run.setup.permit.need);
  ok(`${trade}: no tear-off in the procedure`, !/Tear-off of the existing roofing/.test(legacy.prompt));
}
const roofRun = planTradeRun({ trade: "roofing", house, items: t.items, alsoPriced: ALL });
ok("roofing benchmark in squares off the takeoff (24.2)", roofRun.benchmarkQty === 24.2, String(roofRun.benchmarkQty));
ok("no benchmark for a window REPLACEMENT book", planTradeRun({ trade: "windows-doors", house, items: t.items, alsoPriced: ALL }).benchmarkQty === null);
ok("framing benchmark = living + garage (2,856)", planTradeRun({ trade: "framing", house, items: t.items, alsoPriced: ALL }).benchmarkQty === 2856);

// ── 5. the answer's quantities held to the takeoff, money kept
const dw = t.items.filter((i) => i.trade === "drywall");
const walls = dw.find((i) => i.id === "drywall.walls")!.qty;
const ceil = dw.find((i) => i.id === "drywall.ceilings")!.qty;
const bound = bindLinesToTakeoff(
  [
    { name: "Hang walls: 1/2 in. regular gypsum board", unit: "sqft", quantity: Math.round(walls * 1.1), materialUnitPrice: 0.6, laborUnitPrice: 0.7 },
    { name: "Tape and finish to Level 4, walls and ceilings", unit: "sqft", quantity: walls + ceil, materialUnitPrice: 0.2, laborUnitPrice: 0.9 },
    { name: "Corner bead", unit: "linear ft", quantity: 600, materialUnitPrice: 0.5, laborUnitPrice: 1 },
  ],
  dw,
);
const before = Math.round(walls * 1.1) * 1.3;
const after = bound.lines[0].quantity * (bound.lines[0].materialUnitPrice + bound.lines[0].laborUnitPrice);
ok("waste-inflated wall board goes back to the takeoff's wall area", bound.lines[0].quantity === walls, String(bound.lines[0].quantity));
ok("…and the line's money is kept (within a cent a unit)", Math.abs(after - before) < walls * 0.02, `${before.toFixed(0)} vs ${after.toFixed(0)}`);
ok("tape-and-finish over walls + ceilings is left alone", bound.lines[1].quantity === walls + ceil);
ok("a line in a unit the takeoff does not measure is left alone", bound.lines[2].quantity === 600);
const roofBound = bindLinesToTakeoff([{ name: "Shingles supplied: architectural", unit: "sq boards", quantity: 26, materialUnitPrice: 150, laborUnitPrice: 0 }], t.items.filter((i) => i.trade === "roofing"));
ok("a roofing line in squares is not forced onto a sq ft item", roofBound.lines[0].quantity === 26);

// ── 5b. the build list: materials in the units they are bought in, work and supply apart
const roofItems = t.items.filter((i) => i.trade === "roofing");
const bundles = roofItems.find((i) => i.id === "roofing.shingles")!;
const area = roofItems.find((i) => i.id === "roofing.area")!;
const roofBlock = tradeBrief("roofing", house, t.items, ALL).takeoffBlock;
ok("the block groups WORK, MATERIALS and SUPPLY AND INSTALL", /WORK — labor only[\s\S]*MATERIALS — supply only[\s\S]*SUPPLY AND INSTALL|WORK — labor only[\s\S]*MATERIALS — supply only/.test(roofBlock));
ok("a bundle count is printed as the estimator's unit with the bundle named", new RegExp(`: ${bundles.qty} unit \\(bundles\\)`).test(roofBlock), roofBlock.split("\n").find((x) => /shingles, 3 bundles/.test(x)));
ok("the rules say a material line is priced per purchase unit with no waste added", /price ONE such package at its supplier price, adding no waste/.test(roofBlock));
const split = bindLinesToTakeoff(
  [
    { name: "Install architectural shingles", unit: "sqft", quantity: area.qty, materialUnitPrice: 1.3, laborUnitPrice: 1.6 },
    { name: "Architectural shingles (bundles)", unit: "unit", quantity: Math.round(bundles.qty * 1.1), materialUnitPrice: 42, laborUnitPrice: 0 },
  ],
  roofItems,
);
ok("a bundle line (unit) binds to the shingle bundles, money kept", split.lines[1].quantity === bundles.qty && Math.abs(split.lines[1].materialUnitPrice * bundles.qty - 42 * Math.round(bundles.qty * 1.1)) < bundles.qty * 0.01, String(split.lines[1].quantity));
ok("the install line drops the shingles it also priced (bought once)", split.lines[0].materialUnitPrice === 0 && split.lines[0].laborUnitPrice === 1.6 && split.notes.some((n) => /bought twice/.test(n)), JSON.stringify(split.lines[0]));
const alone = bindLinesToTakeoff([{ name: "Install architectural shingles", unit: "sqft", quantity: area.qty, materialUnitPrice: 1.3, laborUnitPrice: 1.6 }], roofItems);
ok("…but with no material line in the answer, the install line keeps its material", alone.lines[0].materialUnitPrice === 1.3);
ok("the model sees no step prefix in a line's name (it would land on the proposal)", !/^  - \[/m.test(roofBlock));
ok("…and is told shingles stay in bundles, not squares", /shingles stay in bundles, not squares/.test(roofBlock));
const asUnit = (name: string) => legacyLineToItem({ name, measurementType: "unit", quantity: 155, materialCost: 155 * 40, laborCost: 0 } as Parameters<typeof legacyLineToItem>[0])?.unit;
ok("a shingle line that names its bundles stays in bundles (unit)", asUnit("Architectural shingles, 3 bundles a square (incl. 15% waste)") === "unit" && asUnit("Synthetic underlayment, 10-square rolls") === "unit", `${asUnit("Architectural shingles, 3 bundles a square (incl. 15% waste)")}`);
ok("…an old-shape shingle line in 'unit' is still read as squares", asUnit("Architectural shingles, 30-yr") === "sq boards");
const eagle = computeTakeoff(EAGLE_READS.map(([p, r]) => cleanSheetRead(p, r)));
const bad = eagle.items.filter((i) => !takeoffItemSchema.safeParse(i).success);
ok("every line of the real set passes the wire schema (new units, role, phase)", bad.length === 0, bad.map((i) => `${i.id}:${i.unit}`).join(", "));
const eagleHouse = houseBriefOf(eagle.house);
const tooBig = PLAN_TRADES.filter((tr) => !tradePriceInput.safeParse({ token: "x", trade: tr, house: eagleHouse, items: eagle.items.filter((i) => i.trade === tr).length ? eagle.items.filter((i) => i.trade === tr) : [eagle.items[0]], alsoPriced: ALL }).success);
ok("every Eagle trade fits one pricing request", tooBig.length === 0, tooBig.join(","));
const eagleChecks = planPriceChecks(eagleHouse, eagle.items, "Kirkland, WA");
ok("price book counts the openings, not their install lines and hardware (44 windows + 5 doors)", /^49 windows and doors$/.test(eagleChecks.checks.find((c) => c.label.startsWith("Windows"))?.basis ?? ""), eagleChecks.checks.find((c) => c.label.startsWith("Windows"))?.basis);
ok("price book: plumbing by the 24 fixture rough-ins, HVAC by the 2 systems", eagleChecks.checks.find((c) => c.label === "Plumbing")?.basis === "24 fixtures" && eagleChecks.checks.find((c) => c.label === "HVAC")?.basis === "2 systems with their ducts");

// ── 6. the builder price book's word
const pc = planPriceChecks(house, t.items, "Kirkland, WA");
const framingCheck = pc.checks.find((c) => c.label === "Framing");
ok("price book: Kirkland, WA is the market", /Kirkland/.test(pc.place), pc.place);
ok("price book: a framing range for 2,280 sq ft", !!framingCheck && framingCheck.low > 20000 && framingCheck.high > framingCheck.low, framingCheck ? `${framingCheck.low}-${framingCheck.high}` : "none");
ok("price book: a whole-house range per sq ft", !!pc.house && pc.house.perSqFt[0] > 100 && pc.house.perSqFt[1] < 400, pc.house ? pc.house.perSqFt.join("-") : "none");
ok("price book: the interior finishes are one phase of five trades", pc.checks.some((c) => c.trades.length === 5));
const lowNotes = priceCheckNotes(pc, { framing: (framingCheck?.low ?? 0) * 0.5 }, false);
ok("a framing total at half the book's low is called out", lowNotes.length === 1 && /Framing: .* is under/.test(lowNotes[0]), lowNotes[0]);
ok("a framing total inside the book says nothing", priceCheckNotes(pc, { framing: framingCheck?.low ?? 0 }, false).length === 0);

// ── 7. the trades merged into one ledger
const fake = (title: string, rows: Array<[string, number, string, number, number]>, extra: Partial<GeneratedEstimate> = {}): GeneratedEstimate => ({
  title,
  scope: `${title} scope.`,
  assumptions: ["Standard grade materials."],
  materials: rows.map(([name, quantity, unit, m], i) => ({ id: `i${i}`, name, quantity, unit, unitPrice: m })),
  labor: rows.map(([name, quantity, unit, , l], i) => ({ id: `i${i}`, name, quantity, unit, unitPrice: l })),
  estimatedTimelineDays: 10,
  ...extra,
});
const merged = mergePlanEstimate({
  house,
  results: [
    { trade: "roofing", est: fake("Roof", [["Shingles", 2418, "sqft", 2, 1.5]]) },
    { trade: "framing", est: fake("Frame", [["Exterior walls", 346, "linear ft", 20, 15], ["Gutter apron", 120, "linear ft", 3, 2]], { notes: ["1 line added"] }) },
  ],
  checks: t.checks,
  priceChecks: pc,
  wholeHouse: false,
});
ok("merged in build order: framing before roofing", merged.lines[0].group === "Framing & sheathing" && merged.lines[merged.lines.length - 1].group === "Roofing", merged.lines.map((l) => l.group).join(","));
ok("each trade's total is its own lines", merged.totals.roofing === 2418 * 3.5 && merged.totals.framing === 346 * 35 + 120 * 5);
ok("title names the house and the two trades", merged.title === "Carter Residence — framing & sheathing and roofing", merged.title);
ok("trade notes carry their trade", merged.notes.some((n) => n === "Framing & sheathing · 1 line added"));
ok("framing far under the book is flagged in the notes", merged.notes.some((n) => /Price book check · Framing/.test(n)));
const wire = estimateFromLines(merged.lines, { title: merged.title, scope: merged.scope, assumptions: merged.assumptions });
ok("the proposal's line names carry the trade", wire.materials[0].name === "Framing & sheathing — Exterior walls", wire.materials[0].name);
ok("timeline: the trades' days, not overlapped when only two are priced", merged.timelineDays === 20);

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
