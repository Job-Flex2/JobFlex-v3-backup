// Synthetic check of the Smart Proposal brief binding — no network, no model.
//   npx tsx --tsconfig tsconfig.json qa/tests/logic/estimate-brief.check.ts
// The brief's numbers are read (area, run, price per unit, total), the prompt
// carries them as binding rules, the epoxy job resolves to the coatings
// recipe without moisture testing, and a reply that drifted (450 sqft at
// $8.50 plus a moisture line — the 2026-09-17 Kirkland job) is held to
// 400 sq ft and exactly $4,000.00, with and without a shop markup. The intake
// gate keeps only cost-critical questions.
import { bindEstimateToBrief, bindLinesToBrief, bindTextToBrief, briefRulesBlock, keepCostCritical, readBrief, scrubUnaskedText, scrubUnaskedWork } from "../../../src/lib/estimate/brief";
import { buildLegacyEstimatePrompt, legacyEstimateFromText, specialtyFor } from "../../../src/lib/estimate/legacy-estimate";
import { detectTrade } from "../../../src/lib/estimate/trade-knowledge";
import type { GeneratedEstimate } from "../../../src/lib/estimatorSchema";

let failures = 0;
let passes = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) passes++;
  else failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

const KIRKLAND = "install 400 sq ft full flake epoxy with polyaspartic top coat make 10$ per sq";

// ── Reading the brief ───────────────────────────────────────────────────────
{
  const f = readBrief(KIRKLAND);
  ok("Kirkland: 400 sq ft, $10 per sq ft, target $4,000", f.area === 400 && f.sellPerUnit?.amount === 10 && f.sellPerUnit.unit === "sqft" && f.targetSell === 4000, JSON.stringify({ area: f.area, per: f.sellPerUnit, target: f.targetSell }));
  ok("The target says how it was arrived at", /400 sq ft × \$10\.00\/sq ft/.test(f.targetFrom ?? ""), f.targetFrom);
  const cases: Array<[string, Partial<{ area: number; length: number; per: number; perUnit: string; total: number; target: number }>]> = [
    ["Replace 2,400 sqft architectural shingle roof, tear-off, ridge vents. Bothell, WA.", { area: 2400 }],
    ["120 ft of 6 ft tall cedar fence with two gates, $45 per linear foot", { length: 120, per: 45, perUnit: "linear ft", target: 5400 }],
    ["Paint the living room 450 square feet of wall, two coats, $2.50 a sq ft", { area: 450, per: 2.5, target: 1125 }],
    ["Garage floor 20x24 flake epoxy, total $4,500", { area: 480, total: 4500, target: 4500 }],
    ["Full kitchen remodel, budget of $38k", { total: 38000, target: 38000 }],
    ["Install 14 windows, $650 each", { per: 650, perUnit: "unit" }],
    ["600 sqft LVP, the planks cost $3.20 per sq ft from Home Depot", { area: 600 }],
    ["Pour a 10 cu yards driveway pad and charge $6,800 for the whole job", { total: 6800, target: 6800 }],
    ["Tile 85 sq ft backsplash at $28/sf", { area: 85, per: 28, target: 2380 }],
    ["Deck 320 sq ft composite, make it $9,600 all-in", { area: 320, total: 9600, target: 9600 }],
    ["Replace 8 ft x 7 ft garage door", {}],
  ];
  for (const [brief, want] of cases) {
    const r = readBrief(brief);
    const got = { area: r.area, length: r.length, per: r.sellPerUnit?.amount, perUnit: r.sellPerUnit?.unit, total: r.sellTotal?.amount, target: r.targetSell };
    const good = (Object.keys(want) as (keyof typeof want)[]).every((k) => got[k] === want[k]) && (want.area !== undefined || got.area === undefined) && (want.total !== undefined || got.total === undefined) && (want.per !== undefined || got.per === undefined);
    ok(`reads "${brief.slice(0, 60)}"`, good, JSON.stringify(got));
  }
  ok("A cost the contractor pays is not the customer's price", readBrief("400 sqft of tile, material costs $6 per sq ft").sellPerUnit === undefined);
  ok("The intake's size field stands in when the brief has no area", readBrief("flake epoxy garage, $9 per sq ft", { sqft: 500 }).targetSell === 4500);
}

