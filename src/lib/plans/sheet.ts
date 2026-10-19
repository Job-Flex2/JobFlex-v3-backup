// ONE SHEET OF A PLAN SET, AS READ — the shape the vision model answers in, and the
// cleaner that turns whatever it answered into that shape. Pure.
//
// The model sees the sheet's picture AND its text layer (a CAD export carries every
// dimension string as text, which beats reading pixels). It reports only what the
// sheet shows: rooms with their written sizes, the overall dimensions, stated areas,
// schedules, the roof pitch, fixtures and devices that are drawn. Lengths come back
// as the drafter wrote them ("12'-6\""); this file reads them (lib/plans/dims), so a
// model that writes 12.5 or "12 ft 6 in" lands on the same number.
//
// Nothing here is trusted: every count is clamped, every size range-checked, and a
// value that does not read is dropped rather than guessed.
import { areaOf, feetOf, inchesOf, openingInches, pitchOf, round, sizeOf } from "./dims";

export const SHEET_KINDS = [
  "cover", "site", "foundation", "floor", "roof", "elevation", "section",
  "structural", "electrical", "plumbing", "mechanical", "schedule", "detail", "other",
] as const;
export type SheetKind = (typeof SHEET_KINDS)[number];

export type PlanRoom = {
  name: string;
  level: string | null;
  widthFt: number | null;
  lengthFt: number | null;
  /** Written on the plan, or width × length. */
  areaSqFt: number | null;
  ceilingFt: number | null;
  /** Finish called out for the floor ("tile", "LVP", "carpet", "hardwood", "concrete"…). */
  floor: string | null;
  /** No size on the plans: the area is the takeoff's estimate from the floor area (lib/plans/takeoff). */
  estimated?: boolean;
};

export type PlanOpening = {
  tag: string | null;
  widthIn: number | null;
  heightIn: number | null;
  count: number;
  type: string | null;
  /** Doors only: true for an exterior door (entry, patio, garage man-door, overhead). */
  exterior?: boolean;
};

export type SheetRead = {
  page: number;
  kind: SheetKind;
  /** "A2.1 Main Floor Plan" — the sheet's own title block. */
  title: string;
  /** "Main", "Upper", "Basement"… for a floor-type sheet. */
  level: string | null;
  scale: string | null;
  project: { name: string | null; address: string | null };
  /** Areas written on the sheet (area summary tables, cover sheets). */
  stated: {
    livingSqFt: number | null;
    mainSqFt: number | null;
    upperSqFt: number | null;
    basementSqFt: number | null;
    garageSqFt: number | null;
    porchSqFt: number | null;
    deckSqFt: number | null;
    /** A site plan's impervious-area table: the driveway and approach, the walks, open patios. */
    drivewaySqFt: number | null;
    walksSqFt: number | null;
    patioSqFt: number | null;
    lotSqFt: number | null;
  };
  /** Overall outside dimensions of the floor drawn on this sheet. */
  overall: { widthFt: number | null; depthFt: number | null };
  stories: number | null;
  plateHeights: Array<{ level: string; heightFt: number }>;
  rooms: PlanRoom[];
  windows: PlanOpening[];
  doors: PlanOpening[];
  roof: {
    pitch: string | null;
    factor: number | null;
    style: string | null;
    material: string | null;
    overhangIn: number | null;
    /** The roof's surface (sloped) area, when a roof plan writes it. */
    areaSqFt: number | null;
    /** The roof's horizontal area, overhangs included — a site plan's "ROOF & GUTTERS AREA". */
    planAreaSqFt: number | null;
  };
  foundation: { type: "slab" | "crawlspace" | "basement" | "piers" | null; footingWidthIn: number | null; footingDepthIn: number | null; wallHeightFt: number | null; slabIn: number | null };
  walls: { exteriorFraming: string | null; interiorFraming: string | null; exteriorLf: number | null };
  exterior: { siding: string | null; trim: string | null; gutters: string | null };
  fixtures: Partial<Record<FixtureKey, number>>;
  electrical: Partial<Record<DeviceKey, number>> & { panelAmps?: number };
  /** heatLoadBtu: the energy sheet's building design heat load (Btu/h), what a heat pump is sized from. */
  mechanical: { system: string | null; tons: number | null; furnaceBtu: number | null; waterHeater: string | null; heatLoadBtu: number | null; systems: number | null };
  /** Notes worth carrying to the estimate (insulation values, structural calls, specs). */
  notes: string[];
  confidence: "high" | "medium" | "low";
  /** THE ENVELOPE FOR THE HEATING & COOLING LOAD (2026-10-18, owner: "the blueprint estimator should estimate HVAC
   *  Manual J based — blueprints have the windows' sizes and the rest"): what the energy-code table, the insulation
   *  notes and the wall sections specify. Optional — older reads have none. */
  energy?: PlanEnergy;
  /** An elevation sheet: the glass on each face it draws, for the sun on each side of the house. */
  facades?: PlanFacade[];
  /** A site plan: the way the front of the house faces, by the north arrow. */
  frontFaces?: Compass | null;
};

