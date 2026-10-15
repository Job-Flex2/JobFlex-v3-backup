// The CRM brief's rules (lib/crm/brief, 2026-10-14): today's checks and the
// office figures — on fixtures with hand-checked answers, at a frozen clock.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/crm-brief.check.ts
import {
  buildBrief,
  buildOffice,
  buildToday,
  dayKeyTz,
  moneyShort,
  stagesOf,
  startOfDayTz,
  type AppointmentRow,
  type BriefInput,
  type InstallmentRow,
  type JobRow,
  type LeadRow,
  type ProposalRow,
} from "../../../src/lib/crm/brief";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const near = (a: number, b: number, tol = 0.01) => Math.abs(a - b) <= tol;

// Tuesday Oct 13 2026, 12:00 in New York (16:00Z). EDT is UTC−4.
const TZ = "America/New_York";
const NOW = new Date("2026-10-13T16:00:00Z");
const h = (n: number) => new Date(NOW.getTime() + n * 3_600_000);
const d = (n: number) => new Date(NOW.getTime() + n * 86_400_000);
/** A wall-clock time on a day relative to today, in the fixture's zone. */
const at = (dayOffset: number, hh: number, mm = 0) => new Date(Date.UTC(2026, 9, 13 + dayOffset, hh + 4, mm));

const proposal = (o: Partial<ProposalRow> & { id: string }): ProposalRow => ({
  title: `Job ${o.id}`,
  status: "SENT",
  total: 10000,
  extras: 0,
  clientId: `c-${o.id}`,
  clientName: `Client ${o.id}`,
  ownerId: "u-owner",
  createdAt: d(-10),
  sentAt: null,
  viewedAt: null,
  acceptedAt: null,
  declinedAt: null,
  paidAt: null,
  validUntil: null,
  hasJob: false,
  ...o,
});
const stage = (o: Partial<InstallmentRow> & { id: string; proposalId: string }): InstallmentRow => ({ label: "Deposit", amount: 30, isPercent: true, position: 0, status: "UNPAID", dueDate: null, paidAt: null, paidAmount: null, ...o });
const lead = (o: Partial<LeadRow> & { id: string }): LeadRow => ({ name: `Lead ${o.id}`, status: "NEW", projectType: "Deck", createdAt: d(-2), contactedAt: null, assignedToId: null, claimedById: null, assigneeName: null, ...o });
const job = (o: Partial<JobRow> & { id: string }): JobRow => ({ title: `Job ${o.id}`, status: "SCHEDULED", startsAt: null, endsAt: null, clientId: null, clientName: `Client ${o.id}`, proposalId: null, updatedAt: d(-1), assignments: [], hasReviewRequest: false, hasEvent: false, ...o });
const visit = (o: Partial<AppointmentRow> & { id: string; startsAt: Date }): AppointmentRow => ({ title: "Site visit", endsAt: new Date(o.startsAt.getTime() + 3_600_000), status: "SCHEDULED", who: `Visitor ${o.id}`, clientId: null, leadId: null, proposalId: null, crew: [], ...o });

const empty = (over: Partial<BriefInput> = {}): BriefInput => ({
  now: NOW,
  tz: TZ,
  viewer: "office",
  userId: "u-owner",
  proposals: [],
  installments: [],
  payments: [],
  invoices: [],
  leads: [],
  followUps: [],
  changeOrders: [],
  calls: [],
  bookings: [],
  appointments: [],
  jobs: [],
  jobEvents: [],
  workDays: [],
  planVisits: [],
  reviews: [],
  receiptsToReview: 0,
  texts: [],
  members: [{ userId: "u-owner", name: "Alex Rivera", role: "OWNER" }, { userId: "u-sales", name: "Sam Lee", role: "SALES" }],
  workers: [{ id: "w1", userId: "u-w1", name: "Pat Diaz" }],
  activity: [],
  clients: [],
  done: [],
  ...over,
});

