// THE SITE, READ FROM THE ADDRESS (Deck Studio M3, 2026-10-10) — pure.
//
// Owner: "make smart — the frost, the snow, the soil should come from the
// address, not be asked." The job's state and ZIP give the four numbers the
// code's tables are entered with, and the ground's fall across the deck:
//
//   · FROST depth — the fence estimator's market table already carries the
//     typical code frost line per state (lib/fence/market); it is read there.
//   · GROUND SNOW LOAD (pg, psf) — the code's Figure R301.2(5) / ASCE 7's map,
//     reduced to a state figure with ZIP-prefix corrections where a metro or a
//     mountain range crosses one of the deck tables' columns (40/50/60/70) or
//     the rafter tables' (20/30/50/70). The deck's design load is the greater
//     of 40 psf live and the ground snow; the roof's rafter page follows the
//     ground snow.
//   · SOIL — the code's presumptive 1,500 psf unless the office knows better;
//     the studio keeps it a choice.
//   · TERMITES — Figure R301.2(6): where the hazard is heavy the notes ask for
//     ground-contact treatment and a termite shield at the posts.
//   · SLOPE — the ground's fall over the deck's depth and width, inches, read
//     from USGS lidar when the server can (actions/deckEstimator readDeckSite)
//     or typed by the contractor. The frame lengthens the downhill posts and
//     footings, the stairs land on the real ground, the 3D tilts the lawn.
//
// EVERY FIGURE HERE IS AN ESTIMATE from a published map, said so in the
// checks and the notes: the building office's own number governs, and the
// contractor can type over any of them.

import { LOADS, type LoadPsf, type SoilPsf } from "./codeTables";
import type { RoofLoad } from "./roofTables";
import { parseStateZip, resolveMarket } from "../fence/market";

/* ------------------------------------------------------------------ */
/*  Ground snow, psf — the state's usual figure                         */
/* ------------------------------------------------------------------ */

/** Ground snow load by state (psf), the figure most of the state's towns read on the map. */
export const STATE_SNOW: Record<string, number> = {
  AL: 5, AK: 50, AZ: 0, AR: 10, CA: 0, CO: 30, CT: 30, DE: 20, DC: 25, FL: 0, GA: 5, HI: 0, ID: 30, IL: 20, IN: 20, IA: 30, KS: 20, KY: 15, LA: 0,
  ME: 60, MD: 25, MA: 40, MI: 30, MN: 50, MS: 5, MO: 20, MT: 30, NE: 25, NV: 0, NH: 60, NJ: 25, NM: 10, NY: 40, NC: 15, ND: 40, OH: 20, OK: 10, OR: 15,
  PA: 30, RI: 30, SC: 10, SD: 40, TN: 10, TX: 5, UT: 30, VT: 60, VA: 20, WA: 25, WV: 30, WI: 35, WY: 40,
};

/**
 * ZIP-prefix corrections: a metro that reads lighter than its state, a range
 * that reads heavier. A value past 70 is the map's "case study" country — the
 * tables stop at 70 and the checks say an engineer's snow figure is needed.
 */
