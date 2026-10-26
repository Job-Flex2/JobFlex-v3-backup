// Where a cost guide's calls to action lead (2026-10-26). Pure, client-safe.
//
// The homeowner's: the one homeowner page (/homeowner), its request started in
// their words for the work and the city (`project`, `place` — the page checks
// the place against the guides' cities) and the guide named as the request's
// source (`src`, "seo:<work>:<city>", kept with the lead — LeadSource).
// The contractor's: the trade's landing with the visit's utm_* (the landing
// already reads and keeps them).

type Ref = { slug: string; landingKey: string };
type Place = { slug: string; place: string };

export const seoSource = (trade: Ref, city: Place) => `seo:${trade.slug}:${city.slug}`;

export function homeownerHref(trade: Ref, city: Place): string {
  const q = new URLSearchParams({ project: trade.landingKey, place: city.place, src: seoSource(trade, city) });
  return `/homeowner?${q.toString()}`;
}

export function proHref(trade: Ref, city: Place): string {
  const q = new URLSearchParams({ industry: trade.landingKey, utm_source: "seo", utm_medium: "cost-page", utm_campaign: `${trade.slug}-${city.slug}` });
  return `/?${q.toString()}`;
}

/** The cost guide's source tag, when a request carries a well-formed one. */
export const SEO_SOURCE_RE = /^seo:[a-z0-9-]{2,40}:[a-z0-9-]{2,60}$/;
