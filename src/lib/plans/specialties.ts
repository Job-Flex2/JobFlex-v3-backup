// Which estimator specialty prices a job asked of the plans. Server-side (the specialty
// catalog is large; the browser never needs it).
//
// The estimator knows 229 specialties, each with its own procedure and price book. A job
// off a plan set can be any of the ones that build something — a fence, a deck, pavers,
// solar, stucco, fire sprinklers, a pool — not only the 18 trades of the house's build
// list. The ones that do not price building work (engineers, surveyors, studies, road
// work, remediation, remodel and repair shops) are left out: a new house is built, not
// repaired.
import { AI_SPECIALTIES } from "../estimate/legacy/specialties";
import { detectSpecialty } from "../estimate/legacy/specialtyDetector";
import { effectiveProcedure } from "../estimate/legacy-estimate";
import { detectTrade } from "../estimate/trade-knowledge";
import type { JobScope, MeasureAsk, SheetLite } from "./ask";
import type { PlanTrade, TakeoffUnit } from "./takeoff";

const NOT_A_BUILD_TRADE =
  /engineer|architect|survey|consult|study|analysis|estimating|inspector|expediter|owners-representative|construction-manager|entitlement|zoning|density|buildable|lot-split|highest-best|constructability|phasing|cpm-|risk-|bim-|drafting|roadway|road-|highway|parking-lot|pothole|chip-seal|slurry|striping|guardrail|traffic|signage|snow|pest|remediation|restoration|insurance|disaster|mold|asbestos|testing|thermal-imaging|energy-audit|design-build|general-contracting|home-builder|adu-builder|manufactured|mobile-home|prefab|remodel|repair|replacement|refinishing|conversion|retrofit|sweep|cleaning|leak-detection|maintenance|appliance|feasibility|cost-|landscape-architect|preconstruction|rom-|conceptual|curtain-wall|storefront|commercial|tenant|culvert|catch-basin|lift-station|pump-station|utility-vault|conduit-duct|sanitary-sewer|storm-sewer|water-utility|underground-utility-installation|directional|hydrovac|rock-excavation|shoring|dewatering|mass-excavation|crack-sealing|sealcoating|curb-gutter|ada-ramp|demolition|concrete-cutting|metal-fabrication|structural-steel|permit-consultant|home-inspector/;

/** The specialties that build something, with their names — what a job may be priced by. */
export const BUILD_SPECIALTIES: Array<{ id: string; name: string }> = AI_SPECIALTIES.filter((s) => !NOT_A_BUILD_TRADE.test(s.id) && effectiveProcedure(s.id, null)).map((s) => ({ id: s.id, name: s.name }));
const BY_ID = new Map(BUILD_SPECIALTIES.map((s) => [s.id, s.name]));

export const isBuildSpecialty = (id: string | null | undefined): id is string => !!id && BY_ID.has(id);
export const specialtyName = (id: string): string => BY_ID.get(id) ?? id;

/** Words the keyword detector misses or misreads for a new build, said plainly. */
const SAID: Array<[RegExp, string]> = [
  [/\bpavers?\b|paver patio|interlocking/i, "hardscape"],
  [/outdoor kitchen|bbq island|grill island/i, "outdoor-kitchen"],
  [/pergola|covered porch|porch cover|patio cover/i, "patio-cover"],
  [/closet (system|organi[sz])|built-?ins?\b|mudroom lockers/i, "built-in-cabinetry"],
  [/stair rail|railings?|balusters?|newel/i, "finish-carpentry"],
  [/\btruss(es)?\b|lumber package/i, "framing-contractor"],
  [/\bhvac\b|heat pumps?|furnace|air condition/i, "residential-hvac"],
  [/epoxy|garage floor coating/i, "epoxy-flooring"],
  [/shower (glass|doors?|enclosure)|frameless glass/i, "shower-mirror"],
];

/** The specialty a request names in words, the way Smart Proposal reads a brief. */
export function specialtyForWords(text: string): string | null {
  const said = SAID.find(([re]) => re.test(text))?.[1];
  if (said && isBuildSpecialty(said)) return said;
  const hit = detectSpecialty(text);
  return hit && isBuildSpecialty(hit.specialty.id) ? hit.specialty.id : null;
}

/** The validator's profile for a specialty's work (lib/estimate/trade-knowledge). */
export function profileForWords(text: string): string {
  return detectTrade(text).id;
}

/**
 * The unit a specialty measures its work in. Its procedure says so first ("fence run in
 * linear feet", "deck area in sqft", "sprinkler heads each"); else the most common unit
 * of its steps.
 */
