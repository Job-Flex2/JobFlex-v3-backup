// LEADS · WHERE A LEAD CAME FROM (owner, 2026-10-16: "separate the leads that
// come from JobFlex from the contractor's own — theirs come from email,
// Facebook and other sources — make it smart").
//
// One vocabulary for every surface (the desk sheet, the handheld build, the
// lead page, the import bench and the action that stores a lead). Lead.source
// is a free string that has been written for years in mixed spellings —
// "phone" by the AI desk, "LEAD_CENTER" by the Lead Center, "FACEBOOK" by Meta
// lead ads, "BOOKING" by online booking, "MANUAL" / "EMAIL" / "IMPORT" by the
// import bench, "FORM" by an old homeowner form — so every reader goes through
// `leadSourceOf`, which maps the stored value to ONE key, one label, one tone
// and one side:
//
//   jobflex — the lead was sent by JobFlex (the Lead Center: an accepted offer
//             or an admin's assign). Only the platform writes LEAD_CENTER; a
//             contractor can never pick it (IMPORTABLE_SOURCES leaves it out).
//   own     — everything the contractor brought in themselves.
//
// Pure, no imports: the server action, the client bundles and the QA read it.

export type LeadSide = "jobflex" | "own";

export type LeadSourceKey =
  | "jobflex"
  | "ai-desk"
  | "booking"
  | "facebook"
  | "instagram"
  | "google"
  | "yelp"
  | "angi"
  | "thumbtack"
  | "nextdoor"
  | "houzz"
  | "website"
  | "email"
  | "phone"
  | "referral"
  | "walk-in"
  | "import"
  | "manual"
  | "other";

export interface LeadSourceDef {
  key: LeadSourceKey;
  /** As a contractor says it: "Facebook", "AI desk call", "Online booking". */
  label: string;
  /** For a narrow badge. */
  short: string;
  side: LeadSide;
  /** What is written to Lead.source when this source is picked. */
  stored: string;
  /** The badge's dot — the brand's own colour where there is one. */
  tone: string;
  /** Stored values (any case) that mean this source. */
  aliases: string[];
}

