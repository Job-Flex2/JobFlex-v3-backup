// THE DESK'S TRADES — the light half (2026-10-16). Pure and browser-safe: the setup screen imports this to show which
// trades the typed business matched, the suggestion chips and the review marks, without downloading every trade's
// services, intake and answers. The packs themselves (tradePacks/*) and the preset that uses them (tradePresets) are
// read on the server, by the preset action.

export type DeskFix = { label: string; text: string };
/** A part of the profile the contractor should look at: a section key, or "faq:<question>". */
export type DeskReviewItem = { key: string; why: string; fixes?: DeskFix[] };

/**
 * A question callers ask a company in the trade, and the desk's answer. An answer is true for ANY company in the
 * trade. Where the honest answer depends on the company (a fee, a yes/no about what it offers) the answer stays
 * neutral — "the team will go over it" — `check` says what the owner should confirm, and `fixes` are the answers
 * one click away.
 */
export type PackFaq = { q: string; a: string; check?: string; fixes?: DeskFix[] };

export type TradePack = {
  key: string;
  /** The chip and the matched-trade label: "Plumbing", "Kitchen & bath". */
  label: string;
  /** For "a ___ company", lower case: "plumbing", "heating and cooling". */
  noun: string;
  /** What a company in the trade does, for the about line, third person: "fixes leaks, clears drains and installs water heaters". */
  does: string;
  /** Everything callers ask the trade for, most asked first. The owner removes what they don't do. */
  services: string[];
  /**
   * What the desk finds out on a call for this trade, so the lead is ready to estimate — asked naturally, one at a
   * time, skipping what the caller already said. The questions every trade asks (address, timeline, budget, who
   * decides, how they heard about you) are added by the preset; these are the trade's own.
   */
  intake: string[];
  faqs: PackFaq[];
  /** What counts as urgent for this trade, in a sentence, with the safety step when there is one. */
  urgent: string;
  /** Big jobs: callers ask about financing. */
  bigTicket?: boolean;
};

export const yesNo = (yes: string, no: string, yesLabel = "Yes", noLabel = "No"): DeskFix[] => [
  { label: yesLabel, text: yes },
  { label: noLabel, text: no },
];

export const faqKey = (q: string) => `faq:${q.trim().toLowerCase()}`;

/** Storm and damage trades: whether the company works with the caller's insurance claim is the company's call. */
export const CLAIMS_FAQ: PackFaq = {
  q: "Do you work with insurance claims?",
  a: "I'll note that you have a claim — the team will go over it with you when they come out. Would you like me to book an inspection?",
  check: "Whether you help with insurance claims — callers decide on it.",
  fixes: yesNo(
    "Yes — the team helps with insurance claims and can meet the adjuster. Would you like me to book an inspection?",
    "We don't handle insurance claims directly, but we can inspect and give you a written estimate for your claim.",
    "We help with claims",
    "We don't handle claims",
  ),
};

/** The trades with a preset, in the order the chips list them. */
export const TRADES: ReadonlyArray<{ key: string; label: string }> = [
  { key: "roofing", label: "Roofing" },
  { key: "remodeling", label: "Kitchen & bath" },
  { key: "general", label: "General contractor" },
  { key: "plumbing", label: "Plumbing" },
  { key: "electrical", label: "Electrical" },
  { key: "hvac", label: "Heating & cooling" },
  { key: "flooring", label: "Flooring" },
  { key: "tile", label: "Tile" },
  { key: "painting", label: "Painting" },
  { key: "handyman", label: "Handyman" },
  { key: "fencing", label: "Fencing" },
  { key: "decking", label: "Decks" },
  { key: "concrete", label: "Concrete" },
  { key: "landscaping", label: "Landscaping" },
  { key: "lawn-care", label: "Lawn care" },
  { key: "tree-service", label: "Tree service" },
  { key: "windows", label: "Windows & doors" },
  { key: "siding", label: "Siding" },
  { key: "gutters", label: "Gutters" },
  { key: "countertops", label: "Countertops" },
  { key: "cabinets", label: "Cabinets" },
  { key: "carpentry", label: "Carpentry" },
  { key: "drywall", label: "Drywall" },
  { key: "insulation", label: "Insulation" },
  { key: "masonry", label: "Masonry & stone" },
  { key: "paving", label: "Paving & asphalt" },
  { key: "stucco", label: "Stucco" },
  { key: "garage-doors", label: "Garage doors" },
  { key: "solar", label: "Solar" },
  { key: "pool", label: "Pool & spa" },
  { key: "pressure-washing", label: "Pressure washing" },
  { key: "cleaning", label: "House cleaning" },
  { key: "junk-removal", label: "Junk removal" },
  { key: "pest-control", label: "Pest control" },
  { key: "waterproofing", label: "Basement waterproofing" },
  { key: "foundation", label: "Foundation repair" },
  { key: "restoration", label: "Water, fire & mold restoration" },
  { key: "chimney", label: "Chimney & fireplace" },
  { key: "septic", label: "Septic" },
  { key: "excavation", label: "Excavation & grading" },
  { key: "appliance-repair", label: "Appliance repair" },
  { key: "locksmith", label: "Locksmith" },
  { key: "security", label: "Security & smart home" },
  { key: "demolition", label: "Demolition" },
];