console.log("── time in the viewer's zone");
check("noon in New York is Oct 13 there, and Oct 13 begins at 04:00Z", dayKeyTz(NOW, TZ) === "2026-10-13" && startOfDayTz(NOW, TZ).toISOString() === "2026-10-13T04:00:00.000Z");
check("an instant late in the New York evening is still that day there, the next in Tokyo", dayKeyTz(new Date("2026-10-14T02:30:00Z"), TZ) === "2026-10-13" && dayKeyTz(new Date("2026-10-14T02:30:00Z"), "Asia/Tokyo") === "2026-10-14");
check("a winter day starts at 05:00Z (EST)", startOfDayTz(new Date("2026-01-20T12:00:00Z"), TZ).toISOString() === "2026-01-20T05:00:00.000Z");
check("short money", moneyShort(950) === "$950" && moneyShort(12_430) === "$12.4K" && moneyShort(132_000) === "$132K" && moneyShort(2_400_000) === "$2.4M");

console.log("── stages");
{
  const p = proposal({ id: "a", status: "ACCEPTED", total: 10000, extras: 500 });
  const s = stagesOf(p, [stage({ id: "s1", proposalId: "a", amount: 30, isPercent: true, status: "PAID" }), stage({ id: "s2", proposalId: "a", label: "Balance", amount: 70, isPercent: true, position: 1 })], 3000);
  check("a percent stage is a share of the ORIGINAL total; a paid stage owes nothing", s.length === 2 && s[0].due === 0 && near(s[1].due, 7000));
  const w = stagesOf(proposal({ id: "b", status: "ACCEPTED", total: 4000 }), [], 1500);
  check("no stages → one undated whole for what is left", w.length === 1 && w[0].due === 2500 && w[0].dueDate === null && w[0].label === "Full payment");
  check("fully paid with no stages → nothing owed", stagesOf(proposal({ id: "c", total: 4000 }), [], 4000).length === 0);
}

console.log("── a quiet morning");
{
  const t = buildToday(empty());
  check("no checks, a kind line, nothing to score", t.checks.length === 0 && t.score.total === 0 && /Nothing waiting/.test(t.line) && t.dayKey === "2026-10-13" && /Tuesday, October 13/.test(t.heading));
}

