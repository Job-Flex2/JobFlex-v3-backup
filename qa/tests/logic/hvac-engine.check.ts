// Synthetic check of the HVAC engine — no network, no browser.
//   npx tsx --tsconfig tsconfig.json qa/tests/logic/hvac-engine.check.ts
// The block load moves the way a load must (more insulation → less load, a
// colder design day → more heating, a leakier house → more of both), lands in
// the bands an estimator expects for two well-known houses, and the Manual S
// rules, the heat-pump capacity curve, the NEC 220.83 service check and the
// duct rules answer known cases. Not an ACCA comparison — that is the
// twenty-real-jobs gate in the plan.
import { computeBlockLoad, ENGINE_VERSION, heatingLoadAt, loadLevers } from "../../../src/lib/hvac/load";
import { designConditionsFor } from "../../../src/lib/hvac/designConditions";
import { humidityClass } from "../../../src/lib/hvac/data/defaults";
import { balancePointF, evaluateItem, heatPumpCapacityAt, selectSystem } from "../../../src/lib/hvac/select";
import { ductChecks, electricalCheck, gasCheck, complianceChecks, sizingCheck } from "../../../src/lib/hvac/checks";
import { ductCapacity, equivalentRoundIn, parseDuctSize, roundDuctCfm, staticAtAirflow } from "../../../src/lib/hvac/ductCalc";
import { runEngine } from "../../../src/lib/hvac/engine";
import { buildLedger, DEFAULT_RATE_CARD, STARTER_CATALOG } from "../../../src/lib/hvac/ledger";
import { decodeModelNumber, decodeSerialYear } from "../../../src/lib/hvac/nameplate";
import { efficiencyFloor, incentivesFor, refrigerantRule } from "../../../src/lib/hvac/data/rules";
import type { BuildingModel, CatalogItem, DesignConditions } from "../../../src/lib/hvac/types";

let failures = 0;
let passes = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) passes++;
  else failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};
const between = (v: number, lo: number, hi: number) => v >= lo && v <= hi;

const dallas: DesignConditions = { state: "TX", county: "Dallas", coolingF: 100, heatingF: 22, hddCddRatio: 0.5, humidity: "humid", grainsDiff: 45, elevationFt: 430, source: "test", verifiedOn: "2026-09-15" };
const seattle: DesignConditions = { state: "WA", county: "King", coolingF: 84, heatingF: 24, hddCddRatio: 3.5, humidity: "dry", grainsDiff: 0, elevationFt: 300, source: "test", verifiedOn: "2026-09-15" };
const minneapolis: DesignConditions = { state: "MN", county: "Hennepin", coolingF: 89, heatingF: -11, hddCddRatio: 3.6, humidity: "moderate", grainsDiff: 28, elevationFt: 840, source: "test", verifiedOn: "2026-09-15" };

function house(over: Partial<BuildingModel> = {}): BuildingModel {
  return {
    address: "test", state: "TX", county: "Dallas",
    conditionedSqft: 2000, storeys: 1, ceilingHeightFt: 8, yearBuilt: 1995,
    windowToFloor: 0.14, windowType: "double", wallInsulation: "r13", ceilingInsulation: "r30",
    foundation: "slab", tightness: "average", roofColor: "medium", shading: "some", occupants: 4,
    existing: { kind: "split-ac-furnace", tons: 4, fuel: "gas", refrigerant: "R-410A" },
    electrical: { mainAmps: 200, freeSlots: 6, electricRange: true, electricDryer: true },
    ducts: { location: "attic", condition: "fair", insulated: true, returnGrilleSqIn: 500, measuredTespInWc: 0.45 },
    gas: { available: true, pipeIn: 0.75, longestRunFt: 40 },
    preferences: {},
    provenance: {},
    ...over,
  };
}

// ── an electric furnace's cabinet must move the heat kit's air ──
// 2026-09-20: an electric furnace replacement in Seattle came back as a
// 1.5-ton air handler with a 20 kW kit on it — a 105 °F rise. The kit's
// minimum airflow (about 60 CFM per kW) now sizes the cabinet.
{
  const ah = (tons: number): CatalogItem => ({ id: `ah-${tons}`, kind: "air-handler", brand: "Carrier", model: `FJ5ANX-${String(tons * 12).padStart(3, "0")}`, tons, maxTons: tons });
  const cabinets = [ah(1.5), ah(2), ah(2.5), ah(3), ah(3.5), ah(4), ah(5)];
  const base = computeBlockLoad(house({ state: "WA", county: "King" }), seattle);
  const load = { ...base, heatingBtuh: 68000, coolingTotalBtuh: 18000 };
  const sel = selectSystem(cabinets, load, seattle, house({ state: "WA", county: "King", gas: { available: false }, existing: { kind: "furnace-only", fuel: "electric" } }), { kinds: ["air-handler"] });
  const why = sel.chosen?.reasons.join(" ") ?? "";
  ok("a 68k BTU/h electric furnace (20 kW kit) gets a cabinet that moves its air, not a 1.5-ton", (sel.chosen?.item.tons ?? 0) >= 3, `${sel.chosen?.item.model} ${sel.chosen?.item.tons} ton · ${sel.chosen?.backupKw} kW`);
  ok("…and says why: the kit's airflow, not the coil", /heat kit .* needs about 1,200 CFM/.test(why), why.slice(0, 120));
  const small = selectSystem(cabinets, { ...base, heatingBtuh: 17000, coolingTotalBtuh: 18000 }, seattle, house({ state: "WA", county: "King", gas: { available: false }, existing: { kind: "furnace-only", fuel: "electric" } }), { kinds: ["air-handler"] });
  ok("a 17k BTU/h load (5 kW kit) still takes the small cabinet the coil needs", (small.chosen?.item.tons ?? 9) <= 2, `${small.chosen?.item.tons} ton · ${small.chosen?.backupKw} kW`);
}