export function unitOfSpecialty(id: string): TakeoffUnit {
  const proc = effectiveProcedure(id, null);
  const basis = (proc?.basis ?? "").toLowerCase();
  const said: Array<[RegExp, TakeoffUnit]> = [
    [/linear f(ee|oo)?t|\blf\b|by the foot|in feet/, "linear ft"],
    [/sq ?ft|sqft|square f(ee|oo)t|\barea\b/, "sq ft"],
    [/cubic yard/, "cu yards"],
    [/\beach\b|by (count|module count)/, "each"],
  ];
  const first = said.map(([re, u]) => ({ u, at: basis.search(re) })).filter((x) => x.at >= 0).sort((a, b) => a.at - b.at)[0];
  if (first) return first.u;
  const steps = proc?.steps ?? [];
  const count = new Map<TakeoffUnit, number>();
  for (const s of steps) {
    const u = String(s.unit ?? "").toLowerCase();
    const t: TakeoffUnit | null = /sq ?ft|sqft|sf/.test(u) ? "sq ft" : /linear|lf/.test(u) ? "linear ft" : /cu/.test(u) ? "cu yards" : /^unit|each|ea/.test(u) ? "each" : null;
    if (t) count.set(t, (count.get(t) ?? 0) + 1);
  }
  return Array.from(count.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "each";
}

/** The house trade a specialty's lines are filed under (only for grouping and the trade's neighbours). */
export function bucketOf(id: string): PlanTrade {
  const MAP: Array<[RegExp, PlanTrade]> = [
    [/fenc|gate|landscap|irrigation|hardscape|paving|asphalt|flatwork|sidewalk|pool|erosion|tree|stump|excavat|trench|septic|utility|grading/, "sitework"],
    [/concrete|foundation|basement|crawlspace|waterproof/, "foundation"],
    [/deck|patio-cover|carport|garage-builder|framing/, "framing"],
    [/roof|skylight|sun-tunnel|solar(?!.*water)/, "roofing"],
    [/gutter/, "gutters"],
    [/window|glass|glazing|door/, "windows-doors"],
    [/siding|stucco|masonry|metal-cladding|house-wrap|sealant/, "siding"],
    [/insulation|attic|radiant-barrier|air-sealing|soundproof|blower/, "insulation"],
    [/drywall|acoustic|wallcovering/, "drywall"],
    [/carpentry|trim|wainscot|millwork|cabinet|closet|stair/, "interior-trim"],
    [/floor|epoxy/, "flooring"],
    [/tile|shower-mirror/, "tile"],
    [/countertop|outdoor-kitchen/, "cabinets"],
    [/paint/, "painting"],
    [/plumb|water-heater|gas-line|backflow|sump|greywater|well/, "plumbing"],
    [/electric|generator|battery|surge|ev-charger|smart-home|data|security|low ?voltage|fire-alarm/, "electrical"],
    [/hvac|duct|radiant-floor|fan|iaq|fireplace|chimney|fire-pit/, "hvac"],
    [/fire-protection|sprinkler|elevator/, "general"],
  ];
  return MAP.find(([re]) => re.test(id))?.[1] ?? "general";
}

/**
 * A job no keyword rule knows and the model could not plan ("a cedar fence along the
 * property line"): priced by the specialty its words name, measured on the sheets that
 * show work of its kind — the site plan and the floor plans, the elevations for a
 * wall finish — in the unit the specialty prices in.
 */
export function scopeBySpecialty(request: string, sheets: SheetLite[]): JobScope | null {
  const id = specialtyForWords(request);
  if (!id) return null;
  const trade = bucketOf(id);
  const unit = unitOfSpecialty(id);
  const outside = trade === "sitework" || trade === "foundation" || /deck|patio|carport|garage|solar|roof/.test(id);
  const walls = trade === "siding" || trade === "painting";
  const kinds = new Set<SheetLite["kind"]>(outside ? ["site", "floor", "roof"] : walls ? ["elevation", "floor"] : ["floor", "electrical", "plumbing", "mechanical"]);
  const pages = sheets.filter((s) => kinds.has(s.kind)).map((s) => s.page).slice(0, 6);
  if (!pages.length) return null;
  const name = specialtyName(id);
  const measure: MeasureAsk = {
    label: request.trim().replace(/\s+/g, " ").slice(0, 100),
    unit,
    replaces: null,
    trade,
    role: "both",
    pages,
    combine: "sum",
    how: `measure, from the dimension strings, what this sheet draws of: «${request.trim().slice(0, 200)}» — in ${unit}; 0 or not found when the sheet does not show it`,
  };
  return {
    title: name,
    summary: `${name} from the plans, measured on the sheets that show it.`,
    itemIds: [],
    measure: [measure],
    specialties: { [trade]: id },
    labels: { [trade]: name },
    notIncluded: [],
    wholeHouse: false,
    from: "rules",
  };
}

/**
 * Every group of a job's lines priced by a specialty that builds it: the one the plan
 * named, else — for lines the house's build list has no trade for — the one the words
 * name. A group of the build list's own lines keeps its trade's specialty.
 */
export function settleSpecialties(scope: JobScope, request: string, buildListTrades: Set<PlanTrade>): JobScope {
  const specialties: Partial<Record<PlanTrade, string>> = {};
  const labels: Partial<Record<PlanTrade, string>> = { ...(scope.labels ?? {}) };
  for (const [t, id] of Object.entries(scope.specialties) as Array<[PlanTrade, string]>) if (isBuildSpecialty(id)) specialties[t] = id;
  const measuredOnly = new Set(scope.measure.filter((m) => !m.replaces).map((m) => m.trade).filter((t) => !buildListTrades.has(t)));
  const words = specialtyForWords(`${scope.title} ${request}`);
  for (const t of measuredOnly) if (!specialties[t] && words) specialties[t] = words;
  for (const [t, id] of Object.entries(specialties) as Array<[PlanTrade, string]>) labels[t] = labels[t] ?? specialtyName(id);
  return { ...scope, specialties, labels };
}