console.log("── the full morning");
const full = empty({
  proposals: [
    // money
    proposal({ id: "late", status: "ACCEPTED", acceptedAt: d(-20), total: 12000 }),
    proposal({ id: "soon", status: "ACCEPTED", acceptedAt: d(-10), total: 8000 }),
    proposal({ id: "nodep", status: "ACCEPTED", acceptedAt: d(-3), total: 5000, hasJob: true }),
    proposal({ id: "fresh", status: "ACCEPTED", acceptedAt: h(-20), total: 9000 }), // accepted yesterday: no deposit nag yet, no schedule nag yet
    // sales
    proposal({ id: "exp", status: "SENT", sentAt: d(-5), validUntil: d(2), total: 15000 }),
    proposal({ id: "read", status: "VIEWED", sentAt: d(-6), viewedAt: d(-4), total: 7000 }),
    proposal({ id: "unseen", status: "SENT", sentAt: d(-3), total: 6000 }),
    proposal({ id: "justsent", status: "SENT", sentAt: h(-5), total: 1000 }), // too new to nag
    proposal({ id: "draft", status: "DRAFT", createdAt: d(-9), total: 2500 }),
    proposal({ id: "quiet", status: "VIEWED", sentAt: d(-30), viewedAt: d(-20), total: 11000 }),
    // reading right now
    proposal({ id: "live", status: "VIEWED", sentAt: d(-1), viewedAt: h(-1), total: 3000 }),
    // decided
    proposal({ id: "lost", status: "DECLINED", sentAt: d(-40), declinedAt: d(-30), total: 4000 }),
    proposal({ id: "won-old", status: "PAID", sentAt: d(-50), acceptedAt: d(-45), paidAt: d(-20), total: 20000, ownerId: "u-sales" }),
  ],
  installments: [
    stage({ id: "late-dep", proposalId: "late", amount: 30, isPercent: true, status: "PAID", paidAt: d(-19) }),
    stage({ id: "late-bal", proposalId: "late", label: "Balance", amount: 70, isPercent: true, position: 1, dueDate: d(-5) }),
    stage({ id: "soon-dep", proposalId: "soon", amount: 50, isPercent: true, dueDate: at(1, 9) }),
    stage({ id: "soon-bal", proposalId: "soon", label: "Balance", amount: 50, isPercent: true, position: 1, dueDate: d(30) }),
  ],
  payments: [
    { id: "p1", amount: 3600, paidAt: d(-19), clientId: "c-late", clientName: "Client late", proposalId: "late", method: "card" },
    { id: "p2", amount: 2500, paidAt: h(-6), clientId: "c-won", clientName: "Client won", proposalId: "won-old", method: "ach" },
    { id: "p3", amount: 17500, paidAt: d(-20), clientId: "c-won", clientName: "Client won", proposalId: "won-old", method: "card" },
    { id: "p4", amount: 4000, paidAt: d(-40), clientId: "c-old", clientName: "Old client", proposalId: "x1", method: "check" },
    { id: "p5", amount: 1000, paidAt: d(-41), clientId: "c-old", clientName: "Old client", proposalId: "x2", method: "check" },
  ],
  invoices: [{ id: "i1", number: "INV-7", amount: 450, status: "PENDING", dueDate: d(-2), clientName: "Member Moss", proposalId: null }],
  leads: [
    lead({ id: "l1", createdAt: d(-2) }),
    lead({ id: "l2", createdAt: h(-3), status: "ROUTED" }),
    lead({ id: "l3", createdAt: h(-0.5) }), // half an hour old: not nagged yet
    lead({ id: "l4", createdAt: d(-5), contactedAt: d(-4), status: "CONTACTED" }),
    lead({ id: "l5", createdAt: d(-40), status: "WON", contactedAt: d(-39), assignedToId: "u-sales" }),
  ],
  followUps: [{ id: "f1", runAt: d(-1), proposalId: "unseen", clientName: "Client unseen", title: "Job unseen" }, { id: "f2", runAt: d(3), proposalId: null, clientName: null, title: null }],
  changeOrders: [{ id: "co1", title: "Extra outlet", total: 350, sentAt: d(-3), proposalId: "late", jobId: "j-today", clientName: "Client late" }],
  calls: [
    { id: "k1", direction: "IN", status: "COMPLETED", startedAt: h(-3), summary: "Wants a fence quote", leadId: null, leadName: null, fromNumber: "+12065550101" },
    { id: "k2", direction: "IN", status: "COMPLETED", startedAt: h(-4), summary: "Booked", leadId: "l2", leadName: "Lead l2", fromNumber: "+12065550102" },
    { id: "k3", direction: "OUT", status: "COMPLETED", startedAt: h(-2), summary: null, leadId: null, leadName: null, fromNumber: "+12065550100" },
  ],
  bookings: [{ id: "b1", name: "Riley Shaw", serviceLabel: "Roof inspection", startsAt: at(2, 10), status: "BOOKED", createdAt: h(-2), appointmentId: null }],
  appointments: [
    visit({ id: "v1", startsAt: at(0, 9), who: "Morgan Hale", crew: ["Pat Diaz"], status: "COMPLETED" }),
    visit({ id: "v2", startsAt: at(0, 11, 30), who: "Casey Tran" }), // 11:30–12:30: in progress at noon
    visit({ id: "v3", startsAt: at(0, 15), who: "Jordan Bell", proposalId: "exp" }),
    visit({ id: "v4", startsAt: at(1, 8), who: "Drew Park" }),
    visit({ id: "v5", startsAt: at(3, 13), who: "Avery Cole" }),
    visit({ id: "v6", startsAt: at(0, 16), who: "Nobody", status: "CANCELED" }),
  ],
  jobs: [
    job({ id: "j-today", title: "Hale deck", status: "IN_PROGRESS", clientName: "Morgan Hale", startsAt: at(0, 8), assignments: [{ status: "ACCEPTED", workerName: "Pat Diaz" }, { status: "PENDING", workerName: "Sky Moon" }], hasEvent: true }),
    job({ id: "j-unstaffed", title: "Bell fence", startsAt: at(3, 8), assignments: [] }),
    job({ id: "j-ok", title: "Park roof", startsAt: at(5, 8), assignments: [{ status: "ACCEPTED", workerName: "Pat Diaz" }] }),
    job({ id: "j-done", title: "Cole gutters", status: "COMPLETED", updatedAt: d(-3), clientName: "Avery Cole" }),
    job({ id: "j-done-reviewed", status: "COMPLETED", updatedAt: d(-2), hasReviewRequest: true }),
    job({ id: "j-open-old", title: "Moss siding", status: "IN_PROGRESS", assignments: [{ status: "ACCEPTED", workerName: "Pat Diaz" }] }),
  ],
  jobEvents: [
    { id: "e1", jobId: "j-today", title: "Hale deck · day 2", startsAt: at(0, 8), endsAt: at(0, 16) },
    { id: "e2", jobId: "j-today", title: "Hale deck · day 3", startsAt: at(1, 8), endsAt: at(1, 16) },
    { id: "e3", jobId: "j-ok", title: "Park roof", startsAt: at(5, 8), endsAt: at(5, 17) },
  ],
  workDays: [
    { id: "wd1", jobId: "j-today", date: "2026-10-13", status: "OPEN", dayNumber: 2 },
    { id: "wd2", jobId: "j-open-old", date: "2026-10-11", status: "OPEN", dayNumber: 4 },
  ],
  planVisits: [
    { id: "pv1", label: "Fall tune-up", dueAt: d(4), appointmentId: null, clientName: "Member Moss", planName: "Comfort plan" },
    { id: "pv2", label: "Spring check", dueAt: d(5), appointmentId: "v5", clientName: "Member Reed", planName: "Comfort plan" },
  ],
  reviews: [
    { id: "r1", status: "COMPLETED", rating: 5, sentAt: d(-3), completedAt: h(-5), clientName: "Drew Park", jobId: "j-done-reviewed" },
    { id: "r2", status: "COMPLETED", rating: 4, sentAt: d(-30), completedAt: d(-25), clientName: "Old client", jobId: null },
    { id: "r3", status: "SENT", rating: null, sentAt: d(-1), completedAt: null, clientName: "Casey Tran", jobId: null },
  ],
  receiptsToReview: 2,
  texts: [
    { id: "t1", direction: "IN", from: "+12065550111", to: "+12065550000", createdAt: h(-5), body: "Can you come Thursday instead?" },
    { id: "t2", direction: "IN", from: "+12065550112", to: "+12065550000", createdAt: h(-8), body: "Thanks!" },
    { id: "t3", direction: "OUT", from: "+12065550000", to: "+12065550112", createdAt: h(-7), body: "You're welcome" },
  ],
  activity: [
    { id: "a1", kind: "VIEWED", summary: "Client live opened the proposal", createdAt: h(-1), actorId: null, clientId: "c-live" },
    { id: "a2", kind: "PAID", summary: "Client won paid $2,500", createdAt: h(-6), actorId: null, clientId: "c-won" },
    { id: "a3", kind: "SENT", summary: "Sent Job unseen", createdAt: d(-3), actorId: "u-owner", clientId: "c-unseen" },
  ],
  clients: [
    { id: "c-late", name: "Client late", createdAt: d(-30) },
    { id: "c-won", name: "Client won", createdAt: d(-60) },
    { id: "c-old", name: "Old client", createdAt: d(-200) },
    { id: "c-new", name: "Brand New", createdAt: d(-2) },
  ],
  done: ["money.received"],
});

