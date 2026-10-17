// The investor figures, facts only (lib/investorModel, 2026-10-17): the spend as booked, the no-card days' share
// left out, the signups and trials of the card trials, every paying customer counted (the no-card ones and the ones
// from before too), what Stripe collected, and the unit costs — on a fixture with hand-checked answers.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/investor-model.check.ts
import { addDays, daysBetween, daysFrom, dollars, factsLines, investorFacts, noCardDays, noCardShareByDay, spendPeriods, type FactsInput } from "../../../src/lib/investorModel";
import { buildInvestorVisitorsQuery } from "../../../src/lib/traffic-live";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const near = (a: number, b: number, tol = 0.001) => Math.abs(a - b) <= tol;

// Sep 30 → Oct 10. Meta $100 a day; Google $20 booked by hand on Oct 9. Trials needed no card Oct 5 – Oct 6.
const meta = daysFrom("2026-09-30", "2026-10-10").map((date) => ({ date, cents: 10000, platform: "meta" as const, source: "meta" as const }));
const base: FactsInput = {
  since: "2026-09-30",
  today: "2026-10-10",
  spend: [...meta, { date: "2026-10-09", cents: 2000, platform: "google", source: "manual" }, { date: "2026-09-01", cents: 99999, platform: "meta", source: "meta" }],
  signups: [
    { date: "2026-09-30", cohort: "card" }, // paid (A)
    { date: "2026-10-01", cohort: "card" }, // paid (B)
    { date: "2026-10-02", cohort: "card" }, // lapsed
    { date: "2026-10-08", cohort: "card" }, // on trial, $79
    { date: "2026-10-09", cohort: "card" }, // on trial, no price
    { date: "2026-10-05", cohort: "nocard" }, // paid (C)
    { date: "2026-10-05", cohort: "nocard" }, // lapsed
    { date: "2026-10-06", cohort: "nocard" }, // lapsed
  ],
  policy: [{ from: "2026-10-05", mode: "nocard" }, { from: "2026-10-07", mode: "card" }],
  paying: [
    { startedAt: "2026-10-08", monthlyCents: 7900, from: "card" },
    { startedAt: "2026-10-09", monthlyCents: 9900, from: "card" },
    { startedAt: "2026-10-09", monthlyCents: 7900, from: "nocard" },
    { startedAt: "2026-09-01", monthlyCents: 4900, from: "before" },
  ],
  trials: [{ createdAt: "2026-10-08", monthlyCents: 7900, cohort: "card" }, { createdAt: "2026-10-09", monthlyCents: null, cohort: "card" }],
  lapsed: { card: 1, nocard: 2 },
  visitors: 460,
  payments: [
    { date: "2026-10-08", cents: 7900 }, { date: "2026-10-09", cents: 9900 }, { date: "2026-10-09", cents: 7900 },
    { date: "2026-10-03", cents: 4900 }, { date: "2026-09-20", cents: 4900 }, // the last before the start day: not counted
  ],
};
const f = investorFacts(base);

console.log("── dates");
check("a day after Oct 6 is Oct 7; Sep 30 → Oct 6 is six days apart; Sep 30 → Oct 10 is eleven days", addDays("2026-10-06", 1) === "2026-10-07" && daysBetween("2026-09-30", "2026-10-06") === 6 && daysFrom("2026-09-30", "2026-10-10").length === 11);

