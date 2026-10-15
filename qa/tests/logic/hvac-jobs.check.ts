// Synthetic check of the job kinds — no network.
//   npx tsx --tsconfig tsconfig.json qa/tests/logic/hvac-jobs.check.ts
// Each job runs the engine and the ledger on the same Frisco house and
// writes the lines that job needs and none it does not; labor is priced by
// the task against a measure, never by the hour; a v1 rate card (hours ×
// crew rate) converts to per-task amounts; the water heater sizes from the
// household and answers the gas / circuit / vent checks.
import { runEngine } from "../../../src/lib/hvac/engine";
import { buildLedger, DEFAULT_RATE_CARD, tiersFor, normalizeRateCard, STARTER_CATALOG, waterHeaterOptions } from "../../../src/lib/hvac/ledger";
import { modelFromSite } from "../../../src/lib/hvac/intake";
import { JOBS, jobDef, type JobKind } from "../../../src/lib/hvac/jobs";
import { tankGallonsFor, waterHeaterPlan } from "../../../src/lib/hvac/waterHeater";
import type { BuildingModel, CatalogItem } from "../../../src/lib/hvac/types";
import { US_CATALOG } from "../../../src/lib/hvac/data/usCatalog";
import { SERVICE_MENU, serviceMenuFor } from "../../../src/lib/hvac/serviceMenu";

let failures = 0;
let passes = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) passes++;
  else failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

function house(over: Partial<BuildingModel> = {}): BuildingModel {
  const m = modelFromSite({ address: "4518 Bluestem Hollow Dr, Frisco, TX 75034", state: "TX", county: "Collin", footprintSqft: 2000, storeys: 1, yearBuilt: 1998, sources: {} });
  m.existing = { kind: "split-ac-furnace", tons: 3.5, fuel: "gas", refrigerant: "R-410A", yearMade: 2008 };
  m.electrical = { mainAmps: 200, freeSlots: 4, electricDryer: true };
  m.ducts = { location: "attic", condition: "fair", insulated: true, returnGrilleSqIn: 700, supplyRegisters: 10 };
  m.gas = { available: true, pipeIn: 0.75, longestRunFt: 30 };
  m.occupants = 4;
  return Object.assign(m, over);
}
const run = (job: JobKind, m = house(), input = {}) => {
  const e = runEngine(m, { catalog: STARTER_CATALOG, job, input });
  return { e, l: buildLedger(e, m, DEFAULT_RATE_CARD, STARTER_CATALOG, { job, input }) };
};
const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id);
const has = (rows: Array<{ id: string }>, ...want: string[]) => want.every((w) => rows.some((r) => r.id === w));
const lacks = (rows: Array<{ id: string }>, ...no: string[]) => no.every((w) => !rows.some((r) => r.id === w));

ok("Nine jobs, full system first and default", JOBS.length === 9 && JOBS[0].id === "replace-system" && jobDef("nope").id === "replace-system");

// labor is never by the hour, on any job
for (const j of JOBS) {
  const { l } = run(j.id, house(), j.id === "ductless" ? { zoneSqft: 400, heads: 2 } : j.id === "service" ? { service: { task: "Replace the capacitor", refrigerantLb: 2, parts: [{ name: "Run capacitor 45/5", cost: 28 }] } } : {});
  const hourly = l.labor.filter((x) => /hour/i.test(x.unit) || /\bh\b/.test(x.unit));
  ok(`${j.id}: labor by the task, with a measure`, hourly.length === 0 && l.labor.every((x) => x.unitPrice > 0 && x.quantity > 0 && ["each", "ln ft", "register", "run", "lot", "lb"].includes(x.unit)), hourly.map((x) => x.unit).join(",") || l.labor.map((x) => `${x.id}:${x.unit}`).join(","));
}

// full system — as before
const full = run("replace-system");
ok("Full system: AC + furnace + coil, remove, both sets, line set by the foot, start-up, permit, disposal", has(full.l.materials, "eq-main", "eq-furnace", "eq-coil", "m-lineset", "m-pad", "m-tstat", "m-gasflex") && has(full.l.labor, "l-remove", "l-outdoor", "l-indoor", "l-lineset", "l-elec", "l-gas", "l-tstat", "l-startup", "l-permit", "l-disposal"), ids(full.l.labor).join(","));
ok("Line set labor is per ln ft at the card's rate", (() => { const x = full.l.labor.find((r) => r.id === "l-lineset"); return !!x && x.unit === "ln ft" && x.quantity === 25 && x.unitPrice === DEFAULT_RATE_CARD.labor.linesetPerFt; })());
ok("Set the outdoor unit is one each at the card's amount", (() => { const x = full.l.labor.find((r) => r.id === "l-outdoor"); return !!x && x.unit === "each" && x.quantity === 1 && x.unitPrice === DEFAULT_RATE_CARD.labor.setOutdoor; })());
ok("Full system subtotal in band", full.l.subtotal >= 7000 && full.l.subtotal <= 18000, `$${full.l.subtotal}`);

// outdoor unit only — same refrigerant keeps the coil and flushes the line set
const outdoor = run("replace-outdoor");
ok("Outdoor only: an AC on a gas house, no furnace, no air handler", outdoor.e.selection.chosen?.item.kind === "air-conditioner" && lacks(outdoor.l.materials, "eq-furnace", "eq-ah", "eq-strips", "m-tstat", "m-drain"), ids(outdoor.l.materials).join(","));
ok("Outdoor only, R-454B on an R-410A coil: matched coil and new line set", has(outdoor.l.materials, "eq-coil", "m-lineset") && outdoor.l.labor.find((r) => r.id === "l-lineset")?.unit === "ln ft", ids(outdoor.l.materials).join(","));
const sameRefr = run("replace-outdoor", house({ existing: { kind: "split-ac-furnace", tons: 3.5, fuel: "gas", refrigerant: "R-454B", yearMade: 2024 } }));
ok("Outdoor only, same refrigerant: coil stays, line set flushed (each), no pad", lacks(sameRefr.l.materials, "eq-coil", "m-lineset", "m-pad") && sameRefr.l.labor.find((r) => r.id === "l-lineset")?.unit === "each", ids(sameRefr.l.labor).join(","));
ok("Outdoor only: remove outdoor, set outdoor, the new coil set, connect, start-up, permit, disposal; no gas or thermostat work", has(outdoor.l.labor, "l-remove", "l-outdoor", "l-indoor", "l-elec", "l-startup", "l-permit", "l-disposal") && lacks(outdoor.l.labor, "l-gas", "l-tstat") && outdoor.l.labor.find((r) => r.id === "l-indoor")?.name === "Set the coil on the existing furnace", ids(outdoor.l.labor).join(","));
ok("Outdoor only, same refrigerant: no coil work", lacks(sameRefr.l.labor, "l-indoor"), ids(sameRefr.l.labor).join(","));
const hpHouse = house({ existing: { kind: "split-heat-pump", tons: 3, fuel: "electric" }, gas: { available: false } });
ok("Outdoor only on a heat-pump house picks a heat pump", run("replace-outdoor", hpHouse).e.selection.chosen?.item.kind === "heat-pump");

// furnace only
const furnace = run("replace-furnace");
// The Frisco house keeps a 3.5-t coil: no 100–140% cabinet's blower carries it, so
// the smallest cabinet that does goes on, over 140%, with the "Furnace fit" verify.
ok("Furnace under a 3.5-t coil: the smallest cabinet whose blower carries the coil, over 140% and said so", furnace.e.selection.chosen?.item.kind === "furnace" && (furnace.e.selection.chosen?.outputRatio ?? 0) >= 1 && (furnace.e.selection.chosen?.item.maxTons ?? 0) >= 3.5 && ((furnace.e.selection.chosen?.outputRatio ?? 9) <= 1.4 || furnace.e.checks.some((c) => c.title === "Furnace fit" && c.status === "verify")), `${furnace.e.selection.chosen?.item.model} ${furnace.e.selection.chosen?.outputRatio} · maxTons ${furnace.e.selection.chosen?.item.maxTons}`);
ok("Furnace under a 3.5-t coil: no blower-airflow fix, since the cabinet carries it", !furnace.e.checks.some((c) => /blower airflow/i.test(c.title) && c.status === "fix"), furnace.e.checks.filter((c) => /blower/i.test(c.title)).map((c) => `${c.title}=${c.status}`).join(","));
ok("Furnace: gas flex, vent kit, thermostat; no line set, pad or disconnect", has(furnace.l.materials, "eq-main", "m-gasflex", "m-vent", "m-tstat") && lacks(furnace.l.materials, "m-lineset", "m-pad", "m-disc", "m-surge"), ids(furnace.l.materials).join(","));
ok("Furnace: remove furnace, set furnace, re-set the coil, gas, vent by the foot, electrical reconnect, start-up", has(furnace.l.labor, "l-remove-furnace", "l-indoor", "l-recoil", "l-gas", "l-vent", "l-elec", "l-startup") && furnace.l.labor.find((r) => r.id === "l-vent")?.unit === "ln ft", ids(furnace.l.labor).join(","));
const tiny = run("replace-furnace", house({ conditionedSqft: 700, provenance: { ...house().provenance, conditionedSqft: { source: "stated", confidence: "high" } } }));
ok("Furnace on a tiny load: the smallest-output furnace, flagged over 140%", tiny.e.load.heatingBtuh < 28000 && /^G(80|96)-040$/.test(tiny.e.selection.chosen?.item.model ?? "") && /smallest furnace/.test(tiny.e.selection.chosen?.reasons[0] ?? ""), `${tiny.e.load.heatingBtuh} ${tiny.e.selection.chosen?.item.model}`);
ok("Furnace: no refrigerant or efficiency-floor checks", !furnace.e.checks.some((c) => c.id === "refrigerant" || c.id === "efficiency") && furnace.e.checks.some((c) => c.id === "gas"));