const T = buildToday(full);
const byKey = new Map(T.checks.map((c) => [c.key, c]));
const K = (k: string) => byKey.get(k);

console.log("   money");
check("overdue: the late balance ($8,400, 5 days) and the late invoice ($450) · danger", K("money.overdue")?.count === 2 && near(K("money.overdue")?.amount ?? 0, 8850) && K("money.overdue")?.tone === "danger" && /5 days late/.test(K("money.overdue")?.items[0].sub ?? ""));
check("due soon: the $4,000 deposit due tomorrow, not the balance in 30 days", K("money.due-soon")?.count === 1 && near(K("money.due-soon")?.amount ?? 0, 4000) && /due tomorrow/.test(K("money.due-soon")?.items[0].sub ?? ""));
check("no deposit: accepted 3 days ago with nothing paid; the one accepted yesterday is spared, and so is the one whose deposit is dated tomorrow", K("money.no-deposit")?.count === 1 && K("money.no-deposit")?.items[0].label === "Client nodep" && near(K("money.no-deposit")?.amount ?? 0, 5000));
check("received since yesterday: $2,500, ticked already", K("money.received")?.amount === 2500 && K("money.received")?.done === true && K("money.received")?.tone === "ok");
check("receipts to review: 2", K("money.receipts")?.count === 2);

