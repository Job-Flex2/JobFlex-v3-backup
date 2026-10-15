// Synthetic check of the built-in US catalog — no network, no browser.
//   npx tsx --tsconfig tsconfig.json qa/tests/logic/hvac-catalog.check.ts
// The families expand to a clean pick list (unique ids, the engine's units),
// every kind the jobs need is present with a Good/Better/Best ladder, and the
// engine picks a sensible unit from it for a gas house, an all-electric house,
// a furnace swap, a ductless zone and a water-heater swap.
import { runEngine } from "../../../src/lib/hvac/engine";
import { buildLedger, DEFAULT_RATE_CARD, pickWaterHeater, tiersFor } from "../../../src/lib/hvac/ledger";
import { modelFromSite } from "../../../src/lib/hvac/intake";
import { waterHeaterPlan } from "../../../src/lib/hvac/waterHeater";
import { expandFamily, US_CATALOG, US_CATALOG_VERIFIED_ON, US_FAMILIES } from "../../../src/lib/hvac/data/usCatalog";
import type { BuildingModel, CatalogItem } from "../../../src/lib/hvac/types";
import { coastalSite, efficiencyFloor, ultraLowNoxNeeded } from "../../../src/lib/hvac/data/rules";

let failures = 0;
let passes = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) passes++;
  else failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};
const by = (kind: CatalogItem["kind"]) => US_CATALOG.filter((c) => c.kind === kind);
const tiers = (rows: CatalogItem[]) => new Set(rows.map((c) => c.tier));

