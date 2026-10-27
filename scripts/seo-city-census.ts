// Writes src/lib/seo/city-census.data.ts — each cost-guide city's local facts
// from the Census Bureau (cost guides phase 2, docs/seo-phase-2.md, 2026-10-26).
//
// What it reads, all free and public:
//   · ACS 5-year (api.census.gov, CENSUS_API_KEY from .env.local): B25035
//     median year built, B25034 year built (the share before 1980), B25040
//     heating fuel, B25024 units in structure (single-family detached), B25077
//     median home value, B25003 tenure (owner-occupied);
//   · the place's county: ACS "county (or part)" under the place — the part
//     holding most of its housing units (no relationship file needed);
//   · County Business Patterns: establishments by county for NAICS 238160
//     roofing, 238170 siding, 238220 plumbing/HVAC, 238320 painting, 238990
//     other specialty trades;
//   · coordinates: the Gazetteer files, downloaded and unzipped once from
//       https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_place_national.zip
//       https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_counties_national.zip
//
//   npx tsx scripts/seo-city-census.ts path/to/gazetteer-dir [api-cache-dir]
//
// A city is matched by state and name against the ACS places (incorporated
// places, census-designated places, consolidated-city balances), the way
// scripts/seo-city-population.ts matches the estimates; the New York boroughs
// and Arlington, VA are counties. Tri-Cities, WA is three places with rows of
// their own and is left out. A city with no match has no entry. Pages never
// call the Census: this file is the only reader.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CITY_COST_INDEX } from "../src/lib/estimate/location-index-data";
import { slugify } from "../src/lib/seo/cities";
import { CENSUS_NAICS } from "../src/lib/seo/census";

const ROOT = join(__dirname, "..");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { loadEnvConfig } = require("@next/env") as typeof import("@next/env");
loadEnvConfig(ROOT, true, { info: () => {}, error: console.error });
const KEY = process.env.CENSUS_API_KEY;
if (!KEY) {
  console.error("CENSUS_API_KEY is not set — get a free key at https://api.census.gov/data/key_signup.html and put it in .env.local.");
  process.exit(1);
}
const gazDir = process.argv[2];
if (!gazDir) throw new Error("Pass the directory holding the unzipped 2024 Gazetteer place and county files (see the header of this script).");

const ACS_YEARS = [2024, 2023];
const CBP_YEARS = [2024, 2023];
const ACS_VARS = [
  "B25035_001E",
  ...Array.from({ length: 11 }, (_, i) => `B25034_${String(i + 1).padStart(3, "0")}E`),
  "B25040_001E", "B25040_002E", "B25040_003E", "B25040_004E", "B25040_005E",
  "B25024_001E", "B25024_002E",
  "B25077_001E",
  "B25003_001E", "B25003_002E",
];
// The labels the shares rely on, checked against the API so a re-binned table fails loudly.
const LABELS: Record<string, RegExp> = {
  B25034_006E: /Built 1980 to 1989$/,
  B25034_007E: /Built 1970 to 1979$/,
  B25034_011E: /Built 1939 or earlier$/,
  B25040_002E: /Utility gas$/,
  B25040_003E: /Bottled or tank gas/,
  B25040_004E: /Electricity$/,
  B25040_005E: /Fuel oil/,
  B25024_002E: /1, detached$/,
  B25003_002E: /Owner occupied$/,
};

// Optional third argument: a directory where API answers are kept, so a re-run doesn't fetch them again.
const cacheDir = process.argv[3];

async function get(url: string): Promise<string[][]> {
  const cached = cacheDir ? join(cacheDir, createHash("sha1").update(url).digest("hex") + ".json") : null;
  if (cached && existsSync(cached)) return JSON.parse(readFileSync(cached, "utf8"));
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(`${url}&key=${KEY}`, { signal: AbortSignal.timeout(120_000) }).catch((e: Error) => ({ ok: false, status: 0, text: async () => e.message }));
    const t = await r.text();
    if (r.ok && t.startsWith("[")) {
      if (cached) {
        mkdirSync(cacheDir, { recursive: true });
        writeFileSync(cached, t);
      }
      return JSON.parse(t);
    }
    // A 404 is a vintage not published yet; anything else is worth another try.
    if (attempt >= 5 || r.status === 404) throw new Error(`${r.status} from ${url.split("?")[0]}: ${t.slice(0, 160)}`);
    await new Promise((res) => setTimeout(res, 1500 * attempt));
  }
}

