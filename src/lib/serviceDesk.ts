// HVAC SERVICES — THE DESK'S PLAIN RULES (2026-10-18). Pure, client-safe.
//
// Owner: "make that services more understandable — where you set up the
// service, what client is it, where to see the services schedule, who's the
// clients, do they belong to any project or proposal — and we need to set the
// reminders for the contractor. Make a smarter service program that a
// contractor would easily understand; an internal dashboard for HVAC services."
//
// The plans themselves (lib/servicePlans, lib/servicePlanBook) already run on
// their own: visits land on the calendar, bills go out, the office hears before
// a plan ends. What was missing was ONE place that answers the contractor's
// questions in their order — what needs me today, when are the visits, who are
// my service clients, how is it set up, when do I get reminded — and the
// reminders the contractor sets. This file is the arithmetic of that place;
// the database side is lib/serviceDeskBook, the page /dashboard/hvac-estimator/service-desk.

import { money, type PlanPhase } from "@/lib/servicePlans";

const DAY = 86400000;

/** The desk's address: a sub-page of the HVAC estimator, beside its inventory (sidebar, nav-map). */
export const SERVICE_DESK_PATH = "/dashboard/hvac-estimator/service-desk";

// ── the contractor's reminder settings ──────────────────────────────────────

export interface DeskPrefs {
  /** Days before a plan visit the office gets its heads-up (bell, and the digest's "coming up" line). */
  headsUpDays: number;
  /** A plan sent to sign and not signed after this many days → "follow up". */
  unsignedDays: number;
  /** One digest of the day's service work, once a day: bell + a text to whoever has "Service reminders" on in Texting. */
  dailyDigest: boolean;
}

export const DESK_PREFS_DEFAULT: DeskPrefs = { headsUpDays: 3, unsignedDays: 3, dailyDigest: true };
export const HEADS_UP_CHOICES: readonly number[] = [1, 2, 3, 7, 14];
export const UNSIGNED_CHOICES: readonly number[] = [2, 3, 5, 7, 14];

/** Anything stored (or posted) → settings the rules can trust; unknown numbers snap to the defaults. */
export function normalizeDeskPrefs(raw: unknown): DeskPrefs {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pick = (v: unknown, allowed: readonly number[], d: number) => {
    const n = typeof v === "string" ? Number(v) : v;
    return typeof n === "number" && allowed.includes(n) ? n : d;
  };
  return {
    headsUpDays: pick(r.headsUpDays, HEADS_UP_CHOICES, DESK_PREFS_DEFAULT.headsUpDays),
    unsignedDays: pick(r.unsignedDays, UNSIGNED_CHOICES, DESK_PREFS_DEFAULT.unsignedDays),
    dailyDigest: typeof r.dailyDigest === "boolean" ? r.dailyDigest : r.dailyDigest === "on" || r.dailyDigest === "true" ? true : r.dailyDigest === "off" || r.dailyDigest === "false" ? false : DESK_PREFS_DEFAULT.dailyDigest,
  };
}

const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

/** "Heads-up 3 days before each visit · unsigned plans after 3 days · daily digest on" */
export function prefsLine(p: DeskPrefs): string {
  return `Heads-up ${days(p.headsUpDays)} before each visit · unsigned plans after ${days(p.unsignedDays)} · daily digest ${p.dailyDigest ? "on" : "off"}`;
}

// ── the calendar day, in the shop's own time zone ───────────────────────────

/** "2026-10-18": the wall-clock date of `d` in `tz`. */
export function localDay(d: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** Whole days from day `a` to day `b` ("2026-10-18" → "2026-10-21" = 3). */
export function dayDiff(a: string, b: string): number {
  const t = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  return Math.round((t(b) - t(a)) / DAY);
}

/** "2026-10-18" + 3 → "2026-10-21". */
export function addDay(s: string, n: number): string {
  const t = Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) + n * DAY;
  return new Date(t).toISOString().slice(0, 10);
}

export const isDayString = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

/** "9:00 AM" in the shop's zone. */
export function timeLabel(d: Date, tz: string): string {
  try {
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz });
  } catch {
    return d.toISOString().slice(11, 16);
  }
}

/** "today", "tomorrow", "yesterday", "Thu Oct 23", "Oct 23, 2027" — the day of `d` read from `now`. */
export function dayLabel(d: Date | string, now: Date, tz: string): string {
  const day = typeof d === "string" ? d : localDay(d, tz);
  const today = localDay(now, tz);
  const n = dayDiff(today, day);
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  const at = new Date(`${day}T12:00:00Z`);
  const sameYear = day.slice(0, 4) === today.slice(0, 4);
  if (n > 1 && n < 7) return at.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  return at.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }), timeZone: "UTC" });
}

