// The investor figures (lib/investorModel, 2026-10-06): spend, trials, the
// MEASURED share that stays after the trial (2026-10-24 — no assumed share),
// what it expects of the running trials, the payback curve and its break-even
// — on fixtures with hand-checked answers.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/investor-model.check.ts
import { addDays, apartDays, daysBetween, dollars, investorFigures, launchDay, noCardShareByDay, outlookSentence, splitApart, perDay, spendPeriods, standingSentence, wilson, type ModelInput } from "../../../src/lib/investorModel";

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
    { createdAt: "2026-10-04", endsAt: "2026-10-11", monthlyCents: 7900 },
    { createdAt: "2026-10-05", endsAt: "2026-10-12", monthlyCents: 2900 },
    { createdAt: "2026-10-06", endsAt: "2026-10-13", monthlyCents: 19900 },
    { createdAt: "2026-10-06", endsAt: null, monthlyCents: null },
  ],
  lapsed: 1,
  settings: { horizonDays: 180, trialDays: 14, dailyBudgetCents: null, budgetFrom: null },
  visitors: 700,
};

console.log("── dates");
check("a day after Oct 6 is Oct 7; Sep 30 → Oct 6 is six days apart", addDays("2026-10-06", 1) === "2026-10-07" && daysBetween("2026-09-30", "2026-10-06") === 6);
check("a pace over the last seven days (or since the launch when younger)", near(perDay(["2026-10-06", "2026-10-05", "2026-10-05", "2026-09-29"], "2026-09-30", "2026-10-06"), 3 / 7, 0.001) && near(perDay(["2026-10-06"], "2026-10-05", "2026-10-06"), 0.5, 0.001));

const f = investorFigures(base);
console.log("── spend");
check("spend since the launch only: $700 over 7 days", f.spend.totalCents === 70000 && f.spend.daysWithSpend === 7 && f.spend.lastDate === "2026-10-06");
check("the pace is the last FULL days (today is still running): Sep 30–Oct 5, $100 a day, and it runs forward", f.spend.perDayRecentCents === 10000 && f.spend.perDayProjectedCents === 10000);
const partialToday = investorFigures({ ...base, spend: base.spend.map((d) => (d.date === "2026-10-06" ? { ...d, cents: 1500 } : d)) });
check("a half-read today (Meta's $15 so far) does not drag the pace down", partialToday.spend.perDayProjectedCents === 10000 && partialToday.spend.totalCents === 61500);
console.log("── the daily budget");
const budgetOnly = investorFigures({ ...base, spend: [], settings: { ...base.settings, dailyBudgetCents: 5000, budgetFrom: "2026-10-01" } });
check("a $50 daily budget since Oct 1 with nothing booked: six days spent, $300", budgetOnly.spend.totalCents === 30000 && budgetOnly.spend.budgetDays === 6 && budgetOnly.spend.bookedDays === 0 && budgetOnly.curve[1].spendSource === "budget" && budgetOnly.curve[0].spendSource === "none");
check("…and forward at what the last full days spent ($250 over Sep 30–Oct 5 = $41.67), not at a figure we chose", budgetOnly.spend.perDayProjectedCents === 4167);
const budgetAndBooked = investorFigures({ ...base, settings: { ...base.settings, dailyBudgetCents: 5000, budgetFrom: "2026-10-01" } });
check("a booked day overrides the budget: all seven days booked, still $700, no budget days", budgetAndBooked.spend.totalCents === 70000 && budgetAndBooked.spend.budgetDays === 0 && budgetAndBooked.spend.bookedDays === 7 && budgetAndBooked.curve[3].spendSource === "booked");
const budgetEarly = investorFigures({ ...base, spend: [], settings: { ...base.settings, dailyBudgetCents: 5000, budgetFrom: "2026-09-01" } });
check("a budget from before the start day counts from the start day: 7 days, $350", budgetEarly.spend.totalCents === 35000 && budgetEarly.spend.budgetFrom === "2026-09-30" && budgetEarly.spend.budgetDays === 7);
console.log("── spend by period");
const per = Object.fromEntries(spendPeriods(f.curve, "2026-10-06").map((p) => [p.key, p]));
check("today $100, yesterday $100, this week (Mon Oct 5 →) $200 over 2 days", per.today.cents === 10000 && per.yesterday.cents === 10000 && per.week.cents === 20000 && per.week.days === 2 && per.week.perDayCents === 10000);
check("this month (Oct 1 →) $600 over 6 days; last 7 and since the start $700 over 7", per.month.cents === 60000 && per.month.days === 6 && per.last7.cents === 70000 && per.all.cents === 70000 && per.all.days === 7);
check("last 30 days clips to the start day: 7 days, not 30", per.last30.days === 7 && per.last30.cents === 70000 && per.last30.perDayCents === 10000);

