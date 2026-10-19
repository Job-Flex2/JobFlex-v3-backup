// HVAC services desk (lib/serviceDesk, 2026-10-18): what needs the contractor, the schedule's stages and
// season, the reminder settings, the daily digest, and the "Service reminders" texting key.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/service-desk.check.ts
import {
  DESK_PREFS_DEFAULT,
  addDay,
  clientFilterOf,
  dayDiff,
  dayLabel,
  digestText,
  isReplacementCandidate,
  localDay,
  monthLoad,
  needsYou,
  normalizeDeskPrefs,
  parseReminderMeta,
  reminderPresets,
  visitStage,
  type DeskInstall,
  type DeskPlan,
  type DeskReminder,
  type DeskUnit,
  type DeskVisit,
} from "../../../src/lib/serviceDesk";
import { prefKeyForEvent, textEventsFor } from "../../../src/lib/notificationPrefsShared";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const TZ = "America/Chicago";
// Saturday Oct 18 2026, 10:00 in Chicago.
const NOW = new Date("2026-10-18T15:00:00Z");
const at = (iso: string) => new Date(iso);

// ── settings
const d = normalizeDeskPrefs(null);
check("settings default: heads-up 3 days, unsigned after 3, digest on", d.headsUpDays === 3 && d.unsignedDays === 3 && d.dailyDigest === true);
const n = normalizeDeskPrefs({ headsUpDays: "7", unsignedDays: 9, dailyDigest: "off" });
check("settings: a posted '7' is taken, an unknown 9 snaps back, 'off' turns the digest off", n.headsUpDays === 7 && n.unsignedDays === DESK_PREFS_DEFAULT.unsignedDays && n.dailyDigest === false, JSON.stringify(n));

// ── the shop's calendar day
check("the shop's day: 03:00 UTC is still yesterday in Chicago", localDay(at("2026-10-18T03:00:00Z"), TZ) === "2026-10-17");
check("day math across a year end", dayDiff("2026-12-30", "2027-01-02") === 3 && addDay("2026-12-31", 1) === "2027-01-01" && addDay("2027-03-01", -1) === "2027-02-28");
check("day words: today / tomorrow / yesterday", dayLabel("2026-10-18", NOW, TZ) === "today" && dayLabel("2026-10-19", NOW, TZ) === "tomorrow" && dayLabel("2026-10-17", NOW, TZ) === "yesterday");
check("day words: this week by weekday, later by date, another year with it", dayLabel("2026-10-21", NOW, TZ) === "Wed, Oct 21" && dayLabel("2026-11-02", NOW, TZ) === "Nov 2" && dayLabel("2027-04-15", NOW, TZ) === "Apr 15, 2027", `${dayLabel("2026-10-21", NOW, TZ)} | ${dayLabel("2026-11-02", NOW, TZ)} | ${dayLabel("2027-04-15", NOW, TZ)}`);

// ── visits
const visit = (id: string, startsAt: string, extra: Partial<DeskVisit> = {}): DeskVisit => ({
  id,
  planId: "plan-mark",
  planName: "Comfort Plan",
  planStatus: "ACTIVE",
  clientId: "c-mark",
  clientName: "Mark Ellis",
  address: "2207 Cedar Ridge Ln, McKinney, TX 75070",
  phone: "(214) 555-0182",
  label: "Fall heating tune-up",
  startsAt: at(startsAt),
  status: "SCHEDULED",
  appointmentId: `apt-${id}`,
  report: "none",
  techs: [],
  techIds: [],
  ...extra,
});
const stage = (iso: string, extra: Partial<DeskVisit> = {}) => visitStage(visit("x", iso, extra), NOW, TZ, 3);
check("stage: yesterday is overdue, today is today", stage("2026-10-17T14:00:00Z") === "overdue" && stage("2026-10-18T22:00:00Z") === "today");
check("stage: 3 days out is coming up, 4 days out is scheduled", stage("2026-10-21T14:00:00Z") === "soon" && stage("2026-10-22T14:00:00Z") === "later");
check("stage: done and skipped win over the date", stage("2026-10-01T14:00:00Z", { status: "DONE" }) === "done" && stage("2026-11-01T14:00:00Z", { status: "SKIPPED" }) === "skipped");
check("stage: 23:30 tonight in Chicago is still today (05:30 UTC tomorrow)", stage("2026-10-19T04:30:00Z") === "today");

