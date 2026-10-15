// THE TRIALS BOARD (owner, 2026-10-12) — pure. lib/trialBoard over a fixed set of accounts: a card-first trial, a
// card-less one ending today, a card-less one that added a card and ends tomorrow, a card-first trial that converted,
// a card-less trial that ended with no card, one that paid after its end, a card that failed, a cancel during the trial,
// a test-mode trial, a company that paid at signup, a comp and a free plan — every count, every order and the sentences
// asserted; and a calendar across the end of daylight saving time.
//
// Run: npx tsx --tsconfig tsconfig.json qa/tests/billing/trial-board.check.ts
import { buildTrialBoard, classify, dayInline, dayWords, fromNow, leftWords, workWords, type BoardAccount, type TrialWork } from "../../../src/lib/trialBoard";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const DAY = 86_400_000;
const HOUR = 3_600_000;
const now = Date.parse("2026-10-12T13:00:00-07:00");
const work = (w: Partial<TrialWork> = {}): TrialWork => ({ proposals: 0, sent: 0, estimates: 0, aiAsks: 0, clients: 0, leads: 0, jobs: 0, activeDays: 0, views: 0, lastSeen: null, ...w });
const acct = (id: string, a: Partial<BoardAccount>): BoardAccount => ({
  orgId: id,
  orgName: id,
  ownerName: "",
  ownerEmail: `${id.toLowerCase()}@example.com`,
  createdAt: now - DAY,
  source: "Direct",
  fromAd: false,
  campaign: "",
  status: "TRIALING",
  plan: "Professional",
  provider: "STRIPE",
  hasStripeSub: true,
  trialEndsAt: null,
  canceledAt: null,
  subUpdatedAt: null,
  cardless: null,
  monthlyCents: 7900,
  chance: 0.2,
  tierLabel: "trying it",
  work: work(),
  ...a,
});
const nocard = (startedAt: number, endsAt: number, more: Partial<NonNullable<BoardAccount["cardless"]>> = {}) => ({ startedAt, endsAt, cardAt: null, endedAt: null, restartedAt: null, test: false, ...more });

const a1Created = now - 2 * DAY - HOUR;
const a2Ends = Date.parse("2026-10-12T20:00:00-07:00");
const a3Ends = Date.parse("2026-10-13T10:00:00-07:00");
const accounts: BoardAccount[] = [
  acct("A1", { createdAt: a1Created, trialEndsAt: a1Created + 7 * DAY, chance: 0.9 }),
  acct("A2", { createdAt: a2Ends - 7 * DAY, trialEndsAt: a2Ends, cardless: nocard(a2Ends - 7 * DAY, a2Ends) }),
  acct("A3", { createdAt: a3Ends - 7 * DAY, trialEndsAt: a3Ends, cardless: nocard(a3Ends - 7 * DAY, a3Ends, { cardAt: now - DAY }) }),
  acct("A4", { createdAt: now - 9 * DAY, trialEndsAt: now - 2 * DAY, status: "ACTIVE", work: work({ proposals: 2, sent: 1, clients: 3, activeDays: 4 }) }),
  acct("A5", { createdAt: now - 10 * DAY, trialEndsAt: now - 3 * DAY, status: "TRIAL_ENDED", cardless: nocard(now - 10 * DAY, now - 3 * DAY, { endedAt: now - 3 * DAY }) }),
  acct("A6", { createdAt: now - 11 * DAY, trialEndsAt: now - 4 * DAY, status: "ACTIVE", cardless: nocard(now - 11 * DAY, now - 4 * DAY, { endedAt: now - 4 * DAY, restartedAt: now - 20 * HOUR }) }),
  acct("A7", { createdAt: now - 8 * DAY, trialEndsAt: now - 20 * HOUR, status: "PAST_DUE" }),
  acct("A8", { createdAt: now - 8 * DAY - 2 * HOUR, trialEndsAt: now - DAY - 2 * HOUR, status: "CANCELED", canceledAt: now - 4 * DAY }),
  acct("A9", { createdAt: now - DAY, trialEndsAt: now + 6 * DAY, cardless: nocard(now - DAY, now + 6 * DAY, { test: true }) }),
  acct("A10", { createdAt: now - 5 * DAY, trialEndsAt: null, status: "ACTIVE" }),
  acct("A11", { createdAt: now - 3 * DAY, provider: "MANUAL", status: "ACTIVE", hasStripeSub: false }),
  acct("A12", { createdAt: now - 2 * DAY, status: "FREE", hasStripeSub: false, plan: "" }),
];
const board = buildTrialBoard(accounts, now);
const row = (id: string) => board.rows.find((r) => r.orgId === id)!;

