// The price book (2026-09-18): every step of every specialty's procedure
// carries a researched price, the prompt shows each as the contractor's
// cost, and a whole job of stated size gets the trade's benchmark range —
// asked again when a reply falls far under it. No model call.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/step-prices.check.ts
import { formatProcedureBlock, PROCEDURE_UNITS, SPECIALTY_PROCEDURES } from "../../../src/lib/estimate/procedures";
import {
  priceMoney,
  pricesFor,
  SPECIALTY_PRICES,
  specialtyRange,
  STEP_PRICE_HEADER,
  stepCost,
  stepCostText,
  toCost,
  type StepPrice,
} from "../../../src/lib/estimate/step-prices";
import { buildLegacyEstimatePrompt } from "../../../src/lib/estimate/legacy-estimate";
import { getAiSpecialtyByIdSync } from "../../../src/lib/estimate/legacy/specialties";
import { retryReasons } from "../../../src/lib/estimate/remodel-sanity";
import { readBrief } from "../../../src/lib/estimate/brief";
import { locationIndex } from "../../../src/lib/estimate/location-index";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const first = (xs: string[], n = 6) => (xs.length ? `${xs.length}: ${xs.slice(0, n).join(" | ")}` : "");

// ── Coverage ────────────────────────────────────────────────────────────────
const ids = Object.keys(SPECIALTY_PROCEDURES);
const stepTotal = ids.reduce((a, id) => a + SPECIALTY_PROCEDURES[id].steps.length, 0);
check(`every specialty with a procedure has a price book (${ids.length})`, ids.every((id) => SPECIALTY_PRICES[id]), first(ids.filter((id) => !SPECIALTY_PRICES[id])));
check("no price book for a specialty without a procedure", Object.keys(SPECIALTY_PRICES).every((id) => SPECIALTY_PROCEDURES[id]), first(Object.keys(SPECIALTY_PRICES).filter((id) => !SPECIALTY_PROCEDURES[id])));
const unpriced: string[] = [];
const stale: string[] = [];
for (const id of ids) {
  const book = SPECIALTY_PRICES[id];
  if (!book) continue;
  const items = new Set(SPECIALTY_PROCEDURES[id].steps.map((s) => s.item.trim()));
  for (const s of SPECIALTY_PROCEDURES[id].steps) if (!book.steps[s.item.trim()]) unpriced.push(`${id}: ${s.item.slice(0, 50)}`);
  for (const k of Object.keys(book.steps)) if (!items.has(k)) stale.push(`${id}: ${k.slice(0, 50)}`);
}
check(`every procedure step is priced (${stepTotal} steps)`, unpriced.length === 0, first(unpriced));
check("no price for a step the procedure no longer has", stale.length === 0, first(stale));

// ── The data holds together ─────────────────────────────────────────────────
const malformed: string[] = [];
const offCheck: string[] = [];
const basis = { src: 0, derived: 0, est: 0 };
const free: string[] = [];
for (const [id, book] of Object.entries(SPECIALTY_PRICES)) {
  const b = book.benchmark;
  if (!(book.op >= 0.05 && book.op <= 0.7)) malformed.push(`${id}: op ${book.op}`);
  if (!(PROCEDURE_UNITS as readonly string[]).includes(b.unit)) malformed.push(`${id}: benchmark unit ${b.unit}`);
  if (!(b.price[0] > 0 && b.price[0] <= b.price[1])) malformed.push(`${id}: benchmark price ${b.price}`);
  if (!(b.typicalQty[0] > 0 && b.typicalQty[0] <= b.typicalQty[1])) malformed.push(`${id}: typicalQty ${b.typicalQty}`);
  if (!b.sources.length || !b.measures.trim()) malformed.push(`${id}: sources or measures missing`);
  if (!(b.jobQty && b.jobQty > 0)) malformed.push(`${id}: jobQty missing`);
  let total = 0;
  for (const [item, p] of Object.entries(book.steps)) {
    basis[p.basis]++;
    if (p.price[1] === 0) free.push(`${id}: ${item.slice(0, 40)}`);
    if (!(p.price[0] >= 0 && p.price[0] <= p.price[1])) malformed.push(`${id}: ${item.slice(0, 40)} price ${p.price}`);
    if (!(p.labor >= 0 && p.labor <= 1)) malformed.push(`${id}: ${item.slice(0, 40)} labor ${p.labor}`);
    if (p.q) total += p.q * ((p.price[0] + p.price[1]) / 2);
  }
  // The self-check the research ran, run again: the typical job built from
  // the step prices lands inside the trade's all-in benchmark (±15%).
  const per = b.unit === "fixed" ? total : total / (b.jobQty ?? 1);
  if (!(per >= b.price[0] * 0.85 && per <= b.price[1] * 1.15)) offCheck.push(`${id}: ${per.toFixed(2)} vs ${b.price[0]}-${b.price[1]} per ${b.unit}`);
}
check("every price, labor share, markup and benchmark is well formed", malformed.length === 0, first(malformed));
check("every specialty's typical job, built from its step prices, lands inside its benchmark", offCheck.length === 0, first(offCheck));
console.log(`     basis: ${basis.src} sourced, ${basis.derived} derived, ${basis.est} estimated`);
check("only a handful of steps are free (a quote, a warranty)", free.length <= 8, first(free));