console.log("── the spend: what was booked, the no-card days left out");
check("counted: $100 × 9 card days + $20 Google = $920; left out: $200 over Oct 5 – Oct 6", f.spend.cents === 92000 && f.leftOut.cents === 20000 && f.leftOut.days === 2 && f.leftOut.from === "2026-10-05" && f.leftOut.to === "2026-10-06", `${f.spend.cents} / ${f.leftOut.cents}`);
check("…and counted + left out is every dollar booked since the start (nothing before it)", f.spend.cents + f.leftOut.cents === 11 * 10000 + 2000);
const day = (d: string) => f.spend.days.find((r) => r.date === d)!;
check("a no-card day: nothing counted, all of it left out", day("2026-10-05").cents === 0 && day("2026-10-05").leftOutCents === 10000);
check("a day with Meta and a hand-booked platform reads 'mixed'; a Meta day 'meta'", day("2026-10-09").source === "mixed" && day("2026-10-09").cents === 12000 && day("2026-10-10").source === "meta");
check("one row a day from the start to today, with the card signups of the day", f.spend.days.length === 11 && day("2026-10-08").signups === 1 && day("2026-10-05").signups === 0);
check("Meta's days and the days booked by hand alone", f.spend.metaDays === 11 && f.spend.handDays === 0);
check("the last week: $520 over 7 days = $74/day (Oct 5–6 left out)", f.spend.perDayLast7Cents === Math.round(52000 / 7), String(f.spend.perDayLast7Cents));
check("the last day with spend is today", f.spend.lastDay === "2026-10-10");
check("by platform: Meta $900 over 9 days, Google $20 over 1", f.spend.byPlatform.length === 2 && f.spend.byPlatform[0].platform === "meta" && f.spend.byPlatform[0].cents === 90000 && f.spend.byPlatform[0].days === 9 && f.spend.byPlatform[1].cents === 2000 && f.spend.byPlatform[1].days === 1);
const per = Object.fromEntries(f.spend.periods.map((p) => [p.key, p]));
check("today $100 so far, yesterday $120", per.today.cents === 10000 && per.today.label === "Today, so far" && per.yesterday.cents === 12000);
check("this week (Mon Oct 5 →): $420 over 6 days", per.week.cents === 42000 && per.week.days === 6 && per.week.perDayCents === 7000);
check("this month (Oct 1 →): $820 over 10 days; since the start $920 over 11", per.month.cents === 82000 && per.month.days === 10 && per.all.cents === 92000 && per.all.days === 11);
check("last 30 days clips to the start day: 11 days, not 30", per.last30.days === 11 && per.last30.cents === 92000);
check("periods off plain day rows: one day, $5", spendPeriods([{ date: "2026-10-10", cents: 500 }], "2026-10-10")[0].cents === 500);

console.log("── the accounts");
check("trial signups are the card trials': 2 on trial + 2 paid + 1 lapsed = 5; 2 this past week", f.signups === 5 && f.signupsLast7 === 2);
check("on trial now: 2, one priced, $79 a month of plans", f.onTrial.count === 2 && f.onTrial.priced === 1 && f.onTrial.listMrrCents === 7900);
check("trials ended: 2 paid, 1 not — 67%", f.ended.paid === 2 && f.ended.lapsed === 1 && f.ended.pct === 67);
check("paying: 4 — 2 from card trials, 1 from the no-card test, 1 from before", f.paying.count === 4 && f.paying.card === 2 && f.paying.nocard === 1 && f.paying.before === 1);
check("monthly revenue counts every paying customer: $306, $3,672 a year", f.paying.mrrCents === 30600 && f.paying.arrCents === 367200 && f.paying.cardMrrCents === 17800 && f.paying.nocardMrrCents === 7900 && f.paying.beforeMrrCents === 4900);
check("the no-card test: 3 trials, 1 paid ($79 a month)", f.leftOut.signups === 3 && f.leftOut.paid === 1 && f.leftOut.paidMrrCents === 7900);

console.log("── the money in");
check("paid so far: $306 in 4 payments since the start (Sep 20 not counted)", f.collected !== null && f.collected.cents === 30600 && f.collected.payments === 4);
check("…33% of the counted ad spend", f.collected?.recoveredPct === 33);
const noStripe = investorFacts({ ...base, payments: null });
check("Stripe not read: no 'paid so far', and the chart's line is null — never a guess", noStripe.collected === null && noStripe.chart.every((p) => p.collectedCents === null));

console.log("── what a customer costs");
check("per visitor $2, per trial $184", f.unit.perVisitorCents === 200 && f.unit.perSignupCents === 18400);
check("per paying customer: $920 ÷ the 2 card trials that paid = $460 (the no-card one is not counted in, its spend is out)", f.unit.perPayingCents === 46000);
check("visitor → trial 1.1%", f.unit.visitorToSignupPct === 1.1);
check("paid back in: $460 ÷ $89 a month = 5.2 months", f.unit.paybackMonths === 5.2, String(f.unit.paybackMonths));
const noCardWins = investorFacts({ ...base, paying: base.paying.filter((p) => p.from !== "card"), signups: base.signups.filter((s) => !(s.cohort === "card" && s.date < "2026-10-02")) });
check("no card trial paid yet: no cost per paying customer and no payback — not a cheaper one from the no-card test", noCardWins.unit.perPayingCents === null && noCardWins.unit.paybackMonths === null && noCardWins.paying.count === 2);
check("no visitors known → no per-visitor figures", investorFacts({ ...base, visitors: null }).unit.perVisitorCents === null && investorFacts({ ...base, visitors: 0 }).unit.visitorToSignupPct === null);

