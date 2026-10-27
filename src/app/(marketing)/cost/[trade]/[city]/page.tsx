// /cost/<work>/<city> — a public cost guide (2026-10-26): what a work costs in
// one city, for the homeowner who searched it. Every number comes from
// lib/seo (the price book times the city's index), computed on the server;
// nothing here reads the database or calls an outside service. The 60
// largest cities are built at deploy for every work; any other listed city
// is rendered on its first visit and kept (owner, 2026-10-26). Refreshed
// daily; a work or city that is not listed is a 404.

import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SEO_TRADES, seoTrade } from "@/lib/seo/trades";
import { SEO_PREBUILT_CITIES, canonicalCity, seoCity } from "@/lib/seo/cities";
import { costPage, costPath, SEO_UPDATED } from "@/lib/seo/content";
import { SEO_PHRASES } from "@/lib/seo/keywords";
import { costPageLd, ldJson } from "@/lib/seo/schema";
import { homeownerHref, proHref } from "@/lib/seo/links";
import { SITE_URL } from "@/lib/siteUrl";
import { bareModel } from "@/lib/seo/calc";
import { CostChrome } from "@/components/seo-cost/cost-chrome";
import { CostCalculator } from "@/components/seo-cost/cost-calculator";
import { CostTrack } from "@/components/seo-cost/cost-track";
import s from "@/components/seo-cost/cost.module.css";

export const revalidate = 86400;
// The rest of the listed cities render on request; load() 404s anything else.
export const dynamicParams = true;

type Params = { trade: string; city: string };

export function generateStaticParams(): Params[] {
  return SEO_TRADES.flatMap((t) => SEO_PREBUILT_CITIES.map((c) => ({ trade: t.slug, city: c.slug })));
}

function load(params: Params) {
  const trade = seoTrade(params.trade);
  const city = seoCity(params.city);
  return trade && city ? costPage(trade, city) : null;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const p = load(await params);
  if (!p) return {};
  const url = `${SITE_URL}${p.path}`;
  // A city whose data is another's (canonicalCity) names that city's guide.
  const canonical = `${SITE_URL}${costPath(p.trade, canonicalCity(p.city))}`;
  return {
    title: p.title,
    description: p.description,
    alternates: { canonical },
    openGraph: { type: "article", url, siteName: "JobFlex", title: p.h1, description: p.description },
    twitter: { card: "summary", title: p.h1, description: p.description },
  };
}