const load = monthLoad([visit("a", "2026-10-20T14:00:00Z"), visit("b", "2026-10-05T14:00:00Z", { status: "DONE" }), visit("c", "2027-04-15T14:00:00Z"), visit("d", "2027-04-16T14:00:00Z", { status: "SKIPPED" }), visit("e", "2027-11-01T14:00:00Z")], NOW, TZ, 12);
check("season: twelve months from this one", load.length === 12 && load[0].key === "2026-10" && load[11].key === "2027-09");
check("season: October holds 2 (1 done), April 1 — skipped left out, past the window left out", load[0].count === 2 && load[0].done === 1 && load[6].key === "2027-04" && load[6].count === 1 && load.reduce((a, m) => a + m.count, 0) === 3);

// ── needs you
const plan = (id: string, extra: Partial<DeskPlan> = {}): DeskPlan => ({ id, clientId: `c-${id}`, clientName: `Client ${id}`, name: "Comfort Plan", status: "ACTIVE", phase: "active", sentAt: null, createdAt: at("2026-01-10T15:00:00Z"), endsAt: at("2027-01-10T15:00:00Z"), autoRenew: true, openInvoices: [], ...extra });
const reminder = (id: string, dueOn: string, extra: Partial<DeskReminder> = {}): DeskReminder => ({ id, dueOn, note: `Note ${id}`, clientId: null, clientName: null, planId: null, firedAt: null, done: false, doneAt: null, by: "Phil", createdAt: at("2026-10-01T15:00:00Z"), ...extra });
const visits: DeskVisit[] = [
  visit("v-over", "2026-10-15T14:00:00Z", { report: "saved" }),
  visit("v-today", "2026-10-18T19:00:00Z"),
  visit("v-soon", "2026-10-20T14:00:00Z", { techs: ["Marcus Bell"], techIds: ["w1"] }),
  visit("v-later", "2026-11-20T15:00:00Z"),
  visit("v-canceled-plan", "2026-10-18T19:00:00Z", { planStatus: "CANCELED" }),
];
const plans: DeskPlan[] = [
  plan("mark", { clientId: "c-mark", clientName: "Mark Ellis" }),
  plan("late", { openInvoices: [{ id: "inv-late", number: "INV-1042", amount: 21, dueDate: at("2026-10-10T15:00:00Z") }, { id: "inv-ok", number: "INV-1043", amount: 21, dueDate: at("2026-10-25T15:00:00Z") }] }),
  plan("lapsed", { phase: "lapsed", endsAt: at("2026-10-16T15:00:00Z") }),
  plan("ending-manual", { phase: "expiring", autoRenew: false, endsAt: at("2026-11-05T15:00:00Z") }),
  plan("ending-auto", { phase: "expiring", autoRenew: true, endsAt: at("2026-11-05T15:00:00Z") }),
  plan("expired-recent", { status: "EXPIRED", phase: "expired", endsAt: at("2026-10-01T15:00:00Z") }),
  plan("expired-old", { status: "EXPIRED", phase: "expired", endsAt: at("2026-07-01T15:00:00Z") }),
  plan("sent-old", { status: "SENT", phase: "sent", sentAt: at("2026-10-12T15:00:00Z"), endsAt: null }),
  plan("sent-new", { status: "SENT", phase: "sent", sentAt: at("2026-10-17T15:00:00Z"), endsAt: null }),
  plan("draft", { status: "DRAFT", phase: "draft", endsAt: null }),
];
const reminders: DeskReminder[] = [reminder("r-today", "2026-10-18", { clientId: "c-mark", clientName: "Mark Ellis", note: "Call about the filter" }), reminder("r-late", "2026-10-15"), reminder("r-ahead", "2026-10-25"), reminder("r-done", "2026-10-10", { done: true })];
const units: DeskUnit[] = [
  { clientId: "c-mark", line: "AC + gas furnace · Carrier · 3 ton · R-22 · 2007 (19 years)", advice: "R-22 system…", age: 19, r22: true, heatPump: false },
  { clientId: "c-mark", line: "Water heater · 2019 (7 years)", advice: null, age: 7, r22: false, heatPump: false },
  { clientId: "c-late", line: "Heat pump · 2016 (10 years)", advice: null, age: 10, r22: false, heatPump: true },
  { clientId: "c-nobody", line: "AC · R-22 · 1999", advice: null, age: 27, r22: true, heatPump: false },
];
const installs: DeskInstall[] = [
  { clientId: "c-jenna", clientName: "Jenna Brooks", proposalId: "p-jenna", title: "AC + furnace replacement — 1840 Meadow Glen Dr", total: 15828.35, acceptedAt: at("2026-09-18T15:00:00Z") },
  { clientId: "c-jenna", clientName: "Jenna Brooks", proposalId: "p-jenna-old", title: "Thermostat", total: 380, acceptedAt: at("2026-03-18T15:00:00Z") },
  { clientId: "c-mark", clientName: "Mark Ellis", proposalId: "p-mark", title: "Repair", total: 1396, acceptedAt: at("2026-10-01T15:00:00Z") },
  { clientId: "c-old", clientName: "Old Install", proposalId: "p-old", title: "Furnace", total: 6000, acceptedAt: at("2024-09-18T15:00:00Z") },
];
const needs = needsYou({ visits, plans, reminders, units, installs, prefs: DESK_PREFS_DEFAULT, now: NOW, tz: TZ });
const has = (key: string) => needs.find((x) => x.key === key);
check("overdue visit: today's list, and the saved-not-sent report is named", has("visit-overdue:v-over")?.tone === "now" && /saved but not sent/.test(has("visit-overdue:v-over")?.detail ?? ""));
check("today's visit: no tech on it is said", has("visit-today:v-today")?.tone === "now" && /no tech on it yet/.test(has("visit-today:v-today")?.detail ?? ""));
check("coming up: confirm with the client by first name and phone, the tech named", has("visit-soon:v-soon")?.tone === "soon" && /Confirm the time with Mark \(\(214\) 555-0182\) · Marcus Bell/.test(has("visit-soon:v-soon")?.detail ?? ""), has("visit-soon:v-soon")?.detail);
check("a visit a month out, or on a canceled plan, asks nothing", !has("visit-soon:v-later") && !has("visit-today:v-canceled-plan"));
check("reminders: today's and a late one ring, one ahead and one done do not", !!has("reminder:r-today") && /3 days ago/.test(has("reminder:r-late")?.detail ?? "") && !has("reminder:r-ahead") && !has("reminder:r-done"));
check("bills: one 8 days late, one not yet due", /INV-1042 is 8 days late — \$21/.test(has("bill-late:inv-late")?.title ?? "") && !has("bill-late:inv-ok"), has("bill-late:inv-late")?.title);
check("a plan past its end and not handled: renew now", has("lapsed:lapsed")?.tone === "now");
check("ending without auto-renew: call; ending with it: nothing to do", has("renew:ending-manual")?.tone === "soon" && !has("renew:ending-auto"));
check("ended 17 days ago: win them back; ended in July: let it be", /ended/.test(has("renew:expired-recent")?.title ?? "") && !has("renew:expired-old"));
check("sent 6 days ago (follow up after 3): follow up; sent yesterday: not yet", /sent 6 days ago/.test(has("unsigned:sent-old")?.title ?? "") && !has("unsigned:sent-new"), has("unsigned:sent-old")?.title);
check("a draft asks to be sent or started", has("draft:draft")?.tone === "soon");
check("R-22 at a member's home: a replacement idea, the worst unit named", has("replace:c-mark")?.tone === "idea" && /R-22/.test(has("replace:c-mark")?.title ?? ""));
check("a 10-year heat pump is not yet a candidate; R-22 at a non-member is not the desk's call", !has("replace:c-late") && !has("replace:c-nobody"));
check("installed last month, no plan: offer one (the newest install named)", has("offer-plan:c-jenna")?.ref.proposalId === "p-jenna" && needs.filter((x) => x.key === "offer-plan:c-jenna").length === 1);
check("a client already on a plan, or an install two years old: no offer", !has("offer-plan:c-mark") && !has("offer-plan:c-old"));
const tones = needs.map((x) => x.tone);
check("order: everything for today, then this week, then the ideas", tones.join(",") === [...tones].sort((a, b) => ["now", "soon", "idea"].indexOf(a) - ["now", "soon", "idea"].indexOf(b)).join(","));
check("candidates: R-22 always; a furnace at 15, a heat pump at 12", isReplacementCandidate({ age: 3, r22: true, heatPump: false }) && isReplacementCandidate({ age: 15, r22: false, heatPump: false }) && !isReplacementCandidate({ age: 14, r22: false, heatPump: false }) && isReplacementCandidate({ age: 12, r22: false, heatPump: true }));

