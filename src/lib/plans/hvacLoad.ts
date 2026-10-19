// THE HEATING & COOLING LOAD FROM THE PLANS (owner, 2026-10-18: "make sure the blueprint estimator can estimate
// HVAC Manual J based — make it smart, blueprints have the windows' sizes and the rest"). Pure: the envelope the
// plans specify (lib/plans/hvacEnvelope) becomes the HVAC engine's building model (lib/hvac/types), the engine's
// Manual J-style block load runs on it at the county's design temperatures (lib/hvac/load), and the equipment is
// sized the Manual S way on the engine's catalog (lib/hvac/select). Every value says where it came from: the plans
// (with their pages) or an assumption — a new house built to the energy code where the plans are silent.
//
// It is the engine's estimating-grade block load, not an ACCA-approved Manual J report: the permit's report is
// still the contractor's (the build list keeps its "Load calculation (Manual J/S/D)" line).
import { computeBlockLoad, ENGINE_VERSION, loadLevers } from "@/lib/hvac/load";
import { selectSystem } from "@/lib/hvac/select";
import { US_CATALOG } from "@/lib/hvac/data/usCatalog";
import type { BuildingModel, CatalogItem, CeilingInsulation, DesignConditions, DuctLocation, Foundation, ProvenanceMap, RoofColor, SidingColor, WallConstruction, WallInsulation, WindowType } from "@/lib/hvac/types";
import type { PlanEnvelope, PlanHvacLoad, PlanLoadInput } from "./hvacEnvelope";
import type { Compass, FacadeName } from "./sheet";

export type PlanPlace = { state: string; county: string | null; lat?: number; lng?: number; elevationFt?: number; label: string };

const getPath = (o: unknown, path: string): unknown => path.split(".").reduce<unknown>((a, k) => (a && typeof a === "object" ? (a as Record<string, unknown>)[k] : undefined), o);
function setPath(o: Record<string, unknown>, path: string, v: unknown): void {
  const [head, field] = path.split(".");
  if (!field) o[head] = v;
  else if (o[head] && typeof o[head] === "object") (o[head] as Record<string, unknown>)[field] = v;
}

/** THE HVAC ESTIMATOR'S "FROM THE PLANS" (2026-10-18, owner: "add the option to estimate blueprints in the HVAC
 *  estimator"): the plans' house laid over the estimator's model. What the plans say goes in, marked "plan"; a new
 *  house's code default goes in, still marked a default, only where the model holds nothing better than its own. Whatever the
 *  contractor types afterwards still wins (it is applied after this). Returns what the plans said, for the page. */
export function applyPlansToModel(m: BuildingModel, env: PlanEnvelope, c: DesignConditions): PlanLoadInput[] {
  const place: PlanPlace = { state: m.state, county: m.county ?? null, lat: m.lat, lng: m.lng, elevationFt: m.elevationFt, label: m.county ? `${m.county}, ${m.state}` : m.state };
  const { model: pm, inputs, origin } = planBuildingModel(env, place, c);
  for (const [path, from] of Object.entries(origin)) {
    const was = m.provenance[path];
    if (from === "assumed" && was && was.source !== "default") continue;
    const v = getPath(pm, path);
    if (v === undefined) continue;
    setPath(m as unknown as Record<string, unknown>, path, v);
    // An assumption stays a default (its chip says so, and the engine's defaulted-fields check still lists it).
    m.provenance[path] = from === "plans" ? { source: "plan", confidence: "high", note: "the plans" } : { source: "default", confidence: "low", note: "a new house built to the energy code — the plans do not say" };
  }
  return inputs;
}

const n = (v: number) => Math.round(v).toLocaleString("en-US");
const r1 = (v: number) => Math.round(v * 10) / 10;

