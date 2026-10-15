// Service plans — the plain rules (2026-09-22): the starter plans, when the
// visits fall, when a plan bills, what it is worth a month, its phase, and the
// calendar hour in the shop's own time zone. Pure, no database.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/service-plans.check.ts
import { STARTER_PLANS, advanceBilling, atLocalHour, billingPeriodLabel, mrrCents, planEndsAt, planPhase, planTermsLine, tuneUpChecklist, visitSchedule } from "../../../src/lib/servicePlans";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const d = (s: string) => new Date(s + "T00:00:00Z");
const ymd = (x: Date) => x.toISOString().slice(0, 10);

check("three starter plans, every one priced with visits, a discount and benefits", STARTER_PLANS.length === 3 && STARTER_PLANS.every((p) => p.priceCents > 0 && p.visitsPerYear >= 1 && p.benefits.length >= 3 && p.discountPct > 0));
check("the Comfort plan reads like the shop sells it", planTermsLine(STARTER_PLANS[0]) === "2 visits a year · 12 months · $21 a month · 15% off repairs", planTermsLine(STARTER_PLANS[0]));
check("a yearly plan says a year", /\$149 a year/.test(planTermsLine(STARTER_PLANS[1])), planTermsLine(STARTER_PLANS[1]));

// ── visits
const jan = visitSchedule(d("2026-01-10"), 12, 2);
check("signed in January, two visits a year: spring cooling on Apr 15, fall heating on Oct 1", jan.length === 2 && ymd(jan[0].dueAt) === "2026-04-15" && /Spring cooling/.test(jan[0].label) && ymd(jan[1].dueAt) === "2026-10-01" && /Fall heating/.test(jan[1].label), jan.map((v) => `${v.label} ${ymd(v.dueAt)}`).join(" | "));
const sep = visitSchedule(d("2026-09-25"), 12, 2);
check("signed Sep 25: the fall visit a week later, then next spring — both inside the term", sep.length === 2 && ymd(sep[0].dueAt) === "2026-10-01" && ymd(sep[1].dueAt) === "2027-04-15", sep.map((v) => ymd(v.dueAt)).join(" | "));
const sep30 = visitSchedule(d("2026-09-29"), 12, 2);
check("signed Sep 29: the Oct 1 visit two days out (the office can move it), then next spring", sep30.length === 2 && ymd(sep30[0].dueAt) === "2026-10-01" && ymd(sep30[1].dueAt) === "2027-04-15", sep30.map((v) => ymd(v.dueAt)).join(" | "));
const oct1 = visitSchedule(d("2026-10-01"), 12, 2);
check("signed on Oct 1 itself: next spring, then a filler visit before the term ends", oct1.length === 2 && ymd(oct1[0].dueAt) === "2027-04-15" && oct1[1].dueAt < planEndsAt(d("2026-10-01"), 12), oct1.map((v) => ymd(v.dueAt)).join(" | "));
const one = visitSchedule(d("2026-06-01"), 12, 1);
check("one visit a year, signed in June: the fall heating tune-up", one.length === 1 && ymd(one[0].dueAt) === "2026-10-01" && /Annual tune-up/.test(one[0].label), one.map((v) => `${v.label} ${ymd(v.dueAt)}`).join(" | "));
const quarterly = visitSchedule(d("2026-01-01"), 12, 4);
check("four a year: spread through the term, the first a month in", quarterly.length === 4 && ymd(quarterly[0].dueAt) === "2026-02-01" && quarterly.every((v, i) => i === 0 || v.dueAt > quarterly[i - 1].dueAt), quarterly.map((v) => ymd(v.dueAt)).join(" | "));
const two24 = visitSchedule(d("2026-01-10"), 24, 2);
check("a two-year plan gets four seasonal visits", two24.length === 4 && ymd(two24[3].dueAt) === "2027-10-01", two24.map((v) => ymd(v.dueAt)).join(" | "));
check("no visits, no schedule", visitSchedule(d("2026-01-01"), 12, 0).length === 0);

// ── billing
check("the term ends a year later; a monthly bill advances a month, a yearly one a year", ymd(planEndsAt(d("2026-01-31"), 12)) === "2027-01-31" && ymd(advanceBilling(d("2026-01-31"), "MONTHLY")) === "2026-02-28" && ymd(advanceBilling(d("2026-03-15"), "YEARLY")) === "2027-03-15");
check("the bill names its period", billingPeriodLabel(d("2026-03-15"), "MONTHLY") === "Mar 15, 2026 – Apr 14, 2026", billingPeriodLabel(d("2026-03-15"), "MONTHLY"));
check("monthly recurring revenue: active plans only, a yearly plan at a twelfth", mrrCents([{ status: "ACTIVE", priceCents: 2100, billing: "MONTHLY" }, { status: "ACTIVE", priceCents: 14900, billing: "YEARLY" }, { status: "CANCELED", priceCents: 9900, billing: "MONTHLY" }, { status: "SENT", priceCents: 2100, billing: "MONTHLY" }]) === 2100 + 1242);

// ── phases
const now = d("2026-09-22");
check("phases: draft, sent, active, expiring inside 30 days, lapsed past the end, canceled", planPhase({ status: "DRAFT", endsAt: null }, now) === "draft" && planPhase({ status: "ACTIVE", endsAt: d("2027-03-01") }, now) === "active" && planPhase({ status: "ACTIVE", endsAt: d("2026-10-10") }, now) === "expiring" && planPhase({ status: "ACTIVE", endsAt: d("2026-09-20") }, now) === "lapsed" && planPhase({ status: "CANCELED", endsAt: d("2027-01-01") }, now) === "canceled");

// ── the calendar hour
const ny = atLocalHour(d("2026-10-01"), 9, "America/New_York");
const la = atLocalHour(d("2026-10-01"), 9, "America/Los_Angeles");
check("9:00 in New York is 13:00 UTC in October; 9:00 in Los Angeles is 16:00 UTC", ny.toISOString() === "2026-10-01T13:00:00.000Z" && la.toISOString() === "2026-10-01T16:00:00.000Z", `${ny.toISOString()} · ${la.toISOString()}`);
const jan9 = atLocalHour(d("2027-01-15"), 9, "America/New_York");
check("…and 14:00 UTC in January (standard time)", jan9.toISOString() === "2027-01-15T14:00:00.000Z", jan9.toISOString());
check("a bad time zone falls back to the UTC hour", atLocalHour(d("2026-10-01"), 9, "Not/AZone").toISOString() === "2026-10-01T09:00:00.000Z");

// ── the crew's list
const list = tuneUpChecklist("Spring cooling tune-up");
check("the spring checklist is about cooling — coil, charge, capacitor, drain — and says to write the readings down", /condenser coil/i.test(list) && /superheat/.test(list) && /capacitor/.test(list) && /drain/.test(list) && !/burners/.test(list) && /every reading/.test(list));
check("the fall checklist is about heating — burners, flame sensor, heat exchanger, CO", /burners/.test(tuneUpChecklist("Fall heating tune-up")) && /heat exchanger/.test(tuneUpChecklist("Fall heating tune-up")) && /CO/.test(tuneUpChecklist("Fall heating tune-up")));

console.log(bad ? `\n${bad} check(s) FAILED` : "\nall checks passed");
process.exit(bad ? 1 : 0);