// ── the digest
const quiet = digestText({ visits: [], needs: [], prefs: DESK_PREFS_DEFAULT, now: NOW, tz: TZ });
check("a quiet day sends nothing", quiet === null);
const digest = digestText({ visits, needs, prefs: DESK_PREFS_DEFAULT, now: NOW, tz: TZ, link: "jobflex.app/dashboard/hvac-estimator/service-desk" }) ?? "";
check("digest: today's visit with its time and client", /Today: 1 visit — 2:00 PM Mark Ellis\./.test(digest), digest);
const ahead = digestText({ visits: [visit("h1", "2026-10-21T14:00:00Z"), visit("h2", "2026-10-21T16:00:00Z", { planStatus: "CANCELED" })], needs: [], prefs: DESK_PREFS_DEFAULT, now: NOW, tz: TZ }) ?? "";
check("digest: the heads-up day (3 out) by weekday — a visit on a canceled plan left out", ahead === "HVAC service — Wed, Oct 21: 1 visit — confirm the times.", ahead);
check("digest: late bill, plans to sign and renew, reminders by name", /1 plan bill late\./.test(digest) && /1 plan waiting to be signed\./.test(digest) && /3 plans to renew\./.test(digest) && /Reminder: Call about the filter \(Mark Ellis\)\./.test(digest), digest);
check("digest: short enough for two texts, the link last", digest.length <= 300 + 1 + 50 && digest.endsWith("jobflex.app/dashboard/hvac-estimator/service-desk"), `${digest.length} chars`);
const soonDigest = digestText({ visits: [visit("t1", "2026-10-19T14:00:00Z")], needs: [], prefs: { ...DESK_PREFS_DEFAULT, headsUpDays: 1 }, now: NOW, tz: TZ }) ?? "";
check("digest: a one-day heads-up says Tomorrow", /^HVAC service — Tomorrow: 1 visit — confirm the times\.$/.test(soonDigest), soonDigest);