export default async function CostCityPage({ params }: { params: Promise<Params> }) {
  const p = load(await params);
  if (!p) notFound();
  const { trade, city } = p;
  const ph = SEO_PHRASES[trade.slug];
  const quotes = homeownerHref(trade, city);
  const pro = proHref(trade, city);

  return (
    <CostChrome
      footPro={
        <>
          Are you a {trade.pro}?{" "}
          <a href={pro} data-seo-cta="pro_footer">
            Price jobs like this in 60 seconds
          </a>
        </>
      }
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson(costPageLd(p)) }} />
      <CostTrack trade={trade.slug} city={city.slug} />

      <nav className={s.crumbs} aria-label="Breadcrumb">
        <ol>
          <li>
            <Link href="/cost" prefetch={false}>
              Cost guides
            </Link>
          </li>
          <li>
            <a href={`/cost/${trade.slug}`}>{trade.name}</a>
          </li>
          <li aria-current="page">{city.place}</li>
        </ol>
      </nav>

      <div className={s.head}>
        <h1 className={s.title}>{p.h1}</h1>
        <p className={s.updated}>
          Updated {SEO_UPDATED} · {city.place} · index {city.factor.toFixed(2)}
        </p>
        <section className={s.answer} aria-label={`Average ${trade.lower} cost in ${city.place}`}>
          <span className={s.annot}>Average cost in {city.city}</span>
          <strong className={s.answerAvg}>{p.answer.avg}</strong>
          <span className={s.answerRange}>{p.answer.range}</span>
          <span className={s.answerPer}>{p.answer.per}</span>
          {p.answer.alt ? <span className={s.answerPer}>{p.answer.alt}</span> : null}
          <div className={s.answerMeta}>
            <span>
              <b>Priced for:</b> {p.answer.basis}
            </span>
            <span>
              <b>Split:</b> {p.answer.split}
            </span>
          </div>
          <a className={s.jump} href="#calculator">
            Price your own job ↓
          </a>
          {/* The live price for YOUR address (2026-10-27, /price): the roof reads itself from the sky; the others start at the row. */}
          <a className={s.jump} href={trade.slug === "roof-replacement" ? `/price/roof?city=${encodeURIComponent(city.city)}&state=${encodeURIComponent(city.state)}` : "/price"} data-seo-cta="price">
            See the price for your address →
          </a>
        </section>
        <div className={s.lede}>
          {p.lede.map((t) => (
            <p key={t.slice(0, 24)}>{t}</p>
          ))}
        </div>
      </div>

      <section className={s.card} id="calculator" aria-labelledby="calc-h">
        <div className={s.cardHead}>
          <h2 className={s.h2} id="calc-h">
            {trade.name} cost calculator for {city.city}
          </h2>
        </div>
        <CostCalculator
          model={bareModel(p.calc.model)}
          size={{ question: trade.size.question, short: trade.size.short, per: trade.size.per, min: trade.size.min, max: trade.size.max, step: trade.size.step, typical: trade.size.typical }}
          variants={trade.variants.map((v) => ({ id: v.id, label: v.label, detail: v.detail }))}
          variantLegend={ph.materialNoun.charAt(0).toUpperCase() + ph.materialNoun.slice(1)}
          extras={trade.extras.map((e) => ({ id: e.id, label: e.label }))}
          defaultVariant={p.calc.variantId}
          city={city.city}
          quotesHref={quotes}
          proHref={pro}
          pro={trade.pro}
        />
      </section>

      <div className={s.twoCol}>
        <CostTable title={p.materials.heading} intro={p.materials.intro} outro={p.materials.outro} rows={p.materials.rows} col="Option" />
        <CostTable title={p.sizes.heading} intro={p.sizes.intro} outro={p.sizes.outro} rows={p.sizes.rows} col="Size" />
      </div>

      <CostTable title={p.included.heading} intro={p.included.intro} outro={p.included.outro} rows={p.included.rows} col="Line" plain />

      <section className={s.quotes} aria-labelledby="quotes-h">
        <div>
          <h2 className={s.h2} id="quotes-h">
            Get free quotes from {city.city} contractors
          </h2>
          <p>
            Describe your project once and JobFlex sends it to a local {trade.pro} who prices it for your home — free, no account needed.
          </p>
        </div>
        <a className={s.primary} href={quotes} data-seo-cta="quotes_block">
          Get free quotes
        </a>
      </section>

      <section className={s.card} aria-labelledby="factors-h">
        <div className={s.cardHead}>
          <h2 className={s.h2} id="factors-h">
            {p.factors.heading}
          </h2>
        </div>
        <div className={s.cardBody}>
          <div className={s.facts}>
            {p.factors.items.map((f) => (
              <div className={s.fact} key={f.title}>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {p.questions.items.length ? (
        <section className={s.card} aria-labelledby="asks-h">
          <div className={s.cardHead}>
            <h2 className={s.h2} id="asks-h">
              {p.questions.heading}
            </h2>
          </div>
          <div className={s.cardBody}>
            <ul className={s.asks}>
              {p.questions.items.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      {p.compare ? <CostTable title={p.compare.heading} intro={p.compare.intro} rows={p.compare.rows} col="City" /> : null}

      <section className={s.card} aria-labelledby="faq-h">
        <div className={s.cardHead}>
          <h2 className={s.h2} id="faq-h">
            {ph.price} in {city.city}: questions
          </h2>
        </div>
        <div className={s.cardBody}>
          <div className={s.faq}>
            {p.faq.map((f) => (
              <div className={s.faqItem} key={f.q}>
                <h3>{f.q}</h3>
                <p>{f.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className={s.twoCol}>
        <LinkList title={`Other home projects in ${city.city}`} links={p.otherWorks} />
        {p.sameState.length ? <LinkList title={`${trade.lower.charAt(0).toUpperCase() + trade.lower.slice(1)} cost near ${city.city}`} links={p.sameState} /> : null}
      </div>

      <section className={s.card} aria-labelledby="method-h">
        <div className={s.cardHead}>
          <h2 className={s.h2} id="method-h">
            How these prices are built
          </h2>
        </div>
        <div className={`${s.cardBody} ${s.method}`}>
          {p.method.map((t) => (
            <p key={t.slice(0, 24)}>{t}</p>
          ))}
          <p>
            Contractors in {city.city} build quotes like these with{" "}
            <a href={pro} data-seo-cta="pro_inline">
              JobFlex&apos;s {trade.tool}
            </a>
            .
          </p>
          <ul className={s.sources}>
            {p.sources.map((src) => (
              <li key={src}>{src}</li>
            ))}
          </ul>
        </div>
      </section>
    </CostChrome>
  );
}

function CostTable({ title, intro, outro, rows, col, plain }: { title: string; intro?: string; outro?: string; rows: Array<{ key: string; label: string; detail?: string; lo: string; hi: string; avg: string; per: string; href?: string }>; col: string; plain?: boolean }) {
  return (
    <section className={s.card} aria-label={title}>
      <div className={s.cardHead}>
        <h2 className={s.h2}>{title}</h2>
      </div>
      <div className={s.cardBody}>
        {intro ? <p>{intro}</p> : null}
        <table className={s.table}>
          <thead>
            <tr>
              <th scope="col">{col}</th>
              <th scope="col">{plain ? "Low – high" : "Average · range"}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>
                  {r.href ? (
                    <a className={s.rowName} href={r.href}>
                      {r.label}
                    </a>
                  ) : (
                    <span className={s.rowName}>{r.label}</span>
                  )}
                  {r.detail ? <span className={s.rowNote}>{r.detail}</span> : null}
                  {r.per ? <span className={s.rowNote}>{r.per}</span> : null}
                </td>
                <td>
                  {plain ? (
                    <span className={s.rowCost}>
                      {r.lo} – {r.hi}
                    </span>
                  ) : (
                    <>
                      <span className={s.rowCost}>{r.avg}</span>
                      <span className={s.rowRange}>
                        {r.lo} – {r.hi}
                      </span>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {outro ? <p className={s.small}>{outro}</p> : null}
      </div>
    </section>
  );
}

function LinkList({ title, links }: { title: string; links: Array<{ href: string; label: string; note?: string }> }) {
  return (
    <section className={s.card} aria-label={title}>
      <div className={s.cardHead}>
        <h2 className={s.h2}>{title}</h2>
      </div>
      <div className={s.cardBody}>
        <ul className={s.links}>
          {links.map((l) => (
            <li key={l.href}>
              <a href={l.href}>
                {l.label}
                {l.note ? <span>{l.note}</span> : null}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
