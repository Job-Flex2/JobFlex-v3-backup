// The REMODEL ESTIMATING METHOD and what came with it (2026-09-18): the text
// of every part, which parts a brief carries, whole job vs part of a room,
// the procedure block's partial mode, the range line and the retry, the
// admin's overrides, the master-prompt and trade-profile fixes, the price
// book header and the specialty detector. No model call.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/remodel-method.check.ts
import { briefScope, formatRemodelMethod, remodelDomainsFor, REMODEL_PARTS, remodelPartDefault } from "../../../src/lib/estimate/remodel-method";
import { fullerAnswer, linesTotal, locationFactor, remodelJob, remodelRange, retryReasons, roomAreaFrom } from "../../../src/lib/estimate/remodel-sanity";
import { buildLegacyEstimatePrompt } from "../../../src/lib/estimate/legacy-estimate";
import { formatProcedureBlock, procedureFor } from "../../../src/lib/estimate/procedures";
import { readBrief } from "../../../src/lib/estimate/brief";
import { ESTIMATOR_MASTER_PROMPT, UNIT_RULES } from "../../../src/lib/estimate/master-prompt";
import { buildTradeRulesBlock } from "../../../src/lib/estimate/estimate-prompt";
import { TRADES } from "../../../src/lib/estimate/trade-knowledge";
import { formatPriceBookForPrompt } from "../../../src/lib/estimate/legacy/promptFormatter";
import { detectSpecialty } from "../../../src/lib/estimate/legacy/specialtyDetector";
import { parseOverrideRows } from "../../../src/lib/estimate/promptOverrides";
import { checkOverride } from "../../../src/lib/estimate/promptAdmin";
import { OVERRIDE_KEYS } from "../../../src/lib/estimate/promptKeys";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const UNITS = ["sqft", "linear ft", "cu yards", "sq yards", "unit", "hour", "fixed"];

