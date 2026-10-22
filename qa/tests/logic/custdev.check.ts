// CUSTOMER DEVELOPMENT'S RULES (owner, 2026-10-22, lib/custDev/model): who counts as paying, activated, decided;
// rates that only count accounts old enough to have had the chance; segments and the early adopters; the voice of
// the customer sorted into themes and counted by company; verdicts from the data and the owner's on top; the four
// steps; who to talk to next; the interview check; the weekly scorecard; the report's anonymous labels.
//   npx tsx --tsconfig tsconfig.json qa/tests/logic/custdev.check.ts
import {
  DAY,
  anonymous,
  callList,
  checkInterview,
  cohorts,
  earlyAdopters,
  funnel,
  hypothesisViews,
  isoWeek,
  measures,
  orgState,
  quoteFor,
  overallRow,
  payingByMonth,
  regionOf,
  segmentsBy,
  stages,
  themesOf,
  toolsNamed,
  verdictOf,
  voiceSummary,
  withWeek,
  type CancelFact,
  type Interview,
  type OrgFact,
  type VoiceItem,
} from "../../../src/lib/custDev/model";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const NOW = Date.UTC(2026, 9, 22, 15);
let n = 0;
function org(p: Partial<OrgFact> & { daysOld: number; status?: string; trialEndsIn?: number | null; canceledDaysAgo?: number | null; firstValueAfterDays?: number | null }): OrgFact {
  n += 1;
  const createdAt = NOW - p.daysOld * DAY;
  const trialEndsAt = p.trialEndsIn === null || p.trialEndsIn === undefined ? createdAt + 7 * DAY : NOW + p.trialEndsIn * DAY;
  return {
    id: `o${n}`,
    name: p.name ?? `Company ${n}`,
    createdAt,
    trade: p.trade ?? "Roofing",
    region: p.region ?? "UT",
    channel: p.channel ?? "Facebook",
    fromAd: p.fromAd ?? true,
    contact: p.contact ?? { name: `Owner ${n}`, email: `o${n}@example.test`, phone: null },
    sub: p.status === undefined ? null : { status: p.status, plan: "professional", trialEndsAt, canceledAt: p.canceledDaysAgo === null || p.canceledDaysAgo === undefined ? null : NOW - p.canceledDaysAgo * DAY, startedAt: createdAt },
    firstValueAt: p.firstValueAfterDays === null || p.firstValueAfterDays === undefined ? null : createdAt + p.firstValueAfterDays * DAY,
    proposals: p.proposals ?? 0,
    sent: p.sent ?? 0,
    accepted: p.accepted ?? 0,
    estimates: p.estimates ?? 0,
    activeDays: p.activeDays ?? 0,
    lastSeenAt: p.lastSeenAt ?? null,
  };
}

console.log("── an account's standing");
const payer = org({ daysOld: 60, status: "ACTIVE", firstValueAfterDays: 1, sent: 3, accepted: 1 });
const trial = org({ daysOld: 3, status: "TRIALING", trialEndsIn: 4, firstValueAfterDays: 1 });
const paidThenLeft = org({ daysOld: 80, status: "CANCELED", canceledDaysAgo: 20, firstValueAfterDays: 2, sent: 1 });
const trialLeft = org({ daysOld: 20, status: "CANCELED", canceledDaysAgo: 15, firstValueAfterDays: null });
const s1 = orgState(payer, NOW);
check("ACTIVE is paying, has paid, its trial is decided", s1.payingNow && s1.everPaid && s1.trialDecided && !s1.left);
check("a running trial is not decided and not activated-late", orgState(trial, NOW).trialing && !orgState(trial, NOW).trialDecided && !orgState(trial, NOW).weekOld);
check("cancelled weeks after the trial = paid once, left now", orgState(paidThenLeft, NOW).everPaid && orgState(paidThenLeft, NOW).left && !orgState(paidThenLeft, NOW).payingNow);
check("cancelled during the trial = never paid", !orgState(trialLeft, NOW).everPaid && orgState(trialLeft, NOW).left);

