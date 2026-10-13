// The investor figures (lib/investorModel, 2026-10-06): spend, trials, the
// realistic share, the payback curve and its break-even — on fixtures with
// hand-checked answers.
//   npx --no-install tsx --tsconfig tsconfig.json scripts/qa/investor-model.check.ts
import { addDays, cohortFigures, daysBetween, dollars, investorFigures, noCardShareByDay, paybackSentence, perDay, spendPeriods, type ModelInput } from "../../src/lib/investorModel";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const near = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;

const base: ModelInput = {
  since: "2026-09-30",
  today: "2026-10-06",
  spend: [
    { date: "2026-09-30", cents: 10000 }, { date: "2026-10-01", cents: 10000 }, { date: "2026-10-02", cents: 10000 },
    { date: "2026-10-03", cents: 10000 }, { date: "2026-10-04", cents: 10000 }, { date: "2026-10-05", cents: 10000 }, { date: "2026-10-06", cents: 10000 },
    { date: "2026-09-01", cents: 99999 }, // before the launch: not counted
  ],
  paying: [{ startedAt: "2026-10-02", monthlyCents: 7900 }, { startedAt: "2026-10-06", monthlyCents: 7900 }],
  trials: [
    { createdAt: "2026-10-04", endsAt: "2026-10-11", monthlyCents: 7900, chance: 0.45 },
    { createdAt: "2026-10-05", endsAt: "2026-10-12", monthlyCents: 2900, chance: 0.2 },
    { createdAt: "2026-10-06", endsAt: "2026-10-13", monthlyCents: 19900, chance: 0.15 },
    { createdAt: "2026-10-06", endsAt: null, monthlyCents: null, chance: 0.15 },
  ],
  lapsed: 1,
  assumptions: { realisticPct: 60, spendPerDayCents: null, horizonDays: 180, trialDays: 7, dailyBudgetCents: null, budgetFrom: null },
  visitors: 700,
};

console.log("── dates");
check("a day after Oct 6 is Oct 7; Sep 30 → Oct 6 is six days apart", addDays("2026-10-06", 1) === "2026-10-07" && daysBetween("2026-09-30", "2026-10-06") === 6);
check("a pace over the last seven days (or since the launch when younger)", near(perDay(["2026-10-06", "2026-10-05", "2026-10-05", "2026-09-29"], "2026-09-30", "2026-10-06"), 3 / 7, 0.001) && near(perDay(["2026-10-06"], "2026-10-05", "2026-10-06"), 0.5, 0.001));