console.log("── the measured rate");
check("ended trials = paying + lapsed: 2 of 3 stay = 67%", f.rate.paid === 2 && f.rate.ended === 3 && f.rate.pct === 67);
check("its 90% range for three trials is wide: 25–92%", f.rate.lowPct === 25 && f.rate.highPct === 92, `${f.rate.lowPct}–${f.rate.highPct}`);
const w = wilson(5, 10)!;
check("the range: none with no trials; 5 of 10 sits around a half; 50 of 100 is narrower than 5 of 10", wilson(0, 0) === null && near(w.low + w.high, 1, 0.001) && wilson(50, 100)!.high - wilson(50, 100)!.low < w.high - w.low);
check("0 of 4 still has an upper bound above zero; 4 of 4 a lower one under one", wilson(0, 4)!.low === 0 && wilson(0, 4)!.high > 0 && wilson(4, 4)!.high === 1 && wilson(4, 4)!.low < 1);
check("no share set anywhere: the settings carry none", !("realisticPct" in base.settings) && !("spendPerDayCents" in base.settings));

console.log("── the running trials at that rate");
check("4 running, 3 priced: $307 a month at list price, $102 average", f.trials.count === 4 && f.trials.priced === 3 && f.trials.mrrCents === 30700 && f.trials.avgMonthlyCents === 10233);
check("expected to pay: 4 × 2/3 = 2.7, likely 1–4", f.expected.payers === 2.7 && f.expected.payersLow === 1 && f.expected.payersHigh === 4, `${f.expected.payers} (${f.expected.payersLow}–${f.expected.payersHigh})`);
check("…adding $307 × 2/3 = $204.67 a month; with the paying $158 = $362.67", f.expected.mrrCents === 20467 && f.expected.mrrWithPayingCents === 36267);
check("the trial length is what the running trials show (7 days), not the setting (14)", f.trials.lengthDays === 7);
check("…and the setting only when no running trial has its end on record", investorFigures({ ...base, trials: base.trials.map((t) => ({ ...t, endsAt: null })) }).trials.lengthDays === 14);

console.log("── paying against the spend");
check("paying: 2 accounts, $158 MRR, $1,896 ARR; both won by the period", f.paying.count === 2 && f.paying.mrrCents === 15800 && f.paying.arrCents === 189600 && f.paying.won === 2 && f.paying.wonMrrCents === 15800);
check("revenue to date at list price: 5 days of $79 + 1 day of $79 = $15.80", f.paying.revenueToDateCents === Math.round((7900 * 5) / 30) + Math.round(7900 / 30));
check("signups = trials + paying + lapsed = 7", f.signups === 7);
check("cost per paying customer is counted, not expected: $700 ÷ 2 = $350", f.unit.costPerPayingCents === 35000);
check("earns the spend back in $700 ÷ $158 = 4.4 months; return to date 2%", f.unit.paybackMonths === 4.4 && f.unit.returnToDatePct === 2);
check("cost per visitor $1, per signup $100; visitor → signup 1%", f.unit.costPerVisitorCents === 100 && f.unit.costPerSignupCents === 10000 && f.unit.visitorToSignupPct === 1);
check("signup pace over the full days: 3 signups Sep 30–Oct 5 = 0.5 a day", f.unit.signupsPerDay === 0.5);
const withLapsedDates = investorFigures({ ...base, lapsedSignups: [{ date: "2026-10-03" }] });
check("a lapsed signup counts in the pace too — the rate applies to every signup, the leavers included", withLapsedDates.unit.signupsPerDay === 0.67 && withLapsedDates.curve[6].signups === 7);

