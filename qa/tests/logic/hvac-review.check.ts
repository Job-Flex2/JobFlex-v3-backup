// Synthetic check of the 2026-09-17 inspection fixes — no network, no browser.
//   npx tsx --tsconfig tsconfig.json qa/tests/logic/hvac-review.check.ts
// Five reviewers walked the estimator (load, selection + checks, ledger, data,
// page) and every finding they proved is pinned here: the wall bearings, the
// metro design temperatures, the storey guard, the ventilation and altitude
// terms, Manual S for a heat pump where heating governs, the furnace that
// carries the coil, package units judged on their heat, propane pipe, the
// removals and circuits keyed on what is on site, the CSV round trip, and the
// catalog rows that name real models.
import { modelFromSite } from "../../../src/lib/hvac/intake";
import { runEngine } from "../../../src/lib/hvac/engine";
import { buildLedger, DEFAULT_RATE_CARD, normalizeRateCard, parseCatalogCsv, STARTER_CATALOG, CATALOG_CSV_COLUMNS } from "../../../src/lib/hvac/ledger";
import { US_CATALOG } from "../../../src/lib/hvac/data/usCatalog";
import { designConditionsFor } from "../../../src/lib/hvac/designConditions";
import { computeBlockLoad } from "../../../src/lib/hvac/load";
import { ringGeometry, storeysFromHeight } from "../../../src/lib/hvac/site";
import { gasCheck } from "../../../src/lib/hvac/checks";
import { efficiencyFloor } from "../../../src/lib/hvac/data/rules";
import { splitAddress } from "../../../src/lib/hvac/coolcalc";
import { applyWalkthrough } from "../../../src/lib/hvac/intake";
import type { BuildingModel, CatalogItem } from "../../../src/lib/hvac/types";

let failures = 0;
let passes = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) passes++;
  else failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

function house(over: Partial<BuildingModel> = {}): BuildingModel {
  const m = modelFromSite({ address: "4518 Bluestem Hollow Dr, Frisco, TX 75034", state: "TX", county: "Collin", footprintSqft: 2000, storeys: 1, yearBuilt: 1998, sources: {} });
  m.existing = { kind: "split-ac-furnace", tons: 3.5, fuel: "gas", refrigerant: "R-22", yearMade: 2004 };
  m.gas = { ...m.gas, available: true, pipeIn: 0.75, longestRunFt: 40 };
  m.electrical = { ...m.electrical, mainAmps: 200, freeSlots: 6 };
  return { ...m, ...over, existing: { ...m.existing, ...(over.existing ?? {}) }, gas: { ...m.gas, ...(over.gas ?? {}) }, electrical: { ...m.electrical, ...(over.electrical ?? {}) }, ducts: { ...m.ducts, ...(over.ducts ?? {}) } } as BuildingModel;
}
const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id);
const has = (rows: Array<{ id: string }>, ...want: string[]) => want.every((w) => rows.some((r) => r.id === w));
const lacks = (rows: Array<{ id: string }>, ...want: string[]) => want.every((w) => !rows.some((r) => r.id === w));