const f = investorFigures(base);
console.log("── spend");
check("spend since the launch only: $700 over 7 days, $100 a day", f.spend.totalCents === 70000 && f.spend.daysWithSpend === 7 && f.spend.perDayRecentCents === 10000 && f.spend.perDayProjectedCents === 10000 && f.spend.lastDate === "2026-10-06");
check("a set projected figure projects instead of the recent average", investorFigures({ ...base, assumptions: { ...base.assumptions, spendPerDayCents: 5000 } }).spend.perDayProjectedCents === 5000);
console.log("── the daily budget");
const budgetOnly = investorFigures({ ...base, spend: [], assumptions: { ...base.assumptions, dailyBudgetCents: 5000, budgetFrom: "2026-10-01" } });
check("a $50 daily budget since Oct 1 with nothing booked: six days spent, $300, projected at $50", budgetOnly.spend.totalCents === 30000 && budgetOnly.spend.budgetDays === 6 && budgetOnly.spend.bookedDays === 0 && budgetOnly.spend.perDayProjectedCents === 5000 && budgetOnly.curve[1].spendSource === "budget" && budgetOnly.curve[0].spendSource === "none" && budgetOnly.curve[7].spendDayCents === 5000 && budgetOnly.curve[7].spendSource === "projected");
const budgetAndBooked = investorFigures({ ...base, assumptions: { ...base.assumptions, dailyBudgetCents: 5000, budgetFrom: "2026-10-01" } });
check("a booked day overrides the budget: all seven days booked, still $700, no budget days", budgetAndBooked.spend.totalCents === 70000 && budgetAndBooked.spend.budgetDays === 0 && budgetAndBooked.spend.bookedDays === 7 && budgetAndBooked.curve[3].spendSource === "booked");
const budgetEarly = investorFigures({ ...base, spend: [], assumptions: { ...base.assumptions, dailyBudgetCents: 5000, budgetFrom: "2026-09-01" } });
check("a budget from before the start day counts from the start day: 7 days, $350", budgetEarly.spend.totalCents === 35000 && budgetEarly.spend.budgetFrom === "2026-09-30" && budgetEarly.spend.budgetDays === 7);
check("the owner's projected figure beats the budget for tomorrow on", investorFigures({ ...base, spend: [], assumptions: { ...base.assumptions, dailyBudgetCents: 5000, budgetFrom: null, spendPerDayCents: 8000 } }).spend.perDayProjectedCents === 8000);
console.log("── spend by period");
const per = Object.fromEntries(spendPeriods(f.curve, "2026-10-06").map((p) => [p.key, p]));
check("today $100, yesterday $100, this week (Mon Oct 5 →) $200 over 2 days", per.today.cents === 10000 && per.yesterday.cents === 10000 && per.week.cents === 20000 && per.week.days === 2 && per.week.perDayCents === 10000);
check("this month (Oct 1 →) $600 over 6 days; last 7 and since the start $700 over 7", per.month.cents === 60000 && per.month.days === 6 && per.last7.cents === 70000 && per.all.cents === 70000 && per.all.days === 7);
check("last 30 days clips to the start day: 7 days, not 30", per.last30.days === 7 && per.last30.cents === 70000 && per.last30.perDayCents === 10000);
check("a budget-filled day counts like a booked one", Object.fromEntries(spendPeriods(budgetOnly.curve, "2026-10-06").map((p) => [p.key, p])).last7.cents === 30000);
console.log("── the curve's run-rate and accounts");
const t0 = f.curve[6];
check("today: MRR $158 (two paying, no trial ended), 2 paying, 6 signed up (trial or paying)", t0.mrrRealisticCents === 15800 && t0.mrrAllPayCents === 15800 && t0.payingRealistic === 2 && t0.payingAllPay === 2 && t0.signups === 6);
const t11 = f.curve.find((p) => p.date === "2026-10-11")!;
check("Oct 11: the first trial counts as 0.6 of a paying account realistically, 1 if all pay; MRR all-pay $237", t11.payingAllPay === 3 && t11.payingRealistic === 2.6 && t11.mrrAllPayCents === 15800 + 7900 && t11.mrrRealisticCents === Math.round(15800 + 7900 * 0.6));
const tEnd = f.curve.at(-1)!;
check("at the horizon: signups grew at 0.86 a day, realistic paying under all-pay, MRR grew", tEnd.signups > 6 + 0.86 * 179 && tEnd.payingRealistic < tEnd.payingAllPay && tEnd.mrrRealisticCents > t0.mrrRealisticCents, `${tEnd.signups} signups, ${tEnd.payingRealistic}/${tEnd.payingAllPay} paying, MRR ${tEnd.mrrRealisticCents}`);

console.log("── trials and paying");
check("4 trials, 3 priced: $307 if all pay, $184 realistic at 60%, average $102", f.trials.count === 4 && f.trials.priced === 3 && f.trials.maxMrrCents === 30700 && f.trials.realisticMrrCents === 18420 && f.trials.avgMonthlyCents === 10233);
check("by behaviour: 0.45×79 + 0.2×29 + 0.15×199 = $71 (23%)", f.trials.byBehaviourMrrCents === 3555 + 580 + 2985 && f.trials.byBehaviourPct === 23);
check("paying: 2 accounts, $158 MRR, $1,896 ARR", f.paying.count === 2 && f.paying.mrrCents === 15800 && f.paying.arrCents === 189600);
check("revenue to date at list price: 5 days of $79 + 1 day of $79 = $15.80", f.paying.revenueToDateCents === Math.round((7900 * 5) / 30) + Math.round(7900 / 30));
check("signups = trials + paying + lapsed = 7; observed share paid 2 of 3 = 67%", f.signups === 7 && f.observed.paid === 2 && f.observed.lapsed === 1 && f.observed.pct === 67);
check("projected MRR: all pay $465, realistic $342, by behaviour $229", f.projected.mrrAllPayCents === 46500 && f.projected.mrrRealisticCents === 34220 && f.projected.mrrByBehaviourCents === 15800 + 7120);

