// Block load — the instant number, estimating grade.
//
// A Manual J-style whole-house calculation in plain TypeScript: envelope by
// component, window solar by wall orientation, infiltration from a tightness
// class, internal gains, duct loss and gain by duct location, county design
// temperatures. Deterministic: the same house and the same tables give the
// same answer, and scripts/qa/hvac-engine.check.ts holds it to known
// behaviour. It is NOT an ACCA-approved calculation; the approved report for
// a permit comes from the partner tool (see docs/hvac-estimator-plan.md).
//
// Conventions: indoor 75 °F / 50% RH cooling, 70 °F heating; loads rounded to
// 500 BTU/h because a finer figure would claim a precision the defaults do
// not have.

import type { BuildingModel, DesignConditions, LoadComponent, LoadResult } from "./types";
import {
  ACH50,
  CEILING_U,
  CFM_PER_TON,
  DOOR_BY_TYPE,
  DOOR_SQFT_EACH,
  DUCT,
  DUCT_LEAK_TYPICAL,
  FLOOR,
  ROOF_COLOR_ADD,
  SHADING_FACTOR,
  SIDING_COLOR_ADD,
  SKYLIGHT,
  SOLAR_BY_BEARING,
  WALL_BUILD,
  WALL_U,
  WINDOW,
} from "./data/defaults";

export const ENGINE_VERSION = "jobflex-hvac-engine 0.3 · block load, estimating grade (2026-10-18: glass by side, blower-door and duct-leakage tests, wall construction, siding colour, skylights, doors)";
export const INDOOR_COOLING_F = 75;
export const INDOOR_HEATING_F = 70;
/** Supply-to-room temperature difference the airflow is sized on, °F. */
const SUPPLY_DT_F = 20;
const OCCUPANT_SENSIBLE = 230;
const OCCUPANT_LATENT = 200;
const APPLIANCE_SENSIBLE = 1200;
const REFERENCE_SHGC = 0.87;
/** Summer natural air changes as a share of winter's (Manual J Table 5A: the
 *  cooling column runs 0.5–0.55 of the heating column in every class). */
const SUMMER_ACH_SHARE = 0.53;

const round500 = (v: number) => Math.max(0, Math.round(v / 500) * 500);
const round = (v: number, d = 0) => Math.round(v * 10 ** d) / 10 ** d;

/** Solar gain per sq ft of window at the design hour for a wall bearing. */
export function solarGainForBearing(bearingDeg: number): { gain: number; label: string } {
  const b = ((bearingDeg % 360) + 360) % 360;
  for (const s of SOLAR_BY_BEARING) {
    if (s.from > s.to ? b >= s.from || b < s.to : b >= s.from && b < s.to) return { gain: s.gain, label: s.label };
  }
  return { gain: 70, label: "?" };
}

/** The glass typed by the way it faces (2026-10-18), or null when none was. */
export function glassBySide(m: BuildingModel): { N: number; E: number; S: number; W: number; total: number } | null {
  const v = (x: number | undefined) => (typeof x === "number" && x > 0 ? x : 0);
  const g = { N: v(m.glassNorthSqft), E: v(m.glassEastSqft), S: v(m.glassSouthSqft), W: v(m.glassWestSqft) };
  const total = g.N + g.E + g.S + g.W;
  return total > 0 ? { ...g, total } : null;
}

/** Window area split by the walls it sits in: as typed by side when it was,
 *  else by footprint edge length when the footprint is known, otherwise a
 *  quarter each way. */
function windowShares(m: BuildingModel): Array<{ label: string; share: number; gain: number }> {
  const side = glassBySide(m);
  if (side) {
    return (["N", "E", "S", "W"] as const)
      .filter((k) => side[k] > 0)
      .map((k) => ({ label: k, share: side[k] / side.total, gain: solarGainForBearing({ N: 0, E: 90, S: 180, W: 270 }[k]).gain }));
  }
  const edges = (m.footprintEdges ?? []).filter((e) => e.lengthFt > 0);
  if (!edges.length) {
    return [
      { label: "N", share: 0.25, gain: 25 },
      { label: "E", share: 0.25, gain: 110 },
      { label: "S", share: 0.25, gain: 50 },
      { label: "W", share: 0.25, gain: 110 },
    ];
  }
  const total = edges.reduce((a, e) => a + e.lengthFt, 0);
  const byLabel = new Map<string, { share: number; gain: number }>();
  for (const e of edges) {
    const { gain, label } = solarGainForBearing(e.bearingDeg);
    const cur = byLabel.get(label) ?? { share: 0, gain };
    cur.share += e.lengthFt / total;
    byLabel.set(label, cur);
  }
  return [...byLabel.entries()].map(([label, v]) => ({ label, ...v }));
}

