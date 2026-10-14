// THE ASK — what the contractor wants out of a plan set, made into a job. Pure.
//
// The plans are read in the background the moment they are opened (lib/plans/sheet →
// takeoff → build list). Nothing is priced until the contractor says what they want:
// "granite countertops", "drywall with texture and primer", "just the drywall". Then:
//
//   1. the job    which lines of the build list it takes, what still has to be measured
//                 on which sheets, and which specialty prices it — planned by the model
//                 from the request, the sheets and the build list (askPlanPrompt), with
//                 a keyword reading (JOBS) as its first guess and as the fallback
//   2. measuring  the sheets that show it are looked at again for exactly those things
//                 (focusPrompt): every counter run, the island, each vanity top
//   3. the lines  a measurement replaces the build list's rule-of-thumb number, and the
//                 materials that rest on it follow (computeTakeoff's `measured`)
//
// Every number keeps saying where it came from.
import { round } from "./dims";
import type { SheetRead } from "./sheet";

/** A sheet as the job planner needs it: what it is and the rooms it names. */
export type SheetLite = {
  page: number;
  kind: SheetRead["kind"];
  title: string | null;
  level: string | null;
  rooms: Array<{ name: string }>;
  /** What the first look found on the sheet: its drawings, schedules, the notes that specify work. */
  contents?: string[];
};

export function sheetLite(s: SheetRead): SheetLite {
  return { page: s.page, kind: s.kind, title: s.title || null, level: s.level, rooms: s.rooms.slice(0, 80).map((r) => ({ name: r.name.slice(0, 80) })) };
}
import { PLAN_TRADES, TRADE_LABEL, type PlanTrade, type TakeoffItem, type TakeoffRole, type TakeoffUnit } from "./takeoff";

/** One thing to measure on the sheets for this job. */
export type MeasureAsk = {
  /** What it is, in a contractor's words ("Kitchen countertops"). */
  label: string;
  unit: TakeoffUnit;
  /** The build-list line this measurement replaces, or null for a line of its own. */
  replaces: string | null;
  trade: PlanTrade;
  role: TakeoffRole;
  /** The sheets that show it. */
  pages: number[];
  /** Read on several sheets: add them up (one per floor) or keep the best reading (a plan and its elevation). */
  combine: "sum" | "best";
  /** How to measure it ("each run along the wall from the dimension strings × 25½\" deep, in sq ft"). */
  how: string;
};

export type JobScope = {
  /** The job's name ("Granite countertops"). */
  title: string;
  /** One sentence: what will be priced. */
  summary: string;
  /** Build-list lines that belong to the job as they stand — the work and its materials. */
  itemIds: string[];
  measure: MeasureAsk[];
  /**
   * Sheets whose notes, schedules or details specify the job's materials and methods
   * ("countertops 3cm quartz, eased edge") — looked at closely for those, whatever their kind.
   */
  specPages: number[];
  /**
   * The estimator specialty that prices a group of the job's lines when the group's own
   * trade is not the one (countertops: the countertop installer; a fence: fencing).
   * Checked against the estimator's catalog on the server (lib/plans/specialties).
   */
  specialties: Partial<Record<PlanTrade, string>>;
  /** What a group's lines are headed with on the estimate ("Fencing"), when not the trade's name. */
  labels?: Partial<Record<PlanTrade, string>>;
  /** What the job leaves out that a client might expect — said on the proposal. */
  notIncluded: string[];
  wholeHouse: boolean;
  from: "model" | "rules";
};


const UNITS: TakeoffUnit[] = ["sq ft", "linear ft", "each", "cu yards", "squares", "sheets", "tons", "boxes", "bundles", "rolls", "gallons", "bags", "pieces", "sq yd", "sets", "buckets", "tubes", "lot"];

/** A unit as a model or a person writes it, in the takeoff's words. */
export function unitWord(u: unknown): TakeoffUnit | null {
  const s = String(u ?? "").trim().toLowerCase();
  if (!s) return null;
  if ((UNITS as string[]).includes(s)) return s as TakeoffUnit;
  if (/^(sq\.?\s*ft|sqft|sf|square\s*(feet|foot)|ft2)$/.test(s)) return "sq ft";
  if (/^(lf|lin\.?\s*ft|linear\s*(feet|foot)|ln\s*ft|ft|feet)$/.test(s)) return "linear ft";
  if (/^(ea|each|pcs?|count|unit|units)$/.test(s)) return "each";
  if (/^(cy|cu\.?\s*yd|cubic\s*yards?)$/.test(s)) return "cu yards";
  if (/^(sy|sq\.?\s*yd|square\s*yards?)$/.test(s)) return "sq yd";
  return null;
}

// ── the keyword reading ─────────────────────────────────────────────────────

type MeasureTemplate = Omit<MeasureAsk, "pages"> & {
  /** The sheets to look on: these kinds, and of them the ones naming these rooms. */
  kinds: SheetRead["kind"][];
  rooms?: RegExp;
};

type Job = {
  key: string;
  title: string;
  /** The request names this job. */
  words: RegExp;
  /** …unless it says this. */
  not?: RegExp;
  /** The build-list lines it takes (full ids). */
  ids: RegExp;
  measure?: MeasureTemplate[];
  specialties?: Partial<Record<PlanTrade, string>>;
  /** Lines of its own the build list has no row for, derived from the build list. */
  extra?: (q: (id: string) => number) => Array<Omit<TakeoffItem, "pages" | "source"> & { source?: TakeoffItem["source"] }>;
  notIncluded?: string[];
};

