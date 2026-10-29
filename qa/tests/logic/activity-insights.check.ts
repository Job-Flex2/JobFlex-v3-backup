// WHAT MEMBERS DO — the analyst of the trail (lib/activityInsights, 2026-10-28), proven on made-up workspaces:
// the areas members use, the first day, the buyers' habit, proposals opened and signed, estimators looked at and
// never used, the team side, quiet paying accounts, trials ending empty, the hours, where sittings end.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/activity-insights.check.ts
import { analyseActivity, busyHoursWords, hourWord, hoursWords, median, orgState, sittingsOf, type InsightEvent, type InsightInput, type InsightOrg, type InsightProposal, type InsightView } from "../../../src/lib/activityInsights";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

// ── helpers ──
check("hour words", hourWord(0) === "12 am" && hourWord(9) === "9 am" && hourWord(12) === "12 pm" && hourWord(19) === "7 pm");
check("busy hours: contiguous hours join, far ones list", busyHoursWords([0, 0, 0, 0, 0, 0, 0, 0, 10, 9, 8, 2, 1, 1, 1, 1, 1, 1, 1, 7, 8, 1, 0, 0]) === "8 am–11 am and 7 pm–9 pm", busyHoursWords([0, 0, 0, 0, 0, 0, 0, 0, 10, 9, 8, 2, 1, 1, 1, 1, 1, 1, 1, 7, 8, 1, 0, 0]));
check("hours in words", hoursWords(0.5) === "30 min" && hoursWords(4) === "4 h" && hoursWords(2.5) === "2.5 h" && hoursWords(72) === "3 days");
check("median", median([]) === null && median([3, 1, 2]) === 2 && median([1, 2, 3, 4]) === 2.5);
check("an account's state", orgState({ plan: "professional", status: "ACTIVE" }) === "paying" && orgState({ plan: "FREE", status: "ACTIVE" }) === "other" && orgState({ plan: "professional", status: "TRIALING" }) === "trial" && orgState({ plan: "professional", status: "CANCELED" }) === "lapsed" && orgState({ plan: "professional", status: "TRIAL_ENDED" }) === "lapsed");

// ── a month of made-up workspaces ──
const DAY = 86_400_000;
const H = 3_600_000;
const NOW = Date.parse("2026-10-28T20:00:00Z"); // 1 pm in Los Angeles
const SINCE = NOW - 30 * DAY;
const nineAm = (daysAgo: number) => Date.parse("2026-10-28T16:00:00Z") - daysAgo * DAY; // 9 am PDT

