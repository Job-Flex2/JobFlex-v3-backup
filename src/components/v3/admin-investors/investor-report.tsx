// THE INVESTOR REPORT (2026-10-06; facts only since 2026-10-17) — the same page for the admin, for the shared link
// and (in prose) for the PDF. Owner, 2026-10-17: "remove the assumptions; read the current spend; take out the money
// spent while the trials needed no card, show what the ads for the card trials cost, but count the paying users who
// came from the no-card trials; make it smart and understandable." So: what the ads cost (live from Meta), what they
// brought — visitors, trial signups, paying customers — what customers pay and have paid (Stripe), what a customer
// costs and how soon one pays it back, and in plain words how each figure is made. Nothing projected, no share of
// trials that "will" pay. Read-only and hook-free; the admin's controls sit around it (admin-investors-content).
import type { ReactNode } from "react";
import { dollars, factsLines, longDate } from "@/lib/investorModel";
import type { InvestorReport } from "@/lib/investors";
import { MoneyChart } from "./money-chart";
import { SpendBars } from "./spend-bars";
import s from "./investor-report.module.css";

const n = (v: number) => v.toLocaleString("en-US");
const money = (v: number | null) => (v === null ? "—" : dollars(v));
const plural = (v: number, one: string, many: string) => `${n(v)} ${v === 1 ? one : many}`;
const shortDate = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const span = (from: string | null, to: string | null) => (!from ? "" : !to || to === from ? shortDate(from) : `${shortDate(from)} – ${shortDate(to)}`);
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

/** Where the spend figure comes from, in one line. */
export function spendSourceLine(report: InvestorReport): string {
  const m = report.meta;
  if (!m.configured) return "Ad spend as booked by day — Meta's own figures come once its account is connected";
  if (!m.lastPulledAt) return `Meta is connected; its figures arrive with the first read${m.lastError ? ` — the last read failed: ${m.lastError}` : ""}`;
  return `Meta's own figures · read ${when(m.lastPulledAt)}${m.lastError ? ` · the last read failed: ${m.lastError}` : ""}`;
}

