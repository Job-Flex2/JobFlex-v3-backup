// Intake — how a building model gets filled, and how every fill is marked.
//
// Three writers, one object: the site facts the server already knows (parcel,
// footprints, roof, county), the era defaults for what nobody has said yet,
// and the readings — a video walkthrough's measurements and observations, a
// nameplate decoded from a photo, the contractor's own answers. Each writer
// stamps the fields it touches with a provenance entry so the screens can show
// "measured · read · stated · default" beside every number, and a later,
// better source replaces an earlier, weaker one.

import type { WalkthroughAnalysis } from "@/lib/estimate/video-schema";
import { parseDuctSize } from "./ductCalc";
import type { BuildingModel, Confidence, ExistingKind, FootprintEdge, Fuel, InputConflict, Provenance, Source } from "./types";
import { DEFAULTS_SOURCE, eraDefaults } from "./data/defaults";
import { decodeModelNumber, decodeSerialYear } from "./nameplate";

/** What the server can say about a site before anyone answers a question. */
export interface SiteFacts {
  address: string;
  state: string;
  county?: string;
  lat?: number;
  lng?: number;
  elevationFt?: number;
  /** The assessor's living area for the house, sq ft — the conditioned area
   *  itself, ahead of footprint × storeys. */
  livingSqft?: number;
  /** Ground-floor footprint of the house the pin is in, sq ft. */
  footprintSqft?: number;
  perimeterFt?: number;
  footprintEdges?: FootprintEdge[];
  /** From the footprint record's height, when it carries one. */
  storeys?: number;
  yearBuilt?: number;
  /** Roof measurement on file for the address. */
  roof?: { areaSqft?: number; pitch?: string; material?: string | null; eaveHeightFt?: number };
  /** Where each of the above came from, for the badges. */
  /** "Residential", "Commercial"… from the assessor, when known. */
  landUse?: string;
  sources: Partial<Record<"footprint" | "living" | "storeys" | "yearBuilt" | "roof" | "county" | "elevation" | "point", string>>;
}

// Strength of a fact: its source first, its confidence second. A record read
// off a photo or a public file outranks an era default; what the contractor
// said on the walk outranks a record (a building-height guess at the storeys
// loses to "it's a two-storey"); an instrument or a scan outranks speech; a
// plan dimension outranks everything read. Ties go to the newer reading. A
// typed answer is outside the ladder: nothing read later replaces it.
const RANK: Record<Source, number> = { default: 0, read: 1, stated: 2, measured: 2, plan: 3 };
const CONF: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };
const strength = (p: Provenance) => RANK[p.source] * 3 + CONF[p.confidence];
const yields = (cur: Provenance | undefined, next: Provenance) => !cur || (!cur.entered && strength(next) >= strength(cur));

/** Set a field when the new source is at least as strong as what is there. */
export function setFact<K extends keyof BuildingModel>(m: BuildingModel, key: K, value: BuildingModel[K], p: Provenance): boolean {
  if (!yields(m.provenance[key as string], p)) return false;
  m[key] = value;
  m.provenance[key as string] = p;
  return true;
}

/** Same, for a nested group ("existing.tons"). */
export function setNested(m: BuildingModel, path: string, value: unknown, p: Provenance): boolean {
  if (!yields(m.provenance[path], p)) return false;
  const [group, field] = path.split(".");
  const target = (m as unknown as Record<string, Record<string, unknown>>)[group];
  if (!target || !field) return false;
  target[field] = value;
  m.provenance[path] = p;
  return true;
}

const defaultP = (note: string): Provenance => ({ source: "default", confidence: "low", note });

/** A model for a site with nothing but the era defaults filled — the starting
 *  point every reading and answer writes over. */