console.log("── unit economics");
check("cost per visitor $1, per signup $100, per paying (2 + 4×0.6) $159", f.unit.costPerVisitorCents === 100 && f.unit.costPerSignupCents === 10000 && f.unit.costPerPayingRealisticCents === Math.round(70000 / 4.4));
check("visitor → signup 1%, 6 signups over 7 days = 0.86 a day", f.unit.visitorToSignupPct === 1 && f.unit.signupsPerDay === 0.86);
check("payback: $700 ÷ $342 a month = 2 months; return to date 2%", f.unit.paybackMonths === 2 && f.unit.returnToDatePct === 2);

console.log("── the curve");
check("one point per day from the launch to the horizon, booked then projected", f.curve.length === 7 + 180 && f.curve[0].date === "2026-09-30" && !f.curve[6].projected && f.curve[7].projected);
check("spend runs: $700 today, $800 tomorrow", f.curve[6].spendCents === 70000 && f.curve[7].spendCents === 80000);
const today = f.curve[6];
check("revenue today (all-pay = realistic while only paying accounts earn): $15.80", today.allPayCents === today.realisticCents && near(today.realisticCents, 1580, 2));
const oct11 = f.curve.find((p) => p.date === "2026-10-11")!;
const oct10 = f.curve.find((p) => p.date === "2026-10-10")!;
check("the first trial starts earning on its end day, Oct 11 ($79/30 all-pay, 60% of it realistic)", near(oct11.allPayCents - oct10.allPayCents, (15800 + 7900) / 30, 2) && near(oct11.realisticCents - oct10.realisticCents, (15800 + 7900 * 0.6) / 30, 2));
check("the realistic line stays under the all-pay line once trials earn", f.curve.at(-1)!.realisticCents < f.curve.at(-1)!.allPayCents);
check("future signups (0.86 a day at $102) start earning seven days after they arrive", f.curve[14].allPayCents - f.curve[13].allPayCents > f.curve[13].allPayCents - f.curve[12].allPayCents);
check("break-even: a date within the horizon, after today", f.breakEven.withinHorizon && f.breakEven.date !== null && f.breakEven.daysFromToday! > 0 && f.breakEven.daysFromToday! < 180, `${f.breakEven.date} in ${f.breakEven.daysFromToday} days`);
const cross = f.curve.find((p) => p.date === f.breakEven.date)!;
const before = f.curve[f.curve.indexOf(cross) - 1];
check("…and it is the first day realistic revenue meets the spend", cross.realisticCents >= cross.spendCents && before.realisticCents < before.spendCents);

console.log("── what moves it");
const allPay = investorFigures({ ...base, assumptions: { ...base.assumptions, realisticPct: 100 } });
check("at 100% the realistic line is the all-pay line and break-even comes sooner", allPay.curve.every((p) => p.realisticCents === p.allPayCents) && allPay.breakEven.daysFromToday! < f.breakEven.daysFromToday!);
const heavy = investorFigures({ ...base, assumptions: { ...base.assumptions, spendPerDayCents: 100000 } });
check("$1,000 a day with this revenue never breaks even in the horizon, and the sentence says so", !heavy.breakEven.withinHorizon && /do not pay for themselves/.test(paybackSentence(heavy)));
const none = investorFigures({ ...base, spend: [] });
check("no spend: nothing to recover, no unit costs", none.spend.totalCents === 0 && none.unit.costPerSignupCents === null && none.unit.paybackMonths === null && /No ad spend is set yet/.test(paybackSentence(none)));
const covered = investorFigures({ ...base, spend: [{ date: "2026-09-30", cents: 500 }] });
check("$5 of spend is already covered: the sentence says so", /already covered/.test(paybackSentence(covered)));
check("the sentence names the pace, the share and the date", /\$100 a day on ads, 0\.86 signups a day, 60% of trials paying/.test(paybackSentence(f)) && /on [A-Z][a-z]+ \d+, 202\d\./.test(paybackSentence(f)), paybackSentence(f));
check("no visitors known → no per-visitor figures", investorFigures({ ...base, visitors: null }).unit.costPerVisitorCents === null && investorFigures({ ...base, visitors: 0 }).unit.visitorToSignupPct === null);
check("dollars read as written", dollars(34220) === "$342" && dollars(158) === "$1.58" && dollars(0) === "$0");