// how each account reads
check("A1: a card-first trial, on day 3 of 7, a card on file", row("A1").kind === "card" && row("A1").phase === "trial" && row("A1").cardNow && row("A1").dayOfTrial === 3 && row("A1").trialDays === 7, JSON.stringify({ k: row("A1").kind, d: row("A1").dayOfTrial }));
check("A2: a card-less trial with no card yet", row("A2").kind === "nocard" && !row("A2").cardNow && row("A2").phase === "trial");
check("A3: a card-less trial that added a card — counted with a card", row("A3").kind === "nocard" && row("A3").cardNow && row("A3").cardAddedAt === now - DAY);
check("A4: converted when its trial ended — card at signup, paying from the trial's end", row("A4").phase === "paying" && row("A4").paidHow === "card-at-signup" && row("A4").paidFrom === now - 2 * DAY);
check("A5: ended with no card — left", row("A5").phase === "left" && row("A5").decidedAt === now - 3 * DAY && leftWords(row("A5")) === "The trial ended with no card");
check("A6: paid after the trial ended — from the restart", row("A6").phase === "paying" && row("A6").paidHow === "card-after-end" && row("A6").paidFrom === now - 20 * HOUR);
check("A7: the card failed at the end", row("A7").phase === "failed" && leftWords(row("A7")) === "The card failed when the trial ended");
check("A8: canceled during the trial", row("A8").phase === "left" && row("A8").decidedAt === now - 4 * DAY && leftWords(row("A8")) === "Canceled during the trial");
check("A9: a test-mode trial — listed, counted nowhere", row("A9").test && board.tests === 1 && !board.ending.includes("A9"));
check("A10: paid at signup — no trial", row("A10").kind === "none" && row("A10").paidHow === "paid-at-signup" && row("A10").decidedAt === null);
check("A11: a comp — no trial, not a payer", row("A11").kind === "comp" && !board.startedPaying.includes("A11"));
check("A12: a free plan — no trial", row("A12").kind === "none" && row("A12").phase === "free");

// the counts
const t = board.onTrial;
check("on a trial now: 3 — 2 with a card (one added), 1 without", t.total === 3 && t.card === 2 && t.nocard === 1 && t.cardAdded === 1, JSON.stringify(t));
check("…1 ends today, 1 tomorrow", t.endsToday === 1 && t.endsTomorrow === 1, `${t.endsToday} / ${t.endsTomorrow}`);
check("…$237/mo if all pay, $103 likely", t.monthlyCents === 23700 && t.likelyCents === Math.round(7900 * 0.9 + 7900 * 0.2 + 7900 * 0.2), `${t.monthlyCents} / ${t.likelyCents}`);
check("all three running trials carry a price", t.priced === 3, String(t.priced));
check("trials started in the last 7 signup days: A1 (card) and A3 (no card) — A2 began on the 8th day back, the test trial counts nowhere", board.started.trials === 2 && board.started.card === 1 && board.started.nocard === 1, JSON.stringify(board.started));
const unpriced = buildTrialBoard([acct("U", { createdAt: now - DAY, trialEndsAt: now + 6 * DAY, monthlyCents: null })], now);
check("a trial with no price on record: counted, and no sum is named for it", unpriced.onTrial.total === 1 && unpriced.onTrial.priced === 0 && unpriced.onTrial.monthlyCents === 0);
check("ending next, in the order they end: A2 (today), A3 (tomorrow), A1", board.ending.join(",") === "A2,A3,A1", board.ending.join(","));
const w = board.decided.week;
check("decided in 7 days: 5 — 2 paying, 2 left, 1 card failed", w.total === 5 && w.paid === 2 && w.left === 2 && w.failed === 1, JSON.stringify(w));
check("…with a card at signup 1 of 3, without 1 of 2", w.card.total === 3 && w.card.paid === 1 && w.nocard.total === 2 && w.nocard.paid === 1, JSON.stringify({ card: w.card, nocard: w.nocard }));
const d = board.decided.day;
check("decided in the last day: A6 paid, A7 failed", d.total === 2 && d.paid === 1 && d.failed === 1, JSON.stringify(d));
check("started paying, newest payer first: A6, A4, A10 (no comp)", board.startedPaying.join(",") === "A6,A4,A10", board.startedPaying.join(","));
check("left without paying, newest first: A7, A5, A8", board.left.join(",") === "A7,A5,A8", board.left.join(","));

// the sentences
const want = "3 accounts on a trial now — 2 with a card, 1 without one. 1 ends today, 1 tomorrow. Of the 5 trials decided in the last 7 days, 2 are paying (40%) — with a card 1 of 3, without one 1 of 2.";
check("the headline says it in three sentences", board.headline === want, board.headline);
const quiet = buildTrialBoard([], now);
check("an empty board says so", quiet.headline === "No one is on a trial right now. No trial has ended in the last 7 days yet.", quiet.headline);