export const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
export type Compass = (typeof COMPASS)[number];
export type FacadeName = Compass | "front" | "rear" | "left" | "right";
export type PlanFacade = { facing: FacadeName; glassSqFt: number | null; windows: number | null };
export type PlanEnergy = {
  wallR: number | null;
  ceilingR: number | null;
  floorR: number | null;
  slabR: number | null;
  basementWallR: number | null;
  windowU: number | null;
  windowShgc: number | null;
  /** The air-leakage target the plans hold the house to, ACH50. */
  ach50: number | null;
  ductLocation: "conditioned" | "attic" | "crawl" | "basement" | null;
  /** Duct leakage target, CFM25 per 100 sq ft of floor. */
  ductLeakage: number | null;
};

export const FIXTURE_KEYS = ["toilet", "lavatory", "kitchenSink", "barSink", "laundrySink", "tub", "shower", "tubShower", "dishwasher", "washer", "waterHeater", "hoseBib", "iceMaker", "gasRange", "gasFireplace"] as const;
export type FixtureKey = (typeof FIXTURE_KEYS)[number];
export const DEVICE_KEYS = ["receptacle", "gfci", "switch", "light", "recessed", "fan", "exhaustFan", "smoke", "co", "exteriorLight", "dataTv", "evCharger"] as const;
export type DeviceKey = (typeof DEVICE_KEYS)[number];

// ── the cleaner ─────────────────────────────────────────────────────────────

const str = (v: unknown, max = 160): string | null => {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
};
const num = (v: unknown, lo: number, hi: number): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/,/g, "")) : NaN;
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
};
const count = (v: unknown, hi = 500): number => {
  const n = num(v, 0, hi);
  return n == null ? 0 : Math.round(n);
};
/** A length that may be "12'-6\"", 12.5, or "12 ft 6 in" → feet within a sane range. */
const lenFt = (v: unknown, lo = 1, hi = 400): number | null => {
  const f = typeof v === "number" ? v : feetOf(typeof v === "string" ? v : null);
  return f != null && f >= lo && f <= hi ? round(f, 2) : null;
};
const sqft = (v: unknown, lo = 4, hi = 40000): number | null => {
  const a = typeof v === "number" ? v : areaOf(typeof v === "string" ? v : null) ?? num(v, lo, hi);
  return a != null && a >= lo && a <= hi ? round(a, 1) : null;
};

