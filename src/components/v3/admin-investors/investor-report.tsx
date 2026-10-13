"use client";
// THE INVESTOR REPORT (2026-10-06) — the same page for the admin, for the
// shared link and (in prose) for the PDF: what the ads cost, who signed up,
// what the trials are worth, who pays, and when the ads pay for themselves.
// Read-only; the admin's controls sit around it (admin-investors-content).
// No server imports; the one piece of state is the cohort in view (owner,
// 2026-10-13: "two statistics, with the card and with no card, two buttons
// at the bottom; how much budget went to each and where we are now") — the
// whole report re-reads for the chosen kind of trial, and a strip under the
// numbers sets the two side by side.
import { useState, type ReactNode } from "react";
import { COHORT_LABEL, dollars, longDate, paybackSentence, spendPeriods, type InvestorFigures, type TrialCohort } from "@/lib/investorModel";
import type { InvestorReport } from "@/lib/investors";
import { PaybackChart } from "./payback-chart";
import { SpendBars } from "./spend-bars";
import s from "./investor-report.module.css";

const n = (v: number) => v.toLocaleString("en-US");
const pct = (v: number | null, suffix = "%") => (v === null ? "—" : `${v}${suffix}`);
const money = (v: number | null) => (v === null ? "—" : dollars(v));
const shortDate = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export function InvestorReportView({ report, shared = false, between }: { report: InvestorReport; shared?: boolean; between?: ReactNode }) {
  const [view, setView] = useState<"all" | TrialCohort>("all");
  const co = report.cohorts;
  const f = view === "all" ? report.figures : co[view].figures;
  const a = report.settings;
  const be = f.breakEven;
  const periods = view === "all" ? report.periods : spendPeriods(f.curve, f.today);
  const kind = view === "all" ? null : COHORT_LABEL[view].toLowerCase();
  const nowWords = co.current === "nocard" ? "no card" : "a card";
  return (
    <div className={s.rep} data-investor-report data-cohort-view={view}>
      {/* The sentence first. */}
      <section className={s.lead} data-tone={be.withinHorizon ? "good" : f.spend.totalCents === 0 ? "none" : "late"}>
        <div className={s.leadLabel}>{kind ? `When the ads for ${kind} trials pay for themselves` : "When the ads pay for themselves"}</div>
        <p className={s.leadText}>{paybackSentence(f)}</p>
        <div className={s.leadFacts}>
          <div><b>{be.daysFromToday !== null && be.daysFromToday > 0 ? `${be.daysFromToday} days` : be.daysFromToday !== null ? "Covered" : "—"}</b><span>{be.date ? `break-even · ${longDate(be.date)}` : "break-even not within the horizon"}</span></div>
          <div><b>{pct(f.unit.paybackMonths, " mo")}</b><span>spend to date ÷ realistic monthly revenue</span></div>
          <div><b>{pct(f.unit.returnToDatePct)}</b><span>revenue earned to date against the spend</span></div>
        </div>
      </section>

      {/* The numbers. */}
      <section className={s.kpis} aria-label="The figures">
        <Kpi label="Ad spend" value={dollars(f.spend.totalCents)} note={view !== "all" ? `went to ${kind} trials on ${co[view].attributedDays} ${co[view].attributedDays === 1 ? "day" : "days"}${co[view].current ? " · spending now" : " · not spending now"}` : f.spend.dailyBudgetCents !== null && f.spend.budgetFrom ? `${dollars(f.spend.dailyBudgetCents)}/day, all ads, since ${shortDate(f.spend.budgetFrom)}${f.spend.bookedDays ? ` · ${f.spend.bookedDays} booked ${f.spend.bookedDays === 1 ? "day" : "days"}` : ""}` : `since ${shortDate(f.since)} · ${dollars(f.spend.perDayRecentCents)}/day lately`} tone="ink" />
        <Kpi label="Visitors" value={f.visitors === null ? "—" : n(f.visitors)} note={view !== "all" ? "not split by kind of trial" : f.visitors === null ? "analytics not reached" : `${money(f.unit.costPerVisitorCents)} each`} />
        <Kpi label="Signed up" value={n(f.signups)} note={`${f.unit.signupsPerDay}/day · ${pct(f.unit.visitorToSignupPct)} of visitors · ${money(f.unit.costPerSignupCents)} each`} />
        <Kpi label="On free trial" value={n(f.trials.count)} note={`${dollars(f.trials.maxMrrCents)}/mo if all pay`} tone="trial" />
        <Kpi label="Paying" value={n(f.paying.count)} note={`${dollars(f.paying.mrrCents)}/mo · ${dollars(f.paying.arrCents)} a year${report.payingUnpriced > 0 ? ` · ${report.payingUnpriced} without a list price` : ""}`} tone="good" />
        <Kpi label="Realistic MRR" value={dollars(f.projected.mrrRealisticCents)} note={`paying + ${a.realisticPct}% of trials`} tone="blue" />
        {/* THE TWO KINDS OF TRIAL (owner, 2026-10-13): the buttons re-read every figure above and below for one kind. */}
        <div className={s.cohortBar} data-cohort-bar>
          <div className={s.cohortSeg} role="group" aria-label="Which trials the figures count">
            <button type="button" className={`${s.cohortBtn}${view === "all" ? ` ${s.cohortOn}` : ""}`} aria-pressed={view === "all"} onClick={() => setView("all")} data-cohort="all">All signups</button>
            <button type="button" className={`${s.cohortBtn}${view === "card" ? ` ${s.cohortOn}` : ""}`} aria-pressed={view === "card"} onClick={() => setView("card")} data-cohort="card">With a card <small>{n(co.card.signups)}</small></button>
            <button type="button" className={`${s.cohortBtn}${view === "nocard" ? ` ${s.cohortOn}` : ""}`} aria-pressed={view === "nocard"} onClick={() => setView("nocard")} data-cohort="nocard">No card <small>{n(co.nocard.signups)}</small></button>
          </div>
          <div className={s.cohortNow} data-cohort-now={co.current}>
            <b>Now:</b> a new signup gets a free trial with {nowWords}{co.currentSince ? ` · since ${shortDate(co.currentSince)}` : ""} · {dollars(co[co.current].attributedCents)} of the ad spend has gone to {COHORT_LABEL[co.current].toLowerCase()} trials so far
          </div>
        </div>
      </section>

      {/* Side by side: the same figures for each kind, so the two trials can be judged against each other. */}
      <section className={s.card} aria-label="With a card against no card" data-cohort-strip>
        <div className={s.cardHead}>
          <h2 className={s.h2}>With a card, against no card</h2>
          <span className={s.cardNote}>{co.recordedFrom ? `Spend follows the switch as recorded from ${shortDate(co.recordedFrom)}; before that, who signed up each day` : "Spend follows who signed up each day until the switch records its flips"}</span>
        </div>
        <table className={`${s.tbl} ${s.cohortTbl}`}>
          <thead>
            <tr><th></th>{(["card", "nocard"] as const).map((k) => <th key={k} className={s.num} data-cohort-col={k}>{COHORT_LABEL[k]}{co.current === k ? <small className={s.nowTag}>now</small> : null}</th>)}</tr>
          </thead>
          <tbody>
            {cohortRows(co, a.realisticPct).map((r) => (
              <tr key={r.label} className={r.strong ? s.strong : undefined}>
                <td>{r.label}<small className={s.sub}>{r.sub}</small></td>
                <td className={s.num}>{r.card}</td>
                <td className={s.num}>{r.nocard}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {between}

      {/* The costs (owner, 2026-10-08): by period, by day, and by campaign when Meta answers. */}
      <section className={s.card} data-costs>
        <div className={s.cardHead}>
          <h2 className={s.h2}>The ad spend, live</h2>
          <span className={s.cardNote}>
            {report.meta.configured
              ? report.meta.lastPulledAt
                ? `Meta's own figures · read ${new Date(report.meta.lastPulledAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}${report.insights ? ` · ${report.insights.days.length} days · ${report.insights.campaigns.length} ${report.insights.campaigns.length === 1 ? "campaign" : "campaigns"}` : ""}${report.meta.lastError ? ` · last read failed: ${report.meta.lastError}` : ""}`
                : `Meta is connected; its figures arrive with the first read${report.meta.lastError ? ` — last read failed: ${report.meta.lastError}` : ""}`
              : "Figures from the daily budget and the days booked by hand; Meta's own come once its account is connected"}
          </span>
        </div>
        {view !== "all" ? <p className={s.sub}>The periods are the spend that went to {kind} trials; the days and campaigns below are all ads together.</p> : null}
        <div className={s.periods} aria-label="Ad spend by period">
          {periods.map((p) => (
            <div key={p.key} className={s.period} data-period={p.key}>
              <span className={s.periodLabel}>{p.label}</span>
              <strong className={s.periodValue}>{dollars(p.cents)}</strong>
              <small className={s.periodNote}>{p.days === 0 ? "nothing yet" : p.days === 1 ? (p.key === "today" || p.key === "yesterday" ? "one day" : "1 day") : `${dollars(p.perDayCents)}/day · ${p.days} days`}</small>
            </div>
          ))}
        </div>
        <SpendBars rows={report.dailyRows} />
        {report.campaigns.length > 0 && (
          <table className={`${s.tbl} ${s.campaigns}`} aria-label="Spend by campaign">
            <thead>
              <tr><th>Campaign · since {report.insights?.campaignsSince ? shortDate(report.insights.campaignsSince) : "the start"}</th><th className={s.num}>Spent</th><th className={s.num}>Clicks</th><th className={s.num}>Per click</th><th className={s.num}>Signed up</th><th className={s.num}>Per signup</th></tr>
            </thead>
            <tbody>
              {report.campaigns.slice(0, 12).map((c) => (
                <tr key={c.id}>
                  <td><span className={s.campaignName}>{c.name}</span>{c.name !== c.id && <small className={s.sub}>{c.id}</small>}</td>
                  <td className={s.num}>{dollars(c.spendCents)}</td>
                  <td className={s.num}>{c.clicks.toLocaleString("en-US")}</td>
                  <td className={s.num}>{c.cpcCents === null ? "—" : dollars(c.cpcCents)}</td>
                  <td className={s.num}>{c.signups}</td>
                  <td className={s.num}>{c.costPerSignupCents === null ? "—" : dollars(c.costPerSignupCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {report.campaigns.length > 0 && <p className={s.sub}>A signup is credited to the campaign its ad link named (utm_campaign); one with no tag is counted in the totals, not here.</p>}
      </section>

      <section className={s.card}>
        <h2 className={s.h2}>Ad spend against revenue</h2>
        <PaybackChart curve={f.curve} today={f.today} breakEven={be.date} horizonDays={a.horizonDays} />
      </section>

      <div className={s.twoUp}>
        <section className={s.card}>
          <h2 className={s.h2}>Monthly revenue, three ways</h2>
          <table className={s.tbl}>
            <tbody>
              <tr><td>Paying now</td><td className={s.num}>{dollars(f.paying.mrrCents)}</td><td className={s.sub}>{f.paying.count} {f.paying.count === 1 ? "account" : "accounts"} at list price</td></tr>
              <tr><td>If every trial pays</td><td className={s.num}>{dollars(f.projected.mrrAllPayCents)}</td><td className={s.sub}>+ {dollars(f.trials.maxMrrCents)} from {f.trials.priced} priced {f.trials.priced === 1 ? "trial" : "trials"}</td></tr>
              <tr className={s.strong}><td>Realistic · {a.realisticPct}% of trials</td><td className={s.num}>{dollars(f.projected.mrrRealisticCents)}</td><td className={s.sub}>the share used for the break-even</td></tr>
              <tr><td>By behaviour</td><td className={s.num}>{dollars(f.projected.mrrByBehaviourCents)}</td><td className={s.sub}>{pct(f.trials.byBehaviourPct)} of trials, read from what each account has done</td></tr>
              {f.observed.pct !== null && <tr><td>Observed so far</td><td className={s.num}>{f.observed.pct}%</td><td className={s.sub}>{f.observed.paid} paid, {f.observed.lapsed} lapsed, of the trials that have finished</td></tr>}
            </tbody>
          </table>
        </section>
        <section className={s.card}>
          <h2 className={s.h2}>What a customer costs</h2>
          <table className={s.tbl}>
            <tbody>
              <tr><td>Per visitor</td><td className={s.num}>{money(f.unit.costPerVisitorCents)}</td><td className={s.sub}>{f.visitors === null ? "no visitor count" : `${n(f.visitors)} visitors`}</td></tr>
              <tr><td>Per signup</td><td className={s.num}>{money(f.unit.costPerSignupCents)}</td><td className={s.sub}>{n(f.signups)} signed up</td></tr>
              <tr className={s.strong}><td>Per paying customer</td><td className={s.num}>{money(f.unit.costPerPayingRealisticCents)}</td><td className={s.sub}>paying now plus {a.realisticPct}% of trials</td></tr>
              <tr><td>Pays back in</td><td className={s.num}>{pct(f.unit.paybackMonths, " months")}</td><td className={s.sub}>at {dollars(f.projected.mrrRealisticCents)} a month</td></tr>
              <tr><td>Lapsed</td><td className={s.num}>{n(f.lapsed)}</td><td className={s.sub}>trials over or canceled</td></tr>
            </tbody>
          </table>
        </section>
      </div>

      {report.spend.byPlatform.length > 0 && (
        <section className={s.card}>
          <h2 className={s.h2}>Where the ad money went</h2>
          <table className={s.tbl}>
            <tbody>
              {report.spend.byPlatform.map((p) => (
                <tr key={p.platform}><td>{p.label}</td><td className={s.num}>{dollars(p.cents)}</td><td className={s.sub}>{p.days} {p.days === 1 ? "day" : "days"} · {dollars(Math.round(p.cents / Math.max(1, p.days)))}/day</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className={s.method}>
        <h2 className={s.h2}>How these are figured</h2>
        <ul>
          <li>Counting from {longDate(f.since)}, the day the first campaign went live — only what happened from that day on. Visitors are unique people on www.jobflex.app, bots and previews out.{report.before.paying > 0 ? ` ${report.before.paying} ${report.before.paying === 1 ? "account" : "accounts"} paying from before that day (${dollars(report.before.mrrCents)}/mo) ${report.before.paying === 1 ? "is" : "are"} not counted.` : ""}</li>
          <li>Ad spend is {f.spend.dailyBudgetCents !== null && f.spend.budgetFrom ? `the daily budget — ${dollars(f.spend.dailyBudgetCents)} for all ads together — counted as spent every day since ${longDate(f.spend.budgetFrom)}${f.spend.bookedDays ? `, with ${f.spend.bookedDays} ${f.spend.bookedDays === 1 ? "day" : "days"} at the figure booked for it` : ""}` : "what was booked per day; a day with nothing booked counts as zero"}{shared ? "" : " (set on this page; Meta's own figures per day once its API token is connected)"}. Tomorrow on it is projected at {dollars(f.spend.perDayProjectedCents)} a day.</li>
          <li>A trial is worth its plan&apos;s monthly list price: a yearly plan as a twelfth, a custom plan by its pages. Discounts, taxes and churn are not modelled.</li>
          <li>The realistic share is {a.realisticPct}% of trials paying, set by the owner; &ldquo;by behaviour&rdquo; reads each account&apos;s activity instead and is shown beside it.</li>
          <li>The curve: each paying account earns a thirtieth of its monthly price a day from the day it started paying; a trial from the day it ends; signups still to come arrive at the recent pace ({f.unit.signupsPerDay}/day), at the average trial price ({dollars(f.trials.avgMonthlyCents)}/mo), and pay after a {a.trialDays}-day trial. Spend continues at {dollars(f.spend.perDayProjectedCents)}/day for {a.horizonDays} days.</li>
          <li>The two kinds of trial: a trial that started with no card leaves its own record; every other one took a card. A day&apos;s ad spend went to whichever kind a visitor could start that day — by the owner&apos;s switch where it is recorded{co.recordedFrom ? ` (from ${longDate(co.recordedFrom)})` : ""}, else by who signed up that day, a mixed day in proportion, a day with no signups like the nearest day that had some. Only the kind a new signup gets today keeps spending forward; the other&apos;s spend stands still and its break-even is read on that. Visitors are not split.</li>
          <li>Read on {new Date(report.at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}. The figures move as accounts sign up and pay.</li>
        </ul>
      </section>
    </div>
  );
}

/** The strip's rows: one figure per kind, the same figure the report shows for it. */
function cohortRows(co: InvestorReport["cohorts"], realisticPct: number): Array<{ label: string; sub: string; card: string; nocard: string; strong?: boolean }> {
  type C = InvestorReport["cohorts"]["card"];
  const be = (c: C) => (c.figures.breakEven.date ? (c.figures.breakEven.daysFromToday !== null && c.figures.breakEven.daysFromToday <= 0 ? "covered" : `${shortDate(c.figures.breakEven.date)} · ${c.figures.breakEven.daysFromToday} days`) : c.attributedCents === 0 ? "no spend" : "not within the horizon");
  const row = (label: string, sub: string, pick: (c: C) => string, strong = false) => ({ label, sub, card: pick(co.card), nocard: pick(co.nocard), strong });
  return [
    row("Ad spend", "attributed · the days it fell on", (c) => `${dollars(c.attributedCents)} · ${c.attributedDays}d`),
    row("Signed up", "trials, paying and lapsed", (c) => n(c.signups)),
    row("On free trial", "now", (c) => n(c.figures.trials.count)),
    row("Paying", "accounts · list price a month", (c) => `${n(c.figures.paying.count)} · ${dollars(c.figures.paying.mrrCents)}`),
    row("Lapsed", "trials over or canceled", (c) => n(c.figures.lapsed)),
    row("Observed pay rate", "paid ÷ decided", (c) => pct(c.figures.observed.pct)),
    row("Cost per signup", "spend ÷ signups", (c) => money(c.figures.unit.costPerSignupCents)),
    row("Cost per paying customer", `paying + ${realisticPct}% of trials`, (c) => money(c.figures.unit.costPerPayingRealisticCents)),
    row("Realistic MRR", `paying + ${realisticPct}% of trials`, (c) => dollars(c.figures.projected.mrrRealisticCents), true),
    row("Pays back in", "spend ÷ realistic MRR", (c) => pct(c.figures.unit.paybackMonths, " mo")),
    row("Break-even", "realistic revenue meets the spend", be),
    row("Spending now", "from tomorrow", (c) => (c.current ? `yes · ${dollars(c.figures.spend.perDayProjectedCents)}/day` : "no")),
  ];
}

function Kpi({ label, value, note, tone }: { label: string; value: string; note: string; tone?: "ink" | "trial" | "good" | "blue" }) {
  return (
    <div className={s.kpi} data-tone={tone}>
      <span className={s.kpiLabel}>{label}</span>
      <strong className={s.kpiValue}>{value}</strong>
      <small className={s.kpiNote}>{note}</small>
    </div>
  );
}

export type { InvestorFigures };