// add cooling
const addAc = run("add-ac", house({ existing: { kind: "furnace-only", fuel: "gas" } }));
ok("Add cooling: condenser + coil, line set, pad, new circuit, drain, thermostat; no removal, no disposal", has(addAc.l.materials, "eq-main", "eq-coil", "m-lineset", "m-pad", "m-breaker", "m-drain", "m-tstat") && lacks(addAc.l.materials, "eq-furnace", "eq-ah") && lacks(addAc.l.labor, "l-remove", "l-disposal") && has(addAc.l.labor, "l-outdoor", "l-indoor", "l-lineset", "l-elec", "l-startup", "l-permit"), ids(addAc.l.labor).join(","));
ok("Add cooling: new circuit priced as one each", addAc.l.labor.find((r) => r.id === "l-elec")?.unitPrice === DEFAULT_RATE_CARD.labor.electricalCircuit);

// heat pump conversion — dual fuel on a gas house
const hp = run("heat-pump-conversion");
ok("Heat pump conversion on a gas house: a heat pump, no keep-gas penalty", hp.e.selection.chosen?.item.kind === "heat-pump" && !(hp.e.selection.chosen?.reasons.some((r) => /keeps gas|keep gas|dual-fuel (pairing|offer)/i.test(r)) ?? false), hp.e.selection.chosen?.reasons.join(" | "));
ok("Dual fuel: coil on the existing furnace + dual-fuel thermostat, no air handler or strips", has(hp.l.materials, "eq-main", "eq-coil", "m-tstat") && lacks(hp.l.materials, "eq-ah", "eq-strips") && hp.l.materials.find((r) => r.id === "m-tstat")?.name === "Dual-fuel thermostat" && /Dual-fuel heat pump/.test(hp.l.title), hp.l.title);
const hpElec = run("heat-pump-conversion", house({ preferences: { allElectric: true } }));
ok("All-electric conversion: air handler + strips, old furnace removed", has(hpElec.l.materials, "eq-ah", "eq-strips") && lacks(hpElec.l.materials, "eq-coil") && has(hpElec.l.labor, "l-remove-furnace"), ids(hpElec.l.labor).join(","));

// ductless zone
const dl = run("ductless", house(), { zoneSqft: 400, heads: 2 });
ok("Ductless: the load is the zone's", dl.e.zone?.sqft === 400 && dl.e.load.coolingTotalBtuh < 15000 && dl.e.load.coolingTotalBtuh > 3000, `${dl.e.load.coolingTotalBtuh}`);
ok("Ductless: heads line quantity 2, line set 50 ft, mount heads ×2, no removal", dl.l.materials.find((r) => r.id === "eq-heads")?.quantity === 2 && dl.l.materials.find((r) => r.id === "m-lineset")?.quantity === 50 && dl.l.labor.find((r) => r.id === "l-heads")?.quantity === 2 && lacks(dl.l.labor, "l-remove", "l-disposal"), ids(dl.l.labor).join(","));

// water heater
ok("Tank size from the household", tankGallonsFor(2, "gas", "tank") === 40 && tankGallonsFor(4, "gas", "tank") === 50 && tankGallonsFor(5, "gas", "tank") === 75 && tankGallonsFor(4, "electric", "tank") === 65 && tankGallonsFor(3, "electric", "heat-pump") === 50);
const wh = run("water-heater");
ok("Water heater on a gas house: 50 gal gas tank, 40k input, B-vent", wh.e.waterHeater?.fuel === "gas" && wh.e.waterHeater.gallons === 50 && wh.e.waterHeater.btuInput === 40000 && wh.e.waterHeater.vent === "atmospheric", JSON.stringify(wh.e.waterHeater));
ok("Water heater: nothing selected, checks are the gas pipe", wh.e.selection.chosen === null && wh.e.checks.every((c) => c.id === "gas" || c.id === "code") && wh.e.checks.some((c) => c.id === "gas"), wh.e.checks.map((c) => c.id).join(","));
ok("Water heater lines: tank, expansion tank, flex, T&P, pan, gas flex, vent; labor remove/set/gas/vent/permit/disposal", has(wh.l.materials, "eq-main", "m-exp", "m-flex", "m-tp", "m-pan", "m-gasflex", "m-vent") && lacks(wh.l.materials, "m-straps", "m-breaker") && has(wh.l.labor, "l-remove", "l-set", "l-gas", "l-vent", "l-permit", "l-disposal") && lacks(wh.l.labor, "l-elec"), ids(wh.l.labor).join(","));
ok("Water heater subtotal in band", wh.l.subtotal >= 1500 && wh.l.subtotal <= 4500, `$${wh.l.subtotal}`);
const hpwh = run("water-heater", house({ state: "WA", county: "King", electrical: { mainAmps: 200, freeSlots: 0 } }), { wh: { type: "heat-pump", fuel: "electric" } });
ok("Heat-pump tank: 65 gal for 4 people, 30 A circuit, condensate kit, straps in WA, new circuit; no free slots is a fix", hpwh.e.waterHeater?.gallons === 65 && hpwh.e.waterHeater.circuitAmps === 30 && has(hpwh.l.materials, "m-cond", "m-straps", "m-breaker") && lacks(hpwh.l.materials, "m-gasflex", "m-vent") && hpwh.e.checks.find((c) => c.id === "service")?.status === "fix", `${JSON.stringify(hpwh.e.waterHeater)} ${hpwh.e.checks.map((c) => c.id + ":" + c.status).join(",")}`);
// a water-heater catalog row is picked by fuel, type and size
const whCatalog = [...STARTER_CATALOG, { id: "wh-1", kind: "water-heater" as const, brand: "Rheem", model: "PROG50-40N RH62", fuel: "gas" as const, whType: "tank" as const, gallons: 50, uef: 0.64, btuInput: 40000, vent: "atmospheric" as const, cost: 780, source: "shop" as const }, { id: "wh-2", kind: "water-heater" as const, brand: "Rheem", model: "PROG40-38N RH62", fuel: "gas" as const, whType: "tank" as const, gallons: 40, uef: 0.62, btuInput: 38000, vent: "atmospheric" as const, cost: 690, source: "shop" as const }];
const whCat = buildLedger(runEngine(house(), { catalog: whCatalog, job: "water-heater" }), house(), DEFAULT_RATE_CARD, whCatalog, { job: "water-heater" });
ok("Water heater from the catalog: the 50 gal gas row, shop cost + markup", /Rheem PROG50-40N/.test(whCat.materials[0].name) && whCat.materials[0].unitPrice === 1053 && whCat.materials[0].basis === "entered" && /0\.64 UEF/.test(whCat.materials[0].name), whCat.materials[0].name + " $" + whCat.materials[0].unitPrice);
const tankless = waterHeaterPlan(house(), { type: "tankless", fuel: "gas" });
ok("Gas tankless: 199k input and the gas-line note", tankless.btuInput === 199000 && tankless.notes.some((n) => /upsized/.test(n)));

// ducts
const ducts = run("ducts");
ok("Ducts (fair): sealing per register (10 counted), airflow check; no permit", has(ducts.l.materials, "m-seal") && ducts.l.labor.find((r) => r.id === "l-seal")?.quantity === 10 && ducts.l.labor.find((r) => r.id === "l-seal")?.unit === "register" && lacks(ducts.l.labor, "l-permit"), ids(ducts.l.labor).join(","));
const ductsPoor = run("ducts", house({ ducts: { location: "attic", condition: "poor", insulated: false, supplyRegisters: 12 } }));
ok("Ducts (poor): runs replaced per run ×12, permit and haul-off", ductsPoor.l.materials.find((r) => r.id === "m-runs")?.quantity === 12 && ductsPoor.l.labor.find((r) => r.id === "l-runs")?.unit === "run" && has(ductsPoor.l.labor, "l-permit", "l-disposal"), ids(ductsPoor.l.labor).join(","));

// service
const svc = run("service", house({ existing: { kind: "split-ac-furnace", tons: 3, fuel: "gas", refrigerant: "R-22" } }), { service: { task: "Replace the capacitor and contactor", refrigerantLb: 2, parts: [{ name: "Run capacitor 45/5", cost: 28 }, { name: "Contactor 40 A", cost: 35 }] } });
ok("Service: diagnostic, recharge by the lb, the repair task, two parts with markup; no permit", has(svc.l.labor, "l-diag", "l-refr", "l-repair") && svc.l.labor.find((r) => r.id === "l-refr")?.unit === "lb" && svc.l.materials.length === 3 && svc.l.materials.find((r) => r.id === "m-part-0")?.unitPrice === 35 && lacks(svc.l.labor, "l-permit"), ids(svc.l.materials).join(","));
ok("Service on R-22 says so", svc.l.assumptions.some((a) => /R-22/.test(a)) && /^Service: /.test(svc.l.title));

// tiers price apart on the starter ladders
const tierRun = (tier: "value" | "mid" | "premium") => { const e = runEngine(house(), { catalog: STARTER_CATALOG, job: "replace-system" }); const c = e.selection.candidates.filter((x) => !x.disqualified && x.item.kind === "air-conditioner" && x.item.tier === tier).sort((a, b) => b.score - a.score)[0]!; return buildLedger({ ...e, selection: { ...e.selection, chosen: c } }, house(), DEFAULT_RATE_CARD, STARTER_CATALOG, { job: "replace-system" }).subtotal; };
const [tv, tm, tp] = [tierRun("value"), tierRun("mid"), tierRun("premium")];
ok("Good < Better < Best on the same house", tv < tm && tm < tp && tp - tv > 1500, `${tv} < ${tm} < ${tp}`);