export const LEAD_SOURCES: LeadSourceDef[] = [
  { key: "jobflex", label: "JobFlex Lead Center", short: "JobFlex", side: "jobflex", stored: "LEAD_CENTER", tone: "#1854a0", aliases: ["LEAD_CENTER", "LEADCENTER", "PLATFORM", "JOBFLEX"] },
  // "phone" is what every AI desk path wrote (a message taken, a call turned into a lead).
  { key: "ai-desk", label: "AI desk call", short: "AI desk", side: "own", stored: "AI_DESK", tone: "#0f766e", aliases: ["AI_DESK", "AIDESK", "PHONE"] },
  { key: "booking", label: "Online booking", short: "Booking", side: "own", stored: "BOOKING", tone: "#2563eb", aliases: ["BOOKING", "BOOK", "ONLINE_BOOKING"] },
  { key: "facebook", label: "Facebook", short: "Facebook", side: "own", stored: "FACEBOOK", tone: "#1877f2", aliases: ["FACEBOOK", "META", "FB", "FACEBOOK_ADS"] },
  { key: "instagram", label: "Instagram", short: "Instagram", side: "own", stored: "INSTAGRAM", tone: "#e1306c", aliases: ["INSTAGRAM", "IG"] },
  { key: "google", label: "Google", short: "Google", side: "own", stored: "GOOGLE", tone: "#4285f4", aliases: ["GOOGLE", "GOOGLE_LSA", "LSA", "GBP", "GOOGLE_ADS"] },
  { key: "yelp", label: "Yelp", short: "Yelp", side: "own", stored: "YELP", tone: "#d32323", aliases: ["YELP"] },
  { key: "angi", label: "Angi / HomeAdvisor", short: "Angi", side: "own", stored: "ANGI", tone: "#ff6153", aliases: ["ANGI", "ANGIE", "ANGIES_LIST", "HOMEADVISOR", "HOME_ADVISOR"] },
  { key: "thumbtack", label: "Thumbtack", short: "Thumbtack", side: "own", stored: "THUMBTACK", tone: "#009fd9", aliases: ["THUMBTACK"] },
  { key: "nextdoor", label: "Nextdoor", short: "Nextdoor", side: "own", stored: "NEXTDOOR", tone: "#4c9a2a", aliases: ["NEXTDOOR"] },
  { key: "houzz", label: "Houzz", short: "Houzz", side: "own", stored: "HOUZZ", tone: "#4dbc15", aliases: ["HOUZZ"] },
  { key: "website", label: "Website or request form", short: "Website", side: "own", stored: "WEBSITE", tone: "#475569", aliases: ["WEBSITE", "WEB", "FORM", "HOMEOWNER", "REQUEST", "HOMEOWNER_FORM", "CONTACT_FORM"] },
  { key: "email", label: "Email", short: "Email", side: "own", stored: "EMAIL", tone: "#7c3aed", aliases: ["EMAIL", "GMAIL", "MAIL"] },
  { key: "phone", label: "Phone call", short: "Call", side: "own", stored: "PHONE_CALL", tone: "#0891b2", aliases: ["PHONE_CALL", "CALL", "CALLED"] },
  { key: "referral", label: "Referral", short: "Referral", side: "own", stored: "REFERRAL", tone: "#b45309", aliases: ["REFERRAL", "REFERRED", "WORD_OF_MOUTH"] },
  { key: "walk-in", label: "Walk-in or yard sign", short: "Walk-in", side: "own", stored: "WALK_IN", tone: "#6b7280", aliases: ["WALK_IN", "WALKIN", "YARD_SIGN", "TRUCK"] },
  { key: "import", label: "Imported list", short: "Import", side: "own", stored: "IMPORT", tone: "#64748b", aliases: ["IMPORT", "CSV"] },
  { key: "manual", label: "Added by hand", short: "By hand", side: "own", stored: "MANUAL", tone: "#64748b", aliases: ["MANUAL"] },
  { key: "other", label: "Other", short: "Other", side: "own", stored: "OTHER", tone: "#94a3b8", aliases: ["OTHER", "DIRECT"] },
];

const BY_ALIAS = new Map<string, LeadSourceDef>();
for (const s of LEAD_SOURCES) for (const a of s.aliases) BY_ALIAS.set(a, s);
const BY_KEY = new Map<LeadSourceKey, LeadSourceDef>(LEAD_SOURCES.map((s) => [s.key, s]));

const norm = (raw: string) => raw.trim().toUpperCase().replace(/[\s.-]+/g, "_");

/**
 * The source a stored value means. A value nobody has mapped yet ("Porch",
 * "Craigslist") is still the contractor's own lead — it reads as itself,
 * under the Other key, so it can be counted and filtered without a deploy.
 */
export function leadSourceOf(raw: string | null | undefined): LeadSourceDef {
  const v = (raw ?? "").trim();
  if (!v) return BY_KEY.get("manual")!;
  const known = BY_ALIAS.get(norm(v));
  if (known) return known;
  const other = BY_KEY.get("other")!;
  const label = v.length <= 30 ? v.charAt(0).toUpperCase() + v.slice(1).toLowerCase().replace(/_/g, " ") : other.label;
  return { ...other, label, short: label };
}

export function leadSourceByKey(key: string | null | undefined): LeadSourceDef | null {
  return key ? (BY_KEY.get(key as LeadSourceKey) ?? null) : null;
}

export function leadSide(raw: string | null | undefined): LeadSide {
  return leadSourceOf(raw).side;
}

/** The key a stored value groups under ("phone" and "AI_DESK" are one source). */
export function leadSourceKey(raw: string | null | undefined): LeadSourceKey {
  return leadSourceOf(raw).key;
}

