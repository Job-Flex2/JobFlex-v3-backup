// A cost-guide city's Census facts (cost guides phase 2, docs/seo-phase-2.md,
// 2026-10-26): the record scripts/seo-city-census.ts writes to
// ./city-census.data, the NAICS code each work's contractors are counted
// under, and the distance between two cities. Plain module, no I/O.

import type { SeoTradeSlug } from "./trades";

export type CityCensus = {
  /** The Census name of the matched place or county ("Dallas city", "Kings County"). */
  name: string;
  /** Median year structure built (B25035). */
  yearBuilt: number | null;
  /** Share of homes built before 1980 (B25034). The table's bins do not split at 1978. */
  pre1980: number | null;
  /** Shares of occupied homes by heating fuel (B25040). */
  heat: { gas: number | null; electric: number | null; oil: number | null; propane: number | null } | null;
  /** Share of homes that are single-family detached (B25024). */
  singleFamily: number | null;
  /** Median value of owner-occupied homes, dollars (B25077). */
  homeValue: number | null;
  /** Share of occupied homes that are owner-occupied (B25003). */
  owners: number | null;
  lat: number | null;
  lng: number | null;
  /** The county holding most of the place's homes ("King County"); null for a borough, which is a county itself. */
  county: string | null;
  /** County Business Patterns establishments in that county, by NAICS code. */
  contractors: Record<string, number>;
};

/** The County Business Patterns class each work's contractors are counted in. */
export const CENSUS_NAICS: Record<SeoTradeSlug, string> = {
  "roof-replacement": "238160",
  "siding-installation": "238170",
  "hvac-replacement": "238220",
  "house-painting": "238320",
  "fence-installation": "238990",
  "deck-building": "238990",
};

/** How the Census names the class, in a sentence ("roofing contractors"). */
export const CENSUS_NAICS_WORDS: Record<string, string> = {
  "238160": "roofing contractors",
  "238170": "siding contractors",
  "238220": "plumbing, heating and air-conditioning contractors",
  "238320": "painting and wall-covering contractors",
  "238990": "\"other specialty trade\" contractors",
};

/** Great-circle distance in miles. */
export function milesBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 3958.8 * Math.asin(Math.sqrt(h));
}
