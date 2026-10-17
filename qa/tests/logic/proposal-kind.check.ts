// What kind of proposal is this (lib/proposalKind, 2026-10-17): the work family and word, and the tool that made it.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/proposal-kind.check.ts
import { familyCounts, kindLine, proposalKindOf, toolOf, tradeFamily } from "../../../src/lib/proposalKind";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const k = (input: Parameters<typeof proposalKindOf>[0]) => proposalKindOf(input);

// ── the estimators
const deck = k({ trade: "deck", title: "16 ft × 12 ft deck — Capped composite", events: [{ summary: "Priced a deck — 16 ft × 12 ft deck · 192 sq ft", meta: '{"trade":"deck"}' }, { summary: "Re-priced the deck from its design — 16 ft × 12 ft deck" }] });
check("Deck Studio: deck, made by Deck Studio", deck.family === "deck" && deck.tool === "deck" && kindLine(deck) === "Deck · Deck Studio", kindLine(deck));
const roof = k({ trade: "roof", title: "Roof replacement · architectural shingles · 23.3 squares", events: [{ summary: 'Converted roof estimate to proposal "Roof replacement · architectural shingles"' }] });
check("roof estimator", roof.family === "roof" && roof.tool === "roof" && kindLine(roof) === "Roof · Roof estimator");
const hvac = k({ trade: "hvac", title: "Furnace replacement — 4518 Bluestem Hollow Dr", events: [{ summary: 'Converted HVAC estimate to proposal "Furnace replacement"' }] });
check("HVAC estimator", hvac.family === "hvac" && hvac.tool === "hvac");
const fence = k({ trade: "fence", title: "Cedar privacy fence — 180 ft" });
check("fence with no trail line: the trade names its estimator", fence.family === "fence" && fence.tool === "fence" && fence.toolWords === "Fence estimator");
const roofing = k({ trade: "roofing", title: "Roof replacement — architectural shingles" });
check("an older trade word (roofing) is the roof family", roofing.family === "roof" && roofing.work === "Roof" && roofing.tool === "roof");
check("tradeFamily: decking/fencing/HVAC words, anything else none", tradeFamily("decking") === "deck" && tradeFamily("Fencing") === "fence" && tradeFamily("HVAC") === "hvac" && tradeFamily("painting") === null && tradeFamily(null) === null);

// ── Smart Proposal and its siblings
const kitchen = k({ trade: null, title: "Smith kitchen", events: [{ summary: 'Converted "Kitchen remodel" AI estimate to proposal "Smith kitchen"' }] });
check("Smart Proposal: kitchen remodel, from its job type", kitchen.family === "remodel" && kitchen.work === "Kitchen remodel" && kitchen.tool === "smart" && kindLine(kitchen) === "Kitchen remodel · Smart Proposal", kindLine(kitchen));
const smartRoof = k({ trade: "roof", title: "Roof tear-off and re-roof", events: [{ summary: 'Converted "Roof replacement" AI estimate to proposal "Roof tear-off"' }] });
check("Smart Proposal for a roof: the roof family, the Smart Proposal tool", smartRoof.family === "roof" && smartRoof.tool === "smart");
const video = k({ trade: null, title: "Basement finish", events: [{ summary: 'Converted "Basement finish" AI estimate to proposal "Basement finish"', meta: '{"source":"video"}' }] });
check("video estimator: its own tool, the work from its job type", video.tool === "video" && video.toolWords === "Video estimator" && video.family === "remodel" && video.work === "Basement");
const plans = k({ trade: null, title: "Second-floor addition", events: [{ summary: 'Converted "Second-floor addition" AI estimate to proposal "Second-floor addition"', meta: '{"source":"blueprint"}' }] });
check("blueprint estimator: an addition is a remodel", plans.tool === "blueprint" && plans.family === "remodel" && plans.work === "Remodel");
const badMeta = toolOf([{ summary: 'Converted "Painting" AI estimate to proposal "x"', meta: "{not json" }], null);
check("a broken meta reads as Smart Proposal, never throws", badMeta.tool === "smart" && badMeta.projectType === "Painting");

const reno = k({ trade: null, title: "Whole-house renovation", scope: "New LVP flooring throughout" });
check("a renovation with flooring is a remodel", reno.family === "remodel");
const floors = k({ trade: null, title: "LVP flooring — living room" });
check("…and flooring alone stays Flooring", floors.family === "other" && floors.work === "Flooring");

// ── by hand, a template, a copy
const gutters = k({ trade: null, title: "QA-Shaw gutter guards", events: [{ summary: 'Created proposal "QA-Shaw gutter guards"' }] });
check("manual gutters: Gutters before Roofing, the Other family", gutters.family === "other" && gutters.work === "Gutters" && gutters.tool === "manual" && kindLine(gutters) === "Gutters · Manual");
const tpl = k({ trade: null, title: "Bath refresh — Lee", events: [{ summary: 'Created proposal "Bath refresh — Lee" from template "Standard bathroom"' }] });
check("from a template: the template's name rides along", tpl.tool === "template" && tpl.via === "Standard bathroom" && tpl.family === "remodel" && tpl.work === "Bathroom remodel");
const copy = k({ trade: "roof", title: "Roof replacement (copy)", events: [{ summary: 'Duplicated "Roof replacement" as "Roof replacement (copy)"', meta: '{"sourceId":"x"}' }] });
check("a copy keeps its trade and says it is a copy", copy.family === "roof" && copy.tool === "copy" && copy.via === "Roof replacement");
const heatPump = k({ trade: null, title: "QA-Kim heat pump" });
check("a hand-typed title names the work: heat pump → HVAC", heatPump.family === "hvac" && heatPump.tool === "manual");
const pergola = k({ trade: null, title: "QA-Bell pergola" });
check("a pergola is the deck family", pergola.family === "deck");
const attic = k({ trade: null, title: "QA-Reed attic insulation" });
check("attic insulation → Insulation, Other", attic.family === "other" && attic.work === "Insulation");
const fromLines = k({ trade: null, title: "QA-Wu carport", lineNames: ["Carport kit", "Concrete footing pads"] });
check("nothing in the title: the line names decide (concrete)", fromLines.work === "Concrete" && fromLines.family === "other");
const nothing = k({ trade: null, title: "Job #1042" });
check("no words at all: General, Other, Manual", nothing.work === "General" && nothing.family === "other" && nothing.tool === "manual");
const scopeOnly = k({ trade: null, title: "Garcia residence", scope: "Remove and replace the existing chain-link fence with 6 ft cedar." });
check("the scope decides when the title says nothing", scopeOnly.family === "fence");
const changeOrder = toolOf([{ summary: 'Drafted change order #1 "Plywood replacement"' }, { summary: 'Converted roof estimate to proposal "Roof"' }], "roof");
check("a change order line is not the creation line", changeOrder.tool === "roof");

// ── the filter's counts
const counts = familyCounts([deck, roof, roofing, kitchen, gutters, attic, hvac]);
check("family counts in the filter's order, empty families left out", counts.map((c) => `${c.key}:${c.count}`).join(",") === "deck:1,roof:2,hvac:1,remodel:1,other:2", counts.map((c) => `${c.key}:${c.count}`).join(","));

console.log(bad ? `\n${bad} FAILED` : "\nall good");
process.exit(bad ? 1 : 0);
