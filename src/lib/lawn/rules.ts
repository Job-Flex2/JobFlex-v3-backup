// THE RULES AT AN ADDRESS (2026-10-18). What the law says a lawn company may do where the client lives — fertilizer
// (phosphorus limits, winter blackouts, Florida's rainy-season bans, frozen ground, setbacks from water), weed killers
// (the applicator's licence, lawn signs and neighbours' notice registries, local bans, neonicotinoids), the licence to
// landscape at all, watering schedules, gas leaf blowers — each with its source and the date it was checked. The
// season's calendar keeps out of the blackouts by itself; the rest is said on the estimate for the contractor to act
// on. These are summaries to plan by, not legal advice: the contractor's state and county have the last word. Pure.

export type RuleKind = "fertilizer" | "pesticide" | "license" | "water" | "equipment";
export type Rule = { kind: RuleKind; title: string; detail: string; source: string };

/** A window of the year, month-day to month-day ("12-01" → "03-01"), wrapping over New Year when it must. */
export type Window = { from: string; to: string; what: "all" | "nitrogen-phosphorus" | "phosphorus" };

type StateFert = {
  /** Phosphorus only with a soil test showing the need, or for a new lawn. */
  phosphorus?: boolean;
  blackout?: Window[];
  frozenBan?: boolean;
  setbackFt?: number;
  slowRelease?: string;
  note?: string;
  source: string;
};

const CHECKED = "checked 2026-10";

export const FERTILIZER: Record<string, StateFert> = {
  MN: { phosphorus: true, note: "No fertilizer on driveways, walks or streets.", source: "Minn. Stat. 18C.60" },
  WI: { phosphorus: true, frozenBan: true, note: "No fertilizer on paved surfaces.", source: "Wis. Stat. 94.643" },
  MI: { phosphorus: true, frozenBan: true, setbackFt: 15, source: "Michigan Fertilizer Act (MCL 324.8512b)" },
  IL: { phosphorus: true, note: "Applies to applicators for hire; a lawn care product sign rule also applies.", source: "Illinois Lawn Care Products Application and Notice Act" },
  NY: { phosphorus: true, blackout: [{ from: "12-01", to: "04-01", what: "all" }], setbackFt: 20, note: "Suffolk County: no fertilizer Nov 1 – Apr 1.", source: "N.Y. ECL 17-2103; Suffolk Co. ch. 346" },
  NJ: { phosphorus: true, blackout: [{ from: "12-01", to: "03-01", what: "all" }], frozenBan: true, setbackFt: 25, slowRelease: "at least 20% slow-release nitrogen", note: "Homeowners stop Nov 15; professionals Dec 1. Professionals must hold the Rutgers fertilizer certification.", source: "N.J.S.A. 58:10A-61 (NJ Fertilizer Law)" },
  MD: { phosphorus: true, blackout: [{ from: "11-16", to: "03-01", what: "all" }], frozenBan: true, setbackFt: 15, slowRelease: "at least 20% slow-release, ≤0.9 lb N per 1,000 sq ft", note: "Professionals need an MDA business licence and certified staff; to Dec 1 only ≤0.5 lb soluble N.", source: "Md. Agric. Code §8-801 (Fertilizer Use Act of 2011)" },
  VA: { phosphorus: true, note: "Lawn maintenance fertilizer is phosphorus-free; applicators must be VDACS-certified.", source: "2 VAC 5-405" },
  PA: { phosphorus: true, blackout: [{ from: "12-15", to: "03-01", what: "all" }], frozenBan: true, setbackFt: 15, note: "≤0.9 lb total N (0.7 available) per 1,000 sq ft an application.", source: "Pa. Act 41 of 2022 (turf fertilizer)" },
  DE: { phosphorus: true, setbackFt: 15, note: "From Jan 1, 2027, paid turf nutrient work needs a certified applicator; ≤3 lb N a year.", source: "3 Del. Admin. Code 1204" },
  VT: { phosphorus: true, blackout: [{ from: "10-16", to: "03-31", what: "all" }], frozenBan: true, setbackFt: 25, slowRelease: "at least 15% slow-release nitrogen", source: "10 V.S.A. §1266b" },
  NH: { phosphorus: true, frozenBan: true, setbackFt: 25, note: "Not on turf that isn't growing, not in heavy rain; 25 ft from water and from storm drains.", source: "RSA 431:4-a (2024 HB 1293)" },
  CT: { phosphorus: true, blackout: [{ from: "12-01", to: "03-15", what: "phosphorus" }], setbackFt: 20, source: "Conn. Gen. Stat. §22a-66l" },
  MA: { phosphorus: true, blackout: [{ from: "12-01", to: "03-01", what: "all" }], frozenBan: true, setbackFt: 20, note: "100 ft from drinking-water sources.", source: "330 CMR 31.00" },
  WA: { phosphorus: true, frozenBan: true, source: "RCW 15.54.500" },
  ME: { note: "Retail signs only; some towns (shoreland) restrict use.", source: "Maine 7 MRSA §750" },
};

