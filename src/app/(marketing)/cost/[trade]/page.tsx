// /cost/<work> — every city's guide for one work (2026-10-26): the typical
// job's average in each city, by state, linking to the city's page. Built
// at build time from lib/seo; unknown works are a 404.

import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SEO_TRADES, seoTrade } from "@/lib/seo/trades";
import { SEO_CITIES } from "@/lib/seo/cities";
import { SEO_PHRASES } from "@/lib/seo/keywords";
import { SEO_UPDATED, SEO_YEAR, tradeIndexRows, typicalAvg } from "@/lib/seo/content";
import { breadcrumbLd, ldJson } from "@/lib/seo/schema";
import { usd } from "@/lib/seo/calc";
import { SITE_URL } from "@/lib/siteUrl";
import { CostChrome } from "@/components/seo-cost/cost-chrome";
import s from "@/components/seo-cost/cost.module.css";

export const revalidate = 86400;
export const dynamicParams = false;

type Params = { trade: string };

export function generateStaticParams(): Params[] {
  return SEO_TRADES.map((t) => ({ trade: t.slug }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const trade = seoTrade((await params).trade);
  if (!trade) return {};
  const url = `${SITE_URL}/cost/${trade.slug}`;
  const title = `${trade.name} Cost by City (${SEO_YEAR}) | JobFlex`;
  const description = `${trade.name} prices in ${SEO_CITIES.length} U.S. cities: the average for ${trade.size.phrase(trade.size.typical.toLocaleString("en-US"))}, by material and size, from JobFlex's contractor price book.`;
  return { title, description, alternates: { canonical: url }, openGraph: { type: "website", url, siteName: "JobFlex", title, description } };
}

export default async function CostTradePage({ params }: { params: Promise<Params> }) {
  const trade = seoTrade((await params).trade);
  if (!trade) notFound();
  const ph = SEO_PHRASES[trade.slug];
  const states = tradeIndexRows(trade);
  const nat = typicalAvg(trade, null);
  const sorted = [...SEO_CITIES].sort((a, b) => a.factor - b.factor);
  return (
    <CostChrome>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson(breadcrumbLd([{ name: "Cost guides", path: "/cost" }, { name: `${trade.name} cost`, path: `/cost/${trade.slug}` }])) }} />
      <nav className={s.crumbs} aria-label="Breadcrumb">
        <ol>
          <li>
            <Link href="/cost" prefetch={false}>
              Cost guides
            </Link>
          </li>
          <li aria-current="page">{trade.name}</li>
        </ol>
      </nav>
      <div className={s.head}>
        <h1 className={s.title}>
          {trade.name} Cost by City ({SEO_YEAR})
        </h1>
        <p className={s.updated}>Updated {SEO_UPDATED} · {SEO_CITIES.length} cities</p>
        <div className={s.lede}>
          <p>
            {ph.ask}? At the U.S. average, {trade.size.phrase(trade.size.typical.toLocaleString("en-US"))} runs about {usd(nat)}. Local labor and material prices move that from {usd(typicalAvg(trade, sorted[0]))} in {sorted[0].place} to {usd(typicalAvg(trade, sorted[sorted.length - 1]))} in {sorted[sorted.length - 1].place}. Pick your city for its own prices by {ph.materialNoun} and size, a calculator and free local quotes.
          </p>
        </div>
      </div>
      <div className={s.states}>
        {states.map((st) => (
          <section className={s.card} key={st.state} aria-label={st.stateName}>
            <div className={s.cardHead}>
              <h2 className={s.h2}>{st.stateName}</h2>
            </div>
            <div className={s.cardBody}>
              <ul className={`${s.links} ${s.cols}`}>
                {st.rows.map((r) => (
                  <li key={r.href}>
                    <a href={r.href}>
                      {r.label}
                      <span>{r.avg}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ))}
      </div>
    </CostChrome>
  );
}
