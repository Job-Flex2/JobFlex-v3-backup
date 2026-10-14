// Design conditions for an address: the county's 1% cooling and 99% heating
// temperatures from the ENERGY STAR table, the climate's moisture class and
// the airflow it wants. Pure; the server resolves the county, this resolves
// the numbers.

import type { DesignConditions } from "./types";
import { DESIGN_TEMPS, DESIGN_TEMPS_SOURCE, DESIGN_TEMPS_VERIFIED_ON } from "./data/designTemps";
import { GRAINS, humidityClass } from "./data/defaults";

interface CountyRow {
  county: string;
  coolingF: number;
  heatingF: number;
  hddCddRatio: number;
  approx: boolean;
}

const cache = new Map<string, CountyRow[]>();

function rowsFor(state: string): CountyRow[] {
  const st = state.toUpperCase();
  const hit = cache.get(st);
  if (hit) return hit;
  const enc = DESIGN_TEMPS[st];
  const rows: CountyRow[] = enc
    ? enc.split(";").map((r) => {
        const [county, c, h, ratio, flag] = r.split("|");
        return { county, coolingF: Number(c), heatingF: Number(h), hddCddRatio: Number(ratio), approx: flag === "~" };
      })
    : [];
  cache.set(st, rows);
  return rows;
}

/** "Miami-Dade County", "Doña Ana", "Anchorage Municipality" all reduce to a
 *  comparable key. "City" is KEPT: Virginia's Fairfax and Fairfax City, and
 *  St. Louis and St. Louis City, are different places with their own rows. */
