// THE INVESTOR FIGURES AS A PDF (2026-10-06; facts only since 2026-10-17) — the same reading as the page
// (lib/investors), on paper: the plain sentences, the four figures, the spend by period, from visitor to paying
// customer, what customers pay, what a customer costs, where the money went, and how each figure is made. Nothing
// forecast. Built like ProposalPdf.
import * as React from "react";
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { InvestorReport } from "@/lib/investors";
import { dollars, factsLines, longDate } from "@/lib/investorModel";

const s = StyleSheet.create({
  page: { padding: 40, fontFamily: "Helvetica", fontSize: 10, color: "#0a0a0a" },
  kicker: { fontSize: 8, letterSpacing: 2, color: "#555", marginBottom: 6, textTransform: "uppercase" },
  h1: { fontSize: 22, fontFamily: "Helvetica-Bold", letterSpacing: -0.5, marginBottom: 4 },
  sub: { fontSize: 9, color: "#555", marginBottom: 16 },
  lead: { borderLeftWidth: 4, borderLeftColor: "#1854a0", paddingLeft: 10, marginBottom: 16 },
  leadText: { fontSize: 11.5, fontFamily: "Helvetica-Bold", lineHeight: 1.4, marginBottom: 3 },
  grid: { flexDirection: "row", flexWrap: "wrap", borderWidth: 1.5, borderColor: "#0a0a0a", marginBottom: 14 },
  cell: { width: "25%", padding: 8, borderRightWidth: 1, borderColor: "#ddd" },
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
const plural = (v: number, one: string, many: string) => `${v.toLocaleString("en-US")} ${v === 1 ? one : many}`;
const shortDate = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const span = (from: string | null, to: string | null) => (!from ? "" : !to || to === from ? shortDate(from) : `${shortDate(from)} – ${shortDate(to)}`);

type Row = [string, string, string, boolean?];
function Table({ rows }: { rows: Row[] }) {
  return (
    <>
      {rows.map(([l, v, nt, strong]) => (
        <View key={l} style={[s.row, ...(strong ? [s.rowStrong] : [])]}><Text style={s.c1}>{l}</Text><Text style={s.c2}>{v}</Text><Text style={s.c3}>{nt}</Text></View>
      ))}
    </>
  );
}

export function InvestorPdfDocument({ report }: { report: InvestorReport }) {
  const f = report.facts;
  const lo = f.leftOut;
  const read = new Date(report.at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  const cardAvg = f.paying.card ? Math.round(f.paying.cardMrrCents / f.paying.card) : null;
  const funnel: Row[] = [
    ["Visitors", f.visitors === null ? "—" : f.visitors.toLocaleString("en-US"), f.visitors === null ? "analytics not reached" : `${money(f.unit.perVisitorCents)} of ads each`],
    ["Started a trial", String(f.signups), `${f.unit.visitorToSignupPct !== null ? `${f.unit.visitorToSignupPct}% of visitors · ` : ""}${money(f.unit.perSignupCents)} each`],
    ["Trials ended", String(f.ended.paid + f.ended.lapsed), `${f.onTrial.count} still on trial`],
    ["Paid", String(f.ended.paid), f.ended.pct !== null ? `${f.ended.pct}% of ended trials · ${money(f.unit.perPayingCents)} of ads each` : "no trial has ended yet", true],
  ];
  const revenue: Row[] = [
    ["Monthly revenue", dollars(f.paying.mrrCents), plural(f.paying.count, "paying customer", "paying customers"), true],
    ["A year", dollars(f.paying.arrCents), "monthly revenue × 12"],
    ...(f.paying.card ? [["From card trials", dollars(f.paying.cardMrrCents), plural(f.paying.card, "customer", "customers")] as Row] : []),
    ...(f.paying.nocard ? [["From the no-card test", dollars(f.paying.nocardMrrCents), `${plural(f.paying.nocard, "customer", "customers")} who started with no card, then paid`] as Row] : []),
    ...(f.paying.before ? [["From before the ads", dollars(f.paying.beforeMrrCents), `${plural(f.paying.before, "customer", "customers")} paying before ${shortDate(f.since)}`] as Row] : []),
    ["Paid so far", f.collected ? dollars(f.collected.cents) : "—", f.collected ? `${plural(f.collected.payments, "payment", "payments")}, as Stripe took them` : report.stripe.error ?? "Stripe not read", true],
  ];
  const costs: Row[] = [
    ["Per visitor", money(f.unit.perVisitorCents), f.visitors === null ? "no visitor count" : plural(f.visitors, "visitor", "visitors")],
    ["Per trial", money(f.unit.perSignupCents), plural(f.signups, "trial started", "trials started")],
    ["Per paying customer", money(f.unit.perPayingCents), `the ad spend ÷ ${plural(f.paying.card, "card trial that paid", "card trials that paid")}`, true],
    ["Paid back in", f.unit.paybackMonths === null ? "—" : `${f.unit.paybackMonths} mo`, cardAvg !== null && f.unit.perPayingCents !== null ? `${dollars(f.unit.perPayingCents)} ÷ ${dollars(cardAvg)} a month` : "once a card trial pays"],
  ];
  return (
    <Document title="JobFlex · Investor figures" author="JobFlex">
      <Page size="LETTER" style={s.page}>
        <Text style={s.kicker}>JobFlex · Investors</Text>
        <Text style={s.h1}>Ads, customers and revenue</Text>
        <Text style={s.sub}>Since {longDate(f.since)}, the day the first campaign went live — every figure a fact, nothing forecast · read {read}</Text>
        <View style={s.lead}>
          <Text style={s.lbl}>Where the ads stand · {longDate(f.today)}</Text>
          {factsLines(f).map((l) => <Text key={l} style={s.leadText}>{l}</Text>)}
        </View>
        <View style={s.grid}>
          {[
            ["Spent on ads", dollars(f.spend.cents), `${dollars(f.spend.perDayLast7Cents)}/day this past week`],
            ["Paying customers", String(f.paying.count), [f.paying.card ? `${f.paying.card} from card trials` : "", f.paying.nocard ? `${f.paying.nocard} from the no-card test` : "", f.paying.before ? `${f.paying.before} from before` : ""].filter(Boolean).join(" · ")],
            ["Monthly revenue", dollars(f.paying.mrrCents), `${dollars(f.paying.arrCents)} a year`],
            ["Paid so far", f.collected ? dollars(f.collected.cents) : "—", f.collected?.recoveredPct != null ? `${f.collected.recoveredPct}% of the ad spend` : "Stripe not read"],
          ].map(([l, v, nt]) => (
            <View key={l} style={s.cell}>
              <Text style={s.lbl}>{l}</Text>
              <Text style={s.val}>{v}</Text>
              <Text style={s.note}>{nt}</Text>
            </View>
          ))}
        </View>
        <Text style={s.h2}>The ad spend{report.meta.lastPulledAt ? ` (Meta's own figures, read ${new Date(report.meta.lastPulledAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })})` : ""}</Text>
        <Table rows={f.spend.periods.map((p) => [p.label, dollars(p.cents), p.days === 0 ? "nothing yet" : `${dollars(p.perDayCents)}/day over ${plural(p.days, "day", "days")}`] as Row)} />
        {lo.cents > 0 && <Text style={[s.li, { marginTop: 4 }]}>Left out: {dollars(lo.cents)} spent {span(lo.from, lo.to)} while a new signup could start a free trial with no card ({plural(lo.signups, "trial", "trials")}){lo.paid > 0 ? `; ${lo.paid} of them went on to pay and ${lo.paid === 1 ? "is" : "are"} counted as paying` : ""}.</Text>}
        <View style={s.two}>
          <View style={s.half}>
            <Text style={s.h2}>From visitor to paying customer</Text>
            <Table rows={funnel} />
          </View>
          <View style={s.half}>
            <Text style={s.h2}>What a customer costs</Text>
            <Table rows={costs} />
          </View>
        </View>
        <Text style={s.h2}>What customers pay</Text>
        <Table rows={revenue} />
        {f.spend.byPlatform.length > 0 && (
          <>
            <Text style={s.h2}>Where the ad money went</Text>
            <Table rows={f.spend.byPlatform.map((p) => [p.label, dollars(p.cents), `${plural(p.days, "day", "days")} · ${dollars(Math.round(p.cents / Math.max(1, p.days)))}/day`] as Row)} />
          </>
        )}
        <View wrap={false}>
          <Text style={s.h2}>How these are figured</Text>
          <Text style={s.li}>· Everything here has happened: no forecast, no share of trials that &quot;will&quot; pay, no budget counted as spent. Counting from {longDate(f.since)}.</Text>
          <Text style={s.li}>· Ad spend is {report.meta.configured ? "Meta's own figure for each day" : "the spend booked for each day"}{f.spend.handDays ? `, with ${plural(f.spend.handDays, "day", "days")} booked by hand` : ""}; today&apos;s is the spend so far today.</Text>
          {lo.cents > 0 || lo.signups > 0 ? (
            <Text style={s.li}>· Left out on purpose: the {dollars(lo.cents)} of ad spend on the {plural(lo.days, "day", "days")} ({span(lo.from, lo.to)}) when a new signup could start a free trial with no card, and the {plural(lo.signups, "trial", "trials")} started that way. {lo.paid > 0 ? `${lo.paid} of them went on to pay (${dollars(lo.paidMrrCents)} a month) and count as paying customers — not in the cost of a customer, since their ad spend is not counted either.` : "None of them is paying."}</Text>
          ) : null}
          <Text style={s.li}>· Visitors are unique people on www.jobflex.app on the days the card trials&apos; ads ran, bots and previews out.</Text>
          <Text style={s.li}>· Monthly revenue is each paying customer&apos;s plan price (a yearly plan as a twelfth). &quot;Paid so far&quot; is what Stripe collected for subscriptions since the start day, before any refund.{f.paying.before ? ` ${plural(f.paying.before, "customer", "customers")} paying from before the start day count as paying, not as trials of the period.` : ""}</Text>
          <Text style={s.li}>· The cost of a paying customer is the counted ad spend ÷ the card trials that paid; paid back in = that cost ÷ what one of them pays a month.</Text>
        </View>
        <View style={s.foot} fixed><Text>JobFlex · investor figures · {read}</Text><Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} /></View>
      </Page>
    </Document>
  );
}