/** Florida counties banning nitrogen and phosphorus on lawns in the rainy season (and cities that are stricter). */
export const FLORIDA_SUMMER: Record<string, Window[]> = {
  Brevard: [{ from: "06-01", to: "09-30", what: "nitrogen-phosphorus" }],
  Charlotte: [{ from: "06-01", to: "09-30", what: "nitrogen-phosphorus" }],
  Hillsborough: [{ from: "06-01", to: "09-30", what: "nitrogen-phosphorus" }],
  "Indian River": [{ from: "06-01", to: "09-30", what: "nitrogen-phosphorus" }],
  Lake: [{ from: "06-01", to: "09-30", what: "nitrogen-phosphorus" }],
  Lee: [{ from: "06-01", to: "09-30", what: "nitrogen-phosphorus" }],
  Manatee: [{ from: "06-01", to: "09-30", what: "nitrogen-phosphorus" }],
  Martin: [{ from: "06-01", to: "09-30", what: "nitrogen-phosphorus" }],
  Orange: [{ from: "06-01", to: "09-30", what: "nitrogen-phosphorus" }],
  Pinellas: [{ from: "06-01", to: "09-30", what: "nitrogen-phosphorus" }],
  Sarasota: [{ from: "06-01", to: "09-30", what: "nitrogen-phosphorus" }],
  Seminole: [{ from: "06-01", to: "09-30", what: "nitrogen-phosphorus" }],
  "St. Lucie": [{ from: "06-01", to: "09-30", what: "nitrogen-phosphorus" }],
  Volusia: [{ from: "06-01", to: "09-30", what: "nitrogen-phosphorus" }],
  Hernando: [{ from: "06-01", to: "09-30", what: "nitrogen-phosphorus" }, { from: "12-15", to: "03-15", what: "nitrogen-phosphorus" }],
  Citrus: [{ from: "06-01", to: "09-30", what: "nitrogen-phosphorus" }, { from: "11-01", to: "03-31", what: "nitrogen-phosphorus" }],
  "Palm Beach": [{ from: "06-01", to: "10-31", what: "nitrogen-phosphorus" }],
};

/** Lawn sign after a pesticide job (hours) and neighbours' pre-notice registries. */
const PESTICIDE_NOTICE: Record<string, { signHours?: number; registry?: string }> = {
  MD: { signHours: 48, registry: "neighbours on the state's registry get notice (with a doctor's certificate)" },
  NY: { signHours: 24, registry: "48 h notice to neighbours within 150 ft, in counties that opted in" },
  CT: { signHours: 24, registry: "24 h notice to neighbours on the registry" },
  MA: { signHours: 24 },
  NJ: { signHours: 72 },
  IL: { signHours: 24, registry: "abutting neighbours who ask get a day's notice" },
  MI: { signHours: 24, registry: "neighbours on the registry get notice" },
  WI: { signHours: 24, registry: "12 h notice to neighbours on the registry" },
  ME: { signHours: 48, registry: "neighbours within 250 ft on the registry get notice" },
  PA: { registry: "neighbours within 500 ft on the hypersensitivity registry get 12–72 h notice" },
  OH: { signHours: 24 },
};

/** Licences to landscape for hire (mowing alone is exempt where it says so). */
const LICENSE: Record<string, string> = {
  CA: "Landscaping over $1,000 (labour and materials) needs a C-27 Landscaping Contractor licence (CSLB); maintenance gardening is exempt below that.",
  NV: "Landscape work needs a C-10 licence (NSCB) — its scope includes maintaining lawns, so check before mowing for hire too.",
  AZ: "Landscape construction over $1,000 needs an ROC licence; mowing and maintenance are exempt.",
  OR: "A Landscape Contractors Board licence for planting, irrigation and hardscape; maintenance-only firms may do $500 a site a year of other work.",
  LA: "Paid planting, fertilizing or pruning needs an LDAF Landscape Horticulturist licence (irrigation and arborist work their own).",
  NC: "Landscape contracting of $30,000 or more on a site in a year needs a Landscape Contractors' Licensing Board licence.",
  TX: "No landscape licence, but any sprinkler work needs a TCEQ Licensed Irrigator.",
  MD: "Landscape installation counts as home improvement: an MHIC licence.",
  FL: "Applying fertilizer for hire needs the state's Limited Commercial Fertilizer Applicator Certificate (LCFAC).",
};

