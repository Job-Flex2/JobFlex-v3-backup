// FINDING CONTRACTORS TO CALL (2026-10-25 — owner: "in the outreach, make an option where I request what kind of
// contractors to find online — roofing contractors in the Seattle area, 10 or 20 a day — and you find them and put
// them on the schedule to call and text and pitch JobFlex against their specialty; make it super smart").
//
// A HUNT is one standing request: a trade, an area, how many a day, and whether it runs every day. Each run asks
// Google's Places for businesses of that trade in that area, takes the ones not seen before and not already on the
// list, reads each one's website for an email, and adds them to the outreach list as prospects found online — from
// there the outreach's own rules take over (the email first, the AI's call to landlines in their hours, a cell only
// once they ask), in the words of their trade (lib/outreach/script tradePitch).
//
// Pure: the shapes, the words, the search phrase, a place into a list row, the email out of a page, when a run is due.

import { STATE_ZONES, stateCode, type ListRow } from "./rules";
import { toE164 } from "@/lib/phone";

export interface Hunt {
  id: string;
  /** The trade's key (HUNT_TRADES), "any" for every kind of contractor. */
  trade: string;
  /** Where, as typed: "Seattle, WA", "Tacoma area", "98101". */
  area: string;
  /** How many new contractors each run brings in. */
  perDay: number;
  /** Runs every morning on its own (the cron) or only when pressed. */
  daily: boolean;
  /** The state read off the area (calling hours, the prospects' state), or null. */
  state: string | null;
  lastRunAt: string | null;
  lastFound: number;
  totalFound: number;
  lastError: string | null;
  /** Where the search left off — Google's next page — so the next run goes on instead of starting over. */
  pageToken: string | null;
  /** Which of the trade's search phrases the run is on (Google gives at most sixty places per phrase, so a hunt walks
   *  several: "roofing contractors", "roofers", "roof repair"…). */
  phraseIndex: number;
  /** Every phrase walked to its end — Google knows no more of this trade here; the next run starts over for new ones. */
  exhausted: boolean;
  /** A WHOLE STATE (owner, 2026-10-26: "all contractors in California"): its biggest cities, walked in turn — each phrase
   *  across every city before the next phrase, so the state fills in evenly. Absent for a city or an area. */
  cities?: string[] | null;
  /** Which of `cities` the run is on. */
  cityIndex?: number;
  /** Places already taken (or passed over), newest last, capped. */
  seen: string[];
  createdAt: string;
  by: string | null;
}

export interface HuntTrade {
  key: string;
  label: string;
  /** The words Google is asked for, the plainest first; a hunt walks them in turn as each runs dry. */
  phrases: readonly string[];
}

/** The trades a hunt can ask for — each key is one the pitch knows (lib/outreach/rules tradeKey → script tradePitch). */
export const HUNT_TRADES: readonly HuntTrade[] = [
  { key: "roofing", label: "Roofing", phrases: ["roofing contractors", "roofers", "roof repair", "roof replacement company"] },
  { key: "remodeling", label: "General and remodeling", phrases: ["general contractors", "remodeling contractors", "kitchen and bath remodeler", "home builder"] },
  { key: "decks", label: "Decks and patios", phrases: ["deck builders", "deck contractors", "patio and deck company"] },
  { key: "fencing", label: "Fencing", phrases: ["fence contractors", "fence company", "fence installation"] },
  { key: "hvac", label: "HVAC", phrases: ["HVAC contractors", "heating and air conditioning company", "furnace repair", "AC installation"] },
  { key: "plumbing", label: "Plumbing", phrases: ["plumbing contractors", "plumbers", "water heater installation"] },
  { key: "electrical", label: "Electrical", phrases: ["electrical contractors", "electricians", "EV charger installer"] },
  { key: "landscaping", label: "Landscaping", phrases: ["landscaping contractors", "landscapers", "lawn care company", "hardscape contractor"] },
  { key: "painting", label: "Painting", phrases: ["painting contractors", "house painters", "exterior painting company"] },
  { key: "concrete", label: "Concrete and paving", phrases: ["concrete contractors", "paving contractors", "driveway contractor"] },
  { key: "siding", label: "Siding", phrases: ["siding contractors", "siding company", "exterior remodeling contractor"] },
  { key: "gutters", label: "Gutters", phrases: ["gutter contractors", "gutter installation company"] },
  { key: "windows", label: "Windows and doors", phrases: ["window and door contractors", "window replacement company", "door installation"] },
  { key: "flooring", label: "Flooring", phrases: ["flooring contractors", "flooring company", "tile contractor", "hardwood floor installer"] },
  // Every kind of contractor JobFlex is for (owner, 2026-10-26: "all contractors related to us — we are their construction
  // platform"): the general words first, then each trade in turn.
  {
    key: "any",
    label: "Any contractor (every trade)",
    phrases: ["contractors", "home improvement contractors", "general contractors", "remodeling contractors", "roofing contractors", "HVAC contractors", "plumbers", "electricians", "landscapers", "fence contractors", "deck builders", "painting contractors", "concrete contractors", "siding contractors", "gutter contractors", "window and door contractors", "flooring contractors"],
  },
];