// ── reminders, filters, presets
check("reminder meta: a day and a note make a reminder; no note, no reminder", parseReminderMeta('{"dueOn":"2026-10-21","note":" Call Mark ","planId":"p1"}')?.note === "Call Mark" && parseReminderMeta('{"dueOn":"2026-10-21","note":""}') === null && parseReminderMeta('{"dueOn":"21/10","note":"x"}') === null && parseReminderMeta("{oops") === null);
check("client filters: active / signing / ending / past", clientFilterOf("active") === "active" && clientFilterOf("sent") === "signing" && clientFilterOf("draft") === "signing" && clientFilterOf("lapsed") === "ending" && clientFilterOf("canceled") === "past");
const pre = reminderPresets("2026-10-18");
check("presets in October: tomorrow, a week, a month, then before spring tune-ups (Mar 1)", pre.map((p) => p.day).join(",") === "2026-10-19,2026-10-25,2026-11-17,2027-03-01" && pre[3].label === "Before spring tune-ups");
check("presets in May: before fall tune-ups (Aug 15)", reminderPresets("2026-05-10")[3].day === "2026-08-15");

// ── the texting key
check("Service reminders: on the office's Texting roster, not sales' or the crew's", textEventsFor("office").some((e) => e.key === "service-reminder") && !textEventsFor("sales").some((e) => e.key === "service-reminder") && !textEventsFor("crew").some((e) => e.key === "service-reminder"));
check("the bell files the desk's and the plans' notices under it", ["PLAN_DIGEST", "PLAN_HEADS_UP", "PLAN_REMINDER", "PLAN_VISIT_DUE", "PLAN_EXPIRING"].every((kind) => prefKeyForEvent({ kind, summary: "", meta: null, proposalId: null, leadId: null }) === "service-reminder"));

console.log(bad ? `\n${bad} FAILED` : "\nall good");
process.exit(bad ? 1 : 0);