console.log("── the chart");
const first = f.chart[0];
const last = f.chart.at(-1)!;
check("a point a day, from the start to today", f.chart.length === 11 && first.date === "2026-09-30" && last.date === "2026-10-10");
check("running totals: $920 spent, $306 paid, 5 trial signups", last.spentCents === 92000 && last.collectedCents === 30600 && last.signups === 5);
check("paying customers by day: the one from before from day one; 4 by today", first.paying === 1 && f.chart.find((p) => p.date === "2026-10-08")!.paying === 2 && last.paying === 4);
check("the spend stands still over the no-card days", f.chart.find((p) => p.date === "2026-10-06")!.spentCents === f.chart.find((p) => p.date === "2026-10-04")!.spentCents);

console.log("── the words");
const lines = factsLines(f);
check("first: the cost and what it brought", lines[0] === "Since September 30, 2026 the ads have cost $920 and brought 460 visitors and 5 trial signups.", lines[0]);
check("then: who pays, and what has been paid against the spend", lines[1] === "4 customers pay $306 a month — $3,672 a year; $306 has been paid so far, 33% of the ad spend.", lines[1]);
check("then: what a customer costs and how soon it pays back", lines[2] === "A customer from the ads cost $460 to win and pays $89 a month: the ads behind each one are paid back in 5.2 months.", lines[2]);
check("no spend yet: one line, no figures made up", factsLines(investorFacts({ ...base, spend: [] })).length === 1 && /No ad spend is on record/.test(factsLines(investorFacts({ ...base, spend: [] }))[0]));
check("dollars read as written", dollars(34220) === "$342" && dollars(158) === "$1.58" && dollars(0) === "$0");

console.log("── which kind of trial a day went to");
const days = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06"];
const su = [
  { date: "2026-10-01", cohort: "card" as const },
  { date: "2026-10-03", cohort: "nocard" as const },
  { date: "2026-10-04", cohort: "card" as const }, { date: "2026-10-04", cohort: "nocard" as const }, { date: "2026-10-04", cohort: "nocard" as const },
];
const sh = noCardShareByDay(days, su, []);
check("a day of card signups is a card day; a day of no-card signups a no-card day", sh.get("2026-10-01") === 0 && sh.get("2026-10-03") === 1);
check("a mixed day splits in proportion (1 card, 2 no-card → two thirds)", near(sh.get("2026-10-04") ?? -1, 2 / 3));
check("a day with no signups follows the nearest earlier day that had some", sh.get("2026-10-02") === 0 && near(sh.get("2026-10-05") ?? -1, 2 / 3) && near(sh.get("2026-10-06") ?? -1, 2 / 3));
const sh2 = noCardShareByDay(days, su, [{ from: "2026-10-05", mode: "card" }]);
check("a recorded flip outranks the signups from its day on", sh2.get("2026-10-05") === 0 && sh2.get("2026-10-06") === 0 && near(sh2.get("2026-10-04") ?? -1, 2 / 3));
check("with no signups and no flips every day is a card day", [...noCardShareByDay(days, [], []).values()].every((v) => v === 0));
const mixed = investorFacts({ ...base, policy: [], signups: [...base.signups.filter((s) => s.date !== "2026-10-05" && s.date !== "2026-10-06"), { date: "2026-10-05", cohort: "card" }, { date: "2026-10-05", cohort: "nocard" }] });
check("a half-and-half day: half its spend counted, half left out, to the cent", mixed.spend.days.find((r) => r.date === "2026-10-05")!.cents === 5000 && mixed.spend.days.find((r) => r.date === "2026-10-05")!.leftOutCents === 5000);
check("the visitor count skips the days that went wholly to no-card trials", JSON.stringify(noCardDays(base.since, base.today, base.signups, base.policy)) === JSON.stringify(["2026-10-05", "2026-10-06"]));
const q = buildInvestorVisitorsQuery("America/Los_Angeles", "2026-09-30", ["2026-10-05", "2026-10-06"]);
check("…and the query says so", q.includes("toString(day) NOT IN ('2026-10-05', '2026-10-06')") && !buildInvestorVisitorsQuery("America/Los_Angeles", "2026-09-30").includes("NOT IN"));
check("…a day that is not a date never reaches the query", !buildInvestorVisitorsQuery("America/Los_Angeles", "2026-09-30", ["2026-10-05'); DROP"]).includes("DROP"));

console.log(bad ? `\n${bad} FAILED` : "\nall good");
process.exit(bad ? 1 : 0);