/** A whole state's search ground: its biggest cities and metros, the largest first (a text search answers ~60 places per
 *  phrase, so a state is asked city by city — "contractors in Fresno, CA" — not as one place). */
export const STATE_CITIES: Record<string, { name: string; cities: readonly string[] }> = {
  AL: { name: "Alabama", cities: ["Birmingham", "Huntsville", "Montgomery", "Mobile", "Tuscaloosa", "Hoover", "Auburn", "Dothan"] },
  AK: { name: "Alaska", cities: ["Anchorage", "Fairbanks", "Juneau", "Wasilla"] },
  AZ: { name: "Arizona", cities: ["Phoenix", "Tucson", "Mesa", "Chandler", "Scottsdale", "Gilbert", "Glendale", "Tempe", "Peoria", "Surprise", "Flagstaff", "Prescott", "Yuma"] },
  AR: { name: "Arkansas", cities: ["Little Rock", "Fayetteville", "Fort Smith", "Springdale", "Rogers", "Bentonville", "Jonesboro", "Conway"] },
  CA: {
    name: "California",
    cities: [
      "Los Angeles", "San Diego", "San Jose", "San Francisco", "Fresno", "Sacramento", "Long Beach", "Oakland", "Bakersfield", "Anaheim",
      "Riverside", "Santa Ana", "Irvine", "Stockton", "Chula Vista", "Fremont", "San Bernardino", "Modesto", "Santa Rosa", "Oxnard",
      "Fontana", "Moreno Valley", "Huntington Beach", "Glendale", "Santa Clarita", "Ontario", "Rancho Cucamonga", "Temecula", "Visalia",
      "Santa Barbara", "Salinas", "Palm Springs", "San Luis Obispo", "Redding", "Chico",
    ],
  },
  CO: { name: "Colorado", cities: ["Denver", "Colorado Springs", "Aurora", "Fort Collins", "Lakewood", "Boulder", "Pueblo", "Greeley", "Longmont", "Loveland", "Castle Rock", "Grand Junction"] },
  CT: { name: "Connecticut", cities: ["Bridgeport", "New Haven", "Hartford", "Stamford", "Waterbury", "Norwalk", "Danbury", "New Britain"] },
  DE: { name: "Delaware", cities: ["Wilmington", "Dover", "Newark", "Middletown"] },
  DC: { name: "Washington, DC", cities: ["Washington"] },
  FL: {
    name: "Florida",
    cities: ["Jacksonville", "Miami", "Tampa", "Orlando", "St. Petersburg", "Fort Lauderdale", "Tallahassee", "Cape Coral", "Port St. Lucie", "Sarasota", "Fort Myers", "Gainesville", "Pensacola", "West Palm Beach", "Naples", "Daytona Beach", "Lakeland", "Ocala"],
  },
  GA: { name: "Georgia", cities: ["Atlanta", "Augusta", "Columbus", "Savannah", "Athens", "Macon", "Marietta", "Alpharetta", "Roswell", "Valdosta"] },
  HI: { name: "Hawaii", cities: ["Honolulu", "Hilo", "Kailua-Kona", "Kahului"] },
  ID: { name: "Idaho", cities: ["Boise", "Meridian", "Nampa", "Idaho Falls", "Pocatello", "Coeur d'Alene", "Twin Falls"] },
  IL: { name: "Illinois", cities: ["Chicago", "Aurora", "Naperville", "Joliet", "Rockford", "Springfield", "Peoria", "Elgin", "Champaign", "Schaumburg"] },
  IN: { name: "Indiana", cities: ["Indianapolis", "Fort Wayne", "Evansville", "South Bend", "Carmel", "Fishers", "Bloomington", "Lafayette"] },
  IA: { name: "Iowa", cities: ["Des Moines", "Cedar Rapids", "Davenport", "Sioux City", "Iowa City", "Waterloo", "Ames", "Council Bluffs"] },
  KS: { name: "Kansas", cities: ["Wichita", "Overland Park", "Kansas City", "Olathe", "Topeka", "Lawrence", "Manhattan"] },
  KY: { name: "Kentucky", cities: ["Louisville", "Lexington", "Bowling Green", "Owensboro", "Covington", "Richmond"] },
  LA: { name: "Louisiana", cities: ["New Orleans", "Baton Rouge", "Shreveport", "Lafayette", "Lake Charles", "Monroe", "Kenner"] },
  ME: { name: "Maine", cities: ["Portland", "Lewiston", "Bangor", "Augusta"] },
  MD: { name: "Maryland", cities: ["Baltimore", "Columbia", "Germantown", "Silver Spring", "Frederick", "Rockville", "Annapolis", "Hagerstown"] },
  MA: { name: "Massachusetts", cities: ["Boston", "Worcester", "Springfield", "Cambridge", "Lowell", "Brockton", "Quincy", "New Bedford", "Plymouth"] },
  MI: { name: "Michigan", cities: ["Detroit", "Grand Rapids", "Warren", "Sterling Heights", "Ann Arbor", "Lansing", "Flint", "Kalamazoo", "Troy", "Traverse City"] },
  MN: { name: "Minnesota", cities: ["Minneapolis", "Saint Paul", "Rochester", "Duluth", "Bloomington", "Brooklyn Park", "St. Cloud", "Mankato"] },
  MS: { name: "Mississippi", cities: ["Jackson", "Gulfport", "Southaven", "Hattiesburg", "Biloxi", "Tupelo"] },
  MO: { name: "Missouri", cities: ["Kansas City", "St. Louis", "Springfield", "Columbia", "Independence", "Lee's Summit", "O'Fallon", "Joplin"] },
  MT: { name: "Montana", cities: ["Billings", "Missoula", "Great Falls", "Bozeman", "Butte", "Helena", "Kalispell"] },
  NE: { name: "Nebraska", cities: ["Omaha", "Lincoln", "Bellevue", "Grand Island", "Kearney"] },
  NV: { name: "Nevada", cities: ["Las Vegas", "Henderson", "Reno", "North Las Vegas", "Sparks", "Carson City"] },
  NH: { name: "New Hampshire", cities: ["Manchester", "Nashua", "Concord", "Dover", "Portsmouth"] },
  NJ: { name: "New Jersey", cities: ["Newark", "Jersey City", "Paterson", "Elizabeth", "Trenton", "Edison", "Toms River", "Cherry Hill", "Morristown", "Princeton"] },
  NM: { name: "New Mexico", cities: ["Albuquerque", "Las Cruces", "Rio Rancho", "Santa Fe", "Roswell", "Farmington"] },
  NY: { name: "New York", cities: ["New York", "Buffalo", "Rochester", "Yonkers", "Syracuse", "Albany", "Long Island", "White Plains", "Poughkeepsie", "Ithaca"] },
  NC: { name: "North Carolina", cities: ["Charlotte", "Raleigh", "Greensboro", "Durham", "Winston-Salem", "Fayetteville", "Cary", "Wilmington", "Asheville", "High Point"] },
  ND: { name: "North Dakota", cities: ["Fargo", "Bismarck", "Grand Forks", "Minot"] },
  OH: { name: "Ohio", cities: ["Columbus", "Cleveland", "Cincinnati", "Toledo", "Akron", "Dayton", "Canton", "Youngstown", "Mansfield"] },
  OK: { name: "Oklahoma", cities: ["Oklahoma City", "Tulsa", "Norman", "Broken Arrow", "Edmond", "Lawton"] },
  OR: { name: "Oregon", cities: ["Portland", "Salem", "Eugene", "Gresham", "Hillsboro", "Bend", "Beaverton", "Medford"] },
  PA: { name: "Pennsylvania", cities: ["Philadelphia", "Pittsburgh", "Allentown", "Erie", "Reading", "Scranton", "Lancaster", "Harrisburg", "State College", "Bethlehem"] },
  RI: { name: "Rhode Island", cities: ["Providence", "Warwick", "Cranston", "Pawtucket", "Newport"] },
  SC: { name: "South Carolina", cities: ["Charleston", "Columbia", "Greenville", "North Charleston", "Myrtle Beach", "Rock Hill", "Spartanburg", "Hilton Head Island"] },
  SD: { name: "South Dakota", cities: ["Sioux Falls", "Rapid City", "Aberdeen", "Brookings"] },
  TN: { name: "Tennessee", cities: ["Nashville", "Memphis", "Knoxville", "Chattanooga", "Clarksville", "Murfreesboro", "Franklin", "Jackson", "Johnson City"] },
  TX: {
    name: "Texas",
    cities: ["Houston", "San Antonio", "Dallas", "Austin", "Fort Worth", "El Paso", "Arlington", "Corpus Christi", "Plano", "Lubbock", "Laredo", "Irving", "Frisco", "McKinney", "Amarillo", "Waco", "Midland", "Tyler", "Killeen", "The Woodlands"],
  },
  UT: { name: "Utah", cities: ["Salt Lake City", "West Valley City", "Provo", "West Jordan", "Orem", "Sandy", "Ogden", "St. George", "Lehi", "Logan"] },
  VT: { name: "Vermont", cities: ["Burlington", "South Burlington", "Rutland", "Montpelier"] },
  VA: { name: "Virginia", cities: ["Virginia Beach", "Norfolk", "Chesapeake", "Richmond", "Arlington", "Newport News", "Alexandria", "Roanoke", "Lynchburg", "Charlottesville", "Fredericksburg"] },
  WA: { name: "Washington", cities: ["Seattle", "Spokane", "Tacoma", "Vancouver", "Bellevue", "Kent", "Everett", "Renton", "Yakima", "Olympia", "Bellingham", "Kennewick"] },
  WV: { name: "West Virginia", cities: ["Charleston", "Huntington", "Morgantown", "Parkersburg", "Wheeling"] },
  WI: { name: "Wisconsin", cities: ["Milwaukee", "Madison", "Green Bay", "Kenosha", "Racine", "Appleton", "Waukesha", "Eau Claire", "Oshkosh"] },
  WY: { name: "Wyoming", cities: ["Cheyenne", "Casper", "Laramie", "Gillette", "Rock Springs"] },
};

