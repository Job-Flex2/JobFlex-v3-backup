// Synthetic check of the manual proposal's money — no browser, no database.
//   npx tsx --tsconfig tsconfig.json qa/tests/logic/proposal-money.check.ts
// The sheet the client sees and the lines the server stores are priced by one
// chain (markup → overhead → profit, spread into per-unit prices): the printed
// column adds up to the subtotal, "Labor + material breakdown" halves add up to
// each line, the cost sliders reach every line, and the stored line prices
// agree with the sheet to the cent (the 2026-09-17 finding: overhead and
// profit never reached the saved proposal).
import { computeTotals, bakeAdjustments } from "../../../src/components/v3/manual-card-lab/manual-focus/manual-focus-math";
import type { Draft, Line } from "../../../src/components/v3/manual-card-lab/manual-focus/manual-focus-types";
import { clientSplit, overheadProfitLoad, priceLinesForClient, splitCaption } from "../../../src/lib/pricing/markup";

let failures = 0;
let passes = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) passes++;
  else failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

const line = (id: string, name: string, unit: Line["unit"], quantity: number, materialCost: number, laborCost: number): Line => ({ id, name, description: "", unit, quantity, materialCost, laborCost });

// The Kirkland epoxy sheet: 400 sq ft of prep, coating and a fixed cleanup.
const LINES: Line[] = [
  line("a", "Diamond-grind and prep the slab", "sqft", 400, 0.35, 1.4),
  line("b", "Full flake epoxy with polyaspartic topcoat", "sqft", 400, 3.4, 4.25),
  line("c", "Masking, protection and final cleanup", "fixed", 1, 40, 260),
  line("d", "", "sqft", 100, 9, 9), // unnamed: not work yet
];

function draft(over: Partial<Draft> = {}): Draft {
  return {
    title: "Epoxy floor", description: "", projectId: "", client: { mode: "none" }, address: "", addressAuto: true,
    lines: LINES, taxPct: 6.5, taxAuto: false, taxState: "",
    materialMarkupPct: 0, laborMarkupPct: 0, overheadPct: 0, profitPct: 0,
    discountPct: 0, discountFlat: 0, discountIsPercent: true,
    scopeOfWork: "", notes: "", terms: "",
    options: { hideBreakdown: false, laborOnly: false, showSignature: true, showScope: true },
    installments: [], files: [],
    ...over,
  } as Draft;
}

const sum = (ns: number[]) => Math.round(ns.reduce((a, b) => a + b, 0) * 100) / 100;

// ── The sheet at neutral ────────────────────────────────────────────────────
{
  const t = computeTotals(draft());
  ok("Neutral: printed prices are the raw costs and the column is the subtotal", t.printed[0].unitPrice === 1.75 && t.printed[1].unitPrice === 7.65 && t.preTax === sum(t.printed.map((p) => p.amount)) && t.preTax === 4060, `$${t.preTax}`);
  ok("Materials are in the price (no labor-only mode in the blueprint)", t.baseMaterials === 1540 && t.subtotalCosts === 4060, `${t.baseMaterials} / ${t.subtotalCosts}`);
  ok("Every printed line's labor + material halves add up to its amount", t.printed.every((p) => sum([p.materialAmount, p.laborAmount]) === p.amount), t.printed.map((p) => `${p.materialAmount}+${p.laborAmount}=${p.amount}`).join(" | "));
  ok("The unnamed row prints nothing and counts for nothing", t.printed.length === 3 && t.unnamedCount === 1);
}

// ── Overhead and profit spread into the lines ───────────────────────────────
{
  const t = computeTotals(draft({ overheadPct: 10, profitPct: 10 }));
  const chain = Math.round((4060 * 1.1 * 1.1 + Number.EPSILON) * 100) / 100;
  ok("10% overhead + 10% profit: pre-tax is the chain figure, from the printed column", Math.abs(t.preTax - chain) <= 5 && t.preTax === sum(t.printed.map((p) => p.amount)), `$${t.preTax} vs chain $${chain} (cents quantised per unit)`);
  ok("Every line multiplies out: quantity × printed unit price = printed amount", t.printed.every((p) => Math.round(p.quantity * p.unitPrice * 100) / 100 === p.amount));
  ok("The breakdown halves still add to each line with the load inside them", t.printed.every((p) => sum([p.materialAmount, p.laborAmount]) === p.amount) && t.printed[1].materialAmount > 1360);
  ok("The load helper reproduces the ledger's chain", overheadProfitLoad(4060, 10, 10) === Math.round((4060 * 1.1 * 1.1 + Number.EPSILON) * 100) / 100 / 4060 && overheadProfitLoad(0, 10, 10) === 1 && overheadProfitLoad(4060, 0, 0) === 1);
}