// ── THE TWO KINDS OF TRIAL (2026-10-13): a day's spend follows the switch where recorded, else who signed up
console.log("── cohorts");
const days = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06"];
const su = [
  { date: "2026-10-01", cohort: "card" as const },
  { date: "2026-10-03", cohort: "nocard" as const },
  { date: "2026-10-04", cohort: "card" as const }, { date: "2026-10-04", cohort: "nocard" as const }, { date: "2026-10-04", cohort: "nocard" as const },
];
const sh = noCardShareByDay(days, su, []);
check("a day of card signups is a card day; a day of no-card signups a no-card day", sh.get("2026-10-01") === 0 && sh.get("2026-10-03") === 1);
check("a mixed day splits in proportion (1 card, 2 no-card → two thirds)", near(sh.get("2026-10-04") ?? -1, 2 / 3, 0.001));
check("a day with no signups follows the nearest earlier day that had some", sh.get("2026-10-02") === 0 && near(sh.get("2026-10-05") ?? -1, 2 / 3, 0.001) && near(sh.get("2026-10-06") ?? -1, 2 / 3, 0.001));
const sh2 = noCardShareByDay(days, su, [{ from: "2026-10-05", mode: "card" }]);
check("a recorded flip outranks the signups from its day on", sh2.get("2026-10-05") === 0 && sh2.get("2026-10-06") === 0 && near(sh2.get("2026-10-04") ?? -1, 2 / 3, 0.001));
check("with no signups and no flips every day is a card day (the only kind before the switch)", [...noCardShareByDay(days, [], []).values()].every((v) => v === 0));

const withCohorts: ModelInput = {
  ...base,
  paying: [{ startedAt: "2026-10-02", monthlyCents: 7900, cohort: "card" }, { startedAt: "2026-10-06", monthlyCents: 7900, signedUpAt: "2026-10-05", cohort: "nocard" }],
  trials: [
    { createdAt: "2026-10-04", endsAt: "2026-10-11", monthlyCents: 7900, chance: 0.45, cohort: "card" },
    { createdAt: "2026-10-05", endsAt: "2026-10-12", monthlyCents: 2900, chance: 0.2, cohort: "nocard" },
    { createdAt: "2026-10-06", endsAt: "2026-10-13", monthlyCents: 19900, chance: 0.15, cohort: "nocard" },
    { createdAt: "2026-10-06", endsAt: null, monthlyCents: null, chance: 0.15, cohort: "nocard" },
  ],
  lapsed: 1,
  cohorts: {
    lapsed: { card: 1, nocard: 0 },
    signups: [
      { date: "2026-09-30", cohort: "card" }, { date: "2026-10-02", cohort: "card" }, { date: "2026-10-04", cohort: "card" },
      { date: "2026-10-05", cohort: "nocard" }, { date: "2026-10-05", cohort: "nocard" }, { date: "2026-10-06", cohort: "nocard" }, { date: "2026-10-06", cohort: "nocard" },
    ],
    policy: [],
    current: "nocard",
  },
};
const whole = investorFigures(withCohorts);
const card = cohortFigures(withCohorts, "card", whole);
const nocard = cohortFigures(withCohorts, "nocard", whole);
check("the two cohorts' spend adds up to the whole ($700: $500 card days, $200 no-card days)", card.attributedCents + nocard.attributedCents === whole.spend.totalCents && card.attributedCents === 50000 && nocard.attributedCents === 20000, `${card.attributedCents} + ${nocard.attributedCents}`);
check("…over the days each fell on (Sep 30–Oct 4 card, Oct 5–6 no card)", card.attributedDays === 5 && nocard.attributedDays === 2 && card.firstDay === "2026-09-30" && nocard.firstDay === "2026-10-05");
check("each cohort counts its own accounts", card.figures.trials.count === 1 && card.figures.paying.count === 1 && card.figures.lapsed === 1 && nocard.figures.trials.count === 3 && nocard.figures.paying.count === 1 && nocard.figures.lapsed === 0);
check("…and its signups add up to the whole", card.signups + nocard.signups === whole.signups);
check("the kind a new signup gets today keeps spending forward; the other stands still", nocard.current && nocard.figures.spend.perDayProjectedCents === whole.spend.perDayProjectedCents && !card.current && card.figures.spend.perDayProjectedCents === 0);
check("…so the card cohort's spend curve is flat past today", card.figures.curve.filter((p) => p.projected).every((p) => p.spendCents === card.attributedCents));
check("visitors are not split", card.figures.visitors === null && nocard.figures.visitors === null && card.figures.unit.costPerVisitorCents === null);
check("cost per signup is each cohort's own", card.figures.unit.costPerSignupCents === Math.round(50000 / card.signups) && nocard.figures.unit.costPerSignupCents === Math.round(20000 / nocard.signups));
const plain = cohortFigures(base, "card");
check("an input without the cohort block reads as all card, no spend split lost", plain.attributedCents === investorFigures(base).spend.totalCents && plain.figures.trials.count === base.trials.length);