export const ZIP3_SNOW: Record<string, { label: string; psf: number }> = {
  // The Northeast
  "100": { label: "New York City", psf: 25 }, "101": { label: "New York City", psf: 25 }, "102": { label: "New York City", psf: 25 }, "103": { label: "Staten Island", psf: 25 }, "104": { label: "The Bronx", psf: 25 },
  "110": { label: "Long Island", psf: 25 }, "111": { label: "Long Island", psf: 25 }, "112": { label: "Brooklyn", psf: 25 }, "113": { label: "Queens", psf: 25 }, "114": { label: "Queens", psf: 25 }, "115": { label: "Long Island", psf: 25 }, "116": { label: "Long Island", psf: 25 }, "117": { label: "Long Island", psf: 25 }, "118": { label: "Long Island", psf: 25 }, "119": { label: "Long Island", psf: 25 },
  "122": { label: "Albany", psf: 40 }, "128": { label: "Glens Falls", psf: 60 }, "129": { label: "Adirondacks", psf: 80 }, "132": { label: "Syracuse", psf: 50 }, "136": { label: "Watertown", psf: 70 }, "140": { label: "Buffalo", psf: 40 }, "142": { label: "Buffalo", psf: 40 }, "146": { label: "Rochester", psf: 40 },
  "010": { label: "Western Massachusetts", psf: 50 }, "011": { label: "Western Massachusetts", psf: 50 }, "012": { label: "Berkshires", psf: 50 }, "013": { label: "Western Massachusetts", psf: 50 }, "021": { label: "Boston", psf: 40 }, "022": { label: "Boston", psf: 40 }, "025": { label: "Cape Cod", psf: 30 }, "026": { label: "Cape Cod", psf: 30 },
  "030": { label: "Southern New Hampshire", psf: 50 }, "031": { label: "Manchester", psf: 50 }, "032": { label: "Southern New Hampshire", psf: 50 }, "035": { label: "White Mountains", psf: 80 }, "038": { label: "Seacoast", psf: 50 },
  "040": { label: "Portland, ME", psf: 50 }, "041": { label: "Portland, ME", psf: 50 }, "046": { label: "Northern Maine", psf: 90 }, "047": { label: "Aroostook", psf: 100 },
  "052": { label: "Southern Vermont", psf: 50 }, "053": { label: "Southern Vermont", psf: 50 }, "056": { label: "Northern Vermont", psf: 70 },
  "060": { label: "Northwest Connecticut", psf: 40 }, "074": { label: "Northern New Jersey", psf: 30 }, "078": { label: "Northwest New Jersey", psf: 30 },
  "150": { label: "Pittsburgh", psf: 25 }, "151": { label: "Pittsburgh", psf: 25 }, "152": { label: "Pittsburgh", psf: 25 }, "165": { label: "Northwest Pennsylvania", psf: 40 }, "167": { label: "Northern Pennsylvania", psf: 40 }, "190": { label: "Philadelphia", psf: 25 }, "191": { label: "Philadelphia", psf: 25 },
  "201": { label: "Northern Virginia", psf: 25 }, "215": { label: "Western Maryland", psf: 30 }, "220": { label: "Northern Virginia", psf: 25 }, "221": { label: "Northern Virginia", psf: 25 }, "222": { label: "Northern Virginia", psf: 25 },
  // The Lakes and the Midwest
  "441": { label: "Cleveland", psf: 25 }, "481": { label: "Detroit", psf: 25 }, "482": { label: "Detroit", psf: 25 }, "496": { label: "Northern Michigan", psf: 50 }, "497": { label: "Northern Michigan", psf: 50 }, "498": { label: "Upper Peninsula", psf: 60 }, "499": { label: "Upper Peninsula", psf: 60 },
  "532": { label: "Milwaukee", psf: 30 }, "545": { label: "Northern Wisconsin", psf: 50 }, "548": { label: "Northern Wisconsin", psf: 50 }, "549": { label: "Northern Wisconsin", psf: 50 },
  "553": { label: "Minneapolis", psf: 50 }, "554": { label: "Minneapolis", psf: 50 }, "556": { label: "Duluth", psf: 60 }, "566": { label: "Northern Minnesota", psf: 60 }, "567": { label: "Northern Minnesota", psf: 60 },
  "600": { label: "Chicago", psf: 25 }, "601": { label: "Chicago", psf: 25 }, "602": { label: "Chicago", psf: 25 }, "603": { label: "Chicago", psf: 25 }, "604": { label: "Chicago", psf: 25 }, "605": { label: "Chicago", psf: 25 }, "606": { label: "Chicago", psf: 25 }, "629": { label: "Southern Illinois", psf: 15 },
  "505": { label: "Northern Iowa", psf: 35 }, "506": { label: "Northern Iowa", psf: 35 }, "510": { label: "Northwest Iowa", psf: 35 }, "512": { label: "Northwest Iowa", psf: 35 },
  // The South
  "305": { label: "North Georgia", psf: 10 }, "287": { label: "Western North Carolina", psf: 30 }, "288": { label: "Blue Ridge", psf: 30 }, "284": { label: "Carolina coast", psf: 10 }, "285": { label: "Carolina coast", psf: 10 }, "791": { label: "Amarillo", psf: 15 },
  // The Mountains
  "800": { label: "Denver", psf: 30 }, "801": { label: "Denver", psf: 30 }, "802": { label: "Denver", psf: 30 }, "804": { label: "Colorado mountains", psf: 80 }, "805": { label: "Fort Collins", psf: 30 }, "809": { label: "Colorado Springs", psf: 30 }, "812": { label: "San Luis Valley", psf: 40 }, "814": { label: "Colorado mountains", psf: 80 }, "815": { label: "Grand Junction", psf: 20 }, "816": { label: "Colorado mountains", psf: 80 },
  "830": { label: "Jackson Hole", psf: 90 }, "837": { label: "Boise", psf: 25 }, "832": { label: "Idaho mountains", psf: 60 }, "834": { label: "Sun Valley", psf: 70 },
  "840": { label: "Wasatch Back", psf: 60 }, "841": { label: "Salt Lake City", psf: 30 }, "843": { label: "Utah mountains", psf: 60 }, "844": { label: "Utah mountains", psf: 60 }, "845": { label: "Utah mountains", psf: 60 },
  "859": { label: "Show Low", psf: 40 }, "860": { label: "Flagstaff", psf: 60 }, "875": { label: "Santa Fe", psf: 30 }, "877": { label: "Taos", psf: 40 },
  "894": { label: "Northern Nevada", psf: 30 }, "895": { label: "Reno", psf: 20 }, "896": { label: "Carson City", psf: 30 }, "599": { label: "Montana mountains", psf: 60 },
  "959": { label: "Sierra foothills", psf: 30 }, "960": { label: "Northern Sierra", psf: 70 }, "961": { label: "Lake Tahoe", psf: 200 }, "923": { label: "San Bernardino mountains", psf: 60 }, "935": { label: "Tehachapi", psf: 30 },
  // The Northwest
  "980": { label: "Seattle", psf: 20 }, "981": { label: "Seattle", psf: 20 }, "982": { label: "Puget Sound", psf: 25 }, "988": { label: "Cascades", psf: 60 }, "989": { label: "Cascades", psf: 60 }, "992": { label: "Spokane", psf: 40 }, "993": { label: "Yakima", psf: 30 },
  "970": { label: "Portland, OR", psf: 25 }, "972": { label: "Portland, OR", psf: 25 }, "977": { label: "Central Oregon", psf: 30 }, "978": { label: "Eastern Oregon", psf: 30 },
  "995": { label: "Anchorage", psf: 50 }, "997": { label: "Fairbanks", psf: 60 }, "998": { label: "Juneau", psf: 70 },
};