export function modelFromSite(site: SiteFacts): BuildingModel {
  const era = eraDefaults(site.yearBuilt);
  const m: BuildingModel = {
    address: site.address,
    state: site.state.toUpperCase(),
    county: site.county,
    lat: site.lat,
    lng: site.lng,
    elevationFt: site.elevationFt,
    conditionedSqft: 0,
    storeys: 1,
    ceilingHeightFt: 8,
    yearBuilt: site.yearBuilt,
    perimeterFt: site.perimeterFt,
    footprintEdges: site.footprintEdges,
    windowToFloor: era.windowToFloor,
    windowType: era.windowType,
    wallInsulation: era.wallInsulation,
    ceilingInsulation: era.ceilingInsulation,
    foundation: "slab",
    tightness: era.tightness,
    roofColor: "medium",
    shading: "some",
    occupants: 3,
    existing: { kind: "split-ac-furnace" },
    electrical: {},
    ducts: { location: "attic", condition: "unknown" },
    gas: { available: true },
    preferences: {},
    provenance: {},
  };
  const eraNote = `${DEFAULTS_SOURCE}, ${era.era}`;
  for (const k of ["windowToFloor", "windowType", "wallInsulation", "ceilingInsulation", "tightness"] as const) m.provenance[k] = defaultP(eraNote);
  m.provenance.foundation = defaultP("slab assumed — confirm crawlspace or basement");
  m.provenance.roofColor = defaultP("medium roof colour assumed");
  m.provenance.shading = defaultP("some shading assumed");
  m.provenance.occupants = defaultP("3 occupants assumed");
  m.provenance.ceilingHeightFt = defaultP("8 ft ceilings assumed");
  m.provenance["ducts.location"] = defaultP("attic ducts assumed for a slab house");
  m.provenance["ducts.condition"] = defaultP("duct condition not yet seen");
  m.provenance["existing.kind"] = defaultP("split AC and furnace assumed");
  m.provenance["gas.available"] = defaultP("gas assumed available — confirm at the meter");

  if (site.storeys && site.storeys > 0) setFact(m, "storeys", Math.max(1, Math.round(site.storeys)), { source: /parcel|assessor|record/i.test(site.sources.storeys ?? "") ? "read" : "measured", confidence: /parcel|assessor/i.test(site.sources.storeys ?? "") ? "high" : "medium", note: site.sources.storeys ?? "building record" });
  else m.provenance.storeys = defaultP("single storey assumed");
  if (site.livingSqft && site.livingSqft > 0) {
    setFact(m, "conditionedSqft", Math.round(site.livingSqft), { source: "read", confidence: "high", note: site.sources.living ?? "county parcel record" });
  } else if (site.footprintSqft && site.footprintSqft > 0) {
    // A footprint is the ground-floor outline: garage and porches in, upper
    // floors out. Medium confidence whatever the storey count, and the note
    // says what to do about it.
    const storeys = m.storeys;
    const storeysKnown = m.provenance.storeys?.source !== "default";
    setFact(m, "conditionedSqft", Math.round(site.footprintSqft * storeys), { source: "measured", confidence: "medium", note: `${site.sources.footprint ?? "building footprint"} × ${storeys} storey${storeys === 1 ? "" : "s"}${storeysKnown ? "" : " (assumed)"} — garage and porches included; say the living area and storeys on the walk, or type them` });
  } else {
    m.provenance.conditionedSqft = defaultP("no footprint on record — enter the conditioned area");
  }
  if (site.yearBuilt) m.provenance.yearBuilt = { source: "read", confidence: "medium", note: site.sources.yearBuilt ?? "property record" };
  else m.provenance.yearBuilt = defaultP("year built unknown — 1985 assumed for the defaults");
  if (site.roof?.material) {
    const mat = site.roof.material.toLowerCase();
    const color = /metal|white|light|tile/.test(mat) ? "light" : /dark|black|slate/.test(mat) ? "dark" : "medium";
    setFact(m, "roofColor", color, { source: "read", confidence: "low", note: `${site.roof.material} roof on the roof measurement` });
  }
  return m;
}

// ── readings ────────────────────────────────────────────────────────────────

const num = (s: string): number | undefined => {
  const m = s.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : undefined;
};
/** "20x25" / "20 × 25" → 500; otherwise the first number. */
const area = (s: string): number | undefined => {
  const d = s.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*[x×by]+\s*(\d+(?:\.\d+)?)/i);
  return d ? Number(d[1]) * Number(d[2]) : num(s);
};
/** A sentence about what the owner WANTS, not what is there. */
const isPreference = (t: string) => /\b(want|wants|wanted|prefer|interested|considering|thinking about|would like|looking for|upgrade to|switch to|replace (it )?with|instead of|new)\b/i.test(t);
/** "no basement", "without a crawlspace", "not on a slab". */
const negated = (t: string, word: RegExp) => new RegExp(`\\b(no|not|without|isn't|is not|doesn't have|does not have)\\b[^.,;]{0,24}(?:${word.source})`, "i").test(t);
const conf = (c: "high" | "medium" | "low"): Confidence => c;
const srcOf = (s: "spoken" | "visual" | "inferred"): Source => (s === "spoken" ? "stated" : s === "visual" ? "read" : "default");

