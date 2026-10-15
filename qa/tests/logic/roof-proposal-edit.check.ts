// OPENING A ROOF PROPOSAL AGAIN IN THE ROOF ESTIMATOR (owner, 2026-10-13: "make roofing proposal when open to get
// back to the roofing edit to rebuild it"). Held here without a database: the stored plan read back
// (lib/roofPackage/proposalEdit), the proposal's lines turned back into the estimator's two tables, the units both
// ways, and the whole update payload (lib/deck/proposalUpdate with the roof's units) on a real roof package — the
// estimator's lines swap, the builder's own stay, a hand-typed title stays, the stages and the client come through.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/roof-proposal-edit.check.ts
import { BUILTIN_LISTS } from "../../../src/lib/roofPackage/catalog";
import { buildRoofPackage, defaultSpec, type RoofFacts } from "../../../src/lib/roofPackage/takeoff";
import { readRoofPlan, roofTablesFromProposal, roofUnitType, roofUnitWord, roofUpdateLines } from "../../../src/lib/roofPackage/proposalEdit";
import { deckUpdatePayload, type DeckProposalRow } from "../../../src/lib/deck/proposalUpdate";
import { factsKey } from "../../../src/components/v3/roof-estimator-blueprint/roof-package-builder";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const round2 = (n: number) => Math.round(n * 100) / 100;
const ADDR = "12103 202nd St SE, Snohomish, WA 98296";
const house = (over: Partial<RoofFacts> = {}): RoofFacts => ({
  squares: 32, squaresBasis: "measured", pitchFamilies: [{ pitch12: 7, share: 1 }], pitchBasis: "measured", perimeterFt: 240, footprintSqft: 2700,
  chimney: true, rooftopAcCount: 0, shape: "Gable", facetCount: 6, measured: null, existingMaterial: "Asphalt shingle", facetConfidence: null, buildingUse: null, ...over,
});

// ── units both ways ──
for (const t of ["SQUARE", "SQFT", "LINEAR_FT", "LUMP_SUM", "HOUR", "CUBIC_FT", "UNIT"]) check(`unit ${t} → "${roofUnitWord(t)}" → ${t}`, roofUnitType(roofUnitWord(t)) === t, roofUnitType(roofUnitWord(t)));
check("the package's own words: square, ln ft, ea, lot", roofUnitType("square") === "SQUARE" && roofUnitType("ln ft") === "LINEAR_FT" && roofUnitType("ea") === "UNIT" && roofUnitType("lot") === "LUMP_SUM");

// ── the stored plan ──
const facts = house();
const spec = defaultSpec(facts, BUILTIN_LISTS);
const plan = readRoofPlan({ v: 1, measurementId: "m1", spec, factsKey: factsKey(facts), extra: [2, -1, "x", 4], pitchEntered: "7/12", assumptions: ["a", 3], address: ADDR, written: { title: "T", scope: "S", lines: ["One"] } });
check("a plan reads back: measurement, spec, roof key, ticked structures (bad ones dropped)", !!plan && plan.measurementId === "m1" && plan.spec?.systemId === spec.systemId && plan.factsKey === factsKey(facts) && JSON.stringify(plan.extra) === "[2,4]", JSON.stringify(plan?.extra));
check("…and what it wrote", !!plan?.written && plan.written.lines[0] === "One" && plan.assumptions.length === 1);
check("junk is no plan, a junk spec is no spec", readRoofPlan(null) === null && readRoofPlan("x") === null && readRoofPlan({ spec: { nope: 1 } })?.spec === null);
const hand = readRoofPlan({ manual: { squares: 28.4, pitchLabel: "6/12", address: ADDR } });
check("a hand takeoff reads back; a zero-square one does not", hand?.manual?.squares === 28.4 && readRoofPlan({ manual: { squares: 0, pitchLabel: "6/12" } })?.manual === null);

// ── the convert, as actions/roofEstimator writes it ──
const pkg = buildRoofPackage(spec, facts);
const toTable = (l: { name: string; quantity: number; unitPrice: number; unit: string }) => ({ name: l.name, quantity: l.quantity, unitPrice: l.unitPrice, unit: l.unit });
const matsA = pkg.materials.map(toTable);
const labA = pkg.labor.map(toTable);
const convertLines = [
  ...matsA.map((l) => ({ name: l.name, measurementType: roofUnitType(l.unit), quantity: l.quantity, unitPrice: l.unitPrice, materialCost: l.unitPrice, laborCost: 0 })),
  ...labA.map((l) => ({ name: l.name, measurementType: roofUnitType(l.unit), quantity: l.quantity, unitPrice: l.unitPrice, materialCost: 0, laborCost: l.unitPrice })),
];
const written = { title: `Architectural shingle · 30-yr · ${ADDR}`, scope: pkg.scope.join("\n"), lines: convertLines.map((l) => l.name.trim()) };
check("the package priced something", matsA.length > 3 && labA.length > 1);