/** "R-21", "R21", 21, "R-13+5ci" (cavity plus continuous, added) → 21 / 18; null when it does not read. */
export function rValueOf(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 && v <= 100 ? round(v, 1) : null;
  if (typeof v !== "string") return null;
  const t = v.toUpperCase().replace(/\s+/g, "");
  const parts = t.match(/R-?(\d+(?:\.\d+)?)(?:\+R?-?(\d+(?:\.\d+)?))?/) ?? t.match(/^(\d+(?:\.\d+)?)$/);
  if (!parts) return null;
  const total = Number(parts[1]) + (parts[2] ? Number(parts[2]) : 0);
  return Number.isFinite(total) && total > 0 && total <= 100 ? round(total, 1) : null;
}
/** "U-0.30", ".30", 0.3 → 0.3 (a window's U-factor); null outside 0.1–1.3. */
export function uValueOf(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number((v.match(/\d*\.\d+|\d+/) ?? [""])[0]) : NaN;
  return Number.isFinite(n) && n >= 0.1 && n <= 1.3 ? round(n, 2) : null;
}
const COMPASS_WORDS: Record<string, Compass> = { NORTH: "N", NORTHEAST: "NE", EAST: "E", SOUTHEAST: "SE", SOUTH: "S", SOUTHWEST: "SW", WEST: "W", NORTHWEST: "NW" };
/** "north", "N", "south-east", "SE", 135 (degrees) → a compass point; null when it does not read. */
export function compassOf(v: unknown): Compass | null {
  if (typeof v === "number" && Number.isFinite(v)) return COMPASS[Math.round((((v % 360) + 360) % 360) / 45) % 8];
  if (typeof v !== "string") return null;
  const t = v.toUpperCase().replace(/[^A-Z]/g, "");
  if (!t) return null;
  if ((COMPASS as readonly string[]).includes(t)) return t as Compass;
  return COMPASS_WORDS[t] ?? null;
}
function facadeName(v: unknown): FacadeName | null {
  const c = compassOf(v);
  if (c) return c;
  const t = typeof v === "string" ? v.toLowerCase() : "";
  if (/\bfront\b|\bstreet\b|\bentry\b/.test(t)) return "front";
  if (/\brear\b|\bback\b/.test(t)) return "rear";
  if (/\bleft\b/.test(t)) return "left";
  if (/\bright\b/.test(t)) return "right";
  const word = t.match(/\b(north|south|east|west)(?:\s*-?\s*(east|west))?\b/);
  return word ? compassOf(`${word[1]}${word[2] ?? ""}`) : null;
}
const firstNumber = (v: unknown): unknown => (typeof v === "string" ? (v.match(/\d*\.\d+|\d+/) ?? [""])[0] : v);
function energyOf(raw: unknown): PlanEnergy | undefined {
  const e = (raw && typeof raw === "object" ? raw : null) as Record<string, unknown> | null;
  if (!e) return undefined;
  const duct = str(e.ductLocation ?? e.ducts, 40)?.toLowerCase() ?? "";
  const out: PlanEnergy = {
    wallR: rValueOf(e.wallR ?? e.walls),
    ceilingR: rValueOf(e.ceilingR ?? e.ceiling ?? e.atticR),
    floorR: rValueOf(e.floorR ?? e.floor),
    slabR: rValueOf(e.slabR ?? e.slab),
    basementWallR: rValueOf(e.basementWallR ?? e.basementWall),
    windowU: uValueOf(e.windowU ?? e.uFactor),
    windowShgc: num(firstNumber(e.windowShgc ?? e.shgc), 0.1, 0.9),
    ach50: num(firstNumber(e.ach50), 0.5, 20),
    ductLocation: /condition|inside|interior|heated/.test(duct) ? "conditioned" : /attic/.test(duct) ? "attic" : /crawl/.test(duct) ? "crawl" : /basement/.test(duct) ? "basement" : null,
    ductLeakage: num(firstNumber(e.ductLeakage), 0.5, 20),
  };
  return Object.values(out).some((v) => v != null) ? out : undefined;
}
function facadesOf(raw: unknown): PlanFacade[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw
    .slice(0, 8)
    .map((x) => {
      const o = (x ?? {}) as Record<string, unknown>;
      const facing = facadeName(o.facing ?? o.name ?? o.side);
      if (!facing) return null;
      const g = o.glass ?? o.glassSqFt;
      const glassSqFt = typeof g === "number" ? (g >= 0 && g <= 3000 ? round(g, 1) : null) : sqft(g, 0, 3000);
      return { facing, glassSqFt, windows: num(o.windows ?? o.windowCount, 0, 80) };
    })
    .filter((x): x is PlanFacade => !!x);
  return out.length ? out : undefined;
}

function room(raw: Record<string, unknown>, sheetLevel: string | null): PlanRoom | null {
  const name = str(raw.name, 60);
  if (!name) return null;
  let widthFt = lenFt(raw.width ?? raw.widthFt, 2, 120);
  let lengthFt = lenFt(raw.length ?? raw.lengthFt ?? raw.depth, 2, 120);
  // A single "12'-0\" x 14'-0\"" string in `size`.
  if ((widthFt == null || lengthFt == null) && typeof raw.size === "string") {
    const parts = raw.size.replace(/[×]/g, "x").split(/\s*x\s*/i);
    if (parts.length === 2) {
      widthFt = widthFt ?? lenFt(parts[0], 2, 120);
      lengthFt = lengthFt ?? lenFt(parts[1], 2, 120);
    }
  }
  const written = sqft(raw.area ?? raw.areaSqFt, 4, 5000);
  const areaSqFt = written ?? (widthFt && lengthFt ? round(widthFt * lengthFt, 1) : null);
  return {
    name,
    level: str(raw.level, 30) ?? sheetLevel,
    widthFt,
    lengthFt,
    areaSqFt,
    ceilingFt: lenFt(raw.ceiling ?? raw.ceilingFt ?? raw.ceilingHeight, 6, 30),
    floor: str(raw.floor ?? raw.floorFinish, 40),
  };
}

