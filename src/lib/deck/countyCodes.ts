// THE COUNTY'S OWN DESIGN VALUES (2026-10-20) — pure.
//
// Owner: "check the deck estimator for the local codes, per state and per the
// biggest counties." The state names the code (lib/deck/stateCodes); the
// county — or the city that issues the permits there — fills in the code's
// Table R301.2(1), "Climatic and geographic design criteria": the frost line,
// the ground snow, the wind, the seismic category, the termite and decay
// hazard, and it publishes its own deck rules (a handout, typical details,
// what a deck permit must show). Those are the numbers a plan reviewer checks
// the drawings against.
//
// COUNTY_CODES (countyCodes.data.ts) carries the three most populous counties
// of every state, each figure read from the jurisdiction's own published page
// or the adopted code — with the source — and null where none was found. The
// research date is RESEARCHED_ON; every line still says to confirm with the
// building department, because a city inside a county may publish its own.

import { COUNTY_CODES, COUNTY_RESEARCHED_ON } from "./countyCodes.data";
import type { DeckStructure } from "./structure";
import { TERMITE_LABEL } from "./site";
import { USGS_SOURCE } from "./seismic";

/**
 * A city inside the county that issues its own permits with its own figures (2026-10-28, owner: "does it adapt
 * per state, per city — Sacramento?"). The City of Sacramento reads 110 mph and SDC D0 where the County reads 95;
 * its plan check is electronic only with its own sheet rules. Whatever the city leaves out comes from the county.
 */
export interface DeckCityCode {
  city: string;
  jurisdiction: string;
  edition?: string | null;
  frostIn?: number | null;
  groundSnowPsf?: number | null;
  windMph?: number | null;
  windBasis?: string | null;
  sdc?: string | null;
  weathering?: string | null;
  termite?: string | null;
  /** The smallest site-plan scale the department accepts, feet per inch (8 = 1/8 in. = 1 ft). */
  minSiteScaleFtPerIn?: number | null;
  deckNotes?: string[];
  note?: string | null;
  sources?: Array<{ title: string; url: string }>;
}

export type CriteriaField = "edition" | "frostIn" | "groundSnowPsf" | "windMph" | "sdc" | "termite" | "weathering";

export interface DeckCountyCode {
  state: string;
  /** "Harris County", "Orleans Parish", "Anchorage Municipality", "New York City (5 boroughs)". */
  county: string;
  fips: string | null;
  /** Who publishes these figures: the county's building department, or the main city's. */
  jurisdiction: string;
  /** The city the figures were read for, when a city's own entry answered (countyCodeFor with a city). */
  city?: string | null;
  /** Cities in the county with figures and rules of their own. */
  cities?: DeckCityCode[];
  /** The smallest site-plan scale the department accepts, feet per inch; null when it names none. */
  minSiteScaleFtPerIn?: number | null;
  /** Where a figure came from when not from `jurisdiction`: typed by the contractor, the USGS (jurisdictionFor). */
  fieldSources?: Partial<Record<CriteriaField, string>>;
  /** The code edition enforced there for one- and two-family dwellings. */
  edition: string | null;
  frostIn: number | null;
  groundSnowPsf: number | null;
  windMph: number | null;
  windBasis: string | null;
  /** Seismic design category: A, B, C, D0, D1, D2, E. */
  sdc: string | null;
  weathering: string | null;
  termite: string | null;
  /** The department's own deck rules, one plain sentence each. */
  deckNotes: string[];
  /** What is uncertain about the figures. */
  note: string | null;
  sources: Array<{ title: string; url: string }>;
  confidence: "high" | "medium" | "low";
}

export const RESEARCHED_ON = COUNTY_RESEARCHED_ON;

/** "Harris County" / "harris" / "Orleans Parish" / "St. Louis city" → a key part. */
export function countyKey(name: string | null | undefined): string {
  return (name ?? "")
    .toLowerCase()
    // "Denver (City and County of Denver)" → "denver"; "City and County of Denver" → "denver".
    .replace(/\(.*?\)/g, "")
    .replace(/\bcity and county of\b/g, "")
    .replace(/\b(county|parish|borough|municipality|city and borough|census area|municipio)\b/g, "")
    .replace(/\bsaint\b/g, "st")
    .replace(/[^a-z0-9]+/g, "");
}

