// THE TAKEOFF — every sheet the model read, merged into one house, and the quantities
// each trade prices from. Pure, deterministic, and auditable: the model only READS the
// plans (lib/plans/sheet); every quantity here is arithmetic on what it read, and each
// one says where it came from:
//
//   plan     — written on the plans (a schedule count, a stated area, a room size)
//   derived  — computed from what the plans state (wall area = perimeter × plate height)
//   rule     — a trade rule of thumb where the plans are silent (receptacles per NEC 210.52
//              spacing, roof overhang when none is drawn) — always flagged, never hidden
//
// The contractor sees and edits every item before anything is priced.
import { pitchOf, round } from "./dims";
import { levelName, type Compass, type PlanEnergy, type PlanFacade, type PlanOpening, type PlanRoom, type SheetRead } from "./sheet";
import type { PlanHvacLoad } from "./hvacEnvelope";
import { isBath, isGarage, isKitchen, isOverheadDoor, isPorch, isStairOrHall, isVoid, roomPerimeter, roomWeight } from "./rooms";
import { addAssemblies } from "./assemblies";
import type { Measured } from "./ask";

export const PLAN_TRADES = [
  "general", "sitework", "foundation", "framing", "roofing", "gutters", "windows-doors", "siding",
  "insulation", "drywall", "interior-trim", "flooring", "tile", "cabinets", "painting",
  "plumbing", "electrical", "hvac",
] as const;
export type PlanTrade = (typeof PLAN_TRADES)[number];

export const TRADE_LABEL: Record<PlanTrade, string> = {
  general: "General conditions & permits",
  sitework: "Site work & excavation",
  foundation: "Foundation & concrete",
  framing: "Framing & sheathing",
  roofing: "Roofing",
  gutters: "Gutters & downspouts",
  "windows-doors": "Windows & exterior doors",
  siding: "Siding & exterior trim",
  insulation: "Insulation",
  drywall: "Drywall",
  "interior-trim": "Interior doors & trim",
  flooring: "Flooring",
  tile: "Tile",
  cabinets: "Cabinets & countertops",
  painting: "Painting",
  plumbing: "Plumbing",
  electrical: "Electrical",
  hvac: "HVAC",
};

export type TakeoffUnit =
  | "sq ft" | "linear ft" | "each" | "cu yards" | "squares" | "sheets" | "tons"
  // the units a material is bought in
  | "boxes" | "bundles" | "rolls" | "gallons" | "bags" | "pieces" | "sq yd" | "sets" | "buckets" | "tubes" | "lot";
/**
 * What a line prices: "labor" (the work, measured — its materials are their own lines),
 * "material" (the supply, in purchase quantities with the waste in them — installed by
 * a labor line), or "both" (supply and install, one line).
 */
export type TakeoffRole = "labor" | "material" | "both";
export type TakeoffSource = "plan" | "derived" | "rule" | "entered";

export type TakeoffItem = {
  /** Stable id within the takeoff ("drywall.walls"). */
  id: string;
  trade: PlanTrade;
  label: string;
  qty: number;
  unit: TakeoffUnit;
  source: TakeoffSource;
  /** One plain sentence: how the number was arrived at. */
  basis: string;
  /** Plan pages the number rests on. */
  pages: number[];
  /** Labor, material, or both (default). */
  role?: TakeoffRole;
  /** The step of the trade it belongs to ("Rough-in", "Trim-out", "Fixtures"…), for grouping. */
  phase?: string;
  /** Measured on the sheets for the job asked for (lib/plans/ask) — no rule of thumb in it. */
  measured?: boolean;
};

export type TakeoffCheck = { level: "warn" | "info"; text: string; pages?: number[] };

export type HouseLevel = {
  name: string;
  areaSqFt: number;
  areaFrom: string;
  perimeterLf: number;
  perimeterFrom: string;
  plateFt: number;
  plateFrom: TakeoffSource;
  rooms: PlanRoom[];
  pages: number[];
  /** The floor's overall outside dimensions multiplied, when the plans give them. */
  overallSqFt?: number;
};

export type House = {
  name: string | null;
  address: string | null;
  levels: HouseLevel[];
  livingSqFt: number;
  livingFrom: string;
  garage: { areaSqFt: number; widthFt: number | null; depthFt: number | null; pages: number[] } | null;
  porchSqFt: number;
  deckSqFt: number;
  /** Ground floor of the house + garage + porch — what the foundation and the roof cover. */
  footprintSqFt: number;
  /** The garage sits inside the main floor's overall outline (one roof, one perimeter). */
  garageInOutline: boolean;
  /** An upper floor over the garage (a bonus or media room): its floor is insulated, its garage ceiling fire-rated. */
  overGarageSqFt: number;
  /** A site plan's impervious-area table, when one was read. */
  site: { drivewaySqFt: number | null; walksSqFt: number | null; patioSqFt: number | null; lotSqFt: number | null };
  /** Two-story voids ("OPEN TO BELOW") — each has a guard rail along it. */
  voids: number;
  roof: { rise: number; factor: number; pitchFrom: TakeoffSource; overhangIn: number; overhangFrom: TakeoffSource; material: string | null; style: string | null; statedAreaSqFt: number | null; planAreaSqFt: number | null };
  foundation: { type: "slab" | "crawlspace" | "basement" | "piers"; from: TakeoffSource; footingWidthIn: number; footingDepthIn: number; wallHeightFt: number; slabIn: number };
  windows: PlanOpening[];
  doors: PlanOpening[];
  fixtures: Record<string, number>;
  fixturesFrom: TakeoffSource;
  electrical: Record<string, number>;
  electricalFrom: TakeoffSource;
  siding: string | null;
  notes: string[];
  /** What the plans say the house is built to, for the heating & cooling load (2026-10-18): the energy-code
   *  values, the glass on each elevation, the way the front faces. Optional — a house from older reads has none. */
  energy?: PlanEnergy | null;
  facades?: PlanFacade[];
  frontFaces?: Compass | null;
};

/** `hvac`: the heating & cooling load worked out from the plans (lib/plans/hvacLoad), when one was run. */
export type Takeoff = { house: House; items: TakeoffItem[]; checks: TakeoffCheck[]; sheets: number; hvac?: PlanHvacLoad };

/**
 * What the contractor corrected about the house on the takeoff screen. Each one
 * replaces what the plans (or a rule) said at the point the house is built, so every
 * quantity that rests on it follows — a pitch changes the roof, the rakes, the gables
 * and the siding; a plate height changes the walls, the drywall and the paint.
 */
export type HouseEdits = {
  levels?: Record<string, { areaSqFt?: number; perimeterLf?: number; plateFt?: number }>;
  livingSqFt?: number;
  /** 0 = no garage. */
  garageSqFt?: number;
  roofRise?: number;
  roofStyle?: "gable" | "hip";
  overhangIn?: number;
  foundation?: House["foundation"]["type"];
  siding?: string;
};
const ENTERED = "entered by you";

const LEVEL_ORDER = ["Basement", "Main", "Upper", "Third"];
const levelRank = (n: string) => {
  const i = LEVEL_ORDER.indexOf(n);
  return i < 0 ? 9 : i;
};
const uniq = (a: number[]) => Array.from(new Set(a)).sort((x, y) => x - y);

