// The company's own estimating method (lib/estimate/companyPricing, 2026-10-16): off by default, labor by the
// crew-hour or person-hour, materials markup, overhead/profit, and the sales-tax rule — and the screens' totals and
// the parser that carry it.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/company-pricing.check.ts
import {
  DEFAULT_COMPANY_PRICING,
  applyCompanyPricing,
  cleanCompanyPricing,
  companyPricingActive,
  hoursPromptBlock,
  materialsTaxLine,
  overheadProfitFactor,
  parseCompanyPricing,
  pricingWords,
  snapshotOf,
  type CompanyPricing,
} from "../../../src/lib/estimate/companyPricing";
import { computeTotals, estimateFromLines, linesFromEstimate, pairEstimateLines } from "../../../src/lib/estimate/console-model";
import { parseAiDraftResponse } from "../../../src/lib/estimate/legacy/parse";
import { measureWords } from "../../../src/lib/measureWords";
import { pricingSnapshotSchema, estimateSchema } from "../../../src/lib/estimatorSchema";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const near = (a: number, b: number) => Math.abs(a - b) < 0.006;

// ── The switch and its numbers ──────────────────────────────────────────
check("off by default", DEFAULT_COMPANY_PRICING.on === false && parseCompanyPricing(null).on === false && cleanCompanyPricing({}).on === false);
check("a broken stored value reads as the default (off)", parseCompanyPricing("{not json").on === false);
check("on with no rate prices nothing", !companyPricingActive(cleanCompanyPricing({ on: true, laborRate: 0 })));
check("on with a rate is active; off with a rate is not", companyPricingActive(cleanCompanyPricing({ on: true, laborRate: 220 })) && !companyPricingActive(cleanCompanyPricing({ on: false, laborRate: 220 })));
const clamped = cleanCompanyPricing({ on: true, laborBasis: "weird", crewSize: 99, laborRate: "-5", materialMarkupPct: 999, overheadPct: -3, profitPct: "12.345", taxMode: "x", taxRatePct: 55 });
check("clean clamps every number and drops unknown words", clamped.laborBasis === "crew" && clamped.crewSize === 20 && clamped.laborRate === 0 && clamped.materialMarkupPct === 300 && clamped.overheadPct === 0 && clamped.profitPct === 12.35 && clamped.taxMode === "job" && clamped.taxRatePct === 30, JSON.stringify(clamped));
check("a blank tax rate means the job state's rate (null)", cleanCompanyPricing({ taxRatePct: "" }).taxRatePct === null && cleanCompanyPricing({ taxRatePct: null }).taxRatePct === null);
check("clean is idempotent (the form and the action agree)", JSON.stringify(cleanCompanyPricing(clamped)) === JSON.stringify(clamped));