// ── The prompt carries the rules ────────────────────────────────────────────
{
  const { specialty, prompt, facts } = buildLegacyEstimatePrompt({ description: KIRKLAND, location: "Kirkland, WA", qualityTier: "standard" }, { withTradeRules: true });
  ok("The epoxy brief resolves to the epoxy specialty and the coatings trade", specialty.id === "epoxy-flooring" && detectTrade(KIRKLAND).id === "coatings", `${specialty.id} / ${detectTrade(KIRKLAND).id}`);
  ok("The prompt binds the area and the price", /every sqft line carries sqft 400 exactly/.test(prompt) && /must be exactly \$4,000\.00/.test(prompt) && facts.targetSell === 4000);
  ok("The prompt says the lines are the job's own steps, nothing extra", /nothing from a different job/.test(prompt) && /never as a line/.test(prompt));
  ok("The epoxy recipe is grind → base coat → flake → topcoat → cleanup, moisture testing only when asked", /diamond-grind/.test(prompt) && /flake broadcast to rejection/.test(prompt) && /Moisture testing[^.]*ONLY when the brief asks/.test(prompt) && !/Include substrate prep, moisture testing/.test(prompt));
  ok("The coatings trade profile rides with a gpt-4o-class model", /TRADE PROFILE: FLOOR COATINGS/.test(prompt) && /Full flake broadcast to rejection, scrape and vacuum/.test(prompt));
  ok("A brief with no numbers still gets the reading rules, without a numbers block", /HOW TO READ THE CONTRACTOR'S BRIEF/.test(buildLegacyEstimatePrompt({ description: "repaint the front porch", qualityTier: "standard" }).prompt) && !/THE NUMBERS THIS BRIEF STATES/.test(buildLegacyEstimatePrompt({ description: "repaint the front porch", qualityTier: "standard" }).prompt));
  ok("briefRulesBlock names the run for a linear job", /Run: 120 linear ft/.test(briefRulesBlock(readBrief("120 lf of fence"))));
}

// ── Holding the reply to the brief ──────────────────────────────────────────
// The model's reply from the Kirkland job, as the old parser saw it.
const DRIFTED = JSON.stringify({
  title: "Epoxy Flooring Installation",
  summary: "Installation of a full flake epoxy flooring system with a polyaspartic topcoat over 450 sqft of new concrete in Kirkland, WA.",
  scope: [
    "Prepare and clean 450 sqft of new concrete substrate, including moisture testing and surface profiling.",
    "Install a full flake epoxy flooring system with a polyaspartic topcoat for enhanced durability and aesthetics.",
    "Ensure proper curing and return-to-service procedures are followed for optimal performance.",
  ],
  timeline: "3 days",
  pricing: {
    currency: "USD",
    lineItems: [
      { name: "Epoxy Flooring System Installation", measurementType: "sqft", sqft: 450, unitPrice: 8.5, materialCost: 2025, laborCost: 1800, total: 3825 },
      { name: "Final Cleanup and Return-to-Service", measurementType: "fixed", quantity: 1, fixedPrice: 800, materialCost: 100, laborCost: 700, total: 800 },
      { name: "Substrate Preparation and Moisture Testing", measurementType: "sqft", sqft: 450, unitPrice: 2.5, materialCost: 225, laborCost: 900, total: 1125 },
      { name: "Moisture vapor barrier primer", measurementType: "sqft", sqft: 450, unitPrice: 1.2, materialCost: 340, laborCost: 200, total: 540 },
    ],
    notes: ["Pricing assumes a sound slab."],
  },
});
{
  const facts = readBrief(KIRKLAND);
  const { specialty } = specialtyFor({ description: KIRKLAND });
  const parsed = legacyEstimateFromText(DRIFTED, specialty);
  ok("The old parser reads the drifted reply", parsed.items.length === 4 && parsed.items[0].quantity === 450, `${parsed.items.length} lines · ${parsed.items[0]?.quantity} sqft`);
  const scrub = scrubUnaskedWork(parsed.items, KIRKLAND, specialty.id);
  ok("Moisture testing comes off the prep line; the vapor-barrier primer line is dropped", scrub.lines.length === 3 && scrub.lines[2].name === "Substrate Preparation" && scrub.dropped.length === 1, scrub.lines.map((l) => l.name).join(" | "));
  ok("A wet or new slab keeps the moisture work", scrubUnaskedWork(parsed.items, "400 sq ft flake epoxy on a new slab poured last month", specialty.id).lines.length === 4);
  const bound = bindLinesToBrief(scrub.lines, facts);
  const total = bound.lines.reduce((a, l) => a + l.quantity * (l.materialUnitPrice + l.laborUnitPrice), 0);
  ok("Every sqft line is 400 sq ft, not the 450 the model made of it", bound.lines.filter((l) => l.unit === "sqft").every((l) => l.quantity === 400) && bound.snapped.length === 1, JSON.stringify(bound.snapped));
  ok("The lines add up to exactly $4,000.00 at 0% markup", Math.abs(total - 4000) < 0.005 && bound.fitted && bound.sellTotal === 4000, `$${total.toFixed(2)}`);
  ok("The split between steps survives the fit (prep is still the smaller line)", bound.lines[2].materialUnitPrice + bound.lines[2].laborUnitPrice < bound.lines[0].materialUnitPrice + bound.lines[0].laborUnitPrice);
  ok("Prices stay in whole cents", bound.lines.every((l) => Number.isInteger(Math.round(l.materialUnitPrice * 100)) && Math.abs(l.materialUnitPrice * 100 - Math.round(l.materialUnitPrice * 100)) < 1e-6));
  ok("The sheet says what was held", bound.notes.some((n) => /Priced to 400 sq ft × \$10\.00\/sq ft: the proposal totals \$4,000\.00 before tax\./.test(n)) && bound.notes.some((n) => /Quantities follow the brief: 400 sq ft/.test(n)), bound.notes.join(" ‖ "));
  // With a shop markup the proposal (sell) lands on the number, and the sheet shows the cost side.
  const mk = { materialMarkupPct: 20, laborMarkupPct: 10 };
  const b2 = bindLinesToBrief(scrub.lines, facts, mk);
  const sell = b2.lines.reduce((a, l) => a + l.quantity * (l.materialUnitPrice * 1.2 + l.laborUnitPrice * 1.1), 0);
  const cost = b2.lines.reduce((a, l) => a + l.quantity * (l.materialUnitPrice + l.laborUnitPrice), 0);
  ok("With 20%/10% markup the proposal still reads $4,000.00 and the costs sit under it", Math.abs(sell - 4000) < 0.011 && cost < 4000 && /already includes your 20% material and 10% labor markup/.test(b2.notes.join(" ")), `sell $${sell.toFixed(2)} · cost $${cost.toFixed(2)}`);
  ok("Text follows the quantity: 450 sqft reads 400 sq ft", bindTextToBrief(parsed.scope, bound.snapped).includes("400 sq ft") && !/450/.test(bindTextToBrief(parsed.scope, bound.snapped)));
  const scope = scrubUnaskedText(bindTextToBrief(parsed.scope, bound.snapped), KIRKLAND, specialty.id);
  ok("Moisture testing leaves the scope bullets too", !/moisture/i.test(scope) && /surface profiling/.test(scope), scope.split("\n")[2]);
  // No price stated: the quantity still snaps and the line total is kept.
  const b3 = bindLinesToBrief(scrub.lines, readBrief("install 400 sq ft full flake epoxy with polyaspartic top coat"));
  ok("Without a price the model's money stays (to the cent per unit), only the quantity moves", !b3.fitted && b3.lines[0].quantity === 400 && Math.abs(b3.lines[0].quantity * (b3.lines[0].materialUnitPrice + b3.lines[0].laborUnitPrice) - 3825) < 4, `$${(b3.lines[0].quantity * (b3.lines[0].materialUnitPrice + b3.lines[0].laborUnitPrice)).toFixed(2)}`);
  // A second area in the same job is not the floor.
  const walls = bindLinesToBrief([{ name: "Paint walls", unit: "sqft", quantity: 1100, materialUnitPrice: 0.5, laborUnitPrice: 1.5 }, { name: "Paint ceiling", unit: "sqft", quantity: 400, materialUnitPrice: 0.5, laborUnitPrice: 1.5 }], readBrief("paint a 400 sq ft room, walls and ceiling"));
  ok("A line twice the stated area is another surface and is left alone", walls.lines[0].quantity === 1100 && walls.snapped.length === 0);
  // The refine shape: material and labor rows sharing an id.
  const est: GeneratedEstimate = {
    title: "Fence", scope: "", assumptions: [],
    materials: [{ id: "a", name: "Cedar fence 6 ft", quantity: 120, unit: "linear ft", unitPrice: 22 }, { id: "b", name: "Gates", quantity: 2, unit: "unit", unitPrice: 180 }],
    labor: [{ id: "a", name: "Cedar fence 6 ft", quantity: 120, unit: "linear ft", unitPrice: 18 }, { id: "c", name: "Tear out old fence", quantity: 1, unit: "fixed", unitPrice: 450 }],
  };
  const held = bindEstimateToBrief(est, readBrief("make it $6,000 total"));
  const estTotal = est.materials.reduce((a, m) => a + m.quantity * m.unitPrice, 0) + est.labor.reduce((a, l) => a + l.quantity * l.unitPrice, 0);
  ok("A refine's 'make it $6,000 total' lands both rows of every line on the number", Math.abs(estTotal - 6000) < 0.005 && held.fitted, `$${estTotal.toFixed(2)}`);
}

// ── The intake gate: only what moves the price ──────────────────────────────
{
  const qs = [
    { id: "1", question: "What color of full flake epoxy do you prefer?", kind: "select" as const, options: ["Gray", "Tan"] },
    { id: "2", question: "What is the current condition of the slab?", why: "Cracks or an old coating add grinding and repair.", kind: "select" as const, options: ["Bare, sound concrete", "Cracks or pits to fill", "Existing coating to remove"] },
    { id: "3", question: "Is there easy access to the installation site?", kind: "select" as const, options: ["Yes", "No"] },
    { id: "4", question: "How many square feet is the floor?", kind: "number" as const, unit: "sqft" },
    { id: "5", question: "What price per sq ft do you want to charge?", kind: "number" as const },
    { id: "6", question: "When would you like to start?", kind: "text" as const },
  ];
  const kept = keepCostCritical(qs, KIRKLAND);
  ok("Color, access, schedule, and anything the brief states are dropped; the slab condition stays", kept.length === 1 && kept[0].id === "2", kept.map((q) => q.id).join(","));
  ok("With no area in the brief the size question is a fair one", keepCostCritical(qs, "flake epoxy garage floor").some((q) => q.id === "4"));
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