// ── Customer price to contractor cost ───────────────────────────────────────
const step: StepPrice = { price: [100, 200], labor: 0.6, basis: "src" };
const c = stepCost(step, 0.25);
check("a price less 25% overhead and profit is the cost; labor and material split it", c.total[0] === 80 && c.total[1] === 160 && c.labor[0] === 48 && c.material[1] === 64);
check("a fee passes through without markup", stepCost({ price: [150, 450], labor: 0, fee: true, basis: "src" }, 0.25).total[1] === 450 && toCost(450, 0.25, true) === 450);
check("the step text: cost per unit, material plus labor", stepCostText("unit", step, 0.25) === "cost $80-$160 each (material $32-$64 + labor $48-$96)", stepCostText("unit", step, 0.25));
check("labor-only and fee steps say so", stepCostText("hour", { price: [100, 150], labor: 1, basis: "src" }, 0.25) === "cost $80-$120 per hour, labor" && /^fee \$150-\$450 for the line, passed through/.test(stepCostText("fixed", { price: [150, 450], labor: 0, fee: true, basis: "src" }, 0.25)));
check("money prints cents under $10, dollars under $1,000, tens above", priceMoney(1.234) === "$1.23" && priceMoney(412.4) === "$412" && priceMoney(12344) === "$12,340");