/** A rough opening's glass, sq ft. A window with no size on the plans counts as a 3' × 5' (15 sq ft). */
const openingSqft = (w: { widthIn: number | null; heightIn: number | null; count: number }) => (w.widthIn && w.heightIn ? (w.widthIn * w.heightIn) / 144 : 15) * Math.max(0, w.count);
const isSkylight = (t: string | null) => /sky\s?light|roof window|sun\s?tunnel/i.test(t ?? "");
const isGlassDoor = (t: string | null) => /slid|patio|french|glass|s\.?g\.?d|\bg\.?d\b|multi-?slide|bi-?fold/i.test(t ?? "");

/** The plans' glass, counted once for the model and the page: windows and glass doors at their sizes, skylights apart. */
export function planGlass(env: Pick<PlanEnvelope, "windows" | "doors">) {
  const windows = env.windows.filter((w) => !isSkylight(w.type));
  const glassDoors = env.doors.filter((d) => isGlassDoor(d.type));
  const windowGlass = windows.reduce((a, w) => a + openingSqft(w), 0);
  const doorGlass = glassDoors.reduce((a, d) => a + openingSqft(d), 0);
  return {
    windowCount: windows.reduce((a, w) => a + w.count, 0),
    glassDoorCount: glassDoors.reduce((a, d) => a + d.count, 0),
    opaqueDoorCount: env.doors.filter((d) => !isGlassDoor(d.type)).reduce((a, d) => a + Math.max(0, d.count), 0),
    unsized: env.windows.filter((w) => !(w.widthIn && w.heightIn)).reduce((a, w) => a + w.count, 0),
    /** Windows + glass doors, sq ft (one decimal). */
    totalSqft: r1(windowGlass + doorGlass),
    skylightSqft: env.windows.filter((w) => isSkylight(w.type)).reduce((a, w) => a + openingSqft(w), 0),
  };
}

/** R-value → the engine's wall class (the nearest one at or under it). */
export function wallClass(r: number): WallInsulation {
  return r >= 20 ? "r21" : r >= 17 ? "r19" : r >= 12 ? "r13" : r >= 9 ? "r11" : "none";
}
export function ceilingClass(r: number): CeilingInsulation {
  return r >= 45 ? "r49" : r >= 34 ? "r38" : r >= 25 ? "r30" : r >= 15 ? "r19" : r >= 9 ? "r11" : "none";
}
/** A window U-factor → the engine's window class. */
export function windowClass(u: number): WindowType {
  return u <= 0.22 ? "triple" : u <= 0.35 ? "double-lowe" : u <= 0.55 ? "double" : "single";
}

