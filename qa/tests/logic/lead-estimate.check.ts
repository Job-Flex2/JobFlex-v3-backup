// The estimate that rides with a Lead Center lead (lib/leadCenter/estimate, 2026-10-27): the words a contractor reads,
// the short line on a card, the suggested lead price, a range saved as a planned project. Pure parts only.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/lead-estimate.check.ts
import { DEFAULT_ANSWERS, roofFactsFromSolar, roofRange, type RoofAnswers } from "../../../src/lib/publicEstimate/roof";
import type { SolarRoofEstimate } from "../../../src/lib/roofSolarEstimate";
import { PRICE_PLAN_TAG, estimateShort, estimateWords, leadEstimateFrom, parsePlanEstimate, planNudgesOnce, reopenFromEstimate, suggestedLeadPriceCents, type RoofLeadEstimate, HOUSE_TRADE, buyerWebLeadRecord, estimateMaterialWords, houseSource, leadEstimateFromWeb, parseLeadEstimate, planRangeWords } from "../../../src/lib/leadCenter/estimate";
import type { WebEstimateRecord } from "../../../src/lib/webEstimator";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

const solar: SolarRoofEstimate = {
  areaSqft: 2100, footprintSqft: 1800, predominantPitch12: 6, pitchLabel: "6/12", segmentCount: 8,
  pitchFamilies: [{ pitch12: 6, planSqft: 1500, surfaceSqft: 1680 }, { pitch12: 9, planSqft: 300, surfaceSqft: 420 }],
  imageryDate: "2025-06-01", imageryQuality: "HIGH", coverageRatio: 1, areaMethod: "google-modeled-roof", warnings: [], center: { lat: 42.948, lng: -78.853 }, buildingName: null, rawAreaSqft: 2100,
};
const a: RoofAnswers = { ...DEFAULT_ANSWERS, storeys: 2, material: "architectural", tearOffLayers: 1, leaks: true };
const facts = roofFactsFromSolar(solar, a, "NY");
const range = roofRange(facts, a, null, "solar");
// The record as the browser builds it, with a budget — the range's own numbers are pinned below by substitution.
const e: RoofLeadEstimate = { ...leadEstimateFrom(range, a, null), range: { low: 14200, mid: 16000, high: 19800 }, budgetCents: 1_800_000, at: "2026-10-27T12:00:00Z" };