export const PER_DAY_CHOICES: readonly number[] = [5, 10, 20, 50];
export const MAX_PER_DAY = 100;
/** Places remembered per hunt, newest last. */
export const SEEN_CAP = 3000;
/** A daily hunt runs once its area's clock reads this hour or later. */
export const HUNT_HOUR = 7;

export function huntTrade(key: string | null | undefined): HuntTrade | null {
  return HUNT_TRADES.find((t) => t.key === key) ?? null;
}

/** The area as typed, tidied, and the state it names when it names one ("Seattle, WA", "Seattle Washington"); a state on
 *  its own ("California", "CA", "all of Texas") is the WHOLE STATE — its biggest cities, by name. */
export function parseArea(raw: string): { area: string; state: string | null; wholeState: boolean } {
  const area = raw.replace(/\s+/g, " ").trim().slice(0, 80);
  const bare = area.replace(/^(all of|the whole|whole|statewide|state of)\s+/i, "").replace(/\s+(state|statewide)$/i, "").replace(/[.,]+$/, "").trim();
  const whole = stateCode(bare);
  if (whole && STATE_CITIES[whole]) return { area: STATE_CITIES[whole].name, state: whole, wholeState: true };
  const parts = area.split(/[,\s]+/).filter(Boolean);
  let state: string | null = null;
  // The last word or two: "WA", "Washington", "New York".
  for (let n = 1; n <= 2 && n <= parts.length; n++) {
    const tail = parts.slice(-n).join(" ");
    const code = stateCode(tail);
    if (code) {
      state = code;
      break;
    }
  }
  return { area, state, wholeState: false };
}