console.log("   sales");
check("call back: two leads over an hour old, the half-hour one spared; oldest 2 days → danger", K("sales.call-back")?.count === 2 && K("sales.call-back")?.tone === "danger" && K("sales.call-back")?.items[0].label === "Lead l1");
check("follow-ups due: one (the other is in 3 days) → the queue tab", K("sales.follow-ups")?.count === 1 && K("sales.follow-ups")?.goto === "queue");
check("expiring within 3 days: one, $15,000, danger", K("sales.expiring")?.count === 1 && K("sales.expiring")?.amount === 15000 && K("sales.expiring")?.tone === "danger");
check("read 4 days ago, silent: one; the one read an hour ago is not nagged, the 20-day one belongs to quiet", K("sales.viewed-silent")?.count === 1 && K("sales.viewed-silent")?.items[0].label === "Client read");
check("sent 3 days ago, unopened: one; the one sent 5 hours ago is not nagged, the expiring one is listed under expiring", K("sales.sent-unseen")?.count === 1 && K("sales.sent-unseen")?.items[0].label === "Client unseen");
check("change order waiting 3 days: one, $350, links to its job", K("sales.change-orders")?.count === 1 && K("sales.change-orders")?.items[0].href === "/dashboard/jobs/j-today");
check("calls with no lead: one inbound (the one tied to a lead and the outbound are not it)", K("sales.calls")?.count === 1 && K("sales.calls")?.items[0].label === "+12065550101");
check("new website booking: one, named with its slot", K("sales.bookings")?.count === 1 && /Riley Shaw/.test(K("sales.bookings")?.items[0].label ?? "") && /Thu Oct 15/.test(K("sales.bookings")?.items[0].sub ?? ""));
check("stale draft: one, 9 days old", K("sales.stale-drafts")?.count === 1);

console.log("   schedule");
check("visits today: 3 (the canceled one is not a visit), in time order, first at 9:00 AM", K("schedule.visits-today")?.count === 3 && /^9:00 AM · Morgan Hale/.test(K("schedule.visits-today")?.items[0].label ?? "") && /Pat Diaz/.test(K("schedule.visits-today")?.items[0].sub ?? ""));
check("jobs on site today: Hale deck (open, Pat on, waiting on Sky) + Moss siding (in progress) → warn, ping the crew", K("schedule.jobs-today")?.count === 2 && K("schedule.jobs-today")?.tone === "warn" && /on site now · Pat Diaz · waiting on Sky Moon/.test(K("schedule.jobs-today")?.items[0].sub ?? ""));
check("unstaffed this week: Bell fence in 3 days; Park roof has Pat", K("schedule.unstaffed")?.count === 1 && K("schedule.unstaffed")?.items[0].label === "Bell fence · Client j-unstaffed" && K("schedule.unstaffed")?.tone === "danger");
check("accepted, not on the calendar: late (20 d) and soon (10 d); nodep has a job, fresh is a day old", K("schedule.unscheduled")?.count === 2 && K("schedule.unscheduled")?.items[0].label === "Client late");
check("service visit due with no appointment: Moss only", K("schedule.plan-visits")?.count === 1 && /Member Moss/.test(K("schedule.plan-visits")?.items[0].label ?? ""));
check("tomorrow: 2 stops, first at 8:00 AM", K("schedule.tomorrow")?.count === 2 && /first at 8:00 AM/.test(K("schedule.tomorrow")?.title ?? ""));

console.log("   clients");
check("finished with no review asked: Cole gutters only", K("clients.ask-review")?.count === 1 && /Cole gutters/.test(K("clients.ask-review")?.items[0].label ?? ""));
check("reviews in: one 5★ since yesterday → ok", K("clients.reviews-in")?.count === 1 && /5\.0 ★/.test(K("clients.reviews-in")?.title ?? "") && K("clients.reviews-in")?.tone === "ok");
check("texts with no reply: the Thursday question; the thanked one was answered", K("clients.texts")?.count === 1 && /Thursday/.test(K("clients.texts")?.items[0].sub ?? ""));
check("gone quiet 2+ weeks: the one read 20 days ago; the one sent 3 days ago had a touch", K("clients.quiet")?.count === 1 && K("clients.quiet")?.items[0].label === "Client quiet" && K("clients.quiet")?.goto === "customers");

