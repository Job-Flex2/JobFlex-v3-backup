// The heating & cooling load from the plans (2026-10-18, lib/plans/hvacEnvelope + hvacLoad): what the sheets say the
// house is built to → the HVAC engine's Manual J-style load and Manual S size → the build list's HVAC lines. No model,
// no network: the real Eagle Ridge reads (plans-eagle.fixture) and hand-made sheets.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/plans-hvac-load.check.ts
import { cleanSheetRead, compassOf, rValueOf, uValueOf } from "../../../src/lib/plans/sheet";
import { computeTakeoff } from "../../../src/lib/plans/takeoff";
import { planEnvelopeOf, type PlanEnvelope } from "../../../src/lib/plans/hvacEnvelope";
import { applyPlansToModel, planGlass, ceilingClass, facadeCompass, glassBySideFromPlans, noteR, noteU, planBuildingModel, planHvacLoad, wallClass, windowClass } from "../../../src/lib/plans/hvacLoad";
import { applyStated, modelFromSite } from "../../../src/lib/hvac/intake";
import { runEngine } from "../../../src/lib/hvac/engine";
import { US_CATALOG } from "../../../src/lib/hvac/data/usCatalog";
import { planEnvelopeSchema } from "../../../src/lib/plans/wire";
import { pageWorthReading, planReadPrompt } from "../../../src/lib/plans/readPrompt";
import { designConditionsFor } from "../../../src/lib/hvac/designConditions";
import { EAGLE_READS } from "./plans-eagle.fixture";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

console.log("── reading the values off a sheet");
check("R-values as written: R-21, R-13+5ci = 18, R49, 21", rValueOf("R-21") === 21 && rValueOf("R-13+5ci") === 18 && rValueOf("R49") === 49 && rValueOf("21") === 21 && rValueOf("none") === null && rValueOf("R-200") === null);
check("U-factors: U-0.28, .30, 0.3; 1.5 is not a window", uValueOf("U-0.28") === 0.28 && uValueOf(".30") === 0.3 && uValueOf(0.3) === 0.3 && uValueOf("1.5") === null);
check("compass points: north, south-east, SE, 135°, 10°", compassOf("north") === "N" && compassOf("south-east") === "SE" && compassOf("SE") === "SE" && compassOf(135) === "SE" && compassOf(10) === "N" && compassOf("street") === null);
const read = cleanSheetRead(3, {
  kind: "schedule",
  title: "A2 ENERGY",
  energy: { wallR: "R-21", ceilingR: "R-49", windowU: "U-0.27", windowShgc: ".25", ach50: "3.0 ACH50", ductLocation: "Inside conditioned space", ductLeakage: "4 CFM25/100 sf" },
});
check("the energy block is cleaned: R-21 walls, R-49 ceiling, U-0.27, SHGC 0.25, 3 ACH50, ducts inside, 4 CFM25", read.energy?.wallR === 21 && read.energy?.ceilingR === 49 && read.energy?.windowU === 0.27 && read.energy?.windowShgc === 0.25 && read.energy?.ach50 === 3 && read.energy?.ductLocation === "conditioned" && read.energy?.ductLeakage === 4, JSON.stringify(read.energy));
const elev = cleanSheetRead(11, { kind: "elevation", title: "A10", facades: [{ facing: "FRONT ELEVATION", glass: "120 sq ft", windows: 6 }, { facing: "Left", glass: 40 }, { facing: "North-East", glass: 10 }, { facing: "?", glass: 5 }] });
check("facades: front, left, NE read; a face with no name is dropped", elev.facades?.length === 3 && elev.facades[0].facing === "front" && elev.facades[0].glassSqFt === 120 && elev.facades[1].facing === "left" && elev.facades[2].facing === "NE", JSON.stringify(elev.facades));
check("a site plan's front facing", cleanSheetRead(1, { kind: "site", frontFaces: "South" }).frontFaces === "S" && cleanSheetRead(1, { kind: "site" }).frontFaces === undefined);
check("an older read with none of it still cleans (no energy, no facades)", cleanSheetRead(2, { kind: "floor" }).energy === undefined && cleanSheetRead(2, { kind: "floor" }).facades === undefined);
check("the read prompt asks for all three", /"energy":/.test(planReadPrompt({ page: 1, pages: 2, textLayer: "", tiles: 0 })) && /"facades":/.test(planReadPrompt({ page: 1, pages: 2, textLayer: "", tiles: 0 })) && /"frontFaces":/.test(planReadPrompt({ page: 1, pages: 2, textLayer: "", tiles: 0 })));
check("an energy-code sheet is read, not skipped as a detail", pageWorthReading("ENERGY CODE COMPLIANCE").read && pageWorthReading("", "A2 REScheck SUMMARY").read && !pageWorthReading("GENERAL NOTES").read);

