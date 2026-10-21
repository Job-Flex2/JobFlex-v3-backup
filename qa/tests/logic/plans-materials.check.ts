// The materials from the plans (2026-10-21, owner: "calculate any materials needed — for drywall, deck, roof, any —
// make it smart"). On the real 18-sheet set (plans-eagle.fixture): a trade's materials in the units they are bought in,
// each with how it was figured; the measurements under them, which the contractor can correct and the materials follow;
// extra on top rounded up to whole units; a typed job's own lines; a deck from its size through the Deck Studio's frame;
// the text for a supplier and the report the PDF draws.
//   npx tsx --tsconfig tsconfig.json qa/tests/logic/plans-materials.check.ts
import { cleanSheetRead } from "../../../src/lib/plans/sheet";
import { computeTakeoff } from "../../../src/lib/plans/takeoff";
import { MATERIAL_TOPICS, materialsAsReport, materialsReport, materialsText, withExtra, type MaterialsJob } from "../../../src/lib/plans/materialsReport";
import { deckMaterials } from "../../../src/lib/plans/deckMaterials";
import { deckSpecFromPlans, deckSpecFromWords, isDeckAsk } from "../../../src/lib/plans/deckSpec";
import { EAGLE_READS } from "./plans-eagle.fixture";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const sheets = EAGLE_READS.map(([p, r]) => cleanSheetRead(p, r));
const t = computeTakeoff(sheets);
const job = (key: string): MaterialsJob => {
  const tp = MATERIAL_TOPICS.find((x) => x.key === key)!;
  return { title: tp.label, request: null, trades: tp.trades === "deck" ? [] : tp.trades, itemIds: null, asked: [] };
};
const line = (r: ReturnType<typeof materialsReport>, id: string) => r.groups.flatMap((g) => g.lines).find((l) => l.id === id);

console.log("── drywall");
const dw = materialsReport(t, job("drywall"));
const sheetsDw = line(dw, "drywall.regular");
check("drywall in 4×12 sheets, with the mud, tape, bead and screws", !!sheetsDw && sheetsDw.unit === "sheets" && ["drywall.mud", "drywall.tape", "drywall.bead", "drywall.screws"].every((id) => !!line(dw, id)), `${sheetsDw?.qty} sheets`);
check("each says how it was figured", dw.groups[0].lines.every((l) => l.basis.length > 5));
check("no work lines in the list — they are the measurements above it", !dw.groups.some((g) => g.lines.some((l) => /^Hang|^Texture/.test(l.label))) && dw.measures.some((m) => m.id === "drywall.walls"));

console.log("── the measurements move the materials");
const walls = t.items.find((i) => i.id === "drywall.walls")!;
const t2 = computeTakeoff(sheets, {}, { "drywall.walls": walls.qty + 2000 });
const dw2 = materialsReport(t2, job("drywall"), 0, null, { "drywall.walls": walls.qty + 2000 });
check("2,000 more sq ft of wall → more sheets and more mud", line(dw2, "drywall.regular")!.qty > sheetsDw!.qty && line(dw2, "drywall.mud")!.qty >= line(dw, "drywall.mud")!.qty, `${sheetsDw!.qty} → ${line(dw2, "drywall.regular")!.qty} sheets`);
check("…and the measurement says it was entered", dw2.measures.find((m) => m.id === "drywall.walls")?.edited === true);

console.log("── extra on top");
check("whole units: 396 sheets + 5% = 416", withExtra(396, "sheets", 5) === 416);
check("…but 10% on one beam is still one beam, on 6 posts still 6 (less than half a post)", withExtra(1, "pcs", 10) === 1 && withExtra(4, "pcs", 10) === 4 && withExtra(6, "pcs", 10) === 7 && withExtra(5, "pcs", 5) === 5, `${withExtra(6, "pcs", 10)}`);
check("a yard of concrete keeps a decimal", withExtra(27.4, "cu yards", 10) === 30.1);
const dw10 = materialsReport(t, job("drywall"), 10);
check("10% on the materials, not on the supply-and-install lines", line(dw10, "drywall.regular")!.qty === withExtra(sheetsDw!.qty, "sheets", 10) && /\+10% extra/.test(line(dw10, "drywall.regular")!.basis));