// the trade review's fixes (2026-09-16)
// A furnace-only gas house (no coil): the load-fit condensing cabinet.
const fOnly = run("replace-furnace", house({ existing: { kind: "furnace-only", fuel: "gas" } }));
ok("Furnace-only: the return check is sized from the load, not 0 tons", !/\b0 CFM|\b0-ton|\b0 sq in/.test(fOnly.e.checks.find((c) => c.id === "return")?.detail ?? "") && /\d{3,} CFM/.test(fOnly.e.checks.find((c) => c.id === "return")?.detail ?? ""), fOnly.e.checks.find((c) => c.id === "return")?.detail);
ok("Furnace-only: vent, neutralizer, CO alarm, vent labor", has(fOnly.l.materials, "m-vent", "m-neut", "m-co") && has(fOnly.l.labor, "l-vent"), ids(fOnly.l.materials).join(","));
ok("Furnace-only: the orphaned water-heater vent and the CO alarm are flagged", fOnly.e.checks.some((c) => /Water-heater vent/.test(c.title)) && fOnly.e.checks.some((c) => /CO alarm/.test(c.title)), fOnly.e.checks.map((c) => c.title).join(" | "));
const pkgHouse = run("replace-system", house({ existing: { kind: "package-unit", tons: 3, fuel: "gas" } }));
ok("Package house: a package unit (rate-card default, no rows), crane, disconnect, no line set or pad", pkgHouse.e.selection.chosen === null && /package|unit/.test(pkgHouse.l.materials[0].name) && has(pkgHouse.l.labor, "l-crane", "l-set") && has(pkgHouse.l.materials, "m-disc") && lacks(pkgHouse.l.materials, "m-lineset", "m-pad", "eq-furnace", "eq-coil"), `${pkgHouse.l.materials[0].name} · ${ids(pkgHouse.l.materials).join(",")} · ${ids(pkgHouse.l.labor).join(",")}`);
ok("Full system with a condensing furnace: PVC vent, neutralizer, CO alarm and vent labor", has(full.l.materials, "m-vent", "m-neut", "m-co") && has(full.l.labor, "l-vent") && /PVC/.test(full.l.materials.find((r) => r.id === "m-vent")?.name ?? ""), ids(full.l.materials).join(","));
ok("Add cooling with an A2L coil on the old furnace: sensor kit + listing check", has(addAc.l.materials, "m-rds") && addAc.e.checks.some((c) => /A2L coil/.test(c.title)), ids(addAc.l.materials).join(","));
ok("Dual fuel keeps the condenser circuit: no new circuit line, the reuse assumption", lacks(hp.l.materials, "m-breaker") && hp.l.labor.find((r) => r.id === "l-elec")?.unitPrice === DEFAULT_RATE_CARD.labor.electricalConnect && hp.l.assumptions.some((a) => /circuit is reused/.test(a)), ids(hp.l.labor).join(","));
const hpFromFurnace = run("heat-pump-conversion", house({ existing: { kind: "furnace-only", fuel: "gas" } }));
ok("Conversion on a furnace-only house: a new circuit", has(hpFromFurnace.l.materials, "m-breaker") && hpFromFurnace.l.labor.find((r) => r.id === "l-elec")?.unitPrice === DEFAULT_RATE_CARD.labor.electricalCircuit);
const tl = run("water-heater", house(), { wh: { type: "tankless", fuel: "gas" } });
ok("Gas tankless: direct vent, GPM sizing, no pan, isolation valves, neutralizer, receptacle, 12 ft vent", tl.e.waterHeater?.vent === "direct" && /GPM/.test(tl.e.waterHeater.sizedFrom) && lacks(tl.l.materials, "m-pan") && has(tl.l.materials, "m-iso", "m-neut", "m-co") && has(tl.l.labor, "l-recep") && tl.l.labor.find((r) => r.id === "l-vent")?.quantity === 12, `${JSON.stringify(tl.e.waterHeater)} ${ids(tl.l.materials).join(",")}`);
ok("Water heater gas check names the water heater and counts the furnace", /the water heater draws/.test(wh.e.checks.find((c) => c.id === "gas")?.detail ?? "") && /other appliances/.test(wh.e.checks.find((c) => c.id === "gas")?.detail ?? ""), wh.e.checks.find((c) => c.id === "gas")?.detail);
ok("Garage gas tank: elevation flag and CO alarm", wh.e.checks.some((c) => /Garage water heater/.test(c.title)) && wh.e.checks.some((c) => /CO alarm/.test(c.title)) && has(wh.l.materials, "m-co"));
const ductsGood = run("ducts", house({ ducts: { location: "attic", condition: "good", insulated: true, supplyRegisters: 8 } }));
ok("Duct job with no grille measured: no return upsize charged, an assumption instead", lacks(ductsGood.l.materials, "m-return") && ductsGood.l.assumptions.some((a) => /Return grille not measured/.test(a)), ids(ductsGood.l.materials).join(","));
const ductsBare = run("ducts", house({ ducts: { location: "attic", condition: "fair", insulated: false, supplyRegisters: 8 } }));
ok("Uninsulated attic ducts: insulation per run is priced", has(ductsBare.l.materials, "m-ins") && ductsBare.l.labor.find((r) => r.id === "l-ins")?.quantity === 8, ids(ductsBare.l.labor).join(","));
ok("Service on R-22: the refrigerant rule shows and R-22 is priced at its own rate", svc.e.checks.some((c) => c.id === "refrigerant") && svc.l.materials.find((r) => r.id === "m-refr")?.unitPrice === 93.75, `${svc.e.checks.map((c) => c.id).join(",")} $${svc.l.materials.find((r) => r.id === "m-refr")?.unitPrice}`);
ok("Ductless zone load carries no duct loss", !dl.e.load.assumptions.some((a) => /Duct loss/.test(a)) && dl.e.load.ductGainCooling === 0, dl.e.load.assumptions.join(" | "));
const bigCoil = run("replace-system", house({ conditionedSqft: 3400, provenance: { ...house().provenance, conditionedSqft: { source: "stated", confidence: "high" } } }));
ok("Big coil takes a furnace whose blower carries it (maxTons)", (() => { const f = bigCoil.l.materials.find((r) => r.id === "eq-furnace"); const tons = bigCoil.e.selection.chosen?.item.tons ?? 0; const row = STARTER_CATALOG.find((c) => f?.name.startsWith(`${c.brand} ${c.model}`)); return !!row && (row.maxTons ?? 0) >= tons; })(), bigCoil.l.materials.find((r) => r.id === "eq-furnace")?.name);

// rate card migration
const v1 = { laborRatePerHour: 100, helperRatePerHour: 50, equipmentMarkupPct: 30, hours: { removeSplit: 3, setOutdoor: 3, setFurnace: 5, lineset: 3, electrical: 2, thermostat: 1, startup: 2 }, materials: { pad: 90 }, equipmentDefaults: { heatPumpPerTon: 1300 } };
const c1 = normalizeRateCard(v1);
ok("v1 card → v2: hours × crew rate become per-task amounts", c1.version === 2 && c1.labor.removeSplit === 450 && c1.labor.setFurnace === 750 && c1.labor.electricalConnect === 300 && c1.labor.linesetPerFt === Math.round((3 * 150) / 25) && c1.equipmentMarkupPct === 30 && c1.materials.pad === 90 && c1.equipmentDefaults.heatPumpPerTon === 1300 && c1.materials.expansionTank === DEFAULT_RATE_CARD.materials.expansionTank, JSON.stringify({ r: c1.labor.removeSplit, f: c1.labor.setFurnace, e: c1.labor.electricalConnect, l: c1.labor.linesetPerFt }));
ok("Garbage in → defaults out", normalizeRateCard(null).labor.startup === DEFAULT_RATE_CARD.labor.startup && normalizeRateCard({ labor: { startup: -5, setOutdoor: "x" } }).labor.startup === DEFAULT_RATE_CARD.labor.startup);
ok("A v2 card round-trips", JSON.stringify(normalizeRateCard(DEFAULT_RATE_CARD)) === JSON.stringify(DEFAULT_RATE_CARD));


