// SIZES & MEASUREMENTS FROM THE PLANS (owner, 2026-10-21: "in the blueprint estimator make an option to extract the
// sizes of anything in the plan — room sizes by name, sq ft, anything — so I need an estimate OR the sizes and
// measurements; make it smart and downloadable in PDF"). Everything the sheets were read for, laid out as a takeoff
// sheet a contractor reads: every room by floor with its size and area, the floors, the walls, the roof and its
// edges, the foundation, the site, the window and door schedules, the fixtures and devices, the energy values, and
// the work quantities the build list measured (drywall, paint, trim, flooring…) — each with the sheet it rests on and
// whether the plans say it, it was worked out from them, or it is assumed. A typed request ("the master closet", "the
// baseboard") adds what was measured on the sheets for it. Pure, browser-safe: the screen, the CSV and the PDF all
// draw from one report.
import type { FoundRow } from "./ask";
import type { PlanOpening, SheetRead } from "./sheet";
import { eaveLf, mechOf, PLAN_TRADES, rakeLf, ridgeLf, roofArea, roofPlanArea, TRADE_LABEL, type Takeoff, type TakeoffSource } from "./takeoff";

export type MeasureSource = TakeoffSource | "measured";

export const MEASURE_SOURCE_WORD: Record<MeasureSource, string> = {
  plan: "On the plans",
  derived: "Worked out",
  rule: "Assumed",
  entered: "Entered",
  measured: "Measured on the sheets",
};

export type MeasureRow = {
  label: string;
  /** As a contractor writes it: "1,842 sq ft", "12'-6\" × 14'-0\"", "6/12", "R-21". */
  value: string;
  pages: number[];
  source: MeasureSource;
  /** How it was arrived at, in a few words. */
  note?: string;
};

export const SECTION_KEYS = ["areas", "rooms", "walls", "roof", "foundation", "site", "windows", "doors", "plumbing", "electrical", "mechanical", "energy", "work"] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export const SECTION_TITLE: Record<SectionKey, string> = {
  areas: "Floor areas",
  rooms: "Rooms",
  walls: "Walls & exterior",
  roof: "Roof",
  foundation: "Foundation",
  site: "Site",
  windows: "Windows",
  doors: "Doors",
  plumbing: "Plumbing fixtures",
  electrical: "Electrical",
  mechanical: "Heating, cooling & water heating",
  energy: "Insulation & energy",
  work: "Work quantities",
};

/** `key`: a SectionKey for the sizes; the materials list (lib/plans/materialsReport) keys its own sections. */
export type MeasureSection = { key: SectionKey | (string & {}); title: string; rows: MeasureRow[] };

export type RoomRow = {
  level: string;
  name: string;
  /** "12'-6\" × 14'-0\"" — null when the plans give no size. */
  size: string | null;
  areaSqFt: number | null;
  ceiling: string | null;
  floor: string | null;
  /** No size on the plans: the area is shared out from the floor's (flagged, never passed off as read). */
  estimated: boolean;
  pages: number[];
};

export type MeasureReport = {
  name: string | null;
  address: string | null;
  sheets: number;
  /** The figures a reader looks for first. */
  summary: Array<{ label: string; value: string }>;
  rooms: RoomRow[];
  sections: MeasureSection[];
  /** What the contractor asked to have measured, measured on the sheets. */
  asked: { request: string; rows: MeasureRow[] } | null;
  /** What to check: rooms with no size, areas that disagree. */
  checks: string[];
};

// ── the words ─────────────────────────────────────────────────────────────

/** 12.5 → 12'-6"; 12 → 12'-0". */
export function ftIn(ft: number): string {
  let f = Math.floor(ft);
  let i = Math.round((ft - f) * 12);
  if (i === 12) {
    f += 1;
    i = 0;
  }
  return `${f}'-${i}"`;
}
/** 30 in → 2'-6". */
const inFt = (inches: number) => ftIn(inches / 12);
const n0 = (n: number) => Math.round(n).toLocaleString("en-US");
const n1 = (n: number) => (Number.isInteger(n) ? n.toLocaleString("en-US") : (Math.round(n * 10) / 10).toLocaleString("en-US"));
const sqft = (n: number) => `${n0(n)} sq ft`;
const lf = (n: number) => `${n0(n)} LF`;
const uniq = (a: number[]) => Array.from(new Set(a)).sort((x, y) => x - y);
const fromWords = (from: string): MeasureSource => (/entered/i.test(from) ? "entered" : /stated|overall|exterior walls stated/i.test(from) ? "plan" : "derived");
const pagesIn = (words: string) => uniq(Array.from(words.matchAll(/p\. ?(\d+)/g)).map((m) => Number(m[1])));