const orgs: InsightOrg[] = [];
const views: InsightView[] = [];
const events: InsightEvent[] = [];
const proposals: InsightProposal[] = [];
const area = (screen: string) => screen.split(" · ")[0];
function sitting(orgId: string, userId: string, at: number, screens: string[]) {
  screens.forEach((screen, i) => views.push({ orgId, userId, at: at + i * 2 * 60_000, screen, area: area(screen) }));
}
function org(id: string, createdDaysAgo: number, status: string, extra: Partial<InsightOrg> = {}): InsightOrg {
  const o: InsightOrg = { id, name: id.toUpperCase(), createdAt: NOW - createdDaysAgo * DAY, plan: "professional", status, trialEndsAt: null, members: 1, owners: [`${id}-owner`], ...extra };
  orgs.push(o);
  return o;
}
// Five paying accounts, 20 days old: priced on day one, wrote and sent a proposal, a client signed; three sittings since.
for (let i = 1; i <= 5; i++) {
  const id = `p${i}`;
  const o = org(id, 20, "ACTIVE", { members: i <= 2 ? 2 : 1 });
  const t0 = o.createdAt;
  sitting(id, `${id}-owner`, t0 + 1 * H, ["Overview", "Roof estimator"]);
  events.push({ orgId: id, actorId: `${id}-owner`, kind: "ESTIMATE", at: t0 + 3 * H, trade: "roof", proposalId: null, clientId: null });
  proposals.push({ orgId: id, createdAt: t0 + 4 * H, sentAt: t0 + 5 * H, viewedAt: t0 + 30 * H, acceptedAt: t0 + 3 * DAY, declinedAt: null, paidAt: i === 1 ? t0 + 5 * DAY : null, total: 12000, trade: "roof" });
  // A second proposal ten days ago that nobody opened.
  proposals.push({ orgId: id, createdAt: NOW - 10 * DAY, sentAt: NOW - 10 * DAY + H, viewedAt: null, acceptedAt: null, declinedAt: null, paidAt: null, total: 8000, trade: "roof" });
  sitting(id, `${id}-owner`, nineAm(15), ["Overview", "Proposals", "Clients"]);
  sitting(id, `${id}-owner`, nineAm(10), ["Proposals", "Roof estimator", "Fence estimator", "Proposals"]);
  sitting(id, `${id}-owner`, nineAm(5), ["Clients", "Proposals", "Calendar"]);
  events.push({ orgId: id, actorId: `${id}-owner`, kind: "CLIENT", at: nineAm(15) + H, trade: null, proposalId: null, clientId: `c-${id}` });
}
events.push({ orgId: "p1", actorId: "p1-worker", kind: "PHOTO", at: nineAm(5) + H, trade: null, proposalId: null, clientId: null });
// Four lost trials, 20 days old: Overview and Settings, a look at the fence estimator, never priced anything.
for (let i = 1; i <= 4; i++) {
  const id = `l${i}`;
  org(id, 20, "CANCELED");
  sitting(id, `${id}-owner`, nineAm(19), ["Overview", "Proposals", "Settings"]);
  sitting(id, `${id}-owner`, nineAm(18), ["Overview", "Settings"]);
  sitting(id, `${id}-owner`, nineAm(17), ["Overview", "Fence estimator", "Settings"]);
}
// Trials: t1 two days in and priced; t2 five days in with nothing, ending in two days; t3 never opened, ending tomorrow.
const t1 = org("t1", 2, "TRIALING", { trialEndsAt: NOW + 5 * DAY });
sitting("t1", "t1-owner", t1.createdAt + H, ["Overview", "Roof estimator"]);
events.push({ orgId: "t1", actorId: "t1-owner", kind: "ESTIMATE", at: t1.createdAt + 2 * H, trade: "roof", proposalId: null, clientId: null });
const t2 = org("t2", 5, "TRIALING", { trialEndsAt: NOW + 2 * DAY });
sitting("t2", "t2-owner", t2.createdAt + H, ["Overview", "Clients"]);
org("t3", 12, "TRIALING", { trialEndsAt: NOW + 1 * DAY });
// Two paying accounts from two months ago: one quiet for twenty days, one never seen in the range.
org("q1", 60, "ACTIVE");
sitting("q1", "q1-owner", nineAm(20), ["Proposals", "Referrals"]);
org("q2", 60, "ACTIVE");
// A workspace made yesterday that did everything in its first hours.
const n1 = org("n1", 1, "TRIALING", { trialEndsAt: NOW + 6 * DAY });
sitting("n1", "n1-owner", n1.createdAt + 30 * 60_000, ["Overview", "Roof estimator", "Proposals"]);
events.push({ orgId: "n1", actorId: "n1-owner", kind: "ESTIMATE", at: n1.createdAt + 40 * 60_000, trade: "roof", proposalId: null, clientId: null });
proposals.push({ orgId: "n1", createdAt: n1.createdAt + H, sentAt: n1.createdAt + 2 * H, viewedAt: null, acceptedAt: null, declinedAt: null, paidAt: null, total: 5000, trade: "roof" });
// A workspace deleted since: its rows are left out.
views.push({ orgId: "gone", userId: "gone-owner", at: nineAm(3), screen: "Proposals", area: "Proposals" });

const input: InsightInput = { now: NOW, since: SINCE, timezone: "America/Los_Angeles", orgs, views, events, proposals, truncated: false };
const r = analyseActivity(input);
const finding = (key: string) => r.findings.find((f) => f.key === key);

// ── sittings ──
const s = sittingsOf(views.filter((v) => v.orgId === "p1"));
check("sittings: screens two minutes apart are one sitting, a day apart are two", s.length === 4 && s[0].screens === 2 && s[0].first === "Overview" && s[0].last === "Roof estimator", JSON.stringify(s.map((x) => x.screens)));
check("sample: workspaces, active, new, states, members, sittings", r.sample.workspaces === 15 && r.sample.active === 13 && r.sample.viewers === 13 && r.sample.newOnes === 13 && r.sample.paying === 7 && r.sample.trial === 4 && r.sample.lapsed === 4 && r.sample.members === 14 && r.sample.sittings === 36 && !r.quiet, JSON.stringify(r.sample));
check("a deleted workspace's rows are left out", r.sample.views === 101, String(r.sample.views));