// ── The prompt carries a cost on every step ─────────────────────────────────
const blockMiss: string[] = [];
for (const id of ids) {
  const book = pricesFor(id);
  if (!book) continue;
  const proc = SPECIALTY_PROCEDURES[id];
  const block = formatProcedureBlock(id, proc, undefined, { prices: book });
  const costed = block.split("\n").filter((l) => /^\s+\d+\. \[/.test(l) && / · ((cost|fee) \$|no charge$)/.test(l)).length;
  if (!block.includes(STEP_PRICE_HEADER) || costed !== proc.steps.length) blockMiss.push(`${id}: ${costed}/${proc.steps.length}`);
}
check("every specialty's procedure block carries the price book header and a cost on every step", blockMiss.length === 0, first(blockMiss));
const sewer = SPECIALTY_PROCEDURES["sanitary-sewer"];
const edited = { ...sewer, steps: [{ ...sewer.steps[0], item: `${sewer.steps[0].item} (edited)` }, ...sewer.steps.slice(1)] };
const editedBlock = formatProcedureBlock("Sanitary Sewer Contractor", edited, undefined, { prices: pricesFor("sanitary-sewer") });
check("an admin-edited step goes unpriced, never mispriced", !/\(edited\) — \w[^\n]* · (cost|fee) /.test(editedBlock) && editedBlock.includes("(edited)"));
check("no price book, no header and no costs", !formatProcedureBlock("X", sewer).includes(STEP_PRICE_HEADER) && !/ · (cost|fee) \$/.test(formatProcedureBlock("X", sewer)));
const roof = buildLegacyEstimatePrompt({ description: "Replace the roof, 2400 sqft architectural shingles", location: "Bothell, WA" });
check("a roof brief's prompt carries the price book on its steps", roof.prompt.includes(STEP_PRICE_HEADER) && !!roof.priced && roof.priced.steps === roof.priced.of && roof.priced.of > 0, JSON.stringify(roof.priced));

// ── The trade's benchmark range ─────────────────────────────────────────────
const ranged: Array<[string, string, string]> = [
  ["fencing", "Build a 6 ft cedar privacy fence around the backyard, about 180 feet with one gate", "Spokane, WA"],
  ["roofing", "Replace the roof, 2400 sqft architectural shingles", "Bothell, WA"],
  ["epoxy-flooring", "Epoxy flake floor in a 2-car garage, 450 sq ft", "Dallas, TX"],
  ["painting", "Paint the whole interior, walls and ceilings, about 1800 sq ft", "Denver, CO"],
];
for (const [id, brief, loc] of ranged) {
  const built = buildLegacyEstimatePrompt({ description: brief, location: loc });
  const book = pricesFor(id);
  if (!book) {
    check(`${id}: price book present`, false);
    continue;
  }
  const spec = getAiSpecialtyByIdSync(id)!;
  const want = specialtyRange(spec, readBrief(brief), loc);
  const factor = locationIndex(loc).factor;
  const expectLow = want ? Math.round(Math.max(toCost(book.benchmark.price[0], book.op) * factor * want.qty, book.benchmark.minJob ? toCost(book.benchmark.minJob, book.op) * factor : 0) / 100) * 100 : null;
  check(
    `${id}: "${brief.slice(0, 44)}…" in ${loc} → specialty ${built.specialty.id}, a ${book.benchmark.unit} range at cost`,
    built.specialty.id === id && built.range?.kind === "specialty" && built.range.low === expectLow && built.prompt.includes("THIS BRIEF'S RANGE:") && built.prompt.includes("at contractor cost, before markup (the price book's benchmark"),
    `${built.specialty.id} ${JSON.stringify(built.range)}`,
  );
}
const street = buildLegacyEstimatePrompt({ description: "Run sewer in the street 300 linear feet", location: "Lynnwood, WA" });
check("the owner's street sewer: the side-sewer book's step costs stay out, the street main's bid prices govern", street.specialty.id === "sanitary-sewer" && street.priced === null && !street.prompt.includes(STEP_PRICE_HEADER) && street.range?.kind === "utility" && street.prompt.includes("PVC sewer pipe 8 in."), JSON.stringify(street.priced));
const lateral = buildLegacyEstimatePrompt({ description: "replace 40 ft of sewer lateral in the yard", location: "Spokane, WA" });
check("a side sewer in a yard keeps the sanitary-sewer book's step costs", lateral.utilityJob === "side-sewer-yard" && !!lateral.priced && lateral.priced.steps === lateral.priced.of && lateral.prompt.includes(STEP_PRICE_HEADER), `${lateral.specialty.id} ${JSON.stringify(lateral.priced)}`);
const fence = buildLegacyEstimatePrompt({ description: ranged[0][1], location: ranged[0][2] });
check("the fence's range reads the run, not the 6 ft height", fence.range?.kind === "specialty" && fence.range.qty === 180);
check("a stated price has no range", buildLegacyEstimatePrompt({ description: "Build a cedar privacy fence, 180 feet, total $9,000", location: "Spokane, WA" }).range === null);
check("no stated size, no range", buildLegacyEstimatePrompt({ description: "Build a cedar privacy fence around the backyard", location: "Spokane, WA" }).range === null);
check("a remodel keeps its own range and a sewer its utility range", buildLegacyEstimatePrompt({ description: "Full bathroom remodel, 8x10 hall bath", location: "Kirkland, WA" }).range?.kind !== "specialty" && buildLegacyEstimatePrompt({ description: "Run sewer in the street 300 linear feet", location: "Dallas, TX" }).range?.kind === "utility");
if (fence.range) {
  const low = fence.range.low;
  check("a reply at half the fence's range is asked again with the price book named; one at the range stands",
    retryReasons({ lines: 20, coreSteps: 12, total: low * 0.5, range: fence.range }).some((r) => /PRICE BOOK'S BENCHMARK/.test(r)) &&
    retryReasons({ lines: 20, coreSteps: 12, total: low, range: fence.range }).length === 0);
}

console.log(bad ? `\n${bad} check(s) FAILED` : "\nall checks passed");
process.exit(bad ? 1 : 0);