const COUNTER_HOW =
  "each counter run along its wall from the dimension strings (the cabinet run under it), at its depth — 25½\" unless drawn deeper — plus any seating overhang; in sq ft";

/** What a request names, job by job. Several may match one request ("drywall with texture and paint"). */
export const JOBS: Job[] = [
  {
    key: "countertops",
    title: "Countertops",
    words: /\bcounter ?tops?\b|\bcounters?\b|\bgranite\b|\bquartz(ite)?\b|\bmarble\b|solid[- ]surface|\bstone tops?\b|vanity tops?/,
    ids: /^cabinets\.(tops-.*|island-top|vanity-tops|template|cutouts)$/,
    specialties: { cabinets: "countertop-installer" },
    measure: [
      { label: "Kitchen countertops", unit: "sq ft", replaces: "cabinets.tops-kitchen", trade: "cabinets", role: "material", combine: "best", how: COUNTER_HOW, kinds: ["floor", "detail"], rooms: /kitchen/i },
      { label: "Island / peninsula top", unit: "sq ft", replaces: "cabinets.island-top", trade: "cabinets", role: "material", combine: "best", how: "the island's (or peninsula's) length × width with its overhangs, in sq ft; 0 if the kitchen has none", kinds: ["floor", "detail"], rooms: /kitchen/i },
      { label: "Bathroom vanity tops", unit: "sq ft", replaces: "cabinets.vanity-tops", trade: "cabinets", role: "material", combine: "sum", how: "every vanity's length from the dimension strings × 22\" deep, in sq ft — all the baths on this sheet", kinds: ["floor"], rooms: /bath|\bba\b|pdr|powder|vanity/i },
      { label: "Sink and cooktop cutouts", unit: "each", replaces: "cabinets.cutouts", trade: "cabinets", role: "both", combine: "sum", how: "every sink drawn in a counter (kitchen, bar, each vanity bowl) and the cooktop", kinds: ["floor"], rooms: /kitchen|bath|\bba\b|pdr|laundry|bar/i },
    ],
    notIncluded: ["Cabinets, plumbing hook-up and the backsplash tile are priced separately."],
  },
  {
    key: "backsplash",
    title: "Backsplash",
    words: /backsplash|\bsplash\b/,
    ids: /^tile\.(backsplash|back-tile|edge)$/,
    measure: [
      { label: "Kitchen backsplash", unit: "sq ft", replaces: "tile.backsplash", trade: "tile", role: "labor", combine: "best", how: "the wall between the counters and the wall cabinets (18\" tall unless drawn) along every run, behind the range to the hood; in sq ft", kinds: ["floor", "detail"], rooms: /kitchen/i },
    ],
  },
  {
    key: "cabinets",
    title: "Cabinets",
    words: /\bcabinet(s|ry)?\b|\bvanit(y|ies)\b(?! tops?)|\bkitchen boxes\b/,
    ids: /^cabinets\.(base-.*|upper-.*|vanities|island|pantry|laundry|install|hardware|crown)$/,
    measure: [
      { label: "Kitchen base cabinets", unit: "linear ft", replaces: "cabinets.base-kitchen", trade: "cabinets", role: "material", combine: "best", how: "every base-cabinet run along the walls from the dimension strings, in linear ft (the island separately)", kinds: ["floor", "detail"], rooms: /kitchen/i },
      { label: "Kitchen wall cabinets", unit: "linear ft", replaces: "cabinets.upper-kitchen", trade: "cabinets", role: "material", combine: "best", how: "every wall-cabinet run (dashed above the counters on a plan), in linear ft", kinds: ["floor", "detail"], rooms: /kitchen/i },
      { label: "Bathroom vanities", unit: "each", replaces: "cabinets.vanities", trade: "cabinets", role: "material", combine: "sum", how: "every vanity cabinet (a double vanity is one)", kinds: ["floor"], rooms: /bath|\bba\b|pdr|powder/i },
    ],
  },
  {
    key: "appliances",
    title: "Appliances",
    words: /appliances?|\brange\b|refrigerator|\bfridge\b|dishwasher|microwave|\boven\b|\bhood\b|cooktop/,
    not: /range of|price range|gas (line|pipe|piping)/,
    ids: /^cabinets\.app-.*$/,
  },
  {
    key: "drywall",
    title: "Drywall",
    words: /dry ?wall|sheet ?rock|gypsum|wall ?board|hang(ing)?,? tape|tape and (mud|finish)|mud and tape/,
    ids: /^drywall\.(walls|ceilings|garage|garage-rest|regular|mr|typex|mud|tape|bead|screws)$/,
  },
  {
    key: "texture",
    title: "Texture",
    words: /textur|orange ?peel|knock ?-?down|skip ?trowel/,
    ids: /^drywall\.texture$/,
  },
  {
    key: "paint-interior",
    title: "Interior paint",
    words: /\bpaint(ing|ed|er)?\b|\bprim(e|er|ing)\b/,
    // Exterior named and nothing inside: the outside only.
    not: /^(?!.*\b(interior|inside|walls?|ceilings?|rooms?|drywall|primer)\b).*\b(exterior|outside|siding)\b/,
    ids: /^painting\.(interior|primer|wall-paint|ceiling-paint|sundries)$/,
  },
  {
    key: "paint-exterior",
    title: "Exterior paint",
    words: /(exterior|outside|siding)[^.]{0,20}paint|paint[^.]{0,20}(exterior|outside|siding)/,
    ids: /^painting\.(exterior|ext-paint|sundries)$/,
  },
  {
    key: "paint-trim",
    title: "Trim and doors paint",
    words: /paint[^.]{0,30}(trim|doors|base|casing)|(trim|doors)[^.]{0,20}paint|enamel/,
    ids: /^painting\.(doors|trim-paint)$/,
  },
  {
    key: "flooring",
    title: "Flooring",
    words: /\bfloor(ing|s)?\b(?! plans?)|hardwood|\blvp\b|vinyl plank|laminate|\bcarpet/,
    // A specialist's floor (radiant heat, an epoxy coating) is that specialist's job.
    // …and floors named with tile and no other finish are the tile setter's.
    not: /tile floor|floor tile|floor framing|subfloor|floor joists?|floor system|floor insulation|radiant|heated floor|epoxy|floor coating|^(?!.*\b(hardwood|lvp|vinyl|laminate|carpet)).*\btil(e|es|ing)\b/,
    ids: /^flooring\..*$/,
  },
  {
    key: "tile",
    title: "Tile",
    words: /\btil(e|es|ing)\b|shower (walls|surround|pan)|tub surround/,
    not: /roof tile/,
    ids: /^tile\..*$/,
  },
  {
    key: "roofing",
    title: "Roofing",
    words: /\broof(ing|s)?\b|shingles?|re-?roof/,
    // Solar on the roof is the solar installer's job.
    not: /roof framing|roof trusses|roof sheathing|solar/,
    ids: /^roofing\..*$/,
  },
  { key: "gutters", title: "Gutters", words: /gutters?|downspouts?/, ids: /^gutters\..*$/ },
  { key: "siding", title: "Siding", words: /siding|hardie|cladding|soffit|fascia|house ?wrap|lap siding/, ids: /^siding\..*$/ },
  {
    key: "windows",
    title: "Windows",
    words: /\bwindows?\b|skylights?/,
    ids: /^windows-doors\.(win-.*|windows|install-win|flash-tape|foam|sealant)$/,
  },
  {
    key: "ext-doors",
    title: "Exterior doors",
    words: /(exterior|entry|front|back|patio|sliding( glass)?|french) doors?/,
    ids: /^windows-doors\.(door-(?!o-h).*|ext-doors|install-door|entry-hw)$/,
  },
  {
    key: "garage-doors",
    title: "Garage doors",
    words: /garage doors?|overhead doors?|(door )?openers?/,
    ids: /^windows-doors\.(door-o-h.*|garage-door|install-oh|openers)$|^electrical\.opener-recept$/,
  },
  {
    key: "trim",
    title: "Interior doors and trim",
    words: /interior doors?|\btrim\b(?![- ]?out)|base ?boards?|casings?|finish carpentry|mou?ldings?|closet shel|shelving|handrails?|stair rail/,
    not: /exterior trim|siding trim|trim[- ]out|paint[^.]{0,20}trim|trim[^.]{0,20}paint/,
    ids: /^interior-trim\..*$/,
  },
  { key: "insulation", title: "Insulation", words: /insulat|\bbatts?\b|blown[- ]in|air seal/, ids: /^insulation\..*$/ },
  {
    key: "framing",
    title: "Framing",
    words: /\bfram(e|ing)\b|lumber|\bstuds?\b|trusses|sheathing|rough carpentry/,
    ids: /^framing\..*$/,
  },
  {
    key: "concrete",
    title: "Foundation and concrete",
    words: /foundation|footings?|concrete|\bslabs?\b|stem walls?|flatwork|driveway|side ?walks?|\bwalks?\b|\bpatio\b/,
    not: /walk-?in|patio doors?|asphalt|blacktop|pavers?|patio cover/,
    ids: /^foundation\..*$/,
  },
  { key: "sitework", title: "Site work", words: /excavat|site ?work|grading|clearing|\bdig\b|backfill|erosion|silt fence/, ids: /^sitework\..*$/ },
  {
    key: "plumbing",
    title: "Plumbing",
    words: /plumb|stub[- ]?outs?|toilets?|faucets?|\bsinks?\b|water heater|\bpex\b|\bdwv\b|fixtures? (set|install)/,
    // A sink cut out of a countertop is the countertop's work.
    not: /sink cut ?-?outs?|cut ?-?outs? for (the )?sinks?/,
    ids: /^plumbing\..*$/,
  },
  {
    key: "electrical",
    title: "Electrical",
    words: /electric|wiring|\bwire\b|outlets?|receptacles?|switch(es)?|light(s|ing| fixtures?)\b|\bpanel\b|low voltage|\bdata\b/,
    // Security, solar, a generator and an EV charger each have their own specialist.
    not: /electric (water heater|range|fireplace)|security|camera|alarm|solar|generator|ev charger|car charger/,
    ids: /^electrical\..*$/,
  },
  {
    key: "hvac",
    title: "Heating and cooling",
    words: /\bhvac\b|heating|cooling|\ba\/?c\b|air condition|furnace|heat pump|\bducts?\b|duct ?work|mini ?split|ventilation/,
    not: /radiant|attic ventilation/,
    ids: /^hvac\..*$/,
  },
  {
    key: "gas",
    title: "Gas piping",
    words: /gas (line|lines|pipe|piping)|\bcsst\b|gas to the/,
    ids: /^plumbing\.(gas|csst|gas-valves|fix-gasRange|fix-gasFireplace)$/,
  },
  {
    key: "fireplace",
    title: "Fireplace",
    words: /fireplace/,
    not: /gas (line|lines|pipe|piping)/,
    ids: /^(hvac\.fireplace|interior-trim\.mantel|tile\.fireplace|plumbing\.fix-gasFireplace)$/,
  },
  {
    key: "general",
    title: "General conditions",
    words: /general conditions|\bpermits?\b|supervision|\bsurvey\b/,
    ids: /^general\..*$/,
  },
];