// the calendar
const cal = board.calendar;
const la = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", hourCycle: "h23" });
check("the calendar is 14 signup days, today first, each at local midnight", cal.length === 14 && cal.every((c) => la.format(new Date(c.dayStart)).endsWith(", 00")) && la.format(new Date(cal[0].dayStart)).startsWith("Oct 12"), la.format(new Date(cal[0].dayStart)));
const oct3 = cal.find((c) => la.format(new Date(c.dayStart)).startsWith("Oct 3,"));
check("Oct 3 (A4): 1 trial with a card, decided, paying — 100%", !!oct3 && oct3.trials === 1 && oct3.card === 1 && oct3.paying === 1 && oct3.finished && oct3.rate === 1, JSON.stringify(oct3));
const oct11 = cal.find((c) => la.format(new Date(c.dayStart)).startsWith("Oct 11,"));
check("Oct 11: the test trial is in no day", !!oct11 && oct11.trials === 0, JSON.stringify(oct11));
const oct5 = cal.find((c) => la.format(new Date(c.dayStart)).startsWith("Oct 5,"));
check("Oct 5 (A2): its trial ends today, still running", !!oct5 && oct5.trials === 1 && oct5.nocard === 1 && oct5.onTrial === 1 && !oct5.finished && oct5.endsOn === cal[0].dayStart, JSON.stringify(oct5));
const novNow = Date.parse("2026-11-03T12:00:00-08:00");
const nov = buildTrialBoard([], novNow).calendar;
const novDays = nov.map((c) => la.format(new Date(c.dayStart)));
check("across the end of daylight saving (Nov 1): every day still starts at its own midnight, none skipped", novDays.every((x) => x.endsWith(", 00")) && novDays.slice(0, 4).join("|") === "Nov 3, 00|Nov 2, 00|Nov 1, 00|Oct 31, 00", novDays.slice(0, 4).join(" | "));

// the words
check("days in words", dayWords(now, now) === "Today" && dayWords(now + DAY, now) === "Tomorrow" && dayWords(now - DAY, now) === "Yesterday" && /^\w{3}, Oct 9$/.test(dayWords(now - 3 * DAY, now)), dayWords(now - 3 * DAY, now));
check("a day inside a sentence: 'today', a date stays a date", dayInline(now, now) === "today" && dayInline(now - DAY, now) === "yesterday" && /^Mon, Oct 19$/.test(dayInline(now + 7 * DAY, now)), dayInline(now + 7 * DAY, now));
check("how far a moment is", fromNow(now + 7 * HOUR, now) === "in 7 h" && fromNow(now - 3 * DAY, now) === "3 days ago" && fromNow(now + 10 * 60_000, now) === "in 10 min");
check("what an account did, in a line", workWords(row("A4").work) === "2 proposals (1 sent) · 3 clients · in the app on 4 days" && workWords(work()) === "Nothing made yet", workWords(row("A4").work));
check("a card-first trial past its end but not yet charged stays a trial, counted as ending today", (() => {
  const late = classify(acct("L", { createdAt: now - 7 * DAY - HOUR, trialEndsAt: now - HOUR }), now);
  const b2 = buildTrialBoard([acct("L", { createdAt: now - 7 * DAY - HOUR, trialEndsAt: now - HOUR })], now);
  return late.phase === "trial" && b2.onTrial.endsToday === 1;
})());

// SET TO CANCEL (owner, 2026-10-12): a card-first trial whose owner pressed Cancel — still running, counted apart.
const withCancel = buildTrialBoard([...accounts, acct("C1", { createdAt: now - 3 * DAY, trialEndsAt: now + 4 * DAY, canceledAt: now - DAY })], now);
const c1 = withCancel.rows.find((r) => r.orgId === "C1")!;
check("a trial set to cancel still runs, marked to end with the trial", c1.phase === "trial" && c1.cancelsAtEnd && c1.cardNow);
check("…counted: 1 set to cancel, 1 of them with a card; still among the 4 on a trial", withCancel.onTrial.setToCancel === 1 && withCancel.onTrial.setToCancelCard === 1 && withCancel.onTrial.total === 4, JSON.stringify(withCancel.onTrial));
check("…and the headline says so", /— 3 with a card, 1 without one; 1 of those with a card is set to cancel when the trial ends\./.test(withCancel.headline), withCancel.headline);
check("a paying account with an old cancel date is not 'set to cancel'", !buildTrialBoard([acct("P", { status: "ACTIVE", trialEndsAt: now - 2 * DAY, canceledAt: now - 5 * DAY })], now).rows[0].cancelsAtEnd);
check("none today but one tomorrow reads as words, not a zero", /None ends today, 1 tomorrow\./.test(buildTrialBoard([acct("T", { createdAt: now - 6 * DAY, trialEndsAt: Date.parse("2026-10-13T09:00:00-07:00") })], now).headline));
check("no cancel pressed: nothing said about it", board.onTrial.setToCancel === 0 && !/cancel when/.test(board.headline));

console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
process.exit(bad ? 1 : 0);
