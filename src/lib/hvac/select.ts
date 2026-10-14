// Equipment selection — Manual S rules over the shop's catalog.
//
// Cooling capacity within 90–115% of the total cooling load (up to 125% for
// variable-capacity equipment, which throttles down); a heat pump judged at
// the 99% design temperature, not at its 47 °F rating, with the balance point
// and the electric backup it needs; a furnace whose output sits between 100%
// and 140% of the heating load. Refrigerant and the DOE efficiency floor
// disqualify; the customer's constraints filter; a score orders what is left.
// No price enters here — the ranking is fit, and the ledger prices it.

import type { EquipmentKind, BuildingModel, CapacityPoint, CatalogItem, DesignConditions, LoadResult, SelectionCandidate, SelectionResult } from "./types";
import { HEAT_PUMP_DERATE } from "./data/defaults";
import { heatingLoadAt } from "./load";
import { efficiencyFloor, refrigerantRule, ultraLowNoxNeeded } from "./data/rules";

const BTU_PER_KW = 3412;
/** A heat kit's minimum airflow, the makers' tables: about 60 CFM per kW (a 53 °F rise). */
const CFM_PER_KW = 60;

/** Rated cooling capacity of a cooling product, BTU/h. */
export function ratedCoolingBtuh(item: CatalogItem): number {
  if (item.coolingBtuh && item.coolingBtuh > 0) return item.coolingBtuh;
  if (item.tons && item.tons > 0) return item.tons * 12000;
  return 0;
}

/**
 * Heating capacity of a heat pump at an outdoor temperature. Published points
 * at 47 / 17 / 5 °F are interpolated; missing points fall back to typical
 * derates (cold-climate units hold ~80% at 17 °F and ~72% at 5 °F; ordinary
 * units ~65% and ~52%). Below the coldest point the last slope continues,
 * floored at 30% of the 47 °F rating.
 */
export function heatPumpCapacityAt(item: CatalogItem, outdoorF: number): number {
  const base = item.heat47Btuh && item.heat47Btuh > 0 ? item.heat47Btuh : ratedCoolingBtuh(item);
  if (base <= 0) return 0;
  const derate = item.coldClimate ? HEAT_PUMP_DERATE.coldClimate : HEAT_PUMP_DERATE.standard;
  const p17 = item.heat17Btuh && item.heat17Btuh > 0 ? item.heat17Btuh : base * derate.r17;
  const p5 = item.heat5Btuh && item.heat5Btuh > 0 ? item.heat5Btuh : base * derate.r5;
  if (outdoorF >= 47) return base;
  if (outdoorF >= 17) return p17 + ((base - p17) * (outdoorF - 17)) / 30;
  if (outdoorF >= 5) return p5 + ((p17 - p5) * (outdoorF - 5)) / 12;
  // Below the coldest published point the curve keeps falling: the read slope,
  // or at least ~1.3% of rated per °F (a cold-climate unit that holds 100% to
  // 5 °F is near 76% by −13 °F).
  const slope = Math.max((p17 - p5) / 12, base * 0.013);
  return Math.max(base * 0.3, p5 - slope * (5 - outdoorF));
}

/** Outdoor temperature where the heat pump alone just carries the house. */
export function balancePointF(item: CatalogItem, load: LoadResult, c: DesignConditions): number | null {
  if (heatPumpCapacityAt(item, c.heatingF) >= load.heatingBtuh) return c.heatingF; // carries the design day
  for (let t = c.heatingF; t <= 65; t += 0.5) {
    if (heatPumpCapacityAt(item, t) >= heatingLoadAt(load, c, t)) return Math.round(t * 2) / 2;
  }
  return null;
}

/** Capacity and load from below the design temperature up to 65 °F, for the chart. */
export function capacityCurve(item: CatalogItem, load: LoadResult, c: DesignConditions): CapacityPoint[] {
  const out: CapacityPoint[] = [];
  const start = Math.floor((c.heatingF - 10) / 5) * 5;
  for (let t = start; t <= 65; t += 5) {
    out.push({ outdoorF: t, capacityBtuh: Math.round(heatPumpCapacityAt(item, t)), loadBtuh: Math.round(heatingLoadAt(load, c, t)) });
  }
  return out;
}