export function countyKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\bsaint\b/g, "st")
    .replace(/\bst\.\s*/g, "st ")
    .replace(/\b(county|parish|borough|census area|municipality|municipio|city and borough)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export interface DesignLookup {
  conditions: DesignConditions;
  /** How the county was matched: exact, fuzzy, state median (no county), or none. */
  match: "county" | "fuzzy" | "state" | "none";
  /** True for the five counties whose values come from their neighbours. */
  approx: boolean;
}

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/** Design conditions for a state and county; falls back to the state median
 *  when the county is unknown, and to a national default when the state is. */
export function designConditionsFor(state: string, county: string | undefined | null, elevationFt = 0): DesignLookup {
  const st = state.toUpperCase();
  const rows = rowsFor(st);
  const humidity = humidityClass(st, county);
  const base = { state: st, humidity, grainsDiff: GRAINS[humidity], elevationFt: Math.round(elevationFt), source: DESIGN_TEMPS_SOURCE, verifiedOn: DESIGN_TEMPS_VERIFIED_ON };
  if (!rows.length) {
    return {
      match: "none",
      approx: true,
      conditions: { ...base, county: county ?? "", coolingF: 92, heatingF: 15, hddCddRatio: 1.5, source: "national default — state not in the table" },
    };
  }
  const want = county ? countyKey(county) : "";
  let row: CountyRow | undefined;
  let match: DesignLookup["match"] = "state";
  if (want) {
    row = rows.find((r) => countyKey(r.county) === want);
    if (row) match = "county";
    else {
      // Whole-word prefix only: "st louis" ↔ "st louis city" yes, "lee" ↔ "leelanau" no.
      row = rows.find((r) => { const k = countyKey(r.county); return k.startsWith(want + " ") || want.startsWith(k + " "); });
      if (row) match = "fuzzy";
    }
  }
  if (!row) {
    // A territory has one "" row; a state without a county match takes its median.
    const single = rows.length === 1 ? rows[0] : null;
    if (single) return { match: "county", approx: single.approx, conditions: { ...base, county: single.county || st, coolingF: single.coolingF, heatingF: single.heatingF, hddCddRatio: single.hddCddRatio } };
    return {
      match: "state",
      approx: true,
      conditions: {
        ...base,
        county: county ?? "",
        coolingF: median(rows.map((r) => r.coolingF)),
        heatingF: median(rows.map((r) => r.heatingF)),
        hddCddRatio: median(rows.map((r) => r.hddCddRatio)),
        source: `${DESIGN_TEMPS_SOURCE} — state median, county not matched`,
      },
    };
  }
  // A county whose limit comes from a mountain or desert station far from the
  // houses takes the metro station the houses actually sit under.
  const metro = METRO_STATION[st]?.[countyKey(row.county)];
  if (metro) {
    return {
      match,
      approx: false,
      conditions: {
        ...base,
        county: row.county,
        coolingF: metro.coolingF,
        heatingF: metro.heatingF,
        hddCddRatio: row.hddCddRatio,
        source: `${metro.station} — ASHRAE 1% / 99% design conditions for the metro station (the county limit in the ENERGY STAR guide is ${row.coolingF} °F / ${row.heatingF} °F, taken at ${metro.limitFrom}); ${metro.note}`,
      },
    };
  }
  return {
    match,
    approx: row.approx,
    conditions: {
      ...base,
      county: row.county,
      coolingF: row.coolingF,
      heatingF: row.heatingF,
      hddCddRatio: row.hddCddRatio,
      source: row.approx ? `${DESIGN_TEMPS_SOURCE} — neighbouring counties (this county is cut off in the source)` : DESIGN_TEMPS_SOURCE,
    },
  };
}

/**
 * The ENERGY STAR county limits are the most extreme station within 40 miles
 * of the county's centre — right as a bound, wrong as a design condition
 * where that station is a mountain pass or a desert (review, 2026-09-17:
 * King County's 11 °F is Stampede Pass; Los Angeles County's 14 °F is Mount
 * Baldy). These counties take the ASHRAE 2017 1% / 99% figures for the metro
 * station instead, rounded to the degree. Counties that span a coast and hot
 * inland valleys say so, and the contractor can set the address's own design
 * temperatures on the page.
 */
const METRO_STATION: Record<string, Record<string, { station: string; coolingF: number; heatingF: number; limitFrom: string; note: string }>> = {
  WA: {
    king: { station: "Seattle-Tacoma Intl", coolingF: 84, heatingF: 26, limitFrom: "Stampede Pass", note: "the county's 11 °F limit is a mountain pass; set the address's own figures for the foothills." },
    pierce: { station: "Tacoma Narrows", coolingF: 84, heatingF: 26, limitFrom: "a Cascade station", note: "set the address's own figures for the foothills." },
    snohomish: { station: "Paine Field", coolingF: 82, heatingF: 26, limitFrom: "a Cascade station", note: "set the address's own figures for the foothills." },
  },
  CA: {
    "los angeles": { station: "Los Angeles downtown (USC)", coolingF: 90, heatingF: 43, limitFrom: "Hillcrest / Mount Baldy", note: "the coast runs ~81 °F, the San Fernando Valley ~99 °F — set the address's own figures." },
    "san diego": { station: "San Diego (Miramar / Lindbergh)", coolingF: 88, heatingF: 43, limitFrom: "Borrego / Palomar", note: "the coast runs ~83 °F, the inland valleys ~95 °F — set the address's own figures." },
    "san bernardino": { station: "San Bernardino", coolingF: 104, heatingF: 34, limitFrom: "Baker / Big Bear", note: "the high desert and the mountains differ — set the address's own figures." },
    riverside: { station: "Riverside", coolingF: 101, heatingF: 36, limitFrom: "Palm Desert / Mt San Jacinto", note: "the Coachella Valley runs ~112 °F — set the address's own figures there." },
    // Title 24 climate zone 4's reference city (PG&E zone sheet: winter 99% 34 °F, summer 1% 85 °F); the county limit
    // (97 / 27) is the Diablo Range / Gilroy side (2026-10-14).
    "santa clara": { station: "San Jose (Title 24 climate zone 4)", coolingF: 85, heatingF: 34, limitFrom: "the inland and ridge stations", note: "Gilroy and the Diablo foothills run ~95 °F — set the address's own figures there." },
  },
  AZ: {
    maricopa: { station: "Phoenix Sky Harbor", coolingF: 109, heatingF: 34, limitFrom: "Gila Bend / Harquahala", note: "the metro figures suit the valley." },
    // Tucson Intl: 1% ~104 °F, 99% ~32 °F (the county limit, 109 / 22, is the low desert and the Catalinas) — confirm against the ASHRAE table before a permit (2026-10-14).
    pima: { station: "Tucson Intl", coolingF: 104, heatingF: 32, limitFrom: "Organ Pipe / Mt Lemmon", note: "the metro figures suit the city; Green Valley and Marana are close to them." },
  },
  NV: {
    clark: { station: "Las Vegas (Harry Reid Intl)", coolingF: 107, heatingF: 31, limitFrom: "Willow Beach / Indian Springs", note: "the metro figures suit the valley." },
  },
  MA: {
    suffolk: { station: "Boston Logan", coolingF: 89, heatingF: 9, limitFrom: "an inland station", note: "the metro figures suit the city." },
  },
};

/** Every county the table knows for a state, for a picker. */
export function countiesFor(state: string): string[] {
  return rowsFor(state).map((r) => r.county).filter(Boolean);
}