check("the record carries the answers, the squares, the pitch, the basis and the whole hidden estimate", e.v === 1 && e.trade === "roof" && e.material === "architectural" && e.materialLabel === "Architectural shingle" && e.tearOffLayers === 1 && e.storeys === 2 && e.squares === 21 && e.pitchLabel === "6/12" && e.basis === "solar" && e.hidden.materials.length > 3 && e.hidden.spec.systemId === "architectural" && e.guideRange === null);
check("the words a contractor reads", estimateWords(e) === "Roof replacement, architectural shingle, tear-off 1 layer, about 2,100 sq ft of roof at 6/12, 2 floors; leaks noted. Range shown: $14,200–$19,800 (read from aerial data). Budget: about $18,000.", estimateWords(e));
check("…with no budget and no notes", !/Budget/.test(estimateWords({ ...e, budgetCents: null })) && !/noted/.test(estimateWords({ ...e, answers: { ...e.answers, leaks: false } })));
check("…no tear-off, three notes, from the home's size", /no tear-off/.test(estimateWords({ ...e, tearOffLayers: 0 })) && /leaks, skylights and solar panels noted/.test(estimateWords({ ...e, answers: { ...e.answers, skylights: true, solarPanels: true } })) && /\(from the home's size\)/.test(estimateWords({ ...e, basis: "size" })));
check("the short line", estimateShort(e) === "$14,200–$19,800 · architectural shingle · 21 sq · aerial read", estimateShort(e));
check("…measured, once a measurement is on it", /· measured$/.test(estimateShort({ ...e, measurementId: "m1" })) && /· from home size$/.test(estimateShort({ ...e, basis: "size" })));
check("suggested price: priced $35, measured $60, measured + budget $75, exclusive doubles", suggestedLeadPriceCents({ ...e, budgetCents: null }, false) === 3500 && suggestedLeadPriceCents({ ...e, budgetCents: null, measurementId: "m" }, false) === 6000 && suggestedLeadPriceCents({ ...e, measurementId: "m" }, false) === 7500 && suggestedLeadPriceCents(e, true) === 7000);
const notes = PRICE_PLAN_TAG + "\n" + JSON.stringify(e);
check("a saved range reads back from a plan's notes; other notes do not", parsePlanEstimate(notes)?.range.mid === 16000 && parsePlanEstimate("Paint the fence") === null && parsePlanEstimate(null) === null && parsePlanEstimate(PRICE_PLAN_TAG + "\n{junk") === null);

// ── the whole hidden estimate reopens in the buyer's roof estimator ──
const r = reopenFromEstimate(e, "418 Linden Ave, Buffalo, NY 14216");
check("the hidden estimate reopens whole: the manual takeoff, the spec, every line, the scope", r.manual.squares === 21 && r.manual.pitchLabel === "6/12" && r.manual.address === "418 Linden Ave, Buffalo, NY 14216" && r.spec.systemId === "architectural" && r.spec.tearOffLayers === 1 && r.materials.length === e.hidden.materials.length && r.labor.length === e.hidden.labor.length && r.scope === e.hidden.scopeText && r.assumptions.length === e.hidden.assumptions.length + 1, JSON.stringify({ m: r.manual, lines: r.materials.length + r.labor.length }));
check("…the lines carry a name, a quantity, a unit and a price; the first assumption says where it came from", r.materials.every((l) => l.name && l.quantity > 0 && l.unit && l.unitPrice >= 0) && /priced on JobFlex by the homeowner/.test(r.assumptions[0]) && r.title === "Roof · 418 Linden Ave, Buffalo, NY 14216");

// ── a saved range nudges once (nobody consented to more); an ordinary plan keeps its follow-up ──
check("a saved range's plan nudges once; an ordinary plan twice", planNudgesOnce(notes) && !planNudgesOnce("Paint the fence") && !planNudgesOnce(null));

// ── THE HOUSE ESTIMATORS (2026-10-28): the website estimators' record rides beside a deck, fence, HVAC or any-project lead ──
const fence: WebEstimateRecord = {
  token: "tok", organizationId: "org_house", trade: "fence", at: "2026-10-28T10:00:00Z", address: "418 Linden Ave", city: "Buffalo", state: "NY", zip: "14216",
  summary: "180 ft of fence in 3 runs, 1 walk gate.", choice: "Cedar privacy, 6 ft", cents: 821000, band: { low: 7200, high: 9400 }, show: "range",
  facts: { runsFt: [60, 60, 60], type: "cedar-privacy", heightFt: 6, gates: 1, doubles: 0, pin: { lat: 42.948, lng: -78.853 } },
};
const w = leadEstimateFromWeb(fence, "Back yard only", new Date("2026-10-28T10:05:00Z"));
check("a web estimate: the band as the range, the mid from the cents, no budget, no measurement, the note", w.v === 1 && w.trade === "fence" && w.range.low === 7200 && w.range.high === 9400 && w.range.mid === 8210 && w.budgetCents === null && !w.measurementId && w.note === "Back yard only" && w.web === fence && w.at === "2026-10-28T10:05:00.000Z");
check("its words", estimateWords(w) === 'Priced on JobFlex: 180 ft of fence in 3 runs, 1 walk gate. Chose: Cedar privacy, 6 ft. Shown $7,200–$9,400 (before tax). Homeowner\'s note: "Back yard only"', estimateWords(w));
check("…no note, no note line", !/note/.test(estimateWords(leadEstimateFromWeb(fence, null))));
check("its short line", estimateShort(w) === "$7,200–$9,400 · Cedar privacy, 6 ft · fence", estimateShort(w));
check("its suggested price is the unmeasured $35, $70 exclusive", suggestedLeadPriceCents(w, false) === 3500 && suggestedLeadPriceCents(w, true) === 7000);
check("its plan words and its material words", planRangeWords(w) === "Fence range $7,200–$9,400 · Cedar privacy, 6 ft — priced on JobFlex, not a quote" && estimateMaterialWords(w) === "cedar privacy, 6 ft" && estimateMaterialWords(e) === "architectural shingle", planRangeWords(w));
check("the house trade and source", HOUSE_TRADE.fence === "Fencing" && HOUSE_TRADE.deck === "Decking" && HOUSE_TRADE.hvac === "HVAC" && houseSource("hvac") === "price:hvac" && houseSource("smart") === "price:smart");
check("parseLeadEstimate takes a good row, a roof row, and refuses a bad one", parseLeadEstimate(JSON.stringify(w))?.trade === "fence" && parseLeadEstimate(JSON.stringify(e))?.trade === "roof" && parseLeadEstimate("{") === null && parseLeadEstimate(JSON.stringify({ v: 2 })) === null && parseLeadEstimate(null) === null);
check("…and a web row without its record, or a roof row without its hidden package, is no estimate (an Accept must never trip on one)", parseLeadEstimate(JSON.stringify({ v: 1, trade: "fence", range: { low: 1, mid: 2, high: 3 }, at: "x" })) === null && parseLeadEstimate(JSON.stringify({ v: 1, trade: "roof", range: { low: 1, mid: 2, high: 3 }, at: "x" })) === null);
const deck: WebEstimateRecord = { ...fence, trade: "deck", summary: "A 16 × 20 attached deck (320 sq ft), composite boards — about $42 a square foot.", choice: "Composite", cents: 1344000, band: { low: 11800, high: 15100 }, facts: { design: { v: 1, kind: "attached" }, draftId: "d1", token: "t1", areaSqFt: 320, pricePerSqFt: 42, designedOnline: true } };
const rec = buyerWebLeadRecord(leadEstimateFromWeb(deck, null), { leadId: "lead_buyer", organizationId: "org_buyer", contact: { name: "Sarah Stand", phone: "(716) 555-0100", email: "s@example.com", note: null } }, new Date("2026-10-28T12:00:00Z"));
check("the buyer's record: their lead, their org, the design kept, the house's draft and link token left behind", rec.leadId === "lead_buyer" && rec.trade === "deck" && rec.estimate.organizationId === "org_buyer" && !!rec.estimate.facts.design && !("draftId" in rec.estimate.facts) && !("token" in rec.estimate.facts) && rec.estimate.facts.designedOnline === true && rec.estimate.token === "tok" && rec.contact.name === "Sarah Stand" && rec.at === "2026-10-28T12:00:00.000Z", JSON.stringify(rec.estimate.facts));

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