/** The measurement labels the walkthrough reader uses, matched loosely. */
const LABELS: Array<{ re: RegExp; apply: (m: BuildingModel, v: string, p: Provenance) => void }> = [
  { re: /square\s*f|sq\.?\s*ft|conditioned|floor area/i, apply: (m, v, p) => { const n = num(v); if (n && n > 200) setFact(m, "conditionedSqft", Math.round(n), p); } },
  { re: /stor(e)?y|stories|floors|levels/i, apply: (m, v, p) => { const n = num(v); if (n && n >= 1 && n <= 4) setFact(m, "storeys", Math.round(n), p); } },
  { re: /ceiling/i, apply: (m, v, p) => { const n = num(v); if (n && n >= 7 && n <= 20) setFact(m, "ceilingHeightFt", n, p); } },
  { re: /year built|built in|age of (the )?(house|home)/i, apply: (m, v, p) => { const n = num(v); if (n && n > 1800 && n < 2100) setFact(m, "yearBuilt", Math.round(n), p); } },
  { re: /occupant|people|bedrooms?/i, apply: (m, v, p) => { const n = num(v); if (n && n >= 1 && n <= 12) setFact(m, "occupants", /bedroom/i.test(v) ? n + 1 : n, p); } },
  { re: /main breaker|service size|panel|service amps/i, apply: (m, v, p) => { const n = num(v); if (n && [60, 100, 125, 150, 200, 225, 400].includes(n)) setNested(m, "electrical.mainAmps", n, p); } },
  { re: /free .*slots?|open .*slots?|spare/i, apply: (m, v, p) => { const n = num(v); if (n !== undefined && n >= 0 && n <= 40) setNested(m, "electrical.freeSlots", n, p); } },
  { re: /static/i, apply: (m, v, p) => { const n = num(v); if (n !== undefined && n > 0 && n < 3) setNested(m, "ducts.measuredTespInWc", n, p); } },
  // The ducts as measured (lib/hvac/ductCalc, 2026-10-08): "Supply trunk: 20x8", "Return duct: 16", "Branch runs: 6".
  { re: /supply trunk|trunk (size|duct)|main trunk|plenum take-?off/i, apply: (m, v, p) => { if (parseDuctSize(v)) setNested(m, "ducts.supplyTrunk", v.trim(), p); } },
  { re: /return (duct|trunk|drop)/i, apply: (m, v, p) => { if (parseDuctSize(v)) setNested(m, "ducts.returnDuct", v.trim(), p); } },
  { re: /branch (run|duct)|run (size|diameter)|flex (size|runs?)/i, apply: (m, v, p) => { const n = num(v); if (n && n >= 3 && n <= 14) setNested(m, "ducts.branchIn", n, p); } },
  { re: /keep up|kept up|hottest days|comfort on hot days/i, apply: (m, v, p) => { const t = v.trim(); if (/^(no|not|never|couldn|didn|struggl|barely)/i.test(t)) setNested(m, "existing.keptUp", "no", p); else if (/^(yes|fine|kept|ok|always|yep)/i.test(t)) setNested(m, "existing.keptUp", "yes", p); } },
  { re: /return (grille|air)/i, apply: (m, v, p) => { const n = area(v); if (n && n > 40 && n < 4000) setNested(m, "ducts.returnGrilleSqIn", n, p); } },
  // A BTU/h figure is a furnace input whatever the label says ("Furnace
  // capacity: 80,000 BTU"); tons are tons; a bare 12,000–120,000 under a
  // cooling label is BTU/h of cooling and reads as tons.
  // The walk reader's own label "Outdoor unit tons or BTU" (and any cooling
  // label naming tons) reads as tons, before the BTU rule below can take it
  // for a furnace input (2026-10-08): a bare "3" is 3 tons, "36000" is 3 tons.
  { re: /tons? or btu|tons?\s*\/\s*btu|outdoor unit tons|cooling (tons|capacity)|condenser (tons|size|capacity)|heat pump (tons|size|capacity)/i, apply: (m, v, p) => { const n = num(v); if (n && n >= 1 && n <= 10) setNested(m, "existing.tons", n, p); else if (n && n >= 12000 && n <= 120000) setNested(m, "existing.tons", Math.round((n / 12000) * 2) / 2, p); } },
  { re: /btu|furnace input|heating capacity|furnace capacity|input rating/i, apply: (m, v, p) => { const n = num(v); if (n && n >= 20000 && n <= 200000) setNested(m, "existing.btuInput", Math.round(n), p); else if (n && n >= 1 && n <= 10 && /cooling|ac\b|condenser|heat pump/i.test(v)) setNested(m, "existing.tons", n, p); } },
  { re: /tons?|tonnage|capacity/i, apply: (m, v, p) => { const n = num(v); if (n && n >= 1 && n <= 10) setNested(m, "existing.tons", n, p); else if (n && n >= 12000 && n <= 120000 && !/btu/i.test(v)) setNested(m, "existing.tons", Math.round((n / 12000) * 2) / 2, p); else if (n && n >= 20000 && n <= 200000) setNested(m, "existing.btuInput", Math.round(n), p); } },
  { re: /seer/i, apply: (m, v, p) => { const n = num(v); if (n && n >= 8 && n <= 30) setNested(m, "existing.seer", n, p); } },
  // The glass (2026-10-14): "Window area: 320 sq ft", "Windows: 18" (counted — an
  // average window is about 15 sq ft), "Window type: double pane low-e".
  { re: /window (type|glass|glazing|pane)|glazing/i, apply: (m, v, p) => { const w = windowBucket(v); if (w) setFact(m, "windowType", w, p); } },
  { re: /window area|glass area|windows? sq|sq\.?\s*ft of (window|glass)/i, apply: (m, v, p) => { const n = num(v); if (n && n >= 20 && n <= 3000) setFact(m, "windowSqft", Math.round(n), p); } },
  { re: /^\s*windows?\s*$|number of windows|window count|windows counted/i, apply: (m, v, p) => { const n = num(v); if (n && n >= 1 && n <= 120 && !/sq|ft|pane|double|single|low/i.test(v)) setFact(m, "windowSqft", Math.round(n * 15), { ...p, note: `${Math.round(n)} windows counted on the walk × 15 sq ft each` }); } },
  // Insulation read on the walk: "Attic insulation: R-19 blown", "Wall insulation: R-13 batts", "no insulation".
  { re: /attic insulation|ceiling insulation|attic r|roof insulation/i, apply: (m, v, p) => { const b = ceilingBucket(v); if (b) setFact(m, "ceilingInsulation", b, p); } },
  { re: /wall insulation|walls? r-?\d/i, apply: (m, v, p) => { const b = wallBucket(v); if (b) setFact(m, "wallInsulation", b, p); } },
  { re: /afue/i, apply: (m, v, p) => { const n = num(v); if (n && n >= 50 && n <= 99) setNested(m, "existing.afue", n / 100, p); } },
  { re: /model/i, apply: (m, v, p) => { setNested(m, "existing.model", v.trim(), p); applyModelString(m, v, p); } },
  { re: /serial/i, apply: (m, v, p) => { setNested(m, "existing.serial", v.trim(), p); } },
  { re: /brand|manufacturer|make/i, apply: (m, v, p) => { setNested(m, "existing.brand", v.trim(), p); } },
  { re: /gas (pipe|line) size|pipe size/i, apply: (m, v, p) => { const n = num(v); if (n && n > 0 && n <= 2) setNested(m, "gas.pipeIn", n, p); } },
  { re: /refrigerant/i, apply: (m, v, p) => { const r = refrigerantIn(v); if (r) setNested(m, "existing.refrigerant", r, p); } },
  // "Whole-house fan: yes / none / ERV" (2026-10-08).
  { re: /ventilation|whole[- ]house fan|fresh[- ]air|\b(erv|hrv)\b/i, apply: (m, v, p) => { const t = v.trim(); if (/^(no|none|not|without|n\/a)/i.test(t)) setFact(m, "ventilationFan", false, p); else if (/^(yes|erv|hrv|exhaust|supply|balanced|present|installed|has)/i.test(t)) setFact(m, "ventilationFan", true, p); } },
];