export function InvestorReportView({ report, between }: { report: InvestorReport; between?: ReactNode }) {
  const f = report.facts;
  const lo = f.leftOut;
  const lines = factsLines(f);
  const cardAvg = f.paying.card ? Math.round(f.paying.cardMrrCents / f.paying.card) : null;
  const payingParts = [
    f.paying.card ? `${f.paying.card} from card trials` : null,
    f.paying.nocard ? `${f.paying.nocard} from the no-card test` : null,
    f.paying.before ? `${f.paying.before} from before the ads` : null,
  ].filter(Boolean);
  const rows30 = f.spend.days.slice(-30).map((d) => ({ date: d.date, cents: d.cents, leftOutCents: d.leftOutCents, clicks: report.clicksByDay[d.date] ?? null, signups: d.signups }));

  return (
    <div className={s.rep} data-investor-report>
      {/* What happened, in three sentences — every number a fact. */}
      <section className={s.lead} data-lead>
        <div className={s.leadLabel}>Where the ads stand · {longDate(f.today)}</div>
        <div className={s.leadText}>
          {lines.map((l) => <p key={l}>{l}</p>)}
        </div>
        <div className={s.leadFacts}>
          <div data-fact="spend"><b>{dollars(f.spend.cents)}</b><span>spent on ads · {dollars(f.spend.perDayLast7Cents)}/day this past week</span></div>
          <div data-fact="paying"><b>{n(f.paying.count)}</b><span>paying {f.paying.count === 1 ? "customer" : "customers"}{payingParts.length > 1 ? ` · ${payingParts.join(" · ")}` : ""}</span></div>
          <div data-fact="mrr"><b>{dollars(f.paying.mrrCents)}</b><span>a month · {dollars(f.paying.arrCents)} a year</span></div>
          <div data-fact="collected"><b>{f.collected ? dollars(f.collected.cents) : "—"}</b><span>{f.collected ? `paid so far${f.collected.recoveredPct !== null ? ` · ${f.collected.recoveredPct}% of the ad spend` : ""}` : "paid so far · Stripe not read just now"}</span></div>
        </div>
      </section>

      {between}

      {/* The spend, live (owner, 2026-10-08 and 2026-10-17). */}
      <section className={s.card} data-costs>
        <div className={s.cardHead}>
          <h2 className={s.h2}>The ad spend, live</h2>
          <span className={s.cardNote} data-spend-source>{spendSourceLine(report)}</span>
        </div>
        <div className={s.periods} aria-label="Ad spend by period">
          {f.spend.periods.map((p) => (
            <div key={p.key} className={s.period} data-period={p.key}>
              <span className={s.periodLabel}>{p.label}</span>
              <strong className={s.periodValue}>{dollars(p.cents)}</strong>
              <small className={s.periodNote}>{p.days === 0 ? "nothing yet" : p.days === 1 ? "one day" : `${dollars(p.perDayCents)}/day · ${p.days} days`}</small>
            </div>
          ))}
        </div>
        <SpendBars rows={rows30} />
        {lo.cents > 0 && (
          <p className={s.leftOutLine} data-left-out-line>
            Left out: <b>{dollars(lo.cents)}</b> spent {span(lo.from, lo.to)} on ads while a new signup could start a free trial with no card — {plural(lo.signups, "trial", "trials")} started that way{lo.paid > 0 ? <>; {n(lo.paid)} went on to pay and {lo.paid === 1 ? "is" : "are"} counted below as {lo.paid === 1 ? "a paying customer" : "paying customers"}.</> : <>; none of them pays.</>}
          </p>
        )}
      </section>

      {/* From the ad to a paying customer. */}
      <section className={s.card} data-funnel>
        <h2 className={s.h2}>From visitor to paying customer</h2>
        <ol className={s.funnel}>
          <li className={s.step} data-step="visitors">
            <span className={s.stepLabel}>Visitors</span>
            <strong className={s.stepValue}>{f.visitors === null ? "—" : n(f.visitors)}</strong>
            <small className={s.stepNote}>{f.visitors === null ? "analytics not reached" : `${money(f.unit.perVisitorCents)} of ads each`}</small>
          </li>
          <li className={s.step} data-step="signups">
            <span className={s.stepLabel}>Started a trial</span>
            <strong className={s.stepValue}>{n(f.signups)}</strong>
            <small className={s.stepNote}>{f.unit.visitorToSignupPct !== null ? `${f.unit.visitorToSignupPct}% of visitors · ` : ""}{money(f.unit.perSignupCents)} each · {n(f.signupsLast7)} this past week</small>
          </li>
          <li className={s.step} data-step="ended">
            <span className={s.stepLabel}>Trials ended</span>
            <strong className={s.stepValue}>{n(f.ended.paid + f.ended.lapsed)}</strong>
            <small className={s.stepNote}>{n(f.onTrial.count)} still on trial{f.onTrial.priced ? ` · their plans ${dollars(f.onTrial.listMrrCents)}/mo` : ""}</small>
          </li>
          <li className={s.step} data-step="paid" data-tone="good">
            <span className={s.stepLabel}>Paid</span>
            <strong className={s.stepValue}>{n(f.ended.paid)}</strong>
            <small className={s.stepNote}>{f.ended.pct !== null ? `${f.ended.pct}% of ended trials · ${n(f.ended.lapsed)} did not` : "no trial has ended yet"} · {money(f.unit.perPayingCents)} of ads each</small>
          </li>
        </ol>
        <p className={s.funnelNote}>The trials that took a card, from the days their ads ran.{f.paying.nocard || f.paying.before ? ` Paying customers counted beside them: ${[f.paying.nocard ? plural(f.paying.nocard, "from the no-card test", "from the no-card test") : null, f.paying.before ? plural(f.paying.before, "from before the ads", "from before the ads") : null].filter(Boolean).join(" and ")}.` : ""}</p>
      </section>

      <div className={s.twoUp}>
        <section className={s.card} data-revenue>
          <h2 className={s.h2}>What customers pay</h2>
          <table className={s.tbl}>
            <tbody>
              <tr className={s.strong}><td>Monthly revenue</td><td className={s.num}>{dollars(f.paying.mrrCents)}</td><td className={s.sub}>{plural(f.paying.count, "paying customer", "paying customers")}{report.payingUnpriced > 0 ? ` · ${report.payingUnpriced} with no list price` : ""}</td></tr>
              <tr><td>A year</td><td className={s.num}>{dollars(f.paying.arrCents)}</td><td className={s.sub}>monthly revenue × 12</td></tr>
              {f.paying.card > 0 && <tr><td>From card trials</td><td className={s.num}>{dollars(f.paying.cardMrrCents)}</td><td className={s.sub}>{plural(f.paying.card, "customer", "customers")} · {money(cardAvg)} a month each</td></tr>}
              {f.paying.nocard > 0 && <tr><td>From the no-card test</td><td className={s.num}>{dollars(f.paying.nocardMrrCents)}</td><td className={s.sub}>{plural(f.paying.nocard, "customer", "customers")} who started with no card, then paid</td></tr>}
              {f.paying.before > 0 && <tr><td>From before the ads</td><td className={s.num}>{dollars(f.paying.beforeMrrCents)}</td><td className={s.sub}>{plural(f.paying.before, "customer", "customers")} paying before {shortDate(f.since)}</td></tr>}
              <tr className={s.strong}><td>Paid so far</td><td className={s.num}>{f.collected ? dollars(f.collected.cents) : "—"}</td><td className={s.sub}>{f.collected ? `${plural(f.collected.payments, "payment", "payments")} since ${shortDate(f.since)}, as Stripe took them` : report.stripe.error ?? "Stripe not read"}</td></tr>
            </tbody>
          </table>
        </section>
        <section className={s.card} data-unit>
          <h2 className={s.h2}>What a customer costs</h2>
          <table className={s.tbl}>
            <tbody>
              <tr><td>Per visitor</td><td className={s.num}>{money(f.unit.perVisitorCents)}</td><td className={s.sub}>{f.visitors === null ? "no visitor count" : plural(f.visitors, "visitor", "visitors")}</td></tr>
              <tr><td>Per trial</td><td className={s.num}>{money(f.unit.perSignupCents)}</td><td className={s.sub}>{plural(f.signups, "trial started", "trials started")}</td></tr>
              <tr className={s.strong}><td>Per paying customer</td><td className={s.num}>{money(f.unit.perPayingCents)}</td><td className={s.sub}>the ad spend ÷ {plural(f.paying.card, "card trial that paid", "card trials that paid")}</td></tr>
              <tr><td>Paid back in</td><td className={s.num}>{f.unit.paybackMonths === null ? "—" : `${f.unit.paybackMonths} mo`}</td><td className={s.sub}>{cardAvg !== null && f.unit.perPayingCents !== null ? `${dollars(f.unit.perPayingCents)} ÷ ${dollars(cardAvg)} a month` : "once a card trial pays"}</td></tr>
              <tr><td>Ad spend covered</td><td className={s.num}>{f.collected?.recoveredPct != null ? `${f.collected.recoveredPct}%` : "—"}</td><td className={s.sub}>paid so far ÷ spent so far</td></tr>
            </tbody>
          </table>
        </section>
      </div>

      <section className={s.card} data-chart>
        <h2 className={s.h2}>Spent against paid, day by day</h2>
        <MoneyChart points={f.chart} />
      </section>

      {f.spend.byPlatform.length > 0 && (
        <section className={s.card} data-platforms>
          <h2 className={s.h2}>Where the ad money went</h2>
          <table className={s.tbl}>
            <tbody>
              {f.spend.byPlatform.map((p) => (
                <tr key={p.platform}><td>{p.label}</td><td className={s.num}>{dollars(p.cents)}</td><td className={s.sub}>{plural(p.days, "day", "days")} · {dollars(Math.round(p.cents / Math.max(1, p.days)))}/day</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className={s.method} data-method>
        <h2 className={s.h2}>How these are figured</h2>
        <ul>
          <li>Everything here has happened: no forecast, no share of trials that &ldquo;will&rdquo; pay, no budget counted as spent. Counting from {longDate(f.since)}, the day the first campaign went live.</li>
          <li>Ad spend is {report.meta.configured ? "Meta's own figure for each day, read again whenever it is more than 15 minutes old" : "the spend booked for each day"}{f.spend.handDays ? `, with ${plural(f.spend.handDays, "day", "days")} booked by hand` : ""}. Today&apos;s figure is what has been spent so far today.</li>
          {lo.cents > 0 || lo.signups > 0 ? (
            <li data-left-out>Left out on purpose: the {dollars(lo.cents)} of ad spend on the {plural(lo.days, "day", "days")} ({span(lo.from, lo.to)}) when a new signup could start a free trial with no card — an experiment since ended — and the {plural(lo.signups, "trial", "trials")} started that way. {lo.paid > 0 ? `${plural(lo.paid, "of them", "of them")} went on to pay (${dollars(lo.paidMrrCents)} a month): ${lo.paid === 1 ? "it counts as a paying customer" : "they count as paying customers"}, but not in the cost of a customer, since ${lo.paid === 1 ? "its" : "their"} ad spend is not in the figures either.` : "None of them is paying."}</li>
          ) : (
            <li data-left-out>Every trial here took a card at signup.</li>
          )}
          <li>Visitors are unique people on www.jobflex.app on the days the card trials&apos; ads ran, bots and previews out. A trial counts from its signup; a trial &ldquo;ended&rdquo; either paid or did not.</li>
          <li>Monthly revenue is each paying customer&apos;s plan price (a yearly plan as a twelfth; discounts not taken off). &ldquo;Paid so far&rdquo; is the money Stripe collected for subscriptions since the start day, before any refund.{f.paying.before ? ` ${plural(f.paying.before, "customer", "customers")} paying from before the start day ${f.paying.before === 1 ? "counts" : "count"} as paying, not as a trial of the period.` : ""}</li>
          <li>The cost of a paying customer is the counted ad spend divided by the card trials that paid; &ldquo;paid back in&rdquo; is that cost divided by what one of those customers pays a month.</li>
          <li>Read {when(report.at)}. The figures move as the ads run and accounts sign up and pay.</li>
        </ul>
      </section>
    </div>
  );
}