/** Watering on a fixed schedule all year (stages tighten it in drought). */
const WATER: Record<string, string> = {
  CA: "Watering days and hours are set by the water district (often 2–3 days a week, none midday); decorative commercial turf loses drinking water 2027–2031 (AB 1572).",
  TX: "City and river-authority schedules (often 1–2 days a week by address, stages in drought — San Antonio and Austin enforce them).",
  FL: "The water management district sets watering days by address (SWFWMD is once a week through Mar 31, 2027); new sod gets an establishment period.",
  NV: "Southern Nevada assigns watering days by season (1–3 a week); decorative turf can't use Colorado River water from 2027.",
  CO: "Front Range utilities set summer watering days (Denver: 2 a week in Stage 1); no new decorative turf on commercial projects from 2026.",
  AZ: "City watering schedules by season; overseeding for winter rye uses more water than many districts allow — check first.",
  UT: "Watering guides and drought stages by city; no watering midday.",
};

/** Gas leaf blowers banned or limited. */
const BLOWERS: Array<{ state: string; place: RegExp; rule: string }> = [
  { state: "DC", place: /./, rule: "Gas leaf blowers are banned in DC (sale and use, fines to $500) — bring battery blowers." },
  { state: "MD", place: /montgomery/i, rule: "Montgomery County bans gas leaf blowers from July 1, 2025 — battery only." },
  { state: "OR", place: /portland/i, rule: "Portland: gas leaf blowers only Oct–Dec in 2026–27, banned all year from 2028; the property owner answers for the contractor." },
  { state: "MA", place: /cambridge/i, rule: "Cambridge bans gas leaf blowers for commercial crews from March 2026; electric ones only in set seasons and weekday hours, with a permit." },
  { state: "CA", place: /los angeles/i, rule: "Los Angeles: no gas blowers within 500 ft of a home. Statewide, new small gas engines can't be sold (from 2024) — existing ones may be used." },
];