/** Words → trades. Every match counts; a part of what was typed may match more than one trade. */
const MATCH: ReadonlyArray<[RegExp, string]> = [
  [/roof|shingle/i, "roofing"],
  [/gutter|downspout/i, "gutters"],
  [/siding|hardie|soffit|fascia/i, "siding"],
  [/stucco|eifs/i, "stucco"],
  // "window cleaning" is cleaning work and "garage door" is its own trade — neither is windows & doors.
  [/window(?!s?\s*(clean|wash))|(?<!garage |overhead )\bdoors?\b|\bglass\b|skylight/i, "windows"],
  [/garage doors?|overhead doors?|garage (door )?opener/i, "garage-doors"],
  [/fenc|\bgates?\b/i, "fencing"],
  [/deck|pergola|patio cover|gazebo/i, "decking"],
  [/concret|driveway|flatwork|\bslabs?\b|sidewalk|stamped|epoxy|garage floor/i, "concrete"],
  [/\bpav(e|ed|ing)\b|asphalt|blacktop|seal ?coat/i, "paving"],
  [/mason|brick|\bstone\b|stonework|block wall|tuckpoint|retaining wall|pavers?\b/i, "masonry"],
  [/landscap|irrigat|sprinkler|hardscape|garden|\bsod\b|outdoor lighting|yard design/i, "landscaping"],
  [/lawn|mow|fertiliz|aerat|weed|leaf (removal|cleanup)|snow (removal|plow)|yard (care|maintenance|cleanup)/i, "lawn-care"],
  [/\btrees?\b|stump|arborist|tree trim/i, "tree-service"],
  [/paint|stain(?!less)|wallpaper/i, "painting"],
  [/floor(?!\s*coat)|hardwood|laminate|\bvinyl\b|\blvp\b|carpet(?!\s*clean)/i, "flooring"],
  [/\btil(e|es|ing|er)\b|backsplash|grout/i, "tile"],
  [/counter|quartz|granite/i, "countertops"],
  [/cabinet|closet|vanit(y|ies)/i, "cabinets"],
  [/remodel|kitchen|bath|renovat/i, "remodeling"],
  [/general contract|\bgc\b|construction|addition|\badu\b|builder|basement finish/i, "general"],
  [/carpent|\btrim\b|framing|built-?in|millwork|finish carpent/i, "carpentry"],
  [/drywall|sheetrock|plaster(?!\s*exterior)/i, "drywall"],
  [/insulat|attic/i, "insulation"],
  [/plumb|drain|sewer|water heater|pipe|faucet|toilet|water softener|repip/i, "plumbing"],
  [/electric|wiring|panel|ev charger|lighting|generator/i, "electrical"],
  [/hvac|heating|cooling|furnace|air condition|\ba\/?c\b|heat pump|duct|mini.?split|boiler/i, "hvac"],
  [/solar|photovolta|\bpv\b|battery backup|powerwall/i, "solar"],
  [/\bpools?\b|\bspas?\b|hot tub/i, "pool"],
  [/pressure wash|power wash|soft wash|window (clean|wash)|roof clean|house wash|exterior clean/i, "pressure-washing"],
  [/house ?clean|home clean|cleaning (service|company|business)|maid|janitor|move.?(in|out) clean|deep clean|carpet clean|upholster|office clean|commercial clean/i, "cleaning"],
  [/junk|haul(ing| away|-away)|debris remov|clean.?outs?\b|dumpster/i, "junk-removal"],
  [/pest|termite|exterminat|rodent|\bbed ?bugs?\b|\bants?\b|wildlife|mosquito/i, "pest-control"],
  [/waterproof|wet basement|basement (leak|water)|sump|french drain|crawl ?space/i, "waterproofing"],
  [/foundation|pier|underpin|slab ?jack|mud ?jack|settl(ing|ement)/i, "foundation"],
  [/restor|water damage|fire damage|smoke damage|\bmou?ld\b|flood|remediat/i, "restoration"],
  [/chimney|fireplace|wood ?stove|\bflue\b/i, "chimney"],
  [/septic|leach field|drain field|grease trap/i, "septic"],
  [/excavat|grading|land clearing|site prep|trench|backhoe|bobcat|drainage/i, "excavation"],
  [/appliance|refrigerator|fridge|washer|dryer(?!\s*vent)|dishwasher|oven|stove(?!\s*pipe)/i, "appliance-repair"],
  [/locksmith|lockout|re-?key|\blocks?\b/i, "locksmith"],
  [/security|cctv|camera|alarm|smart home|low.?voltage|home theat|audio.?video|tv mount/i, "security"],
  [/demoli|tear.?out/i, "demolition"],
  [/handyman|handy man|odd jobs?/i, "handyman"],
];