const BY_KEY = new Map<string, DeckCountyCode>();
for (const c of COUNTY_CODES) {
  BY_KEY.set(`${c.state}:${countyKey(c.county)}`, c);
  if (c.fips) BY_KEY.set(`fips:${c.fips}`, c);
}
// New York City's five boroughs answer to one entry.
const NYC = COUNTY_CODES.find((c) => c.state === "NY" && /new york city/i.test(c.county));
if (NYC) for (const b of ["new york", "kings", "queens", "bronx", "richmond"]) BY_KEY.set(`NY:${countyKey(b)}`, NYC);

/** "City of Sacramento" / "SACRAMENTO" / "Sacramento city" → a key part. */
export const cityKey = (name: string | null | undefined): string =>
  (name ?? "")
    .toLowerCase()
    .replace(/\b(city of|town of|village of)\b/g, "")
    .replace(/\b(city|town|village)\b/g, "")
    .replace(/[^a-z0-9]+/g, "");

/**
 * The county's own figures, when it is one of the counties on file — and the city's over them when the address
 * lies in a city that has its own entry: its jurisdiction, edition, figures, deck rules and sources take the
 * county's place, line by line, where the city names them.
 */
export function countyCodeFor(state: string | null | undefined, county: string | null | undefined, city?: string | null): DeckCountyCode | null {
  const st = (state ?? "").trim().toUpperCase();
  if (!st || !county) return null;
  const base = BY_KEY.get(`${st}:${countyKey(county)}`) ?? null;
  if (!base) return null;
  const ck = cityKey(city);
  const c = ck ? base.cities?.find((x) => cityKey(x.city) === ck) : undefined;
  if (!c) return base;
  const { cities: _cities, ...rest } = base;
  void _cities;
  return {
    ...rest,
    city: c.city,
    jurisdiction: c.jurisdiction,
    edition: c.edition ?? base.edition,
    frostIn: c.frostIn ?? base.frostIn,
    groundSnowPsf: c.groundSnowPsf ?? base.groundSnowPsf,
    windMph: c.windMph ?? base.windMph,
    windBasis: c.windMph != null ? c.windBasis ?? null : base.windBasis,
    sdc: c.sdc ?? base.sdc,
    weathering: c.weathering ?? base.weathering,
    termite: c.termite ?? base.termite,
    minSiteScaleFtPerIn: c.minSiteScaleFtPerIn ?? base.minSiteScaleFtPerIn ?? null,
    deckNotes: c.deckNotes ?? base.deckNotes,
    note: c.note ?? base.note,
    sources: [...(c.sources ?? []), ...base.sources],
  };
}

/** The architect's fraction where there is one ("1/8 in. = 1 ft" is 8 ft to the inch), the engineer's "1 in. = 20 ft" otherwise. */
export function siteScaleWords(ftPerIn: number): string {
  return ftPerIn === 4 || ftPerIn === 8 || ftPerIn === 16 ? `1/${ftPerIn} in. = 1 ft` : `1 in. = ${ftPerIn} ft`;
}

/**
 * The department asks site plans at a scale this lot cannot keep on the 11 × 17 sheet: said before the submittal,
 * not by the reviewer (the City of Sacramento asks 1/8 in. = 1 ft or larger; a 100-ft lot needs 1 in. = 20 ft).
 */
export function siteScaleWarning(county: DeckCountyCode | null, scaleFtPerIn: number): string | null {
  const min = county?.minSiteScaleFtPerIn;
  if (!county || !min || scaleFtPerIn <= min) return null;
  const who = county.jurisdiction.split(/ \(| — /)[0];
  return `${who} asks the site plan at ${siteScaleWords(min)} or larger; this lot fits the 11 × 17 sheet only at ${siteScaleWords(scaleFtPerIn)}. Note the scale on A-101 and ask plan check to accept it, or print A-101 alone on 24 × 36.`;
}

/**
 * THE DEPARTMENT'S OWN FIGURES, TYPED (2026-10-28, owner: "it has to adapt for any state and city"). Most of the
 * country's cities are not on file; their Table R301.2 and submittal sheet are a phone call away, and the contractor
 * types what they say. Every typed figure wins over the one on file and is marked as typed on the sheets.
 */
export interface TypedJurisdiction {
  department: string;
  edition: string;
  windMph: number | null;
  sdc: string;
  frostIn: number | null;
  groundSnowPsf: number | null;
  termite: string;
  weathering: string;
  /** The department's own rules, one each, for the general notes. */
  notes: string[];
}
export const EMPTY_JURISDICTION: TypedJurisdiction = { department: "", edition: "", windMph: null, sdc: "", frostIn: null, groundSnowPsf: null, termite: "", weathering: "", notes: [] };
export const TYPED_SOURCE = "typed by the contractor from the department's Table R301.2";

export function normalizeJurisdiction(raw: unknown): TypedJurisdiction {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const num = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v * 10) / 10 : null);
  const sdc = text(r.sdc, 3).toUpperCase();
  return {
    department: text(r.department, 120),
    edition: text(r.edition, 200),
    windMph: num(r.windMph, 60, 250),
    sdc: /^[A-F][0-2]?$/.test(sdc) ? sdc : "",
    frostIn: num(r.frostIn, 0, 96),
    groundSnowPsf: num(r.groundSnowPsf, 0, 400),
    termite: text(r.termite, 40),
    weathering: text(r.weathering, 40),
    notes: (Array.isArray(r.notes) ? r.notes : []).map((n) => text(n, 300)).filter(Boolean).slice(0, 12),
  };
}
export const jurisdictionTyped = (t: TypedJurisdiction | null | undefined): boolean =>
  !!t && (!!t.department || !!t.edition || t.windMph !== null || !!t.sdc || t.frostIn !== null || t.groundSnowPsf !== null || !!t.termite || !!t.weathering || t.notes.length > 0);