/** The deck tables stop at 70 psf; the rafter tables too. Past that the map says "case study" and an engineer sets the figure. */
export const SNOW_TABLE_MAX_PSF = 70;

/** The deck's design load: 40 psf live, or the ground snow read up to the table's next column. */
export function deckLoadForSnow(groundSnowPsf: number): { load: LoadPsf; beyond: boolean } {
  if (!(groundSnowPsf > 40)) return { load: 40, beyond: false };
  const col = LOADS.find((l) => l >= groundSnowPsf);
  return col ? { load: col, beyond: false } : { load: 70, beyond: true };
}

/** The rafter tables' page for a ground snow load: the 20 psf live page up to 20, then 30, 50, 70. */
export function roofLoadForSnow(groundSnowPsf: number): { load: RoofLoad; beyond: boolean } {
  if (!(groundSnowPsf > 20)) return { load: 20, beyond: false };
  if (groundSnowPsf <= 30) return { load: 30, beyond: false };
  if (groundSnowPsf <= 50) return { load: 50, beyond: false };
  return { load: 70, beyond: groundSnowPsf > SNOW_TABLE_MAX_PSF };
}

/* ------------------------------------------------------------------ */
/*  Termites — Figure R301.2(6)                                         */
/* ------------------------------------------------------------------ */