// ── The cost sliders reach every line ───────────────────────────────────────
{
  const t = computeTotals(draft({ materialMarkupPct: 10, laborMarkupPct: -5 }));
  const prep = t.printed[0];
  ok("Materials +10%, labor −5%: the printed unit price carries both", prep.unitPrice === Math.round((0.35 * 1.1 + 1.4 * 0.95) * 100) / 100, `$${prep.unitPrice}`);
  ok("The ledger's adjustment rows say what the sliders added", t.materialsMarkup === 154 && t.laborMarkup === -126, `${t.materialsMarkup} / ${t.laborMarkup}`);
  const baked = bakeAdjustments(draft({ materialMarkupPct: 10, laborMarkupPct: -5 }));
  const t2 = computeTotals(baked);
  ok("Saving bakes the sliders into every line's costs and returns them to neutral", baked.materialMarkupPct === 0 && baked.laborMarkupPct === 0 && baked.lines[1].materialCost === 3.74 && baked.lines[1].laborCost === 4.04 && Math.abs(t2.preTax - t.preTax) < 0.05, `$${t2.preTax} after vs $${t.preTax} before`);
}

// ── The stored lines agree with the sheet ───────────────────────────────────
{
  for (const [oh, pr, mm, lm] of [[0, 0, 0, 0], [10, 10, 0, 0], [12.5, 8, 0, 0], [15, 20, 10, -5]] as const) {
    const d = draft({ overheadPct: oh, profitPct: pr, materialMarkupPct: mm, laborMarkupPct: lm });
    const t = computeTotals(d);
    // What the builder sends (payloadFromDraft): named lines, raw costs, the four rates.
    const named = d.lines.filter((l) => l.name.trim());
    const stored = priceLinesForClient(named.map((l) => ({ quantity: l.quantity, unitPrice: Math.round((l.materialCost + l.laborCost) * 100) / 100, materialCost: l.materialCost, laborCost: l.laborCost })), { materialMarkupPct: mm, laborMarkupPct: lm, overheadPct: oh, profitPct: pr });
    const subtotal = sum(stored.map((l) => l.total));
    ok(`Server pricing at overhead ${oh}% / profit ${pr}% / sliders ${mm}%,${lm}%: stored unit prices and subtotal equal the sheet's`, stored.every((l, i) => l.unitPrice === t.printed[i].unitPrice && l.total === t.printed[i].amount) && subtotal === t.preTax, `$${subtotal} vs sheet $${t.preTax}`);
  }
  const zero = priceLinesForClient([{ quantity: 3, unitPrice: 12.34, materialCost: 0, laborCost: 0 }], { materialMarkupPct: 0, laborMarkupPct: 0 });
  ok("An unsplit line at 0% keeps its raw unit price", zero[0].unitPrice === 12.34 && zero[0].total === 37.02);
  const loaded = priceLinesForClient([{ quantity: 3, unitPrice: 12.34, materialCost: 0, laborCost: 0 }], { materialMarkupPct: 0, laborMarkupPct: 0, overheadPct: 10, profitPct: 0 });
  ok("An unsplit line still takes the overhead load", loaded[0].unitPrice === 13.57, `$${loaded[0].unitPrice}`);
}