const UNIT_WORD: Record<string, string> = { "sq ft": "sq ft", "linear ft": "LF", each: "each", "cu yards": "cu yd", squares: "squares", sheets: "sheets", tons: "tons", boxes: "boxes", bundles: "bundles", rolls: "rolls", gallons: "gal", bags: "bags", pieces: "pieces", "sq yd": "sq yd", sets: "sets", buckets: "buckets", tubes: "tubes", lot: "lot" };

const FIXTURE_WORD: Record<string, string> = {
  toilet: "Toilets", lavatory: "Bathroom sinks", kitchenSink: "Kitchen sinks", barSink: "Bar sinks", laundrySink: "Laundry sinks", tub: "Tubs", shower: "Showers",
  tubShower: "Tub / showers", dishwasher: "Dishwashers", washer: "Washer boxes", waterHeater: "Water heaters", hoseBib: "Hose bibs", iceMaker: "Ice-maker boxes", gasRange: "Gas ranges", gasFireplace: "Gas fireplaces",
};
const DEVICE_WORD: Record<string, string> = {
  receptacle: "Receptacles", gfci: "GFCI receptacles", switch: "Switches", light: "Light fixtures", recessed: "Recessed lights", fan: "Ceiling fans", exhaustFan: "Exhaust fans",
  smoke: "Smoke detectors", co: "CO detectors", exteriorLight: "Exterior lights", dataTv: "Data / TV outlets", evCharger: "EV chargers", panelAmps: "Panel",
};

function openingRows(list: PlanOpening[], what: "window" | "door"): { rows: MeasureRow[]; count: number; glass: number } {
  let count = 0;
  let glass = 0;
  const rows = list.map((o) => {
    count += o.count;
    const size = o.widthIn && o.heightIn ? `${inFt(o.widthIn)} × ${inFt(o.heightIn)}` : o.widthIn ? `${inFt(o.widthIn)} wide` : "size not given";
    if (what === "window" && o.widthIn && o.heightIn) glass += (o.widthIn * o.heightIn * o.count) / 144;
    const kind = [o.type, what === "door" && o.exterior ? "exterior" : null].filter(Boolean).join(", ");
    return { label: `${o.tag ? `${o.tag} · ` : ""}${kind || (what === "window" ? "Window" : "Door")}`, value: `${size} · ${o.count} ${o.count === 1 ? "each" : "of them"}`, pages: [], source: "plan" as const };
  });
  return { rows, count, glass };
}