/** The trade's search phrases, the plainest first. */
export function huntPhrases(trade: string): readonly string[] {
  return (huntTrade(trade) ?? HUNT_TRADES[HUNT_TRADES.length - 1]).phrases;
}

/** What Google is asked for: "roofing contractors in Seattle, WA" — the phrase the hunt is on; for a whole state, in
 *  the city it is on ("contractors in Fresno, CA"). */
export function huntQuery(h: Pick<Hunt, "trade" | "area"> & { phraseIndex?: number; cities?: readonly string[] | null; cityIndex?: number; state?: string | null }): string {
  const phrases = huntPhrases(h.trade);
  const i = Math.min(Math.max(0, h.phraseIndex ?? 0), phrases.length - 1);
  if (h.cities?.length) {
    const c = Math.min(Math.max(0, h.cityIndex ?? 0), h.cities.length - 1);
    return `${phrases[i]} in ${h.cities[c]}${h.state ? `, ${h.state}` : ""}`;
  }
  return `${phrases[i]} in ${h.area}`;
}

/** Where a run goes once a phrase has run dry where it is: a whole state takes the same phrase to its next city, then
 *  the next phrase from its first city; an area takes the next phrase. Null past the last — Google knows no more. */
export function nextSpot(at: { phrase: number; city: number }, phrases: number, cities: number): { phrase: number; city: number } | null {
  if (cities > 0 && at.city + 1 < cities) return { phrase: at.phrase, city: at.city + 1 };
  if (at.phrase + 1 < phrases) return { phrase: at.phrase + 1, city: 0 };
  return null;
}