/** An R-value on the walk to the nearest bucket the load tables carry. */
function rValue(s: string): number | undefined {
  if (/\b(no|none|uninsulated|bare)\b/i.test(s)) return 0;
  const m = s.match(/r-?\s*(\d{1,2})\b/i);
  return m ? Number(m[1]) : undefined;
}
function ceilingBucket(s: string): BuildingModel["ceilingInsulation"] | undefined {
  const r = rValue(s);
  if (r === undefined) return undefined;
  const ladder: Array<[number, BuildingModel["ceilingInsulation"]]> = [[0, "none"], [11, "r11"], [19, "r19"], [30, "r30"], [38, "r38"], [49, "r49"]];
  return ladder.reduce((best, cur) => (Math.abs(cur[0] - r) < Math.abs(best[0] - r) ? cur : best))[1];
}
function wallBucket(s: string): BuildingModel["wallInsulation"] | undefined {
  const r = rValue(s);
  if (r === undefined) return undefined;
  const ladder: Array<[number, BuildingModel["wallInsulation"]]> = [[0, "none"], [11, "r11"], [13, "r13"], [19, "r19"], [21, "r21"]];
  return ladder.reduce((best, cur) => (Math.abs(cur[0] - r) < Math.abs(best[0] - r) ? cur : best))[1];
}

