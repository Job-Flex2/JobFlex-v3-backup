// HVAC SERVICES — THE DESK'S BOOK (2026-10-18), server only. The rules are
// lib/serviceDesk; the plans' own life (activate, bill, renew, cancel) stays
// in lib/servicePlanBook. This file reads one picture of the service side for
// /dashboard/hvac-estimator/service-desk and keeps the three things the desk
// adds, all on ActivityEvent rows (no new tables — lib/activityLog TRAIL_KINDS):
//   · SERVICE_REMINDER → SERVICE_REMINDER_DONE: a reminder the contractor set
//     (meta: dueOn, note, planId, firedAt, doneAt), rung on its day;
//   · SERVICE_LINK: a plan tied to the proposal or project it belongs to
//     (proposalId column + meta planId/projectId; the latest row wins);
//   · SERVICE_PREFS: the desk's reminder settings (meta = DeskPrefs; latest wins).
// And the daily run (api/cron/service-plans): the digest, the heads-up, the
// contractor's reminders — bell rows PLAN_DIGEST / PLAN_HEADS_UP /
// PLAN_REMINDER, one text a day through Settings → Texting ("Service reminders").

import { db } from "@/lib/db";
import { appBaseUrl } from "@/lib/appUrl";
import { textOffice } from "@/lib/sms/send";
import { equipmentAdvice, equipmentAge, equipmentLine } from "@/lib/equipment";
import { money, planPhase, planTermsLine, type PlanPhase } from "@/lib/servicePlans";
import { kindLine, proposalKindOf, tradeFamily } from "@/lib/proposalKind";
import { allowsSms, parseNotificationPrefs } from "@/lib/notificationPrefsShared";
import { TRAIL_KINDS } from "@/lib/activityLog";
import {
  DESK_PREFS_DEFAULT,
  SERVICE_DESK_PATH,
  clientFilterOf,
  dayLabel,
  digestText,
  localDay,
  monthLoad,
  needsYou,
  normalizeDeskPrefs,
  parseReminderMeta,
  timeLabel,
  visitStage,
  type ClientFilter,
  type DeskInstall,
  type DeskPlan,
  type DeskPrefs,
  type DeskReminder,
  type DeskUnit,
  type DeskVisit,
  type NeedItem,
  type VisitStage,
} from "@/lib/serviceDesk";

const DAY = 86400000;
const OFFICE_ROLES = ["OWNER", "ADMIN", "MANAGER"];

// ── settings ────────────────────────────────────────────────────────────────

export async function loadDeskPrefs(organizationId: string): Promise<DeskPrefs> {
  try {
    const row = await db.activityEvent.findFirst({ where: { organizationId, kind: TRAIL_KINDS.SERVICE_PREFS }, orderBy: { createdAt: "desc" }, select: { meta: true } });
    return row?.meta ? normalizeDeskPrefs(JSON.parse(row.meta)) : { ...DESK_PREFS_DEFAULT };
  } catch {
    return { ...DESK_PREFS_DEFAULT };
  }
}

// ── links: the proposal or project a plan belongs to ────────────────────────

export type PlanLink = { proposalId: string | null; projectId: string | null };

/** planId → the latest link written for it (an empty link = untied on purpose). */
export async function loadPlanLinks(organizationId: string): Promise<Map<string, PlanLink>> {
  const out = new Map<string, PlanLink>();
  const rows = await db.activityEvent.findMany({ where: { organizationId, kind: TRAIL_KINDS.SERVICE_LINK }, orderBy: { createdAt: "asc" }, select: { proposalId: true, meta: true }, take: 2000 });
  for (const r of rows) {
    try {
      const m = JSON.parse(r.meta ?? "{}") as { planId?: unknown; projectId?: unknown };
      if (typeof m.planId !== "string") continue;
      out.set(m.planId, { proposalId: r.proposalId ?? null, projectId: typeof m.projectId === "string" && m.projectId ? m.projectId : null });
    } catch {
      /* a broken row is skipped */
    }
  }
  return out;
}