console.log("── the curve");
check("one point per day from the launch to the horizon, booked then projected", f.curve.length === 7 + 180 && f.curve[0].date === "2026-09-30" && !f.curve[6].projected && f.curve[7].projected);
check("spend runs: $700 today, $800 tomorrow", f.curve[6].spendCents === 70000 && f.curve[7].spendCents === 80000);
const t0 = f.curve[6];
check("today: MRR $158, 2 paying, 6 signed up (no trial over yet)", t0.mrrCents === 15800 && t0.paying === 2 && t0.signups === 6);
const oct11 = f.curve.find((p) => p.date === "2026-10-11")!;
const oct10 = f.curve.find((p) => p.date === "2026-10-10")!;
check("Oct 11: the first trial ends and counts at the measured 2/3 — MRR $158 + $52.67, 2.7 paying", oct11.mrrCents === Math.round(15800 + 7900 * (2 / 3)) && oct11.paying === 2.7 && oct10.mrrCents === 15800);
check("…its revenue grows by that day's MRR ÷ 30", near(oct11.revenueCents - oct10.revenueCents, (15800 + 7900 * (2 / 3)) / 30, 2));
check("future signups (0.5 a day at $102) start earning at the rate seven days after they arrive", f.curve[14].revenueCents - f.curve[13].revenueCents > f.curve[13].revenueCents - f.curve[12].revenueCents);
check("break-even: a date within the horizon, after today", f.breakEven.withinHorizon && f.breakEven.date !== null && f.breakEven.daysFromToday! > 0 && f.breakEven.daysFromToday! < 180, `${f.breakEven.date} in ${f.breakEven.daysFromToday} days`);
const cross = f.curve.find((p) => p.date === f.breakEven.date)!;
const before = f.curve[f.curve.indexOf(cross) - 1];
check("…and it is the first day revenue meets the spend", cross.revenueCents >= cross.spendCents && before.revenueCents < before.spendCents);

console.log("── no rate yet, or none staying");
const noneEnded = investorFigures({ ...base, paying: [], lapsed: 0 });
check("no trial ended: no rate, no range, nothing expected", noneEnded.rate.pct === null && noneEnded.rate.lowPct === null && noneEnded.expected.payers === null && noneEnded.expected.mrrCents === null && noneEnded.expected.mrrWithPayingCents === 0);
check("…the curve counts no running trial (nothing to predict with)", noneEnded.curve.every((p) => p.mrrCents === 0 && p.paying === 0));
check("…and the sentence says there is no measured rate", /No trial has ended yet, so there is no measured rate/.test(standingSentence(noneEnded)) && /Until a trial ends/.test(outlookSentence(noneEnded)), standingSentence(noneEnded));
const noneStayed = investorFigures({ ...base, paying: [], lapsed: 3 });
check("3 ended, none paying: 0%, 0 expected, the running trials add nothing", noneStayed.rate.pct === 0 && noneStayed.expected.payers === 0 && noneStayed.expected.mrrCents === 0 && noneStayed.rate.highPct! > 0);
check("…no cost per paying customer and no payback", noneStayed.unit.costPerPayingCents === null && noneStayed.unit.paybackMonths === null);

console.log("── the sentences");
const standing = standingSentence(f);
check("what the ads bought, the measured rate, and what it says of the running trials", /^\$700 on ads since Sep 30 brought 7 signups with a card\./.test(standing) && /Of the 3 trials that have ended, 2 converted to paid — 67%\./.test(standing) && /about 3 of the 4 trials running now will pay too \(likely 1–4\)\./.test(standing), standing);
check("no 60%, no 'if every trial pays', no 'realistic' anywhere", !/realistic|every trial pays|60%/i.test(standing + outlookSentence(f)));
check("the outlook names the pace, the measured share and the date", /\$100 a day on ads, 0\.5 signups a day, 67% of trials paying/.test(outlookSentence(f)) && /on [A-Z][a-z]+ \d+, 202\d\./.test(outlookSentence(f)), outlookSentence(f));
const heavy = investorFigures({ ...base, forwardSpendCents: 100000 });
check("$1,000 a day with this revenue never breaks even in the horizon, and the sentence says so", !heavy.breakEven.withinHorizon && /do not pay for themselves/.test(outlookSentence(heavy)));
const none = investorFigures({ ...base, spend: [] });
check("no spend: nothing to earn back, no unit costs", none.spend.totalCents === 0 && none.unit.costPerSignupCents === null && none.unit.paybackMonths === null && /nothing to earn back/.test(outlookSentence(none)) && /No ad spend is booked/.test(standingSentence(none)));
const covered = investorFigures({ ...base, spend: [{ date: "2026-09-30", cents: 500 }] });
check("$5 of spend is already covered: the sentence says so", /already covered/.test(outlookSentence(covered)));
check("no visitors known → no per-visitor figures", investorFigures({ ...base, visitors: null }).unit.costPerVisitorCents === null && investorFigures({ ...base, visitors: 0 }).unit.visitorToSignupPct === null);
check("dollars read as written", dollars(34220) === "$342" && dollars(158) === "$1.58" && dollars(0) === "$0");