/** "Only the drywall", "just paint": the request wants nothing beyond what it names. */
const ONLY = /\b(only|just|nothing else)\b/;
const WHOLE = /whole (house|home|build|job)|entire (house|home|build)|every(thing| trade)|all (the )?trades|full (build|house)|complete (house|home|build)|build (the|this) (house|home)/;

/** The jobs a request names, by its words. */
export function jobsNamed(request: string): Job[] {
  const r = request.toLowerCase();
  return JOBS.filter((j) => j.words.test(r) && !(j.not && j.not.test(r)));
}

/**
 * The keyword reading of a request against the build list: the lines the named jobs take,
 * the measurements they want, the sheets that show them. A priming coat asked for without
 * paint is a line of its own (the build list paints and primes together).
 */
export function scopeByRules(request: string, items: TakeoffItem[], sheets: SheetLite[]): JobScope | null {
  const r = request.toLowerCase().trim();
  if (!r) return null;
  if (WHOLE.test(r)) {
    return {
      title: "The whole house",
      summary: "Every trade of the house, from the site work to the final clean, as the plans show it.",
      itemIds: items.map((i) => i.id),
      measure: [],
      specPages: [],
      specialties: {},
      notIncluded: [],
      wholeHouse: true,
      from: "rules",
    };
  }
  const jobs = jobsNamed(r);
  if (!jobs.length) return null;
  const ids = new Set(items.filter((i) => jobs.some((j) => j.ids.test(i.id))).map((i) => i.id));
  // Primer without paint: the build list's paint line is "prime and paint" — keep the
  // primer, drop the finish coats and their paint.
  const primeOnly = /\bprim(e|er|ing)\b/.test(r) && !/\bpaint(ing|ed)?\b/.test(r.replace(/\bprim(e|er|ing) and paint\b/, "paint"));
  if (primeOnly) for (const id of ["painting.interior", "painting.wall-paint", "painting.ceiling-paint"]) ids.delete(id);
  // A measurement whose line the build list never assumed (an island in a small kitchen)
  // is a line of its own.
  const measure = jobs
    .flatMap((j) => (j.measure ?? []).map((m) => withPages(m, sheets)))
    .filter((m) => m.pages.length)
    .map((m) => (m.replaces && !ids.has(m.replaces) ? { ...m, replaces: null } : m));
  const specialties: Partial<Record<PlanTrade, string>> = {};
  for (const j of jobs) Object.assign(specialties, j.specialties ?? {});
  // A job that is all one trade's specialty work keeps it; a countertop job beside a
  // cabinet job is priced by the cabinet trade's own specialty.
  if (jobs.some((j) => j.key === "cabinets")) delete specialties.cabinets;
  // The sheets whose contents speak of the job (a countertop edge detail, a finish schedule).
  const measured = new Set(measure.flatMap((m) => m.pages));
  const specPages = pagesAbout(sheets, (line) => jobs.some((j) => j.words.test(line.toLowerCase())), measured);
  const titles = jobs.map((j) => j.title);
  const title = primeOnly ? titles.map((t) => (t === "Interior paint" ? "Primer" : t)).join(", ") : titles.join(", ");
  return {
    title: sentenceCase(title),
    summary: `${sentenceCase(title)} from the plans${ONLY.test(r) ? " — nothing else" : ""}.`,
    itemIds: Array.from(ids),
    measure,
    specPages,
    specialties,
    notIncluded: jobs.flatMap((j) => j.notIncluded ?? []),
    wholeHouse: false,
    from: "rules",
  };
}