// ── The house: bearings, storeys, design temperatures, the load ─────────────
{
  // A 100 × 60 ft rectangle traced from the south-west corner eastward: the
  // long walls FACE south and north, the short ones east and west.
  const lat = 33.15, lng = -96.8, dLat = 60 / 364000, dLng = 100 / (364000 * Math.cos((lat * Math.PI) / 180));
  const g = ringGeometry([{ lat, lng }, { lat, lng: lng + dLng }, { lat: lat + dLat, lng: lng + dLng }, { lat: lat + dLat, lng }]);
  ok("Footprint walls carry the direction they face: the long walls S and N, the short ones E and W", g.edges.map((e) => e.bearingDeg).join(",") === "180,90,0,270" && g.edges[0].lengthFt === 100, g.edges.map((e) => `${e.bearingDeg}/${e.lengthFt}`).join(" "));
  const g2 = ringGeometry([{ lat, lng }, { lat: lat + dLat, lng }, { lat: lat + dLat, lng: lng + dLng }, { lat, lng: lng + dLng }]);
  ok("The same ring traced the other way faces the same directions", g2.edges.map((e) => e.bearingDeg).sort().join(",") === "0,180,270,90".split(",").sort().join(","), g2.edges.map((e) => e.bearingDeg).join(","));
  ok("A ridge height reads as storeys: 17 ft is one, 27 ft two, the 13 ft default one", storeysFromHeight(17) === 1 && storeysFromHeight(27) === 2 && storeysFromHeight(13) === 1 && storeysFromHeight(36) === 3);
  const king = designConditionsFor("WA", "King").conditions;
  const la = designConditionsFor("CA", "Los Angeles").conditions;
  const collin = designConditionsFor("TX", "Collin").conditions;
  ok("King County designs on Sea-Tac (84 / 26), not the Stampede Pass limit (11)", king.coolingF === 84 && king.heatingF === 26 && /Seattle-Tacoma/.test(king.source) && /11 °F/.test(king.source), `${king.coolingF}/${king.heatingF}`);
  ok("Los Angeles County designs on downtown (90 / 43), and the note says the coast and the valley differ", la.coolingF === 90 && la.heatingF === 43 && /coast/.test(la.source), `${la.coolingF}/${la.heatingF}`);
  ok("Collin County keeps the county table (no override needed)", collin.coolingF === 100 && collin.heatingF === 20 && !/metro/.test(collin.source));
  const loose = computeBlockLoad(house({ tightness: "average", yearBuilt: 1998 }), collin);
  const tight = computeBlockLoad(house({ tightness: "tight", yearBuilt: 2020 }), collin);
  ok("A tight 2020 house carries a whole-house ventilation term; a 1998 house does not", tight.components.some((c) => /Ventilation/.test(c.name)) && !loose.components.some((c) => /Ventilation/.test(c.name)) && tight.assumptions.some((a) => /ASHRAE 62\.2/.test(a)), tight.components.filter((c) => /Ventilation/.test(c.name)).map((c) => c.name).join());
  const denver = computeBlockLoad(house(), { ...collin, elevationFt: 5280 });
  const sea = computeBlockLoad(house(), { ...collin, elevationFt: 0 });
  const infil = (l: typeof denver) => l.components.find((c) => /Infiltration/.test(c.name))!.heatingBtuh;
  ok("At 5,280 ft the infiltration load carries Manual J's altitude factor (~0.83)", infil(denver) < infil(sea) * 0.86 && infil(denver) > infil(sea) * 0.78 && denver.assumptions.some((a) => /altitude factor/.test(a)), `${infil(denver)} vs ${infil(sea)}`);
  const zone = runEngine(house(), { catalog: US_CATALOG, job: "ductless", input: { heads: 1 } });
  ok("A ductless zone with no size is loaded as a 100 sq ft room and says so", zone.load.assumptions.some((a) => /100 sq ft room/.test(a)), zone.load.assumptions[0]);
}

// ── The walk: labels and insulation ─────────────────────────────────────────
{
  const m = house();
  const meas = (label: string, value: string, unit?: string) => ({ label, value, unit, source: "spoken", confidence: "high" });
  applyWalkthrough(m, { observations: [], transcriptHighlights: [], measurements: [meas("Furnace capacity", "80,000", "BTU"), meas("Attic insulation", "R-19 blown"), meas("Wall insulation", "no insulation")] } as unknown as Parameters<typeof applyWalkthrough>[1]);
  ok("'Furnace capacity: 80,000 BTU' is the furnace input, not 6.5 tons", m.existing.btuInput === 80000 && m.existing.tons === 3.5, `${m.existing.btuInput} / ${m.existing.tons} t`);
  ok("Insulation read on the walk lands in the envelope", m.ceilingInsulation === "r19" && m.wallInsulation === "none", `${m.ceilingInsulation} / ${m.wallInsulation}`);
}