// ── areas ──
check("areas: Overview and Proposals on top, shares of the workspaces that opened anything", r.areas[0].area === "Overview" && r.areas[1].area === "Proposals" && r.areas[1].workspaces === 11 && Math.round(r.areas[1].share * 100) === 85 && r.areas[2].area === "Fence estimator" && r.areas[2].workspaces === 9, r.areas.slice(0, 3).map((a) => `${a.area}:${a.workspaces}`).join(" "));
check("…with the paying and lost shares side by side", Math.round((r.areas.find((a) => a.area === "Roof estimator")?.payingShare ?? 0) * 100) === 83 && r.areas.find((a) => a.area === "Roof estimator")?.lapsedShare === 0 && r.areas.find((a) => a.area === "Settings")?.lapsedShare === 1);
check("the top-areas finding names what members live in", /Proposals/.test(finding("top-areas")?.title ?? "") && finding("top-areas")?.evidence === "Of the 13 workspaces that opened anything: Proposals 85%, Fence estimator 69%, Roof estimator 54%.", finding("top-areas")?.evidence);
check("screens almost nobody opens (fewer than one in ten): Referrals, not Calendar", finding("unused-areas")?.evidence === "Referrals (1) — each opened by fewer than one workspace in ten." && finding("unused-areas")?.title === "One screen almost nobody opens", finding("unused-areas")?.evidence);

// ── the first day ──
check("first day: priced, proposed, sent, the median first proposal, where the first sitting ends", r.firstDay.newOnes === 13 && r.firstDay.priced === 7 && r.firstDay.proposed === 6 && r.firstDay.sent === 6 && r.firstDay.medianHoursToFirstProposal === 4 && r.firstDay.endsOn[0].screen === "Roof estimator", JSON.stringify(r.firstDay));
check("…the first-day finding: a warn under half, with the numbers", finding("first-day")?.tone === "good" && /7 of 13 new workspaces ran an estimate in their first 24 hours, 6 wrote a proposal and 6 sent one; the median first proposal came 4 h after sign-up/.test(finding("first-day")?.evidence ?? ""), finding("first-day")?.evidence);
check("idle new workspaces: 6 of 11 settled ones never priced or wrote anything, named", r.firstDay.idle === 6 && finding("idle-new")?.tone === "bad" && finding("idle-new")?.names?.length === 6 && finding("idle-new")?.names?.includes("T2") === true && /what they did open: Proposals \(4\), Settings \(4\)/.test(finding("idle-new")?.evidence ?? ""), finding("idle-new")?.evidence);

// ── the buyers' habit ──
check("cohorts: five paying against four lost, priced-in-week-one is the whole gap", r.cohorts?.paying === 5 && r.cohorts?.lapsed === 4 && r.cohorts?.rows[0].what === "Priced an estimate" && r.cohorts?.rows[0].gap === 1 && r.cohorts?.rows.find((x) => x.what === "Invited a teammate")?.paying === 2, JSON.stringify(r.cohorts?.rows.slice(0, 2)));
check("…said as the one thing the trial should ask for", finding("buyers-habit")?.title === "priced an estimate in week one is what separates the ones who paid" && /5 of 5 paying accounts did it in their first seven days; 0 of 4 lost trials did/.test(finding("buyers-habit")?.evidence ?? ""), finding("buyers-habit")?.evidence);

// ── proposals ──
check("proposals: 11 sent, 5 opened, 5 signed, 1 paid; open rate under half", r.proposals.sent === 11 && r.proposals.viewed === 5 && r.proposals.accepted === 5 && r.proposals.paid === 1 && Math.round((r.proposals.openRate ?? 0) * 100) === 45 && r.proposals.medianHoursToView === 25 && r.proposals.medianHoursToAccept === 67 && r.proposals.byTrade[0].trade === "roof", JSON.stringify(r.proposals));
check("…the finding says the send is not landing", finding("proposal-outcomes")?.tone === "warn" && /never opened/.test(finding("proposal-outcomes")?.title ?? "") && /11 sent, 5 opened, 5 signed, 1 paid; the median open takes 25 h and the median signature 2.8 days/.test(finding("proposal-outcomes")?.evidence ?? ""), finding("proposal-outcomes")?.evidence);

