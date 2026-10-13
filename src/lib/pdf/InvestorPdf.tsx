// THE INVESTOR FIGURES AS A PDF (2026-10-06) — the same reading as the page
// (lib/investors), on paper: the payback sentence, the figures, the three
// monthly revenues, what a customer costs, where the money went, the curve
// as a table of milestones, and how it is figured. Built like ProposalPdf.
import * as React from "react";
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { InvestorReport } from "@/lib/investors";
import { dollars, longDate, paybackSentence, type CurvePoint } from "@/lib/investorModel";

const s = StyleSheet.create({
  page: { padding: 40, fontFamily: "Helvetica", fontSize: 10, color: "#0a0a0a" },
  kicker: { fontSize: 8, letterSpacing: 2, color: "#555", marginBottom: 6, textTransform: "uppercase" },
  h1: { fontSize: 22, fontFamily: "Helvetica-Bold", letterSpacing: -0.5, marginBottom: 4 },
  sub: { fontSize: 9, color: "#555", marginBottom: 16 },
  lead: { borderLeftWidth: 4, borderLeftColor: "#1854a0", paddingLeft: 10, marginBottom: 16 },
  leadText: { fontSize: 12, fontFamily: "Helvetica-Bold", lineHeight: 1.4 },
  grid: { flexDirection: "row", flexWrap: "wrap", borderWidth: 1.5, borderColor: "#0a0a0a", marginBottom: 14 },
  cell: { width: "33.33%", padding: 8, borderRightWidth: 1, borderBottomWidth: 1, borderColor: "#ddd" },
  lbl: { fontSize: 7, letterSpacing: 1.2, color: "#555", textTransform: "uppercase", marginBottom: 3 },
  val: { fontSize: 16, fontFamily: "Helvetica-Bold" },
  note: { fontSize: 7.5, color: "#555", marginTop: 2 },
  h2: { fontSize: 10, fontFamily: "Helvetica-Bold", letterSpacing: 1.5, textTransform: "uppercase", marginTop: 10, marginBottom: 6 },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#ddd", paddingVertical: 4 },
  rowStrong: { backgroundColor: "#f2f0eb" },
  c1: { width: "42%" }, c2: { width: "18%", textAlign: "right", fontFamily: "Helvetica-Bold", paddingRight: 10 }, c3: { width: "40%", color: "#555", fontSize: 8.5 },
  two: { flexDirection: "row", gap: 18 }, half: { width: "50%" },
  li: { fontSize: 8.5, color: "#2a2a2a", lineHeight: 1.45, marginBottom: 3 },
  foot: { position: "absolute", bottom: 24, left: 40, right: 40, fontSize: 7.5, color: "#777", flexDirection: "row", justifyContent: "space-between" },
});

const money = (v: number | null) => (v === null ? "—" : dollars(v));
const pct = (v: number | null, suffix = "%") => (v === null ? "—" : `${v}${suffix}`);

/** The curve at a few milestones — today, the break-even, and every 30 days. */
function milestones(curve: CurvePoint[], today: string, breakEven: string | null): CurvePoint[] {
  const picks = new Set<string>([curve[0]?.date, today, breakEven ?? "", curve.at(-1)?.date ?? ""]);
  const ti = curve.findIndex((p) => p.date === today);
  for (let i = ti + 30; i < curve.length; i += 30) picks.add(curve[i].date);
  return curve.filter((p) => picks.has(p.date));
}