// ── visits ──────────────────────────────────────────────────────────────────

export interface DeskVisit {
  id: string;
  planId: string;
  planName: string;
  planStatus: string;
  clientId: string;
  clientName: string;
  address: string | null;
  phone: string | null;
  label: string;
  /** The calendar time: the appointment's start, or the due day at 9:00. */
  startsAt: Date;
  status: string; // SCHEDULED | DONE | SKIPPED
  appointmentId: string | null;
  /** The crew's report: none, saved, or sent to the client. */
  report: "none" | "saved" | "sent";
  /** Names of the people staffed on the appointment. */
  techs: string[];
  techIds: string[];
}

export type VisitStage = "overdue" | "today" | "soon" | "later" | "done" | "skipped";

export const STAGE_LABEL: Record<VisitStage, string> = { overdue: "Overdue", today: "Today", soon: "Coming up", later: "Scheduled", done: "Done", skipped: "Skipped" };

/** Where a visit stands, from the shop's calendar day. "soon" = inside the heads-up window. */
export function visitStage(v: Pick<DeskVisit, "status" | "startsAt">, now: Date, tz: string, headsUpDays: number): VisitStage {
  if (v.status === "DONE") return "done";
  if (v.status === "SKIPPED") return "skipped";
  const n = dayDiff(localDay(now, tz), localDay(v.startsAt, tz));
  if (n < 0) return "overdue";
  if (n === 0) return "today";
  if (n <= headsUpDays) return "soon";
  return "later";
}

/** Visits in a month, for the next `months` months from this one — the season at a glance. */
export function monthLoad(visits: Array<Pick<DeskVisit, "startsAt" | "status">>, now: Date, tz: string, months = 12): Array<{ key: string; label: string; year: number; count: number; done: number }> {
  const first = localDay(now, tz).slice(0, 7);
  const out: Array<{ key: string; label: string; year: number; count: number; done: number }> = [];
  let y = +first.slice(0, 4);
  let m = +first.slice(5, 7);
  for (let i = 0; i < months; i++) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    out.push({ key, label: new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }), year: y, count: 0, done: 0 });
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  const at = new Map(out.map((o) => [o.key, o]));
  for (const v of visits) {
    if (v.status === "SKIPPED") continue;
    const slot = at.get(localDay(v.startsAt, tz).slice(0, 7));
    if (!slot) continue;
    slot.count++;
    if (v.status === "DONE") slot.done++;
  }
  return out;
}

/** "October 2026" groups, in time order. */
export function groupByMonth<T extends Pick<DeskVisit, "startsAt">>(visits: T[], tz: string): Array<{ key: string; label: string; visits: T[] }> {
  const groups = new Map<string, T[]>();
  for (const v of [...visits].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())) {
    const key = localDay(v.startsAt, tz).slice(0, 7);
    groups.set(key, [...(groups.get(key) ?? []), v]);
  }
  return [...groups.entries()].map(([key, list]) => ({
    key,
    label: new Date(Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, 15)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }),
    visits: list,
  }));
}

// ── the contractor's own reminders ──────────────────────────────────────────

export interface DeskReminder {
  id: string;
  /** The day it is for, in the shop's zone. */
  dueOn: string;
  note: string;
  clientId: string | null;
  clientName: string | null;
  planId: string | null;
  /** When the daily run rang it (bell + digest). */
  firedAt: string | null;
  done: boolean;
  doneAt: string | null;
  /** Who set it. */
  by: string | null;
  createdAt: Date;
}

/** The facts a reminder row keeps in ActivityEvent.meta; null when they are not there. */
export function parseReminderMeta(meta: string | null | undefined): { dueOn: string; note: string; planId: string | null; firedAt: string | null; doneAt: string | null } | null {
  if (!meta) return null;
  try {
    const m = JSON.parse(meta) as Record<string, unknown>;
    if (!isDayString(m.dueOn) || typeof m.note !== "string" || !m.note.trim()) return null;
    return {
      dueOn: m.dueOn,
      note: m.note.trim().slice(0, 400),
      planId: typeof m.planId === "string" && m.planId ? m.planId : null,
      firedAt: typeof m.firedAt === "string" ? m.firedAt : null,
      doneAt: typeof m.doneAt === "string" ? m.doneAt : null,
    };
  } catch {
    return null;
  }
}