// ── What goes outside: AC or heat pump on the jobs that allow both ──────────
{
  const g = house();
  const swapAc = runEngine(g, { catalog: STARTER_CATALOG, job: "replace-outdoor" });
  ok("Outdoor unit on an AC + furnace house: an AC by default, no dual fuel", swapAc.selection.chosen?.item.kind === "air-conditioner" && !swapAc.dualFuel, `${swapAc.selection.chosen?.item.model}`);
  const swapHp = runEngine(g, { catalog: STARTER_CATALOG, job: "replace-outdoor", outdoorKind: "heat-pump" });
  ok("Outdoor unit, heat pump chosen: a heat pump, run as dual fuel with the furnace that stays", swapHp.selection.chosen?.item.kind === "heat-pump" && swapHp.dualFuel === true, `${swapHp.selection.chosen?.item.model}`);
  ok("Dual-fuel swap: no backup-strip load in the electrical check", !swapHp.checks.some((c) => /strip/i.test(c.detail)), swapHp.checks.find((c) => c.id === "service")?.detail);
  ok("Dual-fuel swap: the reason says the furnace, not kW of strips, carries the cold end", !!swapHp.selection.chosen && !swapHp.selection.chosen.reasons.some((r) => /kW of backup/.test(r)) && swapHp.selection.chosen.reasons.some((r) => /furnace carries the rest/.test(r)), swapHp.selection.chosen?.reasons.find((r) => /carries the rest/.test(r)));
  const lHp = buildLedger(swapHp, g, DEFAULT_RATE_CARD, STARTER_CATALOG, { job: "replace-outdoor", input: {} });
  const ids = lHp.materials.map((l) => l.id);
  ok("Dual-fuel swap ledger: heat pump + matched coil on the furnace + dual-fuel thermostat, no air handler, no strips", ids.includes("eq-main") && ids.includes("eq-coil") && !ids.includes("eq-ah") && !ids.includes("eq-strips") && /dual-fuel thermostat/i.test(lHp.materials.find((l) => l.id === "m-tstat")?.name ?? ""), ids.join(","));
  ok("Dual-fuel swap: title and scope say so", /Dual-fuel heat pump/.test(lHp.title) && /dual fuel, the existing furnace stays as backup/.test(lHp.scope), lHp.title);
  ok("Dual-fuel swap: the condenser circuit is reused and the assumption says to confirm its ampacity", lHp.assumptions.some((a) => /circuit is reused/.test(a)) && !ids.includes("m-breaker"));
  const lAc = buildLedger(swapAc, g, DEFAULT_RATE_CARD, STARTER_CATALOG, { job: "replace-outdoor", input: {} });
  ok("AC swap ledger: no thermostat line (the existing one stays)", !lAc.materials.some((l) => l.id === "m-tstat"), lAc.title);
  const fullHp = runEngine(g, { catalog: STARTER_CATALOG, job: "replace-system", outdoorKind: "heat-pump" });
  const lFull = buildLedger(fullHp, g, DEFAULT_RATE_CARD, STARTER_CATALOG, { job: "replace-system", input: {} });
  ok("Full system, heat pump chosen on a gas house: heat pump + air handler + strips, all-electric, not dual fuel", fullHp.selection.chosen?.item.kind === "heat-pump" && !fullHp.dualFuel && lFull.materials.some((l) => l.id === "eq-ah") && lFull.materials.some((l) => l.id === "eq-strips") && !lFull.materials.some((l) => l.id === "eq-furnace"), lFull.materials.map((l) => l.id).slice(0, 6).join(","));
  const furn = runEngine(g, { catalog: STARTER_CATALOG, job: "replace-furnace", outdoorKind: "heat-pump" });
  ok("The choice is ignored on a job that does not allow it (furnace)", furn.selection.chosen?.item.kind === "furnace");
  const elec = house({ gas: { available: false }, existing: { kind: "split-ac-furnace", tons: 3, fuel: "electric", refrigerant: "R-410A" } });
  const swapElec = runEngine(elec, { catalog: STARTER_CATALOG, job: "replace-outdoor", outdoorKind: "heat-pump" });
  const lElec = buildLedger(swapElec, elec, DEFAULT_RATE_CARD, STARTER_CATALOG, { job: "replace-outdoor", input: {} });
  ok("Outdoor swap to a heat pump on an all-electric house: not dual fuel, the air handler stays", swapElec.selection.chosen?.item.kind === "heat-pump" && !swapElec.dualFuel && !lElec.materials.some((l) => l.id === "eq-ah") && /Heat pump in place of the AC/.test(lElec.title), lElec.title);
  ok("Outdoor swap to a heat pump on an all-electric house: heat-pump thermostat, coil in the air handler, A2L kit named for the air handler", lElec.materials.some((l) => l.id === "m-tstat" && /Heat-pump thermostat/.test(l.name)) && lElec.labor.some((l) => l.id === "l-tstat") && lElec.materials.some((l) => l.id === "eq-coil") && lElec.labor.some((l) => l.id === "l-indoor" && /in the existing air handler/.test(l.name)) && lElec.materials.some((l) => l.id === "m-rds" && /existing air handler/.test(l.name)) && /heat-pump thermostat/.test(lElec.scope), lElec.materials.map((l) => l.id).join(","));
  const same = house({ existing: { kind: "split-ac-furnace", tons: 3.5, fuel: "gas", refrigerant: "R-454B", yearMade: 2025 } });
  const swapSame = runEngine(same, { catalog: STARTER_CATALOG, job: "replace-outdoor", outdoorKind: "heat-pump" });
  const lSame = buildLedger(swapSame, same, DEFAULT_RATE_CARD, STARTER_CATALOG, { job: "replace-outdoor", input: {} });
  ok("Same-refrigerant dual-fuel swap: a heat-pump-rated coil is priced and the words agree (no 'coil stays', no A2L kit, no A2L check)", swapSame.dualFuel === true && lSame.materials.some((l) => l.id === "eq-coil" && /heat-pump-rated coil/.test(l.note ?? "")) && !lSame.materials.some((l) => l.id === "m-rds") && !lSame.assumptions.some((a) => /coil stays/.test(a)) && /heat-pump-rated matched coil on the existing line set/.test(lSame.scope) && !swapSame.checks.some((c) => /A2L coil/.test(c.title)), `${lSame.materials.find((l) => l.id === "eq-coil")?.note} · ${lSame.scope.slice(-90)}`);
  const df = house({ existing: { kind: "split-heat-pump", tons: 3.5, fuel: "gas", refrigerant: "R-410A", yearMade: 2012 } });
  const swapDf = runEngine(df, { catalog: STARTER_CATALOG, job: "replace-outdoor" });
  const lDf = buildLedger(swapDf, df, DEFAULT_RATE_CARD, STARTER_CATALOG, { job: "replace-outdoor", input: {} });
  ok("A dual-fuel house (heat pump + gas furnace): a plain outdoor swap is a heat pump, like for like — no new thermostat, no swap wording", swapDf.selection.chosen?.item.kind === "heat-pump" && swapDf.dualFuel === true && !lDf.materials.some((l) => l.id === "m-tstat") && /^Heat pump replacement/.test(lDf.title) && !/in place of the AC/.test(lDf.scope), `${lDf.title} · ${lDf.materials.map((l) => l.id).join(",")}`);
  const hpElec = house({ gas: { available: false }, existing: { kind: "split-heat-pump", tons: 3, fuel: "electric", refrigerant: "R-410A" } });
  const hpDefault = runEngine(hpElec, { catalog: STARTER_CATALOG, job: "replace-outdoor" });
  ok("A heat-pump house with no choice made: the engine defaults to a heat pump (like for like)", hpDefault.selection.chosen?.item.kind === "heat-pump", `${hpDefault.selection.chosen?.item.model}`);
  const acOnElectric = runEngine(elec, { catalog: STARTER_CATALOG, job: "replace-outdoor", outdoorKind: "air-conditioner" });
  ok("An AC swap on an all-electric AC + air-handler house is allowed (the indoor unit stays, gas is irrelevant)", acOnElectric.selection.chosen?.item.kind === "air-conditioner", `${acOnElectric.selection.chosen?.item.model}`);
  const hpOnly = STARTER_CATALOG.filter((c) => c.kind !== "air-conditioner");
  const stale = runEngine(elec, { catalog: hpOnly, job: "replace-outdoor", outdoorKind: "air-conditioner" });
  ok("An AC asked for when the catalog has none: the engine falls back to the job's pool instead of an empty design", stale.selection.chosen?.item.kind === "heat-pump", `${stale.selection.chosen?.item.model}`);

  const fullAc = runEngine(g, { catalog: STARTER_CATALOG, job: "replace-system", outdoorKind: "air-conditioner" });
  const lFullAc = buildLedger(fullAc, g, DEFAULT_RATE_CARD, STARTER_CATALOG, { job: "replace-system", input: {} });
  ok("Full system, AC chosen on a gas house: AC + furnace + gas flex", fullAc.selection.chosen?.item.kind === "air-conditioner" && lFullAc.materials.some((l) => l.id === "eq-furnace") && lFullAc.materials.some((l) => l.id === "m-gasflex"), lFullAc.materials.map((l) => l.id).slice(0, 5).join(","));
  const weak = house({ electrical: { mainAmps: 200, freeSlots: 4, existingHvacAmps: 20 } });
  const bigHp: CatalogItem = { id: "t-hp-mca", kind: "heat-pump", brand: "Test", model: "HP-042", tons: 3.5, coolingBtuh: 42000, heat47Btuh: 42000, heat17Btuh: 26000, heat5Btuh: 20000, seer2: 16, hspf2: 8, refrigerant: "R-454B", staging: "single", mcaAmps: 35, source: "shop", tier: "mid" };
  const swapWeak = runEngine(weak, { catalog: [bigHp], job: "replace-outdoor", outdoorKind: "heat-pump" });
  const lWeak = buildLedger(swapWeak, weak, DEFAULT_RATE_CARD, [bigHp], { job: "replace-outdoor", input: {} });
  ok("Outdoor swap to a heat pump whose MCA beats the old AC circuit: a new circuit, no reuse assumption", swapWeak.selection.chosen?.item.id === "t-hp-mca" && lWeak.materials.some((l) => l.id === "m-breaker") && !lWeak.assumptions.some((a) => /circuit is reused/.test(a)), lWeak.materials.map((l) => l.id).join(","));
}


// ── Add cooling: the furnace that stays, whatever its fuel ──────────────────
{
  const elecFurnace = house({ gas: { available: false }, existing: { kind: "furnace-only", fuel: "electric", btuInput: 60000 } });
  const r = runEngine(elecFurnace, { catalog: STARTER_CATALOG, job: "add-ac" });
  const l = buildLedger(r, elecFurnace, DEFAULT_RATE_CARD, STARTER_CATALOG, { job: "add-ac", input: {} });
  ok("Add cooling on an electric furnace-only house: an AC and a coil on the furnace", r.selection.chosen?.item.kind === "air-conditioner" && l.materials.some((x) => x.id === "eq-coil"), `${r.selection.chosen?.item.model} · ${l.materials.map((x) => x.id).slice(0, 4).join(",")}`);
  const small = house({ conditionedSqft: 3200, existing: { kind: "furnace-only", fuel: "gas", btuInput: 40000 } });
  const r2 = runEngine(small, { catalog: STARTER_CATALOG, job: "add-ac" });
  const blower = r2.checks.find((c) => c.title === "Furnace blower airflow");
  ok("Add cooling with a 40k furnace and a 3.5-ton coil: the blower check says fix, with the CFM and the furnace's tons", (r2.selection.chosen?.item.tons ?? 0) >= 3.5 && blower?.status === "fix" && /40k BTU furnace blower carries about 3 t/.test(blower.detail), blower?.detail);
  const noPlate = house({ existing: { kind: "furnace-only", fuel: "gas" } });
  const r3 = runEngine(noPlate, { catalog: STARTER_CATALOG, job: "add-ac" });
  ok("Add cooling with the furnace input unknown: the blower check asks to verify", r3.checks.find((c) => c.title === "Furnace blower airflow")?.status === "verify");
  const hasAc = house();
  const r4 = runEngine(hasAc, { catalog: STARTER_CATALOG, job: "add-ac" });
  ok("Add cooling on a house that already has AC: a fix check says to price it as a replacement", r4.checks.some((c) => c.title === "Already has cooling" && c.status === "fix"));
  ok("Add cooling: no EPA 608 recovery line (nothing is removed)", !r4.checks.some((c) => /EPA 608/.test(c.title)));
  const bare = house({ existing: { kind: "furnace-only", fuel: "gas", btuInput: 80000 }, ducts: { location: "attic", condition: "fair", insulated: false, returnGrilleSqIn: 700 } });
  const r5 = runEngine(bare, { catalog: STARTER_CATALOG, job: "add-ac" });
  ok("Add cooling on bare attic ducts: the insulation check runs (they sweat once cooled)", r5.checks.some((c) => /Duct insulation/i.test(c.title)), r5.checks.map((c) => c.title).join(" | "));
  // The page's Better-tier pick: checks describe that unit
  const g = house();
  const raw = runEngine(g, { catalog: STARTER_CATALOG, job: "replace-system" });
  const mid = raw.selection.candidates.filter((c) => !c.disqualified && c.item.kind === raw.selection.chosen?.item.kind && c.item.tier === "mid").sort((a, b) => b.score - a.score)[0];
  const picked = runEngine(g, { catalog: STARTER_CATALOG, job: "replace-system", pick: mid.item.id });
  const eff = picked.checks.find((c) => c.id === "efficiency");
  ok("A pick re-runs the checks for that unit (efficiency floor names its SEER2)", picked.selection.chosen?.item.id === mid.item.id && !!eff && new RegExp(`This unit: ${mid.item.seer2} SEER2`).test(eff.detail), `${mid.item.model} · ${eff?.detail.slice(-40)}`);
}