// ── Selection: Manual S where heating governs, the furnace that carries the coil, the smallest unit made ──
{
  const mn = house({ state: "MN", county: "Hennepin", address: "Minneapolis, MN", gas: { available: false }, existing: { kind: "split-heat-pump", tons: 3, fuel: "electric", refrigerant: "R-410A" } });
  const r = runEngine(mn, { catalog: US_CATALOG, job: "heat-pump-conversion" });
  const chosen = r.selection.chosen!;
  ok("Minneapolis, all-electric: heating governs, so a heat pump may run to 125% of the cooling load and the size that carries the most heat wins", !!chosen && (chosen.coolingRatio ?? 0) >= 1 && !r.selection.candidates.some((c) => /allows up to 115%/.test(c.disqualified ?? "") && c.item.kind === "heat-pump" && c.item.staging !== "variable" && (c.coolingRatio ?? 0) <= 1.25), `${chosen?.item.brand} ${chosen?.item.model} · cooling ${chosen?.coolingRatio} · heat ${chosen?.heatAtDesignBtuh} of ${r.load.heatingBtuh}`);
  const gasHouseMn = runEngine(house({ state: "MN", county: "Hennepin" }), { catalog: US_CATALOG, job: "replace-system" });
  ok("The same climate on a gas house still leads with the AC + furnace; the heat pump stays the dual-fuel runner-up", gasHouseMn.selection.chosen?.item.kind === "air-conditioner", gasHouseMn.selection.chosen?.item.kind);
  const fr = runEngine(house({ existing: { kind: "split-ac-furnace", tons: 5, fuel: "gas" } }), { catalog: US_CATALOG, job: "replace-furnace" });
  ok("A furnace under a 5-t coil: the smallest cabinet whose blower carries it, over 140% with the 'Furnace fit' verify, not a 40k that starves the coil", (fr.selection.chosen?.item.maxTons ?? 0) >= 5 && fr.checks.some((c) => c.title === "Furnace fit" && c.status === "verify") && !fr.checks.some((c) => /blower airflow/i.test(c.title) && c.status === "fix"), `${fr.selection.chosen?.item.model} maxTons ${fr.selection.chosen?.item.maxTons} · ${fr.selection.chosen?.outputRatio}`);
  const bedroom = runEngine(house(), { catalog: US_CATALOG, job: "ductless", input: { zoneSqft: 150, heads: 1 } });
  ok("A 150 sq ft bedroom gets the smallest head made, over the window and said so — not 'no fit'", !!bedroom.selection.chosen && bedroom.selection.chosen.reasons.some((x) => /smallest head made/.test(x)), bedroom.selection.chosen?.item.model);
  const small = runEngine(house({ conditionedSqft: 900, tightness: "tight", yearBuilt: 2020, state: "WA", county: "King" }), { catalog: US_CATALOG, job: "replace-system" });
  ok("A 900 sq ft tight Seattle house gets the smallest 1.5-t unit rather than no fit", !!small.selection.chosen, small.selection.chosen?.item.model ?? "none");
}