console.log("── days since launch");
check("the launch day is day 1; Oct 5 → Oct 24 is day 20", launchDay("2026-10-24", "2026-10-24").day === 1 && launchDay("2026-10-05", "2026-10-24").day === 20);
check("across a month and a year end: Sep 30 → Oct 6 is day 7, Dec 31 → Jan 1 is day 2", launchDay("2026-09-30", "2026-10-06").day === 7 && launchDay("2026-12-31", "2027-01-01").day === 2);
check("a launch day still ahead reads as day 0, never negative; 'set' says whether the owner gave it", launchDay("2026-11-01", "2026-10-24").day === 0 && launchDay("2026-10-05", "2026-10-24", false).set === false);


// ── HOW THE TRIALS ENDED (2026-10-25): converted = paid at the end or later; only who never paid counts against
console.log("── how the trials ended");
const ended: ModelInput = { ...base, outcomes: [
  { date: "2026-10-01", outcome: "paid", payingNow: true },
  { date: "2026-10-02", outcome: "came-back", payingNow: true, afterDays: 5 },
  { date: "2026-10-02", outcome: "canceled", payingNow: false },
  { date: "2026-10-03", outcome: "retrying", payingNow: false },
] };
const fe = investorFigures(ended);
check("paid at the end + came back later = 2 converted; canceled = 1 not; the card still retried is in neither: 2 of 3 = 67%", fe.rate.paid === 2 && fe.rate.ended === 3 && fe.rate.pct === 67);
check("the count of who came back later (1, after 5 days), and the rest kept for the QA", fe.outcomes?.cameBack === 1 && fe.outcomes?.cameBackDays === 5 && fe.outcomes?.paidAtEnd === 1 && fe.outcomes?.canceled === 1 && fe.outcomes?.retrying === 1 && fe.outcomes?.unpaid === 0);
const left = investorFigures({ ...base, outcomes: [{ date: "2026-10-01", outcome: "paid", payingNow: false }, { date: "2026-10-02", outcome: "came-back", payingNow: false, afterDays: 9 }, { date: "2026-10-02", outcome: "unpaid", payingNow: false }] });
check("a converted one that left since still converted (2 of 3); never paid counts against", left.rate.paid === 2 && left.rate.ended === 3 && left.outcomes?.leftAfterPaying === 2 && left.outcomes?.unpaid === 1);
check("the lead says how many came back", /2 converted to paid \(1 of them came back after the trial had ended\) — 67%/.test(standingSentence(fe)), standingSentence(fe));
check("no outcomes read: the rate falls back to paying ÷ paying + lapsed, and there is no count", f.outcomes === null && f.rate.paid === 2 && f.rate.ended === 3);
const withOc: ModelInput = { ...base, outcomes: [{ date: "2026-10-05", cohort: "nocard", outcome: "paid", payingNow: true }, { date: "2026-10-02", cohort: "card", outcome: "came-back", payingNow: true, afterDays: 3 }, { date: "2026-10-02", cohort: "card", outcome: "canceled", payingNow: false }], cohorts: { lapsed: { card: 1, nocard: 0 }, signups: [{ date: "2026-10-02", cohort: "card" }, { date: "2026-10-05", cohort: "nocard" }], policy: [], current: "card" } };
const cutOc = splitApart(withOc);
check("each side reads its own outcomes: the card side 1 of 2 (1 came back), the no-card day's outcome stays out", cutOc.card.rate.paid === 1 && cutOc.card.rate.ended === 2 && cutOc.card.outcomes?.cameBack === 1 && cutOc.apart.rate.paid === 1 && cutOc.apart.rate.ended === 1);


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
    { createdAt: "2026-10-04", endsAt: "2026-10-11", monthlyCents: 7900, cohort: "card" },
    { createdAt: "2026-10-05", endsAt: "2026-10-12", monthlyCents: 2900, cohort: "nocard" },
    { createdAt: "2026-10-06", endsAt: "2026-10-13", monthlyCents: 19900, cohort: "nocard" },
    { createdAt: "2026-10-06", endsAt: null, monthlyCents: null, cohort: "nocard" },
  ],
  lapsed: 1,
  lapsedSignups: [{ date: "2026-10-01", cohort: "card" }],
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
// ── KEPT APART (2026-10-24): a day with any no-card share goes apart WHOLE, with every signup on it
console.log("── kept apart");
check("a day goes apart whole on any no-card share — the mixed Oct 4 too", [...apartDays(days, su, [])].sort().join() === "2026-10-03,2026-10-04,2026-10-05,2026-10-06");
const whole = investorFigures(withCohorts);
const cut = splitApart(withCohorts, whole);
check("the no-card days Oct 5–6 go apart; the card days stay; the start day stays (they are not all first)", cut.days.join() === "2026-10-05,2026-10-06" && cut.cardSince === "2026-09-30" && cut.card.since === "2026-09-30");
check("their WHOLE spend goes apart ($200) and the card days keep theirs ($500) — together the whole", cut.spendCents === 20000 && cut.apart.spend.totalCents === 20000 && cut.card.spend.totalCents === 50000 && cut.card.spend.totalCents + cut.spendCents === whole.spend.totalCents);
check("each side counts its own accounts: card 1 trial, 1 won, 1 lapsed; apart 3 trials, 1 paying", cut.card.trials.count === 1 && cut.card.paying.won === 1 && cut.card.lapsed === 1 && cut.apart.trials.count === 3 && cut.apart.paying.count === 1 && cut.apart.lapsed === 0);
check("a no-card trial that pays now joins the card side's paying, marked (2026-10-25): 2 paying, 1 from no card, $79", cut.card.paying.count === 2 && cut.card.paying.fromNoCard === 1 && cut.card.paying.fromNoCardMrrCents === 7900 && cut.card.paying.mrrCents === 15800);
check("…but not its signups, its rate, or the cost of a customer: $500 ÷ 1 won", cut.card.signups === 3 && cut.card.rate.paid === 1 && cut.card.unit.costPerPayingCents === 50000 && cut.card.unit.paybackMonths === Math.round((50000 / 7900) * 10) / 10);
check("…the signups add up to the whole, and the apart ones are told by kind (4 no card, 0 card)", cut.card.signups + cut.apart.signups === whole.signups && cut.signups.nocard === 4 && cut.signups.card === 0);
check("each side measures its own rate: card 1 of 2 = 50%, no card 1 of 1 = 100%", cut.card.rate.pct === 50 && cut.card.rate.ended === 2 && cut.apart.rate.pct === 100 && cut.apart.rate.ended === 1);
check("the kind a new signup gets today keeps spending forward (no card here); the card side stands still", cut.apart.spend.perDayProjectedCents === whole.spend.perDayProjectedCents && cut.card.spend.perDayProjectedCents === 0 && cut.card.curve.filter((p) => p.projected).every((p) => p.spendCents === 50000));
check("visitors stay with the card side only", cut.card.visitors === withCohorts.visitors && cut.apart.visitors === null);
const anyway: ModelInput = { ...withCohorts, trials: [...withCohorts.trials, { createdAt: "2026-10-05", endsAt: "2026-10-12", monthlyCents: 9900, cohort: "card" }], cohorts: { ...withCohorts.cohorts!, signups: [...withCohorts.cohorts!.signups, { date: "2026-10-05", cohort: "card" }] } };
const cutAnyway = splitApart(anyway);
check("a card given anyway on a no-card day goes apart too — it came in under the no-card offer", cutAnyway.card.trials.count === 1 && cutAnyway.apart.trials.count === 4 && cutAnyway.signups.card === 1 && cutAnyway.signups.nocard === 4);
const strayPolicy = [{ from: "2026-10-02", mode: "card" as const }, { from: "2026-10-05", mode: "nocard" as const }];
const stray: ModelInput = { ...withCohorts, trials: [...withCohorts.trials, { createdAt: "2026-10-03", endsAt: "2026-10-10", monthlyCents: 4900, cohort: "nocard" }], cohorts: { ...withCohorts.cohorts!, policy: strayPolicy, signups: [...withCohorts.cohorts!.signups, { date: "2026-10-03", cohort: "nocard" }] } };
const cutStray = splitApart(stray);
check("a no-card trial on a card day (the switch said card) goes apart as an account; its day's spend stays", !cutStray.days.includes("2026-10-03") && cutStray.apart.trials.count === 4 && cutStray.card.spend.totalCents === 50000);
const early: ModelInput = { ...withCohorts, cohorts: { ...withCohorts.cohorts!, signups: [{ date: "2026-09-30", cohort: "nocard" }, { date: "2026-10-01", cohort: "nocard" }, { date: "2026-10-02", cohort: "card" }, { date: "2026-10-04", cohort: "card" }] } };
const cutEarly = splitApart(early);
check("no-card days that all come first: the card figures count from the first card day (Oct 2)", cutEarly.days.join() === "2026-09-30,2026-10-01" && cutEarly.cardSince === "2026-10-02" && cutEarly.card.since === "2026-10-02" && cutEarly.card.daysLive === 5 && cutEarly.card.spend.totalCents === 50000 && cutEarly.card.curve[0].date === "2026-10-02");
check("with no no-card days and no cohort block: nothing apart, the card side is the whole", (() => { const c = splitApart(base); return c.days.length === 0 && c.spendCents === 0 && c.card.spend.totalCents === investorFigures(base).spend.totalCents && c.card.trials.count === base.trials.length && c.apart.signups === 0; })());