export type TermiteHazard = "very-heavy" | "moderate-heavy" | "slight-moderate" | "none-slight";
const VERY_HEAVY = new Set(["AL", "FL", "GA", "HI", "LA", "MS", "SC"]);
const MODERATE_HEAVY = new Set(["AR", "AZ", "CA", "DC", "DE", "KS", "KY", "MD", "MO", "NC", "NM", "NV", "OK", "TN", "TX", "VA"]);
const NONE_SLIGHT = new Set(["AK", "ME", "MN", "MT", "ND", "NH", "VT", "WI", "WY"]);
export function termiteHazard(state: string | null | undefined): TermiteHazard {
  const s = (state ?? "").toUpperCase();
  if (VERY_HEAVY.has(s)) return "very-heavy";
  if (MODERATE_HEAVY.has(s)) return "moderate-heavy";
  if (NONE_SLIGHT.has(s)) return "none-slight";
  return "slight-moderate";
}
export const TERMITE_LABEL: Record<TermiteHazard, string> = {
  "very-heavy": "very heavy",
  "moderate-heavy": "moderate to heavy",
  "slight-moderate": "slight to moderate",
  "none-slight": "none to slight",
};

/* ------------------------------------------------------------------ */
/*  The ground's fall                                                  */
/* ------------------------------------------------------------------ */

/** How the ground falls across the deck, inches: out from the house over the deck's depth, and left to right over its width. Positive = downhill. */
export interface SiteSlope {
  outDropIn: number;
  acrossDropIn: number;
}
export const SLOPE_LIMITS = { dropIn: { min: -120, max: 120 } } as const;
export const flatSlope = (): SiteSlope => ({ outDropIn: 0, acrossDropIn: 0 });

/**
 * The ground's height under a point of the deck, inches, relative to the
 * ground at the house line's left corner (z = 0 there). x along the house,
 * y out from it, both inches; the deck's width and depth set the gradient.
 */
export function groundAt(slope: SiteSlope, x: number, y: number, widthIn: number, depthIn: number): number {
  const out = depthIn > 0 ? (slope.outDropIn * y) / depthIn : 0;
  const across = widthIn > 0 ? (slope.acrossDropIn * x) / widthIn : 0;
  return -(out + across);
}

/** Average grade over the deck, percent, for the words. */
export function slopeGradePct(slope: SiteSlope, widthIn: number, depthIn: number): number {
  const out = depthIn > 0 ? slope.outDropIn / depthIn : 0;
  const across = widthIn > 0 ? slope.acrossDropIn / widthIn : 0;
  return Math.round(Math.hypot(out, across) * 1000) / 10;
}

/**
 * Lidar heights around a point → the ground's gradient there. `samples` are
 * (east ft, north ft, height ft) about the house. A least-squares plane; back
 * come the fall per foot and the compass bearing the ground falls toward.
 */
