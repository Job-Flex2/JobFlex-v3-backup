// The one call the page makes: building model in, everything the design card
// shows out. Pure and synchronous, so the same inputs give the same answer on
// the server, in the browser and in scripts/qa/hvac-engine.check.ts.

import type { BuildingModel, CatalogItem, CheckResult, DesignConditions, EngineResult, EquipmentKind, SelectionCandidate } from "./types";
import { DEFAULT_JOB, jobDef, type JobInput, type JobKind, type OutdoorKind } from "./jobs";
import { waterHeaterChecks, waterHeaterPlan } from "./waterHeater";
import { fuelChecks, resolveUlnCheck } from "./checks";
import { companionFurnace, keepsGas } from "./ledger";
import { computeBlockLoad, ENGINE_VERSION, loadLevers } from "./load";
import { ratedCoolingBtuh, selectSystem } from "./select";
import { allChecks, defaultedFields, gasCheck, sizingCheck } from "./checks";
import { ductCapacity } from "./ductCalc";
import { designConditionsFor } from "./designConditions";
import { incentivesFor, ultraLowNoxNeeded } from "./data/rules";
import { DEFAULTS_SOURCE } from "./data/defaults";

export interface RunEngineOptions {
  /** Pre-resolved conditions (the server resolves the county once). */
  conditions?: DesignConditions;
  catalog: CatalogItem[];
  /** What the contractor is pricing (default: the full system). */
  job?: JobKind;
  input?: JobInput;
  /** Full system / outdoor unit: what goes outside when the job allows both —
   *  an AC (like for like, with the furnace) or a heat pump. Left out, the
   *  engine picks: an AC on a gas house, a heat pump otherwise. */
  outdoorKind?: OutdoorKind;
  /** The candidate id the contractor (or the page's Better-tier rule) chose:
   *  checks and notes are then written for that unit. A unit the engine ruled
   *  out can be picked too — the estimate then says which rule it breaks. */
  pick?: string;
  /** A unit the contractor typed because the catalog has none: it joins the
   *  catalog for this run and is judged and picked like any other row. */
  custom?: CatalogItem;
}

const FIELD_WORDS: Record<string, string> = {
  conditionedSqft: "conditioned area",
  storeys: "storeys",
  ceilingHeightFt: "ceiling height",
  yearBuilt: "year built",
  windowToFloor: "window area",
  windowSqft: "window area",
  windowType: "window type",
  wallInsulation: "wall insulation",
  ceilingInsulation: "attic insulation",
  foundation: "foundation",
  tightness: "air tightness",
  roofColor: "roof colour",
  shading: "shading",
  occupants: "occupants",
  ventilationFan: "ventilation fan",
  "ducts.location": "duct location",
  "ducts.condition": "duct condition",
};

/** A service call touches the refrigerant that is there; the install rule
 *  (what may still be sold) does not apply to a recharge. */
function serviceRefrigerantCheck(model: BuildingModel): CheckResult[] {
  const r = model.existing.refrigerant;
  if (!r) return [{ id: "refrigerant", title: "Refrigerant · not identified", status: "verify", detail: "Read the refrigerant off the outdoor nameplate: the per-pound price and the tools depend on it (R-22 is reclaimed stock; R-454B / R-32 need A2L-rated gear).", rule: "EPA 608" }];
  if (r === "R-22") return [{ id: "refrigerant", title: "Refrigerant · R-22", status: "verify", detail: "R-22 production and import ended in 2020; a recharge uses reclaimed R-22 by an EPA 608 technician at today's reclaimed price — offer a replacement quote alongside the repair.", rule: "EPA HCFC phase-out (2020) · 40 CFR 82" }];
  if (r === "R-454B" || r === "R-32") return [{ id: "refrigerant", title: `Refrigerant · ${r}`, status: "pass", detail: `${r} is an A2L (mildly flammable) refrigerant: A2L-rated recovery and charging tools, no ignition source near the charge.`, rule: "UL 60335-2-40" }];
  return [{ id: "refrigerant", title: `Refrigerant · ${r}`, status: "pass", detail: `${r} is available for service; recharging an existing system carries no restriction.`, rule: "EPA 608" }];
}