export function computeBlockLoad(m: BuildingModel, c: DesignConditions, opts: { zone?: boolean } = {}): LoadResult {
  const assumptions: string[] = [];
  // A whole house is at least a 200 sq ft box; a ductless zone can be a
  // 100 sq ft room (the engine floors it there and says so).
  const area = Math.max(opts.zone ? 100 : 200, m.conditionedSqft);
  const storeys = Math.max(1, Math.round(m.storeys || 1));
  const ceiling = m.ceilingHeightFt > 0 ? m.ceilingHeightFt : 8;
  if (!(m.ceilingHeightFt > 0)) assumptions.push("Ceiling height assumed 8 ft.");
  const footprint = area / storeys;
  let perimeter = m.perimeterFt ?? 0;
  if (!(perimeter > 0)) {
    // A 3:2 rectangle of the footprint area; a real footprint replaces this.
    perimeter = 4.1 * Math.sqrt(footprint);
    assumptions.push(`Exterior perimeter estimated at ${Math.round(perimeter)} ft from a 3:2 footprint of ${Math.round(footprint)} sq ft.`);
  }

  const dtHeat = Math.max(0, INDOOR_HEATING_F - c.heatingF);
  const dtCool = Math.max(0, c.coolingF - INDOOR_COOLING_F);
  const win = WINDOW[m.windowType];
  // The glass area counted on the walk or typed beats the era ratio — window
  // area is the biggest single lever on a cooling load, and the ratio is a
  // guess at it.
  // Glass typed by the way it faces is the most specific answer of all: its
  // sum is the window area and the sun is split by it (2026-10-18).
  const side = glassBySide(m);
  const typedTotal = typeof m.windowSqft === "number" && m.windowSqft > 0 ? m.windowSqft : 0;
  const glassMeasured = !!side || typedTotal > 0;
  const windowSqft = side ? side.total : typedTotal > 0 ? typedTotal : area * m.windowToFloor;
  if (side) assumptions.push(`Glass by side as typed: north ${Math.round(side.N)}, east ${Math.round(side.E)}, south ${Math.round(side.S)}, west ${Math.round(side.W)} sq ft — ${Math.round(side.total)} sq ft in all${typedTotal > 0 && Math.abs(typedTotal - side.total) > 1 ? ` (the ${Math.round(typedTotal)} sq ft typed as the window area stands aside)` : ""}.`);
  // Doors (2026-10-18): counted and typed, else two a storey up to two storeys — the 40 sq ft a storey the load always used.
  const doorCount = typeof m.doorCount === "number" && m.doorCount >= 0 ? Math.round(m.doorCount) : 2 * Math.min(2, storeys);
  const door = DOOR_BY_TYPE[m.doorType ?? "solid-wood"];
  const doorSqft = doorCount * DOOR_SQFT_EACH;
  const grossWall = perimeter * ceiling * storeys;
  const netWall = Math.max(0, grossWall - windowSqft - doorSqft);
  // The walls by what they are built of and the colour the sun meets (2026-10-18).
  const build = WALL_BUILD[m.wallConstruction ?? "wood-frame"];
  const wallU = build.uByInsulation ? build.uByInsulation[m.wallInsulation] : build.uCap ? Math.min(WALL_U[m.wallInsulation], build.uCap) : WALL_U[m.wallInsulation] * (build.uMul ?? 1);
  const siding = m.sidingColor ?? "medium";
  const wallCoolAdd = build.coolAddF + SIDING_COLOR_ADD[siding];
  const skylightSqft = typeof m.skylightSqft === "number" && m.skylightSqft > 0 ? m.skylightSqft : 0;
  const ceilU = CEILING_U[m.ceilingInsulation];
  const floor = FLOOR[m.foundation];
  const floorUA = floor.perPerimeter ? floor.heatingUA * perimeter : floor.heatingUA * footprint;

  // Infiltration: blower-door ACH50 to natural air changes by the usual
  // divisor (about 20 for a single storey, less for a taller house) — that is
  // the WINTER rate. Manual J's Table 5A gives summer air changes at about
  // half the winter figure (less wind, less stack), and fewer air changes
  // for a bigger house of the same construction (its envelope is smaller for
  // its volume): a 2,000 sq ft "average" house turns over ~0.4 ACH in winter
  // and ~0.2 in summer; a 3,200 sq ft one ~0.3 / 0.16. One rate for both
  // seasons (the 0.1 engine) doubled the summer infiltration load.
  const nFactor = storeys >= 2 ? 17 : 20;
  const volume = area * ceiling;
  // A blower-door test outranks the class (2026-10-18): CFM50 off the gauge
  // over the house's volume, or the report's ACH50. A measured figure already
  // carries the house's size, so the class's size factor stands aside.
  const testedAch50 = typeof m.blowerDoorCfm50 === "number" && m.blowerDoorCfm50 > 0 ? (m.blowerDoorCfm50 * 60) / volume : typeof m.blowerDoorAch50 === "number" && m.blowerDoorAch50 > 0 ? m.blowerDoorAch50 : 0;
  const sizeFactor = testedAch50 > 0 ? 1 : Math.min(1.6, Math.max(0.7, Math.sqrt(2000 / area)));
  const achHeat = ((testedAch50 > 0 ? testedAch50 : ACH50[m.tightness]) / nFactor) * sizeFactor;
  const achCool = achHeat * SUMMER_ACH_SHARE;
  const infilCfmHeat = (achHeat * volume) / 60;
  const infilCfmCool = (achCool * volume) / 60;
  if (testedAch50 > 0) {
    const how = typeof m.blowerDoorCfm50 === "number" && m.blowerDoorCfm50 > 0 ? `${Math.round(m.blowerDoorCfm50).toLocaleString("en-US")} CFM50 over ${Math.round(volume).toLocaleString("en-US")} cu ft = ${testedAch50.toFixed(1)} ACH50` : `${testedAch50.toFixed(1)} ACH50 from the report`;
    assumptions.push(`Infiltration from the blower-door test (${how} ÷ ${nFactor}): ${achHeat.toFixed(2)} air changes an hour in winter, ${achCool.toFixed(2)} in summer — the Manual J Table 5A shape, where summer runs about half of winter.`);
  } else {
    assumptions.push(`Infiltration from a "${m.tightness}" blower-door class (${ACH50[m.tightness]} ACH50 ÷ ${nFactor}${sizeFactor !== 1 ? `, × ${sizeFactor.toFixed(2)} for the house's size` : ""}): ${achHeat.toFixed(2)} air changes an hour in winter, ${achCool.toFixed(2)} in summer — the Manual J Table 5A shape, where summer runs about half of winter.`);
  }
  // A tight house (2012 IECC and later, and every CA / WA / OR house) runs a
  // whole-house fan the code requires, and Manual J (Section 11) adds that
  // air to the load: ASHRAE 62.2, 0.03 CFM per sq ft plus 7.5 CFM per person.
  // Not on a ductless zone — one room does not carry the house's fan.
  // The contractor's answer about the fan wins (2026-10-08); the era rule
  // stands in only while nobody has said.
  const fanByRule = m.tightness === "tight" || m.tightness === "very-tight" || (m.yearBuilt ?? 0) >= 2012;
  const ventilated = !opts.zone && (typeof m.ventilationFan === "boolean" ? m.ventilationFan : fanByRule);
  // Air at altitude is thinner: the 1.1 / 0.68 constants are sea-level, and
  // Manual J's altitude correction (about 0.83 at 5,000 ft) scales them.
  const acf = Math.max(0.6, Math.pow(1 - 6.8754e-6 * Math.max(0, c.elevationFt ?? 0), 5.2559));
  const SENS = 1.1 * acf;
  const LAT = 0.68 * acf;

  const occupants = m.occupants > 0 ? m.occupants : 3;
  if (!(m.occupants > 0)) assumptions.push("Occupants assumed 3.");
  // One room or an addition carries no kitchen allowance unless it is the kitchen.
  const appliances = opts.zone ? 0 : APPLIANCE_SENSIBLE + (area > 2500 ? 600 : 0);
  if (opts.zone) assumptions.push("Zone load: no kitchen appliance allowance — add 1,200 BTU/h if the zone includes the kitchen.");
  const shade = SHADING_FACTOR[m.shading];
  const roofAdd = ROOF_COLOR_ADD[m.roofColor];

  const components: LoadComponent[] = [];
  const push = (name: string, h: number, cs: number, cl = 0) =>
    components.push({ name, heatingBtuh: round(h), coolingSensibleBtuh: round(cs), coolingLatentBtuh: round(cl) });

  // Windows: conduction both seasons, solar in summer by orientation.
  const shares = windowShares(m);
  let solar = 0;
  for (const s of shares) solar += windowSqft * s.share * s.gain * (win.shgc / REFERENCE_SHGC) * shade;
  push(`Windows · ${Math.round(windowSqft)} sq ft ${win.label}${glassMeasured ? "" : " (assumed)"}`, win.u * windowSqft * dtHeat, win.u * windowSqft * dtCool);
  if (!glassMeasured && !opts.zone) {
    // What 50 sq ft of glass is worth here, so the assumption reads as a lever.
    const avgGain = shares.reduce((a, s) => a + s.share * s.gain, 0) * (win.shgc / REFERENCE_SHGC) * shade;
    const per50 = Math.round((50 * (avgGain + win.u * dtCool)) / 100) * 100;
    assumptions.push(`Window area assumed at ${Math.round(m.windowToFloor * 100)}% of the floor (${Math.round(windowSqft)} sq ft, the era default) — count the windows or type the glass area: every 50 sq ft of glass is about ${per50.toLocaleString("en-US")} BTU/h of cooling here.`);
  }
  push(`Window solar · ${shares.map((s) => `${s.label} ${Math.round(s.share * 100)}%`).join(", ")}`, 0, solar);
  if (skylightSqft > 0) {
    // Flat glass in the roof: the highest sun of the day on it, no eave to shade it.
    const skyU = win.u * SKYLIGHT.uMul;
    push(`Skylights · ${Math.round(skylightSqft)} sq ft ${win.label}`, skyU * skylightSqft * dtHeat, skyU * skylightSqft * dtCool + skylightSqft * SKYLIGHT.solarGain * (win.shgc / REFERENCE_SHGC));
  }
  push(`Doors · ${doorSqft} sq ft, ${doorCount} ${door.label}`, door.u * doorSqft * dtHeat, door.u * doorSqft * (dtCool + 8));
  push(`Walls · ${Math.round(netWall)} sq ft net, ${m.wallInsulation === "none" ? "uninsulated" : m.wallInsulation.toUpperCase()}, ${build.label}, ${siding} siding`, wallU * netWall * dtHeat, wallU * netWall * (dtCool + wallCoolAdd));
  const ceilingSqft = Math.max(0, footprint - skylightSqft);
  push(`Ceiling · ${Math.round(ceilingSqft)} sq ft under ${m.ceilingInsulation === "none" ? "an uninsulated attic" : m.ceilingInsulation.toUpperCase() + " attic"}, ${m.roofColor} roof`, ceilU * ceilingSqft * dtHeat, ceilU * ceilingSqft * (dtCool + roofAdd));
  push(`Floor · ${floor.label}`, floorUA * dtHeat, floor.coolingShare * floorUA * dtCool);
  const grains = Math.max(0, c.grainsDiff);
  push(`Infiltration · ${Math.round(infilCfmHeat)} CFM winter / ${Math.round(infilCfmCool)} CFM summer`, SENS * infilCfmHeat * dtHeat, SENS * infilCfmCool * dtCool, LAT * infilCfmCool * grains);
  const ventCfm = ventilated ? 0.03 * area + 7.5 * (m.occupants > 0 ? m.occupants : 3) : 0;
  if (ventCfm > 0) {
    push(`Ventilation · ${Math.round(ventCfm)} CFM (ASHRAE 62.2 whole-house fan)`, SENS * ventCfm * dtHeat, SENS * ventCfm * dtCool, LAT * ventCfm * grains);
    assumptions.push(typeof m.ventilationFan === "boolean"
      ? `Mechanical ventilation ${Math.round(ventCfm)} CFM (ASHRAE 62.2: 0.03 CFM/sq ft + 7.5 CFM per person) is in the load — the house has a whole-house fan.`
      : `Mechanical ventilation ${Math.round(ventCfm)} CFM (ASHRAE 62.2: 0.03 CFM/sq ft + 7.5 CFM per person) is in the load — a tight house runs its whole-house fan. Set "Whole-house ventilation fan" to No if the house has none.`);
  }
  if (!opts.zone && m.ventilationFan === false && fanByRule) assumptions.push("No whole-house ventilation fan, as answered — no ventilation load, although the era rule would have added one.");
  if (acf < 0.97) assumptions.push(`Air at ${Math.round(c.elevationFt ?? 0).toLocaleString("en-US")} ft is ${Math.round((1 - acf) * 100)}% thinner: infiltration and ventilation loads carry Manual J's altitude factor ${acf.toFixed(2)}.`);
  push(`People and appliances · ${occupants} occupants`, 0, occupants * OCCUPANT_SENSIBLE + appliances, occupants * OCCUPANT_LATENT);

  let heat = components.reduce((a, k) => a + k.heatingBtuh, 0);
  let sens = components.reduce((a, k) => a + k.coolingSensibleBtuh, 0);
  let lat = components.reduce((a, k) => a + k.coolingLatentBtuh, 0);

  // Ducts outside the envelope lose in winter and gain in summer.
  const duct = DUCT[m.ducts.location] ?? DUCT.none;
  let ductHeat = duct.heating;
  let ductCool = duct.cooling;
  // A duct-leakage test (2026-10-18): leakage to outside as a share of the
  // system's airflow (the load's own tons at the climate's CFM a ton), against
  // the typical share the table stands for. Half the duct figure is
  // conduction, which no leak test moves; the condition guess stands aside.
  const leak = typeof m.ducts.leakageCfm25 === "number" && m.ducts.leakageCfm25 >= 0 && m.ducts.location !== "conditioned" && m.ducts.location !== "none" ? m.ducts.leakageCfm25 : null;
  if (m.ducts.location !== "conditioned" && m.ducts.location !== "none") {
    if (leak !== null) {
      const systemCfm = Math.max(200, ((sens + lat) / 12000) * CFM_PER_TON[c.humidity]);
      const share = leak / systemCfm;
      const scale = Math.min(2.5, Math.max(0.5, 0.5 + (0.5 * share) / DUCT_LEAK_TYPICAL));
      ductHeat *= scale;
      ductCool *= scale;
      assumptions.push(`Duct leakage tested at ${Math.round(leak)} CFM25 to outside — ${Math.round(share * 100)}% of the system's ~${Math.round(systemCfm / 10) * 10} CFM against the ${Math.round(DUCT_LEAK_TYPICAL * 100)}% the duct figures assume, so the duct loss and gain are × ${scale.toFixed(2)}.`);
    } else if (m.ducts.condition === "poor") { ductHeat *= 1.5; ductCool *= 1.5; }
    if (m.ducts.insulated === false) { ductHeat *= 1.5; ductCool *= 1.5; }
    push(`Ducts in the ${m.ducts.location}${leak !== null ? `, ${Math.round(leak)} CFM25 leakage tested` : m.ducts.condition === "poor" ? ", poor condition" : ""}${m.ducts.insulated === false ? ", uninsulated" : ""}`, heat * ductHeat, sens * ductCool, lat * ductCool);
    heat *= 1 + ductHeat;
    sens *= 1 + ductCool;
    lat *= 1 + ductCool;
  }

  const heatingBtuh = round500(heat);
  const coolingSensibleBtuh = round500(sens);
  const coolingLatentBtuh = round500(lat);
  const coolingTotalBtuh = coolingSensibleBtuh + coolingLatentBtuh;
  const coolingTons = round(coolingTotalBtuh / 12000, 2);
  const sensibleHeatRatio = coolingTotalBtuh > 0 ? round(coolingSensibleBtuh / coolingTotalBtuh, 2) : 1;
  // Design airflow is the climate's CFM per ton on the load's tons — the number
  // the return check and the hero use; the sensible/ΔT form is kept for the
  // supply-temperature note only.
  const coolingCfm = Math.round(((coolingTotalBtuh / 12000) * CFM_PER_TON[c.humidity]) / 10) * 10;
  void SUPPLY_DT_F;
  assumptions.push(`Indoor design ${INDOOR_COOLING_F} °F cooling / ${INDOOR_HEATING_F} °F heating; outdoor ${c.coolingF} °F / ${c.heatingF} °F for ${c.county}, ${c.state} (${c.source}).`);
  assumptions.push(`Moisture at the cooling design taken as "${c.humidity}" climate (${c.grainsDiff} grains).`);
  if (m.ducts.location !== "conditioned" && m.ducts.location !== "none") {
    assumptions.push(`Duct loss ${Math.round(ductHeat * 100)}% heating / gain ${Math.round(ductCool * 100)}% cooling for ducts in the ${m.ducts.location}.`);
  }

  return {
    heatingBtuh,
    coolingSensibleBtuh,
    coolingLatentBtuh,
    coolingTotalBtuh,
    coolingTons,
    sensibleHeatRatio,
    coolingCfm,
    cfmPerTon: CFM_PER_TON[c.humidity],
    components,
    assumptions,
    deltaTCooling: dtCool,
    deltaTHeating: dtHeat,
    ductLossHeating: round(ductHeat, 3),
    ductGainCooling: round(ductCool, 3),
  };
}

/** The house's heating load at any outdoor temperature: straight from zero
 *  at 65 °F to the design load at the 99% temperature. */
export function heatingLoadAt(load: LoadResult, c: DesignConditions, outdoorF: number): number {
  const span = 65 - c.heatingF;
  if (span <= 0) return 0;
  return Math.max(0, (load.heatingBtuh * (65 - outdoorF)) / span);
}

/** What moves this number most — the load re-run with the three things a
 *  contractor can still change or measure, so the assumption list reads as
 *  levers, not caveats (2026-10-14, after "bad sizing" from the field). */
export function loadLevers(m: BuildingModel, c: DesignConditions): string[] {
  const base = computeBlockLoad(m, c);
  const out: string[] = [];
  const k = (n: number) => `${Math.abs(n) >= 1000 ? (Math.abs(n) / 1000).toFixed(1) + "k" : String(Math.abs(n))} BTU/h`;
  const side = glassBySide(m);
  const glass = side ? side.total : typeof m.windowSqft === "number" && m.windowSqft > 0 ? m.windowSqft : m.conditionedSqft * m.windowToFloor;
  const moreGlass = computeBlockLoad(side ? { ...m, glassNorthSqft: side.N * 1.25, glassEastSqft: side.E * 1.25, glassSouthSqft: side.S * 1.25, glassWestSqft: side.W * 1.25 } : { ...m, windowSqft: glass * 1.25 }, c);
  if (moreGlass.coolingTotalBtuh !== base.coolingTotalBtuh) out.push(`a quarter more glass than assumed adds ${k(moreGlass.coolingTotalBtuh - base.coolingTotalBtuh)} of cooling`);
  if (m.ducts.location !== "conditioned" && m.ducts.location !== "none") {
    const inside = computeBlockLoad({ ...m, ducts: { ...m.ducts, location: "conditioned" } }, c);
    out.push(`ducts in the ${m.ducts.location} carry ${k(base.coolingTotalBtuh - inside.coolingTotalBtuh)} of cooling and ${k(base.heatingBtuh - inside.heatingBtuh)} of heating that ducts inside the envelope would not`);
  }
  const tighter: Record<string, BuildingModel["tightness"] | undefined> = { leaky: "average", average: "tight", tight: "very-tight", "very-tight": undefined };
  const tested = (typeof m.blowerDoorCfm50 === "number" && m.blowerDoorCfm50 > 0) || (typeof m.blowerDoorAch50 === "number" && m.blowerDoorAch50 > 0);
  const next = tested ? undefined : tighter[m.tightness];
  if (next) {
    const t = computeBlockLoad({ ...m, tightness: next }, c);
    out.push(`one tightness class better ("${next}") takes off ${k(base.heatingBtuh - t.heatingBtuh)} of heating and ${k(base.coolingTotalBtuh - t.coolingTotalBtuh)} of cooling`);
  }
  return out.length ? [`What moves this number most: ${out.join("; ")}.`] : [];
}
