// THE INVESTOR FIGURES AS A PDF (2026-10-06) — the same reading as the page
// (lib/investors), on paper: the two lead sentences, the figures, the measured
// trial-to-paid rate and what it expects of the running trials, what came in
// against the spend, where the money went, the curve as a table of milestones,
// and how it is figured. Nothing assumed (2026-10-24). Built like ProposalPdf.
import * as React from "react";
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { InvestorReport } from "@/lib/investors";
import { dollars, longDate, outlookSentence, standingSentence, type CurvePoint } from "@/lib/investorModel";

const s = StyleSheet.create({
  page: { padding: 40, fontFamily: "Helvetica", fontSize: 10, color: "#0a0a0a" },
  kicker: { fontSize: 8, letterSpacing: 2, color: "#555", marginBottom: 6, textTransform: "uppercase" },
  h1: { fontSize: 22, fontFamily: "Helvetica-Bold", letterSpacing: -0.5, marginBottom: 4 },
  sub: { fontSize: 9, color: "#555", marginBottom: 16 },
  lead: { borderLeftWidth: 4, borderLeftColor: "#1854a0", paddingLeft: 10, marginBottom: 16 },
  leadText: { fontSize: 12, fontFamily: "Helvetica-Bold", lineHeight: 1.4 },
  leadMore: { fontSize: 9.5, color: "#2a2a2a", lineHeight: 1.45, marginTop: 4 },
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
  const r = f.rate;
  const ex = f.expected;
  const got = report.collected;
  const read = new Date(report.at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  const about = (v: number) => (Number.isInteger(v) ? String(v) : `about ${Math.round(v)}`);
  const range = r.lowPct !== null && r.highPct !== null ? `likely ${r.lowPct}–${r.highPct}%` : "";
  const exRange = ex.payersLow !== null && ex.payersHigh !== null && ex.payersLow !== ex.payersHigh ? `likely ${ex.payersLow}–${ex.payersHigh} · ` : "";
  const rows: Array<[string, string, string, boolean?]> = [
    ["Trials that ended", String(r.ended), r.ended === 0 ? "none yet" : `${r.paid} paying, ${r.ended - r.paid} did not stay`],
    ["Stay after the trial", pct(r.pct), r.pct === null ? "measured once a trial ends" : `${r.paid} of ${r.ended}${range ? ` · ${range}` : ""}`, true],
    ["On trial now", String(f.trials.count), `${dollars(f.trials.mrrCents)}/mo at list price`],
    ["Expected to pay", ex.payers === null ? "—" : about(ex.payers), ex.payers === null ? "no measured rate yet" : `${exRange}+${dollars(ex.mrrCents ?? 0)}/mo`],
    ["Monthly revenue then", dollars(ex.mrrWithPayingCents), `paying now ${dollars(f.paying.mrrCents)} + expected`, true],
  ];
  const costs: Array<[string, string, string, boolean?]> = [
    ["Spent on ads", dollars(f.spend.totalCents), `since ${longDate(f.since)}`],
    ["Collected so far", got.read ? dollars(got.cents) : "—", got.read ? `Stripe, ${got.invoices} payments${got.cents !== got.wonCents ? ` · ${dollars(got.wonCents)} from the ads' customers` : ""}` : "Stripe not read", true],
    ["Customers the ads brought", String(f.paying.won), `paying · ${dollars(f.paying.wonMrrCents)}/mo`],
    ["Per signup", money(f.unit.costPerSignupCents), `${f.signups} signed up`],
    ["Per paying customer", money(f.unit.costPerPayingCents), f.paying.won > 0 ? `${dollars(f.spend.totalCents)} ÷ ${f.paying.won}` : "none paying yet", true],
    ["Earns the spend back in", pct(f.unit.paybackMonths, " mo"), f.paying.wonMrrCents > 0 ? `at ${dollars(f.paying.wonMrrCents)} a month` : "once a customer pays"],
  ];
  return (
    <Document title="JobFlex · Investor figures" author="JobFlex">
      <Page size="LETTER" style={s.page}>
        <Text style={s.kicker}>JobFlex · Investors</Text>
        <Text style={s.h1}>Ads, trials and payback</Text>
        <Text style={s.sub}>Day {report.launch.day} since JobFlex launched on {longDate(report.launch.date)} · live figures since {longDate(f.since)}, the day the first campaign went live · read {read}</Text>
        <View style={s.lead}>
          <Text style={s.lbl}>Where the ads stand today</Text>
          <Text style={s.leadText}>{standingSentence(f)}</Text>
          <Text style={s.leadMore}>{outlookSentence(f)}</Text>
        </View>
        <View style={s.grid}>
          {[
            ["Ad spend", dollars(f.spend.totalCents), f.spend.dailyBudgetCents !== null && f.spend.budgetFrom ? `${dollars(f.spend.dailyBudgetCents)}/day, all ads, since ${longDate(f.spend.budgetFrom)}` : `${dollars(f.spend.perDayRecentCents)}/day lately`],
            ["Visitors", f.visitors === null ? "—" : f.visitors.toLocaleString("en-US"), f.visitors === null ? "analytics not reached" : `${money(f.unit.costPerVisitorCents)} each`],
            ["Signed up", String(f.signups), `${f.unit.signupsPerDay}/day · ${pct(f.unit.visitorToSignupPct)} of visitors`],
            ["Paying", String(f.paying.count), `${dollars(f.paying.mrrCents)}/mo · ${dollars(f.paying.arrCents)} a year${f.paying.preexisting > 0 ? ` · ${f.paying.preexisting} from before the start day` : ""}`],
            ["Stay after the trial", pct(r.pct), r.pct === null ? "no trial has ended yet" : `${r.paid} of ${r.ended} ended trials paying`],
            ["On trial now", String(f.trials.count), ex.payers === null ? "no measured rate yet" : `${about(ex.payers)} expected to pay · +${dollars(ex.mrrCents ?? 0)}/mo`],
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
            <Text style={s.h2}>Trial to paid, measured</Text>
            {rows.map(([l, v, nt, strong]) => (
              <View key={l} style={[s.row, ...(strong ? [s.rowStrong] : [])]}><Text style={s.c1}>{l}</Text><Text style={s.c2}>{v}</Text><Text style={s.c3}>{nt}</Text></View>
            ))}
          </View>
          <View style={s.half}>
            <Text style={s.h2}>Paying against the spend</Text>
            {costs.map(([l, v, nt, strong]) => (
              <View key={l} style={[s.row, ...(strong ? [s.rowStrong] : [])]}><Text style={s.c1}>{l}</Text><Text style={s.c2}>{v}</Text><Text style={s.c3}>{nt}</Text></View>
            ))}
          </View>
        </View>
        <Text style={s.h2}>The ad spend by period{report.meta.lastPulledAt ? " (Meta's own figures)" : ""}</Text>
        {report.periods.map((p) => (
          <View key={p.key} style={s.row}><Text style={s.c1}>{p.label}</Text><Text style={s.c2}>{dollars(p.cents)}</Text><Text style={s.c3}>{p.days === 0 ? "nothing yet" : `${dollars(p.perDayCents)}/day over ${p.days} ${p.days === 1 ? "day" : "days"}`}</Text></View>
        ))}
        <Text style={s.h2}>Ad spend against revenue, at list price</Text>
        <View style={s.row}><Text style={[s.c1, { fontFamily: "Helvetica-Bold" }]}>Day</Text><Text style={s.c2}>Spend</Text><Text style={s.c2}>Revenue</Text><Text style={s.c2}>Monthly</Text></View>
        {milestones(f.curve, f.today, f.breakEven.date).map((p) => (
          <View key={p.date} style={[s.row, ...(p.date === f.breakEven.date ? [s.rowStrong] : [])]}>
            <Text style={s.c1}>{longDate(p.date)}{p.date === f.today ? " · today" : p.date === f.breakEven.date ? " · break-even" : p.projected ? " · projected" : ""}</Text>
            <Text style={s.c2}>{dollars(p.spendCents)}</Text><Text style={s.c2}>{dollars(p.revenueCents)}</Text><Text style={s.c2}>{dollars(p.mrrCents)}</Text>
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
        <Text style={s.li}>· Counting from {longDate(f.since)}, the day the first campaign went live — only what happened from that day on. Visitors are unique people on www.jobflex.app, bots and previews out.{report.before.paying > 0 ? ` ${report.before.paying} ${report.before.paying === 1 ? "account" : "accounts"} paying from before that day (${dollars(report.before.mrrCents)}/mo) ${report.before.paying === 1 ? "is" : "are"} counted as paying, not as signups of the period.` : ""}</Text>
        <Text style={s.li}>· Nothing here is a share we chose. &quot;Stay after the trial&quot; is measured: of the trials that have ended since the start day, the share paying today ({r.pct === null ? "none has ended yet" : `${r.paid} of ${r.ended}`}); a trial that ran out, was canceled, or whose payment failed counts as not staying. &quot;Likely&quot; is the 90% range for that many trials. The running trials are expected to pay at the measured rate.</Text>
        <Text style={s.li}>· Ad spend is {a.dailyBudgetCents !== null && a.dailyBudgetCents !== undefined && a.budgetFrom ? `the daily budget, ${dollars(a.dailyBudgetCents)} for all ads together, counted as spent every day since ${longDate(a.budgetFrom)}` : "what was booked per day"}; tomorrow on it runs at the last full week&apos;s pace, {dollars(f.spend.perDayProjectedCents)} a day. &quot;Collected so far&quot; is what Stripe took for subscriptions since the start day from the accounts counted here.</Text>
        <Text style={s.li}>· {report.leftOut.signups > 0 ? `Left out on purpose: ${report.leftOut.signups} ${report.leftOut.signups === 1 ? "trial" : "trials"} that started with no card${report.leftOut.from ? ` (${report.leftOut.from === report.leftOut.to || !report.leftOut.to ? longDate(report.leftOut.from) : `${longDate(report.leftOut.from)} – ${longDate(report.leftOut.to)}`}, an experiment since ended)` : ""} and the ${dollars(report.leftOut.spendCents)} of ad spend over the ${report.leftOut.days} ${report.leftOut.days === 1 ? "day" : "days"} that brought them. ` : ""}Every trial counted here took a card at signup.</Text>
        <Text style={s.li}>· A trial is worth its plan&apos;s monthly list price (a yearly plan as a twelfth, a custom plan by its pages). Discounts, taxes and churn are not modelled.</Text>
        <Text style={s.li}>· The curve: a paying account earns a thirtieth of its monthly price a day from the day it started paying, a running trial at the measured rate from the day it ends; new signups arrive at {f.unit.signupsPerDay}/day at {dollars(f.trials.avgMonthlyCents)}/mo and pay at the measured rate after a {f.trials.lengthDays}-day trial; spend continues at {dollars(f.spend.perDayProjectedCents)}/day for {a.horizonDays} days.</Text>
        </View>
        <View style={s.foot} fixed><Text>JobFlex · investor figures · {read}</Text><Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} /></View>
      </Page>
    </Document>
  );
}