console.log("── notes, when the table is silent");
const notes = ["R-49 attic, R-38 vaulted, R-21 walls, R-30 floors, U-0.27 windows"];
check("each part of a note keeps its own R-value: walls R-21, attic R-49 (not the first R in the note)", noteR(notes, /\bwalls?\b/i) === 21 && noteR(notes, /ceiling|attic/i) === 49);
check("…and the windows' U-0.27", noteU(notes) === 0.27);
check("classes: R-21 → r21, R-15 → r13, R-49 → r49, R-38 → r38; U .27 → double low-e, .2 → triple, .5 → double", wallClass(21) === "r21" && wallClass(15) === "r13" && ceilingClass(49) === "r49" && ceilingClass(38) === "r38" && windowClass(0.27) === "double-lowe" && windowClass(0.2) === "triple" && windowClass(0.5) === "double");

console.log("── which way each face looks");
check("front facing S: left is W, right is E, rear is N", facadeCompass("left", "S") === "W" && facadeCompass("right", "S") === "E" && facadeCompass("rear", "S") === "N" && facadeCompass("front", "S") === "S");
check("front facing E: left is S", facadeCompass("left", "E") === "S");
check("a named compass face stands; front/rear with no facing is unplaced", facadeCompass("NE", null) === "NE" && facadeCompass("front", null) === null);

// The Eagle Ridge house, with the elevations' glass and the site plan's facing added to its reads.
const eagle = EAGLE_READS.map(([page, raw]) => cleanSheetRead(page, raw));
const sheets = eagle.map((sh) =>
  sh.page === 11 ? { ...sh, facades: [{ facing: "front" as const, glassSqFt: 180, windows: 12 }, { facing: "rear" as const, glassSqFt: 140, windows: 9 }] }
  : sh.page === 12 ? { ...sh, facades: [{ facing: "left" as const, glassSqFt: 40, windows: 3 }, { facing: "right" as const, glassSqFt: 60, windows: 4 }] }
  : sh.page === 1 ? { ...sh, frontFaces: "W" as const }
  : sh,
);
const base = computeTakeoff(sheets);
const env = planEnvelopeOf(base.house, sheets);
check("the house carries the facades and the facing from the sheets", (base.house.facades ?? []).length === 4 && base.house.frontFaces === "W");
check("the envelope: a heat pump house, the stated 51,624 Btu/h, its windows, no overhead doors", env.heatPump && env.stated.heatLoadBtu === 51624 && env.windows.length > 0 && !env.doors.some((d) => /o\.h/i.test(d.type ?? "")), `${env.windows.length} windows · ${env.doors.length} doors`);
check("…and it passes the wire's schema as sent", planEnvelopeSchema.safeParse(env).success, JSON.stringify(planEnvelopeSchema.safeParse(env).error?.issues?.slice(0, 2) ?? ""));