/** The lines a scope adds that the build list has no row for (a priming coat on its own). */
export function scopeExtras(request: string, scope: JobScope, items: TakeoffItem[]): TakeoffItem[] {
  const r = request.toLowerCase();
  const q = (id: string) => items.find((i) => i.id === id)?.qty ?? 0;
  const out: TakeoffItem[] = [];
  const primeOnly = /\bprim(e|er|ing)\b/.test(r) && !scope.itemIds.includes("painting.interior") && scope.itemIds.includes("painting.primer");
  if (primeOnly && q("painting.interior") > 0) {
    out.push({
      id: "ask.prime",
      trade: "painting",
      label: "Prime walls and ceilings — one coat of PVA primer",
      qty: q("painting.interior"),
      unit: "sq ft",
      source: "derived",
      basis: "the drywall's walls and ceilings",
      pages: items.find((i) => i.id === "painting.interior")?.pages ?? [],
      role: "labor",
      phase: "Interior",
    });
  }
  return out;
}

/** Up to three sheets whose first-look contents mention the job — beside the ones measured. */
export function pagesAbout(sheets: SheetLite[], about: (line: string) => boolean, besides: Set<number> = new Set()): number[] {
  return sheets
    .filter((s) => !besides.has(s.page) && (s.contents ?? []).some(about))
    .map((s) => s.page)
    .slice(0, 3);
}