/** Ready-made days for the reminder form from today ("2026-10-18"): tomorrow, a week, a month, before the next tune-up season. */
export function reminderPresets(today: string): Array<{ label: string; day: string }> {
  const y = +today.slice(0, 4);
  const spring = `${today < `${y}-03-01` ? y : y + 1}-03-01`;
  const fall = `${today < `${y}-08-15` ? y : y + 1}-08-15`;
  return [
    { label: "Tomorrow", day: addDay(today, 1) },
    { label: "In a week", day: addDay(today, 7) },
    { label: "In a month", day: addDay(today, 30) },
    spring < fall ? { label: "Before spring tune-ups", day: spring } : { label: "Before fall tune-ups", day: fall },
  ];
}

// ── what needs the contractor ───────────────────────────────────────────────

export interface DeskPlan {
  id: string;
  clientId: string;
  clientName: string;
  name: string;
  status: string;
  phase: PlanPhase;
  sentAt: Date | null;
  createdAt: Date;
  endsAt: Date | null;
  autoRenew: boolean;
  openInvoices: Array<{ id: string; number: string; amount: number; dueDate: Date | null }>;
}

/** A unit on file at a member's home, with its age read already done (lib/equipment). */
export interface DeskUnit {
  clientId: string;
  line: string;
  advice: string | null;
  age: number | null;
  r22: boolean;
  heatPump: boolean;
}

/** An HVAC proposal the client accepted — the system the shop put in. */
export interface DeskInstall {
  clientId: string;
  clientName: string;
  proposalId: string;
  title: string;
  total: number;
  acceptedAt: Date;
}

export type NeedKind = "visit-overdue" | "visit-today" | "visit-soon" | "reminder" | "bill-late" | "lapsed" | "unsigned" | "draft" | "renew" | "replace" | "offer-plan";
/** now = do it today · soon = this week · idea = money on the table. */
export type NeedTone = "now" | "soon" | "idea";

export interface NeedItem {
  key: string;
  kind: NeedKind;
  tone: NeedTone;
  title: string;
  who: string | null;
  clientId: string | null;
  detail: string;
  when: Date | null;
  ref: { visitId?: string; appointmentId?: string; planId?: string; invoiceId?: string; reminderId?: string; proposalId?: string };
}

export const TONE_LABEL: Record<NeedTone, string> = { now: "Today", soon: "This week", idea: "Worth a call" };

const first = (name: string) => name.trim().split(/\s+/)[0] || name;

/** A replacement candidate: R-22, or past the age where a big repair should be weighed against a new system. */
export function isReplacementCandidate(u: Pick<DeskUnit, "age" | "r22" | "heatPump">): boolean {
  if (u.r22) return true;
  return u.age !== null && u.age >= (u.heatPump ? 12 : 15);
}

/**
 * Everything the service side asks of the contractor, in the order to do it.
 * Each item names its client and the one action that clears it.
 */