/**
 * The jurisdiction the sheets are checked against: the county or city on file, the contractor's typed figures over
 * it line by line, and the USGS seismic category where nobody named one. Null when there is nothing at all — the
 * state's figures then.
 */
export function jurisdictionFor(onFile: DeckCountyCode | null, typed: TypedJurisdiction | null | undefined, usgsSdc: string | null, countyName: string | null, state: string): DeckCountyCode | null {
  const t = typed ?? EMPTY_JURISDICTION;
  if (!onFile && !jurisdictionTyped(t) && !usgsSdc) return null;
  const base: DeckCountyCode = onFile ?? {
    state: (state || "").toUpperCase(),
    county: countyName ?? "—",
    fips: null,
    jurisdiction: t.department || (countyName ? `${countyName} — not among the counties on file` : "the building department"),
    edition: null, frostIn: null, groundSnowPsf: null, windMph: null, windBasis: null, sdc: null, weathering: null, termite: null,
    deckNotes: [], note: null, sources: [], confidence: "low",
  };
  const fs: Partial<Record<CriteriaField, string>> = { ...(base.fieldSources ?? {}) };
  const take = <T,>(field: CriteriaField, mine: T | null | "", theirs: T | null): T | null => {
    if (mine !== null && mine !== "" && mine !== undefined) { fs[field] = TYPED_SOURCE; return mine as T; }
    return theirs;
  };
  let sdc = take<string>("sdc", t.sdc, base.sdc);
  if (sdc === null && usgsSdc) { sdc = usgsSdc; fs.sdc = USGS_SOURCE; }
  const { cities: _cities, ...rest } = base;
  void _cities;
  return {
    ...rest,
    jurisdiction: t.department || base.jurisdiction,
    edition: take<string>("edition", t.edition, base.edition),
    frostIn: take<number>("frostIn", t.frostIn, base.frostIn),
    groundSnowPsf: take<number>("groundSnowPsf", t.groundSnowPsf, base.groundSnowPsf),
    windMph: take<number>("windMph", t.windMph, base.windMph),
    windBasis: t.windMph !== null ? "the department's Table R301.2, as typed" : base.windBasis,
    sdc,
    termite: take<string>("termite", t.termite, base.termite),
    weathering: take<string>("weathering", t.weathering, base.weathering),
    deckNotes: [...t.notes, ...base.deckNotes],
    fieldSources: fs,
  };
}

export interface CriteriaRow {
  label: string;
  /** What the drawings were made to. */
  value: string;
  /** Where the figure comes from. */
  source: string;
  /** The county publishes a stricter figure than the drawings use: fix before submitting. */
  short?: boolean;
}

export interface DesignCriteria {
  rows: CriteriaRow[];
  /** Mismatches a reviewer would catch, in plain words (shown on screen, fixed in the studio). */
  warnings: string[];
  /** Worth knowing, not wrong: a footing dug deeper than asked, and the like. */
  hints: string[];
  /** The county's own deck rules, for the general notes. */
  countyNotes: string[];
  county: DeckCountyCode | null;
}

/**
 * The design criteria table for sheet A1: the state's code, the county's
 * published figures where it is on file, and what the deck was drawn to —
 * with the place where the county asks for more than the drawings give.
 */