// ── Package units: judged on their heat, gas where they burn it ─────────────
{
  const pkgGasHouse = house({ existing: { kind: "package-unit", tons: 3.5, fuel: "gas", refrigerant: "R-410A" } });
  const r = runEngine(pkgGasHouse, { catalog: US_CATALOG, job: "replace-system" });
  ok("A gas package house: the value gas packs (10.6 EER2) are in play — no false 11.0 EER2 floor", r.selection.candidates.some((c) => c.item.kind === "package" && c.item.eer2 === 10.6 && !c.disqualified), r.selection.chosen?.item.model);
  ok("The gas package gets a gas-supply check and the CO-alarm item", r.checks.some((c) => c.id === "gas") && r.checks.some((c) => c.title === "CO alarm"), r.checks.map((c) => c.id + ":" + c.title).join(" | ").slice(0, 160));
  const noGasPkg = runEngine(house({ existing: { kind: "package-unit", tons: 3.5, fuel: "electric" }, gas: { available: false } }), { catalog: US_CATALOG, job: "replace-system" });
  ok("A package house with no gas gets a heat-pump or electric package, never a gas pack", noGasPkg.selection.chosen?.item.kind === "package" && noGasPkg.selection.chosen?.item.heatKind !== "gas" && noGasPkg.selection.candidates.some((c) => c.item.heatKind === "gas" && /no gas/.test(c.disqualified ?? "")), `${noGasPkg.selection.chosen?.item.model} ${noGasPkg.selection.chosen?.item.heatKind}`);
  const mnPkg = runEngine(house({ state: "MN", county: "Hennepin", existing: { kind: "package-unit", tons: 3, fuel: "electric" }, gas: { available: false } }), { catalog: US_CATALOG, job: "replace-system" });
  ok("A heat-pump package at −11 °F carries its heat at design and its backup kW", mnPkg.selection.chosen?.item.heatKind === "heat-pump" && typeof mnPkg.selection.chosen?.heatAtDesignBtuh === "number" && (mnPkg.selection.chosen?.backupKw ?? 0) > 0, `${mnPkg.selection.chosen?.item.model} · heat ${mnPkg.selection.chosen?.heatAtDesignBtuh} · ${mnPkg.selection.chosen?.backupKw} kW`);
  const laPkg = runEngine(house({ state: "CA", county: "Los Angeles", existing: { kind: "package-unit", tons: 3, fuel: "electric" }, gas: { available: false } }), { catalog: US_CATALOG, job: "replace-system" });
  ok("The ultra-low-NOx check does not fire on a heat-pump package in Los Angeles", !laPkg.checks.some((c) => c.id === "ca-uln-furnace" && c.status === "fix"), laPkg.checks.filter((c) => c.id === "ca-uln-furnace").map((c) => c.status).join());
  ok("Packaged AC floors: no EER2 outside the Southwest, 10.6 in it; the Southeast install rule is for splits", efficiencyFloor("OH", "air-conditioner", 36000, true).eer2 === undefined && efficiencyFloor("AZ", "air-conditioner", 36000, true).eer2 === 10.6 && !runEngine(house({ state: "FL", county: "Broward", existing: { kind: "package-unit", tons: 3, fuel: "gas" } }), { catalog: US_CATALOG, job: "replace-system" }).checks.some((c) => c.id === "fl-seer2-install"));
}