export function evaluateItem(item: CatalogItem, load: LoadResult, c: DesignConditions, m: BuildingModel, opts: { wantsHeatPump?: boolean; keepsIndoor?: boolean; ductCfm?: number; keptUpTons?: number } = {}): SelectionCandidate {
  const reasons: string[] = [];
  let score = 100;
  const out: SelectionCandidate = { item, score, reasons };
  const fail = (why: string) => {
    out.disqualified = why;
    out.score = 0;
    return out;
  };

  const rr = refrigerantRule(m.state, item.refrigerant);
  if (!rr.allowed) return fail(rr.text);
  if (rr.status === "verify" && item.refrigerant === "R-410A") {
    score -= 8;
    reasons.push("R-410A stock: confirm the manufacture date and supply before quoting.");
  }
  if (m.preferences.brands?.length && !m.preferences.brands.some((b) => b.toLowerCase() === item.brand.toLowerCase())) {
    return fail(`${item.brand} is not on the shop's brand list.`);
  }

  // Fuel: an all-electric house (or one that wants off gas) takes a heat pump;
  // a house keeping its gas furnace takes an AC, and a heat pump there is a
  // dual-fuel upsell to offer, not the default.
  const noGas = m.gas.available === false || m.preferences.allElectric === true || m.existing.fuel === "electric";
  const hasFurnace = m.existing.kind === "split-ac-furnace" || m.existing.kind === "furnace-only";
  // A heat-pump conversion is the contractor's call: the furnace may stay as
  // dual-fuel backup, and that is not a mark against the heat pump.
  const keepsGas = !noGas && !opts.wantsHeatPump && (m.preferences.keepGas === true || m.existing.fuel === "gas" || m.existing.fuel === "propane" || (hasFurnace && m.gas.available === true));
  // An AC needs an indoor blower to pair with: a new gas furnace on a full
  // replacement, or the furnace / air handler that stays on an add or a swap
  // (an electric furnace carries a coil just as well).
  // Gas heat in California: the South Coast, San Joaquin Valley and Bay Area
  // districts take only 14 ng/J, and the rule binds the installer.
  if ((item.kind === "furnace" || (item.kind === "package" && item.heatKind === "gas")) && (item.noxNgJ ?? 40) > 14) {
    const uln = ultraLowNoxNeeded(m.state, m.county);
    if (uln === "required") return fail(`Not certified to 14 ng/J, and ${m.county} County sits in a district that takes only ultra-low-NOx gas heat — order the ULN build of this model.`);
    if (uln === "confirm") { score -= 4; reasons.push("California: confirm the air district — the South Coast, San Joaquin Valley and Bay Area districts take only 14 ng/J gas heat, and this unit is the 40 ng/J build."); }
  }
  // Where the row may be sold and installed: a state rule the catalog carries.
  const st = (m.state || "").toUpperCase();
  if (st && item.notStates?.map((x) => x.toUpperCase()).includes(st)) return fail(`Not sold or not permitted in ${st}${item.availabilityNote ? ` — ${item.availabilityNote}` : ""}.`);
  if (st && item.states?.length && !item.states.map((x) => x.toUpperCase()).includes(st)) return fail(`Sold in ${item.states.join(", ")} only${item.availabilityNote ? ` — ${item.availabilityNote}` : ""}.`);
  if (item.kind === "air-conditioner" && noGas && !opts.keepsIndoor) return fail("An AC pairs with a gas furnace on a full replacement, and this house has no gas — a heat pump is the fit (an AC on an electric air handler can still be chosen by hand).");
  if (item.kind === "package" && (item.heatKind ?? "gas") === "gas" && noGas) return fail("A gas/electric package unit on a house with no gas — a heat-pump or electric package unit is the fit.");
  // A package unit replaces a package unit: a split house keeps its split
  // (the contractor can still put a package on by hand).
  if (item.kind === "package" && m.existing.kind !== "package-unit") return fail("A package unit goes where a package unit was; this house has a split system — choose it by hand if the job goes that way.");
  if (item.kind === "heat-pump" && keepsGas) {
    // Decisive, not a nudge: a variable-speed heat pump that carries the
    // design day picks up +14 elsewhere, and a gas house should still see
    // the AC first and the heat pump as the runner-up (the dual-fuel offer).
    score -= 20;
    reasons.push("The house keeps its gas furnace — offer this as dual fuel.");
  }
  if (item.kind === "heat-pump" && noGas) score += 4;

  const cools = item.kind === "heat-pump" || item.kind === "air-conditioner" || item.kind === "package" || item.kind === "ductless";
  if (cools) {
    const cap = ratedCoolingBtuh(item);
    if (cap <= 0) return fail("No cooling capacity on the catalog row.");
    const heatPumpClass = item.kind === "heat-pump" || item.kind === "ductless" || (item.kind === "package" && item.heatKind === "heat-pump");
    const floor = efficiencyFloor(m.state, heatPumpClass ? "heat-pump" : "air-conditioner", cap, item.kind === "package");
    if (item.seer2 && item.seer2 < floor.seer2) return fail(`${item.seer2} SEER2 is below the ${floor.seer2} SEER2 regional minimum.`);
    // The Southwest EER2 floor drops for a unit already certified high on SEER2.
    const eerFloor = floor.eer2IfHighSeer && (item.seer2 ?? 0) >= 15.2 ? floor.eer2IfHighSeer : floor.eer2;
    if (eerFloor && item.eer2 && item.eer2 < eerFloor) return fail(`${item.eer2} EER2 is below the ${eerFloor} EER2 minimum for this region.`);
    // The Southwest's EER2 floor cannot be checked on a row that carries no
    // EER2 (2026-10-08): said, not passed in silence.
    if (eerFloor && !item.eer2) { score -= 5; reasons.push(`EER2 not on the catalog row — the region's ${eerFloor} EER2 floor could not be checked; confirm it on the AHRI certificate.`); }
    if (floor.hspf2 && item.hspf2 && item.hspf2 < floor.hspf2) return fail(`${item.hspf2} HSPF2 is below the ${floor.hspf2} HSPF2 minimum for a heat pump.`);
    if (!item.seer2) { score -= 5; reasons.push("SEER2 not on the catalog row — confirm it meets the regional minimum."); }
    const ratio = load.coolingTotalBtuh > 0 ? cap / load.coolingTotalBtuh : 0;
    out.coolingRatio = Math.round(ratio * 100) / 100;
    // Manual S: cooling gear lands in 90–115% (variable 125%). A heat pump in
    // a house whose heating load is the bigger one may run to 125% (variable
    // 135%) so the unit that carries the most heat is not thrown out for
    // cooling alone — heating governs (review, 2026-09-17).
    const heatingGoverns = (item.kind === "heat-pump" || (item.kind === "package" && item.heatKind === "heat-pump")) && load.heatingBtuh > load.coolingTotalBtuh;
    const upper = item.staging === "variable" ? (heatingGoverns ? 1.35 : 1.25) : heatingGoverns ? 1.25 : 1.15;
    // Judged on whole percent: a 42,000 BTU/h unit on a 36,500 load is 115%, not 115.07%.
    const pct = Math.round(ratio * 100);
    if (pct < 90) return fail(`Cooling capacity is ${pct}% of the load; Manual S wants at least 90%.`);
    if (pct > Math.round(upper * 100)) return fail(`Cooling capacity is ${pct}% of the load; Manual S allows up to ${Math.round(upper * 100)}% for this equipment.`);
    // Lean small (2026-10-08, on a contractor's word that load calcs
    // oversize): the size nearest the load ranks first, and an undersize
    // inside the window costs less than the same oversize — 95% beats 110%.
    // Manual S's 90% floor already guards the hottest afternoon. Where
    // heating governs the cooling fit is a bound, not the ranking: the heat
    // carried at the design temperature ranks the sizes (below).
    const miss = ratio >= 1 ? (ratio - 1) * 100 : (1 - ratio) * 80;
    score -= heatingGoverns && !keepsGas ? Math.round(miss * 0.2) : Math.round(miss);
    reasons.push(`Cooling ${Math.round(ratio * 100)}% of the ${load.coolingTotalBtuh.toLocaleString("en-US")} BTU/h load${heatingGoverns ? " — heating governs, so Manual S allows up to " + Math.round(upper * 100) + "%" : ""}.`);
    // The ducts that are there (lib/hvac/ductCalc, 2026-10-08): a size whose
    // airflow the measured ducts cannot carry drops behind a size they can;
    // the old unit that kept up on the hottest days holds a bigger one back.
    const needCfm = (cap / 12000) * (load.cfmPerTon || 400);
    if (opts.ductCfm && needCfm > opts.ductCfm) { score -= 25; reasons.push(`Moves about ${(Math.round(needCfm / 10) * 10).toLocaleString("en-US")} CFM; the ducts as measured carry about ${Math.round(opts.ductCfm).toLocaleString("en-US")} — a trunk or return upsize goes with this size.`); }
    if (opts.keptUpTons && cap / 12000 > opts.keptUpTons + 0.01) { score -= 12; reasons.push(`Bigger than the ${opts.keptUpTons}-ton that kept up on the hottest days.`); }
    if (item.staging === "variable") { score += 6; reasons.push("Variable capacity: better humidity control and part-load efficiency."); }
    else if (item.staging === "two-stage") { score += 3; }
    if (c.humidity === "humid" && item.staging === "single" && ratio > 1.1) { score -= 6; reasons.push("Single-stage and oversized in a humid climate: short cycles, poor dehumidification."); }
  }

  if (item.kind === "package" && item.heatKind === "electric") {
    // Electric strip heat: the whole heating load is resistance, on the panel
    // and on the bill — a heat-pump package outranks it wherever one fits.
    out.backupKw = Math.round((load.heatingBtuh / BTU_PER_KW) * 10) / 10;
    score -= 18;
    reasons.push(`Electric heat only: ${out.backupKw} kW of strips carry the ${load.heatingBtuh.toLocaleString("en-US")} BTU/h heating load — a heat-pump package cuts the winter bill.`);
  }
  if (item.kind === "package" && (item.heatKind ?? "gas") === "gas") {
    // The gas section is a furnace: 100–140% of the heating load when its
    // input is on the row; otherwise the check asks for the submittal.
    if (item.btuInput) {
      const output = item.btuInput * (item.afue ?? 0.81);
      out.furnaceOutputBtuh = Math.round(output);
      const ratio = load.heatingBtuh > 0 ? output / load.heatingBtuh : 0;
      out.outputRatio = Math.round(ratio * 100) / 100;
      if (ratio < 1) { score -= 12; reasons.push(`Gas section ${Math.round(output).toLocaleString("en-US")} BTU/h is under the ${load.heatingBtuh.toLocaleString("en-US")} BTU/h heating load — confirm the next heat size in this cabinet.`); }
      else if (ratio > 1.4) { score -= 4; reasons.push(`Gas section is ${Math.round(ratio * 100)}% of the heating load — over Manual S's 140%; the smaller heat option in this cabinet may fit.`); }
      else reasons.push(`Gas section ${Math.round(ratio * 100)}% of the heating load.`);
    } else reasons.push("Gas input not on the row — confirm the heat section against the heating load on the submittal.");
  }
  if (item.kind === "heat-pump" || (item.kind === "package" && item.heatKind === "heat-pump")) {
    const atDesign = heatPumpCapacityAt(item, c.heatingF);
    out.heatAtDesignBtuh = Math.round(atDesign);
    out.balancePointF = balancePointF(item, load, c) ?? undefined;
    out.backupKw = Math.round((Math.max(0, load.heatingBtuh - atDesign) / BTU_PER_KW) * 10) / 10;
    out.curve = capacityCurve(item, load, c);
    const heatingGoverns = load.heatingBtuh > load.coolingTotalBtuh;
    if (atDesign >= load.heatingBtuh) {
      score += 8;
      reasons.push(`Carries the ${load.heatingBtuh.toLocaleString("en-US")} BTU/h heating load at ${c.heatingF} °F with no backup.`);
    } else {
      const share = atDesign / load.heatingBtuh;
      reasons.push(`Covers ${Math.round(share * 100)}% of the heating load at ${c.heatingF} °F; ${out.backupKw} kW of backup carries the rest below ${out.balancePointF ?? "—"} °F.`);
      // Where heating governs, the size that carries the most heat inside
      // the cooling window ranks first (Manual S sizes the heat pump on heat)
      // — among heat pumps. On a house that keeps its gas the AC still leads
      // and the heat pump stays the dual-fuel runner-up.
      // A PENALTY for the heat not carried, not a bonus for the heat carried
      // (2026-10-14): the score is capped at 100, and a bonus pushed every
      // in-window size past the cap, where a 2-ton that carries 22% of the
      // design heat tied a 2.5-ton that carries 44% and won on catalog order.
      if (heatingGoverns && !keepsGas) score -= Math.round((1 - share) * 30);
      if (share < 0.6) { score -= 15; reasons.push("Under 60% at the design temperature — the strips will run most cold nights."); }
      else if (share < 0.8) score -= 6;
    }
    if (c.heatingF <= 17 && !item.coldClimate) { score -= 10; reasons.push("A cold-climate rated unit holds more capacity at this design temperature."); }
    if (m.preferences.keepGas && !opts.wantsHeatPump) { score -= 4; reasons.push("Customer wants to keep gas; a dual-fuel pairing may suit better."); }
  } else if (item.kind === "package" && item.heatKind === "electric" && load.heatingBtuh > load.coolingTotalBtuh) {
    // The same ladder for a straight-cool package with strip heat: on a house
    // whose heating load is the bigger one it carries none of the heat without
    // the strips, so it sits below every heat-pump package (2026-10-14).
    score -= 30;
    reasons.push("Electric-strip heat only: on a house whose heating load is the bigger one, a heat-pump package carries most of it for a third of the power.");
  }

  if (item.kind === "furnace") {
    if (m.preferences.allElectric) return fail("Customer wants all-electric.");
    if (m.gas.available === false) {
      reasons.push("No gas at the property: a gas furnace needs a gas service — or price an electric furnace or a heat pump.");
      score -= 30;
    } else if (!m.gas.available && item.btuInput && (m.existing.fuel === "gas" || m.existing.fuel === undefined)) {
      reasons.push("Gas availability at the property is unconfirmed.");
      score -= 10;
    }
    const output = (item.btuInput ?? 0) * (item.afue ?? 0.8);
    out.furnaceOutputBtuh = Math.round(output);
    const ratio = load.heatingBtuh > 0 ? output / load.heatingBtuh : 0;
    out.outputRatio = Math.round(ratio * 100) / 100;
    if (ratio < 1) return fail(`Furnace output ${Math.round(output).toLocaleString("en-US")} BTU/h is under the ${load.heatingBtuh.toLocaleString("en-US")} BTU/h heating load.`);
    if (ratio > 1.4) return fail(`Furnace output is ${Math.round(ratio * 100)}% of the heating load; Manual S caps a furnace at 140%.`);
    score -= Math.round(Math.abs(ratio - 1.15) * 60);
    reasons.push(`Output ${Math.round(ratio * 100)}% of the heating load.`);
    if ((item.afue ?? 0) >= 0.9) reasons.push("Condensing furnace: PVC vent, condensate drain and neutralizer are part of the job.");
  }

  out.score = Math.max(1, Math.min(100, Math.round(score)));
  return out;
}