const BEARING: Record<Compass, number> = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };
const POINTS: Compass[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
/** An elevation named front / rear / left / right, turned into a compass point by the way the front faces. The
 *  left elevation is the side on your left as you face the front: a front facing south puts it on the west. */
export function facadeCompass(f: FacadeName, front: Compass | null): Compass | null {
  if ((POINTS as string[]).includes(f)) return f as Compass;
  if (!front) return null;
  const turn = f === "front" ? 0 : f === "rear" ? 180 : f === "left" ? 90 : -90;
  return POINTS[Math.round((((BEARING[front] + turn) % 360) + 360) % 360 / 45) % 8];
}

/** The glass on each elevation, put on the engine's four sides (a north-east face half north, half east), scaled to
 *  the schedule's total when there is one — the schedule counts every window, an elevation shows its face. */
export function glassBySideFromPlans(env: PlanEnvelope, scheduleTotal: number): { N: number; E: number; S: number; W: number } | null {
  const sides = { N: 0, E: 0, S: 0, W: 0 };
  let placed = 0;
  for (const f of env.facades) {
    const c = facadeCompass(f.facing, env.frontFaces);
    const glass = f.glassSqFt ?? (f.windows ? f.windows * 15 : 0);
    if (!c || !(glass > 0)) continue;
    const parts = c.length === 1 ? [c] : [c[0], c[1]];
    for (const p of parts) sides[p as "N" | "E" | "S" | "W"] += glass / parts.length;
    placed += glass;
  }
  if (!(placed > 0)) return null;
  const scale = scheduleTotal > 0 ? scheduleTotal / placed : 1;
  return { N: r1(sides.N * scale), E: r1(sides.E * scale), S: r1(sides.S * scale), W: r1(sides.W * scale) };
}

/** The notes cut at commas, semicolons and "and": "R-49 attic, R-38 vaulted, R-21 walls" is three statements, and the
 *  walls' R-value is the one beside the word "walls" — never the first R-value of the note. */
const noteParts = (notes: string[]) => notes.flatMap((t) => t.split(/[,;]|\band\b/i)).map((t) => t.trim()).filter(Boolean);
/** An R-value the plans' notes give a part of the house ("R-21 walls", "attic R-49"), when the energy table gave none. */
export function noteR(notes: string[], part: RegExp): number | null {
  for (const t of noteParts(notes)) {
    if (!part.test(t)) continue;
    const m = t.toUpperCase().replace(/\s+/g, "").match(/R-?(\d{1,2}(?:\.\d)?)(?:\+R?-?(\d{1,2}))?/);
    if (m) return Number(m[1]) + (m[2] ? Number(m[2]) : 0);
  }
  return null;
}
/** A window U-factor in the notes ("U-0.27 windows"). */
export function noteU(notes: string[]): number | null {
  for (const t of noteParts(notes)) {
    if (!/window|glaz|fenestration/i.test(t)) continue;
    const m = t.match(/U-?\s?(?:factor\s?)?(0?\.\d{1,3})/i);
    if (m) return Number(m[1]);
  }
  return null;
}

/** The plans' house as the engine's building model, and every input as the page shows it. */
/** Where each field the plans fill came from: the plans themselves, or a new house's code default where they are silent. */
export type PlanOrigin = Record<string, "plans" | "assumed">;

export function planBuildingModel(env: PlanEnvelope, place: PlanPlace, c: DesignConditions): { model: BuildingModel; inputs: PlanLoadInput[]; origin: PlanOrigin } {
  const inputs: PlanLoadInput[] = [];
  const said = (label: string, value: string, pages?: number[]) => inputs.push({ label, value, from: "plans", ...(pages?.length ? { pages } : {}) });
  const assumed = (label: string, value: string) => inputs.push({ label, value, from: "assumed" });
  const provenance: ProvenanceMap = {};
  const mark = (path: string, plan: boolean, note: string) => (provenance[path] = { source: plan ? "plan" : "default", confidence: plan ? "medium" : "low", note });
  const cold = c.heatingF < 38; // IECC climate zones 3–8 by the design heating temperature, near enough for the code defaults

  // The conditioned floors and their heights.
  const basementConditioned = env.foundation === "basement" && env.levels.some((l) => l.name === "Basement");
  const conditioned = env.levels.filter((l) => l.name !== "Basement" || basementConditioned);
  const above = env.levels.filter((l) => l.name !== "Basement");
  const storeys = Math.max(1, above.length);
  const areaSum = conditioned.reduce((a, l) => a + l.areaSqFt, 0) || env.livingSqFt;
  const ceiling = conditioned.length ? conditioned.reduce((a, l) => a + l.plateFt * l.areaSqFt, 0) / Math.max(1, areaSum) : 8;
  const ground = env.levels.find((l) => l.name === "Main") ?? above[0] ?? env.levels[0];
  said("Conditioned area", `${n(env.livingSqFt)} sq ft · ${storeys} ${storeys === 1 ? "storey" : "storeys"}${basementConditioned ? " + a finished basement" : ""} · ${r1(ceiling)} ft ceilings`, conditioned.flatMap((l) => l.pages));
  mark("conditionedSqft", true, "the plans' floor areas");

  // The glass: every window and glass door off the schedule or the plans; skylights apart.
  const g = planGlass(env);
  const { windowCount, unsized } = g;
  const skylight = g.skylightSqft;
  const opaqueDoors = g.opaqueDoorCount;
  const scheduleTotal = g.totalSqft;
  const sides = glassBySideFromPlans(env, scheduleTotal);
  if (scheduleTotal > 0) said("Glass", `${n(scheduleTotal)} sq ft — ${windowCount} window${windowCount === 1 ? "" : "s"}${g.glassDoorCount ? ` and ${g.glassDoorCount} glass door${g.glassDoorCount === 1 ? "" : "s"}` : ""} at their sizes${unsized ? ` (${unsized} with no size counted as 3' × 5')` : ""}`, env.pages.windows);
  else if (sides) said("Glass", `${n((sides.N + sides.E + sides.S + sides.W))} sq ft on the elevations`, env.pages.facades);
  else assumed("Glass", `15% of the floor area (${n(env.livingSqFt * 0.15)} sq ft) — no window sizes were read`);
  if (sides) said("Glass by side", `north ${n(sides.N)} · east ${n(sides.E)} · south ${n(sides.S)} · west ${n(sides.W)} sq ft`, [...env.pages.facades, ...env.pages.site]);
  else if (env.facades.length && !env.frontFaces) assumed("Glass by side", "spread around the walls — the elevations are named front / rear / left / right and no site plan says which way the front faces");
  else assumed("Glass by side", "spread around the walls — no elevation glass was read");
  if (skylight > 0) said("Skylights", `${n(skylight)} sq ft`, env.pages.windows);
  mark("windowSqft", scheduleTotal > 0 || !!sides, scheduleTotal > 0 ? "the window and door schedule" : "the elevations");

  // The windows' rating.
  const e = env.energy;
  const windowU = e?.windowU ?? noteU(env.notes);
  const windowType: WindowType = windowU ? windowClass(windowU) : "double-lowe";
  if (windowU) said("Windows", `U-${windowU}${e?.windowShgc ? ` · SHGC ${e.windowShgc}` : ""} → ${windowType === "double-lowe" ? "double low-e" : windowType}`, env.pages.energy);
  else assumed("Windows", "double-pane low-e — the energy code's minimum for a new house");
  mark("windowType", !!windowU, windowU ? `U-${windowU}` : "new-house default");

  // Walls and ceiling.
  const wallR = e?.wallR ?? noteR(env.notes, /\bwalls?\b/i);
  const ceilR = e?.ceilingR ?? noteR(env.notes, /ceiling|attic/i);
  const wallInsulation: WallInsulation = wallR ? wallClass(wallR) : cold ? "r21" : "r13";
  const ceilingInsulation: CeilingInsulation = ceilR ? ceilingClass(ceilR) : cold ? "r49" : "r38";
  if (wallR) said("Walls", `R-${wallR}${env.exteriorFraming ? ` · ${env.exteriorFraming}` : ""}`, env.pages.energy);
  else assumed("Walls", `R-${cold ? "20/21" : "13"} — the energy code for this climate${env.exteriorFraming ? ` · ${env.exteriorFraming}` : ""}`);
  if (ceilR) said("Ceiling", `R-${ceilR}`, env.pages.energy);
  else assumed("Ceiling", `R-${cold ? 49 : 38} — the energy code for this climate`);
  mark("wallInsulation", !!wallR, wallR ? `R-${wallR}` : "energy code default");
  mark("ceilingInsulation", !!ceilR, ceilR ? `R-${ceilR}` : "energy code default");

  // The floor.
  const sealedCrawl = env.notes.some((t) => /sealed crawl|unvented crawl|conditioned crawl|encapsulat/i.test(t));
  const foundation: Foundation = env.foundation === "slab" ? "slab" : env.foundation === "basement" ? (basementConditioned ? "basement-conditioned" : "basement-unconditioned") : sealedCrawl ? "crawl-sealed" : "crawl-vented";
  said("Foundation", { slab: "slab on grade", "crawl-vented": "vented crawlspace", "crawl-sealed": "sealed crawlspace", "basement-conditioned": "conditioned basement", "basement-unconditioned": "unconditioned basement" }[foundation]);

  // Air tightness: the plans' blower-door target, else the code's for a new house.
  const ach50 = e?.ach50 ?? (cold ? 3 : 5);
  if (e?.ach50) said("Air tightness", `${e.ach50} ACH50 — the plans' blower-door target`, env.pages.energy);
  else assumed("Air tightness", `${ach50} ACH50 — the energy code's limit for a new house in this climate`);

  // The ducts.
  const ductLocation: DuctLocation = e?.ductLocation ?? (env.foundation === "basement" ? (basementConditioned ? "conditioned" : "basement") : env.foundation === "crawlspace" ? "crawl" : "attic");
  const ductWords = { conditioned: "inside the conditioned space", attic: "in the attic", crawl: "in the crawlspace", basement: "in the basement", none: "none" }[ductLocation];
  if (e?.ductLocation) said("Ducts", `${ductWords}${e.ductLeakage ? ` · leakage held to ${e.ductLeakage} CFM25 per 100 sq ft` : ""}`, env.pages.energy);
  else assumed("Ducts", `${ductWords} — where a ${env.foundation === "slab" ? "slab" : env.foundation} house usually runs them; sealed and insulated to code`);

  // Doors, the roof, the walls' build and colour, the people.
  const doorCount = opaqueDoors || 2;
  if (opaqueDoors) said("Exterior doors", `${opaqueDoors} insulated door${opaqueDoors === 1 ? "" : "s"}`);
  else assumed("Exterior doors", "2 insulated doors");
  const roofText = `${env.roof.material ?? ""}`.toLowerCase();
  const roofColor: RoofColor = /white|light|cool roof|reflective|tan|silver/.test(roofText) ? "light" : /black|dark|charcoal/.test(roofText) ? "dark" : "medium";
  const build = `${env.siding ?? ""} ${env.exteriorFraming ?? ""}`.toLowerCase();
  const wallConstruction: WallConstruction = /\bicf\b|\bsip\b/.test(build) ? "sip-icf" : /\bcmu\b|block|masonry|concrete wall|poured/.test(build) ? "masonry" : /brick/.test(build) ? "brick-veneer" : "wood-frame";
  const sidingColor: SidingColor = /white|light|cream|ivory/.test(build) ? "light" : /black|dark|charcoal|navy/.test(build) ? "dark" : "medium";
  const occupants = Math.max(2, env.bedrooms + 1);
  said("People", `${occupants} — ${env.bedrooms} bedroom${env.bedrooms === 1 ? "" : "s"} + 1, the Manual J rule`);

  const model: BuildingModel = {
    address: place.label,
    state: place.state,
    county: place.county ?? undefined,
    lat: place.lat,
    lng: place.lng,
    elevationFt: place.elevationFt,
    conditionedSqft: Math.max(200, env.livingSqFt),
    storeys,
    ceilingHeightFt: r1(ceiling),
    yearBuilt: new Date().getFullYear(),
    perimeterFt: ground?.perimeterLf || undefined,
    windowToFloor: 0.15,
    ...(scheduleTotal > 0 ? { windowSqft: scheduleTotal } : {}),
    ...(sides ? { glassNorthSqft: sides.N, glassEastSqft: sides.E, glassSouthSqft: sides.S, glassWestSqft: sides.W } : {}),
    ...(skylight > 0 ? { skylightSqft: r1(skylight) } : {}),
    windowType,
    wallInsulation,
    ceilingInsulation,
    foundation,
    tightness: ach50 <= 3 ? "very-tight" : "tight",
    blowerDoorAch50: ach50,
    roofColor,
    shading: env.roof.overhangIn >= 18 ? "some" : "none",
    occupants,
    doorCount,
    doorType: "insulated",
    wallConstruction,
    sidingColor,
    ventilationFan: true,
    existing: { kind: "none" },
    electrical: {},
    ducts: { location: ductLocation, condition: "good", insulated: true },
    gas: { available: !env.heatPump },
    preferences: { allElectric: env.heatPump },
    provenance,
  };
  // What the plans said, field by field, and what a code default filled (the HVAC estimator lays the first over its
  // model and the second only where nothing better is known — applyPlansToModel).
  const origin: PlanOrigin = {
    conditionedSqft: "plans",
    storeys: "plans",
    ceilingHeightFt: "plans",
    ...(ground?.perimeterLf ? { perimeterFt: "plans" as const } : {}),
    ...(scheduleTotal > 0 ? { windowSqft: "plans" as const } : {}),
    ...(sides ? { glassNorthSqft: "plans" as const, glassEastSqft: "plans" as const, glassSouthSqft: "plans" as const, glassWestSqft: "plans" as const } : {}),
    ...(skylight > 0 ? { skylightSqft: "plans" as const } : {}),
    windowType: windowU ? "plans" : "assumed",
    wallInsulation: wallR ? "plans" : "assumed",
    ceilingInsulation: ceilR ? "plans" : "assumed",
    foundation: "plans",
    tightness: e?.ach50 ? "plans" : "assumed",
    blowerDoorAch50: e?.ach50 ? "plans" : "assumed",
    "ducts.location": e?.ductLocation ? "plans" : "assumed",
    doorCount: opaqueDoors ? "plans" : "assumed",
    doorType: "assumed",
    occupants: "plans",
    wallConstruction: wallConstruction !== "wood-frame" || env.exteriorFraming ? "plans" : "assumed",
    roofColor: roofColor !== "medium" ? "plans" : "assumed",
    sidingColor: sidingColor !== "medium" ? "plans" : "assumed",
    shading: "assumed",
    yearBuilt: "assumed",
    ventilationFan: "assumed",
    "gas.available": env.stated.system ? "plans" : "assumed",
    "preferences.allElectric": env.stated.system ? "plans" : "assumed",
  };
  return { model, inputs, origin };
}

const STRIP_KW = [5, 8, 10, 15, 20];
const FURNACE_INPUT = [40000, 60000, 80000, 100000, 120000];

/** Run it: the load, then the equipment it calls for. `catalog` defaults to the engine's US catalog. */
export function planHvacLoad(env: PlanEnvelope, place: PlanPlace, c: DesignConditions, opts: { match: PlanHvacLoad["climate"]["match"]; catalog?: CatalogItem[] }): PlanHvacLoad {
  const { model, inputs } = planBuildingModel(env, place, c);
  const load = computeBlockLoad(model, c);
  const levers = loadLevers(model, c);
  const catalog = opts.catalog ?? US_CATALOG;
  const heatPump = env.heatPump;
  // The plans draw two (or more) outdoor units: each system is sized on its share of the house's load.
  const drawn = env.stated.systems && env.stated.systems > 1 ? Math.round(env.stated.systems) : 1;
  const share = (x: number) => Math.round(x / drawn);
  const perSystem = drawn > 1 ? { ...load, heatingBtuh: share(load.heatingBtuh), coolingSensibleBtuh: share(load.coolingSensibleBtuh), coolingLatentBtuh: share(load.coolingLatentBtuh), coolingTotalBtuh: share(load.coolingTotalBtuh), coolingTons: load.coolingTons / drawn, coolingCfm: share(load.coolingCfm) } : load;
  const sel = selectSystem(catalog, perSystem, c, model, { kinds: heatPump ? ["heat-pump"] : ["air-conditioner"], wantsHeatPump: heatPump });
  const systems = Math.max(drawn, sel.systems * drawn);
  const tons = sel.chosen?.item.tons ?? Math.max(1.5, sel.targetTons / Math.max(1, sel.systems));
  const backupNeed = heatPump ? sel.chosen?.backupKw ?? Math.max(0, (load.heatingBtuh / systems - tons * 12000 * 0.6) / 3412) : null;
  const backupKw = backupNeed == null ? null : STRIP_KW.find((k) => k >= backupNeed) ?? STRIP_KW[STRIP_KW.length - 1];
  const perSystemHeat = load.heatingBtuh / systems;
  const furnaceInputBtu = heatPump ? null : FURNACE_INPUT.find((x) => x * 0.96 >= perSystemHeat) ?? FURNACE_INPUT[FURNACE_INPUT.length - 1];
  const ratio = load.coolingTotalBtuh > 0 ? Math.round(((tons * systems * 12000) / load.coolingTotalBtuh) * 100) : null;
  // What Manual S says about that ratio, in words: 90–115% of the cooling load, or above it for a heat pump that
  // carries more of the heat where heating governs (up to 125%, 135% for variable speed).
  const fit = ratio === null ? "" : ratio >= 90 && ratio <= 115 ? ", inside Manual S's 90–115%" : heatPump && ratio > 115 ? ", sized up to carry more of the heat — Manual S lets a heat pump run to 125% (135% variable-speed) where heating governs" : ratio < 90 ? ", under Manual S's 90% — the smallest size the catalog has near it" : ", over Manual S's 115% — the nearest size the catalog has";
  const each = drawn > 1 ? ` (the plans draw ${drawn} systems, each sized on its share)` : "";
  const note = heatPump
    ? `${systems > 1 ? `${systems} heat pumps of ${tons} tons` : `A ${tons}-ton heat pump`} — ${ratio ?? "—"}% of the cooling load${fit}${each}${sel.chosen?.heatAtDesignBtuh ? `; it still makes ${n(sel.chosen.heatAtDesignBtuh)} Btu/h at ${c.heatingF} °F` : ""}${backupKw ? `, with ${backupKw} kW of backup heat for the coldest days` : ""}.`
    : `${systems > 1 ? `${systems} systems of ${tons} tons` : `A ${tons}-ton air conditioner`} — ${ratio ?? "—"}% of the cooling load${fit}${each} — on a ${n(furnaceInputBtu ?? 0)} Btu/h furnace${systems > 1 ? " each" : ""} (96% AFUE covers the ${n(perSystemHeat)} Btu/h heating load).`;
  const plansWords = (a: string) =>
    a
      .replace(/Glass by side as typed/, "Glass by side from the plans")
      .replace(/the [\d,]+ sq ft typed as the window area stands aside/, "the schedule's total spread the same way")
      .replace(/Infiltration from the blower-door test \(([\d.]+) ACH50 from the report ÷ (\d+)\)/, "Infiltration from the $1 ACH50 air-leakage target (÷ $2)");
  const comps = load.components
    .map((x) => ({ name: x.name, heatingBtuh: Math.round(x.heatingBtuh), coolingBtuh: Math.round(x.coolingSensibleBtuh + x.coolingLatentBtuh) }))
    .sort((a, b) => b.coolingBtuh + b.heatingBtuh - (a.coolingBtuh + a.heatingBtuh))
    .slice(0, 8);
  // The design temperatures go first among the inputs: they set every number after them.
  inputs.unshift({ label: "Design temperatures", value: `${c.coolingF} °F cooling · ${c.heatingF} °F heating · ${place.label}${opts.match === "state" ? " (state median — the county was not found)" : opts.match === "none" ? " (national default — the state was not found)" : ""}`, from: opts.match === "county" || opts.match === "fuzzy" ? "plans" : "assumed" });
  return {
    heatingBtuh: load.heatingBtuh,
    coolingTotalBtuh: load.coolingTotalBtuh,
    coolingSensibleBtuh: load.coolingSensibleBtuh,
    coolingLatentBtuh: load.coolingLatentBtuh,
    loadTons: Math.round((load.coolingTotalBtuh / 12000) * 100) / 100,
    coolingCfm: load.coolingCfm,
    system: { heatPump, tons, systems, backupKw, heatAtDesignBtuh: sel.chosen?.heatAtDesignBtuh ?? null, furnaceInputBtu, note },
    climate: { place: place.label, coolingF: c.coolingF, heatingF: c.heatingF, source: c.source, match: opts.match },
    inputs,
    components: comps,
    assumptions: load.assumptions.map(plansWords),
    levers,
    engine: ENGINE_VERSION,
  };
}