console.log("── the glass by side");
const sides = glassBySideFromPlans(env, 0);
// Front faces W: front 180 → W, rear 140 → E, left (front W + 90 = N) 40, right (S) 60.
check("front W: W 180, E 140, N 40, S 60", sides?.W === 180 && sides?.E === 140 && sides?.N === 40 && sides?.S === 60, JSON.stringify(sides));
const scaled = glassBySideFromPlans(env, 840);
check("scaled to the schedule's total (840 of 420 placed = ×2)", scaled?.W === 360 && scaled?.N === 80);
const diag = glassBySideFromPlans({ ...env, facades: [{ facing: "SE", glassSqFt: 80, windows: null }] }, 0);
check("a south-east face is half south, half east", diag?.S === 40 && diag?.E === 40);

console.log("── the building model");
const king = designConditionsFor("WA", "King");
const place = { state: "WA", county: "King", label: "King County, WA" };
const { model, inputs } = planBuildingModel(env, place, king.conditions);
check("conditioned area and storeys from the floors", model.conditionedSqft === env.livingSqFt && model.storeys === 2, `${model.conditionedSqft} sq ft · ${model.storeys}`);
check("walls R-21 and attic R-49 from the note; windows U-0.27 → double low-e", model.wallInsulation === "r21" && model.ceilingInsulation === "r49" && model.windowType === "double-lowe");
check("glass by side set from the elevations, scaled to the schedule", (model.glassWestSqft ?? 0) > (model.glassNorthSqft ?? 0) && Math.abs((model.glassNorthSqft ?? 0) + (model.glassEastSqft ?? 0) + (model.glassSouthSqft ?? 0) + (model.glassWestSqft ?? 0) - (model.windowSqft ?? 0)) < 1, `${model.windowSqft} sq ft`);
check("the schedule's 4' × 4' skylight is a skylight (16 sq ft), not window glass", model.skylightSqft === 16, String(model.skylightSqft));
check("crawlspace → vented crawl; a new house to code: 3 ACH50 here, ventilation fan, insulated doors", model.foundation === "crawl-vented" && model.blowerDoorAch50 === 3 && model.ventilationFan === true && model.doorType === "insulated");
check("the inputs say where each came from", inputs.some((i) => i.label === "Walls" && i.from === "plans") && inputs.some((i) => i.label === "Air tightness" && i.from === "assumed") && inputs.some((i) => i.label === "Glass by side" && i.from === "plans"));

console.log("── the load and the size");
const L = planHvacLoad(env, place, king.conditions, { match: king.match });
check("a heating and a cooling load, in a sane range for 5,000 sq ft in the Seattle area", L.heatingBtuh > 30000 && L.heatingBtuh < 120000 && L.coolingTotalBtuh > 15000 && L.coolingTotalBtuh < 90000, `${L.heatingBtuh} heat · ${L.coolingTotalBtuh} cool`);
check("a heat pump sized the Manual S way, with backup heat in strip sizes", L.system.heatPump && L.system.tons >= 1.5 && L.system.tons <= 5 && [5, 8, 10, 15, 20].includes(L.system.backupKw ?? -1) && /Manual S/.test(L.system.note), L.system.note);
check("the design temperatures lead the inputs, from the county", L.inputs[0].label === "Design temperatures" && L.inputs[0].from === "plans" && /King County, WA/.test(L.inputs[0].value));
check("parts of the load, largest first, and the plans' words in the assumptions", L.components.length > 3 && L.assumptions.some((a) => /Glass by side from the plans/.test(a)) && !L.assumptions.some((a) => /as typed/.test(a)) && L.assumptions.some((a) => /air-leakage target/.test(a)), L.assumptions.slice(0, 3).join(" | "));
const moreWest = planHvacLoad({ ...env, facades: env.facades.map((f) => (f.facing === "front" ? { ...f, glassSqFt: 400 } : f)) }, place, king.conditions, { match: king.match });
check("more glass facing west → more cooling", moreWest.coolingTotalBtuh > L.coolingTotalBtuh, `${L.coolingTotalBtuh} → ${moreWest.coolingTotalBtuh}`);
const tighter = planHvacLoad({ ...env, energy: { wallR: 21, ceilingR: 49, floorR: null, slabR: null, basementWallR: null, windowU: 0.27, windowShgc: null, ach50: 1.5, ductLocation: "conditioned", ductLeakage: null } }, place, king.conditions, { match: king.match });
check("a tighter house with the ducts inside → less heating", tighter.heatingBtuh < L.heatingBtuh, `${L.heatingBtuh} → ${tighter.heatingBtuh}`);
const gas: PlanEnvelope = { ...env, heatPump: false };
const G = planHvacLoad(gas, place, king.conditions, { match: king.match });
check("a gas house: an air conditioner on a furnace sized to the heating load (96% AFUE), no backup strips", !G.system.heatPump && G.system.backupKw === null && (G.system.furnaceInputBtu ?? 0) * 0.96 * G.system.systems >= G.heatingBtuh && /furnace/.test(G.system.note), G.system.note);
const mn = designConditionsFor("MN", "Hennepin");
const cold = planHvacLoad(env, { state: "MN", county: "Hennepin", label: "Hennepin County, MN" }, mn.conditions, { match: mn.match });
check("the same house in Minneapolis needs more heat and more backup", cold.heatingBtuh > L.heatingBtuh && (cold.system.backupKw ?? 0) >= (L.system.backupKw ?? 0), `${cold.heatingBtuh} Btu/h · ${cold.system.backupKw} kW`);
const nowhere = designConditionsFor("", null);
const N = planHvacLoad(env, { state: "", county: null, label: "location not given" }, nowhere.conditions, { match: "none" });
check("no place: the national default, said so, flagged assumed", N.inputs[0].from === "assumed" && /national default/.test(N.inputs[0].value));