function opening(raw: Record<string, unknown>, door: boolean): PlanOpening | null {
  let widthIn = openingInches(typeof raw.width === "number" ? raw.width : str(raw.width, 20)) ?? num(raw.widthIn, 6, 600);
  let heightIn = openingInches(typeof raw.height === "number" ? raw.height : str(raw.height, 20)) ?? num(raw.heightIn, 6, 300);
  if ((widthIn == null || heightIn == null) && typeof raw.size === "string") {
    const s = sizeOf(raw.size);
    if (s) {
      widthIn = widthIn ?? s.w;
      heightIn = heightIn ?? s.h;
    }
  }
  if (widthIn != null && (widthIn < 6 || widthIn > 600)) widthIn = null;
  if (heightIn != null && (heightIn < 6 || heightIn > 300)) heightIn = null;
  const n = count(raw.count ?? raw.qty ?? 1, 200);
  if (!n) return null;
  const o: PlanOpening = { tag: str(raw.tag ?? raw.mark, 12), widthIn, heightIn, count: n, type: str(raw.type, 60) };
  if (door) {
    const t = `${o.type ?? ""} ${o.tag ?? ""}`.toLowerCase();
    o.exterior = typeof raw.exterior === "boolean" ? raw.exterior : /\bext|entry|patio|slider|sliding glass|overhead|garage|french/.test(t);
  }
  return o;
}

const LEVEL_WORDS: Array<[RegExp, string]> = [
  [/basement|lower level|cellar/i, "Basement"],
  [/upper|second|2nd|loft/i, "Upper"],
  [/third|3rd/i, "Third"],
  [/main|first|1st|ground/i, "Main"],
];
export function levelName(v: unknown): string | null {
  const s = str(v, 40);
  if (!s) return null;
  for (const [re, name] of LEVEL_WORDS) if (re.test(s)) return name;
  return s;
}

