// PRODUCTS OF THE CONTRACTOR'S OWN (2026-10-12, owner: "always an option custom in case the contractor didn't find it
// from what we have"): every material list's custom product names and prices its lines, priced as the contractor's own
// number, while the engine frames, weighs and draws it as what it works like; items outside every list go on the
// material list and into the price as typed; all of it reads back the same and passes the proposal's rules. Pure.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json scripts/qa/deck-custom.check.ts
import { applyDeckPatch } from "../../src/lib/deck/checks";
import { defaultDeckDesign, defaultFixture, defaultRoofDesign, defaultStair, normalizeDeckDesign, type DeckDesign } from "../../src/lib/deck/design";
import { buildStructure } from "../../src/lib/deck/structure";
import { priceDeck, deckNotes } from "../../src/lib/deck/pricing";
import { deckScene } from "../../src/lib/deck/scene";
import { deckConvertSchema } from "../../src/lib/deck/convertSchema";
import { materialList } from "../../src/lib/deck/materialList";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const base = applyDeckPatch(defaultDeckDesign({ state: "TX" }), { heightIn: 48, rail: { type: "composite" }, stairs: [defaultStair("s1", "front", 8)], decking: { product: "composite-better", fascia: "match" } });
const covered = applyDeckPatch(base, { structure: "covered-deck", roof: { ...defaultRoofDesign("covered-deck"), kind: "gable", ceiling: "tongue-groove", gutters: { kind: "k5", guards: false } } });
const lineFor = (d: DeckDesign, pred: (id: string) => boolean) => priceDeck(d).bom.filter((l) => pred(l.id));
const sameFrame = (a: DeckDesign, b: DeckDesign) => {
  const A = buildStructure(a), B = buildStructure(b);
  return JSON.stringify(A.frame?.beams.map((x) => [x.spec.size, x.postXs.length])) === JSON.stringify(B.frame?.beams.map((x) => [x.spec.size, x.postXs.length])) && A.frame?.joistSize === B.frame?.joistSize && A.frame?.spacingIn === B.frame?.spacingIn && JSON.stringify(A.roof?.posts.map((p) => p.loadLb)) === JSON.stringify(B.roof?.posts.map((p) => p.loadLb));
};

// Decking: the board's own name and price per foot; framed as the board it works like.
const myBoard = applyDeckPatch(base, { custom: { decking: { name: "MoistureShield Vision 16 ft", price: 5.25 } } });
const boards = lineFor(myBoard, (id) => id.startsWith("boards-") || id.startsWith("tread-boards-"));
check("a custom board names the boards and the treads, priced per foot as typed", boards.length >= 2 && boards.every((l) => l.label.startsWith("MoistureShield Vision 16 ft") && l.rateKey === "custom.decking" && l.source === "book" && Math.abs(l.cost - l.rateQty * 5.25) < 0.02), boards.map((l) => `${l.label} $${l.cost}`).join(" | "));
check("…the package's decking line and the scope carry its name", priceDeck(myBoard).lines.some((l) => /MoistureShield Vision/.test(l.name)));
check("…and the frame is the one the board it works like gets", sameFrame(base, myBoard));

// The other lists.
const slots: Array<[string, DeckDesign, (id: string) => boolean, RegExp]> = [
  ["fastening", applyDeckPatch(base, { custom: { fastening: { name: "Cortex plugs and screws", price: 1.9 } } }), (id) => id === "deck-fasteners", /Cortex plugs/],
  ["fascia", applyDeckPatch(base, { custom: { fascia: { name: "Azek 1x8 trim", price: 6.4 } } }), (id) => id === "fascia" || id === "riser-boards", /Azek 1x8 trim/],
  ["roofing", applyDeckPatch(covered, { custom: { roofing: { name: "Malarkey Vista", price: 165 } } }), (id) => id === "shingles", /Malarkey Vista/],
  ["ceiling", applyDeckPatch(covered, { custom: { ceiling: { name: "Cedar T&G 1x6", price: 6.1 } } }), (id) => id === "ceiling", /Cedar T&G/],
  ["roofFascia", applyDeckPatch(covered, { custom: { roofFascia: { name: "Smart trim 1x8", price: 3.3 } } }), (id) => id === "fascia-boards", /Smart trim/],
  ["gutters", applyDeckPatch(covered, { custom: { gutters: { name: "Seamless 5-in. on site", price: 9 } } }), (id) => id === "gutter", /Seamless 5-in/],
];
for (const [slot, d, pred, name] of slots) {
  const ls = lineFor(d, pred);
  check(`${slot}: its lines take the custom name and price`, ls.length > 0 && ls.every((l) => name.test(l.label) && l.rateKey === `custom.${slot}` && l.source === "book" && l.factor === 1), ls.map((l) => `${l.label} ${l.qty} ${l.unit} $${l.cost}`).join(" | "));
}
const roofCustom = slots[2][1];
check("a custom roofing is priced by the square, on the same roof", lineFor(roofCustom, (id) => id === "shingles").every((l) => l.unit === "sq" && Math.abs(l.cost - l.rateQty * 165) < 0.02) && sameFrame(covered, roofCustom));
check("…the package's roofing line names it", priceDeck(roofCustom).lines.some((l) => l.name === "Roofing — Malarkey Vista"));
const walled = applyDeckPatch(covered, { roof: { ...covered.roof, walls: { fill: "screen", sides: 3 } }, custom: { walls: { name: "Phantom retractable screens", price: 28 } } });
check("walls: the panels named and priced; the screen door stays its own line", lineFor(walled, (id) => id === "screen-panels").every((l) => /Phantom/.test(l.label) && l.rateKey === "custom.walls"));