console.log("   team");
check("crew invites unanswered: Sky Moon on Hale deck", K("team.invites")?.count === 1 && K("team.invites")?.items[0].label === "Sky Moon");
check("a work day left open from Oct 11", K("team.open-days")?.count === 1 && /day 4 · 2026-10-11/.test(K("team.open-days")?.items[0].sub ?? ""));

console.log("   the sheet");
check("groups in order, each with its count", T.groups.map((g) => g.key).join(",") === "money,sales,schedule,clients,team" && T.groups[0].count === 5 && T.groups[0].done === 1);
check("danger before warn before info inside a group", T.checks.filter((c) => c.group === "money").map((c) => c.tone).join(",") === "danger,warn,warn,info,ok");
check("the score and the line: 26 checks, one ticked, five on fire", T.score.total === 26 && T.score.done === 1 && /25 things to check · 5 can't wait/.test(T.line));
check("never more than five rows on a check; the rest counted", T.checks.every((c) => c.items.length <= 5 && c.more >= 0));

console.log("── other readers");
{
  const s = buildToday({ ...full, viewer: "sales", userId: "u-sales", done: [] });
  check("a sales rep sees no money and no office-only checks", !s.checks.some((c) => c.group === "money" || c.key === "sales.change-orders" || c.group === "team" || c.group === "clients"));
  check("a sales rep sees their own and unowned proposals, not the owner's", s.checks.every((c) => !c.items.some((i) => i.label === "Client exp")) && s.checks.some((c) => c.key === "sales.call-back"));
  const e = buildToday({ ...full, viewer: "estimator", userId: "u-owner", done: [] });
  check("an estimator sees proposals only (expiring, read, unseen, drafts)", e.checks.every((c) => ["sales.expiring", "sales.viewed-silent", "sales.sent-unseen", "sales.stale-drafts"].includes(c.key)) && e.checks.length === 4);
  const b = buildBrief({ ...full, viewer: "sales", userId: "u-sales" });
  check("no office sheet for a sales rep", b.office === null && b.viewer === "sales");
}

console.log("── the office");
const O = buildOffice(full);
const stat = (k: string) => O.health.find((s) => s.key === k);
check("collected this month: the $2,500 today · by Sep 13 last month $5,000 (Sep 2 + Sep 3; Sep 23/24 are past that day) → down 50%", stat("mtd")?.raw === 2500 && stat("mtd")?.delta?.pct === -50 && stat("mtd")?.delta?.tone === "danger" && /5,000 by this day last month/.test(stat("mtd")?.sub ?? ""));
check("collected 7 days: $2,500 · the week before nothing → new", stat("week")?.raw === 2500 && stat("week")?.delta?.words === "new this period");
check("still owed: late balance 8,400 + soon 4,000 + 4,000 + nodep 5,000 + fresh 9,000 = $30,400, $8,400 of it overdue", near(stat("outstanding")?.raw ?? 0, 30400) && /8,400 of it overdue/.test(stat("outstanding")?.sub ?? "") && stat("outstanding")?.tone === "danger");
check("out for decision: exp 15,000 + read 7,000 + unseen 6,000 + justsent 1,000 + quiet 11,000 + live 3,000 = $43,000 across 6", stat("pipeline")?.raw === 43000 && /6 proposals/.test(stat("pipeline")?.sub ?? ""));
check("win rate 90 days: late, soon, nodep, fresh, won-old won; lost lost → 5 of 6 = 83%", stat("win")?.value === "83%" && /5 won of 6 decided/.test(stat("win")?.sub ?? ""));
check("days to a yes: won-old only carries both dates → 5.0", stat("yes")?.value === "5.0");
check("jobs in motion: 2 in progress + 2 scheduled (the finished ones are not in motion)", stat("jobs")?.raw === 4 && /2 in progress · 2 scheduled/.test(stat("jobs")?.sub ?? ""));
check("new leads 30 days: 4 (l5 is 40 days old) · 1 before → up", stat("leads")?.raw === 4 && stat("leads")?.delta?.tone === "ok");

console.log("   right now");
check("the line: 1 crew on site · 1 visit in progress · $2,500 in today · 1 proposal being read", O.now.line === "1 crew on site · 1 visit in progress · $2,500 in today · 1 proposal being read");
check("on site: Hale deck started (day 2) first, Moss siding not started today", O.now.onSite.length === 2 && O.now.onSite[0].id === "j-today" && O.now.onSite[0].started && O.now.onSite[0].day === 2 && O.now.onSite[1].started === false);
check("visits: 9:00 done · 11:30 now · 3:00 next; the canceled one is out", O.now.visits.map((v) => v.state).join(",") === "done,now,next");
check("being read: the one opened an hour ago", O.now.reading.length === 1 && O.now.reading[0].proposalId === "live");
check("crew out: Pat only", O.now.crewOut === 1);

console.log("   funnel, cash, week");
check("funnel: 4 leads in · 1 contacted · 6 sent (quiet sits on the 30-day line) · 4 won · 2 paid (the late deposit 19 days ago, won-old today)", O.funnel.steps.map((s) => s.count).join(",") === "4,1,6,4,2");
check("funnel values: sent 15+7+6+1+3+11 = 43,000 · won 12+8+5+9 = 34,000 (won-old was 45 days ago) · paid 3,600 + 17,500 + 2,500 = 23,600", O.funnel.steps[2].value === 43000 && O.funnel.steps[3].value === 34000 && O.funnel.steps[4].value === 23600);
check("cash: overdue 8,400 · this week 4,000 · in 5 weeks 4,000 · no date 14,000 · total 30,400", O.cash.overdue === 8400 && O.cash.buckets.find((b) => b.key === "w0")?.amount === 4000 && O.cash.buckets.find((b) => b.key === "w4")?.amount === 4000 && O.cash.undated === 14000 && near(O.cash.total, 30400));
check("week strip: today 3 visits (the finished one counts, the canceled one not) + 1 job, tomorrow 1 + 1, Friday 1 visit, Sunday 1 job; today first", O.week.days.length === 7 && O.week.days[0].today && O.week.days[0].visits === 3 && O.week.days[0].jobs === 1 && O.week.days[1].visits === 1 && O.week.days[1].jobs === 1 && O.week.days[3].visits === 1 && O.week.days[3].label === "Fri" && O.week.days[5].jobs === 1 && O.week.days[0].label === "Tue");
check("week totals: 5 visits + 3 job days booked", O.week.booked === 8);

console.log("   team, clients, reviews, pulse");
check("team: the owner sent 6 and won 4 ($34,000) in 30 days; Sam's win was 45 days ago", O.team[0].userId === "u-owner" && O.team[0].sent === 6 && O.team[0].won === 4 && O.team[0].wonValue === 34000 && O.team[1].won === 0 && O.team[1].leads === 0);
check("clients: 4 total · 1 new this month · 1 repeat (Old client, two paid proposals) · top is Client won at $20,000", O.clients.total === 4 && O.clients.newThisMonth === 1 && O.clients.repeat === 1 && O.clients.top[0].name === "Client won" && O.clients.top[0].ltv === 20000 && O.clients.quiet === 1);
check("reviews: 4.5 across 2 rated in 90 days, newest first", O.reviews.avg === 4.5 && O.reviews.count === 2 && O.reviews.latest[0].client === "Drew Park");
check("pulse: the last day's two events", O.pulse.length === 2 && O.pulse[0].id === "a1");

console.log("── ticks");
{
  const t = buildToday({ ...full, done: ["money.overdue", "sales.call-back", "nope.never"] });
  check("ticked keys read as done; unknown keys are ignored", t.score.done === 2 && t.checks.find((c) => c.key === "money.overdue")?.done === true);
  const all = buildToday({ ...full, done: T.checks.map((c) => c.key) });
  check("all ticked → desk is clear", /All 26 checked\. Desk is clear/.test(all.line) && all.score.open === 0);
}

console.log(bad ? `\n${bad} FAILED` : "\nall good");
process.exit(bad ? 1 : 0);