/** Merge sheets into one house. Floor sheets own rooms; schedules own openings. */
export function buildHouse(sheets: SheetRead[], edits: HouseEdits = {}): { house: House; checks: TakeoffCheck[] } {
  const checks: TakeoffCheck[] = [];
  const floorSheets = sheets.filter((s) => s.kind === "floor");
  const roomSheets = floorSheets.length ? floorSheets : sheets.filter((s) => s.rooms.length);
  const pick = <T>(f: (s: SheetRead) => T | null | undefined): { v: T; page: number } | null => {
    for (const s of sheets) {
      const v = f(s);
      if (v != null && v !== "" && !(typeof v === "number" && !Number.isFinite(v))) return { v, page: s.page };
    }
    return null;
  };

  const voidNames = new Set<string>();
  // ── levels: rooms by level (a room seen on two sheets of the same level is one room)
  const byLevel = new Map<string, { rooms: PlanRoom[]; pages: number[]; overall: { w: number; d: number; page: number } | null; extLf: { v: number; page: number } | null }>();
  for (const s of roomSheets) {
    for (const r of s.rooms) {
      if (isVoid(r)) {
        voidNames.add(`${s.level ?? ""}:${r.name.toLowerCase()}`);
        continue;
      }
      const lv = levelName(r.level ?? s.level) ?? "Main";
      const slot = byLevel.get(lv) ?? { rooms: [], pages: [], overall: null, extLf: null };
      if (!slot.rooms.some((x) => x.name.toLowerCase() === r.name.toLowerCase())) slot.rooms.push({ ...r, level: lv });
      if (!slot.pages.includes(s.page)) slot.pages.push(s.page);
      byLevel.set(lv, slot);
    }
  }
  for (const s of sheets) {
    if (!(s.kind === "floor" || s.kind === "foundation")) continue;
    const lv = s.kind === "foundation" ? null : levelName(s.level) ?? "Main";
    if (!lv) continue;
    const slot = byLevel.get(lv) ?? { rooms: [], pages: [s.page], overall: null, extLf: null };
    if (!slot.overall && s.overall.widthFt && s.overall.depthFt) slot.overall = { w: s.overall.widthFt, d: s.overall.depthFt, page: s.page };
    if (!slot.extLf && s.walls.exteriorLf) slot.extLf = { v: s.walls.exteriorLf, page: s.page };
    if (!slot.pages.includes(s.page)) slot.pages.push(s.page);
    byLevel.set(lv, slot);
  }

  const stated = (k: keyof SheetRead["stated"]) => pick((s) => s.stated[k]);
  const statedLevel: Record<string, { v: number; page: number } | null> = {
    Main: stated("mainSqFt"),
    Upper: stated("upperSqFt"),
    Basement: stated("basementSqFt"),
  };
  const plateFor = (lv: string): { ft: number; from: TakeoffSource } => {
    const own = edits.levels?.[lv]?.plateFt;
    if (own && own > 0) return { ft: own, from: "entered" };
    for (const s of sheets) for (const p of s.plateHeights) if (p.level === lv) return { ft: p.heightFt, from: "plan" };
    const rooms = byLevel.get(lv)?.rooms ?? [];
    const ceil = rooms.map((r) => r.ceilingFt).filter((x): x is number => !!x);
    if (ceil.length) return { ft: Math.max(...ceil.filter((c) => c <= 12), 8), from: "plan" };
    return { ft: lv === "Basement" ? 8 : lv === "Main" ? 9 : 8, from: "rule" };
  };

  // A floor with no stated area, no overall dimensions and no sized rooms (a construction
  // set dimensions the walls) still exists: it gets what the stated living area leaves
  // after the other floors.
  const roughArea = (name: string, slot: { rooms: PlanRoom[]; overall: { w: number; d: number } | null }) =>
    statedLevel[name]?.v ?? ((slot.overall ? slot.overall.w * slot.overall.d : 0) || slot.rooms.filter((r) => !isGarage(r) && !isPorch(r)).reduce((a, r) => a + (r.areaSqFt ?? 0), 0) * 1.1);
  const statedLivingEarly = stated("livingSqFt")?.v ?? edits.livingSqFt ?? null;
  const levelEntries = Array.from(byLevel.entries());
  const unsized = levelEntries.filter(([name, slot]) => !roughArea(name, slot) && name !== "Basement");
  const sizedSum = levelEntries.filter(([name]) => name !== "Basement").reduce((a, [name, slot]) => a + roughArea(name, slot), 0);
  const fillArea = statedLivingEarly && unsized.length && statedLivingEarly > sizedSum ? round((statedLivingEarly - sizedSum) / unsized.length) : 0;

  const levels: HouseLevel[] = [];
  for (const [name, slot] of levelEntries.sort((a, b) => levelRank(a[0]) - levelRank(b[0]))) {
    const living = slot.rooms.filter((r) => !isGarage(r) && !isPorch(r));
    const roomSum = round(living.reduce((a, r) => a + (r.areaSqFt ?? 0), 0));
    let areaSqFt = 0;
    let areaFrom = "";
    const st = statedLevel[name];
    const own = edits.levels?.[name];
    if (own?.areaSqFt && own.areaSqFt > 0) {
      areaSqFt = own.areaSqFt;
      areaFrom = ENTERED;
    } else if (st) {
      areaSqFt = st.v;
      areaFrom = `stated on the plans (p. ${st.page})`;
    } else if (slot.overall) {
      areaSqFt = round(slot.overall.w * slot.overall.d);
      areaFrom = `overall ${slot.overall.w}' × ${slot.overall.d}' (p. ${slot.overall.page})`;
    } else if (roomSum > 0) {
      // Rooms are measured inside the walls; walls and closets add ~10%.
      areaSqFt = round(roomSum * 1.1);
      areaFrom = `room areas ${roomSum} sq ft + 10% for walls and closets`;
    } else if (fillArea && unsized.some(([n]) => n === name)) {
      areaSqFt = fillArea;
      areaFrom = `the stated living area less the other floors`;
    }
    if (!areaSqFt) {
      checks.push({ level: "warn", text: `${name} floor: no area on the plans and no room sizes — it is left out. Enter its area under "Correct the house".`, pages: slot.pages });
      continue;
    }
    let perimeterLf: number;
    let perimeterFrom: string;
    if (own?.perimeterLf && own.perimeterLf > 0) {
      perimeterLf = own.perimeterLf;
      perimeterFrom = ENTERED;
    } else if (slot.extLf) {
      perimeterLf = slot.extLf.v;
      perimeterFrom = `exterior walls stated (p. ${slot.extLf.page})`;
    } else if (slot.overall) {
      perimeterLf = round(2 * (slot.overall.w + slot.overall.d));
      perimeterFrom = `2 × (${slot.overall.w}' + ${slot.overall.d}') — a rectangle; jogs add length`;
    } else {
      perimeterLf = round(4 * Math.sqrt(areaSqFt) * 1.08);
      perimeterFrom = "a near-square outline of the stated area (+8%) — check the plan outline";
    }
    const plate = plateFor(name);
    if (st && slot.overall && Math.abs(slot.overall.w * slot.overall.d - st.v) / st.v > 0.12) {
      checks.push({ level: "info", text: `${name} floor: stated ${st.v} sq ft vs the overall ${slot.overall.w}' × ${slot.overall.d}' = ${round(slot.overall.w * slot.overall.d)} sq ft — the outline is not a plain rectangle; the stated area is used.`, pages: [st.page, slot.overall.page] });
    }
    if (roomSum > 0 && areaSqFt > 0 && roomSum > areaSqFt * 1.05) {
      checks.push({ level: "warn", text: `${name} floor: the rooms add to ${roomSum} sq ft, more than the floor's ${areaSqFt} sq ft — a room may have been read twice or with the wrong size.`, pages: slot.pages });
    }
    levels.push({ name, areaSqFt, areaFrom, perimeterLf, perimeterFrom, plateFt: plate.ft, plateFrom: plate.from, rooms: slot.rooms, pages: uniq(slot.pages), overallSqFt: slot.overall ? round(slot.overall.w * slot.overall.d) : undefined });
  }

  // ── rooms with no size on the plans (construction sets dimension the walls, not the
  // rooms): an estimate from the floor's area, shared by kind of room — flagged, so the
  // contractor sees which flooring and tile quantities rest on it.
  let estimatedRooms = 0;
  for (const l of levels) {
    const living = l.rooms.filter((r) => !isGarage(r) && !isPorch(r));
    const missing = living.filter((r) => !r.areaSqFt);
    if (!missing.length) continue;
    const known = living.reduce((a, r) => a + (r.areaSqFt ?? 0), 0);
    // ~12% of a floor is walls, chases and the stair opening.
    const left = Math.max(l.areaSqFt * 0.88 - known, missing.length * 25);
    const w = missing.map(roomWeight);
    const sum = w.reduce((a, x) => a + x, 0);
    missing.forEach((r, i) => {
      r.areaSqFt = round((left * w[i]) / sum);
      r.estimated = true;
    });
    estimatedRooms += missing.length;
  }
  if (estimatedRooms) {
    checks.push({ level: "warn", text: `${estimatedRooms} room${estimatedRooms === 1 ? " has" : "s have"} no size on the plans — their areas are estimated from each floor's area by kind of room. Flooring, tile and trim rest on them: correct those quantities if you have the room sizes.` });
  }

  // ── living area
  const statedLiving = stated("livingSqFt");
  const levelSum = round(levels.filter((l) => l.name !== "Basement" || statedLevel.Basement).reduce((a, l) => a + l.areaSqFt, 0));
  let livingSqFt = levelSum;
  let livingFrom = levels.length ? `sum of ${levels.map((l) => `${l.name.toLowerCase()} ${l.areaSqFt}`).join(" + ")}` : "";
  if (edits.livingSqFt && edits.livingSqFt > 0) {
    livingSqFt = edits.livingSqFt;
    livingFrom = ENTERED;
  } else if (statedLiving) {
    if (levelSum && Math.abs(levelSum - statedLiving.v) / statedLiving.v > 0.08) {
      checks.push({ level: "warn", text: `Living area: the plans state ${statedLiving.v} sq ft, the floors read add to ${levelSum} sq ft — check for a floor or room the reading missed.`, pages: [statedLiving.page] });
    }
    livingSqFt = statedLiving.v;
    livingFrom = `stated on the plans (p. ${statedLiving.page})`;
  }

  // ── garage, porch, deck
  const garageRoom = levels.flatMap((l) => l.rooms).find(isGarage) ?? roomSheets.flatMap((s) => s.rooms).find(isGarage) ?? null;
  const statedGarage = stated("garageSqFt");
  const garageArea = edits.garageSqFt != null ? Math.max(0, edits.garageSqFt) : statedGarage?.v ?? garageRoom?.areaSqFt ?? 0;
  const garage = garageArea
    ? { areaSqFt: garageArea, widthFt: garageRoom?.widthFt ?? null, depthFt: garageRoom?.lengthFt ?? null, pages: uniq([statedGarage?.page ?? 0, ...sheets.filter((s) => s.rooms.some(isGarage)).map((s) => s.page)].filter(Boolean)) }
    : null;
  const porchSqFt = stated("porchSqFt")?.v ?? round(levels.flatMap((l) => l.rooms).filter((r) => /porch|lanai|veranda/i.test(r.name)).reduce((a, r) => a + (r.areaSqFt ?? 0), 0));
  const deckSqFt = stated("deckSqFt")?.v ?? round(levels.flatMap((l) => l.rooms).filter((r) => /\bdeck\b|balcony/i.test(r.name)).reduce((a, r) => a + (r.areaSqFt ?? 0), 0));

  const ground = levels.find((l) => l.name === "Main") ?? levels[0];
  // What the roof covers: the main floor and the garage — or an upper floor bigger than
  // both (it overhangs them, or a bonus room sits over the garage and the main floor).
  const upperMax = Math.max(0, ...levels.filter((l) => l !== ground && l.name !== "Basement").map((l) => l.areaSqFt));
  const enclosed = Math.max((ground?.areaSqFt ?? 0) + (garage?.areaSqFt ?? 0), upperMax);
  const footprintSqFt = round(enclosed + porchSqFt);
  // A garage inside the main floor's overall dimensions shares its outline and its roof.
  const garageInOutline =
    !!garage && !!ground?.overallSqFt && /^2 × \(/.test(ground.perimeterFrom) && ground.overallSqFt >= (ground.areaSqFt + garage.areaSqFt) * 0.9;
  if (garageInOutline) checks.push({ level: "info", text: `The garage is inside the main floor's ${ground!.overallSqFt} sq ft outline — its walls are counted once, in the outline.` });
  const overGarageSqFt = garage && ground ? round(Math.max(0, Math.min(garage.areaSqFt, upperMax - ground.areaSqFt))) : 0;

  // ── roof
  const pitch = pick((s) => s.roof.pitch);
  const p = edits.roofRise && edits.roofRise > 0 ? pitchOf(`${edits.roofRise}:12`) : pitchOf(pitch?.v ?? null);
  const overhang = edits.overhangIn != null && edits.overhangIn >= 0 ? { v: edits.overhangIn, page: 0 } : pick((s) => s.roof.overhangIn);
  if (!p) checks.push({ level: "warn", text: "No roof pitch found on the plans — 6:12 assumed. Set the pitch from the elevations." });
  if (!overhang) checks.push({ level: "info", text: "No roof overhang found — 12\" assumed." });
  const roof = {
    rise: p?.rise ?? 6,
    factor: p?.factor ?? (pitchOf("6:12")?.factor ?? 1.118),
    pitchFrom: (edits.roofRise ? "entered" : p ? "plan" : "rule") as TakeoffSource,
    overhangIn: overhang?.v ?? 12,
    overhangFrom: (edits.overhangIn != null ? "entered" : overhang ? "plan" : "rule") as TakeoffSource,
    material: pick((s) => s.roof.material)?.v ?? null,
    style: edits.roofStyle ?? pick((s) => s.roof.style)?.v ?? null,
    statedAreaSqFt: pick((s) => s.roof.areaSqFt)?.v ?? null,
    planAreaSqFt: pick((s) => s.roof.planAreaSqFt)?.v ?? null,
  };

  // ── foundation
  const fType = pick((s) => s.foundation.type);
  const hasBasement = levels.some((l) => l.name === "Basement");
  const foundationType = edits.foundation ?? fType?.v ?? (hasBasement ? "basement" : null);
  if (!foundationType) checks.push({ level: "warn", text: "Foundation type not found — crawlspace assumed. Set it from the foundation plan." });
  const foundation = {
    type: (foundationType ?? "crawlspace") as House["foundation"]["type"],
    from: (edits.foundation ? "entered" : foundationType ? "plan" : "rule") as TakeoffSource,
    footingWidthIn: pick((s) => s.foundation.footingWidthIn)?.v ?? (foundationType === "basement" ? 20 : 16),
    footingDepthIn: pick((s) => s.foundation.footingDepthIn)?.v ?? 8,
    wallHeightFt: pick((s) => s.foundation.wallHeightFt)?.v ?? (foundationType === "basement" ? 8 : foundationType === "slab" ? 1.5 : 2.5),
    slabIn: pick((s) => s.foundation.slabIn)?.v ?? 4,
  };

  // ── openings: schedule sheets win; otherwise every sheet's openings, de-duplicated by tag
  const collect = (src: SheetRead[], get: (s: SheetRead) => PlanOpening[]): PlanOpening[] => {
    const out: PlanOpening[] = [];
    for (const s of src) {
      for (const o of get(s)) {
        const same = o.tag ? out.find((x) => x.tag && x.tag.toUpperCase() === o.tag!.toUpperCase()) : null;
        if (same) same.count = Math.max(same.count, o.count);
        else out.push({ ...o });
      }
    }
    return out;
  };
  const doorKind = (d: PlanOpening) => (isOverheadDoor(d) ? "overhead" : d.exterior ? "exterior" : "interior");
  const mergeOpenings = (get: (s: SheetRead) => PlanOpening[], doors: boolean): PlanOpening[] => {
    const schedules = sheets.filter((s) => s.kind === "schedule" && get(s).length);
    if (!schedules.length) return collect(sheets, get);
    const listed = collect(schedules, get);
    if (!doors) return listed;
    // An energy-code glazing table lists the exterior doors it must and nothing else:
    // the garage's overhead doors and the interior doors are on the plans. A kind of
    // door the schedules lack entirely comes from the plan sheets.
    const have = new Set(listed.map(doorKind));
    const more = collect(sheets.filter((s) => !schedules.includes(s)), get).filter((d) => !have.has(doorKind(d)));
    return [...listed, ...more];
  };
  const windows = mergeOpenings((s) => s.windows, false);
  const doors = mergeOpenings((s) => s.doors, true);
  if (!windows.length) checks.push({ level: "warn", text: "No window schedule found — window counts are estimated from the floor area. Add the schedule sheet or enter the counts." });

  // ── fixtures: a plumbing sheet's count wins over the floor plans'; else derived from room names
  const plumbingSheets = sheets.filter((s) => s.kind === "plumbing" && Object.keys(s.fixtures).length);
  const fixSrc = plumbingSheets.length ? plumbingSheets : floorSheets.filter((s) => Object.keys(s.fixtures).length);
  const fixtures: Record<string, number> = {};
  for (const s of fixSrc) for (const [k, v] of Object.entries(s.fixtures)) fixtures[k] = (fixtures[k] ?? 0) + (v ?? 0);
  let fixturesFrom: TakeoffSource = fixSrc.length ? "plan" : "rule";
  if (!fixSrc.length) {
    const rooms = levels.flatMap((l) => l.rooms);
    for (const r of rooms) {
      if (/powder|half bath|\bwc\b/i.test(r.name)) { fixtures.toilet = (fixtures.toilet ?? 0) + 1; fixtures.lavatory = (fixtures.lavatory ?? 0) + 1; }
      else if (isBath(r)) {
        fixtures.toilet = (fixtures.toilet ?? 0) + 1;
        const big = (r.areaSqFt ?? 0) >= 100 || /primary|master|ensuite/i.test(r.name);
        fixtures.lavatory = (fixtures.lavatory ?? 0) + (big ? 2 : 1);
        if (big) { fixtures.shower = (fixtures.shower ?? 0) + 1; fixtures.tub = (fixtures.tub ?? 0) + 1; }
        else fixtures.tubShower = (fixtures.tubShower ?? 0) + 1;
      } else if (isKitchen(r)) { fixtures.kitchenSink = (fixtures.kitchenSink ?? 0) + 1; fixtures.dishwasher = (fixtures.dishwasher ?? 0) + 1; }
      else if (/laundry/i.test(r.name)) { fixtures.washer = (fixtures.washer ?? 0) + 1; }
    }
    if (Object.keys(fixtures).length) {
      fixtures.waterHeater = 1;
      fixtures.hoseBib = 2;
    } else fixturesFrom = "rule";
  }

  const elecSheets = sheets.filter((s) => s.kind === "electrical" && Object.keys(s.electrical).length);
  const electrical: Record<string, number> = {};
  for (const s of elecSheets) for (const [k, v] of Object.entries(s.electrical)) if (typeof v === "number") electrical[k] = (electrical[k] ?? 0) + v;
  const electricalFrom: TakeoffSource = elecSheets.length ? "plan" : "rule";

  const house: House = {
    name: pick((s) => s.project.name)?.v ?? null,
    address: pick((s) => s.project.address)?.v ?? null,
    levels,
    livingSqFt,
    livingFrom,
    garage,
    porchSqFt,
    deckSqFt,
    footprintSqFt,
    roof,
    foundation,
    windows,
    doors,
    fixtures,
    fixturesFrom,
    electrical,
    electricalFrom,
    siding: edits.siding?.trim() || pick((s) => s.exterior.siding)?.v || null,
    garageInOutline,
    overGarageSqFt: overGarageSqFt >= 40 ? overGarageSqFt : 0,
    site: {
      drivewaySqFt: pick((s) => s.stated.drivewaySqFt)?.v ?? null,
      walksSqFt: pick((s) => s.stated.walksSqFt)?.v ?? null,
      patioSqFt: pick((s) => s.stated.patioSqFt)?.v ?? null,
      lotSqFt: pick((s) => s.stated.lotSqFt)?.v ?? null,
    },
    voids: voidNames.size,
    notes: Array.from(new Set(sheets.flatMap((s) => s.notes))).slice(0, 30),
    ...houseEnvelope(sheets),
  };
  if (!levels.length) checks.push({ level: "warn", text: "No floor plan was read — the takeoff needs at least one floor plan sheet." });
  return { house, checks };
}

/** The envelope the plans specify, merged over the sheets: each energy value from the first sheet that gives it,
 *  each elevation's glass at the largest figure read for it, the front's facing from a site plan first. */
function houseEnvelope(sheets: SheetRead[]): Pick<House, "energy" | "facades" | "frontFaces"> {
  const keys: Array<keyof PlanEnergy> = ["wallR", "ceilingR", "floorR", "slabR", "basementWallR", "windowU", "windowShgc", "ach50", "ductLocation", "ductLeakage"];
  const energy = {} as Record<keyof PlanEnergy, PlanEnergy[keyof PlanEnergy]>;
  for (const k of keys) energy[k] = sheets.map((sh) => sh.energy?.[k] ?? null).find((v) => v != null) ?? null;
  const anyEnergy = keys.some((k) => energy[k] != null);
  const byFace = new Map<string, PlanFacade>();
  for (const sh of sheets) {
    for (const f of sh.facades ?? []) {
      const was = byFace.get(f.facing);
      if (!was || (f.glassSqFt ?? 0) > (was.glassSqFt ?? 0)) byFace.set(f.facing, f);
    }
  }
  const site = sheets.find((sh) => sh.kind === "site" && sh.frontFaces)?.frontFaces ?? sheets.find((sh) => sh.frontFaces)?.frontFaces ?? null;
  return { energy: anyEnergy ? (energy as PlanEnergy) : null, facades: Array.from(byFace.values()), frontFaces: site };
}

/**
 * The quantities, trade by trade, from the merged house. `measured` are lines measured on
 * the sheets for a job (lib/plans/ask): each replaces its line's number where the line is
 * made, so whatever is computed from it — the slabs from the countertops, the sheets from
 * the walls — follows. The contractor's own numbers (`qtyEdits`) win over both.
 */
export function computeTakeoff(sheets: SheetRead[], edits: HouseEdits = {}, qtyEdits: Record<string, number> = {}, measured: Record<string, Measured> = {}, opts: { hvac?: PlanHvacLoad | null } = {}): Takeoff {
  const { house: h, checks } = buildHouse(sheets, edits);
  const items: TakeoffItem[] = [];
  const allPages = uniq(sheets.map((s) => s.page));
  const add: AddItem = (trade, key, label, qty, unit, source, basis, pages = [], opts = {}) => {
    if (!(qty > 0) || !Number.isFinite(qty)) return;
    const d = unit === "cu yards" || unit === "squares" || unit === "tons" || unit === "gallons" ? 1 : 0;
    // The same window type in two rooms is one line with both counts.
    const twin = items.find((i) => i.trade === trade && i.label === label && i.unit === unit && trade === "windows-doors");
    if (twin) {
      twin.qty = round(twin.qty + qty, d);
      return;
    }
    let id = `${trade}.${key}`;
    for (let n = 2; items.some((i) => i.id === id); n++) id = `${trade}.${key}-${n}`;
    const m = measured[id];
    if (m && m.qty > 0) {
      // A measurement keeps its tenth: 62.5 sq ft of counters read off the dimension strings.
      items.push({ id, trade, label, qty: round(m.qty, Math.max(d, 1)), unit, source: "plan", basis: m.basis, pages: uniq(m.pages), measured: true, ...(opts.role ? { role: opts.role } : {}), ...(opts.phase ? { phase: opts.phase } : {}) });
      return;
    }
    items.push({ id, trade, label, qty: round(qty, d), unit, source, basis, pages: uniq(pages), ...(opts.role ? { role: opts.role } : {}), ...(opts.phase ? { phase: opts.phase } : {}) });
  };
  if (!h.levels.length) return { house: h, items, checks, sheets: sheets.length };

  const conditioned = h.levels.filter((l) => l.name !== "Basement" || h.foundation.type === "basement");
  const ground = h.levels.find((l) => l.name === "Main") ?? h.levels[0];
  const top = [...h.levels].sort((a, b) => levelRank(b.name) - levelRank(a.name))[0];
  const groundPages = ground.pages;
  const garage = h.garage;
  const garageW = garage?.widthFt ?? (garage ? Math.sqrt(garage.areaSqFt) : 0);
  const garageD = garage?.depthFt ?? (garage ? Math.sqrt(garage.areaSqFt) : 0);
  /** A garage shares one wall with the house: three exterior walls of its own. */
  /** A garage outside the house's outline adds three walls of its own; inside it, none. */
  const garageOut = !!garage && !h.garageInOutline;
  const garagePerim = garageOut ? round(garageW + 2 * garageD) : 0;
  const footingLf = round(ground.perimeterLf + garagePerim);

  // ── openings
  const winArea = h.windows.reduce((a, w) => a + (w.widthIn && w.heightIn ? (w.widthIn * w.heightIn) / 144 : 15) * w.count, 0);
  const winCount = h.windows.reduce((a, w) => a + w.count, 0);
  const extDoors = h.doors.filter((d) => d.exterior);
  const intDoors = h.doors.filter((d) => !d.exterior);
  const extDoorArea = extDoors.reduce((a, d) => a + (d.widthIn && d.heightIn ? (d.widthIn * d.heightIn) / 144 : 20) * d.count, 0);
  const overhead = extDoors.filter(isOverheadDoor);
  const estWindows = winCount || Math.round(h.livingSqFt / 130);
  const estIntDoors = intDoors.reduce((a, d) => a + d.count, 0) || h.levels.flatMap((l) => l.rooms).filter((r) => !isStairOrHall(r) && !isGarage(r) && !isPorch(r) && !/kitchen|great|living|dining|family/i.test(r.name)).length * 1.3;

  // ── walls
  const extWallGross = h.levels.reduce((a, l) => a + l.perimeterLf * (l.plateFt + (l === top ? 0 : 1)), 0);
  const gableArea = (() => {
    // Two gable ends on the house's short side, one on an attached garage — a gable roof's
    // triangles; a hip roof has none.
    if (/hip/i.test(h.roof.style ?? "")) return 0;
    const span = outlineArea(ground) / longSide(ground);
    const tri = (w: number) => 0.5 * w * ((w / 2) * (h.roof.rise / 12));
    return 2 * tri(span) + (garageOut ? tri(Math.min(garageW, garageD)) : 0);
  })();
  const garageWallArea = garageOut ? garagePerim * 9 : 0;
  const sidingGross = extWallGross + gableArea + garageWallArea;
  const sidingNet = Math.max(0, sidingGross - winArea - extDoorArea);
  const levelPages = uniq(h.levels.flatMap((l) => l.pages));
  const roomsPerim = (l: HouseLevel) => l.rooms.filter((r) => !isGarage(r) && !isPorch(r)).reduce((a, r) => a + roomPerimeter(r), 0);
  const intWallLf = h.levels.reduce((a, l) => {
    const rp = roomsPerim(l);
    // Each interior wall is shared by two rooms: (Σ room perimeters − the outline) ÷ 2;
    // with no rooms read, a typical house runs ~0.11 LF of partition per sq ft.
    return a + (rp > l.perimeterLf ? (rp - l.perimeterLf) / 2 : l.areaSqFt * 0.11);
  }, 0);

  // ── site work
  add("sitework", "pad", "Clear and grade the building pad (footprint + 5' working room)", (Math.sqrt(h.footprintSqFt) + 10) ** 2, "sq ft", "derived", `footprint ${h.footprintSqFt} sq ft plus 5' all round`, groundPages);
  add("sitework", "trench", "Excavate footing trenches", footingLf, "linear ft", "derived", `house outline ${ground.perimeterLf} LF${garage ? ` + garage ${garagePerim} LF` : ""}`, groundPages);
  if (h.foundation.type === "basement") add("sitework", "basement", "Excavate the basement", (ground.areaSqFt * (h.foundation.wallHeightFt + 1)) / 27 * 1.25, "cu yards", "derived", `${ground.areaSqFt} sq ft × ${h.foundation.wallHeightFt + 1}' deep + 25% over-dig`, groundPages);

  // ── general conditions: what the builder carries for the whole job. Debris stays
  // with each trade (every trade hauls its own), so there is no dumpster line here.
  const months = Math.min(12, Math.max(4, Math.round(2.5 + h.livingSqFt / 650)));
  add("general", "permit", "Building permit, plan review and impact fees", 1, "each", "rule", "every new house; the city's fee schedule sets the amount", levelPages);
  add("general", "survey", "Survey and staking (lot, house corners, foundation location)", 1, "each", "rule", "a licensed surveyor stakes a new house before the dig", groundPages);
  add("general", "temp", "Temporary power, water and portable toilet — months on site", months, "each", "rule", `about ${months} months to build ${h.livingSqFt} sq ft`, levelPages);
  add("general", "supervision", "Site supervision — months", months, "each", "rule", `a superintendent through the ${months}-month build`, levelPages);
  add("general", "laterals", "Underground utility laterals, street to house (water, sewer, power)", 75, "linear ft", "rule", "the plans read give no service distance — set it from the site plan", groundPages);
  add("general", "clean", "Final construction cleaning", h.livingSqFt, "sq ft", "derived", `living area ${h.livingSqFt} sq ft`, levelPages);

  // ── foundation
  const fw = h.foundation.footingWidthIn / 12;
  const fd = h.foundation.footingDepthIn / 12;
  const fSrc: TakeoffSource = h.foundation.from;
  add("foundation", "footing", `Continuous footing ${h.foundation.footingWidthIn}" × ${h.foundation.footingDepthIn}"`, footingLf, "linear ft", "derived", `outline ${footingLf} LF`, groundPages);
  add("foundation", "footing-cy", "Footing concrete", (footingLf * fw * fd) / 27, "cu yards", "derived", `${footingLf} LF × ${h.foundation.footingWidthIn}" × ${h.foundation.footingDepthIn}"`, groundPages);
  if (h.foundation.type !== "slab") {
    const wallT = h.foundation.type === "basement" ? 10 / 12 : 8 / 12;
    add("foundation", "wall", `Foundation ${h.foundation.type === "basement" ? "walls" : "stem wall"} ${round(h.foundation.wallHeightFt, 1)}' tall`, footingLf, "linear ft", fSrc, `outline ${footingLf} LF, ${h.foundation.type}`, groundPages);
    add("foundation", "wall-cy", "Foundation wall concrete", (footingLf * wallT * h.foundation.wallHeightFt) / 27, "cu yards", "derived", `${footingLf} LF × ${round(wallT * 12)}" × ${h.foundation.wallHeightFt}'`, groundPages);
  }
  const slabArea = (h.foundation.type === "slab" ? ground.areaSqFt : h.foundation.type === "basement" ? ground.areaSqFt : 0) + (garage?.areaSqFt ?? 0) + h.porchSqFt;
  add("foundation", "slab", `Concrete slab ${h.foundation.slabIn}"${h.foundation.type === "crawlspace" ? " (garage and porch)" : ""}`, slabArea, "sq ft", "derived", `${h.foundation.type === "slab" ? `house ${ground.areaSqFt}` : h.foundation.type === "basement" ? `basement ${ground.areaSqFt}` : ""}${garage ? ` + garage ${garage.areaSqFt}` : ""}${h.porchSqFt ? ` + porch ${h.porchSqFt}` : ""} sq ft`.replace(/^ \+ /, ""), groundPages);
  add("foundation", "slab-cy", "Slab concrete", (slabArea * (h.foundation.slabIn / 12)) / 27, "cu yards", "derived", `${round(slabArea)} sq ft × ${h.foundation.slabIn}"`, groundPages);
  add("foundation", "anchors", "Anchor bolts (6' on centre + each corner)", Math.ceil(footingLf / 6) + 8, "each", "rule", "IRC R403.1.6 spacing on the outline", groundPages);
  if (h.foundation.type === "crawlspace") add("foundation", "vapor", "Crawlspace vapor barrier", ground.areaSqFt, "sq ft", "derived", `ground floor ${ground.areaSqFt} sq ft`, groundPages);
  if (h.foundation.type === "basement") add("foundation", "waterproof", "Foundation damp-proofing / waterproofing", footingLf * h.foundation.wallHeightFt, "sq ft", "derived", `${footingLf} LF × ${h.foundation.wallHeightFt}'`, groundPages);
  const siteFlat = (h.site.drivewaySqFt ?? 0) + (h.site.walksSqFt ?? 0) + (h.site.patioSqFt ?? 0);
  if (siteFlat > 0) {
    add("foundation", "flatwork", "Driveway, walks and open patios (4\" broom-finish concrete)", siteFlat, "sq ft", "plan", [h.site.drivewaySqFt ? `driveway ${h.site.drivewaySqFt}` : "", h.site.walksSqFt ? `walks ${h.site.walksSqFt}` : "", h.site.patioSqFt ? `patios ${h.site.patioSqFt}` : ""].filter(Boolean).join(" + ") + " sq ft from the site plan", allPages);
  } else {
    add("foundation", "flatwork", "Driveway and front walk (4\" broom-finish concrete)", garage ? garageW * 25 + 120 : 120, "sq ft", "rule", garage ? `a ${round(garageW)}' driveway 25' long + a 4' × 30' walk — set from the site plan` : "a 4' × 30' walk — set from the site plan", groundPages);
  }

  // ── framing
  const framedFloors = h.levels.filter((l) => l.name !== "Basement" && !(l === ground && h.foundation.type === "slab")).reduce((a, l) => a + l.areaSqFt, 0);
  const extLf = h.levels.reduce((a, l) => a + l.perimeterLf, 0) + garagePerim;
  add("framing", "ext-walls", "Exterior wall framing", extLf, "linear ft", "derived", h.levels.map((l) => `${l.name.toLowerCase()} ${l.perimeterLf} LF at ${l.plateFt}'`).join(", ") + (garage ? `, garage ${garagePerim} LF` : ""), levelPages);
  add("framing", "int-walls", "Interior wall framing", intWallLf, "linear ft", "derived", "shared room walls: (Σ room perimeters − outline) ÷ 2 per floor", levelPages);
  add("framing", "floor", "Floor framing and subfloor", framedFloors, "sq ft", "derived", `framed floors ${round(framedFloors)} sq ft (${h.foundation.type})`, levelPages);
  add("framing", "roof", "Roof framing (trusses or rafters)", roofPlanArea(h), "sq ft", h.roof.planAreaSqFt ? "plan" : "derived", h.roof.planAreaSqFt ? `roof plan area ${h.roof.planAreaSqFt} sq ft stated on the plans` : `footprint ${h.footprintSqFt} sq ft + ${h.roof.overhangIn}" overhang, plan area`, groundPages);
  add("framing", "wall-sheathing", "Wall sheathing (4×8)", sidingGross / 32, "sheets", "derived", `${round(sidingGross)} sq ft of exterior wall ÷ 32`, levelPages);
  add("framing", "roof-sheathing", "Roof sheathing (4×8)", roofArea(h) / 32, "sheets", "derived", `${round(roofArea(h))} sq ft of roof ÷ 32`, groundPages);
  const flights = h.levels.filter((l) => l.name !== "Basement").length - 1 + (h.levels.some((l) => l.name === "Basement") ? 1 : 0);
  add("framing", "stairs", "Stairs — rough stringers, treads and landings", flights, "each", "derived", `${flights} flight${flights === 1 ? "" : "s"} between ${h.levels.length} levels`, levelPages);
  add("framing", "headers", "Window and door headers", estWindows + extDoors.reduce((a, d) => a + d.count, 0) + Math.round(estIntDoors), "each", winCount ? "plan" : "rule", winCount ? "one per opening in the schedules" : "estimated openings", levelPages);

  // ── roofing
  const ra = roofArea(h);
  const eave = eaveLf(h);
  add("roofing", "area", `Roof covering${h.roof.material ? ` — ${h.roof.material}` : ""}, ${h.roof.rise}:12`, ra, "sq ft", h.roof.statedAreaSqFt ? "plan" : "derived", h.roof.statedAreaSqFt ? "roof area stated on the plans" : `plan area ${roofPlanArea(h)} sq ft${h.roof.planAreaSqFt ? " (stated)" : ""} × ${h.roof.factor} pitch factor (${h.roof.rise}:12)`, groundPages);
  add("roofing", "underlayment", "Synthetic underlayment over the whole deck", ra, "sq ft", "derived", `the roof area, ${round(ra)} sq ft (${round(ra / 100, 1)} squares)`, groundPages);
  add("roofing", "eave", "Eaves (starter, drip edge, ice & water)", eave, "linear ft", "derived", "two long sides of the house and the garage, with overhang", groundPages);
  add("roofing", "ridge", "Ridge (cap / vent)", ridgeLf(h), "linear ft", "derived", "the house's long side less the gable overhangs, plus the garage", groundPages);
  add("roofing", "rake", "Rakes (drip edge)", rakeLf(h), "linear ft", "derived", `gable ends at ${h.roof.rise}:12`, groundPages);

  // ── gutters
  add("gutters", "gutter", "Gutters", eave, "linear ft", "derived", "every eave", groundPages);
  add("gutters", "downspouts", "Downspouts", Math.max(4, Math.ceil(eave / 35)), "each", "rule", "one per ~35 LF of gutter, four minimum", groundPages);

  // ── windows & doors
  const schedPages = uniq(sheets.filter((s) => s.kind === "schedule").map((s) => s.page));
  if (winCount) {
    for (const w of h.windows) add("windows-doors", `win-${(w.tag ?? `${w.widthIn}x${w.heightIn}`).toLowerCase()}`, `Window ${w.tag ? `${w.tag} ` : ""}${w.widthIn && w.heightIn ? `${fmtIn(w.widthIn)} × ${fmtIn(w.heightIn)}` : ""}${w.type ? ` ${w.type.toLowerCase()}` : ""}`.trim(), w.count, "each", "plan", "window schedule", schedPages.length ? schedPages : allPages);
  } else add("windows-doors", "windows", "Windows (count estimated)", estWindows, "each", "rule", `about one per 130 sq ft of living area (${h.livingSqFt})`, levelPages);
  for (const d of extDoors) add("windows-doors", `door-${(d.tag ?? d.type ?? "ext").toLowerCase().replace(/\W+/g, "-")}`, `${isOverheadDoor(d) ? "Garage door" : "Exterior door"} ${d.tag ? `${d.tag} ` : ""}${d.widthIn && d.heightIn ? `${fmtIn(d.widthIn)} × ${fmtIn(d.heightIn)}` : ""}${d.type ? ` ${d.type.toLowerCase()}` : ""}`.trim(), d.count, "each", "plan", "door schedule", schedPages.length ? schedPages : allPages);
  if (!extDoors.length) add("windows-doors", "ext-doors", "Exterior doors (entry, rear, garage man-door)", 3, "each", "rule", "no door schedule read", levelPages);
  if (garage && !overhead.length) add("windows-doors", "garage-door", "Garage overhead door", garageW >= 20 ? 1 : 1, "each", "rule", `garage ${garage.areaSqFt} sq ft, no door schedule`, garage.pages);

  // ── siding
  add("siding", "net", `Siding${h.siding ? ` — ${h.siding}` : ""}`, sidingNet, "sq ft", "derived", `walls ${round(extWallGross)} + gables ${round(gableArea)}${garage ? ` + garage ${round(garageWallArea)}` : ""} − windows ${round(winArea)} − doors ${round(extDoorArea)} sq ft`, levelPages);
  add("siding", "wrap", "House wrap / weather-resistive barrier", sidingGross, "sq ft", "derived", "every exterior wall and gable, openings included (the wrap is cut at them)", levelPages);
  add("siding", "corners", "Corner and opening trim", h.levels.length * 4 * (top.plateFt + 1) + (estWindows + extDoors.length) * 14, "linear ft", "rule", "4 corners per floor + ~14 LF around each opening", levelPages);
  add("siding", "soffit", "Soffit and fascia", eave + rakeLf(h), "linear ft", "derived", "eaves + rakes", groundPages);

  // ── insulation
  // The heated envelope's walls: every heated floor's outline from its floor to its plate
  // (the band joist between floors is wall too), less the garage's own outside walls when
  // it sits inside the outline, plus the wall the house shares with the garage, less the
  // windows and doors in them (a skylight is in the roof).
  const garageShared = garage ? (h.garageInOutline ? garageW + garageD : garageD) : 0;
  const wallWindows = h.windows.filter((w) => !/skylight/i.test(w.type ?? "")).reduce((a, w) => a + (w.widthIn && w.heightIn ? (w.widthIn * w.heightIn) / 144 : 15) * w.count, 0);
  const condExtWall =
    conditioned.reduce((a, l) => a + l.perimeterLf * (l.plateFt + (l === top ? 0 : 1)), 0) -
    (h.garageInOutline ? (garageW + garageD) * (ground.plateFt + 1) : 0) +
    garageShared * ground.plateFt -
    wallWindows -
    extDoors.filter((d) => !overhead.includes(d)).reduce((a, d) => a + (d.widthIn && d.heightIn ? (d.widthIn * d.heightIn) / 144 : 20) * d.count, 0);
  add("insulation", "walls", "Exterior wall insulation", condExtWall, "sq ft", "derived", `heated floors' outline × wall height (band joists included)${garage ? " + the wall shared with the garage" : ""} − windows and doors`, levelPages);
  add("insulation", "attic", "Attic / ceiling insulation", top.areaSqFt, "sq ft", "derived", `top floor ${top.areaSqFt} sq ft`, top.pages);
  add("insulation", "air-seal", "Air sealing and blower-door test (energy code)", 1, "each", "rule", "IECC R402.4: every new house is air sealed and tested", levelPages);
  if (h.foundation.type === "crawlspace") add("insulation", "floor", "Floor insulation over the crawlspace", ground.areaSqFt, "sq ft", "derived", `ground floor ${ground.areaSqFt} sq ft`, groundPages);
  if (garage && h.overGarageSqFt) add("insulation", "floor-garage", "Floor insulation over the garage (living space above)", h.overGarageSqFt, "sq ft", "derived", `the upper floor runs ${h.overGarageSqFt} sq ft past the main floor, over the ${garage.areaSqFt} sq ft garage`, garage.pages);

  // ── drywall
  const dwWalls = conditioned.reduce((a, l) => {
    const rp = roomsPerim(l);
    const perim = rp > 0 ? rp : l.perimeterLf + 2 * (l.areaSqFt * 0.11);
    return a + perim * l.plateFt;
  }, 0) * 0.92;
  const dwCeil = conditioned.reduce((a, l) => a + l.areaSqFt, 0);
  add("drywall", "walls", "Drywall — walls (hang, tape, finish)", dwWalls, "sq ft", "derived", "every room's walls × ceiling height, less ~8% for openings", levelPages);
  add("drywall", "ceilings", "Drywall — ceilings", dwCeil, "sq ft", "derived", `heated floor area ${round(dwCeil)} sq ft`, levelPages);
  if (garage) {
    add(
      "drywall",
      "garage",
      h.overGarageSqFt ? "Garage fire separation (5/8\" Type X): house wall + ceiling under the living space" : "Garage fire separation (5/8\" Type X)",
      garageD * 9 + h.overGarageSqFt,
      "sq ft",
      "derived",
      h.overGarageSqFt ? `the wall shared with the house (${round(garageD * 9)} sq ft) + the ceiling under the rooms above (${h.overGarageSqFt} sq ft), IRC R302.6` : "the wall shared with the house, 9' tall (IRC R302.6)",
      garage.pages,
    );
  }

  // ── interior trim
  const baseLf = h.levels.reduce((a, l) => a + roomsPerim(l), 0) - estIntDoors * 2.7 * 2;
  add("interior-trim", "doors", "Interior doors (pre-hung)", Math.round(estIntDoors), "each", intDoors.length ? "plan" : "rule", intDoors.length ? "door schedule" : "about 1.3 per enclosed room", schedPages.length ? schedPages : levelPages);
  add("interior-trim", "base", "Baseboard", baseLf, "linear ft", "derived", "every room's perimeter less door openings", levelPages);
  add("interior-trim", "stair-rail", "Stair railing, newels and balusters", flights * 14, "linear ft", "rule", `about 14 LF per flight (${flights})`, levelPages);
  add("interior-trim", "casing", "Door and window casing", Math.round(estIntDoors) * 34 + estWindows * 16, "linear ft", "rule", "34 LF per door (both sides), 16 LF per window", levelPages);

  // ── flooring: grouped by the finish the plans call out
  const finishGroups = new Map<string, { area: number; rooms: string[]; pages: number[]; assumed: string[]; estimated: number }>();
  for (const l of conditioned) {
    for (const r of l.rooms) {
      if (isGarage(r) || isPorch(r) || !r.areaSqFt) continue;
      const called = normalizeFinish(r.floor);
      // A bath with no finish on the plans is tiled in almost every house; it is
      // marked as assumed so the contractor sees it. Other rooms wait for a finish.
      const f = called ?? (isBath(r) ? "tile" : null) ?? "not called out";
      const g = finishGroups.get(f) ?? { area: 0, rooms: [], pages: [], assumed: [], estimated: 0 };
      g.area += r.areaSqFt;
      if (r.estimated) g.estimated++;
      g.rooms.push(r.name.toLowerCase());
      if (!called && f === "tile") g.assumed.push(r.name.toLowerCase());
      g.pages.push(...l.pages);
      finishGroups.set(f, g);
    }
  }
  for (const [f, g] of finishGroups) {
    if (f === "tile") continue; // tile is its own trade below
    add("flooring", `floor-${f.replace(/\W+/g, "-")}`, f === "not called out" ? "Flooring — finish not called out" : `Flooring — ${f}`, g.area, "sq ft", g.estimated ? "rule" : "plan", `rooms: ${g.rooms.slice(0, 8).join(", ")}${g.rooms.length > 8 ? "…" : ""}${g.estimated ? ` (${g.estimated} room size${g.estimated === 1 ? "" : "s"} estimated — no sizes on the plans)` : ""}`, g.pages);
  }
  add("flooring", "stair-treads", "Stair treads and risers (finish)", flights * 14, "each", "rule", `about 14 steps per flight (${flights})`, levelPages);
  if ((finishGroups.get("not called out")?.area ?? 0) > 0) checks.push({ level: "info", text: `${round(finishGroups.get("not called out")!.area)} sq ft of rooms have no floor finish on the plans — set the finish before pricing flooring.` });

  // ── tile
  const tileFloor = finishGroups.get("tile");
  if (tileFloor) add("tile", "floor", "Tile floors", tileFloor.area, "sq ft", tileFloor.assumed.length || tileFloor.estimated ? "rule" : "plan", `rooms: ${tileFloor.rooms.join(", ")}${tileFloor.assumed.length ? ` (tile assumed in ${tileFloor.assumed.join(", ")} — no finish on the plans)` : ""}${tileFloor.estimated ? ` (${tileFloor.estimated} room size${tileFloor.estimated === 1 ? "" : "s"} estimated)` : ""}`, tileFloor.pages);
  const showers = (h.fixtures.shower ?? 0) + (h.fixtures.tubShower ?? 0);
  if (showers) add("tile", "walls", "Tile shower / tub walls", showers * 90, "sq ft", "rule", `${showers} shower${showers > 1 ? "s" : ""} × ~90 sq ft of wall tile`, levelPages);
  const kitchens = h.levels.flatMap((l) => l.rooms).filter(isKitchen);
  if (kitchens.length) add("tile", "backsplash", "Kitchen backsplash", kitchens.length * 30, "sq ft", "rule", "~30 sq ft per kitchen", levelPages);

  // ── cabinets
  for (const k of kitchens) {
    const perim = roomPerimeter(k);
    const base = round(Math.min(Math.max(perim * 0.45, 14), 40));
    add("cabinets", `base-${k.name.toLowerCase().replace(/\W+/g, "-")}`, `Kitchen base cabinets${kitchens.length > 1 ? ` (${k.name.toLowerCase()})` : ""}`, base, "linear ft", "rule", `~45% of the kitchen's ${round(perim)} LF perimeter`, levelPages);
    add("cabinets", `upper-${k.name.toLowerCase().replace(/\W+/g, "-")}`, "Kitchen wall cabinets", round(base * 0.75), "linear ft", "rule", "~75% of the base run", levelPages);
    add("cabinets", `tops-${k.name.toLowerCase().replace(/\W+/g, "-")}`, "Countertops", round(base * 2.15), "sq ft", "rule", `${base} LF × 25.5" deep (an island is its own line)`, levelPages);
  }
  const vanities = h.fixtures.lavatory ?? 0;
  if (vanities) add("cabinets", "vanities", "Bathroom vanities", Math.max(1, Math.round(vanities * 0.75)), "each", h.fixturesFrom, `${vanities} lavatories (double vanities count once)`, levelPages);

  // ── painting
  add("painting", "interior", "Interior paint — walls and ceilings", dwWalls + dwCeil, "sq ft", "derived", "the drywall surfaces", levelPages);
  add("painting", "exterior", "Exterior paint / stain", sidingNet + (eave + rakeLf(h)) * 1.5, "sq ft", "derived", "siding plus soffit and fascia", levelPages);
  add("painting", "doors", "Paint interior doors and trim", Math.round(estIntDoors), "each", "derived", "every interior door with its casing", levelPages);

  // ── the full build list: plumbing, electrical and HVAC down to every fixture, device
  // and fitting, and every trade's materials in the units they are bought in
  // (lib/plans/assemblies). A quantity the contractor corrected is applied first, so the
  // materials that rest on it follow.
  applyQtyEdits(items, qtyEdits);
  addAssemblies({ h, sheets, items, add, checks, pages: { level: levelPages, ground: groundPages, all: allPages }, hvac: opts.hvac ?? null });
  applyQtyEdits(items, qtyEdits);

  if (h.levels.some((l) => l.plateFrom === "rule")) checks.push({ level: "info", text: `Plate heights not found for ${h.levels.filter((l) => l.plateFrom === "rule").map((l) => l.name.toLowerCase()).join(", ")} — ${h.levels.filter((l) => l.plateFrom === "rule").map((l) => `${l.plateFt}'`).join(", ")} assumed.` });
  return { house: h, items, checks, sheets: sheets.length, ...(opts.hvac ? { hvac: opts.hvac } : {}) };
}

export type AddItem = (
  trade: PlanTrade,
  key: string,
  label: string,
  qty: number,
  unit: TakeoffUnit,
  source: TakeoffSource,
  basis: string,
  pages?: number[],
  opts?: { role?: TakeoffRole; phase?: string },
) => void;

/** The contractor's corrected quantities, by item id — each applied once. */
function applyQtyEdits(items: TakeoffItem[], qtyEdits: Record<string, number>) {
  for (const i of items) {
    const own = qtyEdits[i.id];
    if (own == null || !(own > 0) || i.source === "entered") continue;
    i.basis = `entered by you (the plans gave ${round(i.qty, 1).toLocaleString("en-US")})`;
    i.qty = own;
    i.source = "entered";
  }
}

export function mechOf(sheets: SheetRead[]): SheetRead["mechanical"] | undefined {
  return sheets.map((s) => s.mechanical).find((m) => m.tons || m.system || m.waterHeater || m.heatLoadBtu);
}
function overhangArea(h: House): number {
  // The overhang adds a band around the roofed outline: perimeter × overhang.
  const o = h.roof.overhangIn / 12;
  const ground = h.levels.find((l) => l.name === "Main") ?? h.levels[0];
  const perim = (ground?.perimeterLf ?? 0) + (h.garage && !h.garageInOutline ? Math.sqrt(h.garage.areaSqFt) * 2 : 0);
  return round(perim * o + 4 * o * o);
}
/** The roof seen from above, overhangs included: written on the plans, else the footprint plus the eave band. */
export function roofPlanArea(h: House): number {
  return h.roof.planAreaSqFt ?? round(h.footprintSqFt + overhangArea(h));
}
export function roofArea(h: House): number {
  if (h.roof.statedAreaSqFt) return h.roof.statedAreaSqFt;
  return round(roofPlanArea(h) * h.roof.factor);
}
function eaveLf(h: House): number {
  const ground = h.levels.find((l) => l.name === "Main") ?? h.levels[0];
  const long = ground ? longSide(ground) : 0;
  const o = (h.roof.overhangIn / 12) * 2;
  const garageSide = h.garage && !h.garageInOutline ? (h.garage.widthFt ?? Math.sqrt(h.garage.areaSqFt)) + o : 0;
  const hip = /hip/i.test(h.roof.style ?? "");
  const mixed = /mix|combo|combination|cross/i.test(h.roof.style ?? "");
  const gableEaves = 2 * (long + o);
  const hipEaves = ground ? ground.perimeterLf + 4 * o : gableEaves;
  // A hip runs eaves all round, a gable along the long sides; a mixed roof between them.
  const houseEaves = hip ? hipEaves : mixed ? (gableEaves + hipEaves) / 2 : gableEaves;
  return round(houseEaves + 2 * garageSide);
}
function ridgeLf(h: House): number {
  const ground = h.levels.find((l) => l.name === "Main") ?? h.levels[0];
  if (!ground) return 0;
  const long = longSide(ground);
  const short = outlineArea(ground) / long;
  const hip = /hip/i.test(h.roof.style ?? "");
  const houseRidge = hip ? Math.max(0, long - short) : long + (h.roof.overhangIn / 12) * 2;
  const garageRidge = h.garage && !h.garageInOutline ? (h.garage.depthFt ?? Math.sqrt(h.garage.areaSqFt)) : 0;
  return round(houseRidge + garageRidge);
}
function rakeLf(h: House): number {
  if (/hip/i.test(h.roof.style ?? "")) return 0;
  const ground = h.levels.find((l) => l.name === "Main") ?? h.levels[0];
  if (!ground) return 0;
  const short = outlineArea(ground) / longSide(ground);
  const slope = (w: number) => (w / 2 + h.roof.overhangIn / 12) * h.roof.factor;
  const garageShort = h.garage && !h.garageInOutline ? Math.min(h.garage.widthFt ?? Math.sqrt(h.garage.areaSqFt), h.garage.depthFt ?? Math.sqrt(h.garage.areaSqFt)) : 0;
  return round(4 * slope(short) + (garageShort ? 2 * slope(garageShort) : 0));
}
/** The area the floor's outline encloses: its overall dimensions when known (a garage inside them included). */
function outlineArea(l: HouseLevel): number {
  return l.overallSqFt && l.overallSqFt >= l.areaSqFt * 0.9 ? l.overallSqFt : l.areaSqFt;
}
function longSide(l: HouseLevel): number {
  // From the perimeter and area of a rectangle: P = 2(a+b), A = ab.
  const a = outlineArea(l);
  const half = l.perimeterLf / 2;
  const disc = half * half - 4 * a;
  if (disc <= 0) return Math.sqrt(a);
  return (half + Math.sqrt(disc)) / 2;
}
function fmtIn(inches: number): string {
  const ft = Math.floor(inches / 12);
  const i = Math.round(inches - ft * 12);
  return `${ft}'-${i}"`;
}
function normalizeFinish(f: string | null): string | null {
  if (!f) return null;
  const s = f.toLowerCase();
  if (/tile|porcelain|ceramic|stone|marble/.test(s)) return "tile";
  if (/lvp|lvt|vinyl plank|luxury vinyl|vinyl/.test(s)) return "luxury vinyl plank";
  if (/hardwood|oak|maple|engineered/.test(s)) return "hardwood";
  if (/laminate/.test(s)) return "laminate";
  if (/carpet/.test(s)) return "carpet";
  if (/concrete|sealed|epoxy/.test(s)) return "sealed concrete";
  return s.slice(0, 30);
}