/** The system the shop put in for this client: their latest accepted HVAC proposal, else their newest open project. */
export async function smartLinkFor(organizationId: string, clientId: string): Promise<PlanLink> {
  const [proposals, project] = await Promise.all([
    db.proposal.findMany({ where: { organizationId, clientId, acceptedAt: { not: null } }, orderBy: { acceptedAt: "desc" }, take: 20, select: { id: true, title: true, trade: true, projectId: true } }),
    db.project.findFirst({ where: { organizationId, clientId, status: { in: ["ACTIVE", "ON_HOLD", "COMPLETED"] } }, orderBy: { createdAt: "desc" }, select: { id: true } }),
  ]);
  const hvac = proposals.find((p) => tradeFamily(p.trade) === "hvac" || proposalKindOf({ trade: p.trade, title: p.title }).family === "hvac");
  if (hvac) return { proposalId: hvac.id, projectId: hvac.projectId ?? null };
  return { proposalId: null, projectId: project?.id ?? null };
}

// ── what the page reads ─────────────────────────────────────────────────────

/** Dates travel to the client page as ISO strings. */
export type Wire<T> = { [K in keyof T]: T[K] extends Date ? string : T[K] extends Date | null ? string | null : T[K] };

export interface DeskVisitView extends Omit<Wire<DeskVisit>, "startsAt"> {
  startsAt: string;
  stage: VisitStage;
  day: string;
  dayText: string;
  time: string;
}

export interface DeskPlanRow {
  id: string;
  clientId: string;
  clientName: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  name: string;
  status: string;
  phase: PlanPhase;
  filter: Exclude<ClientFilter, "all">;
  terms: string;
  priceCents: number;
  billing: string;
  discountPct: number;
  startsAt: string | null;
  endsAt: string | null;
  autoRenew: boolean;
  acceptHref: string;
  sentAt: string | null;
  nextVisit: { label: string; dayText: string; time: string } | null;
  visitsDone: number;
  visitsTotal: number;
  openInvoices: Array<{ id: string; number: string; amount: number; dueDate: string | null; late: boolean }>;
  units: Array<{ line: string; advice: string | null; candidate: boolean }>;
  proposals: Array<{ id: string; title: string; status: string; total: number; kind: string; hvac: boolean; accepted: boolean }>;
  projects: Array<{ id: string; name: string; status: string }>;
  link: { proposalId: string | null; projectId: string | null; label: string; href: string } | null;
  reminders: number;
}

export interface DeskReminderView extends Omit<Wire<DeskReminder>, "createdAt"> {
  createdAt: string;
  dayText: string;
  state: "due" | "late" | "ahead" | "done";
}