// The customer's own method: 2-person crew at $220 per crew-hour, 30% on materials, no overhead or profit, tax on materials.
const doneRight: CompanyPricing = cleanCompanyPricing({ on: true, laborBasis: "crew", crewSize: 2, laborRate: 220, materialMarkupPct: 30, taxMode: "materials" });
check("words say it the company's way", pricingWords(doneRight) === "2-person crew at $220 per crew-hour · materials +30% · no overhead or profit · sales tax on materials only at the state rate", pricingWords(doneRight));
const perPerson = cleanCompanyPricing({ on: true, laborBasis: "person", crewSize: 3, laborRate: 95, overheadPct: 10, profitPct: 15, taxMode: "none" });
check("…and per person", pricingWords(perPerson) === "$95 per person-hour, 3-person crew · materials at cost · overhead 10% · profit 15% · no sales tax", pricingWords(perPerson));
check("the model is told the hours unit — crew-hours for the crew", /CREW-HOURS for this company's crew of 2/.test(hoursPromptBlock(doneRight)) && /"laborHours"/.test(hoursPromptBlock(doneRight)));
check("…person-hours for a per-person rate", /PERSON-HOURS/.test(hoursPromptBlock(perPerson)) && /3 people working 3 hours = 9 person-hours/.test(hoursPromptBlock(perPerson)));
check("overhead then profit, the proposal's chain", near(overheadProfitFactor(perPerson), 1.1 * 1.15));

// ── Pricing the estimate's items ────────────────────────────────────────
let n = 0;
// The server's ids: "i<task number>-<random>".
const idFor = () => `i${++n}-x`;
const items = [
  { name: "Composite decking", unit: "sq ft", quantity: 300, materialUnitPrice: 6, laborUnitPrice: 4, laborHours: 14 },
  { name: "Demo old deck", unit: "sq ft", quantity: 300, materialUnitPrice: 0, laborUnitPrice: 1.3 },
  { name: "Building permit", unit: "fixed", quantity: 1, materialUnitPrice: 350, laborUnitPrice: 0 },
  { name: "Dumpster", unit: "each", quantity: 1, materialUnitPrice: 480, laborUnitPrice: 0 },
];
const priced = applyCompanyPricing(items, doneRight, idFor);
const deckMat = priced.materials.find((m) => m.name === "Composite decking");
const deckLab = priced.labor.find((l) => l.name.startsWith("Labor · Composite decking"));
check("materials: cost × (1 + 30%)", !!deckMat && deckMat.unitPrice === 7.8 && deckMat.quantity === 300 && deckMat.unit === "sq ft", JSON.stringify(deckMat));
check("labor: its own row, in crew-hours, at the company's rate", !!deckLab && deckLab.id === "i1-x-L" && deckLab.unit === "hour" && deckLab.quantity === 14 && deckLab.unitPrice === 220 && deckLab.name === "Labor · Composite decking (crew-hours)", JSON.stringify(deckLab));
const demoLab = priced.labor.find((l) => l.name.startsWith("Labor · Demo"));
// $1.30 × 300 = $390 of book labor ÷ $65 = 6 person-hours ÷ 2 people = 3 crew-hours.
check("no hours from the model: worked out from the book's labor, and the line says so", !!demoLab && demoLab.quantity === 3 && /check them/.test(demoLab.notes ?? "") && priced.derivedHours === 1, JSON.stringify(demoLab));
check("labor-only work has no materials row", !priced.materials.some((m) => m.name === "Demo old deck"));
const permit = priced.materials.find((m) => m.name === "Building permit");
check("a permit is passed through at cost, no markup, no labor row", !!permit && permit.unitPrice === 350 && !priced.labor.some((l) => l.name.includes("permit")));
check("a dumpster is a material with the markup", priced.materials.find((m) => m.name === "Dumpster")?.unitPrice === 624);
const op = applyCompanyPricing([items[0]], cleanCompanyPricing({ ...doneRight, overheadPct: 10, profitPct: 10 }), () => "x");
check("overhead and profit ride inside both prices", op.materials[0].unitPrice === Math.round(7.8 * 1.21 * 100) / 100 && op.labor[0].unitPrice === Math.round(220 * 1.21 * 100) / 100);
const pp = applyCompanyPricing([items[1]], perPerson, () => "y");
check("per person: derived hours are person-hours (not split by the crew)", pp.labor[0].quantity === 6 && pp.labor[0].name.endsWith("(person-hours)"));
const tiny = applyCompanyPricing([{ name: "Caulk", unit: "each", quantity: 1, materialUnitPrice: 0, laborUnitPrice: 2 }], doneRight, () => "z");
check("hours never round to nothing (quarter-hour floor)", tiny.labor[0].quantity === 0.25);

// ── The rows on screen and on the proposal ──────────────────────────────
const est = estimateSchema.parse({ title: "Deck", scope: "Deck", materials: priced.materials, labor: priced.labor, assumptions: [], pricing: snapshotOf(doneRight) });
check("the snapshot passes the wire schema", pricingSnapshotSchema.safeParse(snapshotOf(doneRight)).success && est.pricing?.laborRate === 220);
const pairs = pairEstimateLines(est);
check("a labor row never folds into its material row (hours ≠ square feet)", pairs.every((p) => !(p.material && p.labor)), JSON.stringify(pairs.map((p) => [p.material?.id, p.labor?.id])));
const order = pairs.map((p) => (p.material ?? p.labor)!.id);
check("each task's labor reads right under its materials; a labor-only task keeps its place", JSON.stringify(order) === JSON.stringify(["i1-x", "i1-x-L", "i2-x-L", "i3-x", "i4-x"]), JSON.stringify(order));
const plain = pairEstimateLines({
  materials: [{ id: "a", name: "Shingles", quantity: 30, unit: "squares", unitPrice: 120 }, { id: "b", name: "Dumpster", quantity: 1, unit: "fixed", unitPrice: 480 }],
  labor: [{ id: "c", name: "Haul-off", quantity: 1, unit: "fixed", unitPrice: 200 }, { id: "a", name: "Shingles", quantity: 30, unit: "squares", unitPrice: 90 }],
});
check("…an estimate priced the usual way keeps its order and pairs", JSON.stringify(plain.map((p) => [p.material?.id ?? null, p.labor?.id ?? null])) === JSON.stringify([["a", "a"], ["b", null], [null, "c"]]));
const lines = linesFromEstimate(est);
check("on screen too: the labor line sits under its task", lines.findIndex((l) => l.id === "i1-x-L") === lines.findIndex((l) => l.id === "i1-x") + 1);
const labLine = lines.find((l) => l.id === "i1-x-L");
check("on screen: the labor line reads in hours at the rate", !!labLine && labLine.unit === "hour" && labLine.qty === 14 && labLine.laborPrice === 220 && labLine.materialPrice === 0);
const back = estimateFromLines(lines, { title: "Deck", scope: "Deck", assumptions: [] });
check("screen → wire keeps the separate rows", back.labor.some((l) => l.id === "i1-x-L" && l.unit === "hour") && !back.labor.some((l) => l.id === "i1-x"));

const again = pairEstimateLines(estimateFromLines(lines, { title: "Deck", scope: "Deck", assumptions: [] })).map((p) => (p.material ?? p.labor)!.id);
check("…and the order survives screen → save → proposal", JSON.stringify(again) === JSON.stringify(order), JSON.stringify(again));

// ── The client's words for the measurement ──────────────────────────────
check("16 hours, 1 hour", measureWords("HOUR", 16) === "hours" && measureWords("HOUR", 1) === "hour" && measureWords("HOUR", 2.5) === "hours");
check("2 units, 24 squares; sqft and lump sum as they were", measureWords("UNIT", 2) === "units" && measureWords("SQUARE", 24) === "squares" && measureWords("SQFT", 600) === "sqft" && measureWords("LUMP_SUM", 1) === "lump sum" && measureWords(null, 3) === null);

// ── Sales tax on materials only ─────────────────────────────────────────
const tl = (materials: number, labor: number) => [
  { id: "m", name: "M", qty: 1, unit: "fixed", materialPrice: materials, laborPrice: 0 },
  { id: "l", name: "L", qty: 1, unit: "fixed", materialPrice: 0, laborPrice: labor },
];
const all = computeTotals({ lines: tl(1000, 3000), taxPct: 10 });
const mat = computeTotals({ lines: tl(1000, 3000), taxPct: 10, taxOn: "materials" });
check("whole job: tax on everything", near(all.taxCash, 400));
check("materials only: tax on the materials' share", near(mat.taxCash, 100) && near(mat.total, 4100));
const matDisc = computeTotals({ lines: tl(1000, 3000), taxPct: 10, taxOn: "materials", discount: { mode: "amt", value: 400 } });
check("…after a dollar discount, the share of the discounted price", near(matDisc.taxCash, 90));
check("the proposal's tax line matches the screen (no discount)", materialsTaxLine({ materialsTotal: 1000, subtotal: 4000, discount: null, ratePct: 10 }) === 100);
check("…with a dollar discount", materialsTaxLine({ materialsTotal: 1000, subtotal: 4000, discount: { amount: 400, isPercent: false }, ratePct: 10 }) === 90);
check("…a percent discount is left to the proposal (it takes it off every line)", materialsTaxLine({ materialsTotal: 1000, subtotal: 4000, discount: { amount: 10, isPercent: true }, ratePct: 10 }) === 100);
check("no rate or no materials: no tax line", materialsTaxLine({ materialsTotal: 0, subtotal: 4000, discount: null, ratePct: 10 }) === 0 && materialsTaxLine({ materialsTotal: 1000, subtotal: 4000, discount: null, ratePct: 0 }) === 0);

// ── The estimator's hours reach the line ────────────────────────────────
const raw = JSON.stringify({ title: "T", summary: "S", pricing: { lineItems: [{ name: "Framing", quantity: 1, unit: "fixed", materialCost: 100, laborCost: 400, laborHours: 3.5 }, { name: "Paint", quantity: 1, unit: "fixed", materialCost: 50, laborCost: 0 }] } });
const parsed = parseAiDraftResponse(raw).draft.pricing?.lineItems ?? [];
check("laborHours is parsed when given, absent when not", parsed[0]?.laborHours === 3.5 && parsed[1] && !("laborHours" in parsed[1]), JSON.stringify(parsed));

console.log(bad ? `\n${bad} FAILED` : "\nall good");
process.exit(bad ? 1 : 0);