// ── PAYING FROM BEFORE THE START DAY (2026-10-13): counted as paying, in the revenue and the payback; not a signup
console.log("── pre-period paying");
const withBefore: ModelInput = { ...base, paying: [...base.paying, { startedAt: "2026-09-01", monthlyCents: 9900, signedUpAt: "2026-08-20", cohort: "card", preexisting: true }] };
const fb = investorFigures(withBefore);
const f0 = investorFigures(base);
check("it counts as paying, in the run rate", fb.paying.count === f0.paying.count + 1 && fb.paying.mrrCents === f0.paying.mrrCents + 9900 && fb.paying.preexisting === 1 && fb.paying.preexistingMrrCents === 9900);
check("…its revenue counts from the start day only (7 days of $99 = $23.10)", fb.paying.revenueToDateCents === f0.paying.revenueToDateCents + 2310, `${fb.paying.revenueToDateCents - f0.paying.revenueToDateCents}`);
check("…it is not a signup, and does not move the pace, the cost per signup or the observed share", fb.signups === f0.signups && fb.unit.signupsPerDay === f0.unit.signupsPerDay && fb.unit.costPerSignupCents === f0.unit.costPerSignupCents && fb.observed.pct === f0.observed.pct);
check("…nor the cost per paying customer (the ads did not win it)", fb.unit.costPerPayingRealisticCents === f0.unit.costPerPayingRealisticCents);
check("…but it pays into the curve from the first day", fb.curve[0].mrrAllPayCents === f0.curve[0].mrrAllPayCents + 9900 && fb.curve[0].payingAllPay === f0.curve[0].payingAllPay + 1);
const cardB = cohortFigures({ ...withCohorts, paying: [...withCohorts.paying, { startedAt: "2026-09-01", monthlyCents: 9900, cohort: "card", preexisting: true }] }, "card");
const nocardB = cohortFigures({ ...withCohorts, paying: [...withCohorts.paying, { startedAt: "2026-09-01", monthlyCents: 9900, cohort: "card", preexisting: true }] }, "nocard");
check("it sits in the card cohort's paying, not in no card's, and not in either's signups", cardB.figures.paying.count === card.figures.paying.count + 1 && cardB.figures.paying.preexisting === 1 && cardB.signups === card.signups && nocardB.figures.paying.count === nocard.figures.paying.count);

console.log(bad === 0 ? "\nAll investor model checks passed." : `\n${bad} investor model check(s) FAILED.`);
process.exit(bad === 0 ? 0 : 1);