const md = (d: Date) => `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

/** Inside a window of the year (wrapping over New Year when from > to). */
export function inWindow(date: Date, w: Window): boolean {
  const v = md(date);
  return w.from <= w.to ? v >= w.from && v <= w.to : v >= w.from || v <= w.to;
}

export type RulesAt = {
  rules: Rule[];
  /** Fertilizer may not go down in these windows (all fertilizer, or N and P). */
  blackouts: Window[];
  phosphorusLimited: boolean;
  /** Cosmetic weed killers barred on residential lawns (a county ban). */
  herbicideBan: boolean;
};

export function rulesAt(state: string | null | undefined, county?: string | null, city?: string | null): RulesAt {
  const st = (state ?? "").toUpperCase();
  const rules: Rule[] = [];
  const blackouts: Window[] = [];
  const f = FERTILIZER[st];
  if (f) {
    if (f.phosphorus) rules.push({ kind: "fertilizer", title: "Phosphorus only where a soil test calls for it", detail: "The program uses phosphorus-free fertilizer; a new lawn or a soil test showing the need is the exception.", source: `${f.source} · ${CHECKED}` });
    for (const w of f.blackout ?? []) {
      blackouts.push(w);
      rules.push({ kind: "fertilizer", title: `No ${w.what === "phosphorus" ? "phosphorus" : "fertilizer"} ${fmtWindow(w)}`, detail: "The season's calendar keeps the rounds out of it.", source: `${f.source} · ${CHECKED}` });
    }
    if (f.frozenBan) rules.push({ kind: "fertilizer", title: "Never on frozen or snow-covered ground", detail: "Skip a round the ground is frozen; it moves to the next open week.", source: `${f.source} · ${CHECKED}` });
    if (f.setbackFt) rules.push({ kind: "fertilizer", title: `Keep ${f.setbackFt} ft from water`, detail: "Ponds, streams, wetlands — less with a deflector or drop spreader where the law allows.", source: `${f.source} · ${CHECKED}` });
    if (f.slowRelease) rules.push({ kind: "fertilizer", title: "Slow-release nitrogen", detail: f.slowRelease, source: `${f.source} · ${CHECKED}` });
    if (f.note) rules.push({ kind: "fertilizer", title: "More of the state's fertilizer law", detail: f.note, source: `${f.source} · ${CHECKED}` });
  }
  if (st === "FL") {
    const c = county?.replace(/ county$/i, "").trim() ?? "";
    const key = Object.keys(FLORIDA_SUMMER).find((k) => k.toLowerCase() === c.toLowerCase());
    if (key) {
      for (const w of FLORIDA_SUMMER[key]) blackouts.push(w);
      rules.push({ kind: "fertilizer", title: `${key} County: no nitrogen or phosphorus ${FLORIDA_SUMMER[key].map(fmtWindow).join(" or ")}`, detail: "The summer rounds become iron and micronutrients only; many ordinances also require at least 50% slow-release nitrogen the rest of the year.", source: `${key} County fertilizer ordinance · ${CHECKED}` });
    } else rules.push({ kind: "fertilizer", title: "Check the county's fertilizer ordinance", detail: "Most of Florida's coastal counties ban nitrogen and phosphorus June–September; cities can be stricter.", source: `SWFWMD fertilizer restrictions · ${CHECKED}` });
    rules.push({ kind: "license", title: "LCFAC certificate", detail: LICENSE.FL, source: `Fla. Stat. 482.1562 · ${CHECKED}` });
  }
  // Weed killers.
  rules.push({ kind: "pesticide", title: "A licensed applicator for weed control", detail: "Spraying weed or insect control for hire needs the state's commercial applicator licence in the ornamental & turf category; the crew carries it.", source: `40 CFR 171 and the state's plan · ${CHECKED}` });
  const n = PESTICIDE_NOTICE[st];
  if (n?.signHours) rules.push({ kind: "pesticide", title: `Lawn signs for ${n.signHours} hours`, detail: `Post the yard's entrances when weed or insect control goes down${n.registry ? `; ${n.registry}` : ""}.`, source: `State pesticide notification rules · ${CHECKED}` });
  else if (n?.registry) rules.push({ kind: "pesticide", title: "Neighbours' notice registry", detail: n.registry, source: `State pesticide notification rules · ${CHECKED}` });
  let herbicideBan = false;
  if (st === "MD" && /montgomery/i.test(county ?? "")) {
    herbicideBan = true;
    rules.push({ kind: "pesticide", title: "Montgomery County: no cosmetic lawn pesticides", detail: "The Healthy Lawns Act bars non-essential pesticides on private lawns — the program uses allowed (organic) products and overseeding instead.", source: `Montgomery Co. Healthy Lawns Act · ${CHECKED}` });
  }
  if (st === "NY") rules.push({ kind: "pesticide", title: "No neonicotinoids on turf", detail: "Clothianidin and dinotefuran are out; imidacloprid, thiamethoxam and acetamiprid from Dec 31, 2026 — grub control uses other products.", source: `N.Y. Birds and Bees Protection Act · ${CHECKED}` });
  if (st === "NJ") rules.push({ kind: "pesticide", title: "No neonicotinoids outdoors", detail: "Not on lawns since October 2023 — grub control uses other products.", source: `N.J. P.L. 2021 c. 365 · ${CHECKED}` });
  // The licence to landscape.
  if (LICENSE[st] && st !== "FL") rules.push({ kind: "license", title: "Contractor licence", detail: LICENSE[st], source: `State licensing board · ${CHECKED}` });
  // Water.
  if (WATER[st]) rules.push({ kind: "water", title: "Watering schedule", detail: WATER[st], source: `State and district rules · ${CHECKED}` });
  // Equipment.
  for (const b of BLOWERS) if (b.state === st && b.place.test(`${county ?? ""} ${city ?? ""}`)) rules.push({ kind: "equipment", title: "Leaf blowers", detail: b.rule, source: `Local ordinance · ${CHECKED}` });
  return { rules, blackouts, phosphorusLimited: !!f?.phosphorus, herbicideBan };
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function fmtWindow(w: Window): string {
  const f = (s: string) => `${MON[Number(s.slice(0, 2)) - 1]} ${Number(s.slice(3))}`;
  return `${f(w.from)} – ${f(w.to)}`;
}