// ── The stored line's client-facing split (portal, PDF routes) ──────────────
{
  const fmt = (n: number) => `$${n.toFixed(2)}`;
  const stored = priceLinesForClient([{ quantity: 400, unitPrice: 7.65, materialCost: 3.4, laborCost: 4.25 }], { materialMarkupPct: 20, laborMarkupPct: 10, overheadPct: 10, profitPct: 5 });
  const split = clientSplit(stored[0], { materialMarkupPct: 20, laborMarkupPct: 10 });
  ok("A stored line's halves carry markup and load and add up to its total", !!split && Math.round((split.materialAmount + split.laborAmount) * 100) / 100 === stored[0].total && split.materialAmount > 400 * 3.4 * 1.2, `${split?.materialAmount} + ${split?.laborAmount} = ${stored[0].total}`);
  ok("The caption reads Materials · Labor", splitCaption(split, fmt) === `Materials ${fmt(split!.materialAmount)} · Labor ${fmt(split!.laborAmount)}`);
  ok("A material-only line (roof, fence, HVAC estimators) shows one side", splitCaption(clientSplit({ total: 500, materialCost: 5, laborCost: 0 }, { materialMarkupPct: 0, laborMarkupPct: 0 }), fmt) === "Materials $500.00");
  ok("A labor-only line shows one side", splitCaption(clientSplit({ total: 300, materialCost: 0, laborCost: 3 }, { materialMarkupPct: 0, laborMarkupPct: 0 }), fmt) === "Labor $300.00");
  ok("A line with no split prints no breakdown", clientSplit({ total: 120, materialCost: 0, laborCost: 0 }, { materialMarkupPct: 0, laborMarkupPct: 0 }) === null && splitCaption(null, fmt) === null);
  // The editor's own printed split and the stored split agree.
  const d = draft({ overheadPct: 10, profitPct: 5 });
  const t = computeTotals(d);
  const named = d.lines.filter((l) => l.name.trim());
  const rows = priceLinesForClient(named.map((l) => ({ quantity: l.quantity, unitPrice: l.materialCost + l.laborCost, materialCost: l.materialCost, laborCost: l.laborCost })), { materialMarkupPct: 0, laborMarkupPct: 0, overheadPct: 10, profitPct: 5 });
  ok("The editor's printed halves and the portal's halves are the same numbers", rows.every((r, i) => { const sp = clientSplit(r, { materialMarkupPct: 0, laborMarkupPct: 0 }); return !!sp && sp.materialAmount === t.printed[i].materialAmount && sp.laborAmount === t.printed[i].laborAmount; }), rows.map((r, i) => `${clientSplit(r, { materialMarkupPct: 0, laborMarkupPct: 0 })?.materialAmount} vs ${t.printed[i].materialAmount}`).join(" | "));
}

// ── Where overhead and profit land in the breakdown ─────────────────────────
{
  const across = computeTotals(draft({ overheadPct: 20, profitPct: 10 }));
  const inLabor = computeTotals(draft({ overheadPct: 20, profitPct: 10, marginOnLabor: true }));
  ok("Same lines, same amounts either way — the choice never moves the price", across.preTax === inLabor.preTax && across.printed.every((p, i) => p.amount === inLabor.printed[i].amount), `$${across.preTax} vs $${inLabor.preTax}`);
  ok("Across both halves: the material half carries the load", across.printed[1].materialAmount > 1360 && across.printed[1].materialAmount + across.printed[1].laborAmount === across.printed[1].amount, `${across.printed[1].materialAmount} + ${across.printed[1].laborAmount}`);
  ok("In labor only: the material half reads at cost and labor carries overhead and profit", inLabor.printed[1].materialAmount === 1360 && inLabor.printed[1].laborAmount === Math.round((inLabor.printed[1].amount - 1360) * 100) / 100 && inLabor.printed[1].laborAmount > 1700, `${inLabor.printed[1].materialAmount} + ${inLabor.printed[1].laborAmount} = ${inLabor.printed[1].amount}`);
  const matOnly = computeTotals(draft({ lines: [line("m", "Shingles supplied", "sqft", 100, 4, 0)], overheadPct: 10, profitPct: 10, marginOnLabor: true }));
  ok("A material-only line keeps overhead and profit in its material price", matOnly.printed[0].materialAmount === matOnly.printed[0].amount && matOnly.printed[0].laborAmount === 0 && matOnly.printed[0].amount > 400, `${matOnly.printed[0].materialAmount} of ${matOnly.printed[0].amount}`);
  // The stored line agrees under both settings.
  const named = LINES.filter((l) => l.name.trim());
  const stored = priceLinesForClient(named.map((l) => ({ quantity: l.quantity, unitPrice: l.materialCost + l.laborCost, materialCost: l.materialCost, laborCost: l.laborCost })), { materialMarkupPct: 0, laborMarkupPct: 0, overheadPct: 20, profitPct: 10 });
  const agree = (t: ReturnType<typeof computeTotals>, onLabor: boolean) => stored.every((r, i) => { const sp = clientSplit(r, { materialMarkupPct: 0, laborMarkupPct: 0 }, { marginOnLabor: onLabor }); return !!sp && sp.materialAmount === t.printed[i].materialAmount && sp.laborAmount === t.printed[i].laborAmount; });
  ok("The portal's halves match the sheet's under both settings", agree(across, false) && agree(inLabor, true));
}
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