// ── the block load lands in estimator bands ──
{
  const l = computeBlockLoad(house(), dallas);
  ok("Dallas 2,000 sq ft 1995 house: cooling 30–45 kBTU/h", between(l.coolingTotalBtuh, 30000, 45000), `${l.coolingTotalBtuh}`);
  ok("…heating 26–45 kBTU/h (13–22 BTU/h per sq ft)", between(l.heatingBtuh, 26000, 45000), `${l.heatingBtuh}`);
  // Summer infiltration at Manual J's rate (half of winter's) leaves an average house near SHR 0.9 — the figure Manual J itself is known for.
  ok("…humid climate carries latent load", l.coolingLatentBtuh >= 2500 && l.sensibleHeatRatio <= 0.92, `latent ${l.coolingLatentBtuh}, SHR ${l.sensibleHeatRatio}`);
  ok("…loads rounded to 500", l.heatingBtuh % 500 === 0 && l.coolingTotalBtuh % 500 === 0);
  ok("…airflow 350 CFM per ton in a humid climate", l.cfmPerTon === 350);
  const s = computeBlockLoad(house({ state: "WA", county: "King", conditionedSqft: 1800, yearBuilt: 1972, windowType: "single", wallInsulation: "r11", ceilingInsulation: "r19", tightness: "leaky", foundation: "crawl-vented", ducts: { location: "crawl", condition: "fair" } }), seattle);
  ok("Seattle 1,800 sq ft 1972 house: heating 40–65 kBTU/h", between(s.heatingBtuh, 40000, 65000), `${s.heatingBtuh}`);
  ok("…cooling 15–30 kBTU/h", between(s.coolingTotalBtuh, 15000, 30000), `${s.coolingTotalBtuh}`);
  ok("…dry climate: no infiltration latent", s.components.find((c) => c.name.startsWith("Infiltration"))!.coolingLatentBtuh === 0);
}

// ── seasonal infiltration and the measured glass (2026-10-14, after "bad sizing" from the field) ──
{
  const l = computeBlockLoad(house(), dallas);
  const inf = l.components.find((c) => c.name.startsWith("Infiltration"))!;
  const m = inf.name.match(/(\d+) CFM winter \/ (\d+) CFM summer/);
  ok("infiltration names a winter and a summer rate", !!m, inf.name);
  ok("summer air changes run about half of winter's (Manual J Table 5A)", !!m && between(Number(m[2]) / Number(m[1]), 0.5, 0.56), m ? `${m[1]} / ${m[2]}` : "");
  ok("a 2,000 sq ft 'average' house: ~0.4 ACH winter, ~0.21 summer", !!m && between(Number(m[1]) * 60 / 16000, 0.38, 0.42) && between(Number(m[2]) * 60 / 16000, 0.2, 0.23), m ? `${(Number(m[1]) * 60 / 16000).toFixed(2)} / ${(Number(m[2]) * 60 / 16000).toFixed(2)}` : "");
  const big = computeBlockLoad(house({ conditionedSqft: 3200 }), dallas);
  const mb = big.components.find((c) => c.name.startsWith("Infiltration"))!.name.match(/(\d+) CFM winter/);
  ok("a 3,200 sq ft house turns over less of its air (~0.32 ACH winter, the table's shape)", !!mb && between(Number(mb[1]) * 60 / 25600, 0.29, 0.34), mb ? (Number(mb[1]) * 60 / 25600).toFixed(2) : "");
  ok("the assumption says so in words", l.assumptions.some((x) => /air changes an hour in winter/.test(x) && /Table 5A/.test(x)));
  // the glass
  const assumed = computeBlockLoad(house(), dallas);
  const counted = computeBlockLoad(house({ windowSqft: 420 }), dallas);
  ok("a counted glass area outranks the era ratio (420 sq ft > 14% of 2,000)", counted.coolingTotalBtuh > assumed.coolingTotalBtuh && /Windows · 420 sq ft/.test(counted.components[0].name) && !/assumed/.test(counted.components[0].name), `${assumed.coolingTotalBtuh} → ${counted.coolingTotalBtuh}`);
  ok("an assumed window area says what 50 sq ft of glass is worth here", assumed.assumptions.some((x) => /Window area assumed at 14%/.test(x) && /every 50 sq ft of glass is about [\d,]+ BTU\/h/.test(x)) && !counted.assumptions.some((x) => /Window area assumed/.test(x)));
  const levers = loadLevers(house(), dallas);
  ok("the levers line: more glass, the attic ducts, one tightness class", levers.length === 1 && /quarter more glass/.test(levers[0]) && /ducts in the attic/.test(levers[0]) && /one tightness class better/.test(levers[0]), levers[0]);
  ok("…and a house with ducts inside and no tighter class to go has fewer levers", /glass/.test(loadLevers(house({ ducts: { location: "conditioned", condition: "good" }, tightness: "very-tight" }), dallas)[0] ?? "") && !/ducts in the/.test(loadLevers(house({ ducts: { location: "conditioned", condition: "good" }, tightness: "very-tight" }), dallas)[0] ?? ""));
  ok("the engine version moved (0.2 seasonal infiltration, 0.3 the envelope in detail)", /0\.[2-9]/.test(ENGINE_VERSION));
}