console.log("── rates count only accounts that had the chance");
const young = org({ daysOld: 2, firstValueAfterDays: null });
const seg = overallRow([payer, trial, paidThenLeft, trialLeft, young], NOW);
check("week-1 use counts only accounts a week old (3 of them, 2 used a tool)", seg.activation.of === 3 && seg.activation.n === 2, `${seg.activation.n}/${seg.activation.of}`);
check("trial → paid counts only decided trials (3: 2 paid)", seg.trialToPaid.of === 3 && seg.trialToPaid.n === 2, `${seg.trialToPaid.n}/${seg.trialToPaid.of}`);
check("no one behind a rate → null, shown as —", overallRow([], NOW).activation.value === null);

console.log("── segments and early adopters");
const roofers = Array.from({ length: 6 }, (_, i) => org({ daysOld: 30 + i, trade: "Roofing", status: i < 4 ? "ACTIVE" : "CANCELED", canceledDaysAgo: i < 4 ? null : 31, firstValueAfterDays: 1, sent: 2 }));
const hvac = Array.from({ length: 6 }, (_, i) => org({ daysOld: 30 + i, trade: "HVAC", status: i < 1 ? "ACTIVE" : "TRIAL_ENDED", firstValueAfterDays: i < 3 ? 2 : null }));
const all = [...roofers, ...hvac];
const byTrade = segmentsBy(all, NOW, (o) => o.trade);
const ea = earlyAdopters(byTrade, overallRow(all, NOW));
check("roofers (4 of 6 paid) beat the average (5 of 12)", !!ea && ea.row.key === "Roofing" && Math.abs(ea.lift - (4 / 6) / (5 / 12)) < 1e-9, ea ? `${ea.row.key} ${ea.lift.toFixed(2)}×` : "none");
check("fewer than five decided trials in a trade → no early adopter", earlyAdopters(segmentsBy(all.slice(0, 4), NOW, (o) => o.trade), overallRow(all.slice(0, 4), NOW)) === null);

console.log("── funnel and cohorts");
const f = funnel(all, NOW);
check("funnel: signed up 12 → used a tool 9 → sent 6 → paid 5 → paying 5", f.map((x) => x.n).join(",") === "12,9,6,0,5,5", f.map((x) => `${x.key}:${x.n}`).join(" "));
check("each step's share of all sign-ups", f[1].ofAll === 9 / 12 && f[0].ofAll === null && f[5].ofAll === 5 / 12);
const co = cohorts(all, NOW, 12);
check("twelve weeks, every account in one of them", co.length === 12 && co.reduce((s, c) => s + c.signups, 0) === all.filter((o) => NOW - o.createdAt < 12 * 7 * DAY + 7 * DAY).length);
check("ISO weeks: Oct 22 2026 is 2026-W43", isoWeek(NOW) === "2026-W43", isoWeek(NOW));