// ── Ductless: the pair, the multi-zone unit, the zone ───────────────────────
{
  const g = house();
  const one = runEngine(g, { catalog: US_CATALOG, job: "ductless", input: { zoneSqft: 400, heads: 1 } });
  const l1 = buildLedger(one, g, DEFAULT_RATE_CARD, US_CATALOG, { job: "ductless", input: { zoneSqft: 400, heads: 1 } });
  ok("One head: the catalog pair is the system, no extra head line", l1.materials.some((x) => x.id === "eq-main" && /wall head \+ outdoor unit/.test(x.name)) && !l1.materials.some((x) => x.id === "eq-heads"), l1.materials.find((x) => x.id === "eq-main")?.name);
  ok("Zone target is quarter-ton from 0.5 t, not floored at 1.5", one.selection.targetTons < 1.5 && one.selection.targetTons >= 0.5, `${one.load.coolingTotalBtuh} BTU/h → ${one.selection.targetTons} t`);
  ok("Zone load: two people for 400 sq ft, no kitchen allowance", one.notes.some((n) => /Zone load: 400 sq ft, 2 occupants/.test(n.text)) && one.load.assumptions.some((a) => /no kitchen appliance allowance/.test(a)));
  ok("Ductless: efficiency floor check runs, no EPA 608 line", one.checks.some((c) => c.id === "efficiency") && !one.checks.some((c) => /EPA 608/.test(c.title)), one.checks.map((c) => c.title).join(" | "));
  const three = runEngine(g, { catalog: US_CATALOG, job: "ductless", input: { zoneSqft: 900, heads: 3 } });
  const l3 = buildLedger(three, g, DEFAULT_RATE_CARD, US_CATALOG, { job: "ductless", input: { zoneSqft: 900, heads: 3 } });
  ok("Three heads: a 3-zone outdoor unit priced from the rate card plus three heads, and the note says so", l3.materials.some((x) => x.id === "eq-main" && /3-zone ductless outdoor unit/.test(x.name) && x.basis === "estimated") && l3.materials.some((x) => x.id === "eq-heads" && x.quantity === 3) && three.notes.some((n) => /Multi-zone: 3 heads/.test(n.text)) && /3-zone ductless mini-split/.test(l3.scope), l3.materials.find((x) => x.id === "eq-main")?.name);
  ok("Ductless lines use mini-split words (drain line per head, no static check in start-up)", l3.materials.some((x) => x.id === "m-drain" && /per head/.test(x.name)) && l3.labor.some((x) => x.id === "l-startup" && !/static/.test(x.name)));
}


// ── Second review batch: circuits, cold curve, furnace fit, no gas, words ───
{
  const g = house();
  const allElec = house({ preferences: { allElectric: true } });
  const conv = runEngine(allElec, { catalog: STARTER_CATALOG, job: "heat-pump-conversion" });
  const lConv = buildLedger(conv, allElec, DEFAULT_RATE_CARD, STARTER_CATALOG, { job: "heat-pump-conversion", input: {} });
  ok("All-electric conversion: the strip kit gets its own 240 V circuit and labor, the gas drop is capped, the orphaned water-heater vent is checked", lConv.materials.some((l) => l.id === "m-breaker-ah") && lConv.labor.some((l) => l.id === "l-elec-ah") && lConv.labor.some((l) => l.id === "l-gascap") && conv.checks.some((c) => c.title === "Water-heater vent"), `${lConv.materials.filter((l) => /breaker/.test(l.id)).map((l) => l.id).join(",")} · ${conv.checks.map((c) => c.title).join("|").slice(0, 120)}`);
  const cold = house({ state: "MN", county: "Hennepin", address: "Minneapolis, MN", gas: { available: false }, existing: { kind: "split-heat-pump", tons: 3, fuel: "electric" } });
  const mn = runEngine(cold, { catalog: US_CATALOG, job: "heat-pump-conversion" });
  const cc = mn.selection.candidates.find((c) => /SUZ-AK30/.test(c.item.model));
  ok("Cold-climate row rated 100% to 5 °F derates below it (−11 °F design < rated)", !!cc && (cc.heatAtDesignBtuh ?? 0) < (cc.item.heat47Btuh ?? 0) && (cc.heatAtDesignBtuh ?? 0) > 0.6 * (cc.item.heat47Btuh ?? 0), `${cc?.item.model}: ${cc?.heatAtDesignBtuh} of ${cc?.item.heat47Btuh}`);
  const df = house({ state: "MN", county: "Hennepin", address: "Minneapolis, MN" });
  const mnDf = runEngine(df, { catalog: STARTER_CATALOG, job: "heat-pump-conversion" });
  ok("Dual fuel never says 'the strips will run'", !mnDf.selection.candidates.some((c) => c.reasons.some((r) => /strips will run/.test(r))) && mnDf.selection.candidates.some((c) => c.reasons.some((r) => /furnace will run most cold nights/.test(r))), mnDf.selection.candidates.flatMap((c) => c.reasons).find((r) => /will run most cold nights/.test(r)));
  const big = house({ existing: { kind: "split-ac-furnace", tons: 5, fuel: "gas", refrigerant: "R-410A" } });
  const fBig = runEngine(big, { catalog: US_CATALOG, job: "replace-furnace" });
  ok("Furnace swap under a 5-ton coil: the cabinet carries 5 t, or the blower check says fix", (fBig.selection.chosen?.item.maxTons ?? 0) >= 5 || fBig.checks.some((c) => /blower airflow/.test(c.title) && c.status === "fix"), `${fBig.selection.chosen?.item.model} maxTons ${fBig.selection.chosen?.item.maxTons} · ${fBig.checks.find((c) => /blower/.test(c.title))?.detail?.slice(0, 80) ?? "no blower check"}`);
  const smallCab: CatalogItem[] = [{ id: "f-small", kind: "furnace", brand: "Test", model: "F60-3", btuInput: 60000, afue: 0.96, staging: "single", ratedStaticInWc: 0.5, maxTons: 3, source: "shop", tier: "mid" }];
  const fOnly = runEngine(house({ existing: { kind: "split-ac-furnace", tons: 4, fuel: "gas" } }), { catalog: smallCab, job: "replace-furnace" });
  ok("Only a 3-ton cabinet in the catalog under a 4-ton coil: chosen, and flagged fix", fOnly.selection.chosen?.item.id === "f-small" && fOnly.checks.some((c) => c.title === "Furnace blower airflow" && c.status === "fix" && /4-ton coil/.test(c.detail)), fOnly.checks.find((c) => /blower/.test(c.title))?.detail);
  const noGas = house({ gas: { available: false } });
  const fNoGas = runEngine(noGas, { catalog: US_CATALOG, job: "replace-furnace" });
  const lNoGas = buildLedger(fNoGas, noGas, DEFAULT_RATE_CARD, US_CATALOG, { job: "replace-furnace", input: {} });
  ok("Furnace job on a no-gas house: an electric furnace (air handler + heat kit), no gas lines anywhere, and the words say electric", fNoGas.selection.chosen?.item.kind === "air-handler" && lNoGas.materials.some((l) => l.id === "eq-strips" && /kW heat kit/.test(l.name)) && !lNoGas.labor.some((l) => l.id === "l-gas" || l.id === "l-gaspipe" || l.id === "l-vent") && !lNoGas.materials.some((l) => l.id === "m-gasflex" || l.id === "m-vent") && /^Electric furnace replacement/.test(lNoGas.title) && /electric furnace/.test(lNoGas.scope), `${fNoGas.selection.chosen?.item.brand} ${fNoGas.selection.chosen?.item.model} · ${lNoGas.title} · ${lNoGas.materials.map((l) => l.id).join(",")}`);
  const gasFine = house();
  const fGasFine = runEngine(gasFine, { catalog: US_CATALOG, job: "replace-furnace" });
  ok("Furnace job on a gas house still picks a gas furnace", fGasFine.selection.chosen?.item.kind === "furnace", `${fGasFine.selection.chosen?.item.model}`);
  const tf = tiersFor(runEngine(g, { catalog: STARTER_CATALOG, job: "replace-furnace" }), g, DEFAULT_RATE_CARD, STARTER_CATALOG, { job: "replace-furnace", input: {} });
  ok("Furnace tiers: Good < Better < Best (priced on output, B-vent cheaper than PVC)", tf.length === 3 && tf[0].subtotal < tf[1].subtotal && tf[1].subtotal < tf[2].subtotal, tf.map((t) => `${t.tier} ${t.candidate.item.model} $${t.subtotal}`).join(" | "));
  const f80 = runEngine(house({ existing: { kind: "furnace-only", fuel: "gas", btuInput: 60000 } }), { catalog: STARTER_CATALOG.filter((c) => c.kind !== "furnace" || (c.afue ?? 0) < 0.9), job: "replace-furnace" });
  const l80 = buildLedger(f80, house({ existing: { kind: "furnace-only", fuel: "gas", btuInput: 60000 } }), DEFAULT_RATE_CARD, STARTER_CATALOG, { job: "replace-furnace", input: {} });
  ok("80% furnace on a heat-only house: no condensate drain or pan, a furnace floor flag and no SEER2 flag", !l80.materials.some((l) => l.id === "m-drain" || l.id === "m-pump") && f80.checks.some((c) => c.id === "furnace-floor") && !f80.checks.some((c) => c.id === "federal-floor"), `${f80.selection.chosen?.item.model} · ${l80.materials.map((l) => l.id).join(",")}`);
  const full = house({ electrical: { mainAmps: 200, freeSlots: 0, electricDryer: true } });
  const swapFull = runEngine(full, { catalog: STARTER_CATALOG, job: "replace-outdoor" });
  ok("Outdoor swap on a full panel: no 'free slots' warning (the breaker is reused)", !swapFull.checks.some((c) => /free slot/.test(c.detail)), swapFull.checks.find((c) => c.id === "service")?.detail);
  const elecAh = house({ gas: { available: false }, existing: { kind: "split-ac-furnace", tons: 3, fuel: "electric", refrigerant: "R-410A" } });
  const swapAh = runEngine(elecAh, { catalog: STARTER_CATALOG, job: "replace-outdoor", outdoorKind: "heat-pump" });
  ok("A2L check names the air handler on an electric house", swapAh.checks.some((c) => c.title === "A2L coil on the existing air handler") && !swapAh.checks.some((c) => /existing furnace/.test(c.title)), swapAh.checks.map((c) => c.title).join(" | "));
  const upsized = runEngine(house({ existing: { kind: "split-heat-pump", tons: 3, fuel: "electric" }, gas: { available: false } }), { catalog: STARTER_CATALOG.filter((c) => c.kind !== "heat-pump" || (c.tons ?? 0) >= 3.5), job: "replace-outdoor" });
  ok("Outdoor swap bigger than the air handler it feeds: a blower check asks to verify", upsized.checks.some((c) => c.title === "Air-handler blower airflow" && c.status === "verify"), `${upsized.selection.chosen?.item.model} · ${upsized.checks.map((c) => c.title).join("|")}`);
}