// ── where the county's air and its station are not the metro's ──
{
  ok("El Paso is a desert, whatever Texas is", humidityClass("TX", "El Paso County") === "dry" && designConditionsFor("TX", "El Paso").conditions.grainsDiff === 0);
  ok("Lubbock and Midland are dry plains (moderate); Harris stays humid", humidityClass("TX", "Lubbock") === "moderate" && humidityClass("TX", "Midland") === "moderate" && humidityClass("TX", "Harris") === "humid");
  const sj = designConditionsFor("CA", "Santa Clara").conditions;
  ok("Santa Clara takes San Jose's 85 / 34, not the ridge's 97 / 27", sj.coolingF === 85 && sj.heatingF === 34 && /San Jose/.test(sj.source));
  const tus = designConditionsFor("AZ", "Pima").conditions;
  ok("Pima takes Tucson's 104 / 32, not the desert-and-mountain 109 / 22", tus.coolingF === 104 && tus.heatingF === 32);
}

// ── monotonic behaviour ──
{
  const base = computeBlockLoad(house(), dallas);
  const insulated = computeBlockLoad(house({ wallInsulation: "r21", ceilingInsulation: "r49", windowType: "double-lowe" }), dallas);
  ok("more insulation → less heating and cooling", insulated.heatingBtuh < base.heatingBtuh && insulated.coolingTotalBtuh < base.coolingTotalBtuh);
  const leaky = computeBlockLoad(house({ tightness: "leaky" }), dallas);
  ok("leakier house → more of both", leaky.heatingBtuh > base.heatingBtuh && leaky.coolingTotalBtuh > base.coolingTotalBtuh);
  const cold = computeBlockLoad(house(), minneapolis);
  ok("colder design day → more heating", cold.heatingBtuh > base.heatingBtuh);
  const inside = computeBlockLoad(house({ ducts: { location: "conditioned", condition: "good" } }), dallas);
  ok("ducts inside the envelope → less load than attic ducts", inside.heatingBtuh < base.heatingBtuh && inside.coolingTotalBtuh < base.coolingTotalBtuh);
  const dark = computeBlockLoad(house({ roofColor: "dark" }), dallas);
  const light = computeBlockLoad(house({ roofColor: "light" }), dallas);
  ok("dark roof → more cooling than light roof", dark.coolingSensibleBtuh > light.coolingSensibleBtuh);
  const west = computeBlockLoad(house({ footprintEdges: [{ bearingDeg: 270, lengthFt: 100 }, { bearingDeg: 90, lengthFt: 100 }] }), dallas);
  const north = computeBlockLoad(house({ footprintEdges: [{ bearingDeg: 0, lengthFt: 100 }, { bearingDeg: 180, lengthFt: 100 }] }), dallas);
  ok("east/west glass gains more than north/south glass", west.coolingSensibleBtuh > north.coolingSensibleBtuh);
  ok("every assumption names its table or figure", base.assumptions.length >= 3 && base.assumptions.every((a) => a.length > 12));
  ok("components sum to the pre-duct totals", (() => {
    const noDuct = computeBlockLoad(house({ ducts: { location: "conditioned", condition: "good" } }), dallas);
    const h = noDuct.components.reduce((a, c) => a + c.heatingBtuh, 0);
    return Math.abs(h - noDuct.heatingBtuh) <= 250;
  })());
  ok("heating load falls to zero at 65 °F", heatingLoadAt(base, dallas, 65) === 0 && heatingLoadAt(base, dallas, dallas.heatingF) === base.heatingBtuh);
}

