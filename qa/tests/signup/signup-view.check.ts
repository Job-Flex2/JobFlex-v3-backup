// The sign-up screen (lib/signupView, 2026-10-22): which screen a visit gets — the page, or the form over a picture of
// the app — under each switch setting, a `?view=` link and the half-and-half split; and what the app behind it shows
// (lib/signupPreview). Pure.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/signup/signup-view.check.ts
import { isSignupViewMode, resolveSignupView, signupViewCoin, signupViewCookieValue } from "../../../src/lib/signupView";
import { previewCalendar, previewMoney, previewPackFor } from "../../../src/lib/signupPreview";
import { TRADE_TYPES } from "../../../src/lib/tradeTypes";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

// ── the switch
check("page → the page", resolveSignupView("page", undefined, null, 0.1).view === "page");
check("app → the app", resolveSignupView("app", undefined, null, 0.9).view === "app");
check("…a setting's choice is the switch's", resolveSignupView("app", undefined, null, 0.9).source === "switch");
check("split, new visitor, low coin → the app", resolveSignupView("split", undefined, null, 0.2).view === "app");
check("split, new visitor, high coin → the page", resolveSignupView("split", undefined, null, 0.7).view === "page");
check("split keeps the screen the visitor was given (cookie), whatever the coin", resolveSignupView("split", undefined, "page", 0.1).view === "page" && resolveSignupView("split", undefined, "app", 0.9).view === "app");
check("…and says it came from the split", resolveSignupView("split", undefined, "app", 0.9).source === "split");
check("a split cookie does not outrank the switch set to page", resolveSignupView("page", undefined, "app", 0.1).view === "page");
// ── a link
check("?view=app wins over the page switch", resolveSignupView("page", "app", null, 0.9).view === "app");
check("?view=page wins over the app switch", resolveSignupView("app", "page", null, 0.1).view === "page");
check("a link's choice is remembered as the link's", signupViewCookieValue(resolveSignupView("page", "app", null, 0.9)) === "app!");
check("…and holds for the rest of the visit over the switch", resolveSignupView("page", undefined, "app!", 0.9).view === "app" && resolveSignupView("app", undefined, "page!", 0.1).view === "page");
check("…and over the split", resolveSignupView("split", undefined, "page!", 0.1).view === "page");
check("a switch's or split's choice is stored plain", signupViewCookieValue({ view: "app", source: "split" }) === "app" && signupViewCookieValue({ view: "page", source: "switch" }) === "page");
check("junk in the link or the cookie is ignored", resolveSignupView("page", "admin", "x!", 0.1).view === "page" && resolveSignupView("app", ["app"], "!", 0.9).view === "app");
check("modes", isSignupViewMode("page") && isSignupViewMode("app") && isSignupViewMode("split") && !isSignupViewMode("both") && !isSignupViewMode(undefined));

// ── the split's coin: steady per visitor, even across the visitors
check("the same visitor always lands on the same side", signupViewCoin("0192f3a1-visitor") === signupViewCoin("0192f3a1-visitor"));
let app = 0;
const N = 4000;
for (let i = 0; i < N; i++) {
  const c = signupViewCoin(`019${(i * 7919).toString(16)}-${i % 13}-visitor-${i}`);
  if (c < 0 || c >= 1) app = -1e9;
  if (c < 0.5) app++;
}
check("about half and half over many visitors", app / N > 0.46 && app / N < 0.54, `${((app / N) * 100).toFixed(1)}% app`);
let near = 0;
for (let i = 0; i < 1000; i++) if ((signupViewCoin(`203.0.113.${i % 256}|Mozilla/5.0 iPhone ${i}`) < 0.5) !== (signupViewCoin(`203.0.113.${i % 256}|Mozilla/5.0 iPhone ${i + 1}`) < 0.5)) near++;
check("neighbouring ids don't lean to one side", near > 400 && near < 600, `${near} of 1000 flip`);

// ── what the app behind shows
check("a roofer sees roofs", previewPackFor("Roofing").activity.some((a) => /roof/i.test(a.text)));
check("a fence shop sees fences", previewPackFor("Fencing").jobs.some((j) => /fence/i.test(j.title)));
check("HVAC sees HVAC", previewPackFor("HVAC").activity.some((a) => /heat pump|furnace|AC/.test(a.text)));
check("a deck builder sees decks", previewPackFor("Decking").jobs.some((j) => /deck/i.test(j.title)));
check("no trade → a remodeler's overview", previewPackFor(null).jobs.some((j) => /kitchen|bath/i.test(j.title)));
let whole = true;
for (const t of TRADE_TYPES) {
  const p = previewPackFor(t);
  if (p.trend.length !== 7 || p.activity.length < 3 || p.jobs.length < 2 || !p.toast.title || p.revenue <= 0 || p.pipeline <= p.revenue) whole = false;
}
check("every trade gets a whole overview (7-day trend, activity, jobs, a lead)", whole);
check("money reads like the app", previewMoney(52840) === "$52,840" && previewMoney(0) === "$0");

// ── the calendar words, in the visitor's day
const pack = previewPackFor("Roofing");
const thu = previewCalendar(new Date("2026-10-22T18:00:00Z"), pack); // Thu Oct 22 in Chicago
check("today", thu.today === "OCT 22", thu.today);
check("the week runs Sunday to Saturday around today", thu.week.length === 7 && thu.week[0].dow === "SU" && thu.week[0].day === 18 && thu.week[4].today && thu.week[6].day === 24, JSON.stringify(thu.week.map((d) => d.day)));
check("the jobs land on their days", thu.jobDays[0] === "OCT 23" && thu.jobDays[1] === "OCT 24" && thu.jobDays[2] === "OCT 26", thu.jobDays.join(","));
check("the week's dots are the jobs inside it", thu.week[5].jobs === 1 && thu.week[6].jobs === 1 && thu.week.reduce((n, d) => n + d.jobs, 0) === 2);
check("the trend ends today", thu.trendDays[6] === "THU" && thu.trendDays[0] === "FRI", thu.trendDays.join(","));
const lateUtc = previewCalendar(new Date("2026-10-23T03:30:00Z"), pack); // still Oct 22 in Chicago
check("late evening in America is still that day (not UTC's tomorrow)", lateUtc.today === "OCT 22", lateUtc.today);
const monthEnd = previewCalendar(new Date("2026-10-30T15:00:00Z"), pack); // Fri Oct 30
check("across a month's end", monthEnd.jobDays[1] === "NOV 1" && monthEnd.week[6].day === 31, `${monthEnd.jobDays.join(",")} / ${monthEnd.week.map((d) => d.day).join(",")}`);

if (bad) {
  console.log(`\n${bad} failed`);
  process.exit(1);
}
console.log("\nall passed");
