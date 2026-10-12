// THE MATERIAL LIST (2026-10-11, lib/deck/materialList): the takeoff in build order, every line to order with a
// quantity, the client's fixtures kept apart, the yard's text without prices and the installer's with them, a CSV a
// spreadsheet reads back. Pure.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json scripts/qa/deck-material-list.check.ts
import { applyDeckPatch } from "../../src/lib/deck/checks";
import { defaultDeckDesign, defaultFixture, defaultRoofDesign, defaultStair } from "../../src/lib/deck/design";
import { csvCell, listAsk, materialList, materialListCsv, materialListText } from "../../src/lib/deck/materialList";
import { priceDeck } from "../../src/lib/deck/pricing";
import { BOM_STEP_ORDER } from "../../src/lib/deck/takeoff";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const base = defaultDeckDesign({ state: "TX" });
const design = applyDeckPatch(base, { structure: "covered-deck", heightIn: 48, rail: { type: "composite" }, stairs: [defaultStair("s1", "front", 8)], roof: { ...defaultRoofDesign("covered-deck"), kind: "gable" }, electrical: { fixtures: [{ ...defaultFixture("f1", "chandelier"), supply: "client" }, defaultFixture("f2", "step-light")] } });
const pkg = priceDeck(design);
const list = materialList(pkg);
const lines = list.groups.flatMap((g) => g.lines);
check("every material of the package is on the list", lines.length === pkg.bom.filter((l) => l.qty > 0).length, `${lines.length} lines`);
check("the groups come in build order", list.groups.every((g, i) => i === 0 || BOM_STEP_ORDER.indexOf(g.step) > BOM_STEP_ORDER.indexOf(list.groups[i - 1].step)), list.groups.map((g) => g.step).join(" > "));
check("footings, framing, decking, stairs, railing and the roof are all there", ["footings", "framing", "decking", "stairs", "rails", "roofing"].every((st) => list.groups.some((g) => g.step === st)));
check("every line has a quantity and a unit", lines.every((l) => l.qty > 0 && l.unit.length > 0));
const client = lines.filter((l) => l.byClient);
check("the client's chandelier is listed apart, at $0", client.length >= 1 && client.every((l) => l.cost === 0) && list.count === lines.length - client.length);
check("the estimate adds up to the package's material lines", Math.abs(list.cost - pkg.bom.filter((l) => !l.byClient).reduce((a, l) => a + l.cost, 0)) < 1, `${list.cost}`);
const head = { what: "16 ft × 12 ft covered deck", title: "Back deck", address: "123 Main St, Austin, TX 78701", shop: { name: "Acme Decks", phone: "(512) 555-0100" }, date: "October 11, 2026" };
const yard = materialListText(list, { ...head, forWhom: "yard", withPrices: false });
check("the yard's text asks for a delivered quote and carries no prices", /Please quote these materials delivered to 123 Main St/.test(yard) && !/\$\d/.test(yard), yard.split("\n").slice(0, 3).join(" | "));
check("…names the shop and the date, and every section in capitals", /Acme Decks · \(512\) 555-0100 · October 11, 2026/.test(yard) && /\nFRAMING\n/.test(yard) && /\nDECKING\n/.test(yard));
check("…lists the client's fixtures as not to order", /THE CLIENT SUPPLIES \(not to order\)/.test(yard));
const inst = materialListText(list, { ...head, forWhom: "installer", withPrices: true });
check("the installer's text says buy, with prices and a total", /Buy these for the job at 123 Main St/.test(inst) && /≈ \$\d/.test(inst) && /estimated \$[\d,]+\.\d\d before tax/.test(inst));
check("the asks without an address", listAsk({ forWhom: "yard", address: null }) === "Please quote these materials, delivered." && listAsk({ forWhom: "installer" }) === "Buy these for the job.");
const csv = materialListCsv(list, true);
const rows = csv.trim().split("\r\n");
check("the CSV: a header and a row per line, prices last", rows.length === lines.length + 1 && rows[0] === "Section,Qty,Unit,Item,Note,Client supplies,Est. each,Est. total");
check("a cell with a comma or a quote is quoted, doubled inside", csvCell('2x10 × 16 ft, "treated"') === '"2x10 × 16 ft, ""treated"""' && csvCell("plain") === "plain" && csvCell(12) === "12");
const parsedOk = rows.slice(1).every((r) => {
  // A tiny RFC 4180 reader: the row must split into exactly 8 cells.
  const cells: string[] = [];
  let cur = "", q = false;
  for (let i = 0; i < r.length; i++) {
    const ch = r[i];
    if (q) { if (ch === '"' && r[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ",") { cells.push(cur); cur = ""; } else cur += ch;
  }
  cells.push(cur);
  return cells.length === 8;
});
check("every CSV row reads back as eight cells", parsedOk);
const yardCsv = materialListCsv(list, false);
check("the yard's CSV has no price columns", yardCsv.split("\r\n")[0] === "Section,Qty,Unit,Item,Note,Client supplies" && !/\d+\.\d\d$/m.test(yardCsv.split("\r\n").slice(1).join("\n")));
const bare = materialList(priceDeck(base));
check("a bare deck: no roof, no railing groups, no client fixtures", !bare.groups.some((g) => g.step === "roofing") && bare.groups.every((g) => g.lines.every((l) => !l.byClient)));

console.log(bad ? `${bad} FAILED` : "ALL PASS");
process.exit(bad ? 1 : 0);