// ── Manual S rules ──
// The selection checks were written against the 0.1 engine's 37,000 BTU/h Dallas
// load (the 0.2 engine's summer infiltration brings the same house to ~33,500);
// they test the selector's windows and ranking, so the total is pinned.
const load = { ...computeBlockLoad(house(), dallas), coolingTotalBtuh: 37000, coolingTons: 3.08 };
const hp = (tons: number, over: Partial<CatalogItem> = {}): CatalogItem => ({ id: `hp${tons}`, kind: "heat-pump", brand: "Acme", model: `HP${tons * 12}`, refrigerant: "R-454B", staging: "single", tons, seer2: 15, hspf2: 8, source: "shop", ...over });
{
  const small = evaluateItem(hp(2), load, dallas, house());
  ok("a 2-ton unit is disqualified under 90% of the load", !!small.disqualified, small.disqualified);
  const big = evaluateItem(hp(5), load, dallas, house());
  ok("a 5-ton unit is disqualified over 115% (single-stage)", !!big.disqualified, big.disqualified);
  const vari = evaluateItem(hp(4, { staging: "variable" }), load, dallas, house());
  ok("variable capacity gets Manual S latitude to 125%", !vari.disqualified || (vari.coolingRatio ?? 0) > 1.25, `ratio ${vari.coolingRatio}`);
  const right = evaluateItem(hp(3.5), load, dallas, house());
  const also = evaluateItem(hp(3), load, dallas, house());
  // Lean small (2026-10-08): the size nearest the load ranks first, an
  // undersize inside the window costing less than the same oversize.
  const miss = (r: number) => (r >= 1 ? (r - 1) * 100 : (1 - r) * 80);
  ok("the size nearest the load scores higher, leaning small", !right.disqualified && !also.disqualified && (miss(right.coolingRatio ?? 0) < miss(also.coolingRatio ?? 0) ? right.score >= also.score : also.score >= right.score), `3.5 t ${Math.round((right.coolingRatio ?? 0) * 100)}% → ${right.score}; 3 t ${Math.round((also.coolingRatio ?? 0) * 100)}% → ${also.score}`);
  {
    const l = { ...load, coolingTotalBtuh: 33000, coolingTons: 2.75 };
    const under = evaluateItem(hp(2.5), l, dallas, house());
    const over = evaluateItem(hp(3), l, dallas, house());
    ok("95%-ish beats 110%-ish: 2.5 t at 91% outranks 3 t at 109% on a 33,000 load", !under.disqualified && !over.disqualified && under.score > over.score, `${under.score} vs ${over.score}`);
  }
  const ny = evaluateItem(hp(3.5, { refrigerant: "R-410A" }), load, dallas, house({ state: "NY" }));
  ok("R-410A is disqualified in New York", !!ny.disqualified);
  const tx410 = evaluateItem(hp(3.5, { refrigerant: "R-410A" }), load, dallas, house());
  ok("R-410A elsewhere is allowed with a verify note", !tx410.disqualified && tx410.reasons.some((r) => /manufacture date/.test(r)));
  const low = evaluateItem(hp(3.5, { seer2: 13 }), load, dallas, house());
  ok("13 SEER2 fails the Southeast 14.3 floor", !!low.disqualified);
  ok("North region AC floor is 13.4 SEER2", efficiencyFloor("OH", "air-conditioner", 36000).seer2 === 13.4);
  ok("Southwest carries an EER2 floor, with the lower one for a high-SEER2 unit", efficiencyFloor("AZ", "air-conditioner", 36000).eer2 === 11.7 && efficiencyFloor("AZ", "air-conditioner", 48000).eer2 === 11.2 && efficiencyFloor("AZ", "air-conditioner", 36000).eer2IfHighSeer === 9.8);
  ok("A single-package unit answers to the national floor, not the regional one (Southwest adds 10.6 EER2 at installation; the North none)", efficiencyFloor("AZ", "air-conditioner", 36000, true).seer2 === 13.4 && efficiencyFloor("AZ", "air-conditioner", 36000, true).eer2 === 10.6 && efficiencyFloor("OH", "air-conditioner", 36000, true).eer2 === undefined && efficiencyFloor("CA", "heat-pump", 36000, true).hspf2 === 6.7, efficiencyFloor("CA", "air-conditioner", 36000, true).text);
  const sel = selectSystem([hp(2), hp(3), hp(3.5), hp(4), hp(5)], load, dallas, house());
  ok("selection picks an in-window unit and a runner-up", !!sel.chosen && !!sel.runnerUp && !sel.chosen.disqualified, sel.chosen?.item.model);
  ok("target tons rounds to the half ton", sel.targetTons % 0.5 === 0);
}