async function firstYear<T>(years: number[], f: (y: number) => Promise<T>): Promise<{ year: number; data: T }> {
  let last: unknown;
  for (const y of years) {
    try {
      return { year: y, data: await f(y) };
    } catch (e) {
      console.warn(`${y}: ${e instanceof Error ? e.message : e}`);
      last = e;
    }
  }
  throw last;
}

async function pool<T, R>(items: T[], n: number, f: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await f(items[k]);
    }
  }));
  return out;
}

const KIND = / (city|town|township|village|borough|municipality|charter township|CDP|city and borough)$/i;
const norm = (s: string) => s.toLowerCase().replace(/[.']/g, "").replace(/^st /, "saint ");
const ALIAS: Record<string, { place?: string; county?: string; cousub?: string }> = {
  "Louisville|KY": { place: "Louisville/Jefferson County metro government (balance)" },
  "Lexington|KY": { place: "Lexington-Fayette urban county" },
  "Nashville|TN": { place: "Nashville-Davidson metropolitan government (balance)" },
  "Augusta|GA": { place: "Augusta-Richmond County consolidated government (balance)" },
  "Boise|ID": { place: "Boise City city" },
  "Indianapolis|IN": { place: "Indianapolis city (balance)" },
  "Juneau|AK": { place: "Juneau city and borough" },
  "Honolulu|HI": { place: "Urban Honolulu CDP" },
  "Manhattan|NY": { county: "New York County" },
  "Brooklyn|NY": { county: "Kings County" },
  "Queens|NY": { county: "Queens County" },
  "Bronx|NY": { county: "Bronx County" },
  "Staten Island|NY": { county: "Richmond County" },
  "Arlington|VA": { county: "Arlington County" },
  // New Jersey townships: county subdivisions, not places.
  "Edison|NJ": { cousub: "Edison township" },
  "Cherry Hill|NJ": { cousub: "Cherry Hill township" },
};
const SKIP = new Set(["Tri-Cities|WA"]);

type Acs = Record<string, number | null>;
const num = (s: string | undefined) => {
  const n = Number(s);
  // ACS marks a missing or suppressed estimate with large negative codes.
  return s == null || s === "" || !Number.isFinite(n) || n < 0 ? null : n;
};
const share = (part: number | null, whole: number | null) => (part != null && whole ? Math.round((part / whole) * 1000) / 1000 : null);

function readGaz(file: string): Map<string, { lat: number; lng: number }> {
  const lines = readFileSync(join(gazDir, file), "utf8").trim().split(/\r?\n/);
  const head = lines[0].split("\t").map((h) => h.trim());
  const [iG, iLat, iLng] = ["GEOID", "INTPTLAT", "INTPTLONG"].map((h) => {
    const i = head.indexOf(h);
    if (i < 0) throw new Error(`${file} has no ${h} column`);
    return i;
  });
  const m = new Map<string, { lat: number; lng: number }>();
  for (const l of lines.slice(1)) {
    const c = l.split("\t").map((x) => x.trim());
    m.set(c[iG], { lat: Number(c[iLat]), lng: Number(c[iLng]) });
  }
  return m;
}

async function main() {
  const gazPlace = readGaz("2024_Gaz_place_national.txt");
  const gazCounty = readGaz("2024_Gaz_counties_national.txt");
  const gazCousub = readGaz("2024_Gaz_cousubs_national.txt");
  // State postal code → FIPS, from the county file's GEOIDs.
  const usps = new Map<string, string>();
  for (const l of readFileSync(join(gazDir, "2024_Gaz_counties_national.txt"), "utf8").trim().split(/\r?\n/).slice(1)) {
    const c = l.split("\t");
    usps.set(c[0].trim(), c[1].trim().slice(0, 2));
  }
  const fipsOf = (st: string) => {
    const f = usps.get(st);
    if (!f) throw new Error(`no FIPS code for ${st}`);
    return f;
  };

  const acs = await firstYear(ACS_YEARS, async (y) => {
    const vars = (await (await fetch(`https://api.census.gov/data/${y}/acs/acs5/variables.json`)).json()) as { variables: Record<string, { label: string }> };
    for (const [v, re] of Object.entries(LABELS)) if (!re.test(vars.variables[v]?.label ?? "")) throw new Error(`ACS ${y} ${v} is "${vars.variables[v]?.label}", not ${re}`);
    const table = async (geo: string, within = "state:*") => {
      const rows = await get(`https://api.census.gov/data/${y}/acs/acs5?get=NAME,${ACS_VARS.join(",")}&for=${geo}&in=${within}`);
      const head = rows[0];
      return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])) as Record<string, string>);
    };
    // County subdivisions only for the states an alias needs them in.
    const cousubStates = [...new Set(Object.entries(ALIAS).filter(([, a]) => a.cousub).map(([k]) => k.split("|")[1]))];
    const cousubs = (await Promise.all(cousubStates.map((st) => table("county%20subdivision:*", `state:${fipsOf(st)}%20county:*`)))).flat();
    return { places: await table("place:*"), counties: await table("county:*"), cousubs };
  });
  console.log(`ACS 5-year ${acs.year}: ${acs.data.places.length} places, ${acs.data.counties.length} counties`);

  // Places by state FIPS + name; both readings of a name, as in the population script.
  const byName = new Map<string, Record<string, string>>();
  const placeExact = new Map<string, Record<string, string>>();
  for (const p of acs.data.places) {
    const name = p.NAME.slice(0, p.NAME.lastIndexOf(", "));
    placeExact.set(`${name}|${p.state}`, p);
    for (const n of new Set([name.replace(KIND, ""), name])) {
      const key = `${norm(n)}|${p.state}`;
      const hit = byName.get(key);
      // An incorporated place beats a CDP of the same name.
      if (!hit || (/ CDP, /.test(hit.NAME) && !/ CDP, /.test(p.NAME))) byName.set(key, p);
    }
  }
  const countyExact = new Map(acs.data.counties.map((c) => [`${c.NAME.slice(0, c.NAME.lastIndexOf(", "))}|${c.state}`, c]));
  const countyName = new Map(acs.data.counties.map((c) => [`${c.state}${c.county}`, c.NAME.slice(0, c.NAME.lastIndexOf(", "))]));

  const cbp = await firstYear(CBP_YEARS, async (y) => {
    const out = new Map<string, Record<string, number>>();
    for (const naics of Object.values(CENSUS_NAICS)) {
      const rows = await get(`https://api.census.gov/data/${y}/cbp?get=ESTAB&for=county:*&NAICS2017=${naics}`);
      const h = rows[0];
      const [iE, iS, iC] = [h.indexOf("ESTAB"), h.indexOf("state"), h.indexOf("county")];
      for (const r of rows.slice(1)) {
        const k = `${r[iS]}${r[iC]}`;
        const o = out.get(k) ?? {};
        const n = num(r[iE]);
        if (n != null) o[naics] = n;
        out.set(k, o);
      }
    }
    return out;
  });
  console.log(`County Business Patterns ${cbp.year}: ${cbp.data.size} counties`);

  type Hit = { slug: string; row: Record<string, string>; county: string | null; geo: { lat: number; lng: number } | null };
  const matched: Array<Hit | null> = await pool(CITY_COST_INDEX, 8, async (r) => {
    const slug = `${slugify(r.city)}-${r.state.toLowerCase()}`;
    if (SKIP.has(`${r.city}|${r.state}`)) return null;
    const fips = usps.get(r.state);
    if (!fips) return null;
    const alias = ALIAS[`${r.city}|${r.state}`];
    if (alias?.cousub) {
      const row = acs.data.cousubs.find((c) => c.state === fips && c.NAME.startsWith(`${alias.cousub}, `));
      if (!row) return null;
      const geoid = `${row.state}${row.county}${row["county subdivision"]}`;
      return { slug, row, county: `${row.state}${row.county}`, geo: gazCousub.get(geoid) ?? null };
    }
    if (alias?.county) {
      const row = countyExact.get(`${alias.county}|${fips}`);
      if (!row) return null;
      return { slug, row, county: `${row.state}${row.county}`, geo: gazCounty.get(`${row.state}${row.county}`) ?? null };
    }
    const row = alias?.place ? placeExact.get(`${alias.place}|${fips}`) : byName.get(`${norm(r.city)}|${fips}`);
    if (!row) return null;
    // The county holding most of the place's homes.
    const parts = await get(`https://api.census.gov/data/${acs.year}/acs/acs5?get=B25001_001E&for=county%20(or%20part):*&in=state:${row.state}%20place:${row.place}`);
    const h = parts[0];
    const best = parts.slice(1).sort((a, b) => (num(b[h.indexOf("B25001_001E")]) ?? 0) - (num(a[h.indexOf("B25001_001E")]) ?? 0))[0];
    const county = best ? `${row.state}${best[h.indexOf("county (or part)")]}` : null;
    return { slug, row, county, geo: gazPlace.get(`${row.state}${row.place}`) ?? null };
  });

  const rows: string[] = [];
  const missing: string[] = [];
  CITY_COST_INDEX.forEach((r, i) => {
    const m = matched[i];
    const slug = `${slugify(r.city)}-${r.state.toLowerCase()}`;
    if (!m) return void missing.push(slug);
    const a: Acs = Object.fromEntries(ACS_VARS.map((v) => [v, num(m.row[v])]));
    const built = a.B25034_001E;
    const pre1980 = ["007", "008", "009", "010", "011"].reduce<number | null>((s, k) => (s == null || a[`B25034_${k}E`] == null ? null : s + (a[`B25034_${k}E`] as number)), 0);
    const heat = a.B25040_001E;
    const isBorough = !!ALIAS[`${r.city}|${r.state}`]?.county;
    const rec = {
      name: m.row.NAME.slice(0, m.row.NAME.lastIndexOf(", ")),
      yearBuilt: a.B25035_001E && a.B25035_001E > 1900 ? a.B25035_001E : null,
      pre1980: share(pre1980, built),
      heat: heat ? { gas: share(a.B25040_002E, heat), electric: share(a.B25040_004E, heat), oil: share(a.B25040_005E, heat), propane: share(a.B25040_003E, heat) } : null,
      singleFamily: share(a.B25024_002E, a.B25024_001E),
      homeValue: a.B25077_001E,
      owners: share(a.B25003_002E, a.B25003_001E),
      lat: m.geo ? Math.round(m.geo.lat * 1e4) / 1e4 : null,
      lng: m.geo ? Math.round(m.geo.lng * 1e4) / 1e4 : null,
      // A borough is its own county; its sentence names it as the borough, so no county is written.
      county: m.county && !isBorough ? (countyName.get(m.county) ?? null) : null,
      contractors: m.county ? (cbp.data.get(m.county) ?? {}) : {},
    };
    rows.push(`  ${JSON.stringify(slug)}: ${JSON.stringify(rec)},`);
  });

  const file = `// GENERATED by scripts/seo-city-census.ts — do not edit by hand.
// Census Bureau: American Community Survey ${acs.year - 4}–${acs.year} 5-year estimates (B25035,
// B25034, B25040, B25024, B25077, B25003), County Business Patterns ${cbp.year}
// (establishments), 2024 Gazetteer coordinates. Shares are 0–1 of the table's
// total; a city the Census has no row for has no entry. Read by lib/seo/census.

import type { CityCensus } from "./census";

export const CENSUS_ACS_YEARS = "${acs.year - 4}–${acs.year}";
export const CENSUS_CBP_YEAR = ${cbp.year};

export const CITY_CENSUS: Record<string, CityCensus> = {
${rows.join("\n")}
};
`;
  writeFileSync(join(ROOT, "src/lib/seo/city-census.data.ts"), file);
  console.log(`wrote ${rows.length} of ${CITY_COST_INDEX.length} cities; no match: ${missing.length ? missing.join(", ") : "none"}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