// ── Checks: propane, long runs, HSPF2, the electric furnace on the panel, the companion furnace's NOx ──
{
  const furnace: CatalogItem = { id: "f", kind: "furnace", brand: "Test", model: "F-080", btuInput: 80000, afue: 0.8, source: "shop" };
  const propane = gasCheck(house({ existing: { fuel: "propane" }, gas: { available: true, pipeIn: 0.5, longestRunFt: 40 } }), furnace, { otherLoadBtuh: 40000 });
  ok("Propane sizes on the propane table: 1/2 in at 40 ft carries 137 kBTU/h, so 120 is a verify (no margin), not a fix", propane?.status === "verify" && /137 kBTU\/h of propane/.test(propane.detail), propane?.detail.slice(0, 100));
  const far = gasCheck(house({ gas: { available: true, pipeIn: 0.5, longestRunFt: 250 } }), furnace, { otherLoadBtuh: 0 });
  ok("A 250 ft run is past the table: verify, never a pass on the 100 ft row", far?.status === "verify" && /past the sizing table/.test(far.detail), far?.detail.slice(0, 80));
  const twoHundred = gasCheck(house({ gas: { available: true, pipeIn: 0.5, longestRunFt: 200 } }), { ...furnace, btuInput: 40000 }, { otherLoadBtuh: 0 });
  ok("200 ft of 1/2 in carries 35 kBTU/h: a 40k furnace is over it", twoHundred?.status === "fix", twoHundred?.detail.slice(0, 80));
  const lowHspf: CatalogItem = { id: "hp-low", kind: "heat-pump", brand: "Test", model: "HP-036-LOW", tons: 3, coolingBtuh: 36000, heat47Btuh: 36000, seer2: 15.2, hspf2: 7, staging: "variable", source: "shop" };
  const r = runEngine(house({ gas: { available: false }, existing: { fuel: "electric" } }), { catalog: [...STARTER_CATALOG, lowHspf], job: "replace-system" });
  ok("A 7.0 HSPF2 heat pump is ruled out at selection, not chosen and then flagged", r.selection.candidates.some((c) => c.item.id === "hp-low" && /HSPF2 is below/.test(c.disqualified ?? "")) && r.selection.chosen?.item.id !== "hp-low");
  const oh = runEngine(house({ state: "OH", county: "Franklin" }), { catalog: [{ id: "dl", kind: "ductless", brand: "Test", model: "DL-12", tons: 1, coolingBtuh: 12000, heat47Btuh: 12000, seer2: 13.8, hspf2: 7, staging: "variable", source: "shop" }], job: "ductless", input: { zoneSqft: 300, heads: 1 } });
  ok("A ductless unit is judged on the heat-pump floor (14.3 SEER2 / 7.5 HSPF2), not the North AC floor", oh.selection.candidates.some((c) => /SEER2 is below the 14.3|HSPF2 is below/.test(c.disqualified ?? "")), oh.selection.candidates[0]?.disqualified);
  const ef = runEngine(house({ gas: { available: false }, existing: { fuel: "electric", kind: "furnace-only" }, electrical: { mainAmps: 100, freeSlots: 2, electricRange: true, electricDryer: true, electricWaterHeater: true } }), { catalog: US_CATALOG, job: "replace-furnace" });
  ok("The electric furnace (air handler + heat kit) runs the NEC count and fails a 100 A panel", ef.selection.chosen?.item.kind === "air-handler" && ef.checks.some((c) => c.id === "service" && c.status === "fix"), ef.checks.filter((c) => c.id === "service").map((c) => `${c.status}: ${c.detail.slice(0, 70)}`).join());
  const la = runEngine(house({ state: "CA", county: "Los Angeles" }), { catalog: US_CATALOG, job: "replace-system" });
  const led = buildLedger(la, house({ state: "CA", county: "Los Angeles" }), DEFAULT_RATE_CARD, US_CATALOG, { job: "replace-system", input: {} });
  const fLine = led.materials.find((l) => l.id === "eq-furnace");
  const fRow = US_CATALOG.find((c) => fLine?.name.startsWith(`${c.brand} ${c.model} `) && c.kind === "furnace");
  ok("A full system in Los Angeles County brings an ultra-low-NOx companion furnace, and the NOx check names it as a pass", !!fRow && (fRow.noxNgJ ?? 40) <= 14 && la.checks.some((c) => c.id === "ca-uln-furnace" && c.status === "pass" && c.detail.includes(fRow!.model)), `${fLine?.name.slice(0, 50)} · ${la.checks.find((c) => c.id === "ca-uln-furnace")?.status}`);
  const boiler = runEngine(house({ existing: { kind: "none", fuel: "gas" }, ducts: { location: "none", condition: "unknown" } }), { catalog: US_CATALOG, job: "heat-pump-conversion" });
  ok("A boiler house (gas, no ducts) converts all-electric — no 'dual fuel with the furnace', and the no-ducts flag is on the card", !boiler.dualFuel && boiler.checks.some((c) => c.id === "ducts-none"), `${boiler.dualFuel} · ${boiler.checks.map((c) => c.id).join(",")}`);
  const dfHouse = house({ existing: { kind: "split-heat-pump", tons: 3.5, fuel: "gas", refrigerant: "R-410A" } });
  ok("A heat-pump + gas-furnace house still swaps its outdoor unit as dual fuel", runEngine(dfHouse, { catalog: STARTER_CATALOG, job: "replace-outdoor" }).dualFuel === true);
  const hp17 = STARTER_CATALOG.find((c) => c.kind === "heat-pump" && c.tons === 3.5 && /HP17/.test(c.model))!;
  const picked = runEngine(house(), { catalog: STARTER_CATALOG, job: "replace-system", pick: hp17.id });
  ok("A heat pump picked by hand on a gas full-system run carries no 'offer this as dual fuel' mark", picked.selection.chosen?.item.id === hp17.id && !picked.selection.chosen.reasons.some((x) => /offer this as dual fuel/.test(x)), `${picked.selection.chosen?.item.id} · ${picked.selection.chosen?.reasons.join(" | ").slice(0, 100)}`);
  const splitHouse = runEngine(house({ state: "CA", county: "Los Angeles" }), { catalog: US_CATALOG, job: "replace-system" });
  ok("A split-system house is replaced with a split system, never a package unit", splitHouse.selection.chosen?.item.kind !== "package", splitHouse.selection.chosen?.item.kind);
}