console.log("── the voice of the customer");
const v = (text: string, extra: Partial<VoiceItem> = {}): VoiceItem => ({ id: `v${++n}`, at: NOW - DAY, orgId: extra.orgId ?? "o1", company: "Acme", trade: "Roofing", region: "UT", source: "support", text, ...extra });
check("a ticked reason is its theme, words or not", themesOf(v("", { source: "cancel", reasons: ["too_expensive", "hard_to_use"] })).join(",") === "price,ease");
check("\"Can you add QuickBooks sync?\" → missing feature", themesOf(v("Can you add QuickBooks sync?")).includes("feature"));
check("\"The proposal page won't load\" → bug", themesOf(v("The proposal page won't load on my phone")).includes("bug"));
check("\"We switched to Jobber\" → another tool, and Jobber is named", themesOf(v("We switched to Jobber last week")).includes("competitor") && toolsNamed("We switched to Jobber last week").join() === "Jobber");
check("praise is heard", themesOf(v("Love it, saves me hours every week")).includes("praise"));
check("material prices are not our price (\"my own shingle prices\", \"composite vs wood price\")", !themesOf(v("How do I add my own shingle prices?")).includes("price") && !themesOf(v("Is there a way to show composite vs wood price side by side?")).includes("price"));
check("our price is: \"$99 a month is a lot\", \"too expensive\", \"can't afford it\"", ["$99 a month is a lot in the slow season", "It's too expensive for a one-man shop", "We can't afford it right now"].every((t) => themesOf(v(t)).includes("price")));
check("the invoices they send their clients are not our billing", !themesOf(v("We invoice everything in QuickBooks, double entry takes an hour a day.")).includes("billing") && themesOf(v("I was charged after the trial")).includes("billing"));
check("a subject is read for the theme, not quoted", themesOf(v("Need it for every bid.", { subject: "QuickBooks sync" })).includes("feature") || toolsNamed("QuickBooks sync").includes("QuickBooks"));
check("a short sentence is quoted with the one it answers", quoteFor("Is there a way to show composite vs wood side by side? Would love that.", "feature") === "Is there a way to show composite vs wood side by side? Would love that.", quoteFor("Is there a way to show composite vs wood side by side? Would love that.", "feature"));
check("a technical ticket is a bug even in plain words", themesOf(v("Something is off with my estimate", { category: "technical" })).includes("bug"));
const sum = voiceSummary([v("Too expensive for us", { orgId: "a" }), v("Price is too high", { orgId: "a" }), v("Costs more than Jobber", { orgId: "b" })], NOW);
const price = sum.themes.find((t) => t.key === "price");
check("counted by company: three messages, two companies", !!price && price.items === 3 && price.companies === 2, `${price?.items} msgs, ${price?.companies} cos`);
check("quotes are the customer's own words", !!price && price.quotes[0].text === "Too expensive for us");

console.log("── verdicts");
check("below the sample → too early, whatever the number", verdictOf({ metric: "trialToPaid", target: 0.15, op: ">=", minN: 10 }, { value: 0.9, shown: "", n: 3 }) === "early");
check("over the bar → supported; under → not", verdictOf({ metric: "trialToPaid", target: 0.15, op: ">=", minN: 10 }, { value: 0.2, shown: "", n: 20 }) === "supported" && verdictOf({ metric: "trialToPaid", target: 0.15, op: ">=", minN: 10 }, { value: 0.1, shown: "", n: 20 }) === "refuted");
check("an at-most bar reads the other way", verdictOf({ metric: "priceShare", target: 0.3, op: "<=", minN: 5 }, { value: 0.2, shown: "", n: 10 }) === "supported");
const cancels: CancelFact[] = [{ id: "c1", orgId: paidThenLeft.id, at: NOW - 20 * DAY, reasons: ["too_expensive"], otherText: null }];
const interview = (p: Partial<Interview>): Interview => ({ id: `i${++n}`, at: NOW - 2 * DAY, orgId: null, company: "X", person: "", trade: "Roofing", kind: "problem", channel: "call", pain: 5, currentTool: "pen and paper", wouldPay: "yes", priceSaid: 99, quote: "", notes: "", hypotheses: [], by: null, createdAt: NOW, ...p });
const talks = [interview({ hypotheses: [{ id: "h-pain", effect: "supports" }] }), interview({ pain: 2, hypotheses: [{ id: "h-pain", effect: "refutes" }] })];
const m = measures(all, cancels, [], talks, NOW);
const views = hypothesisViews(
  [
    { id: "h-trial-paid", status: "validated", notes: "Confirmed in October", history: [{ at: NOW, status: "validated", by: "Dana" }] },
    { id: "c-1", status: "testing", notes: "", statement: "Roofers want the measurement without climbing.", test: "8 of 10 say yes", area: "problem", custom: true, history: [] },
  ],
  m,
  talks,
);
const tp = views.find((h) => h.id === "h-trial-paid");
check("the owner's verdict shows over the data's", tp?.shown === "validated" && tp.auto !== undefined);
check("a hypothesis the owner wrote is listed, judged by its status", views.some((h) => h.id === "c-1" && h.shown === "testing" && h.custom));
const pain = views.find((h) => h.id === "h-pain");
check("interviews that back or break a hypothesis are counted", pain?.interviews.supports === 1 && pain.interviews.refutes === 1);

