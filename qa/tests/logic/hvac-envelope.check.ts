// The envelope in detail (2026-10-18, engine 0.3): glass by side, blower-door and duct-leakage tests, wall
// construction, siding colour, skylights and doors — each moves the load the way it must, an empty field prices
// exactly as before, and the walk and the old estimates pick them up.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/hvac-envelope.check.ts
import { computeBlockLoad, ENGINE_VERSION, glassBySide, loadLevers } from "../../../src/lib/hvac/load";
import { applyWalkthrough, fillEnvelopeDefaults, modelFromSite } from "../../../src/lib/hvac/intake";
import { FIX_FIELDS } from "../../../src/lib/hvac/fieldSpecs";
import type { WalkthroughAnalysis } from "../../../src/lib/estimate/video-schema";
import type { BuildingModel, DesignConditions } from "../../../src/lib/hvac/types";

let failures = 0, passes = 0;
const ok = (name: string, cond: boolean, detail = "") => { if (cond) passes++; else failures++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`); };

const dallas: DesignConditions = { state: "TX", county: "Dallas", coolingF: 100, heatingF: 22, hddCddRatio: 0.5, humidity: "humid", grainsDiff: 45, elevationFt: 430, source: "test", verifiedOn: "2026-09-15" };
function house(over: Partial<BuildingModel> = {}): BuildingModel {
  return {
    address: "test", state: "TX", county: "Dallas",
    conditionedSqft: 2000, storeys: 1, ceilingHeightFt: 8, yearBuilt: 1995,
    windowToFloor: 0.14, windowType: "double", wallInsulation: "r13", ceilingInsulation: "r30",
    foundation: "slab", tightness: "average", roofColor: "medium", shading: "some", occupants: 4,
    existing: { kind: "split-ac-furnace", tons: 4, fuel: "gas", refrigerant: "R-410A" },
    electrical: {}, ducts: { location: "attic", condition: "fair", insulated: true }, gas: { available: true }, preferences: {}, provenance: {},
    ...over,
  };
}
const L = (over: Partial<BuildingModel> = {}) => computeBlockLoad(house(over), dallas);
const base = L();

ok("the engine says 0.3", /0\.3/.test(ENGINE_VERSION), ENGINE_VERSION);

// ── nothing typed prices as before: the defaults ARE the old figures
const spelled = L({ wallConstruction: "wood-frame", sidingColor: "medium", doorType: "solid-wood", doorCount: 2 });
ok("wood frame, medium siding, two solid doors spelled out = the load with none of them", spelled.heatingBtuh === base.heatingBtuh && spelled.coolingTotalBtuh === base.coolingTotalBtuh, `${spelled.heatingBtuh}/${spelled.coolingTotalBtuh} vs ${base.heatingBtuh}/${base.coolingTotalBtuh}`);
ok("…and the walls say what they assume", base.components.some((c) => /Walls · .*wood frame, medium siding/.test(c.name)));

// ── glass by side
const west = L({ glassWestSqft: 300 });
const north = L({ glassNorthSqft: 300 });
ok("300 sq ft of glass facing west cools far harder than the same facing north", west.coolingTotalBtuh - north.coolingTotalBtuh >= 4000, `${west.coolingTotalBtuh} vs ${north.coolingTotalBtuh}`);
ok("…heating the same either way (glass loses heat whichever way it faces)", west.heatingBtuh === north.heatingBtuh);
const split = L({ glassNorthSqft: 60, glassEastSqft: 40, glassSouthSqft: 80, glassWestSqft: 120, windowSqft: 500 });
ok("glass by side is the window area (300) and the typed total (500) stands aside, said so", split.components.some((c) => /Windows · 300 sq ft/.test(c.name)) && split.assumptions.some((a) => /north 60, east 40, south 80, west 120 sq ft — 300 sq ft in all \(the 500 sq ft typed as the window area stands aside\)/.test(a)));
ok("…the sun is split by side: W 40%", split.components.some((c) => /Window solar · N 20%, E 13%, S 27%, W 40%/.test(c.name)), split.components.find((c) => /Window solar/.test(c.name))?.name);
ok("glassBySide: nothing typed → null", glassBySide(house()) === null && glassBySide(house({ glassEastSqft: 0 })) === null);
const lever = loadLevers(house({ glassWestSqft: 200 }), dallas).join(" ");
ok("the glass lever runs on the glass by side", /a quarter more glass/.test(lever), lever.slice(0, 120));

// ── a blower-door test outranks the class
const vol = 2000 * 8;
const tight = L({ blowerDoorCfm50: (3 * vol) / 60 });
const leaky = L({ blowerDoorCfm50: (12 * vol) / 60 });
ok("a tested 3 ACH50 house needs less heating than the 'average' class; a tested 12 needs more", tight.heatingBtuh < base.heatingBtuh && leaky.heatingBtuh > base.heatingBtuh, `${tight.heatingBtuh} < ${base.heatingBtuh} < ${leaky.heatingBtuh}`);
ok("…and says the test in its own words (CFM50 over the volume = ACH50)", tight.assumptions.some((a) => /blower-door test \(800 CFM50 over 16,000 cu ft = 3\.0 ACH50/.test(a)), tight.assumptions.find((a) => /blower/.test(a)));
const achRoute = L({ blowerDoorAch50: 3 });
ok("ACH50 off the report gives the same answer as the CFM50 it stands for", achRoute.heatingBtuh === tight.heatingBtuh && achRoute.coolingTotalBtuh === tight.coolingTotalBtuh);
ok("a tested house drops the 'one tightness class better' lever", !/tightness class better/.test(loadLevers(house({ blowerDoorAch50: 5 }), dallas).join(" ")) && /tightness class better/.test(loadLevers(house(), dallas).join(" ")));

// ── a duct-leakage test
const sealed = L({ ducts: { location: "attic", condition: "poor", insulated: true, leakageCfm25: 50 } });
const leakyDucts = L({ ducts: { location: "attic", condition: "fair", insulated: true, leakageCfm25: 400 } });
const poorGuess = L({ ducts: { location: "attic", condition: "poor", insulated: true } });
ok("tested tight ducts carry less than the attic's typical, tested leaky ones more", sealed.coolingTotalBtuh < base.coolingTotalBtuh && leakyDucts.coolingTotalBtuh > base.coolingTotalBtuh, `${sealed.coolingTotalBtuh} < ${base.coolingTotalBtuh} < ${leakyDucts.coolingTotalBtuh}`);
ok("…a test makes the 'poor' guess stand aside", sealed.coolingTotalBtuh < poorGuess.coolingTotalBtuh && sealed.components.some((c) => /50 CFM25 leakage tested/.test(c.name)));
ok("…and says what share of the airflow leaked", leakyDucts.assumptions.some((a) => /Duct leakage tested at 400 CFM25 to outside — \d+% of the system's/.test(a)));
ok("ducts inside the envelope: a leakage test changes nothing", L({ ducts: { location: "conditioned", condition: "fair", leakageCfm25: 400 } }).coolingTotalBtuh === L({ ducts: { location: "conditioned", condition: "fair" } }).coolingTotalBtuh);

// ── wall construction and siding colour
const brick = L({ wallConstruction: "brick-veneer" });
const block = L({ wallConstruction: "masonry", wallInsulation: "none" });
const frameBare = L({ wallInsulation: "none" });
const sip = L({ wallConstruction: "sip-icf", wallInsulation: "none" });
ok("brick veneer loses a little less than bare frame", brick.heatingBtuh <= base.heatingBtuh && brick.coolingTotalBtuh <= base.coolingTotalBtuh);
ok("an uninsulated block wall loses more heat than an uninsulated frame wall", block.heatingBtuh > frameBare.heatingBtuh, `${block.heatingBtuh} > ${frameBare.heatingBtuh}`);
ok("SIP / ICF holds near R-22 whatever the cavity field says", sip.heatingBtuh < base.heatingBtuh);
const light = L({ sidingColor: "light" });
const dark = L({ sidingColor: "dark" });
ok("dark siding cools harder than light; the heating is the same", dark.coolingTotalBtuh > light.coolingTotalBtuh && dark.heatingBtuh === light.heatingBtuh, `${light.coolingTotalBtuh} → ${dark.coolingTotalBtuh}`);
ok("…and the colour is a small lever (under 5% of this house's cooling)", (dark.coolingTotalBtuh - light.coolingTotalBtuh) / base.coolingTotalBtuh < 0.05);

// ── skylights and doors
const sky = L({ skylightSqft: 32 });
ok("32 sq ft of skylight adds cooling and heating and shows as its own line", sky.coolingTotalBtuh > base.coolingTotalBtuh && sky.heatingBtuh >= base.heatingBtuh && sky.components.some((c) => /Skylights · 32 sq ft/.test(c.name)));
const doors6 = L({ doorCount: 6 });
const insulated = L({ doorType: "insulated" });
ok("six doors lose more than the default two; insulated ones less than solid wood", doors6.heatingBtuh > base.heatingBtuh && insulated.heatingBtuh < base.heatingBtuh);
ok("…the doors line says how many and what", doors6.components.some((c) => /Doors · 120 sq ft, 6 solid wood/.test(c.name)));

// ── the walk picks them up
const walk = (measurements: WalkthroughAnalysis["measurements"], observations: string[] = []) => {
  const m = modelFromSite({ address: "x", state: "TX", footprintSqft: 2000, storeys: 1, yearBuilt: 1998, sources: {} });
  applyWalkthrough(m, { projectType: "other", title: "", location: "", work: [], behind: [], steps: [], permits: [], scope: "", measurements, observations, frames: [], enoughDetail: true, questions: [], confidence: 80, transcriptHighlights: [] });
  return m;
};
const w = walk([
  { label: "Blower door", value: "2400", unit: "CFM50", confidence: "high", source: "spoken" },
  { label: "Duct leakage to outside", value: "120", unit: "CFM25", confidence: "high", source: "spoken" },
  { label: "West-facing glass", value: "140", unit: "sq ft", confidence: "medium", source: "spoken" },
  { label: "Skylights", value: "2", confidence: "high", source: "visual" },
  { label: "Siding colour", value: "dark grey", confidence: "high", source: "visual" },
  { label: "Wall construction", value: "brick veneer", confidence: "high", source: "spoken" },
  { label: "Exterior doors", value: "3", confidence: "high", source: "visual" },
]);
ok("walk: blower door 2400 CFM50", w.blowerDoorCfm50 === 2400, String(w.blowerDoorCfm50));
ok("walk: duct leakage 120 CFM25", w.ducts.leakageCfm25 === 120, String(w.ducts.leakageCfm25));
ok("walk: 140 sq ft of west glass — not the house's square footage", w.glassWestSqft === 140 && w.conditionedSqft !== 140, `${w.glassWestSqft} / ${w.conditionedSqft}`);
ok("walk: two skylights → 16 sq ft", w.skylightSqft === 16, String(w.skylightSqft));
ok("walk: dark grey siding → dark; brick veneer; three doors", w.sidingColor === "dark" && w.wallConstruction === "brick-veneer" && w.doorCount === 3, `${w.sidingColor} ${w.wallConstruction} ${w.doorCount}`);
const ach = walk([{ label: "Blower door ACH50", value: "4.5", confidence: "high", source: "spoken" }]);
ok("walk: 'Blower door ACH50: 4.5' is ACH50, not CFM50", ach.blowerDoorAch50 === 4.5 && ach.blowerDoorCfm50 === undefined);
const said = walk([], ["White siding all round, a brick front on the street side.", "Concrete block house with two skylights in the kitchen."]);
ok("walk phrases: white siding → light, block house → masonry, two skylights → 16 sq ft", said.sidingColor === "light" && said.wallConstruction === "masonry" && said.skylightSqft === 16, `${said.sidingColor} ${said.wallConstruction} ${said.skylightSqft}`);

// ── defaults: new and saved before
const fresh = modelFromSite({ address: "x", state: "TX", footprintSqft: 2000, storeys: 1, yearBuilt: 1998, sources: {} });
ok("a new site: wood frame, medium siding, solid doors — marked default", fresh.wallConstruction === "wood-frame" && fresh.sidingColor === "medium" && fresh.doorType === "solid-wood" && fresh.provenance.wallConstruction?.source === "default" && fresh.provenance.sidingColor?.source === "default");
const old = house();
fillEnvelopeDefaults(old);
ok("an estimate saved before: filled at the defaults, marked default", old.wallConstruction === "wood-frame" && old.provenance.doorType?.source === "default");
const typed = house({ sidingColor: "dark", provenance: { sidingColor: { source: "stated", confidence: "high", entered: true } } });
fillEnvelopeDefaults(typed);
ok("…never over an answer", typed.sidingColor === "dark" && typed.provenance.sidingColor?.source === "stated");

// ── the form's controls
ok("every new field has its control (label, kind, options)", ["wallConstruction", "sidingColor", "blowerDoorCfm50", "blowerDoorAch50", "glassNorthSqft", "glassEastSqft", "glassSouthSqft", "glassWestSqft", "skylightSqft", "doorCount", "doorType", "ducts.leakageCfm25"].every((p) => !!FIX_FIELDS[p]));

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
