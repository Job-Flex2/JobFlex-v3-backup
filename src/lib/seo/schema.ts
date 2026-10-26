// The cost guides' structured data (2026-10-26): breadcrumbs, the FAQ as
// FAQPage, and the work as a Service offered in the city with its price range
// (an AggregateOffer, low to high, USD). Built from the same page model the
// page prints, so the markup never says a number the page does not.

import { SITE_URL } from "@/lib/siteUrl";
import type { CostPage } from "./content";

type Crumb = { name: string; path: string };

export function breadcrumbLd(crumbs: Crumb[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: `${SITE_URL}${c.path}` })),
  };
}

export function costPageLd(p: CostPage) {
  return [
    breadcrumbLd([
      { name: "Cost guides", path: "/cost" },
      { name: `${p.trade.name} cost`, path: `/cost/${p.trade.slug}` },
      { name: p.city.place, path: p.path },
    ]),
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: p.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
    },
    {
      "@context": "https://schema.org",
      "@type": "Service",
      name: `${p.trade.name} in ${p.city.place}`,
      serviceType: p.trade.name,
      description: p.description,
      url: `${SITE_URL}${p.path}`,
      areaServed: { "@type": "City", name: p.city.city, containedInPlace: { "@type": "State", name: p.city.stateName.replace(/^the /, "") } },
      provider: { "@type": "Organization", name: "JobFlex", url: SITE_URL },
      offers: { "@type": "AggregateOffer", priceCurrency: "USD", lowPrice: p.low, highPrice: p.high, offerCount: p.trade.variants.length },
    },
  ];
}

/** A JSON-LD payload as a <script> body: "<" escaped so no string can close the tag. */
export const ldJson = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c");