export interface ServiceDeskData {
  now: string;
  tz: string;
  today: string;
  appUrl: string;
  prefs: DeskPrefs;
  stats: { members: number; signing: number; ending: number; visits30: number; visitsToday: number; overdue: number; mrrCents: number; openCents: number; openCount: number; lateCount: number };
  needs: Array<Omit<NeedItem, "when"> & { when: string | null }>;
  visits: DeskVisitView[];
  load: ReturnType<typeof monthLoad>;
  plans: DeskPlanRow[];
  templates: Array<{ id: string; name: string; description: string | null; visitsPerYear: number; termMonths: number; priceCents: number; billing: string; discountPct: number; benefits: string[]; priorityScheduling: boolean; waivedDiagnostic: boolean; terms: string; members: number }>;
  clients: Array<{ id: string; name: string; address: string | null; onPlan: boolean }>;
  workers: Array<{ id: string; name: string }>;
  reminders: DeskReminderView[];
  texting: { names: string[]; extras: number };
  /** What today's digest says (bell and text), or null on a quiet day — shown on the Reminders tab. */
  digestPreview: string | null;
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const addressOf = (c: { address: string | null; city: string | null; state: string | null; zip: string | null }) =>
  [c.address, c.city, [c.state, c.zip].filter(Boolean).join(" ")].filter((s) => s && s.trim()).join(", ") || null;

/** The reminders the contractor set, open ones first; done ones from the last 30 days. */
export async function loadReminders(organizationId: string, now = new Date()): Promise<DeskReminder[]> {
  const rows = await db.activityEvent.findMany({
    where: { organizationId, OR: [{ kind: TRAIL_KINDS.SERVICE_REMINDER }, { kind: TRAIL_KINDS.SERVICE_REMINDER_DONE, createdAt: { gte: new Date(now.getTime() - 400 * DAY) } }] },
    orderBy: { createdAt: "desc" },
    take: 400,
    select: { id: true, kind: true, clientId: true, meta: true, createdAt: true, actor: { select: { name: true, email: true } }, client: { select: { name: true } } },
  });
  const out: DeskReminder[] = [];
  for (const r of rows) {
    const m = parseReminderMeta(r.meta);
    if (!m) continue;
    const done = r.kind === TRAIL_KINDS.SERVICE_REMINDER_DONE;
    if (done && (!m.doneAt || now.getTime() - Date.parse(m.doneAt) > 30 * DAY)) continue;
    out.push({ id: r.id, dueOn: m.dueOn, note: m.note, clientId: r.clientId, clientName: r.client?.name ?? null, planId: m.planId, firedAt: m.firedAt, done, doneAt: m.doneAt, by: r.actor?.name?.trim() || r.actor?.email || null, createdAt: r.createdAt });
  }
  return out;
}

/** Plans with everything the desk shows about them; shared by the page and the daily run. */
async function readPlans(organizationId: string) {
  return db.servicePlan.findMany({
    where: { organizationId },
    orderBy: [{ createdAt: "desc" }],
    take: 600,
    include: {
      client: { select: { id: true, name: true, email: true, phone: true, address: true, city: true, state: true, zip: true } },
      visits: {
        orderBy: { seq: "asc" },
        include: {
          appointment: { select: { startsAt: true, status: true, assignments: { select: { worker: { select: { id: true, displayName: true } } } } } },
          report: { select: { sentAt: true } },
        },
      },
      invoices: { where: { status: "PENDING" }, orderBy: { dueDate: "asc" }, select: { id: true, number: true, amount: true, dueDate: true } },
    },
  });
}
type PlanRead = Awaited<ReturnType<typeof readPlans>>[number];

function visitsOf(plans: PlanRead[]): DeskVisit[] {
  return plans.flatMap((p) =>
    p.visits.map((v) => ({
      id: v.id,
      planId: p.id,
      planName: p.name,
      planStatus: p.status,
      clientId: p.client.id,
      clientName: p.client.name,
      address: addressOf(p.client),
      phone: p.client.phone,
      label: v.label,
      startsAt: v.appointment?.startsAt ?? new Date(v.dueAt.getTime() + 9 * 3600000),
      status: v.status,
      appointmentId: v.appointmentId,
      report: v.report ? (v.report.sentAt ? ("sent" as const) : ("saved" as const)) : ("none" as const),
      techs: v.appointment?.assignments.map((a) => a.worker.displayName) ?? [],
      techIds: v.appointment?.assignments.map((a) => a.worker.id) ?? [],
    })),
  );
}

function deskPlansOf(plans: PlanRead[], now: Date): DeskPlan[] {
  return plans.map((p) => ({ id: p.id, clientId: p.client.id, clientName: p.client.name, name: p.name, status: p.status, phase: planPhase(p, now), sentAt: p.sentAt, createdAt: p.createdAt, endsAt: p.endsAt, autoRenew: p.autoRenew, openInvoices: p.invoices }));
}

async function readUnits(organizationId: string, clientIds: string[], now: Date): Promise<Array<DeskUnit & { advice: string | null }>> {
  if (!clientIds.length) return [];
  const rows = await db.clientEquipment.findMany({ where: { organizationId, clientId: { in: clientIds } }, orderBy: { createdAt: "asc" }, take: 3000 });
  return rows.map((e) => ({ clientId: e.clientId, line: equipmentLine(e, now), advice: equipmentAdvice(e, now), age: equipmentAge(e, now), r22: /R-?22/i.test(e.refrigerant ?? ""), heatPump: e.kind === "split-heat-pump" || e.kind === "ductless" }));
}

/** Accepted HVAC proposals of the last 18 months — the systems the shop put in. */
async function readInstalls(organizationId: string, now: Date): Promise<DeskInstall[]> {
  const rows = await db.proposal.findMany({
    where: { organizationId, clientId: { not: null }, acceptedAt: { gte: new Date(now.getTime() - 548 * DAY) } },
    orderBy: { acceptedAt: "desc" },
    take: 600,
    select: { id: true, title: true, trade: true, total: true, acceptedAt: true, clientId: true, client: { select: { name: true, deletedAt: true } } },
  });
  return rows
    .filter((p) => p.client && !p.client.deletedAt && p.acceptedAt && (tradeFamily(p.trade) === "hvac" || proposalKindOf({ trade: p.trade, title: p.title }).family === "hvac"))
    .map((p) => ({ clientId: p.clientId!, clientName: p.client!.name, proposalId: p.id, title: p.title, total: p.total, acceptedAt: p.acceptedAt! }));
}

/** Who gets the service texts today: office members with a verified mobile and "Service reminders" on, plus the company's extra numbers. */
async function textingRecipients(organizationId: string): Promise<{ names: string[]; extras: number }> {
  try {
    const [members, extras] = await Promise.all([
      db.membership.findMany({ where: { organizationId, role: { in: OFFICE_ROLES } }, select: { role: true, user: { select: { name: true, email: true, smsPhone: true, smsVerifiedAt: true, notificationPrefsJson: true } } } }),
      db.notificationPhone.count({ where: { organizationId, active: true } }),
    ]);
    const names = members
      .filter((m) => m.user?.smsPhone && m.user.smsVerifiedAt)
      .filter((m) => {
        const prefs = parseNotificationPrefs(m.user!.notificationPrefsJson, m.role);
        return !prefs.smsPaused && allowsSms(prefs, "service-reminder");
      })
      .map((m) => m.user!.name?.trim() || m.user!.email || "Member");
    return { names, extras };
  } catch {
    return { names: [], extras: 0 };
  }
}

export async function loadServiceDesk(organizationId: string, now = new Date()): Promise<ServiceDeskData> {
  const [org, prefs, plans, templates, clients, workers, links, reminders, installs, texting, appUrl] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } }),
    loadDeskPrefs(organizationId),
    readPlans(organizationId),
    db.servicePlanTemplate.findMany({ where: { organizationId, active: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], include: { _count: { select: { plans: { where: { status: "ACTIVE" } } } } } }),
    db.client.findMany({ where: { organizationId, deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true, address: true, city: true, state: true, zip: true }, take: 600 }),
    db.workerProfile.findMany({ where: { organizationId, inviteStatus: { not: "DECLINED" } }, orderBy: { displayName: "asc" }, select: { id: true, displayName: true }, take: 200 }),
    loadPlanLinks(organizationId),
    loadReminders(organizationId, now),
    readInstalls(organizationId, now),
    textingRecipients(organizationId),
    appBaseUrl(),
  ]);
  const tz = org?.timezone || "America/New_York";
  const today = localDay(now, tz);
  const planClientIds = [...new Set(plans.map((p) => p.client.id))];
  const [units, proposals, projects] = await Promise.all([
    readUnits(organizationId, planClientIds, now),
    planClientIds.length
      ? db.proposal.findMany({ where: { organizationId, clientId: { in: planClientIds } }, orderBy: { createdAt: "desc" }, take: 2000, select: { id: true, title: true, status: true, total: true, trade: true, acceptedAt: true, clientId: true } })
      : Promise.resolve([]),
    planClientIds.length ? db.project.findMany({ where: { organizationId, clientId: { in: planClientIds } }, orderBy: { createdAt: "desc" }, take: 1000, select: { id: true, name: true, status: true, clientId: true } }) : Promise.resolve([]),
  ]);

  const visits = visitsOf(plans);
  const deskPlans = deskPlansOf(plans, now);
  const needs = needsYou({ visits, plans: deskPlans, reminders, units, installs, prefs, now, tz });

  const byClient = <T extends { clientId: string | null }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) if (r.clientId) m.set(r.clientId, [...(m.get(r.clientId) ?? []), r]);
    return m;
  };
  const unitsBy = byClient(units);
  const proposalsBy = byClient(proposals);
  const projectsBy = byClient(projects);
  const openReminders = reminders.filter((r) => !r.done);
  const proposalTitle = new Map(proposals.map((p) => [p.id, p.title]));
  const projectName = new Map(projects.map((p) => [p.id, p.name]));

  const rows: DeskPlanRow[] = plans.map((p) => {
    const phase = planPhase(p, now);
    const next = p.visits.find((v) => v.status === "SCHEDULED" && (v.appointment?.startsAt ?? v.dueAt).getTime() >= now.getTime() - 2 * DAY);
    const nextAt = next ? next.appointment?.startsAt ?? new Date(next.dueAt.getTime() + 9 * 3600000) : null;
    const link = links.get(p.id);
    const linkLabel = link?.proposalId ? proposalTitle.get(link.proposalId) : link?.projectId ? projectName.get(link.projectId) : undefined;
    return {
      id: p.id,
      clientId: p.client.id,
      clientName: p.client.name,
      email: p.client.email,
      phone: p.client.phone,
      address: addressOf(p.client),
      name: p.name,
      status: p.status,
      phase,
      filter: clientFilterOf(phase),
      terms: planTermsLine(p),
      priceCents: p.priceCents,
      billing: p.billing,
      discountPct: p.discountPct,
      startsAt: iso(p.startsAt),
      endsAt: iso(p.endsAt),
      autoRenew: p.autoRenew,
      acceptHref: `${appUrl}/plan/${p.acceptToken}`,
      sentAt: iso(p.sentAt),
      nextVisit: next && nextAt ? { label: next.label, dayText: dayLabel(nextAt, now, tz), time: timeLabel(nextAt, tz) } : null,
      visitsDone: p.visits.filter((v) => v.status === "DONE").length,
      visitsTotal: p.visits.filter((v) => v.status !== "SKIPPED").length,
      openInvoices: p.invoices.map((i) => ({ id: i.id, number: i.number, amount: i.amount, dueDate: iso(i.dueDate), late: !!i.dueDate && localDay(i.dueDate, tz) < today })),
      units: (unitsBy.get(p.client.id) ?? []).map((u) => ({ line: u.line, advice: u.advice, candidate: u.r22 || (u.age !== null && u.age >= (u.heatPump ? 12 : 15)) })),
      proposals: (proposalsBy.get(p.client.id) ?? []).slice(0, 12).map((x) => {
        const k = proposalKindOf({ trade: x.trade, title: x.title });
        return { id: x.id, title: x.title, status: x.status, total: x.total, kind: kindLine(k), hvac: k.family === "hvac", accepted: !!x.acceptedAt };
      }),
      projects: (projectsBy.get(p.client.id) ?? []).slice(0, 8).map((x) => ({ id: x.id, name: x.name, status: x.status })),
      link: link && (link.proposalId || link.projectId) && linkLabel ? { ...link, label: linkLabel, href: link.proposalId ? `/dashboard/proposals/${link.proposalId}` : `/dashboard/projects/${link.projectId}` } : null,
      reminders: openReminders.filter((r) => r.clientId === p.client.id).length,
    };
  });

  const onPlan = new Set(plans.filter((p) => p.status !== "CANCELED" && p.status !== "EXPIRED").map((p) => p.client.id));
  const live = visits.filter((v) => v.planStatus === "ACTIVE" && v.status === "SCHEDULED");
  const stageOf = (v: DeskVisit) => visitStage(v, now, tz, prefs.headsUpDays);
  const open = rows.flatMap((r) => r.openInvoices);
  const active = rows.filter((r) => r.status === "ACTIVE");

  return {
    now: now.toISOString(),
    tz,
    today,
    appUrl,
    prefs,
    stats: {
      members: active.length,
      signing: rows.filter((r) => r.filter === "signing").length,
      ending: rows.filter((r) => r.filter === "ending").length,
      visits30: live.filter((v) => v.startsAt.getTime() <= now.getTime() + 30 * DAY && stageOf(v) !== "overdue").length,
      visitsToday: live.filter((v) => stageOf(v) === "today").length,
      overdue: live.filter((v) => stageOf(v) === "overdue").length,
      mrrCents: active.reduce((a, r) => a + (r.billing === "YEARLY" ? Math.round(r.priceCents / 12) : r.priceCents), 0),
      openCents: Math.round(open.reduce((a, i) => a + i.amount, 0) * 100),
      openCount: open.length,
      lateCount: open.filter((i) => i.late).length,
    },
    needs: needs.map((n) => ({ ...n, when: iso(n.when) })),
    visits: visits
      .filter((v) => v.status !== "SKIPPED")
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
      .map((v) => ({ ...v, startsAt: v.startsAt.toISOString(), stage: stageOf(v), day: localDay(v.startsAt, tz), dayText: dayLabel(v.startsAt, now, tz), time: timeLabel(v.startsAt, tz) })),
    load: monthLoad(visits, now, tz, 12),
    plans: rows,
    templates: templates.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      visitsPerYear: t.visitsPerYear,
      termMonths: t.termMonths,
      priceCents: t.priceCents,
      billing: t.billing,
      discountPct: t.discountPct,
      benefits: (() => {
        try {
          const v = JSON.parse(t.benefitsJson) as unknown;
          return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
        } catch {
          return [];
        }
      })(),
      priorityScheduling: t.priorityScheduling,
      waivedDiagnostic: t.waivedDiagnostic,
      terms: planTermsLine(t),
      members: t._count.plans,
    })),
    clients: clients.map((c) => ({ id: c.id, name: c.name, address: addressOf(c), onPlan: onPlan.has(c.id) })),
    workers: workers.map((w) => ({ id: w.id, name: w.displayName })),
    reminders: reminders
      .map((r) => {
        const state: DeskReminderView["state"] = r.done ? "done" : r.dueOn < today ? "late" : r.dueOn === today ? "due" : "ahead";
        return { ...r, createdAt: r.createdAt.toISOString(), dayText: dayLabel(r.dueOn, now, tz), state };
      })
      .sort((a, b) => Number(a.done) - Number(b.done) || (a.done ? (b.doneAt ?? "").localeCompare(a.doneAt ?? "") : a.dueOn.localeCompare(b.dueOn))),
    texting,
    digestPreview: digestText({ visits, needs, prefs, now, tz }),
  };
}