/** What a contractor may pick when they add a lead by hand — never JobFlex,
 *  never the channels JobFlex itself fills (the AI desk, online booking). */
export const PICKABLE_SOURCES: LeadSourceDef[] = (
  ["phone", "referral", "facebook", "instagram", "google", "yelp", "angi", "thumbtack", "nextdoor", "houzz", "website", "email", "walk-in", "other"] as LeadSourceKey[]
).map((k) => BY_KEY.get(k)!);

/** Every stored value the import action accepts from a contractor. LEAD_CENTER
 *  is not among them: only the platform says a lead came from JobFlex. */
export const IMPORTABLE_SOURCES: string[] = LEAD_SOURCES.filter((s) => s.side === "own").map((s) => s.stored);

/** A contractor-supplied source, made safe to store: one of IMPORTABLE_SOURCES
 *  (by stored value or alias), else the fallback. */
export function storableSource(raw: string | null | undefined, fallback = "MANUAL"): string {
  if (!raw) return fallback;
  const s = BY_ALIAS.get(norm(raw)) ?? BY_KEY.get(raw as LeadSourceKey);
  return s && s.side === "own" ? s.stored : fallback;
}

/**
 * An enquiry pasted from an email: which marketplace sent it. A lead from Angi,
 * Thumbtack or Google's local ads arrives as an email too, and "Email" would
 * hide where the money actually came from. The sender's name and domain, and
 * the wording each service's notification uses, decide; a plain email stays
 * "EMAIL".
 */
export function detectEmailSource(text: string): string {
  const t = text.toLowerCase();
  if (/\bangi(\.com)?\b|angi leads|angi pro|homeadvisor|angie'?s list/.test(t)) return "ANGI";
  if (/thumbtack/.test(t)) return "THUMBTACK";
  if (/\byelp\b/.test(t)) return "YELP";
  if (/houzz/.test(t)) return "HOUZZ";
  if (/nextdoor/.test(t)) return "NEXTDOOR";
  if (/instagram/.test(t)) return "INSTAGRAM";
  if (/facebookmail|facebook\.com|\bfacebook\b|messenger|lead ads? form|meta business/.test(t)) return "FACEBOOK";
  if (/local services|google guaranteed|google screened|localservices|google business profile|business\.google|google ads lead/.test(t)) return "GOOGLE";
  return "EMAIL";
}

/** CSV/sheet cell → a stored source (unknown words become Other, blank stays IMPORT). */
export function sourceFromCell(cell: string | null | undefined): string {
  const v = (cell ?? "").trim();
  if (!v) return "IMPORT";
  const s = BY_ALIAS.get(norm(v));
  if (s) return s.side === "own" ? s.stored : "IMPORT";
  const detected = detectEmailSource(v);
  return detected !== "EMAIL" ? detected : "OTHER";
}

export interface SourceCount {
  key: LeadSourceKey;
  label: string;
  short: string;
  tone: string;
  count: number;
}

/** The contractor's own leads by source, most first — the chips under "Your own leads". */
export function ownSourceCounts(rows: Array<{ source: string | null }>): SourceCount[] {
  const tally = new Map<LeadSourceKey, SourceCount>();
  for (const r of rows) {
    const s = leadSourceOf(r.source);
    if (s.side !== "own") continue;
    const cur = tally.get(s.key);
    if (cur) cur.count += 1;
    else tally.set(s.key, { key: s.key, label: BY_KEY.get(s.key)!.label, short: BY_KEY.get(s.key)!.short, tone: s.tone, count: 1 });
  }
  return [...tally.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** How many leads each side has. */
export function sideCounts(rows: Array<{ source: string | null }>): { all: number; jobflex: number; own: number } {
  let jobflex = 0;
  for (const r of rows) if (leadSide(r.source) === "jobflex") jobflex += 1;
  return { all: rows.length, jobflex, own: rows.length - jobflex };
}