// ── Water heater: the size never shrinks, fuel switches are priced, words ──
{
  const g = house();
  const five = house({ occupants: 5 });
  const r75 = runEngine(five, { catalog: US_CATALOG, job: "water-heater", input: { wh: { fuel: "gas", type: "tank" } } });
  const l75 = buildLedger(r75, five, DEFAULT_RATE_CARD, US_CATALOG, { job: "water-heater", input: { wh: { fuel: "gas", type: "tank" } } });
  const c75 = { sized: r75.waterHeater?.gallons === 75, line: /^75 gal gas tank/.test(l75.materials[0].name), note: l75.assumptions.some((a) => /largest gas tank is .*\(50 gal\)/.test(a)), title: !/50 gal/.test(l75.title) };
  ok("5 occupants → 75 gal: no 75 gal row in the catalog, so the 75 gal is priced from the rate card and the note names the largest row", Object.values(c75).every(Boolean), `${JSON.stringify(c75)} · ${l75.materials[0].name} · ${l75.title}`);
  const rTl = runEngine(g, { catalog: US_CATALOG, job: "water-heater", input: { wh: { fuel: "gas", type: "tankless" } } });
  const lTl = buildLedger(rTl, g, DEFAULT_RATE_CARD, US_CATALOG, { job: "water-heater", input: { wh: { fuel: "gas", type: "tankless" } } });
  ok("Gas tankless: the smallest row at or above 199k BTU/h, never a 150k unit", /RU199iN|NPE-240A2|RTGH-95/.test(lTl.materials[0].name) && !/NPE-180|NPE-210/.test(lTl.materials[0].name), lTl.materials[0].name);
  const toGas = { wh: { existingFuel: "electric" as const, fuel: "gas" as const, type: "tank" as const } };
  const rToGas = runEngine(g, { catalog: US_CATALOG, job: "water-heater", input: toGas });
  const lToGas = buildLedger(rToGas, g, DEFAULT_RATE_CARD, US_CATALOG, { job: "water-heater", input: toGas });
  const likeGas = buildLedger(runEngine(g, { catalog: US_CATALOG, job: "water-heater", input: { wh: { existingFuel: "gas", fuel: "gas", type: "tank" } } }), g, DEFAULT_RATE_CARD, US_CATALOG, { job: "water-heater", input: { wh: { existingFuel: "gas", fuel: "gas", type: "tank" } } });
  ok("Electric → gas: a gas branch by the foot, a full new vent run with flashing, the old circuit noted; dearer than gas → gas", lToGas.labor.some((l) => l.id === "l-gasbranch" && l.unit === "ln ft") && lToGas.labor.some((l) => l.id === "l-vent" && l.quantity === 12) && lToGas.materials.some((l) => l.id === "m-vent" && /flashing/.test(l.name)) && lToGas.assumptions.some((a) => /240 V circuit is disconnected/.test(a)) && lToGas.subtotal > likeGas.subtotal, `$${lToGas.subtotal} vs like-for-like $${likeGas.subtotal}`);
  const toElec = { wh: { existingFuel: "gas" as const, fuel: "electric" as const, type: "tank" as const } };
  const lToElec = buildLedger(runEngine(g, { catalog: US_CATALOG, job: "water-heater", input: toElec }), g, DEFAULT_RATE_CARD, US_CATALOG, { job: "water-heater", input: toElec });
  ok("Gas → electric: the gas drop is capped, a new 240 V circuit is run", lToElec.labor.some((l) => l.id === "l-gascap") && lToElec.materials.some((l) => l.id === "m-breaker"), lToElec.labor.map((l) => l.id).join(","));
  const hp = { wh: { existingFuel: "gas" as const, type: "heat-pump" as const } };
  const rHp = runEngine(g, { catalog: US_CATALOG, job: "water-heater", input: hp });
  const lHp = buildLedger(rHp, g, DEFAULT_RATE_CARD, US_CATALOG, { job: "water-heater", input: hp });
  ok("Heat-pump tank with the fuel left alone: electric, unvented, sized from the electric table, a catalog HPWH named", rHp.waterHeater?.fuel === "electric" && rHp.waterHeater.vent === "none" && rHp.waterHeater.gallons >= 50 && /heat-pump water heater/.test(lHp.materials[0].name) && !/^50 gal heat-pump/.test(lHp.materials[0].name), `${rHp.waterHeater?.fuel} · ${rHp.waterHeater?.gallons} gal · ${lHp.materials[0].name}`);
  const full = house({ electrical: { mainAmps: 200, freeSlots: 0 } });
  const likeElec = { wh: { existingFuel: "electric" as const, fuel: "electric" as const, type: "tank" as const } };
  const rLikeElec = runEngine(full, { catalog: US_CATALOG, job: "water-heater", input: likeElec });
  ok("Electric → electric on a full panel: the circuit is reused, no subpanel talk", rLikeElec.checks.some((c) => c.title === "Circuit for the tank" && c.status === "pass" && /reused/.test(c.detail)) && !rLikeElec.checks.some((c) => /subpanel/.test(c.detail)), rLikeElec.checks.find((c) => c.title === "Circuit for the tank")?.detail);
  ok("Scope keeps the maker's name and the rating as written", /with an A\.O\. Smith|with a Rheem|with a Bradford White/.test(likeGas.scope) && /UEF/.test(likeGas.scope) && !/a\.o\. smith|uef \(/.test(likeGas.scope), likeGas.scope.slice(0, 140));
}


// ── Full system: zoned furnaces, the gas line, the furnace fit, the package house, real matches ──
{
  const g = house();
  const big = house({ conditionedSqft: 6000, storeys: 2 });
  const rBig = runEngine(big, { catalog: US_CATALOG, job: "replace-system", outdoorKind: "air-conditioner" });
  const lBig = buildLedger(rBig, big, DEFAULT_RATE_CARD, US_CATALOG, { job: "replace-system", input: {} });
  const fur = lBig.materials.find((l) => l.id === "eq-furnace");
  const furK = Number((fur?.name.match(/(\d+)k BTU/) ?? [])[1] ?? 0);
  const per = rBig.selection.perSystem?.heatingBtuh ?? 0;
  // 1.6, not 1.5 (2026-10-14): the 0.2 engine turns over less air in a 6,000 sq ft house (Manual J Table 5A), and the 60k cabinet is the smallest that carries a 3-ton coil — the "Furnace fit" check says so.
  ok("6,000 sq ft house: two systems, each furnace sized to its zone (output ≤ 1.6 × the zone's heat)", rBig.selection.systems === 2 && !!fur && fur.quantity === 2 && per > 0 && furK * 1000 * 0.96 <= per * 1.6, `${rBig.selection.systems} systems · zone heat ${per} · ${fur?.name}`);
  const thin = house({ gas: { available: true, pipeIn: 0.5, longestRunFt: 100 } });
  const rThin = runEngine(thin, { catalog: US_CATALOG, job: "replace-system", outdoorKind: "air-conditioner" });
  const lThin = buildLedger(rThin, thin, DEFAULT_RATE_CARD, US_CATALOG, { job: "replace-system", input: {} });
  ok("Full system on a ½ in / 100 ft gas branch: the gas check says fix and the pipe upsizing is priced", rThin.checks.some((c) => c.id === "gas" && c.status === "fix") && lThin.labor.some((l) => l.id === "l-gaspipe"), rThin.checks.find((c) => c.id === "gas")?.detail?.slice(0, 120));
  const fitNote = lBig.assumptions.find((a) => /over Manual S's 140%/.test(a)) || buildLedger(runEngine(g, { catalog: US_CATALOG, job: "replace-system", outdoorKind: "air-conditioner", pick: undefined }), g, DEFAULT_RATE_CARD, US_CATALOG, { job: "replace-system", input: {} }).assumptions.find((a) => /over Manual S's 140%/.test(a));
  const rG = runEngine(g, { catalog: US_CATALOG, job: "replace-system", outdoorKind: "air-conditioner" });
  const lG = buildLedger(rG, g, DEFAULT_RATE_CARD, US_CATALOG, { job: "replace-system", input: {} });
  const fG = lG.materials.find((l) => l.id === "eq-furnace");
  const kG = Number((fG?.name.match(/(\d+)k BTU/) ?? [])[1] ?? 0);
  const afueG = Number((fG?.name.match(/(\d+)% AFUE/) ?? [])[1] ?? 80) / 100;
  const ratioG = (kG * 1000 * afueG) / rG.load.heatingBtuh;
  ok("An oversized furnace (blower-driven) carries the Manual S note and a verify check; a fitting one carries none", ratioG > 1.4 ? (lG.assumptions.some((a) => /over Manual S's 140%/.test(a)) && rG.checks.some((c) => c.title === "Furnace fit")) : (!lG.assumptions.some((a) => /over Manual S's 140%/.test(a)) && !rG.checks.some((c) => c.title === "Furnace fit")), `${fG?.name} · ${Math.round(ratioG * 100)}% of ${rG.load.heatingBtuh} · note: ${fitNote?.slice(0, 60) ?? "—"}`);
  const pkg = house({ existing: { kind: "package-unit", tons: 3.5, fuel: "gas", refrigerant: "R-410A" }, ducts: { location: "attic", condition: "fair", insulated: true, returnGrilleSqIn: 700 } });
  const rPkg = runEngine(pkg, { catalog: US_CATALOG, job: "replace-system" });
  const lPkg = buildLedger(rPkg, pkg, DEFAULT_RATE_CARD, US_CATALOG, { job: "replace-system", input: {} });
  ok("Package house: a real package unit from the catalog, gas connected, no attic pan, no line set, title says package", rPkg.selection.chosen?.item.kind === "package" && rPkg.selection.chosen.item.heatKind === "gas" && lPkg.materials[0].name.startsWith(`${rPkg.selection.chosen.item.brand} `) && lPkg.materials.some((l) => l.id === "m-gasflex") && lPkg.labor.some((l) => l.id === "l-gas") && lPkg.labor.some((l) => l.id === "l-crane") && !lPkg.materials.some((l) => l.id === "m-pump" || l.id === "m-lineset") && /^Package unit replacement/.test(lPkg.title) && !/line set/.test(lPkg.scope), `${lPkg.materials[0].name} · ${lPkg.title}`);
  const noPkgRows = US_CATALOG.filter((c) => c.kind !== "package");
  const rNoPkg = runEngine(pkg, { catalog: noPkgRows, job: "replace-system" });
  const lNoPkg = buildLedger(rNoPkg, pkg, DEFAULT_RATE_CARD, noPkgRows, { job: "replace-system", input: {} });
  ok("A catalog with no package rows still prices the package house from the rate card and says so", !rNoPkg.selection.chosen && /gas\/electric package unit \(no catalog row/.test(lNoPkg.materials[0].name) && lNoPkg.materials[0].unitPrice === Math.round(rNoPkg.selection.targetTons * DEFAULT_RATE_CARD.equipmentDefaults.packagePerTon * (1 + DEFAULT_RATE_CARD.equipmentMarkupPct / 100) * 100) / 100, `${lNoPkg.materials[0].name} $${lNoPkg.materials[0].unitPrice}`);
  const hp454 = US_CATALOG.find((c) => c.kind === "heat-pump" && c.brand === "Bosch" && c.refrigerant === "R-454B" && c.tons === 4);
  const elec = house({ gas: { available: false }, existing: { kind: "split-heat-pump", tons: 4, fuel: "electric", refrigerant: "R-410A" }, conditionedSqft: 2600 });
  const rB = runEngine(elec, { catalog: US_CATALOG, job: "replace-system", pick: hp454?.id });
  const lB = buildLedger(rB, elec, DEFAULT_RATE_CARD, US_CATALOG, { job: "replace-system", input: {} });
  const ah = lB.materials.find((l) => l.id === "eq-ah");
  const ahRow = US_CATALOG.find((c) => c.kind === "air-handler" && ah?.name.startsWith(`${c.brand} ${c.model}`));
  ok("A Bosch R-454B heat pump never gets an R-32 air handler; a cross-brand one is worded as such", rB.selection.chosen?.item.id === hp454?.id && !!ahRow && ahRow.refrigerant !== "R-32" && (ahRow.brand === "Bosch" || /cross-brand/.test(ah?.name ?? "")), ah?.name);
}


// ── Picking another unit, and typing one the catalog lacks ─────────────────
{
  const g = house();
  const base = runEngine(g, { catalog: US_CATALOG, job: "replace-system", outdoorKind: "air-conditioner" });
  const other = base.selection.candidates.find((c) => !c.disqualified && c.item.kind === "air-conditioner" && c.item.id !== base.selection.chosen?.item.id);
  const picked = runEngine(g, { catalog: US_CATALOG, job: "replace-system", outdoorKind: "air-conditioner", pick: other?.item.id });
  ok("A fitting alternate can be picked and the checks follow it", picked.selection.chosen?.item.id === other?.item.id && !picked.selection.chosen?.overridden && !picked.checks.some((c) => c.title === "Unit chosen by hand"), `${other?.item.brand} ${other?.item.model}`);
  const ruled = base.selection.candidates.find((c) => c.disqualified && c.item.kind === "air-conditioner");
  const over = runEngine(g, { catalog: US_CATALOG, job: "replace-system", outdoorKind: "air-conditioner", pick: ruled?.item.id });
  const lOver = buildLedger(over, g, DEFAULT_RATE_CARD, US_CATALOG, { job: "replace-system", input: {} });
  ok("A unit the engine ruled out can still be chosen: it is on the estimate, with a fix check naming the reason", over.selection.chosen?.item.id === ruled?.item.id && over.selection.chosen?.overridden === ruled?.disqualified && over.checks.some((c) => c.title === "Unit chosen by hand" && c.status === "fix" && c.detail.includes(ruled?.item.model ?? "?")) && lOver.materials[0].name.startsWith(`${ruled?.item.brand} ${ruled?.item.model}`), `${ruled?.item.model}: ${ruled?.disqualified?.slice(0, 60)}`);
  const typedUnit: CatalogItem = { id: "custom-air-conditioner-acme-ac-048", kind: "air-conditioner", brand: "Acme", model: "AC-048", tons: 4, coolingBtuh: 48000, seer2: 16, refrigerant: "R-454B", staging: "two-stage", cost: 3200, typed: true, source: "shop" };
  const withTyped = runEngine(g, { catalog: US_CATALOG, job: "replace-system", outdoorKind: "air-conditioner", custom: typedUnit, pick: typedUnit.id });
  const lTyped = buildLedger(withTyped, g, DEFAULT_RATE_CARD, [...US_CATALOG, typedUnit], { job: "replace-system", input: {} });
  ok("A typed-in unit joins the catalog, can be picked, is priced from its cost, and the checks say to confirm it", withTyped.selection.chosen?.item.id === typedUnit.id && withTyped.checks.some((c) => c.title === "Unit typed in" && c.status === "verify") && lTyped.materials[0].basis === "entered" && /Typed in — cost \$3,200/.test(lTyped.materials[0].note ?? ""), `${lTyped.materials[0].name} · ${lTyped.materials[0].note}`);
  const noCost: CatalogItem = { ...typedUnit, cost: undefined };
  const lNoCost = buildLedger(runEngine(g, { catalog: US_CATALOG, job: "replace-system", outdoorKind: "air-conditioner", custom: noCost, pick: noCost.id }), g, DEFAULT_RATE_CARD, [...US_CATALOG, noCost], { job: "replace-system", input: {} });
  ok("A typed unit with no cost is priced from the rate card and says so", /Typed in — no cost given/.test(lNoCost.materials[0].note ?? ""), lNoCost.materials[0].note);
  const noFit = runEngine(house({ existing: { kind: "package-unit", tons: 3.5, fuel: "gas" } }), { catalog: US_CATALOG.filter((c) => c.kind !== "package"), job: "replace-system" });
  ok("A house the catalog cannot serve has no chosen unit, so the panel offers the typed route", !noFit.selection.chosen);
  // Water heater: the contractor's tank beats the plan's pick, and a small one is called out
  const wh = { wh: { fuel: "gas" as const, type: "tank" as const } };
  const rWh = runEngine(house({ occupants: 5 }), { catalog: US_CATALOG, job: "water-heater", input: wh });
  const small = US_CATALOG.find((c) => c.kind === "water-heater" && c.whType === "tank" && c.fuel === "gas" && c.gallons === 40);
  const lWh = buildLedger(rWh, house({ occupants: 5 }), DEFAULT_RATE_CARD, US_CATALOG, { job: "water-heater", input: wh, pick: small?.id });
  ok("Water heater: the picked tank is the one priced, and a tank under the sized gallons is called out", lWh.materials[0].name.startsWith(`${small?.brand} ${small?.model}`) && lWh.assumptions.some((a) => /You picked a 40 gal tank where the household sizes to 75 gal/.test(a)), `${lWh.materials[0].name} · ${lWh.assumptions.find((a) => /You picked/.test(a))?.slice(0, 70)}`);
}


// ── Water heater: one tank per maker that fits, the engine's pick first ────
{
  const g = house();
  const r = runEngine(g, { catalog: US_CATALOG, job: "water-heater", input: { wh: { fuel: "gas", type: "tank" } } });
  const opts = waterHeaterOptions(US_CATALOG, r.waterHeater!);
  ok("Gas 50 gal tank: three makers offered, one row each, all at or above 50 gal and atmospheric", opts.length === 3 && new Set(opts.map((o) => o.brand)).size === 3 && opts.every((o) => (o.gallons ?? 0) >= 50 && (o.vent ?? "atmospheric") === "atmospheric"), opts.map((o) => `${o.brand} ${o.model} ${o.gallons} gal`).join(" | "));
  ok("The engine's own pick leads the strip", opts[0]?.id === buildLedger(r, g, DEFAULT_RATE_CARD, US_CATALOG, { job: "water-heater", input: { wh: { fuel: "gas", type: "tank" } } }).materials[0].id.replace(/^eq-main$/, opts[0]?.id ?? ""), opts[0]?.model);
  const hp = runEngine(g, { catalog: US_CATALOG, job: "water-heater", input: { wh: { type: "heat-pump" } } });
  const hpOpts = waterHeaterOptions(US_CATALOG, hp.waterHeater!);
  ok("Heat-pump tank: the three makers' heat-pump tanks, sized up from the electric table", hpOpts.length === 3 && hpOpts.every((o) => o.whType === "heat-pump" && (o.gallons ?? 0) >= (hp.waterHeater?.gallons ?? 0)), hpOpts.map((o) => `${o.brand} ${o.gallons} gal`).join(" | "));
  const tl = runEngine(g, { catalog: US_CATALOG, job: "water-heater", input: { wh: { fuel: "gas", type: "tankless" } } });
  const tlOpts = waterHeaterOptions(US_CATALOG, tl.waterHeater!);
  ok("Gas tankless: one per maker, none under the 199k plan", tlOpts.length >= 2 && tlOpts.every((o) => (o.btuInput ?? 0) >= 199_000), tlOpts.map((o) => `${o.brand} ${o.model} ${o.btuInput}`).join(" | "));
  const picked = buildLedger(r, g, DEFAULT_RATE_CARD, US_CATALOG, { job: "water-heater", input: { wh: { fuel: "gas", type: "tank" } }, pick: opts[1]?.id });
  ok("Picking the second maker puts that tank on the estimate", picked.materials[0].name.startsWith(`${opts[1]?.brand} ${opts[1]?.model}`), picked.materials[0].name);
  const gasRowOnHp = buildLedger(hp, g, DEFAULT_RATE_CARD, US_CATALOG, { job: "water-heater", input: { wh: { type: "heat-pump" } }, pick: opts[0]?.id });
  ok("A gas tank picked before the job became a heat-pump job is not honoured: a heat-pump tank is priced", /heat-pump water heater/.test(gasRowOnHp.materials[0].name) && !gasRowOnHp.materials[0].name.startsWith(`${opts[0]?.brand} ${opts[0]?.model}`), gasRowOnHp.materials[0].name);
}


// ── Service menu: what a visit can do, priced by the task ─────────────────
{
  const g = house();
  ok("The menu is a real list: 40+ tasks, every one with labor, most with a part and its makers", SERVICE_MENU.length >= 40 && SERVICE_MENU.every((t) => t.title && t.includes && t.laborUsd >= 0) && SERVICE_MENU.filter((t) => t.part).length >= 25 && SERVICE_MENU.filter((t) => t.part?.brands?.length).length >= 20, `${SERVICE_MENU.length} tasks`);
  ok("Menu ids are unique", new Set(SERVICE_MENU.map((t) => t.id)).size === SERVICE_MENU.length);
  const gasAc = serviceMenuFor(g);
  const groupsOf = (m: ReturnType<typeof serviceMenuFor>) => m.groups.map((x) => x.group);
  ok("AC + gas furnace house: tune-ups, refrigerant, electrical, furnace, airflow, refrigeration, controls and water heater; no ductless group", ["tune-up", "refrigerant", "electrical", "furnace", "airflow", "refrigeration", "controls", "water-heater"].every((k) => groupsOf(gasAc).includes(k)) && !groupsOf(gasAc).includes("ductless"), groupsOf(gasAc).join(","));
  ok("…and the AC tune-up is the suggested one", gasAc.recommended.includes("ac-tuneup"));
  const hpHouse = house({ gas: { available: false }, existing: { kind: "split-heat-pump", tons: 3, fuel: "electric", refrigerant: "R-410A" } });
  const hp = serviceMenuFor(hpHouse);
  const hpIds = hp.groups.flatMap((x) => x.tasks.map((t) => t.id));
  ok("Heat-pump house: reversing valve and defrost board are offered, the gas-furnace group is not, and the heat-pump tune-up is suggested", hpIds.includes("reversing-valve") && hpIds.includes("defrost-board") && !groupsOf(hp).includes("furnace") && hp.recommended.includes("hp-tuneup"));
  const dl = serviceMenuFor(house({ existing: { kind: "ductless", tons: 1, fuel: "electric", refrigerant: "R-410A" }, gas: { available: false } }));
  ok("Ductless house: the ductless group and head deep clean, no blower motors", groupsOf(dl).includes("ductless") && dl.recommended.includes("ductless-clean") && !dl.groups.flatMap((x) => x.tasks.map((t) => t.id)).includes("blower-psc"));
  const r22 = serviceMenuFor(house({ existing: { kind: "split-ac-furnace", tons: 3, fuel: "gas", refrigerant: "R-22", yearMade: 2005 } }));
  ok("An R-22 system from 2005 gets the reclaimed-refrigerant note and the age note", r22.notes.some((n) => /R-22/.test(n)) && r22.notes.some((n) => /years old/.test(n)), r22.notes.join(" | ").slice(0, 120));
  const pick = { service: { tasks: ["capacitor", "contactor"] } };
  const rS = runEngine(g, { catalog: US_CATALOG, job: "service", input: pick });
  const lS = buildLedger(rS, g, DEFAULT_RATE_CARD, US_CATALOG, { job: "service", input: pick });
  ok("Capacitor + contactor: the diagnostic, two labor lines and two part lines with the makers named", lS.labor.some((l) => l.id === "l-diag") && lS.labor.filter((l) => /^l-svc-/.test(l.id)).length === 2 && lS.materials.filter((l) => /^m-svc-/.test(l.id)).length === 2 && /Mars/.test(lS.materials.find((l) => l.id === "m-svc-capacitor")?.note ?? ""), `${lS.labor.map((l) => l.id).join(",")} · $${lS.subtotal}`);
  ok("The part line is the typical cost plus the markup, and the labor line says it is typical", lS.materials.find((l) => l.id === "m-svc-capacitor")?.unitPrice === Math.round(28 * (1 + DEFAULT_RATE_CARD.materialsMarkupPct / 100) * 100) / 100 && /typical shop labor/.test(lS.labor.find((l) => l.id === "l-svc-capacitor")?.note ?? ""));
  ok("Title and scope name the tasks", /^Service: Run capacitor, Contactor —/.test(lS.title) && /diagnostic, run capacitor, contactor\./.test(lS.scope), `${lS.title} · ${lS.scope.slice(-60)}`);
  const tune = { service: { tasks: ["ac-tuneup", "recharge"], refrigerantLb: 2 } };
  const lT = buildLedger(runEngine(g, { catalog: US_CATALOG, job: "service", input: tune }), g, DEFAULT_RATE_CARD, US_CATALOG, { job: "service", input: tune });
  ok("A tune-up drops the diagnostic; the recharge is priced by the pound", !lT.labor.some((l) => l.id === "l-diag") && lT.labor.some((l) => l.id === "l-svc-ac-tuneup") && lT.labor.some((l) => l.id === "l-refr" && l.quantity === 2) && lT.materials.some((l) => l.id === "m-refr" && l.quantity === 2), lT.labor.map((l) => l.id).join(","));
  const cust = { service: { tasks: ["igniter"], custom: [{ name: "Replace the zone damper actuator", laborUsd: 180, partName: "Damper actuator", partCost: 85 }] } };
  const lC = buildLedger(runEngine(g, { catalog: US_CATALOG, job: "service", input: cust }), g, DEFAULT_RATE_CARD, US_CATALOG, { job: "service", input: cust });
  ok("A task typed for this estimate prices its labor and its part as entered", lC.labor.some((l) => l.id === "l-cust-0" && l.unitPrice === 180 && l.basis === "entered") && lC.materials.some((l) => l.id === "m-cust-0" && l.basis === "entered"), `$${lC.subtotal} · ${lC.title}`);
  const saved = normalizeRateCard({ ...DEFAULT_RATE_CARD, serviceMenu: [{ id: "custom-duct-static-test", title: "Duct static test", includes: "TESP at four points", laborUsd: 120 }, { id: 7, title: "bad" }] });
  ok("A saved task rides on the rate card and a bad row is dropped", saved.serviceMenu?.length === 1 && saved.serviceMenu[0].custom === true && saved.serviceMenu[0].group === "custom");
  const withSaved = { service: { tasks: ["custom-duct-static-test"] } };
  const lSaved = buildLedger(runEngine(g, { catalog: US_CATALOG, job: "service", input: withSaved }), g, saved, US_CATALOG, { job: "service", input: withSaved });
  ok("A saved task is priced from the menu like any other, and says it is the shop's", lSaved.labor.some((l) => l.id === "l-svc-custom-duct-static-test" && l.unitPrice === 120 && /your saved task/.test(l.note ?? "")) && serviceMenuFor(g, saved.serviceMenu).groups.some((x) => x.group === "custom"));
  const old = { service: { task: "Replace the TXV and filter-drier", refrigerantLb: 3, parts: [{ name: "TXV", cost: 85 }] } };
  const lOld = buildLedger(runEngine(g, { catalog: US_CATALOG, job: "service", input: old }), g, DEFAULT_RATE_CARD, US_CATALOG, { job: "service", input: old });
  ok("An older saved estimate with free text still prices", lOld.labor.some((l) => l.id === "l-repair") && lOld.materials.some((l) => l.id === "m-part-0") && lOld.labor.some((l) => l.id === "l-refr"), lOld.title);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