/** "double pane low-e" / "single" / "triple" → the glazing class the load tables carry. */
function windowBucket(s: string): BuildingModel["windowType"] | undefined {
  const t = s.toLowerCase();
  if (/triple/.test(t)) return "triple";
  if (/low[- ]?e|argon|energy star|vinyl/.test(t)) return "double-lowe";
  if (/double|dual|insulated|thermal/.test(t)) return "double";
  if (/single|old|original|aluminum|storm/.test(t)) return "single";
  return undefined;
}

function refrigerantIn(s: string): "R-22" | "R-410A" | "R-454B" | "R-32" | undefined {
  const t = s.toUpperCase();
  if (/410/.test(t)) return "R-410A";
  if (/454/.test(t)) return "R-454B";
  if (/R-?32\b/.test(t)) return "R-32";
  if (/R-?22\b/.test(t)) return "R-22";
  return undefined;
}

/** A model number the contractor typed: decode it the way a plate's is. The
 *  decode is badged "read" at the decoder's confidence, so a typed tonnage
 *  (stated) still wins over it. */
export function applyTypedModelNumber(m: BuildingModel, model: string): void {
  applyModelString(m, model, { source: "read", confidence: "medium", note: "typed model number" });
}

function applyModelString(m: BuildingModel, model: string, p: Provenance) {
  const d = decodeModelNumber(model, m.existing.kind === "furnace-only" ? "furnace" : undefined);
  const pp: Provenance = { source: p.source, confidence: d.confidence, note: `${p.note ?? "model number"}: ${d.notes.join(" ")}` };
  if (d.tons) setNested(m, "existing.tons", d.tons, pp);
  if (d.btuInput) setNested(m, "existing.btuInput", d.btuInput, pp);
  if (d.refrigerantHint) setNested(m, "existing.refrigerant", d.refrigerantHint, pp);
}