export function needsYou(input: {
  visits: DeskVisit[];
  plans: DeskPlan[];
  reminders: DeskReminder[];
  units: DeskUnit[];
  installs: DeskInstall[];
  prefs: DeskPrefs;
  now: Date;
  tz: string;
}): NeedItem[] {
  const { visits, plans, reminders, units, installs, prefs, now, tz } = input;
  const today = localDay(now, tz);
  const items: NeedItem[] = [];

  for (const v of visits) {
    if (v.planStatus !== "ACTIVE" && v.status === "SCHEDULED") continue;
    const stage = visitStage(v, now, tz, prefs.headsUpDays);
    const at = `${dayLabel(v.startsAt, now, tz)} ${timeLabel(v.startsAt, tz)}`;
    const crew = v.techs.length ? v.techs.join(", ") : "no tech on it yet";
    const where = v.address ? ` · ${v.address}` : "";
    if (stage === "overdue") {
      items.push({
        key: `visit-overdue:${v.id}`,
        kind: "visit-overdue",
        tone: "now",
        title: `${v.label} was ${dayLabel(v.startsAt, now, tz)}`,
        who: v.clientName,
        clientId: v.clientId,
        detail: v.report === "saved" ? "The report is saved but not sent — send it, or mark the visit done" : "Write the visit report, or mark it done if it happened",
        when: v.startsAt,
        ref: { visitId: v.id, appointmentId: v.appointmentId ?? undefined, planId: v.planId },
      });
    } else if (stage === "today") {
      items.push({ key: `visit-today:${v.id}`, kind: "visit-today", tone: "now", title: `${v.label} — today ${timeLabel(v.startsAt, tz)}`, who: v.clientName, clientId: v.clientId, detail: `${v.planName}${where} · ${crew}`, when: v.startsAt, ref: { visitId: v.id, appointmentId: v.appointmentId ?? undefined, planId: v.planId } });
    } else if (stage === "soon") {
      items.push({ key: `visit-soon:${v.id}`, kind: "visit-soon", tone: "soon", title: `${v.label} — ${at}`, who: v.clientName, clientId: v.clientId, detail: `Confirm the time with ${first(v.clientName)}${v.phone ? ` (${v.phone})` : ""} · ${crew}`, when: v.startsAt, ref: { visitId: v.id, appointmentId: v.appointmentId ?? undefined, planId: v.planId } });
    }
  }

  for (const r of reminders) {
    if (r.done) continue;
    const n = dayDiff(today, r.dueOn);
    if (n > 0) continue;
    items.push({ key: `reminder:${r.id}`, kind: "reminder", tone: "now", title: r.note, who: r.clientName, clientId: r.clientId, detail: n === 0 ? "Your reminder for today" : `Your reminder — ${days(-n)} ago`, when: new Date(`${r.dueOn}T12:00:00Z`), ref: { reminderId: r.id, planId: r.planId ?? undefined } });
  }

  for (const p of plans) {
    for (const inv of p.openInvoices) {
      if (!inv.dueDate) continue;
      const late = dayDiff(localDay(inv.dueDate, tz), today);
      if (late <= 0) continue;
      items.push({ key: `bill-late:${inv.id}`, kind: "bill-late", tone: "now", title: `Invoice ${inv.number} is ${days(late)} late — ${money(Math.round(inv.amount * 100))}`, who: p.clientName, clientId: p.clientId, detail: `${p.name} · collect it, then mark it paid`, when: inv.dueDate, ref: { invoiceId: inv.id, planId: p.id } });
    }
    if (p.phase === "lapsed") {
      items.push({ key: `lapsed:${p.id}`, kind: "lapsed", tone: "now", title: `${p.name} has run out`, who: p.clientName, clientId: p.clientId, detail: "Its term is over — renew it now", when: p.endsAt, ref: { planId: p.id } });
    } else if (p.phase === "expiring" && !p.autoRenew && p.endsAt) {
      items.push({ key: `renew:${p.id}`, kind: "renew", tone: "soon", title: `${p.name} ends ${dayLabel(p.endsAt, now, tz)}`, who: p.clientName, clientId: p.clientId, detail: `It does not renew on its own — call ${first(p.clientName)} to keep the visits and the discount`, when: p.endsAt, ref: { planId: p.id } });
    } else if (p.status === "EXPIRED" && p.endsAt && now.getTime() - p.endsAt.getTime() <= 45 * DAY) {
      items.push({ key: `renew:${p.id}`, kind: "renew", tone: "soon", title: `${p.name} ended ${dayLabel(p.endsAt, now, tz)}`, who: p.clientName, clientId: p.clientId, detail: `Win ${first(p.clientName)} back — renew brings the plan and its visits back`, when: p.endsAt, ref: { planId: p.id } });
    } else if (p.status === "SENT") {
      const since = p.sentAt ? dayDiff(localDay(p.sentAt, tz), today) : 0;
      if (since >= prefs.unsignedDays) items.push({ key: `unsigned:${p.id}`, kind: "unsigned", tone: "soon", title: `${p.name} not signed — sent ${days(since)} ago`, who: p.clientName, clientId: p.clientId, detail: `Call ${first(p.clientName)}, send it again, or start it if they signed with you`, when: p.sentAt, ref: { planId: p.id } });
    } else if (p.status === "DRAFT") {
      items.push({ key: `draft:${p.id}`, kind: "draft", tone: "soon", title: `${p.name} is still a draft`, who: p.clientName, clientId: p.clientId, detail: "Send it to sign, or start it today if they signed with you", when: p.createdAt, ref: { planId: p.id } });
    }
  }

  // Money on the table: an old system at a member's home, a system the shop put in with no plan on it.
  const members = new Set(plans.filter((p) => p.status === "ACTIVE").map((p) => p.clientId));
  const worst = new Map<string, DeskUnit>();
  for (const u of units) {
    if (!members.has(u.clientId) || !isReplacementCandidate(u)) continue;
    const had = worst.get(u.clientId);
    if (!had || (u.r22 && !had.r22) || (u.age ?? 0) > (had.age ?? 0)) worst.set(u.clientId, u);
  }
  const nameOf = new Map(plans.map((p) => [p.clientId, p.clientName]));
  for (const [clientId, u] of worst) {
    items.push({ key: `replace:${clientId}`, kind: "replace", tone: "idea", title: `Replacement candidate: ${u.line}`, who: nameOf.get(clientId) ?? null, clientId, detail: u.advice ?? "Quote the replacement at the next visit", when: null, ref: {} });
  }
  const onPlan = new Set(plans.filter((p) => p.status !== "CANCELED").map((p) => p.clientId));
  const seen = new Set<string>();
  for (const i of [...installs].sort((a, b) => b.acceptedAt.getTime() - a.acceptedAt.getTime())) {
    if (onPlan.has(i.clientId) || seen.has(i.clientId)) continue;
    if (now.getTime() - i.acceptedAt.getTime() > 548 * DAY) continue;
    seen.add(i.clientId);
    items.push({ key: `offer-plan:${i.clientId}`, kind: "offer-plan", tone: "idea", title: `You installed it — no plan on it yet`, who: i.clientName, clientId: i.clientId, detail: `${i.title} · ${money(Math.round(i.total * 100))} · accepted ${dayLabel(i.acceptedAt, now, tz)} — offer a plan to keep it tuned`, when: i.acceptedAt, ref: { proposalId: i.proposalId } });
  }

  const order: Record<NeedTone, number> = { now: 0, soon: 1, idea: 2 };
  return items.sort((a, b) => order[a.tone] - order[b.tone] || (a.when?.getTime() ?? Infinity) - (b.when?.getTime() ?? Infinity));
}