// ── heat pump at temperature ──
{
  const unit = hp(3, { heat47Btuh: 36000, heat17Btuh: 27000, heat5Btuh: 22000 });
  ok("published points interpolate: 32 °F between 27 and 36", between(heatPumpCapacityAt(unit, 32), 30000, 33000), String(heatPumpCapacityAt(unit, 32)));
  ok("below 5 °F keeps falling but not under 30%", heatPumpCapacityAt(unit, -10) < 22000 && heatPumpCapacityAt(unit, -10) >= 10800);
  ok("above 47 °F holds the rating", heatPumpCapacityAt(unit, 60) === 36000);
  const cc = hp(3, { coldClimate: true });
  const plain = hp(3);
  ok("a cold-climate unit derates less by default", heatPumpCapacityAt(cc, 5) > heatPumpCapacityAt(plain, 5));
  const mn = computeBlockLoad(house({ state: "MN" }), minneapolis);
  // A unit sized to Minneapolis's cooling load, with published cold points.
  const mnTons = Math.max(1.5, Math.round((mn.coolingTotalBtuh / 12000) * 2) / 2);
  const mnUnit = hp(mnTons, { heat47Btuh: mnTons * 12000, heat17Btuh: mnTons * 12000 * 0.75, heat5Btuh: mnTons * 12000 * 0.61 });
  const c = evaluateItem(mnUnit, mn, minneapolis, house({ state: "MN" }));
  ok("Minneapolis unit is in the cooling window", !c.disqualified, c.disqualified);
  ok("Minneapolis: balance point above the design temp and backup sized", (c.balancePointF ?? -99) > minneapolis.heatingF && (c.backupKw ?? 0) > 0, `balance ${c.balancePointF} °F, backup ${c.backupKw} kW`);
  ok("…a non-cold-climate unit is marked down at −11 °F", c.reasons.some((r) => /cold-climate/.test(r)));
  const bp = balancePointF(unit, load, dallas);
  ok("Dallas: the same unit carries the design day or balances near it", bp !== null && bp <= 40, String(bp));
  ok("the curve spans the design temperature to 65 °F", (c.curve ?? []).length > 5 && c.curve![0].outdoorF <= minneapolis.heatingF && c.curve![c.curve!.length - 1].outdoorF >= 60);
}

// ── furnace ──
{
  const furnace = (input: number, afue = 0.96): CatalogItem => ({ id: "f", kind: "furnace", brand: "Acme", model: `F${input / 1000}`, btuInput: input, afue, source: "shop" });
  const under = evaluateItem(furnace(25000), load, dallas, house());
  const over = evaluateItem(furnace(120000), load, dallas, house());
  const fit = evaluateItem(furnace(40000), load, dallas, house());
  ok("furnace under the heating load is disqualified", !!under.disqualified);
  ok("furnace over 140% is disqualified", !!over.disqualified, `${over.outputRatio}`);
  ok("a 40k condensing furnace fits a 32k load", !fit.disqualified && (fit.outputRatio ?? 0) >= 1, `${fit.outputRatio}`);
  ok("all-electric preference disqualifies a furnace", !!evaluateItem(furnace(60000), load, dallas, house({ preferences: { allElectric: true } })).disqualified);
}

// ── checks ──
{
  const chosen = evaluateItem(hp(3.5, { mcaAmps: 22 }), load, dallas, house());
  const d = ductChecks(load, house(), chosen);
  ok("return grille 500 sq in passes for 3.5 tons (700 wanted → fix)", d.find((x) => x.id === "return")!.status === "fix");
  ok("500 sq in passes for 2 tons", ductChecks(load, house(), evaluateItem(hp(2.5), load, dallas, house())).find((x) => x.id === "return")!.status === "pass");
  ok("static 0.45 within 0.5 rating passes", d.find((x) => x.id === "static")!.status === "pass");
  ok("static 0.9 against 0.5 is a fix", ductChecks(load, house({ ducts: { location: "attic", condition: "fair", measuredTespInWc: 0.9 } }), chosen).find((x) => x.id === "static")!.status === "fix");
  ok("no ducts → full duct system", ductChecks(load, house({ ducts: { location: "none", condition: "unknown" } }), chosen)[0].status === "fix");
  const e = electricalCheck(house(), chosen);
  ok("200 A service fits a 3.5-ton heat pump with strips", e.status === "pass", e.detail);
  const tight = electricalCheck(house({ electrical: { mainAmps: 100, electricRange: true, electricDryer: true, electricWaterHeater: true, evCharger: true } }), evaluateItem(hp(3.5, { mcaAmps: 22 }), computeBlockLoad(house({ state: "MN" }), minneapolis), minneapolis, house({ state: "MN" })));
  ok("100 A service with every electric load and cold-climate strips needs an upgrade", tight.status === "fix", tight.detail);
  ok("unknown panel → verify", electricalCheck(house({ electrical: {} }), chosen).status === "verify");
  const g = gasCheck(house(), { id: "f", kind: "furnace", brand: "A", model: "F80", btuInput: 80000, afue: 0.96, source: "shop" });
  ok("¾-inch pipe over 40 ft carries an 80k furnace", g?.status === "pass", g?.detail);
  const g2 = gasCheck(house({ gas: { available: true, pipeIn: 0.5, longestRunFt: 60 } }), { id: "f", kind: "furnace", brand: "A", model: "F80", btuInput: 80000, afue: 0.96, source: "shop" });
  ok("½-inch pipe over 60 ft cannot carry it", g2?.status === "fix", g2?.detail);
  const ca = complianceChecks(house({ state: "CA" }), chosen.item, { touchesRefrigerant: true, touchesDucts: false, newConstruction: false });
  ok("California adds the 2025-code flags: ECC verification of charge and ducts, the CF forms, the refrigerant cap", ca.some((x) => x.id === "ca-t24-charge") && ca.some((x) => x.id === "ca-t24-duct") && ca.some((x) => x.id === "ca-cf-forms") && ca.some((x) => x.id === "ca-carb-gwp"), ca.map((x) => x.id).join(","));
  ok("refrigerant check rides every selection", ca.some((x) => x.id === "refrigerant"));
}