export function fitGround(samples: Array<{ eastFt: number; northFt: number; heightFt: number }>): { gradePct: number; downhillDeg: number; dzdxFtPerFt: number; dzdyFtPerFt: number } | null {
  if (samples.length < 4) return null;
  let sx = 0, sy = 0, sz = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0;
  const n = samples.length;
  for (const s of samples) {
    sx += s.eastFt; sy += s.northFt; sz += s.heightFt;
    sxx += s.eastFt * s.eastFt; syy += s.northFt * s.northFt; sxy += s.eastFt * s.northFt;
    sxz += s.eastFt * s.heightFt; syz += s.northFt * s.heightFt;
  }
  // Normal equations for z = a·x + b·y + c.
  const A = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]];
  const B = [sxz, syz, sz];
  const det = (m: number[][]) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(A);
  if (Math.abs(D) < 1e-9) return null;
  const col = (k: number) => A.map((row, i) => row.map((v, j) => (j === k ? B[i] : v)));
  const a = det(col(0)) / D;
  const b = det(col(1)) / D;
  const grade = Math.hypot(a, b);
  // The ground falls toward −∇z.
  const downhill = (Math.atan2(-a, -b) * 180) / Math.PI;
  return { gradePct: Math.round(grade * 1000) / 10, downhillDeg: Math.round(((downhill % 360) + 360) % 360), dzdxFtPerFt: a, dzdyFtPerFt: b };
}

/* ------------------------------------------------------------------ */
/*  The site, from an address                                           */
/* ------------------------------------------------------------------ */

export interface SiteFacts {
  state: string;
  zip: string | null;
  /** "Denver, CO" or "Colorado" or "U.S. average". */
  label: string;
  frostIn: number;
  groundSnowPsf: number;
  /** The deck tables' column for it, and the rafter tables' page. */
  deckLoad: LoadPsf;
  roofLoad: RoofLoad;
  /** The map says more than the tables carry (case-study country). */
  snowBeyondTable: boolean;
  soilPsf: SoilPsf;
  termite: TermiteHazard;
  /** Where each number came from, in plain words. */
  basis: string[];
}

/** What the address says about the site. Nothing here is asked of the contractor; everything can be typed over. */
export function siteFromAddress(address: string | null | undefined, homeState?: string | null): SiteFacts {
  const parsed = parseStateZip(address);
  const state = (parsed.state ?? homeState ?? "").toUpperCase();
  const zip = parsed.zip;
  const market = parsed.state || parsed.zip ? resolveMarket({ address }) : resolveMarket({ state: homeState });
  const zip3 = zip ? zip.slice(0, 3) : null;
  const basis: string[] = [];
  let snow = state ? STATE_SNOW[state] ?? 20 : 20;
  let label = market.label;
  if (zip3 && ZIP3_SNOW[zip3]) {
    snow = ZIP3_SNOW[zip3].psf;
    label = ZIP3_SNOW[zip3].label.includes(",") ? ZIP3_SNOW[zip3].label : `${ZIP3_SNOW[zip3].label}, ${state}`;
    basis.push(`Ground snow ${snow} psf — the map's figure around ${ZIP3_SNOW[zip3].label} (IRC Figure R301.2(5)); the building office's number governs.`);
  } else if (state) basis.push(`Ground snow ${snow} psf — ${market.label.includes(",") ? market.label.split(", ").pop() : market.label}'s usual figure on the map (IRC Figure R301.2(5)); mountains and lake shores read higher.`);
  else basis.push("No state in the address: a 20 psf ground snow and a 24-in. frost line are assumed.");
  const frostIn = market.frostIn ?? 24;
  basis.push(`Frost line ${frostIn} in. — the state's typical code depth; the local office may ask for more.`);
  const deck = deckLoadForSnow(snow);
  const roof = roofLoadForSnow(snow);
  if (deck.beyond || roof.beyond) basis.push(`Past ${SNOW_TABLE_MAX_PSF} psf the code's deck and rafter tables stop: an engineer sets the snow figure here.`);
  const termite = termiteHazard(state);
  if (termite === "very-heavy" || termite === "moderate-heavy") basis.push(`Termite hazard ${TERMITE_LABEL[termite]} (IRC Figure R301.2(6)): ground-contact treatment near the soil, and a termite shield or a 6-in. clearance at the posts.`);
  return { state, zip, label, frostIn, groundSnowPsf: snow, deckLoad: deck.load, roofLoad: roof.load, snowBeyondTable: deck.beyond || roof.beyond, soilPsf: 1500, termite, basis };
}