function withPages(m: MeasureTemplate, sheets: SheetLite[]): MeasureAsk {
  const ofKind = sheets.filter((s) => m.kinds.includes(s.kind));
  const named = m.rooms ? ofKind.filter((s) => s.rooms.some((r) => m.rooms!.test(r.name))) : ofKind;
  // A detail sheet that names none of the rooms is an interior elevation set only when it says so.
  const pages = (named.length ? named : ofKind.filter((s) => s.kind === "floor")).map((s) => s.page).slice(0, 4);
  const { kinds: _k, rooms: _r, ...rest } = m;
  void _k;
  void _r;
  return { ...rest, pages };
}

const sentenceCase = (s: string) => {
  const t = s.toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

// ── the model's plan of the job ─────────────────────────────────────────────

export const ASK_SYSTEM =
  "You plan construction estimates from a house's plan set. You choose, from a takeoff that lists every quantity the plans give, exactly the lines the contractor's job needs, and you say what must still be measured on which sheets. You answer with JSON only.";

const fmtQ = (n: number) => (Number.isInteger(n) ? n.toLocaleString("en-US") : round(n, 1).toLocaleString("en-US"));

/** The sheets as the planner sees them: page, kind, title, floor and the rooms it names. */
export function sheetIndex(sheets: SheetLite[]): string {
  return sheets
    .map((s) => {
      const rooms = s.rooms.map((r) => r.name).slice(0, 24);
      const shows = (s.contents ?? []).slice(0, 16);
      return `  p.${s.page} · ${s.kind}${s.title ? ` · "${s.title}"` : ""}${s.level ? ` · ${s.level}` : ""}${rooms.length ? ` · rooms: ${rooms.join(", ")}` : ""}${shows.length ? ` · shows: ${shows.join("; ")}` : ""}`;
    })
    .join("\n");
}

export function askPlanPrompt(input: {
  request: string;
  houseFacts: string;
  sheets: SheetLite[];
  items: TakeoffItem[];
  guess: JobScope | null;
  /** The estimator's building specialties a group of lines may be priced by (lib/plans/specialties). */
  specialties: Array<{ id: string; name: string }>;
}): string {
  const byTrade = PLAN_TRADES.map((t) => {
    const mine = input.items.filter((i) => i.trade === t);
    if (!mine.length) return "";
    return [`  [${TRADE_LABEL[t]}]`, ...mine.map((i) => `    ${i.id} · ${i.role ?? "both"} · ${i.label} · ${fmtQ(i.qty)} ${i.unit} · ${i.source === "rule" ? "ASSUMED" : i.source}`)].join("\n");
  })
    .filter(Boolean)
    .join("\n");
  const guess = input.guess
    ? `A FIRST GUESS FROM THE REQUEST'S WORDS (correct it freely): ${input.guess.title}; lines ${input.guess.itemIds.length}; measure: ${input.guess.measure.map((m) => `${m.label} (${m.unit}, pages ${m.pages.join(",")})`).join("; ") || "nothing"}.`
    : "The request's words matched no trade by keyword — read it yourself.";
  return [
    `THE CONTRACTOR ASKS: «${input.request.trim()}»`,
    "",
    `THE HOUSE: ${input.houseFacts}.`,
    "",
    "THE SHEETS (page · kind · title · floor · rooms · what a first look found on each):",
    sheetIndex(input.sheets),
    "",
    "THE BUILD LIST (id · work/material · line · quantity · where it came from; ASSUMED = a rule of thumb, not drawn):",
    byTrade,
    "",
    guess,
    "",
    "Answer with JSON:",
    `{"title": "the job in 2-5 words", "summary": "one sentence: what will be priced", "itemIds": ["ids from the build list"], "measure": [{"label": "", "unit": "sq ft|linear ft|each|cu yards", "replaces": "an id from the build list or null", "trade": "${PLAN_TRADES.join("|")}", "role": "labor|material|both", "pages": [page numbers], "combine": "sum|best", "how": "how to measure it on the sheet"}], "specPages": [pages whose notes, schedules or details specify the job], "specialties": {"trade": "specialty id"}, "notIncluded": ["what this job leaves out that the client might expect"], "wholeHouse": false}`,
    "",
    "RULES:",
    "1. Only the job asked for. \"Just\" or \"only\" means nothing beyond it. A job named by its finish takes the work that makes it and that work's materials (granite countertops: the tops, template, fabrication, install, cutouts — not the cabinets; drywall with texture: hang, tape, finish, texture and the board, mud, tape and screws — not paint unless asked).",
    "2. itemIds are the build-list lines the job takes AS THEY STAND — the work lines and their material lines. Use only ids that are in the list.",
    "3. Measure, do not assume: when a line the job rests on is ASSUMED, add a measure that replaces it, on the sheets that draw it (floor plans for counters, cabinets, floors and fixtures; interior elevations and details where the sheet list has them). A part of the house (the bedrooms only, the garage only, the kitchen floor) is measured as a line of its own (replaces null) and the whole-house line is left out.",
    "4. Each measure names its pages (at most 6 pages in all) and how to combine them: sum when each page shows a different part (one floor each), best when two pages show the same thing (a plan and its elevation).",
    "5. Work the build list has no line for — a fence, a deck, pavers, a pool, solar, landscaping and irrigation, stucco or stone, fire sprinklers, closet systems — is measured on the sheets that draw it (the site plan for work outside the house, the elevations for a wall finish, the floor plans inside) as lines of its own (replaces null), filed under the nearest trade.",
    "6. specialties: for each trade whose lines are priced by a specialty other than that trade's own, the specialty id that does the job (granite countertops → \"cabinets\": \"countertop-installer\"; a cedar fence filed under sitework → \"sitework\": \"fencing\"). Only ids from this list:",
    `   ${input.specialties.map((x) => x.id).join(", ")}`,
    "7. wholeHouse is true only when the contractor asks for the whole house; then itemIds is every id and measure is [].",
    "8. Go by what each sheet shows, not only its kind: a detail sheet with the kitchen's interior elevations is where counter heights, backsplashes and cutouts are drawn — measure there too. specPages: up to 4 sheets whose notes, schedules or details specify this job's materials, finishes or methods (\"note: countertops 3cm quartz\", a finish schedule, a countertop edge detail) — they are read for those specs, so the job is priced as the plans call for it.",
  ].join("\n");
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * The model's plan, checked against the build list, the sheets and the specialties the
 * estimator knows (`knownSpecialty`). Null when nothing usable came back.
 */
export function cleanScope(raw: unknown, items: TakeoffItem[], sheets: SheetLite[], knownSpecialty: (id: string) => boolean = () => false): JobScope | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const known = new Set(items.map((i) => i.id));
  const pagesKnown = new Set(sheets.map((s) => s.page));
  const wholeHouse = o.wholeHouse === true;
  const itemIds = wholeHouse ? items.map((i) => i.id) : Array.from(new Set((Array.isArray(o.itemIds) ? o.itemIds : []).map((x) => str(x, 120)).filter((id) => known.has(id))));
  const measure: MeasureAsk[] = [];
  let pageBudget = 6;
  for (const m of Array.isArray(o.measure) ? o.measure.slice(0, 12) : []) {
    if (!m || typeof m !== "object") continue;
    const x = m as Record<string, unknown>;
    const label = str(x.label, 120);
    const unit = unitWord(x.unit);
    const replaces = typeof x.replaces === "string" && known.has(x.replaces) ? x.replaces : null;
    const replaced = replaces ? items.find((i) => i.id === replaces) : undefined;
    const trade = (PLAN_TRADES as readonly string[]).includes(String(x.trade)) ? (x.trade as PlanTrade) : replaced?.trade;
    if (!label || !unit || !trade) continue;
    const pages = Array.from(new Set((Array.isArray(x.pages) ? x.pages : []).map(Number).filter((p) => pagesKnown.has(p)))).slice(0, Math.max(0, pageBudget));
    if (!pages.length) continue;
    pageBudget -= pages.length;
    measure.push({
      label,
      // A measurement that replaces a line is in that line's unit.
      unit: replaced ? replaced.unit : unit,
      replaces,
      trade,
      role: x.role === "labor" || x.role === "material" || x.role === "both" ? x.role : replaced?.role ?? "both",
      pages,
      combine: x.combine === "best" ? "best" : "sum",
      how: str(x.how, 300),
    });
    // The line a measurement replaces is part of the job.
    if (replaces && !itemIds.includes(replaces)) itemIds.push(replaces);
  }
  if (!itemIds.length && !measure.length) return null;
  const measuredPages = new Set(measure.flatMap((m) => m.pages));
  const specPages = Array.from(new Set((Array.isArray(o.specPages) ? o.specPages : []).map(Number).filter((p) => pagesKnown.has(p) && !measuredPages.has(p)))).slice(0, 4);
  const specialties: Partial<Record<PlanTrade, string>> = {};
  if (o.specialties && typeof o.specialties === "object") {
    for (const [t, sp] of Object.entries(o.specialties as Record<string, unknown>)) {
      if ((PLAN_TRADES as readonly string[]).includes(t) && knownSpecialty(String(sp))) specialties[t as PlanTrade] = String(sp);
    }
  }
  return {
    title: str(o.title, 80) || "The job",
    summary: str(o.summary, 300),
    itemIds,
    measure: wholeHouse ? [] : measure,
    specPages: wholeHouse ? [] : specPages,
    specialties,
    notIncluded: (Array.isArray(o.notIncluded) ? o.notIncluded : []).map((x) => str(x, 200)).filter(Boolean).slice(0, 8),
    wholeHouse,
    from: "model",
  };
}

// ── measuring on the sheets ─────────────────────────────────────────────────

export const FOCUS_SYSTEM =
  "You measure one construction drawing for one job. You read dimension strings exactly as written and add them up; you never guess a size the sheet does not draw. You answer with JSON only.";

export function focusPrompt(input: { request: string; title: string; page: number; pages: number; sheetTitle: string | null; asks: Array<{ n: number; m: MeasureAsk }>; textLayer: string; tiles: number }): string {
  return [
    `THE CONTRACTOR ASKS: «${input.request.trim()}» — the job: ${input.title}.`,
    `This is sheet ${input.page} of ${input.pages}${input.sheetTitle ? ` ("${input.sheetTitle}")` : ""}. The first picture is the whole sheet${input.tiles ? `; the next ${input.tiles} are close-ups of it, left to right, top to bottom` : ""}.`,
    "",
    ...(input.asks.length
      ? ["MEASURE ON THIS SHEET:", ...input.asks.map(({ n, m }) => `  ${n}. ${m.label} — in ${m.unit}. How: ${m.how || "from the dimension strings"}`)]
      : ["NOTHING TO MEASURE HERE — this sheet is read for what it SPECIFIES about the job (answers: [])."]),
    "",
    "SPECS: every note, schedule entry, callout or detail on this sheet that specifies this job's materials, sizes, finishes or methods — quoted short, with its note or detail number (\"Note 12: countertops 3cm quartz, eased edge, undermount sinks\", \"Detail 4/A3: 4\" full-height backsplash\"). Only what is written here; none → [].",
    "",
    "HOW:",
    "- Read every dimension string you use exactly as written (12'-6\", 3'-0 1/2\") and show the arithmetic in asWritten.",
    "- Measure only what THIS sheet draws. Not drawn here → found: false (another sheet may show it). Never fill in a typical size.",
    "- A run that turns a corner is two runs; count the corner once.",
    "- extra: anything else on this sheet the job clearly needs that the list above misses (a bar counter, a window seat top) — with its quantity.",
    "",
    'Answer: {"answers": [{"n": 1, "found": true, "qty": 0, "unit": "", "asWritten": "the strings and the arithmetic", "where": "the room", "confidence": "high|medium|low"}], "extra": [{"label": "", "qty": 0, "unit": "", "asWritten": "", "where": ""}], "specs": [""], "notes": [""]}',
    ...(input.textLayer.trim() ? ["", "TEXT LAYER (the sheet's own words and numbers, where its CAD export kept them):", input.textLayer.slice(0, 12_000)] : []),
  ].join("\n");
}

export type FocusAnswer = { n: number; qty: number; unit: TakeoffUnit; asWritten: string; where: string; confidence: "high" | "medium" | "low" };
export type FocusExtra = { label: string; qty: number; unit: TakeoffUnit; asWritten: string; where: string };
export type FocusRead = { page: number; answers: FocusAnswer[]; extra: FocusExtra[]; notes: string[]; specs: string[] };

export function cleanFocus(page: number, raw: unknown, askedN: number[]): FocusRead {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const num = (v: unknown) => {
    const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) && n > 0 && n < 1_000_000 ? n : null;
  };
  const answers: FocusAnswer[] = [];
  for (const a of Array.isArray(o.answers) ? o.answers : []) {
    if (!a || typeof a !== "object") continue;
    const x = a as Record<string, unknown>;
    const n = Number(x.n);
    const qty = num(x.qty);
    const unit = unitWord(x.unit);
    if (!askedN.includes(n) || x.found === false || !qty || !unit) continue;
    if (answers.some((y) => y.n === n)) continue;
    answers.push({ n, qty, unit, asWritten: str(x.asWritten, 300), where: str(x.where, 80), confidence: x.confidence === "high" || x.confidence === "low" ? x.confidence : "medium" });
  }
  const extra: FocusExtra[] = [];
  for (const e of Array.isArray(o.extra) ? o.extra.slice(0, 6) : []) {
    if (!e || typeof e !== "object") continue;
    const x = e as Record<string, unknown>;
    const label = str(x.label, 120);
    const qty = num(x.qty);
    const unit = unitWord(x.unit);
    if (label && qty && unit) extra.push({ label, qty, unit, asWritten: str(x.asWritten, 300), where: str(x.where, 80) });
  }
  return {
    page,
    answers,
    extra,
    notes: (Array.isArray(o.notes) ? o.notes : []).map((x) => str(x, 200)).filter(Boolean).slice(0, 4),
    specs: (Array.isArray(o.specs) ? o.specs : []).map((x) => str(x, 200)).filter(Boolean).slice(0, 8),
  };
}