/** One client's proposals and projects — the enroll form's "it belongs to" choices. */
export async function clientLinkChoices(organizationId: string, clientId: string): Promise<{ proposals: Array<{ id: string; label: string; hvac: boolean; accepted: boolean }>; projects: Array<{ id: string; label: string }>; suggested: PlanLink }> {
  const [proposals, projects, suggested] = await Promise.all([
    db.proposal.findMany({ where: { organizationId, clientId }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, title: true, status: true, total: true, trade: true, acceptedAt: true } }),
    db.project.findMany({ where: { organizationId, clientId }, orderBy: { createdAt: "desc" }, take: 15, select: { id: true, name: true, status: true } }),
    smartLinkFor(organizationId, clientId),
  ]);
  return {
    proposals: proposals.map((p) => {
      const k = proposalKindOf({ trade: p.trade, title: p.title });
      return { id: p.id, label: `${p.title} · ${money(Math.round(p.total * 100))} · ${p.acceptedAt ? "accepted" : p.status.toLowerCase()}`, hvac: k.family === "hvac", accepted: !!p.acceptedAt };
    }),
    projects: projects.map((p) => ({ id: p.id, label: `${p.name} · ${p.status.toLowerCase().replace("_", " ")}` })),
    suggested,
  };
}

// ── the daily run ───────────────────────────────────────────────────────────