/** Whatever the model answered for page `page`, as a SheetRead (never throws). */
export function cleanSheetRead(page: number, raw: unknown): SheetRead {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const kindRaw = str(r.kind, 20)?.toLowerCase() ?? "other";
  const kind = (SHEET_KINDS as readonly string[]).includes(kindRaw) ? (kindRaw as SheetKind) : "other";
  const level = levelName(r.level);
  const st = (r.stated ?? {}) as Record<string, unknown>;
  const ov = (r.overall ?? {}) as Record<string, unknown>;
  const rf = (r.roof ?? {}) as Record<string, unknown>;
  const fd = (r.foundation ?? {}) as Record<string, unknown>;
  const wl = (r.walls ?? {}) as Record<string, unknown>;
  const ex = (r.exterior ?? {}) as Record<string, unknown>;
  const mc = (r.mechanical ?? {}) as Record<string, unknown>;
  const pitch = pitchOf(typeof rf.pitch === "number" ? rf.pitch : str(rf.pitch, 20));
  const fx = (r.fixtures ?? {}) as Record<string, unknown>;
  const el = (r.electrical ?? {}) as Record<string, unknown>;
  const fixtures: SheetRead["fixtures"] = {};
  for (const k of FIXTURE_KEYS) {
    const n = count(fx[k], 60);
    if (n) fixtures[k] = n;
  }
  const electrical: SheetRead["electrical"] = {};
  for (const k of DEVICE_KEYS) {
    const n = count(el[k], 400);
    if (n) electrical[k] = n;
  }
  const amps = num(el.panelAmps, 60, 800);
  if (amps) electrical.panelAmps = Math.round(amps);
  const ftype = str(fd.type, 20)?.toLowerCase() ?? "";
  const foundationType = /slab/.test(ftype) ? "slab" : /crawl/.test(ftype) ? "crawlspace" : /basement/.test(ftype) ? "basement" : /pier|post/.test(ftype) ? "piers" : null;
  const rooms = (Array.isArray(r.rooms) ? r.rooms : []).slice(0, 80).map((x) => room((x ?? {}) as Record<string, unknown>, level)).filter((x): x is PlanRoom => !!x);
  const windows = (Array.isArray(r.windows) ? r.windows : []).slice(0, 60).map((x) => opening((x ?? {}) as Record<string, unknown>, false)).filter((x): x is PlanOpening => !!x);
  const doors = (Array.isArray(r.doors) ? r.doors : []).slice(0, 60).map((x) => opening((x ?? {}) as Record<string, unknown>, true)).filter((x): x is PlanOpening => !!x);
  const plateHeights = (Array.isArray(r.plateHeights) ? r.plateHeights : [])
    .slice(0, 6)
    .map((x) => {
      const o = (x ?? {}) as Record<string, unknown>;
      const h = lenFt(o.height ?? o.heightFt, 6, 30);
      const lv = levelName(o.level);
      return h && lv ? { level: lv, heightFt: h } : null;
    })
    .filter((x): x is { level: string; heightFt: number } => !!x);
  const conf = str(r.confidence, 10)?.toLowerCase();
  return {
    page,
    kind,
    title: str(r.title, 80) ?? `Sheet ${page}`,
    level,
    scale: str(r.scale, 40),
    project: { name: str((r.project as Record<string, unknown> | undefined)?.name, 80), address: str((r.project as Record<string, unknown> | undefined)?.address, 120) },
    stated: {
      livingSqFt: sqft(st.livingSqFt ?? st.living, 200, 30000),
      mainSqFt: sqft(st.mainSqFt ?? st.main, 100, 20000),
      upperSqFt: sqft(st.upperSqFt ?? st.upper, 100, 20000),
      basementSqFt: sqft(st.basementSqFt ?? st.basement, 100, 20000),
      garageSqFt: sqft(st.garageSqFt ?? st.garage, 100, 5000),
      porchSqFt: sqft(st.porchSqFt ?? st.porch, 10, 3000),
      deckSqFt: sqft(st.deckSqFt ?? st.deck, 10, 3000),
      drivewaySqFt: sqft(st.drivewaySqFt ?? st.driveway, 20, 20000),
      walksSqFt: sqft(st.walksSqFt ?? st.walks ?? st.walkSqFt, 5, 5000),
      patioSqFt: sqft(st.patioSqFt ?? st.patio, 5, 5000),
      lotSqFt: sqft(st.lotSqFt ?? st.lot, 1000, 2_000_000),
    },
    overall: { widthFt: lenFt(ov.width ?? ov.widthFt, 8, 300), depthFt: lenFt(ov.depth ?? ov.depthFt, 8, 300) },
    stories: num(r.stories, 1, 4),
    plateHeights,
    rooms,
    windows,
    doors,
    roof: {
      pitch: pitch ? `${pitch.rise}:12` : null,
      factor: pitch?.factor ?? null,
      style: str(rf.style, 30),
      material: str(rf.material, 60),
      overhangIn: inchesOf(typeof rf.overhang === "number" ? rf.overhang : str(rf.overhang ?? rf.overhangIn, 20)),
      areaSqFt: sqft(rf.area ?? rf.areaSqFt, 100, 40000),
      planAreaSqFt: sqft(rf.planArea ?? rf.planAreaSqFt, 100, 40000),
    },
    foundation: {
      type: foundationType,
      footingWidthIn: inchesOf(typeof fd.footingWidth === "number" ? fd.footingWidth : str(fd.footingWidth ?? fd.footingWidthIn, 20)),
      footingDepthIn: inchesOf(typeof fd.footingDepth === "number" ? fd.footingDepth : str(fd.footingDepth ?? fd.footingDepthIn, 20)),
      wallHeightFt: lenFt(fd.wallHeight ?? fd.wallHeightFt, 0.5, 14),
      slabIn: inchesOf(typeof fd.slab === "number" ? fd.slab : str(fd.slab ?? fd.slabIn, 20)),
    },
    walls: { exteriorFraming: str(wl.exteriorFraming, 40), interiorFraming: str(wl.interiorFraming, 40), exteriorLf: lenFt(wl.exteriorLf, 20, 2000) },
    exterior: { siding: str(ex.siding, 60), trim: str(ex.trim, 60), gutters: str(ex.gutters, 60) },
    fixtures,
    electrical,
    mechanical: {
      system: str(mc.system, 60),
      tons: num(mc.tons, 0.5, 20),
      furnaceBtu: num(mc.furnaceBtu, 10000, 300000),
      waterHeater: str(mc.waterHeater, 60),
      heatLoadBtu: num(typeof mc.heatLoadBtu === "string" ? Number(String(mc.heatLoadBtu).replace(/[^0-9.]/g, "")) : mc.heatLoadBtu ?? mc.heatLoad, 5000, 400000),
      systems: num(mc.systems ?? mc.outdoorUnits, 1, 6),
    },
    notes: (Array.isArray(r.notes) ? r.notes : []).map((n) => str(n, 200)).filter((n): n is string => !!n).slice(0, 20),
    confidence: conf === "high" || conf === "low" ? conf : "medium",
    ...(energyOf(r.energy) ? { energy: energyOf(r.energy) } : {}),
    ...(facadesOf(r.facades) ? { facades: facadesOf(r.facades) } : {}),
    ...(compassOf(r.frontFaces) ? { frontFaces: compassOf(r.frontFaces) } : {}),
  };
}