// ── the measurements back into the build list ───────────────────────────────

/** A build-list quantity measured on the sheets for this job (computeTakeoff's `measured`). */
export type Measured = { qty: number; basis: string; pages: number[] };

/** What was found for one measure, for the screen. */
export type FoundRow = {
  label: string;
  qty: number | null;
  unit: TakeoffUnit;
  pages: number[];
  /** The strings and arithmetic, page by page. */
  asWritten: string;
  /** measured on the sheets / kept from the build list (not drawn) / missing. */
  status: "measured" | "kept" | "missing";
  replaces: string | null;
  confidence: "high" | "medium" | "low" | null;
};

/** What the plans specify for the job, sheet by sheet, each once. */
export type JobSpec = { text: string; page: number };

export function applyFocus(scope: JobScope, reads: FocusRead[], items: TakeoffItem[]): { measured: Record<string, Measured>; added: TakeoffItem[]; rows: FoundRow[]; specs: JobSpec[] } {
  const measured: Record<string, Measured> = {};
  const added: TakeoffItem[] = [];
  const rows: FoundRow[] = [];
  scope.measure.forEach((m, k) => {
    const n = k + 1;
    const hits = reads.flatMap((r) => r.answers.filter((a) => a.n === n && a.unit === m.unit).map((a) => ({ ...a, page: r.page })));
    if (!hits.length) {
      const kept = m.replaces ? items.find((i) => i.id === m.replaces) : undefined;
      rows.push({ label: m.label, qty: kept?.qty ?? null, unit: m.unit, pages: [], asWritten: kept ? `not drawn on the sheets read — the build list's ${kept.source === "rule" ? "estimate" : "number"} is kept` : "not drawn on the sheets read", status: kept ? "kept" : "missing", replaces: m.replaces, confidence: null });
      return;
    }
    const rank = { high: 3, medium: 2, low: 1 } as const;
    const use = m.combine === "best" ? [hits.slice().sort((a, b) => rank[b.confidence] - rank[a.confidence] || b.qty - a.qty)[0]] : hits;
    const qty = round(use.reduce((a, h) => a + h.qty, 0), m.unit === "each" ? 0 : 1);
    const pages = Array.from(new Set(use.map((h) => h.page))).sort((a, b) => a - b);
    const asWritten = use.map((h) => `p. ${h.page}${h.where ? ` (${h.where})` : ""}: ${h.asWritten || `${h.qty} ${m.unit}`}`).join("; ");
    const confidence = use.reduce<FocusAnswer["confidence"]>((c, h) => (rank[h.confidence] < rank[c] ? h.confidence : c), "high");
    rows.push({ label: m.label, qty, unit: m.unit, pages, asWritten, status: "measured", replaces: m.replaces, confidence });
    if (!(qty > 0)) return;
    if (m.replaces) {
      measured[m.replaces] = { qty, basis: `measured on the plans — ${asWritten}`.slice(0, 590), pages };
    } else {
      added.push({ id: `ask.m${n}`, trade: m.trade, label: m.label, qty, unit: m.unit, source: "plan", basis: `measured on the plans — ${asWritten}`.slice(0, 590), pages, role: m.role, phase: "Measured", measured: true });
    }
  });
  // What a sheet showed that the plan of the job missed.
  const trade = scope.measure[0]?.trade;
  if (trade) {
    reads.forEach((r) =>
      r.extra.forEach((e, k) => {
        if (added.some((a) => a.label.toLowerCase() === e.label.toLowerCase())) return;
        added.push({ id: `ask.x${r.page}-${k + 1}`, trade, label: e.label, qty: e.qty, unit: e.unit, source: "plan", basis: `measured on the plans — p. ${r.page}${e.where ? ` (${e.where})` : ""}: ${e.asWritten}`.slice(0, 590), pages: [r.page], role: "both", phase: "Measured", measured: true });
        rows.push({ label: e.label, qty: e.qty, unit: e.unit, pages: [r.page], asWritten: e.asWritten, status: "measured", replaces: null, confidence: "medium" });
      }),
    );
  }
  const specs: JobSpec[] = [];
  for (const r of [...reads].sort((a, b) => a.page - b.page)) {
    for (const text of r.specs ?? []) {
      const key = text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (key && !specs.some((x) => x.text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() === key)) specs.push({ text, page: r.page });
    }
  }
  return { measured, added, rows, specs: specs.slice(0, 14) };
}