// ── The text ────────────────────────────────────────────────────────────────
const byKey = Object.fromEntries(REMODEL_PARTS.map((p) => [p.key, p.text]));
check("all six parts carry text", REMODEL_PARTS.length === 6 && REMODEL_PARTS.every((p) => p.text.trim().length > 2000), REMODEL_PARTS.map((p) => `${p.key}:${p.text.length}`).join(" "));
check("each part carries its sections",
  /^## 1\. HOW TO READ A REMODEL BRIEF/m.test(byKey.read) && /### 1\.1 Six connections/.test(byKey.read) &&
  /^## 3\. HIDDEN-WORK CHAINS/m.test(byKey.chains) && /^## 4\. CODE TRIGGERS/m.test(byKey.chains) &&
  ["## 5.", "## 6.", "## 7.", "## 8."].every((h) => byKey.rules.includes(h)) &&
  /^### 2A\. KITCHEN/m.test(byKey.kitchen) && /### 9\.1 /.test(byKey.kitchen) && /### 9\.3 /.test(byKey.kitchen) &&
  /^### 2B\. BATHROOM/m.test(byKey.bathroom) && /### 9\.2 /.test(byKey.bathroom) && /### 9\.5 /.test(byKey.bathroom) &&
  /^### 2C\. INTERIOR/m.test(byKey.interior) && /### 9\.4 /.test(byKey.interior));
const unitProblems: string[] = [];
let bullets = 0;
let rows = 0;
for (const key of ["kitchen", "bathroom", "interior", "chains"] as const) {
  for (const line of byKey[key].split("\n")) {
    if (/^\s*- /.test(line) && line.includes(" — ") && !/^\s*- \*\*/.test(line)) {
      bullets++;
      const unit = line.slice(line.lastIndexOf(" — ") + 3).trim();
      if (!UNITS.includes(unit)) unitProblems.push(`${key}: "${unit.slice(0, 20)}" in ${line.trim().slice(0, 60)}`);
    }
    const row = line.match(/^\|\s*\d+\s*\|(.*)\|\s*([\d.,]+)\s*\|\s*([^|]+?)\s*\|\s*$/);
    if (row) {
      rows++;
      if (!UNITS.includes(row[3])) unitProblems.push(`${key} example: "${row[3]}"`);
    }
  }
}
check(`every implication bullet and example row ends in a legal unit (${bullets} bullets, ${rows} rows)`, unitProblems.length === 0 && bullets > 400 && rows > 100, unitProblems.slice(0, 4).join(" | "));
const priced = REMODEL_PARTS.filter((p) => p.key !== "rules" && /\$\s?\d/.test(p.text)).map((p) => p.key);
check("prices appear only in the sanity ranges (section 8)", priced.length === 0 && /\$28,000-45,000/.test(byKey.rules), priced.join(","));
check("no counts or compound units in the room parts' lines", !/\(\d+ ea\)|qty \d|linear ft \+ unit/.test(byKey.kitchen + byKey.bathroom + byKey.interior));
check("the owner's example: a sink brief prints its under-sink plumbing line", /#### "Replace the kitchen sink"[\s\S]{0,900}Under-sink plumbing rebuilt to the wall stub: 1-1\/2 in\. tubular P-trap kit/.test(byKey.kitchen));
check("adding a disposal brings its switched receptacle, the switch and a circuit when needed", /#### "Add a garbage disposal"[\s\S]{0,1600}20 A receptacle in the sink base switched[\s\S]{0,400}Single-pole switch above the counter[\s\S]{0,700}New 20 A circuit/.test(byKey.kitchen));

// ── Which parts a brief carries ─────────────────────────────────────────────
const dom = (brief: string, id: string) => remodelDomainsFor(brief, id).join("+") || "none";
const domCases: Array<[string, string, string]> = [
  ["replace the kitchen sink and faucet, add a disposal", "kitchen-remodel", "kitchen"],
  ["replace toilet", "bathroom-remodel", "bathroom"],
  ["replace the bathroom vanity and faucet", "bathroom-remodel", "bathroom"],
  ["finish 800 sqft basement with a bedroom and bathroom", "interior-remodel", "bathroom+interior"],
  ["full kitchen remodel 12x14 with an island", "kitchen-remodel", "kitchen"],
  ["remove wall between kitchen and dining room", "kitchen-remodel", "kitchen+interior"],
  ["whole house remodel", "general-contracting", "kitchen+bathroom+interior"],
  ["replace sink", "general-contracting", "kitchen+bathroom"],
  ["install LVP flooring in 3 bedrooms and hallway 900 sqft", "flooring-installation", "interior"],
  ["paint interior of house 2200 sqft", "painting", "interior"],
  ["paint the exterior of the house and the siding", "painting", "none"],
  ["water heater replacement 50 gal", "water-heater-replacement", "none"],
  ["replace the roof 2400 sqft", "roofing", "none"],
  ["Sewer line installation, Lynnwood WA", "sanitary-sewer", "none"],
  ["convert garage to living space", "garage-conversion", "interior"],
];
const domMiss = domCases.filter(([b, id, want]) => dom(b, id) !== want).map(([b, id, want]) => `${b} → ${dom(b, id)} (want ${want})`);
check(`the right room parts ride with each brief (${domCases.length} briefs)`, domMiss.length === 0, domMiss.join(" | "));

// ── Whole job or part of a room ─────────────────────────────────────────────
const scopeCases: Array<[string, string, string]> = [
  ["replace the kitchen sink and faucet, add a disposal", "kitchen-remodel", "partial"],
  ["replace toilet", "bathroom-remodel", "partial"],
  ["tub to shower conversion hall bath 5x8", "bathroom-remodel", "partial"],
  ["remove wall between kitchen and dining room", "kitchen-remodel", "partial"],
  ["full kitchen remodel 12x14 with an island", "kitchen-remodel", "full"],
  ["kitchen remodel", "kitchen-remodel", "full"],
  ["gut the hall bathroom", "bathroom-remodel", "full"],
  ["redo the bathroom", "bathroom-remodel", "full"],
  ["finish 800 sqft basement with a bedroom and bathroom", "interior-remodel", "full"],
  ["convert garage to living space", "garage-conversion", "full"],
  ["replace the roof", "roofing", "full"],
];
const scopeMiss = scopeCases.filter(([b, id, want]) => briefScope(b, id) !== want).map(([b, id, want]) => `${b} → ${briefScope(b, id)} (want ${want})`);
check(`whole job vs part of a room (${scopeCases.length} briefs)`, scopeMiss.length === 0, scopeMiss.join(" | "));
const kr = procedureFor("kitchen-remodel")!;
const partialBlock = formatProcedureBlock("Kitchen Remodel", kr, undefined, { partial: true });
const fullBlock = formatProcedureBlock("Kitchen Remodel", kr);
check("a partial brief gets the steps as a menu, never the step quota", /THIS BRIEF NAMES PART OF THE JOB/.test(partialBlock) && !/AT LEAST/.test(partialBlock) && /PARTIAL BRIEF:/.test(partialBlock) && /AT LEAST \d+ line items/.test(fullBlock));

// ── The prompt ──────────────────────────────────────────────────────────────
/** The method block's own heading (the master prompt names the method too). */
const METHOD_HEAD = "## 1. HOW TO READ A REMODEL BRIEF";
const sink = buildLegacyEstimatePrompt({ description: "Replace the kitchen sink and faucet, add a disposal", location: "Kirkland, WA" });
check("the sink brief: kitchen method rides (2A, examples 9.1 and 9.3), partial scope, no quota, no range",
  sink.specialty.id === "kitchen-remodel" && sink.scope === "partial" && sink.procedureCoreSteps === 0 && sink.range === null &&
  sink.prompt.includes(METHOD_HEAD) && sink.prompt.includes("### 2A. KITCHEN") && sink.prompt.includes("### 9.1 ") && !sink.prompt.includes("### 2C.") && !sink.prompt.includes("### 2B.") &&
  sink.prompt.indexOf("PROCEDURE — KITCHEN") < sink.prompt.indexOf(METHOD_HEAD) && sink.prompt.includes("THIS BRIEF NAMES PART OF THE JOB"));
const kirkland = buildLegacyEstimatePrompt({ description: "Full bathroom remodel, 5x8 hall bath, Kirkland WA", location: "Kirkland, WA" });
check("the Kirkland bath: whole job, bathroom method, the metro range in the prompt",
  kirkland.scope === "full" && kirkland.remodelDomains.join() === "bathroom" && kirkland.range?.low === 28000 && kirkland.range?.high === 45000 && kirkland.procedureCoreSteps >= 10 &&
  kirkland.prompt.includes("THIS BRIEF'S RANGE: a full hall bath remodel in Kirkland runs $28,000-$45,000"), JSON.stringify(kirkland.range));
const wv = buildLegacyEstimatePrompt({ description: "Full Bathroom Remodel - 12x8", location: "WV" });
check("the owner's 12x8 in WV is judged as a 96 sqft bath, not a 5x8 (WV 0.94)", wv.range?.low === 20500 && wv.range?.high === 38000 && /about 96 sqft/.test(wv.range.label), JSON.stringify(wv.range));
check("…so its $16,000, 12-line answer is asked again for both reasons", retryReasons({ lines: 12, coreSteps: wv.procedureCoreSteps, total: 16000, range: wv.range }).length === 2);
const k810 = buildLegacyEstimatePrompt({ description: "Full bathroom remodel, 8x10 hall bath", location: "Kirkland, WA" });
check("an 8x10 Kirkland bath scales above the 5x8's metro range", k810.range?.low === 30600 && k810.range?.high === 50900, JSON.stringify(k810.range));
check("a big bath is capped at the primary-bath range (Dallas 0.92)", buildLegacyEstimatePrompt({ description: "Full bathroom remodel 20x14", location: "Dallas, TX" }).range?.high === 64400);
check("room sizes read for the range, tile, sheet and lumber sizes skipped", roomAreaFrom("bath 12 by 8") === 96 && roomAreaFrom("12 x 8 ft bath") === 96 && roomAreaFrom("new 4x8 sheet") === undefined && roomAreaFrom("2x4 blocking") === undefined && roomAreaFrom("12x24 porcelain tile") === undefined);
check("the brief reader no longer takes a tile size for the job's area", readBrief("full bathroom remodel with 12x24 porcelain tile").area === undefined && readBrief("12x24 in. tile floor in a 10x12 kitchen").area === 120 && readBrief("20x20 garage epoxy").area === 400);
check("the previous JobFlex's price book and material profile ride again, the old tax block does not",
  wv.prompt.includes("MATERIAL PRICE REFERENCE (US market data — material only, no labor)") && wv.prompt.includes("SPECIALTY MATERIAL PROFILE: bathroom-remodel") && !wv.prompt.includes("SALES TAX RULES") &&
  wv.prompt.includes("a pack or package is never written as one line"));
const spokane = buildLegacyEstimatePrompt({ description: "Full kitchen remodel", location: "Spokane, WA" });
check("outside the metros the city index scales the national range (Spokane 1.06)", spokane.range?.low === 40300 && spokane.range?.high === 70000, JSON.stringify(spokane.range));
const bothell = buildLegacyEstimatePrompt({ description: "full kitchen remodel 12x14 with an island", location: "Bothell, WA" });
check("a metro kitchen uses the metro check", bothell.range?.low === 50000 && bothell.range?.high === 90000, JSON.stringify(bothell.range));
const tub = buildLegacyEstimatePrompt({ description: "tub to shower conversion hall bath 5x8", location: "Dallas, TX" });
check("a tub-to-shower is part of a bath with its own range", tub.specialty.id === "bathroom-remodel" && tub.scope === "partial" && tub.range?.job === "tub-to-shower" && tub.range.low === 9200, JSON.stringify(tub.range));
const priced2 = buildLegacyEstimatePrompt({ description: "full bathroom remodel, total $15,000", location: "Kirkland, WA" });
check("a stated price has no range (the brief binds it)", priced2.range === null);
const basement = buildLegacyEstimatePrompt({ description: "finish 800 sqft basement with a bedroom and bathroom", location: "Denver, CO" });
check("a basement finish with a bath is priced per sqft of the stated area (Denver 1.06)", basement.specialty.id === "interior-remodel" && basement.range?.job === "basement-finish-bath" && basement.range.low === 50900 && basement.range.high === 97500, JSON.stringify(basement.range));
const roof = buildLegacyEstimatePrompt({ description: "replace the roof, 2400 sqft architectural shingles", location: "Bothell, WA" });
check("a roof brief carries no remodel method and no remodel range — the price book's roofing benchmark instead", roof.remodelDomains.length === 0 && roof.range?.kind === "specialty" && roof.range.job === "roofing" && !roof.prompt.includes(METHOD_HEAD), JSON.stringify(roof.range));
check("location factor: the city index, the state index, national", locationFactor("Kirkland, WA").factor === 1.25 && locationFactor("Yakima, WA").factor === 1.04 && locationFactor("Somewhere, WA").factor === 1.16 && locationFactor("").factor === 1);
check("remodelJob: primary, powder, galley and layout kitchens",
  remodelJob("full master bathroom remodel", readBrief("full master bathroom remodel"), "full", "bathroom-remodel", ["bathroom"])?.id === "primary-bath" &&
  remodelJob("powder room remodel", readBrief("powder room remodel"), "full", "bathroom-remodel", ["bathroom"])?.id === "powder-room" &&
  remodelJob("kitchen remodel 10x10 galley", readBrief("kitchen remodel 10x10 galley"), "full", "kitchen-remodel", ["kitchen"])?.id === "kitchen-galley" &&
  remodelJob("kitchen remodel, move the sink to the island", readBrief("kitchen remodel, move the sink to the island"), "full", "kitchen-remodel", ["kitchen"])?.id === "kitchen-layout");
check("remodelRange needs the area for per-sqft jobs", remodelRange(remodelJob("convert the garage", readBrief("convert the garage"), "full", "garage-conversion", ["interior"]), readBrief("convert the garage"), "Denver, CO") === null);

// ── The retry ───────────────────────────────────────────────────────────────
const range = kirkland.range;
const thinCheap = retryReasons({ lines: 8, coreSteps: 18, total: 12600, range });
check("the Kirkland failure (8 lines, $12,600) is asked again for both reasons", thinCheap.length === 2 && /ONLY 8 LINE ITEMS/.test(thinCheap[0]) && /TOTALED \$12,600/.test(thinCheap[1]) && /\$28,000-\$45,000/.test(thinCheap[1]));
check("a partial brief is never held to a line quota", retryReasons({ lines: 5, coreSteps: 0, total: 900, range: null }).length === 0);
check("a whole job at its range stands", retryReasons({ lines: 26, coreSteps: 18, total: 31000, range }).length === 0);
check("just under nine tenths of the low end is asked again", retryReasons({ lines: 26, coreSteps: 18, total: 25000, range }).length === 1 && retryReasons({ lines: 26, coreSteps: 18, total: 25300, range }).length === 0);
const item = (q: number, m: number, l: number) => ({ quantity: q, materialUnitPrice: m, laborUnitPrice: l });
const a = { items: [item(1, 100, 100), item(2, 50, 50)] };
const b = { items: [item(1, 100, 100), item(2, 50, 50), item(1, 10, 10)] };
const c = { items: [item(1, 300, 300), item(2, 60, 60)] };
check("linesTotal sums quantity times both halves", linesTotal(a.items) === 400);
check("the fuller answer is kept: more lines, or a much higher total", fullerAnswer(a, b) === b && fullerAnswer(a, c) === c && fullerAnswer(c, a) === c);

// ── Overrides ───────────────────────────────────────────────────────────────
const now = new Date();
const o = parseOverrideRows([
  { key: OVERRIDE_KEYS.remodel("kitchen"), body: "### 2A. KITCHEN — edited\n- Edited kitchen line for the test — unit", updatedAt: now },
  { key: "remodel:nonsense", body: "x", updatedAt: now },
]);
check("remodel overrides parse; an unknown part is ignored", o.remodel.kitchen?.startsWith("### 2A. KITCHEN — edited") === true && !("nonsense" in o.remodel) && !o.savedAt["remodel:nonsense"]);
const edited = formatRemodelMethod(["kitchen"], o.remodel)!;
check("an edited part replaces the default in the block; the others stay", edited.includes("Edited kitchen line for the test") && !edited.includes("#### \"Replace the kitchen sink\"") && edited.includes("## 1. HOW TO READ A REMODEL BRIEF"));
const blanked = formatRemodelMethod(["bathroom"], { bathroom: "   " });
check("a blanked room part still sends the core parts, without section 2", !!blanked && blanked.includes("## 1. HOW TO READ A REMODEL BRIEF") && blanked.includes("## 8. SANITY RANGES") && !blanked.includes("## 2. WHAT THE BRIEF IMPLIES") === (remodelPartDefault("bathroom").trim() === ""));
check("checkOverride: a remodel part at its default clears, a change is stored, an unknown part is refused",
  (checkOverride(OVERRIDE_KEYS.remodel("rules"), remodelPartDefault("rules")) as { clear?: boolean }).clear === true &&
  (checkOverride(OVERRIDE_KEYS.remodel("rules"), "## 5. NEVER FORGOTTEN\nshort") as { clear?: boolean }).clear === false &&
  !checkOverride(OVERRIDE_KEYS.remodel("nope"), "x").ok);

// ── What taught thin answers ────────────────────────────────────────────────
const mp = ESTIMATOR_MASTER_PROMPT;
check("the master prompt lost its 6-12 and 8-15 line minimums", !/Minimum 6-12|Minimum 8-15/.test(mp) && /a whole hall bath 22-30, a whole same-layout kitchen 24-32/.test(mp));
check("the fixed no-photo kitchen checklist is gone", !/BREAK DOWN ALL COMPONENTS/.test(mp) && /THE LINES ARE THE JOB THE BRIEF NAMES/.test(mp));
check("the sample kitchen shows its under-sink plumbing and per-unit circuits, no lumps", /"Under-sink plumbing — 1-1\/2 in\. P-trap kit/.test(mp) && !/Electrical Upgrades/.test(mp) && !/Plumbing Rough-In — relocate/.test(mp) && /Second 20 A small-appliance circuit.*· unit · 1/.test(mp));
check("waste is priced into the unit price, never the quantity", /net measured quantity/.test(UNIT_RULES) && !/waste applied where the methodology says so/.test(mp) && /quantities stay net/.test(mp));
check("no counts in the sample names", !/\(\d+ ea[ ,)]/.test(mp) && !/684 sf total/.test(mp) && !/General conditions, overhead, profit/.test(mp));
check("the low numbers are raised", /electrician \$100-160\/hr/.test(mp) && /plumber \$110-180\/hr/.test(mp) && /new 20 A circuit with breaker and device \$450-900/.test(mp) && !/\$200-500\/circuit/.test(mp));
const kitchenTrade = TRADES.find((t) => t.id === "kitchen")!;
const bathTrade = TRADES.find((t) => t.id === "bathroom")!;
check("the kitchen and bath profiles lost their line caps and low anchors",
  !/8-15 lines|6-12 lines minimum/.test(kitchenTrade.preamble + bathTrade.preamble) &&
  kitchenTrade.anchors.some((a) => /new 20 A circuit \$450-900/.test(a)) && bathTrade.anchors.some((a) => /\$1,000-2,200\/unit installed/.test(a)) &&
  !kitchenTrade.anchors.some((a) => /\$200-500 per circuit/.test(a)));
const tradeBlock = buildTradeRulesBlock({ description: "replace the kitchen sink", location: "Kirkland, WA", qualityTier: "standard" });
check("the trade block: phases of a whole job, a partial brief writes only its phases, net quantities",
  /PHASES OF A WHOLE JOB/.test(tradeBlock) && /A brief for PART of the job/.test(tradeBlock) && /NET MEASURED QUANTITY/.test(tradeBlock) && !/consumables and fasteners;/.test(tradeBlock));
check("the price book says it is material only", /material only, no labor/.test(formatPriceBookForPrompt(null)));

// ── The detector ────────────────────────────────────────────────────────────
const det: Array<[string, string]> = [
  ["tub to shower conversion hall bath 5x8", "bathroom-remodel"],
  ["finish 800 sqft basement with a bedroom and bathroom", "interior-remodel"],
  ["replace toilet", "bathroom-remodel"],
  ["install new dishwasher", "kitchen-remodel"],
  ["install range hood vented outside", "kitchen-remodel"],
  ["replace 5 windows", "window-replacement"],
  ["retile the shower walls", "tile-stone"],
  ["sprinkler system for the lawn", "irrigation-contractor"],
  ["install pocket door", "interior-remodel"],
  ["new front door", "window-door"],
  ["replace garage door", "garage-door"],
  ["basement waterproofing, water coming in", "basement-waterproofing"],
  ["Sewer line installation, Lynnwood WA", "sanitary-sewer"],
  ["install 400 sq ft epoxy floor", "epoxy-flooring"],
  ["build a 6 ft cedar fence 150 ft", "fencing"],
  ["water heater replacement 50 gal", "water-heater-replacement"],
  // A TPO membrane is commercial roofing's own procedure since 2026-10-09; it was filed under residential roofing before.
  ["commercial roof TPO 12000 sqft", "commercial-roofing"],
  ["full kitchen remodel 12x14 with an island, Kirkland WA", "kitchen-remodel"],
  ["full bathroom remodel Kirkland WA", "bathroom-remodel"],
];
const detMiss = det.filter(([b, id]) => detectSpecialty(b)?.specialty.id !== id).map(([b, id]) => `${b} → ${detectSpecialty(b)?.specialty.id ?? "none"} (want ${id})`);
check(`the detector routes the remodel briefs and keeps the others (${det.length} briefs)`, detMiss.length === 0, detMiss.join(" | "));
check("a repair stays with the keyword pass", detectSpecialty("dishwasher not draining, fix it")?.specialty.id !== "kitchen-remodel" && detectSpecialty("toilet keeps running")?.specialty.id !== "bathroom-remodel");

console.log(bad ? `\n${bad} check(s) FAILED` : "\nall checks passed");
process.exit(bad ? 1 : 0);