// ── the daily digest ────────────────────────────────────────────────────────

/**
 * The one text a day (and its bell line): today's visits, the visits on the
 * heads-up day, the reminders due, and what is late. Null when there is
 * nothing to say — no text goes out on an empty day.
 */
export function digestText(input: { visits: DeskVisit[]; needs: NeedItem[]; prefs: DeskPrefs; now: Date; tz: string; link?: string }): string | null {
  const { visits, needs, prefs, now, tz, link } = input;
  const today = localDay(now, tz);
  const live = visits.filter((v) => v.status === "SCHEDULED" && v.planStatus === "ACTIVE");
  const todays = live.filter((v) => localDay(v.startsAt, tz) === today).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const aheadDay = addDay(today, prefs.headsUpDays);
  const ahead = live.filter((v) => localDay(v.startsAt, tz) === aheadDay);
  const count = (k: NeedKind) => needs.filter((n) => n.kind === k).length;
  const reminders = needs.filter((n) => n.kind === "reminder");
  const parts: string[] = [];
  if (todays.length) {
    const shown = todays.slice(0, 3).map((v) => `${timeLabel(v.startsAt, tz)} ${v.clientName}`);
    parts.push(`Today: ${todays.length} visit${todays.length === 1 ? "" : "s"} — ${shown.join("; ")}${todays.length > 3 ? `; +${todays.length - 3} more` : ""}.`);
  }
  if (ahead.length) parts.push(`${prefs.headsUpDays === 1 ? "Tomorrow" : dayLabel(aheadDay, now, tz).replace(/^./, (c) => c.toUpperCase())}: ${ahead.length} visit${ahead.length === 1 ? "" : "s"} — confirm the times.`);
  const overdue = count("visit-overdue");
  if (overdue) parts.push(`${overdue} past visit${overdue === 1 ? "" : "s"} without a report.`);
  const late = count("bill-late");
  if (late) parts.push(`${late} plan bill${late === 1 ? "" : "s"} late.`);
  const toSign = count("unsigned");
  if (toSign) parts.push(`${toSign} plan${toSign === 1 ? "" : "s"} waiting to be signed.`);
  const renew = count("renew") + count("lapsed");
  if (renew) parts.push(`${renew} plan${renew === 1 ? "" : "s"} to renew.`);
  for (const r of reminders.slice(0, 2)) parts.push(`Reminder: ${r.title}${r.who ? ` (${r.who})` : ""}.`);
  if (reminders.length > 2) parts.push(`+${reminders.length - 2} more reminders.`);
  if (!parts.length) return null;
  let body = `HVAC service — ${parts.join(" ")}`;
  if (body.length > 300) body = `${body.slice(0, 297).replace(/\s+\S*$/, "")}…`;
  return link ? `${body} ${link}` : body;
}

// ── a client on the service side ────────────────────────────────────────────

/** The plates the Clients tab filters by. */
export type ClientFilter = "all" | "active" | "signing" | "ending" | "past";

export function clientFilterOf(phase: PlanPhase): Exclude<ClientFilter, "all"> {
  if (phase === "active") return "active";
  if (phase === "draft" || phase === "sent") return "signing";
  if (phase === "expiring" || phase === "lapsed") return "ending";
  return "past";
}