// ── PAYING FROM BEFORE THE START DAY (2026-10-13): counted as paying, in the revenue and the payback; not a signup
console.log("── pre-period paying");
const withBefore: ModelInput = { ...base, paying: [...base.paying, { startedAt: "2026-09-01", monthlyCents: 9900, signedUpAt: "2026-08-20", cohort: "card", preexisting: true }] };
const fb = investorFigures(withBefore);
const f0 = investorFigures(base);
check("it counts as paying, in the run rate", fb.paying.count === f0.paying.count + 1 && fb.paying.mrrCents === f0.paying.mrrCents + 9900 && fb.paying.preexisting === 1 && fb.paying.preexistingMrrCents === 9900);
check("…its revenue counts from the start day only (7 days of $99 = $23.10)", fb.paying.revenueToDateCents === f0.paying.revenueToDateCents + 2310, `${fb.paying.revenueToDateCents - f0.paying.revenueToDateCents}`);
check("…it is not a signup, and does not move the pace, the cost per signup or the measured rate", fb.signups === f0.signups && fb.unit.signupsPerDay === f0.unit.signupsPerDay && fb.unit.costPerSignupCents === f0.unit.costPerSignupCents && fb.rate.pct === f0.rate.pct && fb.rate.ended === f0.rate.ended);
check("…nor the cost per paying customer or the payback (the ads did not win it)", fb.unit.costPerPayingCents === f0.unit.costPerPayingCents && fb.unit.paybackMonths === f0.unit.paybackMonths && fb.paying.won === f0.paying.won);
check("…but it pays into the curve from the first day", fb.curve[0].mrrCents === f0.curve[0].mrrCents + 9900 && fb.curve[0].paying === f0.curve[0].paying + 1);
const cutB = splitApart({ ...withCohorts, paying: [...withCohorts.paying, { startedAt: "2026-09-01", monthlyCents: 9900, cohort: "card", preexisting: true }] });
check("it sits on the card side's paying, not the apart side's, and in neither's signups", cutB.card.paying.count === cut.card.paying.count + 1 && cutB.card.paying.preexisting === 1 && cutB.card.signups === cut.card.signups && cutB.apart.paying.count === cut.apart.paying.count);

console.log(bad === 0 ? "\nAll investor model checks passed." : `\n${bad} investor model check(s) FAILED.`);
process.exit(bad === 0 ? 0 : 1);