// A species of the contractor's own: its name on the material list, the tables of the species it works like.
const sp = applyDeckPatch(base, { custom: { species: { name: "Treated western larch", price: 0 } } });
check("a custom species names the framing; the frame reads the tables it works like", buildStructure(sp).frame?.species.label === "Treated western larch" && sameFrame(base, sp));

// The railing's own name.
const rail = applyDeckPatch(base, { rail: { type: "custom", customPerFt: 95, customName: "Key-Link aluminum" } });
check("a custom railing carries its name onto the package line", priceDeck(rail).lines.some((l) => l.name === "Railing — Key-Link aluminum"));

// A fixture of the contractor's own.
const fx = applyDeckPatch(base, { electrical: { fixtures: [{ ...defaultFixture("f1", "sconce"), qty: 2, custom: { name: "Kichler Barrie sconce", price: 139 } }, { ...defaultFixture("f2", "sconce"), qty: 1 }] } });
const fxl = priceDeck(fx).bom.filter((l) => l.step === "electrical" && l.kind === "fixture");
check("a custom fixture is its own line, at its price; the stock one keeps its own", fxl.some((l) => l.label === "Kichler Barrie sconce" && l.qty === 2 && Math.abs(l.cost - 278) < 0.02) && fxl.some((l) => l.label !== "Kichler Barrie sconce" && l.qty === 1), fxl.map((l) => `${l.label} ×${l.qty} $${l.cost}`).join(" | "));

// Items outside every list.
const own = applyDeckPatch(base, { extras: { items: [{ id: "i1", name: "Post skirts, composite", qty: 12, unit: "ea", price: 18.5 }, { id: "i2", name: "Stain, 5 gal", qty: 1, unit: "ea", price: 189 }] } });
const pkg = priceDeck(own);
const ownLines = pkg.bom.filter((l) => l.step === "own");
check("own items go on the material list in their own section, priced as typed", ownLines.length === 2 && Math.abs(ownLines.reduce((a, l) => a + l.cost, 0) - (12 * 18.5 + 189)) < 0.02 && ownLines.every((l) => l.source === "book"));
check("…and into the price as one line, 'Other materials'", pkg.lines.some((l) => l.id === "own-items" && /Other materials — 2 items/.test(l.name) && Math.abs(l.materialCost - (12 * 18.5 + 189)) < 0.05));
check("…and onto the lumber yard's list", materialList(pkg).groups.some((g) => g.step === "own" && g.label === "Your own items" && g.lines.length === 2));

// Reading back.
const all = applyDeckPatch(covered, { custom: { decking: { name: "  My   board ", price: 4.444 }, roofing: { name: "x".repeat(120), price: 999999 }, ceiling: { name: "", price: 3 } }, extras: { items: [{ id: "bad id!", name: "A", qty: -3, unit: "kg" as never, price: 5 }, { id: "i1", name: "B", qty: 2, unit: "ft", price: 1 }] } });
check("names are tidied and capped, prices rounded and held in their rails, a nameless one dropped", all.custom.decking?.name === "My board" && all.custom.decking?.price === 4.44 && all.custom.roofing?.name.length === 80 && all.custom.roofing?.price === 100000 && !all.custom.ceiling);
check("own items: a bad id renamed, a negative quantity held at 0, an unknown unit made 'ea', ids unique", all.extras.items.length === 2 && all.extras.items[0].qty === 0 && all.extras.items[0].unit === "ea" && new Set(all.extras.items.map((i) => i.id)).size === 2, JSON.stringify(all.extras.items));
const back = normalizeDeckDesign(JSON.parse(JSON.stringify(all)));
check("a design with custom products reads back the same", JSON.stringify(back) === JSON.stringify(normalizeDeckDesign(back)) && JSON.stringify(back.custom) === JSON.stringify(all.custom));
const removed = applyDeckPatch(myBoard, { custom: { decking: undefined } });
check("taking a custom product off returns the list to its own choice", !removed.custom.decking && lineFor(removed, (id) => id.startsWith("boards-")).every((l) => l.rateKey.startsWith("deck.")));

// The proposal's rules.
for (const [name, d] of [["every custom at once", applyDeckPatch(walled, { custom: { ...walled.custom, decking: { name: "x".repeat(80), price: 9 }, fastening: { name: "y".repeat(80), price: 2 }, roofing: { name: "z".repeat(80), price: 200 } }, extras: { items: Array.from({ length: 40 }, (_, i) => ({ id: `i${i + 1}`, name: `Item ${i + 1} ${"w".repeat(60)}`, qty: 3, unit: "ea" as const, price: 12 })) } })]] as const) {
  const p = priceDeck(d);
  const parsed = deckConvertSchema.safeParse({ title: "t", assumptions: deckNotes(p), lines: p.lines.map((l) => ({ name: l.name, description: l.description, quantity: l.quantity, unit: l.unit, materialCost: l.materialCost, laborCost: l.laborCost })), plan: { design: d, scene: deckScene(buildStructure(d)) } });
  check(`${name}: the proposal's rules pass`, parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues[0]).slice(0, 200));
}

console.log(bad ? `${bad} FAILED` : "ALL PASS");
process.exit(bad ? 1 : 0);
