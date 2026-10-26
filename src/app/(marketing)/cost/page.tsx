// /cost — the cost guides' front page (2026-10-26): every work JobFlex prices
// for homeowners, its U.S. average and a way into its cities. Static.

import type { Metadata } from "next";
import { SEO_TRADES } from "@/lib/seo/trades";
import { SEO_CITIES } from "@/lib/seo/cities";
import { SEO_PHRASES } from "@/lib/seo/keywords";
import { SEO_UPDATED, SEO_YEAR, typicalAvg } from "@/lib/seo/content";
import { breadcrumbLd, ldJson } from "@/lib/seo/schema";
import { usd } from "@/lib/seo/calc";
import { SITE_URL } from "@/lib/siteUrl";
import { CostChrome } from "@/components/seo-cost/cost-chrome";
import s from "@/components/seo-cost/cost.module.css";

export const revalidate = 86400;

const title = `Home Improvement Cost Guides (${SEO_YEAR}) | JobFlex`;
const description = `What roofing, fencing, HVAC, decks, siding and painting cost in ${SEO_CITIES.length} U.S. cities — local averages by material and size, from JobFlex's contractor price book.`;

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: `${SITE_URL}/cost` },
  openGraph: { type: "website", url: `${SITE_URL}/cost`, siteName: "JobFlex", title, description },
};

// A few large cities as ways in, the rest are on each work's page.
const FEATURED = ["new-york-ny", "los-angeles-ca", "chicago-il", "houston-tx", "phoenix-az", "dallas-tx", "seattle-wa", "atlanta-ga"];

export default function CostIndexPage() {
  const featured = FEATURED.map((slug) => SEO_CITIES.find((c) => c.slug === slug)).filter((c): c is (typeof SEO_CITIES)[number] => Boolean(c));
  return (
    <CostChrome>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson(breadcrumbLd([{ name: "Cost guides", path: "/cost" }])) }} />
      <div className={s.head}>
        <h1 className={s.title}>Home Improvement Cost Guides ({SEO_YEAR})</h1>
        <p className={s.updated}>Updated {SEO_UPDATED} · {SEO_TRADES.length} projects · {SEO_CITIES.length} cities</p>
        <div className={s.lede}>
          <p>
            What a project costs depends on where you live. These guides price each job step by step from JobFlex&apos;s contractor price book, then adjust it to your city&apos;s construction labor and material costs. Every city page has a calculator and a way to get free quotes from local contractors.
          </p>
        </div>
      </div>
      <div className={s.grid}>
        {SEO_TRADES.map((t) => (
          <section className={s.card} key={t.slug} aria-label={t.name}>
            <div className={s.cardHead}>
              <h2 className={s.h2}>
                <a href={`/cost/${t.slug}`}>{t.name} cost</a>
              </h2>
            </div>
            <div className={s.cardBody}>
              <p>
                {SEO_PHRASES[t.slug].ask}? About {usd(typicalAvg(t, null))} at the U.S. average for {t.size.phrase(t.size.typical.toLocaleString("en-US"))}.
              </p>
              <ul className={`${s.links} ${s.cols}`}>
                {featured.map((c) => (
                  <li key={c.slug}>
                    <a href={`/cost/${t.slug}/${c.slug}`}>
                      {c.place}
                      <span>{usd(typicalAvg(t, c))}</span>
                    </a>
                  </li>
                ))}
              </ul>
              <a href={`/cost/${t.slug}`}>All {SEO_CITIES.length} cities →</a>
            </div>
          </section>
        ))}
      </div>
    </CostChrome>
  );
}