// ── The ledger: what is on site decides the lines ───────────────────────────
{
  const rc = DEFAULT_RATE_CARD;
  const ef = house({ existing: { kind: "furnace-only", fuel: "electric" }, gas: { available: true } });
  const efL = buildLedger(runEngine(ef, { catalog: STARTER_CATALOG, job: "replace-furnace" }), ef, rc, STARTER_CATALOG, { job: "replace-furnace", input: {} });
  ok("An electric furnace on a house that has gas gets no gas flex and no gas hookup", lacks(efL.materials, "m-gasflex") && lacks(efL.labor, "l-gas") && has(efL.materials, "eq-strips"), ids(efL.materials).join(","));
  const fo = house({ existing: { kind: "furnace-only", fuel: "gas" }, ducts: { location: "attic", condition: "good" } });
  const conv = runEngine(fo, { catalog: STARTER_CATALOG, job: "heat-pump-conversion" });
  const convL = buildLedger(conv, fo, rc, STARTER_CATALOG, { job: "heat-pump-conversion", input: {} });
  ok("A dual-fuel conversion on a furnace-only house removes no outdoor unit and prices the coil with a drain and an attic pan", conv.dualFuel === true && lacks(convL.labor, "l-remove") && has(convL.materials, "eq-coil", "m-drain", "m-pump") && !/removal of the old outdoor unit/.test(convL.scope), `${ids(convL.labor).join(",")} · ${ids(convL.materials).join(",")}`);
  const none = house({ existing: { kind: "none", fuel: "gas" } });
  const noneL = buildLedger(runEngine(none, { catalog: STARTER_CATALOG, job: "replace-system" }), none, rc, STARTER_CATALOG, { job: "replace-system", input: {} });
  ok("A house with nothing installed gets no removal and no haul-off", lacks(noneL.labor, "l-remove", "l-remove-furnace", "l-disposal"), ids(noneL.labor).join(","));
  const hpHouse = house({ existing: { kind: "split-heat-pump", tons: 3.5, fuel: "electric", refrigerant: "R-410A" }, gas: { available: false }, electrical: { mainAmps: 200, freeSlots: 6 } });
  const hpL = buildLedger(runEngine(hpHouse, { catalog: STARTER_CATALOG, job: "replace-system" }), hpHouse, rc, STARTER_CATALOG, { job: "replace-system", input: {} });
  ok("A like-for-like heat-pump replacement reuses the 240 V air-handler circuit: no new strip circuit, and the sheet says so", lacks(hpL.materials, "m-breaker-ah") && lacks(hpL.labor, "l-elec-ah") && hpL.assumptions.some((a) => /reuses the existing 240 V/.test(a)), ids(hpL.materials).join(","));
  const gasFull = house();
  const hpOnGas = runEngine(gasFull, { catalog: STARTER_CATALOG, job: "replace-system", outdoorKind: "heat-pump" });
  const hpOnGasL = buildLedger(hpOnGas, gasFull, rc, STARTER_CATALOG, { job: "replace-system", input: {} });
  ok("A full system that puts a heat pump where the AC + furnace was caps the gas and runs the strip circuit", has(hpOnGasL.labor, "l-gascap") && has(hpOnGasL.materials, "m-breaker-ah", "m-brk-ah") && hpOnGas.checks.some((c) => c.title === "Water-heater vent"), `${ids(hpOnGasL.labor).join(",")}`);
  const swapL = buildLedger(runEngine(house({ existing: { refrigerant: "R-454B" } }), { catalog: STARTER_CATALOG, job: "replace-outdoor" }), house({ existing: { refrigerant: "R-454B" } }), rc, STARTER_CATALOG, { job: "replace-outdoor", input: {}, linesetFt: 30 });
  ok("Measuring the line set on a same-refrigerant swap keeps 'flush and reuse' — a measurement is not a new run", swapL.labor.some((l) => l.id === "l-lineset" && /Flush and reuse/.test(l.name)) && lacks(swapL.materials, "m-lineset") && /existing coil and line set/.test(swapL.scope), swapL.labor.find((l) => l.id === "l-lineset")?.name);
  const big = house({ conditionedSqft: 6000, footprintSqft: 6000, electrical: { mainAmps: 100, freeSlots: 0, electricRange: true, electricDryer: true } , ducts: { location: "attic", condition: "good" } });
  const bigE = runEngine(big, { catalog: STARTER_CATALOG, job: "replace-system" });
  const bigL = buildLedger(bigE, big, rc, STARTER_CATALOG, { job: "replace-system", input: {} });
  const q = (rows: Array<{ id: string; quantity: number }>, id: string) => rows.find((r) => r.id === id)?.quantity;
  ok("Two systems: two attic pumps, two circuits, two breakers", bigE.selection.systems === 2 && q(bigL.materials, "m-pump") === 2 && (q(bigL.materials, "m-breaker") ?? 0) === 80 && q(bigL.materials, "m-brk") === 2 && q(bigL.labor, "l-elec") === 2, `systems ${bigE.selection.systems} · pump ${q(bigL.materials, "m-pump")} · breaker ft ${q(bigL.materials, "m-breaker")} · elec ${q(bigL.labor, "l-elec")}`);
  const pkgE = runEngine(house({ existing: { kind: "package-unit", tons: 3, fuel: "gas" } }), { catalog: US_CATALOG, job: "replace-system", pick: US_CATALOG.find((c) => c.kind === "package" && c.heatKind === "heat-pump" && c.tons === 3)?.id });
  const pkgL = buildLedger(pkgE, house({ existing: { kind: "package-unit", tons: 3, fuel: "gas" } }), rc, US_CATALOG, { job: "replace-system", input: {} });
  ok("A heat-pump package picked on a gas house gets no gas lines, and the scope says heat-pump package unit", pkgE.selection.chosen?.item.heatKind === "heat-pump" && lacks(pkgL.materials, "m-gasflex") && lacks(pkgL.labor, "l-gas") && /heat-pump package unit/.test(pkgL.scope), `${pkgE.selection.chosen?.item.model} · ${ids(pkgL.labor).join(",")}`);
  const svc = buildLedger(runEngine(house(), { catalog: STARTER_CATALOG, job: "service", input: { service: { tasks: ["recharge"] } } }), house(), rc, STARTER_CATALOG, { job: "service", input: { service: { tasks: ["recharge"] } } });
  ok("A recharge with no pounds entered is not the headline and the scope reads once", !/Refrigerant recharge/.test(svc.title) && !/diagnostic, diagnostic/.test(svc.scope) && svc.assumptions.some((a) => /enter the pounds/.test(a)), `${svc.title} · ${svc.scope.slice(-40)}`);
  ok("The rate card cannot divide by a zero line-set default", Number.isFinite(normalizeRateCard({ hours: { lineset: 3 }, linesetFtDefault: 0 }).labor.linesetPerFt) && normalizeRateCard({ linesetFtDefault: 0 }).linesetFtDefault === 1);
}