/** The report, from the takeoff of every sheet read (and what was measured for a request). */
export function measureReport(takeoff: Takeoff, sheets: SheetRead[], asked?: { request: string; rows: FoundRow[] } | null): MeasureReport {
  const h = takeoff.house;
  const pageOf = (pred: (s: SheetRead) => boolean) => uniq(sheets.filter(pred).map((s) => s.page));
  const sections: MeasureSection[] = [];
  const add = (key: SectionKey, rows: MeasureRow[]) => {
    const kept = rows.filter((r) => r.value);
    if (kept.length) sections.push({ key, title: SECTION_TITLE[key], rows: kept });
  };

  // ── floor areas
  const areaRows: MeasureRow[] = [];
  if (h.livingSqFt) areaRows.push({ label: "Living area (heated)", value: sqft(h.livingSqFt), pages: pagesIn(h.livingFrom), source: fromWords(h.livingFrom), note: h.livingFrom });
  for (const l of h.levels) {
    areaRows.push({ label: `${l.name} floor`, value: sqft(l.areaSqFt), pages: l.pages, source: fromWords(l.areaFrom), note: l.areaFrom });
    if (l.overallSqFt) areaRows.push({ label: `${l.name} floor · overall outline`, value: sqft(l.overallSqFt), pages: l.pages, source: "plan", note: "the overall outside dimensions multiplied" });
  }
  if (h.garage) areaRows.push({ label: "Garage", value: `${sqft(h.garage.areaSqFt)}${h.garage.widthFt && h.garage.depthFt ? ` · ${ftIn(h.garage.widthFt)} × ${ftIn(h.garage.depthFt)}` : ""}`, pages: h.garage.pages, source: "plan" });
  if (h.porchSqFt) areaRows.push({ label: "Covered porch", value: sqft(h.porchSqFt), pages: pageOf((s) => !!s.stated.porchSqFt), source: "plan" });
  if (h.deckSqFt) areaRows.push({ label: "Deck", value: sqft(h.deckSqFt), pages: pageOf((s) => !!s.stated.deckSqFt), source: "plan" });
  if (h.overGarageSqFt) areaRows.push({ label: "Floor over the garage", value: sqft(h.overGarageSqFt), pages: h.garage?.pages ?? [], source: "derived" });
  if (h.footprintSqFt) areaRows.push({ label: "Footprint (ground floor + garage + porch)", value: sqft(h.footprintSqFt), pages: [], source: "derived", note: "what the foundation and the roof cover" });
  const stories = sheets.map((s) => s.stories).find((x) => x != null);
  if (stories) areaRows.push({ label: "Stories", value: n1(stories), pages: pageOf((s) => s.stories != null), source: "plan" });
  add("areas", areaRows);

  // ── rooms, floor by floor
  const rooms: RoomRow[] = [];
  for (const l of h.levels) {
    for (const r of l.rooms) {
      // The garage's own figures when its room carries none (the plans state the garage apart from the rooms).
      const g = /garage/i.test(r.name) && h.garage && !r.areaSqFt ? h.garage : null;
      const w = r.widthFt ?? g?.widthFt ?? null;
      const d = r.lengthFt ?? g?.depthFt ?? null;
      rooms.push({
        level: l.name,
        name: r.name,
        size: w && d ? `${ftIn(w)} × ${ftIn(d)}` : null,
        areaSqFt: r.areaSqFt != null ? Math.round(r.areaSqFt) : g ? Math.round(g.areaSqFt) : null,
        ceiling: r.ceilingFt ? ftIn(r.ceilingFt) : null,
        floor: r.floor,
        estimated: !!r.estimated,
        pages: l.pages,
      });
    }
  }

  // ── walls
  const wallRows: MeasureRow[] = [];
  let wallArea = 0;
  for (const l of h.levels) {
    wallRows.push({ label: `${l.name} floor · exterior walls`, value: lf(l.perimeterLf), pages: pagesIn(l.perimeterFrom).length ? pagesIn(l.perimeterFrom) : l.pages, source: fromWords(l.perimeterFrom), note: l.perimeterFrom });
    wallRows.push({ label: `${l.name} floor · wall height (plate)`, value: ftIn(l.plateFt), pages: l.pages, source: l.plateFrom });
    wallArea += l.perimeterLf * l.plateFt;
  }
  if (wallArea) wallRows.push({ label: "Exterior wall area, gross (openings not taken out)", value: sqft(wallArea), pages: [], source: "derived", note: "each floor's exterior walls × its wall height" });
  const framing = sheets.map((s) => s.walls.exteriorFraming).find(Boolean);
  if (framing) wallRows.push({ label: "Exterior framing", value: framing, pages: pageOf((s) => s.walls.exteriorFraming === framing), source: "plan" });
  const inner = sheets.map((s) => s.walls.interiorFraming).find(Boolean);
  if (inner) wallRows.push({ label: "Interior framing", value: inner, pages: pageOf((s) => s.walls.interiorFraming === inner), source: "plan" });
  if (h.siding) wallRows.push({ label: "Siding", value: h.siding, pages: pageOf((s) => !!s.exterior.siding), source: "plan" });
  const trim = sheets.map((s) => s.exterior.trim).find(Boolean);
  if (trim) wallRows.push({ label: "Exterior trim", value: trim, pages: pageOf((s) => s.exterior.trim === trim), source: "plan" });
  add("walls", wallRows);

  // ── roof
  const roofRows: MeasureRow[] = [];
  const roofPages = pageOf((s) => s.kind === "roof" || !!s.roof.pitch || !!s.roof.areaSqFt);
  roofRows.push({ label: "Pitch", value: `${n1(h.roof.rise)}/12`, pages: roofPages, source: h.roof.pitchFrom });
  if (h.roof.style) roofRows.push({ label: "Style", value: h.roof.style, pages: roofPages, source: "plan" });
  if (h.roof.material) roofRows.push({ label: "Roofing", value: h.roof.material, pages: roofPages, source: "plan" });
  roofRows.push({ label: "Overhang", value: inFt(h.roof.overhangIn), pages: roofPages, source: h.roof.overhangFrom });
  const plan = roofPlanArea(h);
  const surface = roofArea(h);
  roofRows.push({ label: "Roof area, flat (plan view, overhangs in)", value: sqft(plan), pages: h.roof.planAreaSqFt ? roofPages : [], source: h.roof.planAreaSqFt ? "plan" : "derived" });
  roofRows.push({ label: "Roof area, on the slope", value: `${sqft(surface)} · ${n1(Math.round(surface / 10) / 10)} squares`, pages: h.roof.statedAreaSqFt ? roofPages : [], source: h.roof.statedAreaSqFt ? "plan" : "derived", note: h.roof.statedAreaSqFt ? undefined : `flat area × ${h.roof.factor.toFixed(3)} for the pitch` });
  const eaves = eaveLf(h);
  const ridge = ridgeLf(h);
  const rakes = rakeLf(h);
  if (eaves) roofRows.push({ label: "Eaves (gutter run)", value: lf(eaves), pages: [], source: "derived", note: "from the outline and the overhang" });
  if (ridge) roofRows.push({ label: "Ridge", value: lf(ridge), pages: [], source: "derived" });
  if (rakes) roofRows.push({ label: "Rakes", value: lf(rakes), pages: [], source: "derived" });
  add("roof", roofRows);

  // ── foundation
  const f = h.foundation;
  const ground = h.levels.find((l) => l.name === "Main") ?? h.levels[0];
  const fdPages = pageOf((s) => s.kind === "foundation" || !!s.foundation.type);
  const fdRows: MeasureRow[] = [{ label: "Type", value: f.type, pages: fdPages, source: f.from }];
  if (ground) fdRows.push({ label: "Perimeter (foundation walls / footings)", value: lf(ground.perimeterLf + (h.garage && !h.garageInOutline ? 2 * (h.garage.depthFt ?? Math.sqrt(h.garage.areaSqFt)) : 0)), pages: ground.pages, source: "derived" });
  fdRows.push({ label: "Footing", value: `${f.footingWidthIn}" wide × ${f.footingDepthIn}" deep`, pages: fdPages, source: fdPages.length ? "plan" : "rule" });
  if (f.type === "basement" || f.type === "crawlspace") fdRows.push({ label: "Foundation wall height", value: ftIn(f.wallHeightFt), pages: fdPages, source: fdPages.length ? "plan" : "rule" });
  if (f.type === "slab" || f.type === "basement") fdRows.push({ label: "Slab", value: `${f.slabIn}" thick`, pages: fdPages, source: fdPages.length ? "plan" : "rule" });
  add("foundation", fdRows);

  // ── site
  const st = h.site;
  const sitePages = pageOf((s) => s.kind === "site");
  add("site", [
    ...(st.lotSqFt ? [{ label: "Lot", value: `${sqft(st.lotSqFt)} · ${n1(Math.round((st.lotSqFt / 43560) * 100) / 100)} acres`, pages: sitePages, source: "plan" as const }] : []),
    ...(st.drivewaySqFt ? [{ label: "Driveway and approach", value: sqft(st.drivewaySqFt), pages: sitePages, source: "plan" as const }] : []),
    ...(st.walksSqFt ? [{ label: "Walks", value: sqft(st.walksSqFt), pages: sitePages, source: "plan" as const }] : []),
    ...(st.patioSqFt ? [{ label: "Patios", value: sqft(st.patioSqFt), pages: sitePages, source: "plan" as const }] : []),
  ]);

  // ── windows and doors
  const schedPages = (what: "windows" | "doors") => pageOf((s) => s[what].length > 0);
  const win = openingRows(h.windows, "window");
  if (win.rows.length) add("windows", [{ label: "Windows in all", value: `${n0(win.count)}${win.glass ? ` · ${sqft(win.glass)} of glass` : ""}`, pages: schedPages("windows"), source: "plan" }, ...win.rows.map((r) => ({ ...r, pages: schedPages("windows") }))]);
  const door = openingRows(h.doors, "door");
  if (door.rows.length) {
    const ext = h.doors.filter((d) => d.exterior).reduce((a, d) => a + d.count, 0);
    add("doors", [{ label: "Doors in all", value: `${n0(door.count)}${ext ? ` · ${ext} exterior` : ""}`, pages: schedPages("doors"), source: "plan" }, ...door.rows.map((r) => ({ ...r, pages: schedPages("doors") }))]);
  }

  // ── fixtures, devices, mechanical
  add("plumbing", Object.entries(h.fixtures).filter(([, v]) => v > 0).map(([k, v]) => ({ label: FIXTURE_WORD[k] ?? k, value: n0(v), pages: pageOf((s) => (s.fixtures as Record<string, number | undefined>)[k] != null), source: h.fixturesFrom })));
  add("electrical", Object.entries(h.electrical).filter(([, v]) => v > 0).map(([k, v]) => ({ label: DEVICE_WORD[k] ?? k, value: k === "panelAmps" ? `${n0(v)} A` : n0(v), pages: pageOf((s) => (s.electrical as Record<string, number | undefined>)[k] != null), source: h.electricalFrom })));
  const mech = mechOf(sheets);
  const mechPages = pageOf((s) => s.kind === "mechanical" || !!s.mechanical.system || !!s.mechanical.tons);
  add("mechanical", [
    ...(mech?.system ? [{ label: "System", value: mech.system, pages: mechPages, source: "plan" as const }] : []),
    ...(mech?.tons ? [{ label: "Cooling", value: `${n1(mech.tons)} tons`, pages: mechPages, source: "plan" as const }] : []),
    ...(mech?.systems ? [{ label: "Systems", value: n0(mech.systems), pages: mechPages, source: "plan" as const }] : []),
    ...(mech?.furnaceBtu ? [{ label: "Furnace", value: `${n0(mech.furnaceBtu)} Btu/h`, pages: mechPages, source: "plan" as const }] : []),
    ...(mech?.heatLoadBtu ? [{ label: "Design heat load", value: `${n0(mech.heatLoadBtu)} Btu/h`, pages: mechPages, source: "plan" as const }] : []),
    ...(mech?.waterHeater ? [{ label: "Water heater", value: mech.waterHeater, pages: mechPages, source: "plan" as const }] : []),
    ...(takeoff.hvac ? [{ label: "Heating / cooling load (Manual J-style)", value: `${n0(takeoff.hvac.heatingBtuh)} heat / ${n0(takeoff.hvac.coolingTotalBtuh)} cool Btu/h`, pages: [], source: "derived" as const }] : []),
  ]);
  const e = h.energy;
  const ePages = pageOf((s) => !!s.energy);
  if (e) {
    const r = (label: string, v: number | null, fmt: (x: number) => string) => (v != null ? [{ label, value: fmt(v), pages: ePages, source: "plan" as const }] : []);
    add("energy", [
      ...r("Walls", e.wallR, (x) => `R-${n1(x)}`),
      ...r("Ceiling / attic", e.ceilingR, (x) => `R-${n1(x)}`),
      ...r("Floor", e.floorR, (x) => `R-${n1(x)}`),
      ...r("Slab edge", e.slabR, (x) => `R-${n1(x)}`),
      ...r("Basement walls", e.basementWallR, (x) => `R-${n1(x)}`),
      ...r("Windows (U-factor)", e.windowU, (x) => `U-${x}`),
      ...r("Windows (SHGC)", e.windowShgc, (x) => String(x)),
      ...r("Air leakage target", e.ach50, (x) => `${n1(x)} ACH50`),
    ]);
  }

  // ── the work quantities the build list measured (not the purchase units)
  const work: MeasureRow[] = [];
  for (const t of PLAN_TRADES) {
    for (const i of takeoff.items.filter((x) => x.trade === t && x.role !== "material" && x.qty > 0)) {
      work.push({ label: `${TRADE_LABEL[t]} · ${i.label}`, value: `${n1(i.qty)} ${UNIT_WORD[i.unit] ?? i.unit}`, pages: i.pages, source: i.measured ? "measured" : i.source, note: i.basis });
    }
  }
  add("work", work);

  // ── what was asked
  const askedRows = asked
    ? asked.rows.map((r): MeasureRow => ({ label: r.label, value: r.qty != null ? `${n1(r.qty)} ${UNIT_WORD[r.unit] ?? r.unit}` : "not found on the sheets", pages: r.pages, source: r.status === "measured" ? "measured" : r.status === "kept" ? "derived" : "rule", note: r.asWritten }))
    : [];

  const est = rooms.filter((r) => r.estimated).length;
  const checks = [
    ...(est ? [`${est} room${est === 1 ? " has" : "s have"} no size on the plans — ${est === 1 ? "its" : "their"} area is shared out from the floor's and marked "est."; measure on site before ordering.`] : []),
    ...takeoff.checks.filter((c) => c.level === "warn").map((c) => c.text),
  ];

  const summary = [
    ...(h.livingSqFt ? [{ label: "Living area", value: sqft(h.livingSqFt) }] : []),
    ...(h.levels.length ? [{ label: h.levels.length === 1 ? "Floor" : "Floors", value: h.levels.map((l) => `${l.name} ${n0(l.areaSqFt)}`).join(" · ") }] : []),
    ...(rooms.length ? [{ label: "Rooms", value: n0(rooms.length) }] : []),
    ...(h.garage ? [{ label: "Garage", value: sqft(h.garage.areaSqFt) }] : []),
    { label: "Roof on the slope", value: sqft(surface) },
    ...(win.count ? [{ label: "Windows", value: n0(win.count) }] : []),
    ...(door.count ? [{ label: "Doors", value: n0(door.count) }] : []),
    ...(st.lotSqFt ? [{ label: "Lot", value: sqft(st.lotSqFt) }] : []),
  ];

  return { name: h.name, address: h.address, sheets: takeoff.sheets, summary, rooms, sections, asked: asked ? { request: asked.request, rows: askedRows } : null, checks };
}