// ── rules with dates ──
{
  ok("25C is recorded as expired, with a date", incentivesFor("TX").some((r) => r.status === "expired" && /2025-12-31/.test(r.text)));
  ok("California HEEHRA reads reserved", incentivesFor("CA").some((r) => r.status === "reserved"));
  ok("Minnesota HEAR reads active", incentivesFor("MN").some((r) => r.status === "active"));
  ok("every incentive row carries verifiedOn", incentivesFor("WA").every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.verifiedOn)));
  ok("R-22 is a replacement, not a repair", refrigerantRule("TX", "R-22").allowed === false);
}

// ── nameplate ──
{
  ok("'24ACC636A003' reads 3 tons", decodeModelNumber("24ACC636A003").tons === 3);
  ok("'GSZ140361' reads 3 tons", decodeModelNumber("GSZ140361").tons === 3);
  ok("'59SC5A060E17' reads a 60k furnace", decodeModelNumber("59SC5A060E17", "furnace").btuInput === 60000);
  ok("'ML180UH070P36B' reads a 70k furnace", decodeModelNumber("ML180UH070P36B").btuInput === 70000);
  ok("'4TTR3036H1000N' reads 3 tons; 'XR13' reads nothing", decodeModelNumber("4TTR3036H1000N").tons === 3 && decodeModelNumber("XR13").tons === undefined);
  ok("'25HCB636A0030030' reads 3 tons, not the 030 suffix", decodeModelNumber("25HCB636A0030030").tons === 3);
  ok("'GSZ140601' is a 5-ton heat pump, not a 60k furnace", decodeModelNumber("GSZ140601").tons === 5 && decodeModelNumber("GSZ140601").btuInput === undefined);
  ok("'GMVC960803BN' reads an 80k furnace", decodeModelNumber("GMVC960803BN").btuInput === 80000);
  ok("'XC16-036-230' reads 3 tons", decodeModelNumber("XC16-036-230").tons === 3);
  ok("Carrier serial 1219E12345 → 2019", decodeSerialYear("Carrier", "1219E12345").year === 2019);
  ok("Goodman serial 1904123456 → 2019", decodeSerialYear("Goodman", "1904123456").year === 2019);
  ok("unknown brand serial → no year", decodeSerialYear("Mystery", "ABC123").year === undefined);
}