// ── The catalog CSV round trip ──────────────────────────────────────────────
{
  const esc = (v: unknown) => { const s = v === undefined || v === null ? "" : Array.isArray(v) ? v.join("|") : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = US_CATALOG.map((c) => CATALOG_CSV_COLUMNS.map((k) => esc(k === "afue" && c.afue ? Math.round(c.afue * 1000) / 10 : (c as unknown as Record<string, unknown>)[k])).join(","));
  const back = parseCatalogCsv([CATALOG_CSV_COLUMNS.join(","), ...rows].join("\n"));
  const lost = (k: keyof CatalogItem) => US_CATALOG.filter((c) => c[k] !== undefined).length - back.items.filter((c) => c[k] !== undefined).length;
  ok("Export → import keeps the package heat kind, the tank vent, the first-hour rating and the state limits", back.errors.length === 0 && lost("heatKind") === 0 && lost("vent") === 0 && lost("firstHourGal") === 0 && lost("states") === 0, `lost heatKind ${lost("heatKind")} vent ${lost("vent")} fhr ${lost("firstHourGal")} states ${lost("states")}`);
  ok("Two sizes of one coil model stay two rows", new Set(back.items.map((c) => c.id)).size === back.items.length && back.items.filter((c) => /capta2422b3/i.test(c.id)).length === 2, `${back.items.length} rows, ${new Set(back.items.map((c) => c.id)).size} ids`);
  ok("AFUE survives to a tenth of a percent", back.items.filter((c) => c.kind === "furnace" && c.afue !== undefined).every((c) => Math.abs((c.afue ?? 0) - (US_CATALOG.find((u) => u.model === c.model && u.brand === c.brand)?.afue ?? 0)) < 0.0006));
  const blank = parseCatalogCsv("kind,brand,model,tons,afue,cost\nfurnace,Acme,F-060, ,  , ");
  ok("A whitespace-only cell is blank, not zero", blank.items[0]?.tons === undefined && blank.items[0]?.afue === undefined && blank.items[0]?.cost === undefined);
}

// ── The catalog names real models ───────────────────────────────────────────
{
  const vna = US_CATALOG.filter((c) => c.brand === "Carrier" && /27VNA1/.test(c.model));
  ok("Carrier 27VNA1 is one row, the 4.5-t 27VNA154A003, holding 100% heat to 5 °F", vna.length === 1 && vna[0].model === "27VNA154A003" && vna[0].tons === 4.5 && vna[0].heat5Btuh === vna[0].heat47Btuh, vna.map((c) => c.model).join());
  const bova = US_CATALOG.filter((c) => c.brand === "Bosch" && /BOVA-\d\dRTB/.test(c.model));
  ok("Bosch IDS Premium rows name the two real chassis (36 and 60)", bova.length > 0 && bova.every((c) => /BOVA-(36|60)RTB-M20S/.test(c.model)), Array.from(new Set(bova.map((c) => c.model))).join());
  ok("Carrier 59CU5 is single-stage; Goodman GR9S96-U is 14 ng/J; the LG row has a three-digit size code", US_CATALOG.some((c) => /59CU5/.test(c.model) && c.staging === "single") && US_CATALOG.some((c) => /GR9S96-\d{3}-U/.test(c.model) && c.noxNgJ === 14) && US_CATALOG.some((c) => c.brand === "LG" && /LAN\d{3}HYV3/.test(c.model)));
}

// ── Cool Calc's address ─────────────────────────────────────────────────────
{
  const a = splitAddress("6101 Frisco Square Blvd, Frisco, TX 75034, USA");
  const b = splitAddress("4518 Bluestem Hollow Dr Frisco TX 75034");
  ok("A Google address with ', USA' and a typed address with no commas both split into street, city, state and ZIP", a.city === "Frisco" && a.state === "TX" && a.zip === "75034" && b.state === "TX" && b.zip === "75034" && b.city === "Frisco" && /Bluestem Hollow Dr$/.test(b.address), JSON.stringify([a, b]));
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
