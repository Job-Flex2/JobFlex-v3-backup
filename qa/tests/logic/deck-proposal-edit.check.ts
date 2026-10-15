// EDITING A SAVED DECK PROPOSAL (2026-10-12, owner: "when a decking design proposal is saved, make an option to open
// and edit the design"): the studio re-prices the proposal it was opened from. Held here without a database — the
// rules (lib/deck/proposalEdit) and the whole payload the update hands to the builder's save (lib/deck/proposalUpdate),
// on the engine's own lines: the deck's lines swap, the builder's own stay at their price, the markups, the discount,
// the payment stages and the client come through, a signed or paid proposal is refused.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/deck-proposal-edit.check.ts
import { applyDeckPatch } from "../../../src/lib/deck/checks";
import { defaultDeckDesign, structureWords, type DeckDesign } from "../../../src/lib/deck/design";
import { priceDeck, deckNotes, deckScope } from "../../../src/lib/deck/pricing";
import { deckScene } from "../../../src/lib/deck/scene";
import { deckUpdateSchema, parseDeckPlan } from "../../../src/lib/deck/convertSchema";
import { deckProposalLock, deckProposalSeen, deckTextAfter, keptDeckLines, readDeckWritten, type DeckWritten } from "../../../src/lib/deck/proposalEdit";
import { deckUnitType, deckUpdatePayload, type DeckProposalRow } from "../../../src/lib/deck/proposalUpdate";
import { priceLinesForClient } from "../../../src/lib/pricing/markup";
import { stateTaxRate } from "../../../src/lib/pricing/salesTax";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const round2 = (n: number) => Math.round(n * 100) / 100;
const ADDR = "1200 Barton Springs Rd, Austin, TX 78704";

/** What the studio sends for a design (deck-studio proposalPayload). */
function studioInput(d: DeckDesign, address = ADDR) {
  const pkg = priceDeck(d);
  const frame = pkg.structure.frame;
  return {
    title: `${structureWords(d)} — ${frame ? frame.decking.label : "roof"}`.slice(0, 200),
    scope: deckScope(pkg, address).join("\n").slice(0, 6000),
    assumptions: deckNotes(pkg).slice(0, 20).map((n) => n.slice(0, 600)),
    lines: pkg.lines.map((l) => ({ name: l.name.slice(0, 200), description: l.description?.slice(0, 400), quantity: l.quantity, unit: l.unit, materialCost: l.materialCost, laborCost: l.laborCost })),
    address,
    plan: { design: d, scene: deckScene(pkg.structure) },
  };
}
/** The proposal as the convert writes it (actions/deckEstimator writeProposal), and the `written` it keeps. */
function convertedRow(input: ReturnType<typeof studioInput>): { row: DeckProposalRow; written: DeckWritten } {
  const lineItems = input.lines.map((l) => {
    const unitPrice = round2(l.materialCost + l.laborCost);
    return { name: l.name, description: l.description ?? null, measurementType: deckUnitType(l.unit), quantity: l.quantity, unitPrice, materialCost: l.materialCost, laborCost: round2(unitPrice - l.materialCost), store: null, productUrl: null, imageUrl: null, dimensions: null };
  });
  const subtotal = lineItems.reduce((a, l) => a + l.quantity * l.unitPrice, 0);
  const row: DeckProposalRow = {
    id: "p1", title: input.title, clientId: "c1", projectId: "pr1", description: null, scopeOfWork: input.scope, notes: "gate code 4411", address: input.address,
    taxRate: stateTaxRate("TX") ?? 0, materialMarkupPct: 0, laborMarkupPct: 0, overheadPct: 0, profitPct: 0, showBreakdown: true, showScope: true, showSignature: true, marginOnLabor: false,
    discountTotal: 0, subtotal, discounts: [], lineItems,
    installments: [
      { id: "i1", label: "Deposit", amount: 30, isPercent: true, status: "UNPAID", paidAmount: null },
      { id: "i2", label: "Completion", amount: 70, isPercent: true, status: "UNPAID", paidAmount: null },
    ],
  };
  return { row, written: { title: input.title, scope: input.scope, lines: lineItems.map((l) => l.name.trim()) } };
}

