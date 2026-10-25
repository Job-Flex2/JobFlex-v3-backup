"use client";
// THE PITCH DECK (owner, 2026-10-25: "a smart pitch deck — who we are and what we're doing" on the investor link).
// Built from what JobFlex already says about itself: the product's screens (tour-shots), the live figures the Figures
// page reads (lib/investors — the same numbers, the same words), the plan catalogue's prices, the researched
// comparison the landing page shows (landing-compare). The owner's own words fill the three slides nothing else can —
// what is next, the team, the raise — and a slide with no words does not show.
import { useMemo, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { TOUR_SHOTS, tourSrc } from "./tour-shots";
import { useSlides } from "./use-slides";
import s from "./investor-deck.module.css";

export interface PitchData {
  token: string;
  launch: { day: number; date: string };
  traction: {
    since: string; signups: number; paying: number; payingMrrCents: number; trialsNow: number;
    ratePct: number | null; ratePaid: number; rateEnded: number;
    collected: { read: boolean; cents: number; invoices: number };
    at: string;
  };
  plans: Array<{ name: string; priceCents: number; yearlyPriceCents: number | null; trialDays: number; highlight: boolean; features: string[] }>;
  compare: {
    competitors: Array<{ id: string; name: string }>;
    rows: Array<{ id: string; label: string; detail?: string; them: Record<string, { status: string; label?: string; caveat?: string }> }>;
    caveats: Record<string, string>;
  };
  words: { team: string[]; ask: string[]; roadmap: string[] };
}

const n = (v: number) => v.toLocaleString("en-US");
const dollars = (cents: number) => "$" + Math.round(cents / 100).toLocaleString("en-US");
const price = (cents: number) => (cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`);
const longDate = (iso: string) => new Date(iso + (iso.length === 10 ? "T12:00:00" : "")).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
const shot = (slug: string) => TOUR_SHOTS.find((x) => x.slug === slug)!;

function Shot({ slug, className }: { slug: string; className?: string }) {
  const x = shot(slug);
  return <Image draggable={false} src={tourSrc(x.slug)} alt={x.title} width={x.w} height={x.h} sizes="(max-width: 860px) 90vw, 420px" className={`${s.slideImg} ${className ?? ""}`} data-kind={x.kind} style={{ objectPosition: x.focus ?? "top" }} />;
}

function cellWords(c: { status: string; label?: string; caveat?: string } | undefined, caveats: Record<string, string>): { text: string; tone: string } {
  if (!c) return { text: "—", tone: "no" };
  if (c.status === "yes") return { text: "✓", tone: "yes" };
  if (c.status === "no") return { text: "—", tone: "no" };
  if (c.status === "paid") return { text: c.label ? `Paid · ${c.label}` : "Paid", tone: "paid" };
  if (c.status === "soon") return { text: "Soon", tone: "paid" };
  return { text: (c.caveat && caveats[c.caveat]) || "Partly", tone: "paid" };
}

type Slide = { id: string; kicker: string; body: ReactNode };

export function PitchDeck({ data, offer }: { data: PitchData; offer: ReactNode }) {
  const t = data.traction;
  const slides = useMemo<Slide[]>(() => {
    const out: Slide[] = [];
    out.push({
      id: "cover", kicker: "JobFlex · Contractor OS",
      body: (
        <div className={s.cover}>
          <h1 className={s.coverTitle}>You build.<br />We run the rest.</h1>
          <p className={s.lede}>One app for contractors, from the first call to the last payment: AI estimates, proposals clients sign and pay, the schedule, the crews and the money.</p>
          <div className={s.coverFoot}><b>Day {n(data.launch.day)}</b> since launch · {longDate(data.launch.date)} · jobflex.app</div>
        </div>
      ),
    });
    out.push({
      id: "problem", kicker: "The problem",
      body: (
        <div>
          <h2 className={s.title}>Running a trade business is five jobs at once</h2>
          <ul className={`${s.points} ${s.pointsWide}`}>
            <li><b>Estimates cost the evening.</b> A drive to every property, then take-offs by hand.</li>
            <li><b>The phone rings on the roof.</b> A call nobody answers is a job someone else gets.</li>
            <li><b>Quotes go out blind.</b> A PDF in an email, and no idea whether it was opened.</li>
            <li><b>Five apps that don&apos;t talk.</b> The schedule, the crew, the invoices and the reviews each live somewhere else.</li>
          </ul>
        </div>
      ),
    });
    out.push({
      id: "solution", kicker: "What JobFlex is",
      body: (
        <div>
          <h2 className={s.title}>One app, the whole life of a job</h2>
          <ol className={s.flow}>
            {[
              ["Call", "The AI desk answers, asks what the trade needs and books the visit."],
              ["Estimate", "Roof, fence, HVAC, deck and remodel estimates from an address, a map, a sentence or a plan set."],
              ["Sell", "A proposal link the client reads, signs and pays on a phone; change orders in writing."],
              ["Schedule", "The calendar, dispatch by crew, and a crew page with no login."],
              ["Get paid", "A payment schedule on every job: invoices by card or bank, reminders, mark paid."],
              ["Grow", "Reviews after the job, and homeowner requests that arrive as leads."],
            ].map(([h, p], i) => (
              <li key={h}><i>{String(i + 1).padStart(2, "0")}</i><b>{h}</b><span>{p}</span></li>
            ))}
          </ol>
        </div>
      ),
    });
    out.push({
      id: "estimators", kicker: "The product · estimating",
      body: (
        <div>
          <h2 className={s.title}>Estimates from the office, not the driveway</h2>
          <div className={s.tiles}>
            {[
              ["roof-estimator", "Roof", "From an address: area, squares, pitch and facets, measured from the air."],
              ["fence-studio", "Fence", "Drawn on the satellite map, then shown in 3D on the lot's own slope."],
              ["hvac-design", "HVAC", "A Manual J-style load, the unit sized to it, three equipment options."],
              ["deck-roof-3d", "Deck Studio", "3D design, the state's rules, a permit set and the lumber list."],
              ["smart-proposal", "Smart Proposal", "A sentence or a few photos in, priced lines out — any trade."],
              ["blueprint", "Blueprint", "A plan set in; measured and priced from the sheets."],
            ].map(([slug, h, p]) => (
              <figure key={slug} className={s.tile}><Shot slug={slug} className={s.tileImg} /><figcaption><b>{h}</b>{p}</figcaption></figure>
            ))}
          </div>
        </div>
      ),
    });
    out.push({
      id: "two-sides", kicker: "Both sides of the job",
      body: (
        <div className={s.split}>
          <div>
            <h2 className={s.title}>The client is in the app too</h2>
            <ul className={s.points}>
              <li><b>A proposal link, not an attachment.</b> Read, signed and paid on a phone — we see when it is opened.</li>
              <li><b>The client designs the deck.</b> A link to change it — even by talking — that comes back priced.</li>
              <li><b>A free homeowner portal.</b> A homeowner describes the project; it becomes a scoped lead offered to a contractor on JobFlex.</li>
              <li><b>The homeowner&apos;s own home page.</b> Every project on the house, every proposal and contractor, no password.</li>
            </ul>
          </div>
          <div className={s.phones}><Shot slug="client-designs-deck" /><Shot slug="home-dashboard" /></div>
        </div>
      ),
    });
    out.push({
      id: "operations", kicker: "The product · running the business",
      body: (
        <div className={s.split}>
          <div>
            <h2 className={s.title}>The owner sees the company on one screen</h2>
            <ul className={s.points}>
              <li><b>CRM and the office.</b> Collected, owed, win rate, jobs in motion, lead to paid.</li>
              <li><b>Calendar and dispatch.</b> Every crew&apos;s week; the AI desk books into reserved hours.</li>
              <li><b>Roles.</b> Owner, manager, sales rep, estimator and installer — each sees their own app.</li>
              <li><b>Financials.</b> Revenue against expenses, receipts read off a photo, invoices and change orders.</li>
            </ul>
          </div>
          <Shot slug="crm-office" />
        </div>
      ),
    });
    out.push({
      id: "traction", kicker: `Traction · live · read ${new Date(t.at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}`,
      body: (
        <div>
          <h2 className={s.title}>Where it stands today</h2>
          <div className={s.kpis}>
            <div data-kpi="day"><b>Day {n(data.launch.day)}</b><span>since JobFlex launched · {longDate(data.launch.date)}</span></div>
            <div data-kpi="signed-up"><b>{n(t.signups)}</b><span>signed up with a card since {longDate(t.since)}</span></div>
            <div data-kpi="paying"><b>{n(t.paying)}</b><span>paying · {dollars(t.payingMrrCents)}/mo</span></div>
            <div data-kpi="rate"><b>{t.ratePct === null ? "—" : `${t.ratePct}%`}</b><span>{t.ratePct === null ? "trial to paid · no trial has ended yet" : `trial to paid · ${t.ratePaid} of ${t.rateEnded} ended trials`}</span></div>
            <div data-kpi="trials"><b>{n(t.trialsNow)}</b><span>on trial now</span></div>
            <div data-kpi="collected"><b>{t.collected.read ? dollars(t.collected.cents) : "—"}</b><span>{t.collected.read ? `collected so far · Stripe, ${t.collected.invoices} ${t.collected.invoices === 1 ? "payment" : "payments"}` : "collected · Stripe not read"}</span></div>
          </div>
          <p className={s.note}>The same figures as the Figures page, read live. <Link href={`/investors/${data.token}`}>See them all →</Link></p>
        </div>
      ),
    });
    if (data.plans.length) {
      out.push({
        id: "model", kicker: "Business model",
        body: (
          <div>
            <h2 className={s.title}>A flat monthly plan — no per-seat fees</h2>
            <div className={s.plans}>
              {data.plans.map((p) => (
                <div key={p.name} className={s.plan} data-highlight={p.highlight}>
                  <div className={s.planName}>{p.name}</div>
                  <div className={s.planPrice}>{price(p.priceCents)}<small>/mo</small></div>
                  {p.yearlyPriceCents ? <div className={s.planYear}>{price(p.yearlyPriceCents)} a year</div> : null}
                  <ul>{p.features.slice(0, 5).map((f) => <li key={f}>{f}</li>)}</ul>
                </div>
              ))}
            </div>
            <p className={s.note}>{data.plans[0].trialDays && data.plans.every((p) => p.trialDays === data.plans[0].trialDays) ? `Every plan starts with a ${data.plans[0].trialDays}-day free trial. ` : ""}Prices from the live plan catalogue.</p>
          </div>
        ),
      });
    }
    if (data.compare.rows.length) {
      out.push({
        id: "competition", kicker: "Competition",
        body: (
          <div>
            <h2 className={s.title}>Where JobFlex is different</h2>
            <div className={s.cmpWrap}>
              <table className={s.cmp}>
                <thead><tr><th scope="col">Built in</th><th scope="col" className={s.cmpUs}>JobFlex</th>{data.compare.competitors.map((c) => <th scope="col" key={c.id}>{c.name}</th>)}</tr></thead>
                <tbody>
                  {data.compare.rows.map((r) => (
                    <tr key={r.id}>
                      <th scope="row">{r.label}</th>
                      <td className={s.cmpUs}>✓</td>
                      {data.compare.competitors.map((c) => { const w = cellWords(r.them[c.id], data.compare.caveats); return <td key={c.id} data-tone={w.tone}>{w.text}</td>; })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className={s.note}>Each competitor cell was checked against the vendor&apos;s own pricing, features and help pages (Sept–Oct 2026), judged on their cheapest paid plan.</p>
          </div>
        ),
      });
    }
    out.push({
      id: "go-to-market", kicker: "Go to market",
      body: (
        <div className={s.split}>
          <div>
            <h2 className={s.title}>How contractors find JobFlex</h2>
            <ul className={s.points}>
              <li><b>Trade-by-trade video ads.</b> Roof, fence, HVAC and deck films on Facebook and Instagram, each landing on its own trade&apos;s page.</li>
              <li><b>Homeowner demand.</b> The free homeowner portal turns requests into leads for contractors on JobFlex.</li>
              <li><b>Outbound by the AI desk itself.</b> It calls contractors&apos; business lines to introduce JobFlex; a mobile number gets an email asking first.</li>
              <li><b>Try before paying.</b> A free trial on every plan; the figures page measures trial to paid as it happens.</li>
            </ul>
          </div>
          <Shot slug="homeowner-portal" />
        </div>
      ),
    });
    if (data.words.roadmap.length) {
      out.push({
        id: "roadmap", kicker: "What's next",
        body: (
          <div>
            <h2 className={s.title}>What&apos;s next</h2>
            <ol className={s.roadmap}>{data.words.roadmap.map((l, i) => <li key={i}>{l}</li>)}</ol>
          </div>
        ),
      });
    }
    if (data.words.team.length) {
      out.push({
        id: "team", kicker: "The team",
        body: (
          <div>
            <h2 className={s.title}>The team</h2>
            <ul className={s.team}>
              {data.words.team.map((l, i) => {
                const [name, role, ...rest] = l.split(/\s+[—–-]\s+/);
                return <li key={i}><b>{name}</b>{role ? <span className={s.teamRole}>{role}</span> : null}{rest.length ? <span>{rest.join(" — ")}</span> : null}</li>;
              })}
            </ul>
          </div>
        ),
      });
    }
    out.push({
      id: "ask", kicker: "The ask",
      body: (
        <div className={s.cover}>
          <h2 className={s.coverTitle}>{data.words.ask[0] ?? "We're raising"}</h2>
          {data.words.ask.length > 1 ? (
            <ul className={s.points}>{data.words.ask.slice(1).map((l, i) => <li key={i}>{l}</li>)}</ul>
          ) : (
            <p className={s.lede}>Offers and first conversations are welcome.</p>
          )}
          <div className={s.askActs}>
            {offer}
            <Link className={s.askLink} href={`/investors/${data.token}/tour`}>Take the platform tour →</Link>
            <Link className={s.askLink} href={`/investors/${data.token}`}>The live figures →</Link>
          </div>
        </div>
      ),
    });
    return out;
  }, [data, offer, t]);

  const { index, move, playing, togglePlay, swipe } = useSlides(slides.length, 9000);
  const slide = slides[index];

  return (
    <section className={s.deck} data-deck aria-roledescription="slideshow" aria-label="JobFlex pitch deck">
      <div className={s.slide} key={slide.id} data-slide={slide.id} {...swipe} aria-live="polite">
        <div className={s.slideKicker}><span>{slide.kicker}</span><span>{index + 1} / {slides.length}</span></div>
        <div className={s.slideBody}>{slide.body}</div>
      </div>
      <div className={s.deckBar}>
        <button type="button" className={s.ctl} onClick={() => move(index - 1)} disabled={index === 0} aria-label="Previous slide">←</button>
        <div className={s.dots} role="tablist" aria-label="Slides">
          {slides.map((x, i) => (
            <button key={x.id} type="button" role="tab" aria-selected={i === index} aria-label={`${i + 1}: ${x.kicker}`} className={s.dot} onClick={() => move(i)} />
          ))}
        </div>
        <button type="button" className={s.ctl} onClick={togglePlay} aria-pressed={playing} data-deck-play>{playing ? "Pause" : "Play"}</button>
        <button type="button" className={`${s.ctl} ${s.ctlMain}`} onClick={() => move(index + 1)} disabled={index === slides.length - 1} data-deck-next>Next →</button>
      </div>
    </section>
  );
}