export function designCriteria(s: DeckStructure, county: DeckCountyCode | null, countyName: string | null): DesignCriteria {
  const d = s.design;
  const code = s.code;
  const rows: CriteriaRow[] = [];
  const warnings: string[] = [];
  const hints: string[] = [];
  const where = county ? `${county.jurisdiction}` : countyName ? `${countyName} — confirm with its building department` : "the state's figure";
  const srcOf = (f: CriteriaField) => county?.fieldSources?.[f] ?? where;
  rows.push({ label: "Code", value: county?.edition ?? code.name, source: county?.edition ? srcOf("edition") : code.statewide ? "statewide" : "the city or county names the edition" });
  if (countyName || county) rows.push({ label: "Jurisdiction", value: county ? `${county.county}, ${county.state}` : countyName ?? "", source: county ? county.jurisdiction : "not on file — confirm with the building department" });
  // Frost: the footings were dug to the design's frost line; the county may ask for more.
  const deepest = s.frame ? Math.min(...s.frame.posts.filter((p) => p.footing.type === "poured").map((p) => p.footing.depthIn)) : null;
  const footingDepth = deepest != null && Number.isFinite(deepest) ? deepest : null;
  const frostShort = county?.frostIn != null && footingDepth != null && footingDepth < county.frostIn;
  rows.push({ label: "Frost depth", value: `${d.frostIn} in.${footingDepth != null ? ` · footings ${footingDepth} in. below grade` : ""}`, source: county?.frostIn != null ? `${srcOf("frostIn")}: ${county.frostIn} in.` : "the state's typical depth", short: frostShort });
  if (frostShort && county) warnings.push(`${county.county} asks for footings at least ${county.frostIn} in. deep; the drawings show ${footingDepth} in. Set the frost line to ${county.frostIn} in. in the studio's Site section.`);
  // Snow: the deck's design load follows the ground snow.
  const snow = d.site.groundSnowPsf;
  const snowShort = county?.groundSnowPsf != null && county.groundSnowPsf > snow && county.groundSnowPsf > 40 && d.loadPsf < county.groundSnowPsf;
  rows.push({ label: "Ground snow", value: `${snow} psf`, source: county?.groundSnowPsf != null ? `${srcOf("groundSnowPsf")}: ${county.groundSnowPsf} psf` : "the map's figure (IRC Figure R301.2(5))", short: snowShort });
  if (snowShort && county) warnings.push(`${county.county} publishes a ${county.groundSnowPsf} psf ground snow load, more than the deck's ${d.loadPsf} psf design load. Set the ground snow to ${county.groundSnowPsf} psf in the studio.`);
  rows.push({ label: "Design loads", value: `${d.loadPsf} psf live · 10 psf dead${s.roof ? ` · roof ${s.roof.roofLoad} psf${s.roof.roofLoad === 20 ? " live" : " snow"}` : ""}`, source: "IRC Table R301.5; R507" });
  rows.push({ label: "Wind", value: county?.windMph != null ? `${county.windMph} mph${county.windBasis ? ` (${county.windBasis})` : ""}` : "per the jurisdiction's map", source: county?.windMph != null ? srcOf("windMph") : "IRC Figure R301.2(2)" });
  rows.push({ label: "Seismic category", value: county?.sdc ?? "per the jurisdiction's map", source: county?.sdc ? srcOf("sdc") : "IRC Figure R301.2(3)" });
  const termite = county?.termite ?? (d.site.termite ? TERMITE_LABEL[d.site.termite] : null);
  if (termite) rows.push({ label: "Termite", value: termite, source: county?.termite ? srcOf("termite") : "IRC Figure R301.2(6)" });
  if (county?.weathering) rows.push({ label: "Weathering", value: county.weathering, source: srcOf("weathering") });
  rows.push({ label: "Soil bearing", value: `${d.soilPsf.toLocaleString("en-US")} psf presumptive`, source: "IRC Table R401.4.1 — the building official may require a soil test" });
  rows.push({ label: "Guard / stairs", value: `guard ${code.guardIn} in. · risers ≤ ${code.riserMaxIn} in. · treads ≥ ${code.treadMinIn} in.`, source: code.short });
  if (county?.frostIn != null && footingDepth != null && footingDepth >= county.frostIn + 6) hints.push(`${county.county} asks footings ${county.frostIn} in. deep and the drawings show ${footingDepth} in. — fine to submit; set the frost line to ${county.frostIn} in. in the studio's Site section to dig less.`);
  return { rows, warnings, hints, countyNotes: county?.deckNotes ?? [], county };
}