// ── the ducts that are there (2026-10-08) ──
{
  ok("'20x8' reads as a rectangular duct", JSON.stringify(parseDuctSize("20x8")) === JSON.stringify({ kind: "rect", widthIn: 20, heightIn: 8 }));
  ok("'16 in' reads as a round duct", parseDuctSize("16 in")?.kind === "round" && (parseDuctSize("16 in") as { diameterIn: number }).diameterIn === 16);
  ok("nonsense is not a size", parseDuctSize("big") === null && parseDuctSize("1") === null && parseDuctSize("") === null);
  const r16 = roundDuctCfm(16);
  ok("a 16 in. round carries about 1,290 CFM at 0.08 in/100 ft", between(r16, 1250, 1330), String(Math.round(r16)));
  ok("a 6 in. run carries about 97 CFM rigid", between(roundDuctCfm(6), 90, 105), String(Math.round(roundDuctCfm(6))));
  ok("20×8 is about a 13.5 in. round", between(equivalentRoundIn({ kind: "rect", widthIn: 20, heightIn: 8 }), 13.2, 13.8), equivalentRoundIn({ kind: "rect", widthIn: 20, heightIn: 8 }).toFixed(1));
  const cap = ductCapacity({ location: "attic", condition: "fair", supplyTrunk: "16", returnDuct: "14", supplyRegisters: 8, branchIn: 6 }, 400);
  ok("the least part is the capacity: 8 × 6 in. runs (~700) under a 16 in. trunk and a 14 in. return", !!cap && cap.limitedBy === "branch runs" && between(cap.capacityCfm, 650, 740), `${cap?.capacityCfm} by ${cap?.limitedBy}`);
  ok("…and says the parts", !!cap && cap.parts.length === 3 && /16 in\. round supply trunk/.test(cap.parts[0]), cap?.parts.join(" | "));
  ok("nothing measured → no capacity (a register count alone is a guess)", ductCapacity({ location: "attic", condition: "fair", supplyRegisters: 8 }, 400) === null);
  ok("static 0.45 on a 3-ton is about 0.77 on a 4-ton through the same ducts", between(staticAtAirflow(0.45, 1200, 1600), 0.74, 0.8), staticAtAirflow(0.45, 1200, 1600).toFixed(2));

  // the checks: a reading taken on the old 3-ton, a 4-ton going in
  const l44 = { ...load, coolingTotalBtuh: 44000, coolingTons: 3.67 };
  const four = evaluateItem(hp(4), l44, dallas, house());
  const scaledStatic = ductChecks(l44, house({ existing: { kind: "split-ac-furnace", tons: 3, fuel: "gas" }, ducts: { location: "attic", condition: "fair", insulated: true, returnGrilleSqIn: 800, measuredTespInWc: 0.45 } }), four).find((x) => x.id === "static")!;
  ok("0.45 measured on the old 3-ton is a fix for a 4-ton: the same ducts read ~0.77", scaledStatic.status === "fix" && /measured on the 3-ton/.test(scaledStatic.detail), scaledStatic.detail);
  const likeForLike = ductChecks(l44, house({ existing: { kind: "split-ac-furnace", tons: 4, fuel: "gas" }, ducts: { location: "attic", condition: "fair", insulated: true, returnGrilleSqIn: 800, measuredTespInWc: 0.45 } }), four).find((x) => x.id === "static")!;
  ok("…and like for like it passes", likeForLike.status === "pass", likeForLike.detail);
  const target = 3 * load.cfmPerTon;
  const three = evaluateItem(hp(3), { ...load, coolingTotalBtuh: 34000 }, dallas, house());
  const shortTrunk = ductChecks({ ...load, coolingTotalBtuh: 34000 }, house({ ducts: { location: "attic", condition: "fair", insulated: true, returnGrilleSqIn: 600, supplyTrunk: "12" } }), three);
  const sizeRow = shortTrunk.find((x) => x.id === "duct-size")!;
  ok(`a 12 in. trunk (~630 CFM) is a fix under a 3-ton's ${target} CFM`, sizeRow.status === "fix" && /supply trunk/.test(sizeRow.detail) && /size the system to the ducts/.test(sizeRow.detail), sizeRow.detail);
  ok("with sizes but no static, the static row only asks for a start-up reading", /confirm with a static reading/.test(shortTrunk.find((x) => x.id === "static")!.detail));
  const bigTrunk = ductChecks({ ...load, coolingTotalBtuh: 34000 }, house({ ducts: { location: "attic", condition: "fair", insulated: true, returnGrilleSqIn: 600, supplyTrunk: "18", returnDuct: "20x10" } }), three).find((x) => x.id === "duct-size")!;
  ok("an 18 in. trunk and a 20×10 return pass for the 3-ton", bigTrunk.status === "pass", bigTrunk.detail);
  const nothing = ductChecks(load, house({ ducts: { location: "attic", condition: "fair", insulated: true, returnGrilleSqIn: 600 } }), three).find((x) => x.id === "static")!;
  ok("nothing measured → 'Airflow not verified', one plain row", nothing.title === "Airflow not verified" && nothing.status === "verify" && /before the install is sold/.test(nothing.detail));

  // the ranking: the ducts hold a bigger size back; so does the old unit that kept up
  const plain = evaluateItem(hp(3), { ...load, coolingTotalBtuh: 34000 }, dallas, house());
  const held = evaluateItem(hp(3), { ...load, coolingTotalBtuh: 34000 }, dallas, house(), { ductCfm: 630 });
  ok("a size the measured ducts cannot carry loses 25 points and says so", held.score === plain.score - 25 && held.reasons.some((r) => /ducts as measured carry about 630/.test(r)), held.reasons.find((r) => /ducts/.test(r)));
  const kept = evaluateItem(hp(3.5), { ...load, coolingTotalBtuh: 40000 }, dallas, house(), { keptUpTons: 3 });
  ok("bigger than the 3-ton that kept up: 12 points off, said", kept.score === evaluateItem(hp(3.5), { ...load, coolingTotalBtuh: 40000 }, dallas, house()).score - 12 && kept.reasons.some((r) => /kept up on the hottest days/.test(r)));
  const sz = sizingCheck({ ...load, coolingTotalBtuh: 44000 }, house({ existing: { kind: "split-ac-furnace", tons: 3, fuel: "gas", keptUp: "yes" } }), four);
  ok("the old 3-ton kept up and the design says 4: a verify that questions the load", sz?.status === "verify" && /inputs are padded/.test(sz.detail) && /82%/.test(sz.detail), sz?.detail);
  ok("no kept-up answer → no sizing row", sizingCheck(load, house(), four) === null);

  // the whole run: the engine, the airflow verdict, the ledger's lines and scope
  const gasHouse = (over: Partial<BuildingModel> = {}) => house({ existing: { kind: "split-ac-furnace", tons: 3.5, fuel: "gas", refrigerant: "R-410A" }, ...over });
  const unverified = runEngine(gasHouse({ ducts: { location: "attic", condition: "fair", insulated: true, returnGrilleSqIn: 700 } }), { catalog: STARTER_CATALOG });
  ok("engine: nothing measured → airflow 'none' and the row among the checks", unverified.airflow?.verifiedBy === "none" && unverified.checks.some((c) => c.title === "Airflow not verified"), `${unverified.airflow?.verifiedBy}`);
  const lu = buildLedger(unverified, gasHouse({ ducts: { location: "attic", condition: "fair", insulated: true, returnGrilleSqIn: 700 } }), DEFAULT_RATE_CARD, STARTER_CATALOG);
  ok("ledger: the proposal's scope carries the one plain line", /Airflow to be verified before install/.test(lu.scope) && lu.assumptions.some((a) => /Airflow to be verified/.test(a)));
  const shortHouse = gasHouse({ ducts: { location: "attic", condition: "fair", insulated: true, returnGrilleSqIn: 700, supplyTrunk: "12" } });
  const shortRun = runEngine(shortHouse, { catalog: STARTER_CATALOG });
  const ls = buildLedger(shortRun, shortHouse, DEFAULT_RATE_CARD, STARTER_CATALOG);
  ok("engine: a 12 in. trunk → airflow by sizes, the duct-size fix", shortRun.airflow?.verifiedBy === "sizes" && shortRun.checks.some((c) => c.id === "duct-size" && c.status === "fix"), `${shortRun.airflow?.verifiedBy} · ${shortRun.selection.chosen?.item.tons} t`);
  ok("ledger: the trunk upsize is priced, materials and labor", ls.materials.some((l) => l.id === "m-trunk-up") && ls.labor.some((l) => l.id === "l-trunk-up"));
  ok("…and the unverified line is gone from the scope", !/Airflow to be verified/.test(ls.scope));
  const measured = gasHouse({ ducts: { location: "attic", condition: "fair", insulated: true, returnGrilleSqIn: 700, measuredTespInWc: 0.4 } });
  ok("engine: a static reading → airflow 'static'", runEngine(measured, { catalog: STARTER_CATALOG }).airflow?.verifiedBy === "static");
  // stepping down: a trunk that carries the smaller of two in-window sizes
  const stepHouse = gasHouse({ ducts: { location: "attic", condition: "fair", insulated: true, returnGrilleSqIn: 700, supplyTrunk: "14" } });
  const l35 = { ...computeBlockLoad(stepHouse, dallas), coolingTotalBtuh: 33000, coolingTons: 2.75 };
  const stepped = selectSystem([hp(3), hp(2.5)], l35, dallas, stepHouse, { ductCfm: 910 });
  ok("the ducts choose: 2.5 t (875 CFM) over 3 t (1,050) on a 14 in. trunk", stepped.chosen?.item.tons === 2.5 && stepped.runnerUp?.item.tons === 3 && stepped.runnerUp.reasons.some((r) => /ducts as measured/.test(r)), `${stepped.chosen?.item.tons} then ${stepped.runnerUp?.item.tons}`);
}

