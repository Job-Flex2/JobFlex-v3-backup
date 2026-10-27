# Cost guides, phase 2: local facts from the Census

Written 2026-10-26 for the owner. Nothing here is built yet. Phase 1 is the
cost guides (`/cost/<work>/<city>`, 6 works × 306 cities); see
`src/lib/seo/` and `scripts/seo-audit.ts`.

## The problem it solves

A guide's text changes from one city to the next only where its data
changes. Today that data is the city's cost index, its labor and material
indices, and the state's facts (sales tax, frost depth, deck code, design
temperatures, lumber). Two neighbouring cities in the same state usually share
all the state facts. Their indices are often close, and sometimes identical.

- The audit measures how much of a page's text differs from the same work's
  page for the neighbouring city. The median is about 12% (word LCS); the
  owner's bar is 25%.
- 52 cities fall into 18 groups whose data is identical (the King County
  cities, Phoenix / Scottsdale / Mesa, Plano / Frisco, and others). Since
  2026-10-26 the 34 non-head cities name their group's head as canonical,
  e.g. Bellevue → Seattle (`canonicalCity` in `src/lib/seo/cities.ts`).

More words of the same kind won't fix this. Each city needs facts of its own
that a homeowner actually cares about. The Census Bureau publishes those per
place, free, and they differ between neighbouring cities.

## What to take

All of it is public and free. ACS needs a free API key
(https://api.census.gov/data/key_signup.html), stored as `CENSUS_API_KEY` and
read only by a generator script. Pages never call the Census at request
time: a script writes a data file, the same way
`scripts/seo-city-population.ts` writes `city-population.data.ts`.

| Data | Census source | Used for |
|---|---|---|
| Population (done) | Population Estimates, SUB-EST2024 | Choosing the 60 prebuilt cities. Could also say "the state's 3rd-largest city". |
| Year built: median, and share built before 1980 / before 1978 | ACS 5-year B25035, B25034 | Roofing and siding: "half of Dallas's homes were built before 1985, so many roofs and walls are on their second or third cover". Painting: the share of homes old enough for EPA lead-safe rules. That turns the existing "Home built before 1978" extra into a local fact. |
| Heating fuel: utility gas, electricity, fuel oil, propane | ACS B25040 | HVAC: "62% of homes in Minneapolis heat with gas", which says whether the furnace or the heat-pump row is the usual one there. |
| Units in structure: share of single-family detached | ACS B25024 | Fence, deck, roof and siding: how many homes in the city have a yard, a roof and walls of their own. |
| Median home value | ACS B25077 | Scale: "a new roof here is about 4% of the median home's value". |
| Owner-occupied share | ACS B25003 | Context for who buys this work. |
| Coordinates and land area | Gazetteer, 2024 Places file | Real "nearby cities" links by distance. Today the neighbours are taken from the index table's order, which mostly follows metros. |
| County | Place-to-county relationship file | Naming the county ("in King County"). That is where permits and the county wage adjustment come from. |
| New homes permitted per year | Building Permits Survey, place level | Local building activity: "Frisco permitted 4,100 new homes in 2024". |
| Contractor establishments by trade | County Business Patterns, NAICS 238160 roofing, 238170 siding, 238220 HVAC, 238320 painting, 238990 other specialty (fence, deck) | "About 140 roofing contractors work in Dallas County." This is the one fact that is specific to the trade and the place at once. |

Coverage notes:

- ACS and the Gazetteer cover census-designated places. That includes the 12
  cities that SUB-EST does not have: Bethesda, Silver Spring, Metairie,
  Reston, Ashburn, Woodbridge, The Woodlands, King of Prussia, Hilo, Kahului,
  and Honolulu as "Urban Honolulu".
- The New York boroughs are counties in every Census product.
- Tri-Cities, WA is three places (Kennewick, Richland and Pasco), each of
  which already has its own row. Its own row would be a sum or be left out.
- County Business Patterns is by county, so cities in one county share it.
  That is fine, because the other rows differ.

## What it gives

- **Distinct text.** Each guide gains about 5–8 sentences, roughly 120–180
  words, built on numbers that differ between neighbours, plus the
  trade-specific fact in its own block. By rough estimate this moves the
  neighbour difference from about 12% to the 20–30% range. The audit
  (`npx tsx scripts/seo-audit.ts <dist> --base <server>`) measures it before
  anyone relies on the estimate.
- **Fewer duplicates.** Cities that share a cost index don't share a year
  built, a heating mix or a home value. Once the data key in `canonicalCity`
  includes those fields, most of the 34 canonicalized cities become their own
  canonical again, and the head-city rule only covers what is still
  identical.
- **Better links.** "Nearby cities" by distance, and county pages if they are
  ever wanted.
- **Answers people search for.** For example "how old are the homes in X"
  (roof and siding replacement timing), "do homes in X use gas or electric
  heat" (HVAC), and lead paint in older homes (painting).

## What it does not do

- It doesn't change any price. Prices stay with the price book × the city
  index, as calibrated against the cited sources.
- It doesn't make up facts. A city the Census has no row for keeps its
  sentence out, the same rule as phase 1.

## Work

1. Get a key, then write `scripts/seo-city-census.ts`. It writes
   `src/lib/seo/city-census.data.ts`: one row per city, with the vintage
   named in the header.
2. Add the sentences to `src/lib/seo/content.ts`, each guarded on its field.
3. Add the new fields to the data key in `canonicalCity`.
4. Rebuild and rerun the audit, then report the neighbour-difference numbers
   before and after.

This is about one working day, with no data-layer or schema change.