const A = applyDeckPatch(defaultDeckDesign({ state: "TX" }), { heightIn: 40, decking: { product: "composite-better" } });
const B = applyDeckPatch(A, { shape: { ...A.shape, ...(A.shape.kind === "rect" ? { widthFt: 20, depthFt: 14 } : {}) }, decking: { product: "pt-pine-54" } });
const inA = studioInput(A);
const inB = studioInput(B);
check("the two designs price differently (the update has something to do)", JSON.stringify(inA.lines) !== JSON.stringify(inB.lines));
check("the studio's update input passes the update schema", deckUpdateSchema.safeParse({ ...inB, proposalId: "p1" }).success);
check("…and is refused without the proposal's id", !deckUpdateSchema.safeParse(inB).success);

// ── locks and the client's copy ──
check("a draft, a sent, an opened, a declined or an expired proposal can be updated", ["DRAFT", "SENT", "VIEWED", "DECLINED", "EXPIRED", "ARCHIVED"].every((st) => deckProposalLock(st) === null));
check("signed → signed, paid → paid, job done → done", deckProposalLock("ACCEPTED") === "signed" && deckProposalLock("PAID") === "paid" && deckProposalLock("COMPLETED") === "done");
check("a paid or waived stage locks it, whatever the status", deckProposalLock("SENT", [{ status: "PAID" }]) === "paid" && deckProposalLock("DRAFT", [{ status: "WAIVED" }]) === "paid" && deckProposalLock("VIEWED", [{ status: "UNPAID", paidAmount: 120 }]) === "paid");
check("a stage still unpaid (or being paid) does not", deckProposalLock("SENT", [{ status: "UNPAID" }, { status: "PENDING", paidAmount: null }]) === null);
check("sent and opened mean the client has the link", deckProposalSeen("SENT") && deckProposalSeen("VIEWED") && !deckProposalSeen("DRAFT") && !deckProposalSeen("DECLINED"));

// ── what the studio wrote ──
check("no record reads as none", readDeckWritten(undefined) === null && readDeckWritten({}) === null && readDeckWritten({ lines: "x" }) === null);
const w = readDeckWritten({ title: "T", scope: "S", lines: [" Framing — x ", 4, "Decking — y"] });
check("a record reads back trimmed, stray values dropped", !!w && w.lines.length === 2 && w.lines[0] === "Framing — x");
check("the builder's own lines are kept, the studio's are not", keptDeckLines([{ name: "Framing — x" }, { name: "Haul away" }, { name: " Decking — y" }], w).map((l) => l.name).join() === "Haul away");
check("with no record every line is the studio's", keptDeckLines([{ name: "Haul away" }], null).length === 0);
const t1 = deckTextAfter({ title: "T", scope: "S\n" }, { title: "T", scope: " S", lines: [] }, { title: "T2", scope: "S2" }, null);
check("an untouched title and scope follow the design (spacing aside)", t1.title === "T2" && t1.scope === "S2" && !t1.titleKept && !t1.scopeKept);
const t2 = deckTextAfter({ title: "Smith backyard", scope: "my words" }, { title: "T", scope: "S", lines: [] }, { title: "T2", scope: "S2" }, null);
check("a title and a scope typed in the builder stay, and say so", t2.title === "Smith backyard" && t2.scope === "my words" && t2.titleKept && t2.scopeKept);
check("an emptied scope takes the design's", deckTextAfter({ title: "T", scope: "" }, { title: "T", scope: "S", lines: [] }, { title: "T", scope: "S2" }, null).scope === "S2");
const t3 = deckTextAfter({ title: "12 × 16 ft deck — Trex", scope: "old" }, null, { title: "New", scope: "S2" }, "12 × 16 ft deck");
const t4 = deckTextAfter({ title: "Smith backyard", scope: "old" }, null, { title: "New", scope: "S2" }, "12 × 16 ft deck");
check("an older plan: the title follows while it still starts with the old design's words", t3.title === "New" && t4.title === "Smith backyard" && t4.titleKept);
check("an older plan: the scope follows", t3.scope === "S2" && t4.scope === "S2");