// ── back into the tables ──
const back = roofTablesFromProposal(convertLines, written);
check("the proposal's lines come back as the same two tables", back.materials.length === matsA.length && back.labor.length === labA.length && back.others === 0);
check("…same names, quantities and prices", back.materials.every((l, i) => l.name === matsA[i].name.trim() && l.quantity === matsA[i].quantity && l.unitPrice === round2(matsA[i].unitPrice)) && back.labor.every((l, i) => l.name === labA[i].name.trim() && l.unitPrice === round2(labA[i].unitPrice)));
const withOwn = [...convertLines, { name: "Skylight reflash (owner asked)", measurementType: "UNIT", quantity: 1, unitPrice: 450, materialCost: 300, laborCost: 150 }];
const back2 = roofTablesFromProposal(withOwn, written);
check("a line added in the builder is not the estimator's: it stays out of the tables, counted", back2.others === 1 && !back2.materials.some((l) => /Skylight/.test(l.name)));
const older = roofTablesFromProposal(withOwn, null);
check("an older proposal (no record): every line comes back", older.others === 0 && older.materials.length + older.labor.length === withOwn.length);

// ── the update ──
const row: DeckProposalRow = {
  id: "p1", title: written.title, clientId: "c1", projectId: null, description: null, scopeOfWork: written.scope, notes: null, address: ADDR,
  taxRate: 0.092, materialMarkupPct: 0, laborMarkupPct: 0, overheadPct: 0, profitPct: 0, showBreakdown: true, showScope: true, showSignature: true, marginOnLabor: false,
  discountTotal: 0, subtotal: 0, discounts: [],
  lineItems: withOwn.map((l) => ({ ...l, description: null, store: null, productUrl: null, imageUrl: null, dimensions: null })),
  installments: [
    { id: "i1", label: "Deposit", amount: 30, isPercent: true, status: "UNPAID", paidAmount: null },
    { id: "i2", label: "Completion", amount: 70, isPercent: true, status: "UNPAID", paidAmount: null },
  ],
};
// The contractor switched the shingle line in the builder: a different system.
const other = BUILTIN_LISTS.systems.find((s) => s.family === spec.systemFamily && s.id !== spec.systemId) ?? BUILTIN_LISTS.systems.find((s) => s.id !== spec.systemId)!;
const specB = { ...spec, systemId: other.id, systemName: other.label, systemMatPerSq: other.matPerSq, systemLaborPerSq: other.laborPerSq };
const pkgB = buildRoofPackage(specB, facts);
const linesB = roofUpdateLines(pkgB.materials.map(toTable), pkgB.labor.map(toTable));
const titleB = `${other.label} · ${ADDR}`;
const up = deckUpdatePayload(row, { written, oldWords: null }, { title: titleB, scope: pkgB.scope.join("\n"), address: ADDR, lines: linesB }, null, roofUnitType);
const names = up.payload.lineItems.map((l) => l.name);
check("the new package's lines go first, the builder's own line stays last", names[0] === linesB[0].name.trim() && names[names.length - 1] === "Skylight reflash (owner asked)" && up.kept === 1, `${names.length} lines`);
check("…at its own price", up.payload.lineItems[names.length - 1].unitPrice === 450);
check("no old estimator line survives that the new package does not have", names.slice(0, -1).every((n) => linesB.some((l) => l.name.trim() === n)));
check("the title follows (it was still the estimator's), the scope too", up.payload.title === titleB && !up.titleKept && up.payload.scopeOfWork === pkgB.scope.join("\n"));
check("squares stay squares on the proposal", up.payload.lineItems.some((l) => l.measurementType === "SQUARE"));
check("material lines carry material, labor lines labor", up.payload.lineItems.slice(0, -1).every((l) => (l.materialCost > 0 && l.laborCost === 0) || (l.materialCost === 0 && l.laborCost > 0) || l.unitPrice === 0));
check("the client, the stages (ids kept) and the tax come through", up.payload.clientId === "c1" && up.payload.installments.map((i) => i.id).join() === "i1,i2" && Math.abs(up.payload.taxRate - 0.092) < 1e-9);
const typed = deckUpdatePayload({ ...row, title: "Smith roof — full replacement" }, { written, oldWords: null }, { title: titleB, scope: "", address: ADDR, lines: linesB }, null, roofUnitType);
check("a title typed in the builder stays, and says so", typed.payload.title === "Smith roof — full replacement" && typed.titleKept);
const old = deckUpdatePayload(row, { written: null, oldWords: "Architectural shingle" }, { title: titleB, scope: "", address: ADDR, lines: linesB }, null, roofUnitType);
check("an older proposal: every line is the estimator's, its title follows", old.kept === 0 && old.payload.lineItems.length === linesB.length && old.payload.title === titleB);

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