const OBSERVATIONS: Array<{ re: RegExp; apply: (m: BuildingModel, text: string, p: Provenance) => void }> = [
  { re: /ducts? .*(attic)/i, apply: (m, _t, p) => setNested(m, "ducts.location", "attic", p) },
  { re: /ducts? .*(crawl)/i, apply: (m, _t, p) => setNested(m, "ducts.location", "crawl", p) },
  { re: /ducts? .*(basement)/i, apply: (m, _t, p) => setNested(m, "ducts.location", "basement", p) },
  { re: /no duct|ductless|mini.?split only/i, apply: (m, _t, p) => setNested(m, "ducts.location", "none", p) },
  { re: /ducts? .*(poor|damaged|crushed|disconnected|torn|leak)/i, apply: (m, _t, p) => setNested(m, "ducts.condition", "poor", p) },
  { re: /ducts? .*(fair|older|some wear)/i, apply: (m, _t, p) => setNested(m, "ducts.condition", "fair", p) },
  { re: /ducts? .*(good|new|sealed|tight)/i, apply: (m, _t, p) => setNested(m, "ducts.condition", "good", p) },
  { re: /ducts? .*(uninsulated|no insulation|bare)/i, apply: (m, _t, p) => setNested(m, "ducts.insulated", false, p) },
  // A whole-house ventilation fan, seen or said (2026-10-08): "no" first.
  { re: /\b(no|without|isn'?t an?|no such)\b[^.,;]{0,20}(ventilation|whole[- ]house fan|fresh[- ]air|erv|hrv)/i, apply: (m, _t, p) => setFact(m, "ventilationFan", false, p) },
  { re: /\b(erv|hrv|energy recovery|heat recovery|whole[- ]house fan|fresh[- ]air (fan|system|intake)|ventilation (fan|system))\b/i, apply: (m, t, p) => { if (!/\b(no|without|isn'?t an?|no such)\b[^.,;]{0,20}(ventilation|whole[- ]house fan|fresh[- ]air|erv|hrv)/i.test(t)) setFact(m, "ventilationFan", true, p); } },
  // Did the old unit keep up on the hottest days? The "no" rule runs first;
  // the "yes" rule steps aside for it (2026-10-08).
  { re: /(couldn'?t|could not|didn'?t|did not|never|barely|can'?t|cannot|doesn'?t|does not) (keep|kept) up|struggl|ran all day|never shut off|never caught up/i, apply: (m, _t, p) => setNested(m, "existing.keptUp", "no", p) },
  { re: /\b(kept|keeps|keep) up\b|kept the house (cool|comfortable)|no trouble on (the )?hot(test)? days/i, apply: (m, t, p) => { if (!/(couldn'?t|could not|didn'?t|did not|never|barely|can'?t|cannot|doesn'?t|does not) (keep|kept)|struggl/i.test(t)) setNested(m, "existing.keptUp", "yes", p); } },
  { re: /crawl ?space/i, apply: (m, t, p) => { if (!negated(t, /crawl ?space/)) setFact(m, "foundation", "crawl-vented", p); } },
  { re: /basement/i, apply: (m, t, p) => { if (!negated(t, /basement/)) setFact(m, "foundation", /finished|conditioned|heated/i.test(t) ? "basement-conditioned" : "basement-unconditioned", p); } },
  { re: /\bslab\b/i, apply: (m, t, p) => { if (!negated(t, /slab/)) setFact(m, "foundation", "slab", p); } },
  // What is THERE, never what the owner wants: "interested in a heat pump" is
  // a preference, and it lands below.
  { re: /heat pump/i, apply: (m, t, p) => { if (!isPreference(t)) setNested(m, "existing.kind", "split-heat-pump" as ExistingKind, p); } },
  { re: /package(d)? unit|rooftop unit/i, apply: (m, t, p) => { if (!isPreference(t)) setNested(m, "existing.kind", "package-unit" as ExistingKind, p); } },
  { re: /furnace only|no (ac|air conditioning|cooling)/i, apply: (m, t, p) => { if (!isPreference(t)) setNested(m, "existing.kind", "furnace-only" as ExistingKind, p); } },
  { re: /gas (furnace|meter|line)|natural gas/i, apply: (m, _t, p) => { setNested(m, "existing.fuel", "gas" as Fuel, p); setNested(m, "gas.available", true, p); } },
  { re: /propane|lp gas/i, apply: (m, _t, p) => setNested(m, "existing.fuel", "propane" as Fuel, p) },
  { re: /all[- ]electric|no gas|electric furnace|electric heat/i, apply: (m, _t, p) => { setNested(m, "existing.fuel", "electric" as Fuel, p); setNested(m, "gas.available", false, p); } },
  { re: /single[- ]pane/i, apply: (m, _t, p) => setFact(m, "windowType", "single", p) },
  { re: /double[- ]pane|dual[- ]pane/i, apply: (m, t, p) => setFact(m, "windowType", /low-?e/i.test(t) ? "double-lowe" : "double", p) },
  { re: /triple[- ]pane/i, apply: (m, _t, p) => setFact(m, "windowType", "triple", p) },
  { re: /(dark|black) (shingle|roof)/i, apply: (m, _t, p) => setFact(m, "roofColor", "dark", p) },
  { re: /(light|white|metal) (shingle|roof)/i, apply: (m, _t, p) => setFact(m, "roofColor", "light", p) },
  { re: /(heavy|mature) (trees|shade)|well shaded/i, apply: (m, _t, p) => setFact(m, "shading", "heavy", p) },
  { re: /no shade|full sun|unshaded/i, apply: (m, _t, p) => setFact(m, "shading", "none", p) },
  { re: /electric range|electric stove/i, apply: (m, _t, p) => setNested(m, "electrical.electricRange", true, p) },
  { re: /electric dryer/i, apply: (m, _t, p) => setNested(m, "electrical.electricDryer", true, p) },
  { re: /electric water heater/i, apply: (m, _t, p) => setNested(m, "electrical.electricWaterHeater", true, p) },
  { re: /ev charger|car charger/i, apply: (m, _t, p) => setNested(m, "electrical.evCharger", true, p) },
  { re: /keep (the )?gas|stay on gas|wants? gas/i, apply: (m, _t, p) => setNested(m, "preferences.keepGas", true, p) },
  { re: /all[- ]electric|get off gas|go electric|(want|prefer|interested|considering|thinking about)[^.,;]{0,30}heat pump/i, apply: (m, _t, p) => setNested(m, "preferences.allElectric", true, p) },
  { re: /(sensitive|complain|complaint|bother|hate)[^.,;]{0,20}noise|noise (sensitive|complaint|is an issue|is a concern)|too (loud|noisy)|wants? (it |something )?quiet|quiet(er)? (unit|system|one)/i, apply: (m, t, p) => { if (!negated(t, /noise|loud|quiet/)) setNested(m, "preferences.noiseSensitive", true, p); } },
  { re: /R-?410A?/i, apply: (m, _t, p) => setNested(m, "existing.refrigerant", "R-410A", p) },
  { re: /R-?22\b/i, apply: (m, _t, p) => setNested(m, "existing.refrigerant", "R-22", p) },
  { re: /(\d{4})\s*(build|built|manufactur)|(built|manufactured) (in )?(19|20)\d{2}/i, apply: (m, t, p) => { const y = t.match(/(19|20)\d{2}/); if (y) setNested(m, "existing.yearMade", Number(y[0]), p); } },
];

/** Fold a walkthrough reading into the model. Spoken figures count as stated
 *  by the contractor; things seen on a frame as read; inferences as defaults
 *  that any better source overrides. */
/** A value read off a record or an instrument at high confidence: the
 *  assessor's living area, a parcel's year built, a measured size. */
const isRecord = (p: Provenance | undefined) => !!p && !p.entered && (p.source === "read" || p.source === "measured") && p.confidence === "high";
const readPath = (m: BuildingModel, path: string): unknown => {
  const [g, f] = path.split(".");
  const obj = m as unknown as Record<string, unknown>;
  return f ? (obj[g] as Record<string, unknown> | undefined)?.[f] : obj[g];
};
const differs = (a: unknown, b: unknown) => {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) > Math.max(1, Math.abs(a) * 0.1);
  return String(a) !== String(b);
};

export function applyWalkthrough(m: BuildingModel, a: WalkthroughAnalysis): { applied: string[]; conflicts: InputConflict[] } {
  const applied: string[] = [];
  const conflicts: InputConflict[] = [];
  for (const meas of a.measurements) {
    const p: Provenance = { source: srcOf(meas.source), confidence: conf(meas.confidence), note: `walkthrough: ${meas.label} = ${meas.value}${meas.unit ? " " + meas.unit : ""}` };
    const rule = LABELS.find((r) => r.re.test(meas.label));
    if (!rule) continue;
    // Records beat transcribed speech (2026-10-08): the rule runs on a copy
    // first, and a field that a high-confidence record already holds keeps
    // the record when the walk's figure disagrees — the disagreement is kept
    // beside it for the contractor to confirm. Against a default, an
    // estimate or a medium-confidence reading the walk still wins.
    const probe = structuredClone(m);
    rule.apply(probe, meas.value, p);
    const touched = Object.keys(probe.provenance).filter((k) => probe.provenance[k] !== m.provenance[k]);
    let blocked = false;
    for (const path of touched) {
      const cur = m.provenance[path];
      const next = readPath(probe, path);
      const have = readPath(m, path);
      if (p.source === "stated" && isRecord(cur) && differs(have, next)) {
        blocked = true;
        const kept = String(have);
        const walk = String(next);
        if (!conflicts.some((c) => c.path === path)) conflicts.push({ path, kept, walk });
        m.provenance[path] = { ...cur, note: `${cur.note ?? cur.source} · the walk said ${walk} — confirm` };
      }
    }
    if (blocked) continue;
    const before = JSON.stringify(m);
    rule.apply(m, meas.value, p);
    if (JSON.stringify(m) !== before) applied.push(meas.label);
  }
  if (conflicts.length) m.conflicts = [...(m.conflicts ?? []).filter((c) => !conflicts.some((n) => n.path === c.path)), ...conflicts];
  for (const text of [...a.observations, ...a.transcriptHighlights]) {
    const p: Provenance = { source: "read", confidence: "medium", note: `walkthrough: "${text.slice(0, 90)}"` };
    for (const rule of OBSERVATIONS) {
      if (!rule.re.test(text)) continue;
      const before = JSON.stringify(m);
      rule.apply(m, text, p);
      if (JSON.stringify(m) !== before) applied.push(text.slice(0, 40));
    }
  }
  return { applied, conflicts };
}

/** What the vision model reads off one nameplate photo. */
export interface NameplateRead {
  kind: "outdoor" | "furnace" | "air-handler" | "package" | "water-heater" | "other";
  brand?: string;
  model?: string;
  serial?: string;
  tons?: number;
  btuInput?: number;
  seer?: number;
  afue?: number;
  refrigerant?: string;
  yearMade?: number;
  voltage?: string;
  mcaAmps?: number;
  confidence: Confidence;
  notes?: string;
}

/** Fold a decoded nameplate into the model, with the rules module checking
 *  the arithmetic the model did. */
export function applyNameplate(m: BuildingModel, r: NameplateRead): { applied: string[] } {
  const applied: string[] = [];
  const base: Provenance = { source: "read", confidence: r.confidence, note: `nameplate photo${r.brand ? ` (${r.brand})` : ""}` };
  const set = (path: string, v: unknown, p: Provenance = base) => { if (v !== undefined && v !== null && v !== "" && setNested(m, path, v, p)) applied.push(path); };
  if (r.kind === "water-heater" || r.kind === "other") return { applied };
  if (r.kind === "furnace") set("existing.kind", m.existing.kind === "split-heat-pump" ? m.existing.kind : "split-ac-furnace", { ...base, confidence: "low" });
  if (r.kind === "package") set("existing.kind", "package-unit");
  set("existing.brand", r.brand);
  set("existing.model", r.model);
  set("existing.serial", r.serial);
  // The model number decodes deterministically; the plate reader's own figure
  // fills in only where the decode has nothing, and a disagreement between
  // the two is written on the badge for the contractor to settle (2026-10-08;
  // until then the reader's figure silently beat the decode).
  const decoded = decodeModelNumber(r.model, r.kind === "furnace" ? "furnace" : r.kind === "outdoor" ? "cooling" : undefined);
  const tons = decoded.tons ?? r.tons;
  const btu = decoded.btuInput ?? r.btuInput;
  const tonsClash = !!(decoded.tons && r.tons && Math.abs(decoded.tons - r.tons) >= 0.5);
  const btuClash = !!(decoded.btuInput && r.btuInput && Math.abs(decoded.btuInput - r.btuInput) > 5000);
  if (tons) set("existing.tons", tons, { ...base, confidence: tonsClash ? "medium" : decoded.tons ? decoded.confidence : r.confidence, note: decoded.tons ? `${base.note}: ${decoded.notes.join(" ")}${tonsClash ? ` · the plate reader said ${r.tons} t — confirm` : ""}` : base.note });
  if (btu) set("existing.btuInput", btu, { ...base, confidence: btuClash ? "medium" : decoded.btuInput ? decoded.confidence : r.confidence, note: btuClash ? `${base.note} · the plate reader said ${r.btuInput} BTU/h — confirm` : base.note });
  if (r.seer) set("existing.seer", r.seer);
  if (r.afue) set("existing.afue", r.afue > 1 ? r.afue / 100 : r.afue);
  const refr = refrigerantIn(r.refrigerant ?? "") ?? decoded.refrigerantHint;
  if (refr) set("existing.refrigerant", refr);
  const year = r.yearMade ?? decodeSerialYear(r.brand, r.serial).year;
  if (year && year > 1970 && year <= new Date().getFullYear()) set("existing.yearMade", year, { ...base, confidence: r.yearMade ? r.confidence : "low" });
  if (r.kind === "furnace" && !m.provenance["existing.fuel"]) set("existing.fuel", "gas", { ...base, confidence: "low", note: "furnace nameplate — gas assumed" });
  return { applied };
}

/** A contractor's typed answer: the strongest source there is. */
export function applyStated<K extends keyof BuildingModel>(m: BuildingModel, key: K, value: BuildingModel[K]): void {
  m[key] = value;
  m.provenance[key as string] = { source: "stated", confidence: "high", entered: true, note: "entered by the contractor" };
}

export function applyStatedNested(m: BuildingModel, path: string, value: unknown): void {
  const [group, field] = path.split(".");
  const target = (m as unknown as Record<string, Record<string, unknown>>)[group];
  if (!target || !field) return;
  target[field] = value;
  m.provenance[path] = { source: "stated", confidence: "high", entered: true, note: "entered by the contractor" };
}

/** Fields the load needs that are still on a default — the intake's checklist. */
export function stillDefaulted(m: BuildingModel): string[] {
  const keys = ["conditionedSqft", "storeys", "yearBuilt", "windowType", "wallInsulation", "ceilingInsulation", "foundation", "tightness", "ducts.location", "ducts.condition", "existing.kind", "electrical.mainAmps"];
  return keys.filter((k) => !m.provenance[k] || m.provenance[k].source === "default");
}