// ── the 2026-10-08 fixes: the Southwest EER2 floor, a missing EER2, one derate table, the fan switch ──
{
  ok("Southwest, 48,000 BTU/h, high-SEER2 unit: the EER2 floor is 9.5 (was 9.8)", efficiencyFloor("AZ", "air-conditioner", 48000).eer2IfHighSeer === 9.5 && efficiencyFloor("AZ", "air-conditioner", 36000).eer2IfHighSeer === 9.8);
  const az = house({ state: "AZ", county: "Maricopa" });
  const noEer = evaluateItem(hp(3.5, { kind: "air-conditioner", eer2: undefined }), load, dallas, az);
  ok("a Southwest row with no EER2 is marked, not passed in silence", !noEer.disqualified && noEer.reasons.some((r) => /EER2 not on the catalog row/.test(r)), noEer.reasons.join(" | "));
  const noEerCheck = complianceChecks(az, hp(3.5, { kind: "air-conditioner", eer2: undefined }), { touchesRefrigerant: true, touchesDucts: false, newConstruction: false }).find((c) => c.id === "efficiency")!;
  ok("…and the efficiency check reads verify for it", noEerCheck.status === "verify", noEerCheck.status);
  const withEer = complianceChecks(az, hp(3.5, { kind: "air-conditioner", eer2: 12 }), { touchesRefrigerant: true, touchesDucts: false, newConstruction: false }).find((c) => c.id === "efficiency")!;
  ok("…while a row with 12 EER2 passes", withEer.status === "pass", withEer.status);
  const plain = hp(3);
  ok("one derate table: a standard unit with no published points holds 62% at 17 °F and 48% at 5 °F", Math.round(heatPumpCapacityAt(plain, 17)) === Math.round(36000 * 0.62) && Math.round(heatPumpCapacityAt(plain, 5)) === Math.round(36000 * 0.48), `${heatPumpCapacityAt(plain, 17)} / ${heatPumpCapacityAt(plain, 5)}`);
  const tight = house({ tightness: "tight", yearBuilt: 2020 });
  const withFan = computeBlockLoad(tight, dallas);
  const noFan = computeBlockLoad({ ...tight, ventilationFan: false }, dallas);
  const leakyFan = computeBlockLoad(house({ tightness: "leaky", yearBuilt: 1975, ventilationFan: true }), dallas);
  ok("a tight 2020 house carries the ventilation term by the era rule", withFan.components.some((c) => /Ventilation/.test(c.name)));
  ok("'no whole-house fan' takes it off and says so", !noFan.components.some((c) => /Ventilation/.test(c.name)) && noFan.heatingBtuh < withFan.heatingBtuh && noFan.assumptions.some((a) => /No whole-house ventilation fan/.test(a)), `${withFan.heatingBtuh} → ${noFan.heatingBtuh}`);
  ok("'yes' on a leaky 1975 house adds it", leakyFan.components.some((c) => /Ventilation/.test(c.name)));
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