export function InvestorPdfDocument({ report }: { report: InvestorReport }) {
  const f = report.figures;
  const a = report.settings;
  const read = new Date(report.at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  const rows: Array<[string, string, string, boolean?]> = [
    ["Paying now", dollars(f.paying.mrrCents), `${f.paying.count} accounts at list price`],
    ["If every trial pays", dollars(f.projected.mrrAllPayCents), `+ ${dollars(f.trials.maxMrrCents)} from ${f.trials.priced} priced trials`],
    [`Realistic · ${a.realisticPct}% of trials`, dollars(f.projected.mrrRealisticCents), "the share used for the break-even", true],
    ["By behaviour", dollars(f.projected.mrrByBehaviourCents), `${pct(f.trials.byBehaviourPct)} of trials, from what each account has done`],
  ];
  // The two kinds of trial (2026-10-13): the same figures for each, side by side.
  const co = report.cohorts;
  const kinds: Array<[string, string, string]> = [
    ["Ad spend attributed", `${dollars(co.card.attributedCents)} · ${co.card.attributedDays}d`, `${dollars(co.nocard.attributedCents)} · ${co.nocard.attributedDays}d`],
    ["Signed up", String(co.card.signups), String(co.nocard.signups)],
    ["On free trial · paying · lapsed", `${co.card.figures.trials.count} · ${co.card.figures.paying.count} · ${co.card.figures.lapsed}`, `${co.nocard.figures.trials.count} · ${co.nocard.figures.paying.count} · ${co.nocard.figures.lapsed}`],
    ["Observed pay rate", pct(co.card.figures.observed.pct), pct(co.nocard.figures.observed.pct)],
    ["Cost per signup", money(co.card.figures.unit.costPerSignupCents), money(co.nocard.figures.unit.costPerSignupCents)],
    ["Realistic MRR", dollars(co.card.figures.projected.mrrRealisticCents), dollars(co.nocard.figures.projected.mrrRealisticCents)],
    ["Break-even", co.card.figures.breakEven.date ? longDate(co.card.figures.breakEven.date) : "not within the horizon", co.nocard.figures.breakEven.date ? longDate(co.nocard.figures.breakEven.date) : "not within the horizon"],
  ];
  const costs: Array<[string, string, string, boolean?]> = [
    ["Per visitor", money(f.unit.costPerVisitorCents), f.visitors === null ? "no visitor count" : `${f.visitors.toLocaleString("en-US")} visitors`],
    ["Per signup", money(f.unit.costPerSignupCents), `${f.signups} signed up`],
    ["Per paying customer", money(f.unit.costPerPayingRealisticCents), `paying now plus ${a.realisticPct}% of trials`, true],
    ["Pays back in", pct(f.unit.paybackMonths, " mo"), `at ${dollars(f.projected.mrrRealisticCents)} a month`],
  ];
  return (
    <Document title="JobFlex · Investor figures" author="JobFlex">
      <Page size="LETTER" style={s.page}>
        <Text style={s.kicker}>JobFlex · Investors</Text>
        <Text style={s.h1}>Ads, trials and payback</Text>
        <Text style={s.sub}>Live figures since {longDate(f.since)}, the day the first campaign went live · read {read}</Text>
        <View style={s.lead}>
          <Text style={s.lbl}>When the ads pay for themselves</Text>
          <Text style={s.leadText}>{paybackSentence(f)}</Text>
        </View>
        <View style={s.grid}>
          {[
            ["Ad spend", dollars(f.spend.totalCents), f.spend.dailyBudgetCents !== null && f.spend.budgetFrom ? `${dollars(f.spend.dailyBudgetCents)}/day, all ads, since ${longDate(f.spend.budgetFrom)}` : `${dollars(f.spend.perDayRecentCents)}/day lately`],
            ["Visitors", f.visitors === null ? "—" : f.visitors.toLocaleString("en-US"), f.visitors === null ? "analytics not reached" : `${money(f.unit.costPerVisitorCents)} each`],
            ["Signed up", String(f.signups), `${f.unit.signupsPerDay}/day · ${pct(f.unit.visitorToSignupPct)} of visitors`],
            ["On free trial", String(f.trials.count), `${dollars(f.trials.maxMrrCents)}/mo if all pay`],
            ["Paying", String(f.paying.count), `${dollars(f.paying.mrrCents)}/mo · ${dollars(f.paying.arrCents)} a year${f.paying.preexisting > 0 ? ` · ${f.paying.preexisting} from before the start day` : ""}`],
            ["Realistic MRR", dollars(f.projected.mrrRealisticCents), `paying + ${a.realisticPct}% of trials`],
          ].map(([l, v, nt]) => (
            <View key={l} style={s.cell}>
              <Text style={s.lbl}>{l}</Text>
              <Text style={s.val}>{v}</Text>
              <Text style={s.note}>{nt}</Text>
            </View>
          ))}
        </View>
        <View style={s.two}>
          <View style={s.half}>
            <Text style={s.h2}>Monthly revenue, three ways</Text>
            {rows.map(([l, v, nt, strong]) => (
              <View key={l} style={[s.row, ...(strong ? [s.rowStrong] : [])]}><Text style={s.c1}>{l}</Text><Text style={s.c2}>{v}</Text><Text style={s.c3}>{nt}</Text></View>
            ))}
          </View>
          <View style={s.half}>
            <Text style={s.h2}>What a customer costs</Text>
            {costs.map(([l, v, nt, strong]) => (
              <View key={l} style={[s.row, ...(strong ? [s.rowStrong] : [])]}><Text style={s.c1}>{l}</Text><Text style={s.c2}>{v}</Text><Text style={s.c3}>{nt}</Text></View>
            ))}
          </View>
        </View>
        <Text style={s.h2}>The two kinds of trial · a new signup now gets {co.current === "nocard" ? "no card" : "a card"}{co.currentSince ? ` (since ${longDate(co.currentSince)})` : ""}</Text>
        <View style={s.row}><Text style={[s.c1, { fontFamily: "Helvetica-Bold" }]}> </Text><Text style={[s.c2, { fontFamily: "Helvetica-Bold" }]}>With a card</Text><Text style={[s.c2, { fontFamily: "Helvetica-Bold" }]}>No card</Text></View>
        {kinds.map(([l, c1, c2]) => (
          <View key={l} style={s.row}><Text style={s.c1}>{l}</Text><Text style={s.c2}>{c1}</Text><Text style={s.c2}>{c2}</Text></View>
        ))}
        <Text style={s.h2}>The ad spend by period{report.meta.lastPulledAt ? " (Meta's own figures)" : ""}</Text>
        {report.periods.map((p) => (
          <View key={p.key} style={s.row}><Text style={s.c1}>{p.label}</Text><Text style={s.c2}>{dollars(p.cents)}</Text><Text style={s.c3}>{p.days === 0 ? "nothing yet" : `${dollars(p.perDayCents)}/day over ${p.days} ${p.days === 1 ? "day" : "days"}`}</Text></View>
        ))}
        {report.campaigns.length > 0 && (
          <>
            <Text style={s.h2}>By campaign, since {report.insights?.campaignsSince ? longDate(report.insights.campaignsSince) : "the start"}</Text>
            <View style={s.row}><Text style={[s.c1, { fontFamily: "Helvetica-Bold" }]}>Campaign</Text><Text style={s.c2}>Spent</Text><Text style={s.c2}>Clicks</Text><Text style={s.c2}>Signed up</Text><Text style={s.c2}>Per signup</Text></View>
            {report.campaigns.slice(0, 12).map((c) => (
              <View key={c.id} style={s.row}><Text style={s.c1}>{c.name}</Text><Text style={s.c2}>{dollars(c.spendCents)}</Text><Text style={s.c2}>{c.clicks.toLocaleString("en-US")}</Text><Text style={s.c2}>{c.signups}</Text><Text style={s.c2}>{c.costPerSignupCents === null ? "—" : dollars(c.costPerSignupCents)}</Text></View>
            ))}
          </>
        )}
        <Text style={s.h2}>Ad spend against revenue, at list price</Text>
        <View style={s.row}><Text style={[s.c1, { fontFamily: "Helvetica-Bold" }]}>Day</Text><Text style={s.c2}>Spend</Text><Text style={s.c2}>Realistic revenue</Text><Text style={s.c2}>If every trial pays</Text></View>
        {milestones(f.curve, f.today, f.breakEven.date).map((p) => (
          <View key={p.date} style={[s.row, ...(p.date === f.breakEven.date ? [s.rowStrong] : [])]}>
            <Text style={s.c1}>{longDate(p.date)}{p.date === f.today ? " · today" : p.date === f.breakEven.date ? " · break-even" : p.projected ? " · projected" : ""}</Text>
            <Text style={s.c2}>{dollars(p.spendCents)}</Text><Text style={s.c2}>{dollars(p.realisticCents)}</Text><Text style={s.c2}>{dollars(p.allPayCents)}</Text>
          </View>
        ))}
        {report.spend.byPlatform.length > 0 && (
          <>
            <Text style={s.h2}>Where the ad money went</Text>
            {report.spend.byPlatform.map((p) => (
              <View key={p.platform} style={s.row}><Text style={s.c1}>{p.label}</Text><Text style={s.c2}>{dollars(p.cents)}</Text><Text style={s.c3}>{p.days} days · {dollars(Math.round(p.cents / Math.max(1, p.days)))}/day</Text></View>
            ))}
          </>
        )}
        <View wrap={false}>
        <Text style={s.h2}>How these are figured</Text>
        <Text style={s.li}>· Counting from {longDate(f.since)}, the day the first campaign went live — only what happened from that day on. Visitors are unique people on www.jobflex.app, bots and previews out.{report.before.paying > 0 ? ` ${report.before.paying} ${report.before.paying === 1 ? "account" : "accounts"} paying from before that day (${dollars(report.before.mrrCents)}/mo) ${report.before.paying === 1 ? "is" : "are"} counted under With a card as paying, not as signups of the period.` : ""}</Text>
        <Text style={s.li}>· Ad spend is {f.spend.dailyBudgetCents !== null && f.spend.budgetFrom ? `the daily budget, ${dollars(f.spend.dailyBudgetCents)} for all ads together, counted as spent every day since ${longDate(f.spend.budgetFrom)}` : "what was booked per day"}; tomorrow on it is projected at {dollars(f.spend.perDayProjectedCents)} a day.</Text>
        <Text style={s.li}>· A trial is worth its plan&apos;s monthly list price (a yearly plan as a twelfth, a custom plan by its pages). Discounts, taxes and churn are not modelled.</Text>
        <Text style={s.li}>· The realistic share is {a.realisticPct}% of trials paying; &quot;by behaviour&quot; reads each account&apos;s activity instead.</Text>
        <Text style={s.li}>· The curve: a paying account earns a thirtieth of its monthly price a day from the day it started paying, a trial from the day it ends; new signups arrive at {f.unit.signupsPerDay}/day at {dollars(f.trials.avgMonthlyCents)}/mo and pay after a {a.trialDays}-day trial; spend continues at {dollars(f.spend.perDayProjectedCents)}/day for {a.horizonDays} days.</Text>
        </View>
        <View style={s.foot} fixed><Text>JobFlex · investor figures · {read}</Text><Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} /></View>
      </Page>
    </Document>
  );
}