export interface DeskRunReport { orgs: number; digests: number; texts: number; headsUps: number; reminders: number; errors: number }

/**
 * Once a day, for every shop with a plan or an open reminder: the
 * contractor's own reminders ring on their day (a bell row each), every plan
 * visit entering the heads-up window gets its bell row once, and — when the
 * digest is on — one digest row and one text sum the day up. A digest
 * already written today is never written again.
 */
export async function runServiceDeskReminders(now = new Date()): Promise<DeskRunReport> {
  const report: DeskRunReport = { orgs: 0, digests: 0, texts: 0, headsUps: 0, reminders: 0, errors: 0 };
  const [planOrgs, reminderOrgs] = await Promise.all([
    db.servicePlan.findMany({ where: { status: { in: ["ACTIVE", "SENT", "DRAFT"] } }, distinct: ["organizationId"], select: { organizationId: true } }),
    db.activityEvent.findMany({ where: { kind: TRAIL_KINDS.SERVICE_REMINDER }, distinct: ["organizationId"], select: { organizationId: true } }),
  ]);
  const orgIds = [...new Set([...planOrgs, ...reminderOrgs].map((r) => r.organizationId))];
  let link = SERVICE_DESK_PATH;
  try {
    link = `${(await appBaseUrl()).replace(/^https?:\/\//, "")}${SERVICE_DESK_PATH}`;
  } catch {
    /* the bare path still reads */
  }
  for (const organizationId of orgIds) {
    report.orgs++;
    try {
      await runOneDesk(organizationId, now, link, report);
    } catch (err) {
      report.errors++;
      console.error(`[serviceDesk] ${organizationId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return report;
}

async function runOneDesk(organizationId: string, now: Date, link: string, report: DeskRunReport) {
  const [org, prefs, plans, reminders] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } }),
    loadDeskPrefs(organizationId),
    readPlans(organizationId),
    loadReminders(organizationId, now),
  ]);
  const tz = org?.timezone || "America/New_York";
  const today = localDay(now, tz);
  const startOfToday = new Date(now.getTime() - 26 * 3600000);
  const meta = (m: Record<string, unknown>) => JSON.stringify({ href: SERVICE_DESK_PATH, ...m });

  // 1) The contractor's reminders, on their day — once.
  for (const r of reminders) {
    if (r.done || r.firedAt || r.dueOn > today) continue;
    const row = await db.activityEvent.findUnique({ where: { id: r.id }, select: { meta: true } });
    const m = JSON.parse(row?.meta ?? "{}") as Record<string, unknown>;
    await db.activityEvent.update({ where: { id: r.id }, data: { meta: JSON.stringify({ ...m, firedAt: now.toISOString() }) } });
    await db.activityEvent.create({ data: { organizationId, kind: "PLAN_REMINDER", summary: `Reminder: ${r.note}${r.clientName ? ` — ${r.clientName}` : ""}`.slice(0, 500), clientId: r.clientId, meta: meta({ reminderId: r.id }) } });
    report.reminders++;
  }

  // 2) Plan visits entering the heads-up window — a bell row each, once. At 14 days the
  //    plans' own two-week notice (PLAN_VISIT_DUE) already says it.
  const visits = visitsOf(plans);
  if (prefs.headsUpDays < 14) {
    const due = visits.filter((v) => v.planStatus === "ACTIVE" && v.status === "SCHEDULED" && visitStage(v, now, tz, prefs.headsUpDays) === "soon");
    if (due.length) {
      const had = await db.activityEvent.findMany({ where: { organizationId, kind: "PLAN_HEADS_UP", createdAt: { gte: new Date(now.getTime() - 30 * DAY) } }, select: { meta: true } });
      const done = new Set(had.map((h) => { try { return (JSON.parse(h.meta ?? "{}") as { visitId?: string }).visitId ?? ""; } catch { return ""; } }));
      for (const v of due) {
        if (done.has(v.id)) continue;
        await db.activityEvent.create({
          data: { organizationId, kind: "PLAN_HEADS_UP", clientId: v.clientId, summary: `${v.clientName}: ${v.label.toLowerCase()} ${dayLabel(v.startsAt, now, tz)} ${timeLabel(v.startsAt, tz)}${v.techs.length ? ` with ${v.techs.join(", ")}` : " — no tech on it yet"}. Confirm the time.`.slice(0, 500), meta: meta({ visitId: v.id, planId: v.planId }) },
        });
        report.headsUps++;
      }
    }
  }

  // 3) The digest: one bell row and one text a day, when there is something to say.
  if (!prefs.dailyDigest) return;
  const already = await db.activityEvent.findFirst({ where: { organizationId, kind: "PLAN_DIGEST", createdAt: { gte: startOfToday } }, orderBy: { createdAt: "desc" }, select: { meta: true } });
  if (already) {
    try {
      if ((JSON.parse(already.meta ?? "{}") as { day?: string }).day === today) return;
    } catch {
      return;
    }
  }
  const [units, installs] = await Promise.all([readUnits(organizationId, [...new Set(plans.map((p) => p.client.id))], now), readInstalls(organizationId, now)]);
  const needs = needsYou({ visits, plans: deskPlansOf(plans, now), reminders, units, installs, prefs, now, tz });
  const bell = digestText({ visits, needs, prefs, now, tz });
  if (!bell) return;
  await db.activityEvent.create({ data: { organizationId, kind: "PLAN_DIGEST", summary: bell.slice(0, 500), meta: meta({ day: today }) } });
  report.digests++;
  const text = digestText({ visits, needs, prefs, now, tz, link });
  if (text) {
    const r = await textOffice(organizationId, "service-reminder", text, { now });
    report.texts += r.sent + r.held;
  }
}