console.log("── the build list on it");
const t = computeTakeoff(sheets, {}, {}, {}, { hvac: L });
const sys = t.items.find((i) => i.id === "hvac.system");
check("the plans draw two systems: each is sized on its half of the load", L.system.systems === 2 && L.system.tons * 2 * 12000 >= L.coolingTotalBtuh * 0.9 && /the plans draw 2 systems/.test(L.system.note), L.system.note);
check("the system line takes the load's size and says so", !!sys && sys.qty === 2 && sys.label.includes(`${L.system.tons * L.system.systems} ton`) && /Manual J-style load from the plans/.test(sys.basis) && sys.source === "derived", sys ? `${sys.qty} × ${sys.label} · ${sys.basis.slice(0, 160)}` : "no line");
const one = planHvacLoad({ ...env, stated: { ...env.stated, systems: null } }, place, king.conditions, { match: king.match });
check("one system drawn: the Manual S words match the ratio", one.system.systems === 1 && (/inside Manual S's 90–115%/.test(one.system.note) || /Manual S lets a heat pump run to 125%/.test(one.system.note)), one.system.note);
check("the takeoff carries the load", t.hvac === L);
check("a check says the size came from the load", t.checks.some((c) => /sized from the plans with a Manual J-style load/.test(c.text)));
check("…and sets the energy sheet's 51,624 Btu/h beside it when they differ by more than a fifth", Math.abs(51624 - L.heatingBtuh) > 51624 * 0.2 ? t.checks.some((c) => /writes a design heat load of 51,624/.test(c.text)) : !t.checks.some((c) => /writes a design heat load/.test(c.text)), `load ${L.heatingBtuh}`);
const strips = t.items.find((i) => i.id === "hvac.heat-strips");
check("backup strips at the load's kW", !!strips && strips.label.includes(`${L.system.backupKw} kW`) && strips.source === "derived");
const supplies = t.items.find((i) => i.id === "hvac.registers");
check("supplies cover the design airflow (~130 CFM each)", !!supplies && supplies.qty >= Math.ceil(L.coolingCfm / 130), `${supplies?.qty} for ${L.coolingCfm} CFM`);
const plain = computeTakeoff(sheets);
check("no load (no place): the old size rule, and a check asking for the address", plain.items.find((i) => i.id === "hvac.system")?.source !== "derived" && plain.hvac === undefined);
const stated = sheets.map((sh) => (sh.page === 3 ? { ...sh, mechanical: { ...sh.mechanical, tons: 6 } } : sh));
const ts = computeTakeoff(stated, {}, {}, {}, { hvac: L });
check("the plans' own tons win, and a wide gap is flagged for the designer", ts.items.find((i) => i.id === "hvac.system")?.label.includes("6 ton") === true && ts.checks.some((c) => c.level === "warn" && /mechanical plan calls for 6 tons/.test(c.text)));

console.log("── the HVAC estimator's \"Blueprint\" way in (applyPlansToModel)");
// A lot with no record (a new build): the address and the county only.
const bare = modelFromSite({ address: "1 Test Lot, Kent, WA", state: "WA", county: "King", sources: {} });
applyPlansToModel(bare, env, king.conditions);
check("the plans' floor area goes in, marked plan", bare.conditionedSqft === model.conditionedSqft && bare.provenance.conditionedSqft?.source === "plan" && bare.provenance.conditionedSqft.confidence === "high", `${bare.conditionedSqft} vs ${model.conditionedSqft}`);
check("the glass on each side and the windows' sizes go in from the plans", bare.windowSqft === model.windowSqft && bare.glassNorthSqft === model.glassNorthSqft && bare.glassSouthSqft === model.glassSouthSqft && bare.provenance.windowSqft?.source === "plan");
check("what the plans leave out is the energy code's, and it stays marked a default", Object.values(bare.provenance).some((p) => p.source === "default" && /energy code/.test(p.note ?? "")) && !Object.values(bare.provenance).some((p) => p.source === "plan" && /energy code/.test(p.note ?? "")));
const pg = planGlass(env);
check("the page's glass count is the model's (windows + glass doors, skylights apart)", Math.abs(pg.totalSqft - bare.windowSqft) <= 1 && (bare.skylightSqft ?? 0) === Math.round(pg.skylightSqft * 10) / 10, `${pg.totalSqft} vs ${bare.windowSqft}, skylight ${pg.skylightSqft} vs ${bare.skylightSqft}`);
const eng = runEngine(bare, { catalog: US_CATALOG, job: "replace-system" });
check("the estimator's own engine runs on it, close to the blueprint estimator's load (within 10%)", Math.abs(eng.load.heatingBtuh - L.heatingBtuh) <= L.heatingBtuh * 0.1 && Math.abs(eng.load.coolingTotalBtuh - L.coolingTotalBtuh) <= L.coolingTotalBtuh * 0.1, `heat ${eng.load.heatingBtuh} vs ${L.heatingBtuh}, cool ${eng.load.coolingTotalBtuh} vs ${L.coolingTotalBtuh}`);
// A house with a record: the assessor's year built is better than the plans' "new house" guess.
const recorded = modelFromSite({ address: "2 Test St, Kent, WA", state: "WA", county: "King", yearBuilt: 1978, livingSqft: 1500, sources: { living: "county parcel record" } });
const yearWas = recorded.yearBuilt;
applyPlansToModel(recorded, env, king.conditions);
check("an assumption never covers a recorded fact (year built from the record stays)", recorded.yearBuilt === yearWas && recorded.provenance.yearBuilt?.source !== "default", `${recorded.yearBuilt} ${JSON.stringify(recorded.provenance.yearBuilt)}`);
check("…but what the plans state wins over the record (their floor area)", recorded.conditionedSqft === model.conditionedSqft && recorded.provenance.conditionedSqft?.source === "plan");
// The form's order: record → walk → plans → plates → typed. A typed figure wins over the plans.
applyStated(recorded, "conditionedSqft", 2222);
check("what the contractor types afterwards wins", recorded.conditionedSqft === 2222 && recorded.provenance.conditionedSqft?.source === "stated");

console.log(bad ? `\n${bad} FAILED` : "\nall good");
process.exit(bad ? 1 : 0);