/** A new hunt from the form; null with the reason when the form is wrong. */
export function newHunt(input: { trade: string; area: string; perDay: number; daily: boolean; by?: string | null }, id: string, now = new Date()): { ok: true; hunt: Hunt } | { ok: false; error: string } {
  const trade = huntTrade(input.trade);
  if (!trade) return { ok: false, error: "Pick a trade." };
  const { area, state, wholeState } = parseArea(input.area ?? "");
  if (area.length < 2) return { ok: false, error: "Say where: a city and state, or an area." };
  const perDay = Math.round(Number(input.perDay));
  if (!Number.isFinite(perDay) || perDay < 1 || perDay > MAX_PER_DAY) return { ok: false, error: `How many a day: 1 to ${MAX_PER_DAY}.` };
  return {
    ok: true,
    hunt: {
      id,
      trade: trade.key,
      area,
      perDay,
      daily: !!input.daily,
      state,
      lastRunAt: null,
      lastFound: 0,
      totalFound: 0,
      lastError: null,
      pageToken: null,
      phraseIndex: 0,
      exhausted: false,
      ...(wholeState && state ? { cities: [...STATE_CITIES[state].cities], cityIndex: 0 } : {}),
      seen: [],
      createdAt: now.toISOString(),
      by: input.by ?? null,
    },
  };
}

/** A business as Google's Places answers it (the fields asked for), trimmed to what the hunt needs. */
export interface FoundPlace {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  rating: number | null;
  ratings: number | null;
  types: string[];
  /** OPERATIONAL, CLOSED_TEMPORARILY, CLOSED_PERMANENTLY — as Google says. */
  status: string | null;
}

/** Google's business types that name a trade, for a hunt of "any" contractor. */
const TYPE_TRADES: Array<[RegExp, string]> = [
  [/roofing/, "roofing"],
  [/general_contractor|home_improvement|remodel/, "remodeling"],
  [/electrician|electrical/, "electrical"],
  [/plumber|plumbing/, "plumbing"],
  [/painter|painting/, "painting"],
  [/landscap|lawn|tree_service/, "landscaping"],
  [/hvac|heating|air_conditioning/, "hvac"],
  [/fence/, "fencing"],
  [/deck|patio/, "decks"],
  [/concrete|paving|asphalt/, "concrete"],
  [/siding/, "siding"],
  [/gutter/, "gutters"],
  [/window|door/, "windows"],
  [/floor|carpet|tile/, "flooring"],
];

/** The city and state out of "123 Main St, Seattle, WA 98101, USA". */
export function cityState(address: string | null | undefined): { city: string | null; state: string | null } {
  const a = (address ?? "").trim();
  const m = /,\s*([^,]+?),\s*([A-Z]{2})\s*\d{5}(?:-\d{4})?(?:,|$)/.exec(a) ?? /,\s*([^,]+?),\s*([A-Z]{2})(?:,|$)/.exec(a);
  if (!m) return { city: null, state: null };
  return { city: m[1].trim().slice(0, 60) || null, state: m[2] };
}