// ── 1. a plain update: the proposal becomes the new design ──
{
  const { row, written } = convertedRow(inA);
  const r = deckUpdatePayload(row, { written, oldWords: structureWords(A) }, inB, { defaultTaxRate: 0.0825, materialMarkupPct: 0, laborMarkupPct: 0 });
  const p = r.payload;
  check("1 · the deck's lines are the new design's, in order", p.lineItems.map((l) => l.name).join("|") === inB.lines.map((l) => l.name.trim()).join("|"), `${p.lineItems.length} lines`);
  check("1 · each line's price is its selling price, the halves adding up", p.lineItems.every((l, i) => l.unitPrice === round2(inB.lines[i].materialCost + inB.lines[i].laborCost) && round2(l.materialCost + l.laborCost) === l.unitPrice));
  check("1 · nothing of the builder's to keep", r.kept === 0);
  check("1 · title and scope follow", p.title === inB.title.trim() && p.scopeOfWork === inB.scope.trim() && !r.titleKept && !r.scopeKept);
  check("1 · the client, the project, the notes and the id stay", p.clientId === "c1" && p.projectId === "pr1" && p.notes === "gate code 4411" && p.id === "p1");
  check("1 · the payment stages keep their ids and shares", p.installments.map((i) => `${i.id}:${i.amount}${i.isPercent ? "%" : ""}`).join() === "i1:30%,i2:70%");
  check("1 · the same state keeps the proposal's tax rate", p.taxRate === row.taxRate);
  check("1 · no discount appears, no markup appears", p.discount === null && p.materialMarkupPct === 0 && p.laborMarkupPct === 0 && p.overheadPct === 0 && p.profitPct === 0);
  const priced = priceLinesForClient(p.lineItems, p);
  const want = round2(inB.lines.reduce((a, l) => a + l.quantity * round2(l.materialCost + l.laborCost), 0));
  const got = round2(priced.reduce((a, l) => a + l.total, 0));
  check("1 · the builder's save prices it at the studio's subtotal (no markup on top)", Math.abs(got - want) < 0.05 * inB.lines.length, `${got} vs ${want}`);
  check("1 · what was written reads back for the next update", JSON.stringify(readDeckWritten(JSON.parse(JSON.stringify(r.written)))) === JSON.stringify({ title: inB.title, scope: inB.scope.trim(), lines: inB.lines.map((l) => l.name.trim()) }));
  const plan = parseDeckPlan({ v: 3, design: B, scene: inB.plan.scene, address: ADDR, written: r.written });
  check("1 · the stored plan with `written` still reads as a deck", !!plan && plan.scene.facts.length > 0);
}

// ── 2. the builder's edits survive ──
{
  const { row, written } = convertedRow(inA);
  const hand = { name: "Haul away the old hot tub", description: "Two men, a trailer", measurementType: "LUMP_SUM", quantity: 1, unitPrice: 650, materialCost: 150, laborCost: 500, store: "Home Depot", productUrl: "https://www.homedepot.com/p/x", imageUrl: null, dimensions: null };
  const edited: DeckProposalRow = {
    ...row, title: "Smith backyard deck", scopeOfWork: "Our own words for the Smiths.", materialMarkupPct: 10, overheadPct: 5,
    discounts: [{ label: "Member discount", amount: 10, isPercent: true }], discountTotal: 1, lineItems: [...row.lineItems, hand],
    installments: [{ id: "i1", label: "Deposit", amount: 1000, isPercent: false, status: "UNPAID", paidAmount: null }, { id: "i2", label: "Balance", amount: 100, isPercent: true, status: "UNPAID", paidAmount: null }],
  };
  const r = deckUpdatePayload(edited, { written, oldWords: structureWords(A) }, inB, { defaultTaxRate: 0, materialMarkupPct: 0, laborMarkupPct: 0 });
  const p = r.payload;
  const last = p.lineItems[p.lineItems.length - 1];
  check("2 · the builder's line stays, after the deck's", r.kept === 1 && last.name === hand.name && p.lineItems.length === inB.lines.length + 1);
  check("2 · …at its own cost split, with its store link", last.materialCost === 150 && last.laborCost === 500 && last.store === "Home Depot" && last.productUrl === hand.productUrl);
  const beforePrice = priceLinesForClient([hand], { materialMarkupPct: 10, overheadPct: 5 })[0].unitPrice;
  const afterPrice = priceLinesForClient([last], p)[0].unitPrice;
  check("2 · …and at the price it had (the markups re-applied once, not twice)", beforePrice === afterPrice, `${beforePrice} → ${afterPrice}`);
  check("2 · the typed title and scope stay, and the studio says so", p.title === "Smith backyard deck" && p.scopeOfWork === "Our own words for the Smiths." && r.titleKept && r.scopeKept);
  check("2 · the markups and the member's discount come through, named", p.materialMarkupPct === 10 && p.overheadPct === 5 && p.discount?.label === "Member discount" && p.discount.amount === 10 && p.discount.isPercent);
  check("2 · the stages as the builder left them", p.installments.map((i) => `${i.id}:${i.label}:${i.amount}`).join() === "i1:Deposit:1000,i2:Balance:100");
  check("2 · `written` stays the studio's own words (so the next update still knows they were typed)", r.written.title === inB.title && r.written.lines.length === inB.lines.length);
  const again = deckUpdatePayload({ ...edited, title: p.title, scopeOfWork: p.scopeOfWork, lineItems: p.lineItems.map((l) => ({ ...l, description: l.description ?? null, unitPrice: l.unitPrice })) }, { written: r.written, oldWords: structureWords(B) }, inA, null);
  check("2 · a second update swaps the deck again and still keeps the builder's line and words", again.kept === 1 && again.payload.lineItems.length === inA.lines.length + 1 && again.titleKept && again.scopeKept);
}