const LABEL = new Map(TRADES.map((t) => [t.key, t.label]));

/** The kinds of business the field suggests, as chips. */
export const BUSINESS_SUGGESTIONS: string[] = TRADES.map((t) => t.label);

/**
 * What the contractor typed → the trade keys with a preset, and the parts no preset knows ("pool resurfacing" would
 * match; "piano moving" would not), which the model writes. Split on commas, slashes, "and", "&" and "+".
 */
export function matchTrades(text: string): { keys: string[]; unknown: string[] } {
  const parts = (text || "")
    .split(/,|\/|;|\+|&|\band\b|\n/i)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length >= 2)
    .slice(0, 8);
  const keys: string[] = [];
  const unknown: string[] = [];
  for (const part of parts) {
    const hit = MATCH.filter(([re]) => re.test(part)).map(([, k]) => k);
    if (hit.length) for (const k of hit) { if (!keys.includes(k)) keys.push(k); }
    else {
      // "we do piano moving" → "piano moving"; "our company" → nothing.
      const words = part.replace(/\b(we|do|does|our|the|a|an|and|company|business|contractor|contractors|services?|work|in|of|llc|inc)\b/gi, " ").replace(/\s+/g, " ").trim();
      if (words.length >= 3) unknown.push(words.slice(0, 60));
    }
  }
  return { keys, unknown: Array.from(new Set(unknown)) };
}

/** The same match, with labels — what the setup screen shows as "matched". */
export function matchBusinessLabels(text: string): { packs: Array<{ key: string; label: string }>; unknown: string[] } {
  const m = matchTrades(text);
  return { packs: m.keys.map((key) => ({ key, label: LABEL.get(key) ?? key })), unknown: m.unknown };
}

/** A review list from storage or the browser, checked. */
export function cleanReview(raw: unknown): DeskReviewItem[] {
  if (!Array.isArray(raw)) return [];
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
  return raw
    .map((x): DeskReviewItem | null => {
      if (!x || typeof x !== "object") return null;
      const o = x as Record<string, unknown>;
      const key = str(o.key, 240);
      const why = str(o.why, 200);
      if (!key || !why) return null;
      const fixes = Array.isArray(o.fixes)
        ? o.fixes.map((f) => (f && typeof f === "object" ? { label: str((f as Record<string, unknown>).label, 60), text: str((f as Record<string, unknown>).text, 800) } : null)).filter((f): f is DeskFix => !!f && !!f.label && !!f.text).slice(0, 4)
        : [];
      return { key, why, ...(fixes.length ? { fixes } : {}) };
    })
    .filter((x): x is DeskReviewItem => !!x)
    .slice(0, 60);
}