export interface FoundRow extends ListRow {
  website: string | null;
  placeId: string;
  rating: number | null;
  ratings: number | null;
}

/** A place into a row of the list — null for one closed for good, one with neither a phone nor a website, or one whose
 *  phone isn't a number the outreach can use. The owner's name isn't known from a listing (the AI asks for the owner). */
export function placeToRow(p: FoundPlace, h: Pick<Hunt, "trade" | "state">): FoundRow | null {
  if (p.status === "CLOSED_PERMANENTLY") return null;
  const name = p.name.replace(/\s+/g, " ").trim().slice(0, 120);
  if (!name) return null;
  const phone = p.phone ? toE164(p.phone) : null;
  const website = tidyUrl(p.website);
  if (!phone && !website) return null;
  const loc = cityState(p.address);
  const trade = h.trade === "any" ? (TYPE_TRADES.find(([re]) => p.types.some((t) => re.test(t)))?.[1] ?? null) : h.trade;
  return { name: "", business: name, phone: phone || null, email: null, trade, state: loc.state ?? h.state, city: loc.city, website, placeId: p.id, rating: p.rating, ratings: p.ratings };
}

/** A website address tidied: with its scheme, no tracking tail, null for a bare directory page or nothing. */
export function tidyUrl(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    if (!/\./.test(u.hostname)) return null;
    // A directory or a social page is not the business's own site.
    if (/(^|\.)(facebook|instagram|yelp|angi|homeadvisor|houzz|nextdoor|linkedin|thumbtack|bbb)\.(com|org)$/i.test(u.hostname)) return null;
    u.search = "";
    u.hash = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

const JUNK_EMAIL = /no-?reply|donotreply|example\.|sentry|wixpress|squarespace|godaddy|wordpress|\.(png|jpg|jpeg|gif|svg|webp|css|js)$|^[0-9a-f]{20,}@|@(?:2x|3x)\b/i;
const EMAIL_IN_TEXT = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

/** The business's email out of a page of its site: a mailto first, then any address on the page, one on the site's own
 *  domain before any other, never a no-reply or a file name. Null when there is none. */
export function emailFromHtml(html: string, site: string | null): string | null {
  const text = html.slice(0, 400_000);
  const found: string[] = [];
  for (const m of text.matchAll(/mailto:([^"'?\s<>]+)/gi)) found.push(m[1]);
  for (const m of text.matchAll(EMAIL_IN_TEXT)) found.push(m[0]);
  // "info (at) summitroof (dot) com" — an address written to fool the robots.
  for (const m of text.matchAll(/([a-z0-9._%+-]+)\s*[\[(]\s*at\s*[\])]\s*([a-z0-9.-]+)\s*(?:[\[(]\s*dot\s*[\])]\s*([a-z]{2,}))/gi)) found.push(`${m[1]}@${m[2]}.${m[3]}`);
  const clean = found.map((e) => decodeURIComponent(e).toLowerCase().replace(/[.,;:)]+$/, "")).filter((e) => /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(e) && !JUNK_EMAIL.test(e) && e.length <= 80);
  if (!clean.length) return null;
  let domain: string | null = null;
  try {
    domain = site ? new URL(site).hostname.replace(/^www\./, "") : null;
  } catch {
    domain = null;
  }
  const own = domain ? clean.find((e) => e.endsWith(`@${domain}`) || e.endsWith(`.${domain}`)) : null;
  return own ?? clean[0];
}

/** The pages of a site worth reading for an email, in order. */
export function contactPages(site: string): string[] {
  const base = site.replace(/\/$/, "");
  return [base, `${base}/contact`, `${base}/contact-us`, `${base}/about`, `${base}/about-us`];
}

/** The rows as the list importer reads them (lib/outreach/rules parseProspectList), a header first. */
export function rowsToList(rows: readonly ListRow[]): string {
  const q = (v: string | null) => `"${(v ?? "").replace(/"/g, '""')}"`;
  return ["business,name,phone,email,trade,state,city", ...rows.map((r) => [r.business, r.name, r.phone, r.email, r.trade, r.state, r.city].map(q).join(","))].join("\n");
}

/** The zone a hunt's area keeps time in: the state's first zone, else the Pacific coast (JobFlex's own). */
export function huntZone(h: Pick<Hunt, "state">): string {
  const z = h.state ? STATE_ZONES[h.state] : null;
  return z?.[0] ?? "America/Los_Angeles";
}

/** The local date (YYYY-MM-DD) and hour in a zone. */
export function localClock(now: Date, zone: string): { day: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { day: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) % 24 };
}

/** A daily hunt is due once its area's morning has come (HUNT_HOUR) and it hasn't run that day. */
export function huntDue(h: Hunt, now: Date): boolean {
  if (!h.daily) return false;
  const zone = huntZone(h);
  const { day, hour } = localClock(now, zone);
  if (hour < HUNT_HOUR) return false;
  if (!h.lastRunAt) return true;
  return localClock(new Date(h.lastRunAt), zone).day !== day;
}

/** The places remembered, the newest last, kept to the cap. */
export function rememberSeen(seen: readonly string[], ids: readonly string[]): string[] {
  const set = new Set(seen);
  const out = [...seen];
  for (const id of ids) {
    if (set.has(id)) continue;
    set.add(id);
    out.push(id);
  }
  return out.length > SEEN_CAP ? out.slice(out.length - SEEN_CAP) : out;
}

/** The line under a hunt on the page. */
export function huntWords(h: Pick<Hunt, "trade" | "area" | "perDay" | "daily"> & { cities?: readonly string[] | null }): string {
  const t = huntTrade(h.trade)?.label ?? h.trade;
  const where = h.cities?.length ? `${h.area} — the whole state, ${h.cities.length} cities` : h.area;
  return `${t} · ${where} · ${h.perDay} a day · ${h.daily ? "every morning" : "when pressed"}`;
}

/** How the last run went, in a line. */
export function huntStatusWords(h: Pick<Hunt, "lastError" | "lastRunAt" | "daily" | "lastFound" | "totalFound" | "exhausted"> & { cities?: readonly string[] | null; cityIndex?: number }): string {
  if (h.lastError) return `Didn't run: ${h.lastError}`;
  if (!h.lastRunAt) return h.daily ? "Runs tomorrow morning — or press Find now." : "Not run yet.";
  const found = `${h.lastFound} new last time, ${h.totalFound} in all`;
  if (h.cities?.length) {
    if (h.exhausted) return `${found}. Every city walked — the next run starts over for newcomers.`;
    const c = Math.min(Math.max(0, h.cityIndex ?? 0), h.cities.length - 1);
    return `${found}. Next: ${h.cities[c]} (city ${c + 1} of ${h.cities.length}).`;
  }
  if (h.exhausted) return `${found}. Google has no more of this trade here — the next run looks for newcomers; widen the area or add another area for more.`;
  return found + ".";
}

/** What a run says on the page. */
export function runWords(r: { found: number; added: number; merged: number; onJobflex: number; withEmail: number; error: string | null }, h: Pick<Hunt, "trade" | "area">): string {
  if (r.error) return r.error;
  const t = (huntTrade(h.trade)?.label ?? h.trade).toLowerCase();
  if (!r.added && !r.merged) return r.onJobflex ? `Found ${r.found}, but ${r.onJobflex === 1 ? "it is" : "they are"} already on JobFlex.` : `No new ${t} contractors in ${h.area} this time — Google has no more it knows; widen the area.`;
  return `Added ${r.added} ${t} contractor${r.added === 1 ? "" : "s"} in ${h.area}${r.withEmail ? `, ${r.withEmail} with an email` : ""}${r.merged ? `; ${r.merged} already on the list filled in` : ""}${r.onJobflex ? `; ${r.onJobflex} already on JobFlex left out` : ""}. The list below has them — the schedule takes it from here.`;
}

/** The Google answer as the page can say it. */
export function placesErrorWords(status: number, message: string | null): string {
  const m = (message ?? "").trim();
  if (status === 403 && /not (?:been )?(?:enabled|used|activated)|disabled|SERVICE_DISABLED|PERMISSION_DENIED/i.test(m)) return "Google's Places API (New) isn't turned on for JobFlex's Google key — enable it in Google Cloud (APIs & Services → Places API (New)) and try again.";
  if (status === 403 || status === 401) return `Google refused the key: ${m || "permission denied"}.`;
  if (status === 429) return "Google's search quota is used up for now — try later.";
  return m ? `Google answered: ${m}` : `Google's search answered ${status}.`;
}