console.log("── the four steps");
const st = stages({ orgs: all, interviews: talks, m, payingByMonth: payingByMonth(all, NOW), now: NOW });
check("two interviews do not pass discovery — we are in discovery", st.current === "discovery" && !st.list[0].done);
check("every check says where it stands", st.list.every((s) => s.criteria.every((c) => c.now.length > 0)));

console.log("── who to talk to next");
const ending = org({ daysOld: 5, status: "TRIALING", trialEndsIn: 2, firstValueAfterDays: 1, estimates: 3 });
const quiet = org({ daysOld: 6, status: "TRIALING", trialEndsIn: 1, firstValueAfterDays: null });
const calls = callList([...all, ending, quiet, paidThenLeft], cancels, [v("Can you add QuickBooks sync?", { orgId: roofers[0].id, at: NOW - 3 * DAY })], [interview({ orgId: roofers[1].id })], NOW);
check("a recent cancellation is on the list, with its reason", calls.some((c) => c.group === "left" && c.orgId === paidThenLeft.id && /price/.test(c.reason)), calls.find((c) => c.group === "left")?.reason);
check("the first cards are a mix of groups, the ending trial first", calls[0]?.group === "trial-ending" && new Set(calls.slice(0, 4).map((c) => c.group)).size === 4, calls.slice(0, 5).map((c) => c.group).join(","));
check("a trial ending in 2 days that used a tool is on the list", calls.some((c) => c.orgId === ending.id && c.group === "trial-ending"));
check("a quiet sign-up is on the list", calls.some((c) => c.orgId === quiet.id && c.group === "quiet"));
check("someone talked to this month is left out", !calls.some((c) => c.orgId === roofers[1].id));
check("each account once", new Set(calls.map((c) => c.orgId)).size === calls.length);

console.log("── the interview check");
check("a company is required", !checkInterview({ at: "2026-10-20", kind: "problem" }).ok);
check("pain is 1–5", !checkInterview({ company: "A", at: "2026-10-20", kind: "problem", pain: 9 }).ok);
const ok = checkInterview({ company: " Acme Roofing ", at: "2026-10-20", kind: "exit", pain: 4, priceSaid: "$99", wouldPay: "maybe", hypotheses: [{ id: "h-pain", effect: "supports" }, { id: "../x", effect: "supports" }] });
check("a good one is trimmed and its price read", ok.ok && ok.value.company === "Acme Roofing" && ok.value.priceSaid === 99 && ok.value.hypotheses.length === 1, JSON.stringify(ok));

console.log("── the weekly scorecard and the report");
const score = (week: string, signups: number) => ({ week, at: NOW, signups, payingNow: 0, activation: null, trialToPaid: null, retention30: null, interviews: 0, validated: 0, invalidated: 0, voice: 0 });
const weeks = withWeek(withWeek([score("2026-W42", 5)], score("2026-W43", 7)), score("2026-W43", 9));
check("one score per week, the latest kept", weeks.length === 2 && weeks[1].signups === 9);
check("the report names no customer", anonymous("Roofing", "UT") === "Roofing contractor · UT" && anonymous("Not given", null) === "Contractor");
check("the state off an address", regionOf("1200 N Main St, Lehi, UT 84043") === "UT" && regionOf("Somewhere") === null);

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
