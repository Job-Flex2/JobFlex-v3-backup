// Spent on ads today (lib/adSpendTodayShared, 2026-10-15): which figure the traffic
// page's tile shows, and never a fake $0.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/ad-spend-today.check.ts
import { perAdSignupCents, spendTodayFrom, type SpendTodayInput } from "../../../src/lib/adSpendTodayShared";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const T = "2026-10-15";
const base: SpendTodayInput = { entries: [], today: T, metaConnected: true, lastPulledAt: "2026-10-15T22:40:00Z", lastPulledDay: T, lastError: null, dailyBudgetCents: 12000, budgetFrom: "2026-10-01" };
const e = (date: string, cents: number, source: "meta" | "manual" = "meta") => ({ date, cents, source });

const meta = spendTodayFrom({ ...base, entries: [e(T, 8417), e("2026-10-14", 11950)] });
check("Meta read today: today's Meta spend, as of the read", meta.source === "meta" && meta.cents === 8417 && meta.asOf === base.lastPulledAt);
const both = spendTodayFrom({ ...base, entries: [e(T, 8417), e(T, 2500, "manual")] });
check("…plus another platform booked by hand for today", both.cents === 10917);
const zero = spendTodayFrom({ ...base, entries: [e("2026-10-14", 11950)] });
check("Meta read today with no row for today: its word is $0", zero.source === "meta" && zero.cents === 0);
const stale = spendTodayFrom({ ...base, lastPulledDay: "2026-10-14", entries: [e("2026-10-14", 11950)] });
check("Meta last read yesterday: no figure yet — never yesterday's, never a fake $0", stale.cents === null && stale.source === "meta");
const failed = spendTodayFrom({ ...base, lastPulledDay: "2026-10-14", lastError: "Meta took too long to answer." });
check("…and Meta's error is passed on", failed.cents === null && failed.error === "Meta took too long to answer.");
const handStale = spendTodayFrom({ ...base, lastPulledDay: "2026-10-14", entries: [e(T, 3000, "manual")] });
check("Meta not read today but spend booked by hand: the booked figure", handStale.source === "manual" && handStale.cents === 3000);
const noMetaHand = spendTodayFrom({ ...base, metaConnected: false, entries: [e(T, 4200, "manual")] });
check("no Meta, booked by hand: the booked figure", noMetaHand.source === "manual" && noMetaHand.cents === 4200);
const budget = spendTodayFrom({ ...base, metaConnected: false });
check("no Meta, nothing booked: the daily budget, marked as a budget", budget.source === "budget" && budget.cents === 12000);
const early = spendTodayFrom({ ...base, metaConnected: false, budgetFrom: "2026-10-20" });
check("a budget that starts later is not today's", early.source === "none" && early.cents === null);
const none = spendTodayFrom({ ...base, metaConnected: false, dailyBudgetCents: null });
check("nothing at all: no figure", none.source === "none" && none.cents === null);
check("per ad signup: spend ÷ ad signups, none when either is zero", perAdSignupCents(8417, 2) === 4209 && perAdSignupCents(8417, 0) === null && perAdSignupCents(0, 3) === null && perAdSignupCents(null, 3) === null);

console.log(bad ? `\n${bad} FAILED` : "\nall good");
process.exit(bad ? 1 : 0);