// ── estimators ──
const roof = r.estimators.find((e) => e.trade === "roof");
const fence = r.estimators.find((e) => e.trade === "fence");
check("estimators: roof used by 7 workspaces with no lookers; the fence estimator looked at by 9 and never used", roof?.estimates === 7 && roof.workspaces === 7 && roof.lookers === 0 && fence?.estimates === 0 && fence.lookers === 9, JSON.stringify(r.estimators));
check("…the fence finding", finding("lookers-fence")?.title === "Fence estimator: 9 of 9 workspaces opened it and never priced anything" && !finding("lookers-roof"), finding("lookers-fence")?.title);

// ── the team side ──
check("team: 2 of 15 have a second member, one action in forty by a non-owner", r.team.multiMember === 2 && r.team.nonOwnerActions === 1 && finding("team")?.title === "The product is used alone" && /2 of 15 workspaces have a second member; 8% of recorded actions/.test(finding("team")?.evidence ?? ""), finding("team")?.evidence);

// ── quiet paying, trials ending empty ──
check("quiet paying: q1 twenty days, q2 never seen; the five active ones are not", r.quietPaying.length === 2 && r.quietPaying[0].name === "Q2" && r.quietPaying[0].daysQuiet === null && r.quietPaying[1].daysQuiet === 20 && finding("quiet-paying")?.tone === "bad" && finding("quiet-paying")?.names?.join() === "Q2 · not seen,Q1 · 20 d" && finding("quiet-paying")?.evidence === "Nothing opened or done for 14 days or more; the most recent of them was seen 20 days ago; 1 was not seen in the range at all.", JSON.stringify(r.quietPaying));
check("trials ending within three days with nothing in them: t3 tomorrow, t2 in two days — not t1, not n1", r.endingEmpty.map((t) => `${t.name}:${t.daysLeft}`).join(" ") === "T3:1 T2:2" && finding("ending-empty")?.tone === "warn" && finding("ending-empty")?.evidence === "No estimate and no proposal in any of them; the first ends tomorrow." && finding("ending-empty")?.names?.[0] === "T3 · 1 d left", JSON.stringify(r.endingEmpty));

// ── hours, sittings, dead ends ──
check("hours: every sitting at 9 am Los Angeles", r.hours.byHour[9] === 28 && r.hours.byHour[14] === 7 && r.hours.byHour[13] === 1 && r.hours.busy === "9 am" && finding("hours")?.title === "Members work 9 am" && /36 sittings in the range/.test(finding("hours")?.evidence ?? ""), `${r.hours.busy} · ${finding("hours")?.evidence}`);
check("sittings: a typical one is 4 min and 3 screens", r.sittings.n === 36 && r.sittings.medianMinutes === 4 && r.sittings.medianScreens === 3 && r.sittings.oneScreenShare === 0, JSON.stringify({ m: r.sittings.medianMinutes, s: r.sittings.medianScreens, one: r.sittings.oneScreenShare }));
check("sittings end on Settings far more than its share of screens", r.sittings.endsOn[0].screen === "Settings" && r.sittings.endsOn[0].n === 12 && r.sittings.endsOn[0].ratio > 2 && finding("dead-end")?.title === "Sittings end on Settings 2.8× more than its share", finding("dead-end")?.title);

// ── the order and the line ──
check("findings: the bad ones first, then warn, good, info", r.findings.map((f) => f.tone).join(",").replace(/(bad,)+/, "B").replace(/(warn,?)+/, "W").replace(/(good,?)+/, "G").replace(/(info,?)+/, "I") === "BWGI", r.findings.map((f) => `${f.tone}:${f.key}`).join(" "));
check("the one line", r.headline === "13 active of 15 workspaces (7 paying, 4 on trial) · members live in Proposals and Fence estimator · 7 of 13 new ones priced something on day one · 2 paying accounts gone quiet.", r.headline);

// ── too few to speak ──
const few = analyseActivity({ ...input, orgs: orgs.slice(0, 3), views: views.filter((v) => /^p[1-3]$/.test(v.orgId)), events: [], proposals: [] });
check("under five active workspaces the analyst says so and makes no findings", few.quiet && few.findings.length === 0 && /3 workspaces active in the range — the analyst speaks from 5/.test(few.headline), few.headline);
check("all time: every workspace is 'new' and the cohorts still read", analyseActivity({ ...input, since: null }).sample.newOnes === 15 && analyseActivity({ ...input, since: null }).cohorts?.paying === 7);

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