console.log("── roof, framing, concrete");
const roof = materialsReport(t, job("roofing"));
check("roof: shingle bundles, underlayment rolls, starter, cap, drip edge, nails — and the gutters", ["roofing.shingles", "roofing.underlay-rolls", "roofing.starter", "roofing.cap", "roofing.drip-edge", "roofing.nails"].every((id) => !!line(roof, id)) && roof.groups.some((g) => g.trade === "gutters"), `${line(roof, "roofing.shingles")?.qty} bundles`);
const fr = materialsReport(t, job("framing"));
check("framing: studs by length, plates, sheathing, joists, trusses, hardware", fr.groups[0].lines.length > 15 && /pieces/.test(line(fr, "framing.studs-ext-main")!.unit));
const cc = materialsReport(t, job("concrete"));
check("concrete by the yard, rebar by the stick", line(cc, "foundation.concrete-fw")?.unit === "cu yards" && line(cc, "foundation.rebar")?.unit === "pieces");
const all = materialsReport(t, job("all"));
check("the whole house: every trade's materials", all.groups.length >= 15 && all.count > 250, `${all.groups.length} trades, ${all.count} lines`);

console.log("── a typed job's own lines");
const ownIds = ["drywall.garage", "drywall.typex", "drywall.screws"];
const own = materialsReport(t, { title: "Garage fire wall", request: "drywall for the garage fire wall", trades: ["drywall"], itemIds: ownIds, asked: [] });
check("only the lines the job takes", own.groups.flatMap((g) => g.lines).every((l) => ownIds.includes(l.id)) && !!line(own, "drywall.typex"));

console.log("── a deck");
const words = deckSpecFromWords("Composite deck 16x20, 4 ft high, with stairs");
check("its size and height from the words, the longer side as the width", words.widthFt === 20 && words.depthFt === 16 && words.heightIn === 48 && words.board === "composite" && words.stairs === true, JSON.stringify(words));
check("'16 by 12 treated, 30 inches' reads too", JSON.stringify(deckSpecFromWords("deck 16 by 12 treated, 30 inches high")) === JSON.stringify({ widthFt: 16, depthFt: 12, heightIn: 30, board: "treated" }), JSON.stringify(deckSpecFromWords("deck 16 by 12 treated, 30 inches high")));
check("a deck ask, not a deck screw", isDeckAsk("materials for the back deck") && !isDeckAsk("drywall and deck screws"));
check("no deck on these plans: nothing invented", deckSpecFromPlans(t.house, "WA") === null);
const deck = deckMaterials({ widthFt: 20, depthFt: 16, heightIn: 48, board: "composite", stairs: true, railing: true, state: "WA", from: "words" });
const steps = deck.groups.map((g) => g.label);
check("the studio's frame: footings, ledger, framing, decking, stairs, railing", ["Footings", "Ledger", "Framing", "Decking", "Stairs", "Railing"].every((w) => steps.some((s) => s.startsWith(w))), steps.join(", "));
check("joists as pieces of a stock length, decking boards counted", deck.groups.some((g) => g.lines.some((l) => /joists/.test(l.label) && l.unit === "pcs")) && deck.groups.some((g) => g.lines.some((l) => /Capped composite/.test(l.label) && l.qty > 20)));
const low = deckMaterials({ widthFt: 12, depthFt: 10, heightIn: 18, board: "treated", stairs: true, railing: false, state: "TX", from: "entered" });
check("a low deck without railing has none", !low.groups.some((g) => /Railing/.test(g.label)));

console.log("── out the door");
const rep = materialsAsReport(materialsReport(t, job("drywall"), 5, deck), { name: "Sample Residence", address: "Anytown, WA", sheets: 18 });
check("the PDF's report: the measurements first, then each trade, then the deck", rep.sections[0].key === "measures" && rep.sections.some((s) => s.key === "drywall") && rep.sections.some((s) => s.key.startsWith("deck-")));
const text = materialsText(materialsReport(t, job("drywall"), 5), { name: "Sample Residence", address: "Anytown, WA" });
check("the text for a supplier: the job, the extra, one line a material", text.startsWith("Materials — Drywall") && /5% extra included/.test(text) && /\d+ sheets — Drywall 1\/2" regular/.test(text), text.split("\n").slice(0, 5).join(" | "));

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