/** Only what matches the words ("kitchen", "closet", "window", "roof") — a section whose title matches keeps all of it. */
export function filterReport(r: MeasureReport, query: string): MeasureReport {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return r;
  const hit = (...texts: Array<string | null | undefined>) => {
    const t = texts.filter(Boolean).join(" ").toLowerCase();
    return words.every((w) => t.includes(w));
  };
  return {
    ...r,
    rooms: hit(SECTION_TITLE.rooms, "room") ? r.rooms : r.rooms.filter((x) => hit(x.name, x.level, x.floor, x.size)),
    sections: r.sections
      .map((s) => (hit(s.title) ? s : { ...s, rows: s.rows.filter((x) => hit(x.label, x.value, x.note)) }))
      .filter((s) => s.rows.length),
    asked: r.asked ? { ...r.asked, rows: r.asked.rows.filter((x) => hit(x.label, x.value, x.note, r.asked?.request)) } : null,
  };
}

/** The section the screen opens on first ("Windows" chip → windows). */
export function withFirst(r: MeasureReport, key: SectionKey | null): MeasureReport {
  if (!key || key === "rooms") return r;
  return { ...r, sections: [...r.sections.filter((s) => s.key === key), ...r.sections.filter((s) => s.key !== key)] };
}

/** The report as a spreadsheet: one row a measurement. */
export function reportCsv(r: MeasureReport): string {
  const cell = (v: string | number) => {
    const t = String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const head = ["Section", "Item", "Measurement", "Area (sq ft)", "Source", "How", "Plan pages"];
  const rows: Array<Array<string | number>> = [
    ...(r.asked?.rows ?? []).map((x) => ["You asked", x.label, x.value, "", MEASURE_SOURCE_WORD[x.source], x.note ?? "", x.pages.join(" ")]),
    ...r.rooms.map((x) => [`Rooms · ${x.level}`, x.name, x.size ?? "", x.areaSqFt ?? "", x.estimated ? "Assumed (est.)" : "On the plans", [x.ceiling ? `ceiling ${x.ceiling}` : "", x.floor ?? ""].filter(Boolean).join(", "), x.pages.join(" ")]),
    ...r.sections.flatMap((s) => s.rows.map((x) => [s.title, x.label, x.value, "", MEASURE_SOURCE_WORD[x.source], x.note ?? "", x.pages.join(" ")])),
  ];
  return "﻿" + [head, ...rows].map((row) => row.map(cell).join(",")).join("\r\n");
}