/** Rank the catalog against the load. Heat pumps and air conditioners compete
 *  for the outdoor unit; furnaces are listed alongside for a gas house. */
const isOutdoor = (x: SelectionCandidate) => !x.disqualified && (x.item.kind === "heat-pump" || x.item.kind === "air-conditioner" || x.item.kind === "package" || x.item.kind === "ductless");

/** Residential ladders stop at 5 tons; a bigger load is two (or three)
 *  systems, each on its own zone, and the selection says so. */
export interface SelectOptions {
  /** Catalog kinds the job may choose from; empty/undefined = any outdoor kind. */
  kinds?: EquipmentKind[];
  /** The contractor chose a heat pump: no keep-gas penalty. */
  wantsHeatPump?: boolean;
  /** The indoor unit stays (add cooling, outdoor swap): an AC pairs with it whatever the fuel. */
  keepsIndoor?: boolean;
  /** Smallest nominal size worth targeting (0.5 t for a ductless zone; 1.5 t central). */
  minTons?: number;
  /** Furnace jobs: the coil the new furnace is set under — its blower must carry these tons. */
  coilTons?: number;
  /** What the ducts as measured carry, CFM (lib/hvac/ductCalc): a size needing more ranks behind one they carry. */
  ductCfm?: number;
  /** The old unit that kept up on the hottest days: a bigger one ranks behind. */
  keptUpTons?: number;
}