// ── 3. a line written with no split (an older surface): its stored price is a selling price ──
{
  const { row, written } = convertedRow(inA);
  const unsplit = { name: "Permit runner", description: null, measurementType: "LUMP_SUM", quantity: 1, unitPrice: 577.5, materialCost: 0, laborCost: 0 };
  const r = deckUpdatePayload({ ...row, materialMarkupPct: 10, overheadPct: 5, lineItems: [...row.lineItems, unsplit] }, { written, oldWords: null }, inB, null);
  const last = r.payload.lineItems[r.payload.lineItems.length - 1];
  const again = priceLinesForClient([last], r.payload)[0].unitPrice;
  check("3 · an unsplit line comes back at the price it was saved with", Math.abs(again - 577.5) < 0.02, `${again}`);
}

// ── 4. a plan saved before the studio kept its names ──
{
  const { row } = convertedRow(inA);
  const r = deckUpdatePayload({ ...row, lineItems: [...row.lineItems, { name: "Haul away", description: null, measurementType: "UNIT", quantity: 1, unitPrice: 100, materialCost: 0, laborCost: 100 }] }, { written: null, oldWords: structureWords(A) }, inB, null);
  check("4 · every old line is the studio's: all replaced", r.kept === 0 && r.payload.lineItems.length === inB.lines.length);
  check("4 · the studio's title (it starts with the old design's words) follows", r.payload.title === inB.title.trim());
}

// ── 5. the job moved ──
{
  const { row, written } = convertedRow(inA);
  const moved = deckUpdatePayload(row, { written, oldWords: null }, { ...inB, address: "88 Ocean Ave, Santa Monica, CA 90401" }, null);
  check("5 · another state brings its sales tax and the address", moved.payload.taxRate === (stateTaxRate("CA") ?? -1) && moved.payload.address.includes("Santa Monica"));
  const typed = deckUpdatePayload({ ...row, taxRate: 0.05 }, { written, oldWords: null }, { ...inB, address: "500 Congress Ave, Austin, TX 78701" }, null);
  check("5 · the same state keeps a typed rate", typed.payload.taxRate === 0.05);
  const blank = deckUpdatePayload(row, { written, oldWords: null }, { ...inB, address: "" }, null);
  check("5 · no address from the studio keeps the proposal's", blank.payload.address === ADDR);
}

// ── 6. the payload is what the builder's save accepts ──
{
  const { row, written } = convertedRow(inA);
  const p = deckUpdatePayload(row, { written, oldWords: null }, inB, null).payload;
  const types = new Set(["SQFT", "LINEAR_FT", "CUBIC_FT", "UNIT", "HOUR", "LUMP_SUM", "SQUARE"]);
  check("6 · every line named, counted, priced and typed", p.lineItems.every((l) => l.name.length >= 1 && l.quantity >= 0 && l.unitPrice >= 0 && l.materialCost >= 0 && l.laborCost >= 0 && types.has(l.measurementType)));
  check("6 · a title, a tax rate between 0 and 1", p.title.length >= 1 && p.taxRate >= 0 && p.taxRate <= 1);
}

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
