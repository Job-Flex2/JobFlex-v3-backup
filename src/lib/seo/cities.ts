// The cities of the cost guides (/cost/<work>/<city>, 2026-10-26): every row
// of the construction cost index (lib/estimate/location-index-data), with its
// URL slug, its state and the per-city indices the research table printed
// (./city-indices.data). Plain module, no I/O.

import { CITY_COST_INDEX } from "@/lib/estimate/location-index-data";
import { STATE_COST_INDEX } from "@/lib/estimate/trade-knowledge";
import { stateDisplayName } from "@/lib/pricing/salesTax";
import { CITY_INDICES, type CityIndices } from "./city-indices.data";

export type SeoCity = {
  slug: string;
  city: string;
  state: string;
  stateName: string;
  /** "Dallas, TX". */
  place: string;
  /** The composite construction cost index, 1.00 = U.S. average. */
  factor: number;
  /** The state's employment-weighted index — the fallback for its unlisted towns. */
  stateFactor: number | null;
  indices: CityIndices | null;
  /** Position in the index table; rows there are grouped by metro. */
  order: number;
};

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** salesTax's names are upper-case keys ("NEW YORK"). */
const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

const indicesByKey = new Map(CITY_INDICES.map((r) => [`${r.city}|${r.state}`, r]));

export const SEO_CITIES: SeoCity[] = CITY_COST_INDEX.map((r, order) => ({
  slug: `${slugify(r.city)}-${r.state.toLowerCase()}`,
  city: r.city,
  state: r.state,
  stateName: r.state === "DC" ? "the District of Columbia" : titleCase(stateDisplayName(r.state)),
  place: `${r.city}, ${r.state}`,
  factor: r.factor,
  stateFactor: STATE_COST_INDEX[r.state] ?? null,
  indices: indicesByKey.get(`${r.city}|${r.state}`) ?? null,
  order,
}));

const bySlug = new Map<string, SeoCity>();
for (const c of SEO_CITIES) {
  if (bySlug.has(c.slug)) throw new Error(`Two cost-guide cities share the slug ${c.slug}.`);
  bySlug.set(c.slug, c);
}

export function seoCity(slug: string): SeoCity | null {
  return bySlug.get(slug) ?? null;
}

/** A listed city named in free text ("Dallas, TX") — the homeowner page's prefill check. */
export function seoCityByPlace(place: string | null | undefined): SeoCity | null {
  const want = (place ?? "").trim().toLowerCase();
  return SEO_CITIES.find((c) => c.place.toLowerCase() === want) ?? null;
}

export function citiesInState(state: string): SeoCity[] {
  return SEO_CITIES.filter((c) => c.state === state);
}

/**
 * Other cities of the same state, the closest rows of the index table first.
 * The table lists a metro's cities together (Seattle, Bellevue, Kirkland …),
 * so the neighbours in it are mostly the same metro; there are no coordinates
 * in the data, so this is never called "nearest".
 */
export function sameStateCities(city: SeoCity, limit = 8): SeoCity[] {
  return citiesInState(city.state)
    .filter((c) => c.slug !== city.slug)
    .sort((a, b) => Math.abs(a.order - city.order) - Math.abs(b.order - city.order) || a.order - b.order)
    .slice(0, limit);
}

/** 1 = the dearest. Ties share a rank ("2nd of 13", twice). */
export function rankIn(list: SeoCity[], city: SeoCity): { rank: number; of: number } {
  return { rank: 1 + list.filter((c) => c.factor > city.factor + 1e-9).length, of: list.length };
}