/** The countertop finishes a request can name, the longer word first ("quartzite" before "quartz"). */
const FINISHES: Array<[RegExp, string]> = [
  [/quartzite/i, "quartzite"],
  [/\bquartz\b/i, "quartz"],
  [/granite/i, "granite"],
  [/marble/i, "marble"],
  [/soapstone/i, "soapstone"],
  [/solid[- ]surface|corian/i, "solid surface"],
  [/butcher ?block/i, "butcher block"],
  [/laminate|formica/i, "laminate"],
];

/** The finish the contractor named, if any. */
export function finishAsked(request: string): string | null {
  return FINISHES.find(([re]) => re.test(request))?.[1] ?? null;
}

/** The countertops in the finish asked for (granite), not the build list's default (quartz). */
export function withFinish(items: TakeoffItem[], request: string): TakeoffItem[] {
  const f = finishAsked(request);
  if (!f) return items;
  return items.map((i) => (/^cabinets\.(tops-|island-top$|vanity-tops$)/.test(i.id) ? { ...i, label: i.label.replace(/\bquartz\b/i, f) } : i));
}

/** The job's lines: the build list's chosen lines (measurements in them) and the job's own. */
export function jobItems(scope: JobScope, items: TakeoffItem[], extra: TakeoffItem[]): TakeoffItem[] {
  const ids = new Set(scope.itemIds);
  return [...items.filter((i) => ids.has(i.id)), ...extra];
}

/** A job is part of a trade (not all of it): the trade's whole-trade price benchmarks do not apply. */
export function partialTrades(scope: JobScope, items: TakeoffItem[]): Set<PlanTrade> {
  const ids = new Set(scope.itemIds);
  const out = new Set<PlanTrade>();
  for (const t of PLAN_TRADES) {
    const mine = items.filter((i) => i.trade === t);
    if (mine.length && mine.some((i) => ids.has(i.id)) && !mine.every((i) => ids.has(i.id))) out.add(t);
  }
  return out;
}