// ── shape ───────────────────────────────────────────────────────────────────
ok("Families present", US_FAMILIES.length >= 40, `${US_FAMILIES.length} families → ${US_CATALOG.length} rows`);
const unverified = US_FAMILIES.filter((f) => !f.verified);
ok("Every family names its source page", US_FAMILIES.every((f) => /^https?:\/\//.test(f.sourceUrl)));
ok("At least 70% of the families were read on their page; the rest say so", unverified.length <= US_FAMILIES.length * 0.3 && unverified.every((f) => f.note), `${US_FAMILIES.length - unverified.length}/${US_FAMILIES.length} verified · unverified: ${unverified.map((f) => `${f.brand} ${f.family}`).join(", ")}`);
ok("Ids unique", new Set(US_CATALOG.map((c) => c.id)).size === US_CATALOG.length);
ok("Every row: brand, model, tier, manufacturer source; the verified date only on verified families", US_CATALOG.every((c) => c.brand && c.model && c.tier && c.source === "manufacturer" && (c.verifiedOn === undefined || c.verifiedOn === US_CATALOG_VERIFIED_ON)) && US_CATALOG.some((c) => c.verifiedOn === US_CATALOG_VERIFIED_ON));
ok("No model still carries the {size} placeholder", US_CATALOG.every((c) => !/\{size\}/.test(c.model)));
ok("AFUE is a fraction, SEER2/HSPF2 are ratings", US_CATALOG.every((c) => (c.afue === undefined || (c.afue > 0.7 && c.afue < 1)) && (c.seer2 === undefined || (c.seer2 >= 12 && c.seer2 <= 40)) && (c.hspf2 === undefined || (c.hspf2 >= 6 && c.hspf2 <= 14))));
ok("Cooling gear carries tons and BTU/h", US_CATALOG.filter((c) => ["air-conditioner", "heat-pump", "ductless"].includes(c.kind)).every((c) => c.tons && c.coolingBtuh === Math.round(c.tons * 12000)));
ok("Heat pumps carry 47/17/5 °F capacities that fall with the temperature", by("heat-pump").every((c) => c.heat47Btuh && c.heat17Btuh && c.heat5Btuh && c.heat47Btuh >= c.heat17Btuh && c.heat17Btuh >= c.heat5Btuh));
ok("Cold-climate heat pumps keep ≥ 70% at 5 °F", by("heat-pump").filter((c) => c.coldClimate).every((c) => (c.heat5Btuh ?? 0) >= 0.7 * (c.heat47Btuh ?? 1)), by("heat-pump").filter((c) => c.coldClimate).map((c) => c.model).slice(0, 3).join(", "));
ok("Furnaces carry input, AFUE, static and the blower's max tons", by("furnace").every((c) => c.btuInput && c.afue && c.ratedStaticInWc && c.maxTons));
ok("Furnace ladders cover 40k–120k", (() => { const k = by("furnace").map((c) => (c.btuInput ?? 0) / 1000); return Math.min(...k) <= 45 && Math.max(...k) >= 115; })());
ok("Water heaters: tanks carry gallons, tankless none; every one a fuel, type and vent", by("water-heater").every((c) => c.fuel && c.whType && c.vent && (c.whType === "tankless" ? c.gallons === undefined : (c.gallons ?? 0) >= 30)));
ok("Air handlers / coils carry tons", [...by("air-handler"), ...by("coil")].every((c) => c.tons));

// ── coverage ────────────────────────────────────────────────────────────────
for (const kind of ["air-conditioner", "heat-pump", "furnace", "ductless", "water-heater"] as const) {
  ok(`${kind}: rows with a Good/Better/Best ladder`, by(kind).length >= 6 && tiers(by(kind)).size === 3, `${by(kind).length} rows · tiers ${Array.from(tiers(by(kind))).join("/")}`);
}
ok("Indoor units: air handlers and coils for every AC / heat-pump brand", ["Goodman", "Carrier", "Trane", "Lennox", "Rheem"].every((b) => by("air-handler").some((c) => c.brand === b) && by("coil").some((c) => c.brand === b)), `${by("air-handler").length} air handlers · ${by("coil").length} coils`);
const brands = (kind: CatalogItem["kind"]) => new Set(by(kind).map((c) => c.brand));
ok("AC: the big US brands", ["Goodman", "Carrier", "Trane", "Lennox", "Rheem"].every((b) => brands("air-conditioner").has(b)), Array.from(brands("air-conditioner")).join(", "));
ok("Heat pumps: cold-climate families on the list", by("heat-pump").some((c) => c.coldClimate), Array.from(new Set(by("heat-pump").filter((c) => c.coldClimate).map((c) => c.brand))).join(", "));
ok("Ductless: Mitsubishi and Daikin", brands("ductless").has("Mitsubishi") && brands("ductless").has("Daikin"), Array.from(brands("ductless")).join(", "));
ok("Water heaters: gas tank, electric tank, heat-pump tank and gas tankless", ["tank", "heat-pump", "tankless"].every((t) => by("water-heater").some((c) => c.whType === t)) && by("water-heater").some((c) => c.fuel === "electric" && c.whType === "tank"));
ok("Water heaters: Rheem, A.O. Smith, Bradford White and a tankless maker", ["Rheem", "A.O. Smith", "Bradford White"].every((b) => brands("water-heater").has(b)) && by("water-heater").some((c) => c.whType === "tankless" && /Rinnai|Navien/.test(c.brand)), Array.from(brands("water-heater")).join(", "));
ok("Refrigerant: current families are A2L (R-454B / R-32)", by("air-conditioner").filter((c) => c.refrigerant).every((c) => c.refrigerant === "R-454B" || c.refrigerant === "R-32"), Array.from(new Set(by("air-conditioner").map((c) => c.refrigerant))).join("/"));

// ── expander ────────────────────────────────────────────────────────────────
const sample = expandFamily({ brand: "Test", family: "T", pattern: "TX{size}A", kind: "air-conditioner", tier: "value", sizes: [1.5, 3, 5], seer2: 14.3, refrigerant: "R-32", staging: "single", sourceUrl: "https://example.com", verified: true });
ok("Expander: size code is tons × 12, three digits", sample.map((c) => c.model).join(",") === "TX018A,TX036A,TX060A", sample.map((c) => c.model).join(","));
const fam = expandFamily({ brand: "Test", family: "F", pattern: "GF{size}", kind: "furnace", tier: "mid", sizes: [60, 100], afue: 96, staging: "single", maxTonsBySize: { 60: 3, 100: 5 }, sourceUrl: "https://example.com", verified: true });
ok("Expander: furnace code is kBTU, AFUE 96 → 0.96, max tons by size", fam[0].model === "GF060" && fam[0].afue === 0.96 && fam[0].maxTons === 3 && fam[1].maxTons === 5 && fam[1].btuInput === 100_000);
const wh = expandFamily({ brand: "Test", family: "W", pattern: "W{size}G", kind: "water-heater", tier: "value", sizes: [40, 50], whType: "tank", fuel: "gas", uef: 0.64, btuInputBySize: { 40: 36000, 50: 40000 }, vent: "atmospheric", sourceUrl: "https://example.com", verified: true });
ok("Expander: tank gallons and input by size", wh[1].model === "W50G" && wh[1].gallons === 50 && wh[1].btuInput === 40000 && wh[1].vent === "atmospheric");

// ── the engine on the catalog ───────────────────────────────────────────────
function house(over: Partial<BuildingModel> = {}): BuildingModel {
  const m = modelFromSite({ address: "4518 Bluestem Hollow Dr, Frisco, TX 75034", state: "TX", county: "Collin", footprintSqft: 2000, storeys: 1, yearBuilt: 1998, sources: {} });
  m.existing = { kind: "split-ac-furnace", tons: 3.5, fuel: "gas", refrigerant: "R-22", yearMade: 2004 };
  m.electrical = { mainAmps: 200, freeSlots: 4, electricDryer: true };
  m.ducts = { location: "attic", condition: "fair", insulated: true, returnGrilleSqIn: 700 };
  m.gas = { available: true, pipeIn: 0.75, longestRunFt: 30 };
  return Object.assign(m, over);
}
const gas = house();
const r1 = runEngine(gas, { catalog: US_CATALOG, job: "replace-system" });
const c1 = r1.selection.chosen;
ok("Gas house: a real AC family within Manual S", !!c1 && c1.item.kind === "air-conditioner" && c1.item.source === "manufacturer" && (c1.coolingRatio ?? 0) >= 0.9 && (c1.coolingRatio ?? 0) <= 1.15, `${c1?.item.brand} ${c1?.item.model} · ratio ${c1?.coolingRatio}`);
const l1 = buildLedger(r1, gas, DEFAULT_RATE_CARD, US_CATALOG, { job: "replace-system" });
const fur = l1.materials.find((l) => l.id === "eq-furnace");
ok("Gas house: a real furnace whose blower carries the coil", !!fur && /\d+k BTU/.test(fur.name) && !/Starter/.test(fur.name), fur?.name);
ok("Gas house: a real coil", (() => { const c = l1.materials.find((l) => l.id === "eq-coil"); return !!c && !/Starter/.test(c.name); })(), l1.materials.find((l) => l.id === "eq-coil")?.name);
const t1 = tiersFor(r1, gas, DEFAULT_RATE_CARD, US_CATALOG, { job: "replace-system" });
ok("Gas house: Good / Better / Best all land on real units with rising prices", t1.length === 3 && t1[0].subtotal < t1[1].subtotal && t1[1].subtotal < t1[2].subtotal, t1.map((t) => `${t.tier} ${t.candidate.item.brand} ${t.candidate.item.model} $${t.subtotal}`).join(" | "));
ok("Gas house: the furnace and coil come from the condenser's brand", (() => { const b = c1?.item.brand; return !!b && !!fur && fur.name.startsWith(b) && (l1.materials.find((l) => l.id === "eq-coil")?.name ?? "").startsWith(b); })(), `${c1?.item.brand}: ${fur?.name.split(" — ")[0]} + ${l1.materials.find((l) => l.id === "eq-coil")?.name.split(" — ")[0]}`);
ok("Gas house: a Good-tier condenser gets the 80% furnace, Best gets the modulating one", (() => {
  const good = t1.find((t) => t.tier === "value"); const best = t1.find((t) => t.tier === "premium");
  if (!good || !best) return false;
  const lg = buildLedger({ ...r1, selection: { ...r1.selection, chosen: good.candidate } }, gas, DEFAULT_RATE_CARD, US_CATALOG, { job: "replace-system" });
  const lb = buildLedger({ ...r1, selection: { ...r1.selection, chosen: best.candidate } }, gas, DEFAULT_RATE_CARD, US_CATALOG, { job: "replace-system" });
  return /80% AFUE/.test(lg.materials.find((l) => l.id === "eq-furnace")?.name ?? "") && /9[6-9]% AFUE/.test(lb.materials.find((l) => l.id === "eq-furnace")?.name ?? "");
})(), t1.map((t) => `${t.tier}: ${buildLedger({ ...r1, selection: { ...r1.selection, chosen: t.candidate } }, gas, DEFAULT_RATE_CARD, US_CATALOG, { job: "replace-system" }).materials.find((l) => l.id === "eq-furnace")?.name.split(" — ")[0]}`).join(" | "));

const electric = house({ gas: { available: false }, existing: { kind: "split-heat-pump", tons: 3, fuel: "electric", refrigerant: "R-410A" } });
const r2 = runEngine(electric, { catalog: US_CATALOG, job: "replace-system" });
ok("All-electric house: a heat pump from a real family", r2.selection.chosen?.item.kind === "heat-pump" && r2.selection.chosen.item.source === "manufacturer", `${r2.selection.chosen?.item.brand} ${r2.selection.chosen?.item.model}`);
const l2 = buildLedger(r2, electric, DEFAULT_RATE_CARD, US_CATALOG, { job: "replace-system" });
ok("All-electric house: a real air handler from the heat pump's brand", (() => { const a = l2.materials.find((l) => l.id === "eq-ah"); return !!a && !/Starter/.test(a.name) && a.name.startsWith(r2.selection.chosen?.item.brand ?? "?"); })(), l2.materials.find((l) => l.id === "eq-ah")?.name);

const cold = house({ state: "MN", county: "Hennepin", address: "Minneapolis, MN", gas: { available: false }, existing: { kind: "split-heat-pump", tons: 3, fuel: "electric" } });
const r3 = runEngine(cold, { catalog: US_CATALOG, job: "heat-pump-conversion" });
ok("Minnesota all-electric: a cold-climate heat pump wins", r3.selection.chosen?.item.kind === "heat-pump" && !!r3.selection.chosen.item.coldClimate, `${r3.selection.chosen?.item.brand} ${r3.selection.chosen?.item.model} · ${r3.selection.chosen?.heatAtDesignBtuh} BTU/h at design`);
const l3 = buildLedger(r3, cold, DEFAULT_RATE_CARD, US_CATALOG, { job: "heat-pump-conversion" });
ok("Mitsubishi ducted pair: the SVZ air handler, not another brand's", !/Mitsubishi/.test(r3.selection.chosen?.item.brand ?? "") || /Mitsubishi SVZ/.test(l3.materials.find((l) => l.id === "eq-ah")?.name ?? ""), l3.materials.find((l) => l.id === "eq-ah")?.name);

const r4 = runEngine(gas, { catalog: US_CATALOG, job: "replace-furnace" });
ok("Furnace swap: picks a real furnace 100–140% of the heating load", !!r4.selection.chosen && r4.selection.chosen.item.kind === "furnace" && (r4.selection.chosen.outputRatio ?? 0) >= 1 && (r4.selection.chosen.outputRatio ?? 0) <= 1.45, `${r4.selection.chosen?.item.brand} ${r4.selection.chosen?.item.model} · output ratio ${r4.selection.chosen?.outputRatio}`);

const r5 = runEngine(gas, { catalog: US_CATALOG, job: "ductless", input: { zoneSqft: 420, heads: 1 } });
ok("Ductless zone: a real single-zone family, 0.75–1.5 ton", r5.selection.chosen?.item.kind === "ductless" && (r5.selection.chosen.item.tons ?? 0) <= 1.5, `${r5.selection.chosen?.item.brand} ${r5.selection.chosen?.item.model}`);

const plan = waterHeaterPlan(gas, { fuel: "gas", type: "tank", vent: "atmospheric" });
const whRow = pickWaterHeater(US_CATALOG, plan);
ok("Water heater: a real gas atmospheric tank of the sized gallons", !!whRow && whRow.fuel === "gas" && whRow.whType === "tank" && (whRow.gallons ?? 0) >= plan.gallons, `${plan.gallons} gal → ${whRow?.brand} ${whRow?.model} ${whRow?.gallons} gal`);
const hpwh = pickWaterHeater(US_CATALOG, waterHeaterPlan(gas, { fuel: "electric", type: "heat-pump" }));
ok("Water heater: a heat-pump tank", !!hpwh && hpwh.whType === "heat-pump", `${hpwh?.brand} ${hpwh?.model} · UEF ${hpwh?.uef}`);
const tl = pickWaterHeater(US_CATALOG, waterHeaterPlan(gas, { fuel: "gas", type: "tankless" }));
ok("Water heater: a gas tankless", !!tl && tl.whType === "tankless" && (tl.btuInput ?? 0) >= 150_000, `${tl?.brand} ${tl?.model} · ${tl?.btuInput} BTU/h`);
const l6 = buildLedger(runEngine(gas, { catalog: US_CATALOG, job: "water-heater", input: { wh: { fuel: "gas", type: "tank" } } }), gas, DEFAULT_RATE_CARD, US_CATALOG, { job: "water-heater", input: { wh: { fuel: "gas", type: "tank" } } });
ok("Water heater ledger names the catalog tank", /Rheem|A\.O\. Smith|Bradford White/.test(l6.materials[0]?.name ?? ""), l6.materials[0]?.name);


// ── Package units, and what a state lets a contractor buy ──────────────────
{
  const pkgs = by("package");
  ok("Package units: every heat kind, from the big brands", pkgs.length >= 60 && ["gas", "heat-pump", "electric"].every((k) => pkgs.some((c) => c.heatKind === k)) && ["Goodman", "Carrier", "Trane", "Rheem", "York"].every((b) => pkgs.some((c) => c.brand === b)), `${pkgs.length} rows · ${Array.from(new Set(pkgs.map((c) => c.brand))).join(", ")}`);
  ok("A gas package carries its gas input and AFUE; a heat-pump package its HSPF2", pkgs.filter((c) => c.heatKind === "gas").every((c) => c.afue) && pkgs.some((c) => c.heatKind === "gas" && c.btuInput) && pkgs.filter((c) => c.heatKind === "heat-pump").every((c) => c.hspf2));
  ok("A single-package unit answers to the national floor, so a 13.4 SEER2 / 10.6 EER2 package is legal in California", (() => { const f = efficiencyFloor("CA", "air-conditioner", 36000, true); return f.seer2 === 13.4 && f.eer2 === 10.6; })(), efficiencyFloor("CA", "air-conditioner", 36000, true).text);
  const gasPkg = pkgs.filter((c) => c.heatKind === "gas");
  ok("Gas packages carry a NOx class, and the ultra-low ones exist for California", gasPkg.every((c) => c.noxNgJ) && gasPkg.some((c) => (c.noxNgJ ?? 40) <= 14), `${gasPkg.filter((c) => (c.noxNgJ ?? 40) <= 14).length} ultra-low of ${gasPkg.length}`);
  const ulnFurnaces = by("furnace").filter((c) => (c.noxNgJ ?? 40) <= 14);
  ok("California ultra-low-NOx furnaces are on the list, from three makers", ulnFurnaces.length >= 20 && ["Lennox", "Carrier", "Goodman"].every((b) => ulnFurnaces.some((c) => c.brand === b)), `${ulnFurnaces.length} rows · ${Array.from(new Set(ulnFurnaces.map((c) => c.brand))).join(", ")}`);
  ok("The district rule reads the county, not the state line", ultraLowNoxNeeded("CA", "Los Angeles") === "required" && ultraLowNoxNeeded("CA", "Fresno") === "required" && ultraLowNoxNeeded("CA", "Alameda") === "required" && ultraLowNoxNeeded("CA", "Shasta") === "confirm" && ultraLowNoxNeeded("TX", "Collin") === "no");
  ok("Salt air is a coastal-county rule, not a state one", coastalSite("FL", "Broward") && coastalSite("CA", "Orange") && coastalSite("TX", "Galveston") && !coastalSite("TX", "Collin") && !coastalSite("CA", "Fresno"));
  const la = house({ state: "CA", county: "Los Angeles", address: "Los Angeles, CA" });
  const rLa = runEngine(la, { catalog: US_CATALOG, job: "replace-furnace" });
  ok("A furnace in Los Angeles County: only an ultra-low-NOx unit is offered, the rest say why", (rLa.selection.chosen?.item.noxNgJ ?? 40) <= 14 && rLa.selection.candidates.some((c) => /takes only ultra-low-NOx/.test(c.disqualified ?? "")), `${rLa.selection.chosen?.item.brand} ${rLa.selection.chosen?.item.model}`);
  {
    const uln = rLa.checks.find((c) => c.id === "ca-uln-furnace");
    ok("The NOx check names the unit picked and passes it in Los Angeles County", uln?.status === "pass" && !!rLa.selection.chosen && uln.detail.includes(rLa.selection.chosen.item.model) && /Los Angeles County/.test(uln.detail), `${uln?.status}: ${uln?.detail.slice(0, 90)}`);
    const std = US_CATALOG.find((c) => c.kind === "furnace" && (c.noxNgJ ?? 40) > 14 && c.btuInput === 60000);
    const rStd = runEngine(la, { catalog: US_CATALOG, job: "replace-furnace", pick: std?.id });
    const ulnStd = rStd.checks.find((c) => c.id === "ca-uln-furnace");
    ok("A 40 ng/J furnace used anyway there is flagged by name, as a fix", rStd.selection.chosen?.item.id === std?.id && ulnStd?.status === "fix" && /40 ng\/J class/.test(ulnStd?.detail ?? "") && !!std && ulnStd!.detail.includes(std.model), `${ulnStd?.status}: ${ulnStd?.detail.slice(0, 90)}`);
    const rSh = runEngine(house({ state: "CA", county: "Shasta", address: "Redding, CA" }), { catalog: US_CATALOG, job: "replace-furnace" });
    const ulnSh = rSh.checks.find((c) => c.id === "ca-uln-furnace");
    ok("Outside the three districts the NOx check asks to confirm, and names the county", ulnSh?.status === "verify" && /Shasta County/.test(ulnSh.detail), `${ulnSh?.status}: ${ulnSh?.detail.slice(0, 90)}`);
    // The catalog a shop loaded before the California families existed: every furnace is the 40 ng/J class.
    const older = US_CATALOG.filter((c) => !(c.kind === "furnace" && (c.noxNgJ ?? 40) <= 14) && c.kind !== "package").map((c) => (c.kind === "furnace" ? { ...c, noxNgJ: undefined } : c));
    const rOld = runEngine(house({ state: "CA", county: "Contra Costa", address: "Danville, CA" }), { catalog: older, job: "replace-furnace" });
    ok("With a catalog from before the California families, a Contra Costa furnace job finds nothing and every row says why (the wall the page names)", !rOld.selection.chosen && rOld.selection.candidates.length > 0 && rOld.selection.candidates.every((c) => (c.item.noxNgJ ?? 40) > 14 && /14 ng\/J/.test(c.disqualified ?? "")), `${rOld.selection.candidates.length} rows · ${rOld.selection.candidates[0]?.disqualified?.slice(0, 80)}`);
  }
  ok("The same furnace job outside those districts keeps the standard build on the list, with a note", (() => { const r = runEngine(house({ state: "CA", county: "Shasta", address: "Redding, CA" }), { catalog: US_CATALOG, job: "replace-furnace" }); return r.selection.candidates.some((c) => !c.disqualified && (c.item.noxNgJ ?? 40) > 14 && c.reasons.some((x) => /confirm the air district/.test(x))); })());
  for (const [st, county, want] of [["CA", "Los Angeles", "CF1R, CF2R and CF3R"], ["WA", "King", "Manual J load and Manual S selection"], ["OR", "Multnomah", "Minor label does not cover this"], ["FL", "Broward", "Wind tie-down and product approval"], ["TX", "Collin", "TDLR licence and permit"], ["NY", "Kings", "Sizing on the permit"]] as const) {
    const r = runEngine(house({ state: st, county, address: `Test, ${st}` }), { catalog: US_CATALOG, job: "replace-system" });
    ok(`${st}: the state's own rule is on the card ("${want}")`, r.checks.some((c) => c.title === want), r.checks.map((c) => c.title).join(" | ").slice(0, 150));
  }
  ok("A Texas job is not told about salt air in Dallas", !runEngine(house({ state: "TX", county: "Collin", address: "Frisco, TX" }), { catalog: US_CATALOG, job: "replace-system" }).checks.some((c) => c.title === "Salt air"));
  const pkgHouse = house({ existing: { kind: "package-unit", tons: 3.5, fuel: "gas", refrigerant: "R-410A" } });
  const rPkg = runEngine(pkgHouse, { catalog: US_CATALOG, job: "replace-system" });
  ok("A package house is quoted a real package unit", rPkg.selection.chosen?.item.kind === "package", `${rPkg.selection.chosen?.item.brand} ${rPkg.selection.chosen?.item.model}`);
}

console.log(`\n${passes} passed, ${failures} failed`);
if (failures) process.exit(1);