export function selectSystem(catalog: CatalogItem[], load: LoadResult, c: DesignConditions, m: BuildingModel, opts: SelectOptions = {}): SelectionResult {
  // Central gear comes in half tons from 1.5; wall heads in quarter tons from 0.5.
  const minTons = opts.minTons ?? 1.5;
  const step = minTons < 1.5 ? 4 : 2;
  const targetTons = Math.max(minTons, Math.round((load.coolingTotalBtuh / 12000) * step) / step);
  const allowed = opts.kinds?.length ? new Set(opts.kinds) : null;
  const pool = allowed ? catalog.filter((i) => allowed.has(i.kind)) : catalog;
  const model = m;
  const scorer = { wantsHeatPump: opts.wantsHeatPump, keepsIndoor: opts.keepsIndoor, ductCfm: opts.ductCfm, keptUpTons: opts.keptUpTons };
  const candidates = pool.map((item) => evaluateItem(item, load, c, model, scorer)).sort((a, b) => b.score - a.score);
  // An electric furnace is an air handler with a heat kit: the cabinet must
  // carry the coil it serves AND move the kit's air. A kit is rated at a
  // minimum airflow — about 60 CFM per kW, a 53 °F rise, as the makers'
  // tables have it — so a 20 kW kit needs about 1,200 CFM, which a 1.5-ton
  // cabinet cannot move (2026-09-20: an electric furnace in Seattle came back
  // as a 1.5-ton air handler with 20 kW on it, a 105 °F rise).
  if (allowed && allowed.has("air-handler") && allowed.size === 1) {
    const kw = Math.round((load.heatingBtuh / 3412) * 10) / 10;
    const kitKw = Math.max(5, Math.ceil(kw / 5) * 5);
    const kitTons = Math.ceil(((kitKw * CFM_PER_KW) / (load.cfmPerTon || 400)) * 2) / 2;
    const coilNeed = opts.coilTons ?? targetTons;
    const need = Math.max(coilNeed, kitTons);
    const fits = candidates.filter((x) => !x.disqualified && x.item.kind === "air-handler" && (x.item.maxTons ?? x.item.tons ?? 99) >= need).sort((a, b) => (a.item.tons ?? 99) - (b.item.tons ?? 99));
    const pool2 = fits.length ? fits : candidates.filter((x) => x.item.kind === "air-handler").sort((a, b) => (b.item.tons ?? 0) - (a.item.tons ?? 0));
    const why = kitTons > coilNeed
      ? `Electric furnace: the ${kitKw} kW heat kit for the ${Math.round(load.heatingBtuh / 1000)}k BTU/h heating load needs about ${Math.round(kitKw * CFM_PER_KW).toLocaleString("en-US")} CFM, so the cabinet is sized ${need} ton for the blower, not the ${coilNeed}-ton coil.`
      : `Electric furnace: this cabinet carries the ${coilNeed}-ton coil and the ${kitKw} kW heat kit's air for the ${Math.round(load.heatingBtuh / 1000)}k BTU/h heating load.`;
    const withReason = pool2.map((x) => ({ ...x, disqualified: undefined, backupKw: kw, reasons: [...x.reasons.filter((r) => !/SEER2|cold-climate/i.test(r)), why] }));
    return { chosen: withReason[0] ?? null, runnerUp: withReason[1] ?? null, candidates, targetTons, systems: 1 };
  }
  // Furnace-only jobs pick a furnace; everything else picks an outdoor unit.
  if (allowed && allowed.has("furnace") && allowed.size === 1) {
    const furnaces = candidates.filter((x) => !x.disqualified && x.item.kind === "furnace").sort((a, b) => (Math.abs((a.outputRatio ?? 9) - 1.15)) - (Math.abs((b.outputRatio ?? 9) - 1.15)));
    if (!furnaces.length) {
      // A small load and nothing small enough made: Manual S accepts the
      // smallest available furnace over 140% — said so, not hidden.
      const smallest = candidates.filter((x) => x.item.kind === "furnace" && (x.outputRatio ?? 0) >= 1 && /140%/.test(x.disqualified ?? "")).sort((a, b) => (a.outputRatio ?? 9) - (b.outputRatio ?? 9))[0];
      if (smallest) {
        const chosen: SelectionCandidate = { ...smallest, disqualified: undefined, score: 60, reasons: [`Output ${Math.round((smallest.outputRatio ?? 0) * 100)}% of the heating load — over Manual S's 140%, but the smallest furnace in the catalog; acceptable when nothing smaller is made. Confirm with the inspector.`] };
        return { chosen, runnerUp: null, candidates, targetTons, systems: 1 };
      }
    }
    // The blower must move the coil's air: among the fits, prefer cabinets
    // rated for the coil (maxTons). When no cabinet inside 100–140% carries
    // it, the smallest one that does goes on — over 140%, said so — because
    // "replace the furnace" cannot end in a furnace that starves the coil
    // (review, 2026-09-17). Only when no cabinet at all carries the coil does
    // the engine hand back the closest fit and flag the blower.
    const carries = opts.coilTons ? furnaces.filter((x) => (x.item.maxTons ?? 99) >= (opts.coilTons ?? 0)) : furnaces;
    if (opts.coilTons && !carries.length) {
      const big = candidates.filter((x) => x.item.kind === "furnace" && (x.outputRatio ?? 0) >= 1 && (x.item.maxTons ?? 0) >= (opts.coilTons ?? 0) && (!x.disqualified || /140%/.test(x.disqualified))).sort((a, b) => (a.outputRatio ?? 9) - (b.outputRatio ?? 9))[0];
      if (big) {
        const chosen: SelectionCandidate = { ...big, disqualified: undefined, score: 60, reasons: [`Output ${Math.round((big.outputRatio ?? 0) * 100)}% of the heating load — over Manual S's 140%, but the smallest cabinet whose blower carries the ${opts.coilTons}-ton coil; step the coil down to stay inside 140%.`, ...big.reasons.filter((r) => !/^Output /.test(r))] };
        return { chosen, runnerUp: furnaces[0] ?? null, candidates, targetTons, systems: 1 };
      }
    }
    const ranked = carries.length ? carries : furnaces;
    return { chosen: ranked[0] ?? null, runnerUp: ranked[1] ?? null, candidates, targetTons, systems: 1 };
  }
  const outdoor = candidates.filter(isOutdoor);
  if (outdoor.length || load.coolingTotalBtuh <= 40000) {
    if (!outdoor.length) {
      // A load under the smallest unit made: Manual S accepts the smallest
      // available unit over its window — said so, not hidden as "no fit".
      const over = candidates.filter((x) => /allows up to/.test(x.disqualified ?? "") && (x.item.kind === "heat-pump" || x.item.kind === "air-conditioner" || x.item.kind === "package" || x.item.kind === "ductless")).sort((a, b) => ratedCoolingBtuh(a.item) - ratedCoolingBtuh(b.item) || b.score - a.score);
      const smallest = over[0];
      if (smallest && ratedCoolingBtuh(smallest.item) <= Math.min(...pool.filter((i) => i.kind === smallest.item.kind).map((i) => ratedCoolingBtuh(i) || Infinity))) {
        const chosen: SelectionCandidate = { ...smallest, disqualified: undefined, score: 60, reasons: [`Cooling ${Math.round((smallest.coolingRatio ?? 0) * 100)}% of the load — over Manual S's window, but the smallest ${smallest.item.kind === "ductless" ? "head" : "unit"} made; accepted as the smallest available, confirm with the inspector.`, ...smallest.reasons.filter((r) => !/^Cooling /.test(r))] };
        return { chosen, runnerUp: over[1] ?? null, candidates, targetTons, systems: 1 };
      }
    }
    return { chosen: outdoor[0] ?? null, runnerUp: outdoor[1] ?? null, candidates, targetTons, systems: 1 };
  }
  for (const n of [2, 3]) {
    const part: LoadResult = {
      ...load,
      coolingTotalBtuh: Math.round(load.coolingTotalBtuh / n / 500) * 500,
      coolingSensibleBtuh: Math.round(load.coolingSensibleBtuh / n),
      coolingLatentBtuh: Math.round(load.coolingLatentBtuh / n),
      heatingBtuh: Math.round(load.heatingBtuh / n / 500) * 500,
      coolingTons: Math.round((load.coolingTons / n) * 10) / 10,
      coolingCfm: Math.round(load.coolingCfm / n),
    };
    const split = pool.map((item) => evaluateItem(item, part, c, model, scorer)).sort((a, b) => b.score - a.score);
    const fits = split.filter(isOutdoor);
    if (fits.length) {
      for (const f of fits.slice(0, 2)) f.reasons.unshift(`One of ${n} systems — the ${load.coolingTotalBtuh.toLocaleString("en-US")} BTU/h load is split into ${n} zones.`);
      return { chosen: fits[0], runnerUp: fits[1] ?? null, candidates: split, targetTons, systems: n, perSystem: { coolingTotalBtuh: part.coolingTotalBtuh, heatingBtuh: part.heatingBtuh } };
    }
  }
  return { chosen: null, runnerUp: null, candidates, targetTons, systems: 1 };
}