export function runEngine(model: BuildingModel, opts: RunEngineOptions): EngineResult {
  const job = jobDef(opts.job ?? DEFAULT_JOB);
  // A typed-in unit stands beside the catalog rows and is judged with them.
  const catalog = opts.custom ? [...opts.catalog.filter((c) => c.id !== opts.custom?.id), opts.custom] : opts.catalog;
  const county = designConditionsFor(model.state, model.county, model.elevationFt ?? 0).conditions;
  const setC = opts.input?.designCoolingF;
  const setH = opts.input?.designHeatingF;
  // The contractor's own design temperatures for the address beat the county's row.
  const conditions = opts.conditions ?? (Number.isFinite(setC) || Number.isFinite(setH)
    ? { ...county, coolingF: Number.isFinite(setC) ? (setC as number) : county.coolingF, heatingF: Number.isFinite(setH) ? (setH as number) : county.heatingF, source: `set for this address by the contractor (${Number.isFinite(setC) ? `${setC} °F cooling` : ""}${Number.isFinite(setC) && Number.isFinite(setH) ? ", " : ""}${Number.isFinite(setH) ? `${setH} °F heating` : ""}); the county row reads ${county.coolingF} °F / ${county.heatingF} °F — ${county.source}` }
    : county);
  // A ductless zone is loaded on its own area, one storey, the house's envelope.
  const zoneSqft = job.id === "ductless" ? Math.max(100, Math.round(opts.input?.zoneSqft ?? 0)) : 0;
  const heads = job.id === "ductless" ? Math.max(1, Math.round(opts.input?.heads ?? 1)) : 0;
  // A mini-split has no ducts: the zone is loaded without the house's duct
  // losses, with the people who use the room (about one per 300 sq ft, never
  // more than the household) and no kitchen allowance.
  const zoneOccupants = zoneSqft ? Math.max(1, Math.min(model.occupants > 0 ? model.occupants : 3, Math.ceil(zoneSqft / 300))) : model.occupants;
  const loadModel = zoneSqft ? { ...model, conditionedSqft: zoneSqft, storeys: 1, occupants: zoneOccupants, ducts: { location: "none" as const, condition: "good" as const }, perimeterFt: undefined, footprintEdges: undefined } : model;
  const load = computeBlockLoad(loadModel, conditions, { zone: zoneSqft > 0 });
  if (!zoneSqft && job.needs.load) load.assumptions.push(...loadLevers(loadModel, conditions));
  if (zoneSqft && !(opts.input?.zoneSqft && opts.input.zoneSqft > 0)) load.assumptions.unshift("Zone size not given — loaded as a 100 sq ft room; type the zone's square feet.");
  // The ducts that are there (lib/hvac/ductCalc, 2026-10-08): what they carry
  // bounds the size, and so does the old unit that kept up on the hottest days.
  const ductsMatter = job.needs.ducts && model.ducts.location !== "none";
  const ductCap = ductsMatter ? ductCapacity(model.ducts, load.cfmPerTon) : null;
  const keptUpTons = job.needs.existing && model.existing.keptUp === "yes" && model.existing.tons ? model.existing.tons : undefined;
  const bounds = { ductCfm: ductCap?.capacityCfm, keptUpTons };
  // A package-unit house gets a package unit on a full replacement; with no
  // package rows in the catalog the ledger prices one from the rate card.
  // What goes outside: the contractor's choice when the job allows it; else
  // like for like on a heat-pump house; else the engine's own ranking (an AC
  // on a gas house, a heat pump otherwise).
  const asked = opts.outdoorKind && job.kinds.includes(opts.outdoorKind) ? opts.outdoorKind : undefined;
  const outdoorKind = asked ?? (model.existing.kind === "split-heat-pump" && job.kinds.includes("heat-pump") ? "heat-pump" : undefined);
  const packageHouse = job.id === "replace-system" && model.existing.kind === "package-unit";
  // A house with no gas (or an electric furnace on the plate) replaces the
  // furnace with an air handler and a heat kit, not a gas cabinet.
  const electricFurnace = job.id === "replace-furnace" && (model.gas.available === false || model.preferences.allElectric === true || model.existing.fuel === "electric");
  const kinds: EquipmentKind[] = packageHouse ? ["package"] : electricFurnace ? ["air-handler"] : outdoorKind ? [outdoorKind] : job.kinds;
  const wantsHeatPump = job.id === "heat-pump-conversion" || outdoorKind === "heat-pump";
  // The indoor unit stays on an add or an outdoor swap: an AC pairs with the
  // furnace or air handler that is there, gas or not.
  const keepsIndoor = (job.id === "add-ac" || job.id === "replace-outdoor") && (model.existing.kind === "furnace-only" || model.existing.kind === "split-ac-furnace" || model.existing.kind === "split-heat-pump");
  const minTons = job.id === "ductless" ? 0.5 : undefined;
  let selection = job.selection === "none"
    ? { chosen: null, runnerUp: null, candidates: [], targetTons: Math.max(1.5, Math.round((load.coolingTotalBtuh / 12000) * 2) / 2), systems: 1 }
    : selectSystem(catalog, load, conditions, model, { kinds, wantsHeatPump, keepsIndoor, minTons, coilTons: job.id === "replace-furnace" && (model.existing.kind === "split-ac-furnace" || model.existing.kind === "split-heat-pump") ? model.existing.tons : undefined, ...bounds });
  // A choice the house cannot take (an AC where there is no furnace, a kind
  // the catalog lacks) falls back to the job's own pool, not an empty design.
  if (job.selection !== "none" && !selection.chosen && outdoorKind && !packageHouse) selection = selectSystem(catalog, load, conditions, model, { kinds: job.kinds, wantsHeatPump: job.id === "heat-pump-conversion", keepsIndoor, minTons, ...bounds });
  // A heat pump picked by hand on a job that offers both kinds is judged as a
  // heat-pump job — no "offer this as dual fuel" mark from the AC ranking.
  if (opts.pick && !asked && job.selection !== "none" && !packageHouse && job.kinds.includes("heat-pump") && job.kinds.includes("air-conditioner")) {
    const pickedItem = catalog.find((c) => c.id === opts.pick);
    if (pickedItem?.kind === "heat-pump" && selection.chosen?.item.kind !== "heat-pump") selection = selectSystem(catalog, load, conditions, model, { kinds: ["heat-pump"], wantsHeatPump: true, keepsIndoor, minTons, ...bounds });
  }
  // The contractor's pick (or the page's Better-tier base) becomes the chosen
  // unit, so the checks and notes below describe the unit on the estimate.
  if (opts.pick) {
    const p = selection.candidates.find((c) => c.item.id === opts.pick);
    if (p && p !== selection.chosen) {
      // A unit the engine ruled out still goes on the estimate when the
      // contractor says so; the reason travels with it as a check.
      const byHand: SelectionCandidate = p.disqualified ? { ...p, disqualified: undefined, overridden: p.disqualified } : p;
      selection = { ...selection, chosen: byHand, runnerUp: selection.chosen ?? selection.runnerUp };
    }
  }
  const waterHeater = job.id === "water-heater" ? waterHeaterPlan(model, opts.input?.wh) : undefined;
  const wanted = new Set<string>(job.checks);
  const chosenItem = selection.chosen?.item;
  // A heat pump where the furnace stays (a conversion, or an outdoor swap on
  // an AC + furnace house) runs dual fuel: no strips, a dual-fuel thermostat.
  // Dual fuel needs a forced-air gas furnace to pair with: an AC + furnace
  // house, a furnace-only house, or a heat-pump house already paired with a
  // gas furnace. A boiler house (no ducts) keeps its gas but the heat pump
  // goes all-electric with its own air handler.
  const forcedAirFurnace = model.ducts.location !== "none" && (model.existing.kind === "split-ac-furnace" || model.existing.kind === "furnace-only" || (model.existing.kind === "split-heat-pump" && (model.existing.fuel === "gas" || model.existing.fuel === "propane")));
  const dualFuel = (job.id === "heat-pump-conversion" || (job.id === "replace-outdoor" && chosenItem?.kind === "heat-pump")) && keepsGas(model) && forcedAirFurnace;
  if (dualFuel) {
    // The furnace, not electric strips, carries the heat below the balance point.
    const reword = (r: string) => r.replace(/[\d.]+ kW of backup carries the rest below ([^ ]+) °F\./, "the furnace carries the rest below $1 °F (dual fuel).").replace("the strips will run most cold nights", "the furnace will run most cold nights");
    for (const c of selection.candidates) c.reasons = c.reasons.map(reword);
  }
  // Gas heat on the job: a gas furnace being set, the furnace a full system's
  // AC brings, or a gas/electric package unit.
  const gasPackage = chosenItem?.kind === "package" && (chosenItem.heatKind ?? "gas") === "gas";
  const gasFurnace = (job.id === "replace-furnace" && !electricFurnace) || (job.id === "replace-system" && chosenItem?.kind === "air-conditioner" && keepsGas(model)) || gasPackage;
  // The kept furnace / air handler needs the A2L sensor only when the
  // refrigerant actually changes to an A2L; an R-454B house has one already.
  // The furnace that stays must move the coil's air: its blower is sized by
  // input (≤ 45k → 3 t, ≤ 70k → 4 t, else 5 t) until the data plate says more.
  const indoorStays = (job.id === "add-ac" || job.id === "replace-outdoor" || (job.id === "heat-pump-conversion" && dualFuel)) && (model.existing.kind === "furnace-only" || model.existing.kind === "split-ac-furnace" || model.existing.kind === "split-heat-pump");
  const furnaceStays = indoorStays && model.existing.kind !== "split-heat-pump" && model.existing.fuel !== "electric";
  const indoorWord: "furnace" | "air handler" = furnaceStays || job.id === "replace-furnace" ? "furnace" : "air handler";
  const coilTons = indoorStays ? chosenItem?.tons : job.id === "replace-furnace" && (model.existing.kind === "split-ac-furnace" || model.existing.kind === "split-heat-pump") ? model.existing.tons : undefined;
  const coilCfm = coilTons ? Math.round(coilTons * load.cfmPerTon) : 0;
  // The blower that must move the coil's air: the kept furnace (sized by its
  // input until the plate says more), the kept air handler (sized by the unit
  // it served), or the new furnace's own rating.
  const blowerTons = job.id === "replace-furnace" ? chosenItem?.maxTons
    : furnaceStays ? (model.existing.btuInput ? (model.existing.btuInput <= 45_000 ? 3 : model.existing.btuInput <= 70_000 ? 4 : 5) : undefined)
    : indoorStays ? model.existing.tons : undefined;
  const blowerInput = job.id === "replace-furnace" ? chosenItem?.btuInput : model.existing.btuInput;
  const blowerShort = coilTons && blowerTons && coilTons > blowerTons && furnaceStays !== undefined && (job.id === "replace-furnace" || furnaceStays) && blowerInput ? { tons: coilTons, cfm: coilCfm, btuInput: blowerInput, blowerTons } : undefined;
  const blowerUnknown = coilTons && !blowerShort && (!blowerTons || (!furnaceStays && job.id !== "replace-furnace" && coilTons > blowerTons)) ? { tons: coilTons, cfm: coilCfm } : undefined;
  // An all-electric conversion pulls the gas furnace: the water heater may be
  // left alone on the flue, and the gas drop gets capped.
  const furnaceRemoved = ((job.id === "heat-pump-conversion" && !dualFuel) || (job.id === "replace-system" && chosenItem?.kind === "heat-pump")) && model.gas.available !== false && forcedAirFurnace && model.existing.fuel !== "electric";
  // The outdoor circuit is reused on a swap or a conversion of a house that
  // already has an outdoor unit; the ledger adds a breaker only when the MCA says so.
  const reusesCircuit = job.id === "replace-outdoor" || (job.id === "heat-pump-conversion" && (model.existing.kind === "split-ac-furnace" || model.existing.kind === "split-heat-pump" || model.existing.kind === "package-unit"));
  const a2lOnExisting = !!chosenItem && (chosenItem.refrigerant === "R-454B" || chosenItem.refrigerant === "R-32") && (job.id === "add-ac" || dualFuel || job.id === "replace-outdoor") && indoorStays && model.existing.refrigerant !== chosenItem.refrigerant;
  // A strip kit on an indoor unit that ran on 120 V (or where there was none)
  // is a new two-pole breaker to find room for, whatever the outdoor circuit does.
  const indoorWas240 = model.existing.kind === "split-heat-pump" || model.existing.fuel === "electric";
  const addsCircuit = !indoorWas240 && ((chosenItem?.kind === "heat-pump" && !dualFuel && job.id !== "replace-outdoor") || electricFurnace);
  const checks = waterHeater
    ? [...waterHeaterChecks(model, waterHeater, opts.input?.wh?.existingFuel ? opts.input.wh.existingFuel === "electric" : model.gas.available === false), ...fuelChecks(model, { gasFurnace: false, gasWaterHeater: waterHeater.fuel !== "electric" && waterHeater.type !== "heat-pump", whVent: waterHeater.vent, whLocation: waterHeater.location, furnaceReplaced: false, a2lCoilOnExistingFurnace: false })]
    : job.selection === "none"
      ? [...(wanted.has("refrigerant") ? serviceRefrigerantCheck(model) : []), ...allChecks(load, conditions, model, null, { touchesRefrigerant: false, removesEquipment: false, kind: job.id }).filter((c) => wanted.has(c.id) || (wanted.has("code") && !["return", "static", "duct-size", "sizing", "duct-cond", "duct-ins", "ducts-none", "service", "gas", "refrigerant", "efficiency"].includes(c.id)))]
      : [...allChecks(load, conditions, model, selection.chosen, { dualFuel, removesEquipment: job.id !== "add-ac" && job.id !== "ductless", reusesCircuit, addsCircuit, newFurnace: gasFurnace }).filter((c) => wanted.has(c.id) || (c.id === "code" && wanted.has("code")) || (!["return", "static", "duct-size", "sizing", "duct-cond", "duct-ins", "ducts-none", "service", "gas", "refrigerant", "efficiency"].includes(c.id) && wanted.has("code"))), ...fuelChecks(model, { gasFurnace, gasWaterHeater: false, furnaceReplaced: gasFurnace || furnaceRemoved, a2lCoilOnExistingFurnace: a2lOnExisting, furnaceMaxTonsUnknown: blowerUnknown, furnaceBlowerShort: blowerShort, indoorWord })];

  // The walk's figure against the record (2026-10-08): the record stayed; the
  // contractor confirms which is right before the number is sold.
  if (model.conflicts?.length) {
    const words = model.conflicts.map((c) => `${FIELD_WORDS[c.path] ?? c.path} — record ${c.kept} kept, the walk said ${c.walk}`).join("; ");
    checks.push({ id: "code", title: "Record vs walk", status: "verify", detail: `The walk disagreed with the house record: ${words}. The record stands until you confirm; type the right figure to settle it.`, rule: "inputs" });
  }
  // The old unit that kept up (or could not): the house as a load check.
  if (job.selection !== "none" && job.needs.existing && wanted.has("sizing")) {
    const sz = sizingCheck(load, model, selection.chosen);
    if (sz) checks.push(sz);
  }
  // A full system with an AC brings a furnace the ledger picks: its gas line
  // and its fit against the heating load are checked here, for that furnace.
  if (gasFurnace && chosenItem && chosenItem.kind !== "furnace") {
    const heat = selection.perSystem?.heatingBtuh ?? load.heatingBtuh;
    const tonsForFurnace = chosenItem.tons ?? selection.targetTons;
    const fRow = companionFurnace(catalog, tonsForFurnace, heat, { brand: chosenItem.brand, tier: chosenItem.tier, ulnOnly: ultraLowNoxNeeded(model.state, model.county) === "required" }) ?? { id: "synthetic-furnace", kind: "furnace" as const, brand: "", model: "furnace", btuInput: Math.max(40000, Math.ceil((heat / 0.95) / 20000) * 20000), afue: 0.95, source: "shop" as const };
    const g = gasCheck(model, fRow);
    if (g && !checks.some((c) => c.id === "gas")) checks.push(g);
    // The NOx check reads the furnace the estimate carries, not the AC.
    const uln = checks.find((c) => c.id === "ca-uln-furnace");
    if (uln) resolveUlnCheck(uln, model, fRow);
    const out = (fRow.btuInput ?? 0) * (fRow.afue ?? 0.8);
    if (heat > 0 && out / heat > 1.4) checks.push({ id: "code", title: "Furnace fit", status: "verify", detail: `The ${Math.round((fRow.btuInput ?? 0) / 1000)}k furnace is the smallest cabinet whose blower carries the ${tonsForFurnace}-t coil — ${Math.round((out / heat) * 100)}% of the heating load, over Manual S's 140%. Confirm with the inspector or step the coil down.`, rule: "ACCA Manual S" });
  }
  // The furnace job's cabinet chosen for its blower, over Manual S's 140%.
  if (job.id === "replace-furnace" && selection.chosen && !selection.chosen.overridden && (selection.chosen.outputRatio ?? 0) > 1.4 && coilTons) {
    const it = selection.chosen.item;
    checks.push({ id: "code", title: "Furnace fit", status: "verify", detail: `${it.brand} ${it.model} puts out ${Math.round((selection.chosen.outputRatio ?? 0) * 100)}% of the heating load — over Manual S's 140% — because it is the smallest cabinet whose blower carries the ${coilTons}-t coil. Confirm with the inspector, or step the coil down with the furnace.`, rule: "ACCA Manual S" });
  }
  if (selection.chosen?.overridden) {
    const it = selection.chosen.item;
    checks.push({ id: "code", title: "Unit chosen by hand", status: "fix", detail: `${it.brand} ${it.model} was chosen over the engine's pick, which ruled it out: ${selection.chosen.overridden} The estimate prices what you chose — stand behind it at the permit desk or pick another unit.`, rule: "ACCA Manual S" });
  }
  if (selection.chosen?.item.typed) {
    const it = selection.chosen.item;
    checks.push({ id: "code", title: "Unit typed in", status: "verify", detail: `${it.brand} ${it.model} was typed in, not read from the catalog. Confirm the model number, the capacity and the ratings against the submittal before ordering${it.cost ? "" : ", and add the cost so the price is not a rate-card default"}.`, rule: "AHRI certified reference" });
  }
  if (job.id === "add-ac" && (model.existing.kind === "split-ac-furnace" || model.existing.kind === "split-heat-pump" || model.existing.kind === "package-unit")) {
    checks.push({ id: "code", title: "Already has cooling", status: "fix", detail: `The record says this house already has cooling (${model.existing.kind.replace(/-/g, " ")}). Adding a second system doubles the circuit and pad and skips the removal — price it as an Outdoor unit or Full system replacement unless a second system is the plan.` });
  }
  const notes: EngineResult["notes"] = [];
  // A service call runs no load: the era table and the load's own notes stay off the card.
  if (job.needs.load) for (const a of load.assumptions) notes.push({ kind: "assumption", text: a });
  if (zoneSqft) notes.push({ kind: "assumption", text: `Zone load: ${zoneSqft.toLocaleString("en-US")} sq ft, ${zoneOccupants} occupant${zoneOccupants === 1 ? "" : "s"}, no duct loss.` });
  if (heads > 1) notes.push({ kind: "assumption", text: `Multi-zone: ${heads} heads on one outdoor unit sized to the zone (${selection.targetTons} t). The catalog's single-zone rows set the rating; the outdoor unit is priced from the rate card's multi-zone default until multi-zone rows are imported.` });
  // A counted glass area answers the window-area default.
  const defaulted = job.needs.load ? defaultedFields(model).filter((f) => !(f === "windowToFloor" && typeof model.windowSqft === "number" && model.windowSqft > 0)).map((f) => FIELD_WORDS[f] ?? f) : [];
  if (defaulted.length) {
    notes.push({
      kind: "assumption",
      text: `Taken from the era table (${DEFAULTS_SOURCE}) until confirmed on site: ${defaulted.join(", ")}.`,
    });
  }
  for (const c of checks) {
    if (c.status !== "pass") notes.push({ kind: "code", text: `${c.title}: ${c.detail}` });
  }
  for (const r of job.id === "service" ? [] : incentivesFor(model.state)) {
    notes.push({ kind: "incentive", text: `${r.program} — ${r.status}${r.amount ? `, ${r.amount}` : ""}: ${r.text} (verified ${r.verifiedOn})` });
  }
  if (job.selection === "none") {
    // Nothing to pick: the notes say what the job is priced on.
    notes.push({ kind: "contractor", text: waterHeater ? `Water heater: ${waterHeater.gallons ? `${waterHeater.gallons} gal ` : ""}${waterHeater.type === "heat-pump" ? "heat-pump" : waterHeater.type} on ${waterHeater.fuel} — ${waterHeater.sizedFrom}.` : job.id === "ducts" ? `Ductwork on the existing system — ${load.coolingCfm.toLocaleString("en-US")} CFM design airflow.` : "Service call — priced by the task." });
  } else if (selection.chosen) {
    if (selection.systems > 1) notes.push({ kind: "contractor", text: `${selection.systems} systems: the ${load.coolingTotalBtuh.toLocaleString("en-US")} BTU/h load is more than one residential unit carries, so the house is zoned into ${selection.systems} and each zone gets its own system.` });
    notes.push({ kind: "contractor", text: `Chosen: ${selection.systems > 1 ? `${selection.systems} × ` : ""}${selection.chosen.item.brand} ${selection.chosen.item.model} — ${selection.chosen.reasons.join(" ")}` });
    if (selection.runnerUp) {
      notes.push({ kind: "contractor", text: `Runner-up: ${selection.runnerUp.item.brand} ${selection.runnerUp.item.model} — ${selection.runnerUp.reasons[0] ?? ""}` });
    }
  } else {
    notes.push({ kind: "contractor", text: `No catalog unit fits the ${load.coolingTotalBtuh.toLocaleString("en-US")} BTU/h cooling load within Manual S limits; a ${selection.targetTons}-ton system is the target.` });
  }

  // The ducts against the airflow, for the design card and the proposal's
  // one plain line (2026-10-08).
  const chosenCap = selection.chosen ? ratedCoolingBtuh(selection.chosen.item) : 0;
  const airTons = Math.round(((chosenCap > 0 ? chosenCap : load.coolingTotalBtuh) / 12000) * 2) / 2;
  const targetCfm = Math.round((airTons * load.cfmPerTon) / 10) * 10;
  const runnerCap = selection.runnerUp ? ratedCoolingBtuh(selection.runnerUp.item) : 0;
  const sizedToDucts = Boolean(ductCap && selection.chosen && selection.runnerUp && runnerCap > chosenCap && selection.runnerUp.reasons.some((r) => /ducts as measured carry/.test(r)) && !selection.chosen.reasons.some((r) => /ducts as measured carry/.test(r)));
  if (sizedToDucts && ductCap && selection.chosen && selection.runnerUp) {
    notes.push({ kind: "contractor", text: `Sized to the ducts in the house: they carry about ${ductCap.capacityCfm.toLocaleString("en-US")} CFM (the ${ductCap.limitedBy} is the limit), which the ${selection.chosen.item.tons ?? airTons}-ton moves; the ${selection.runnerUp.item.tons ?? "bigger"}-ton would need a ${ductCap.limitedBy} upsize first.` });
  }
  const airflow: EngineResult["airflow"] = {
    targetCfm,
    verifiedBy: !ductsMatter ? "none" : typeof model.ducts.measuredTespInWc === "number" ? "static" : ductCap ? "sizes" : "none",
    capacityCfm: ductCap?.capacityCfm,
    limitedBy: ductCap?.limitedBy,
    sizedToDucts: sizedToDucts || undefined,
  };

  return { job: job.id, dualFuel: dualFuel || undefined, waterHeater, zone: zoneSqft ? { sqft: zoneSqft, heads } : undefined, conditions, load, selection, checks, notes, airflow, engineVersion: ENGINE_VERSION };
}
