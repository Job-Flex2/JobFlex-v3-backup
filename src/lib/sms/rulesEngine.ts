// YOUR OWN TEXTS (2026-09-29) — the server half: build the facts of the
// moment, fill the company's rules, send. The catalog, the fields and the
// renderer are ./textRules (pure). Hooks call `fireTextRules(trigger, ref)`
// after the response; the hourly text cron calls `runTimedTextRules(now)` for
// "hours before a visit / a job day" and "days with no answer on a proposal";
// "days after a job" is queued as held texts the moment the job completes.
//
// Rules of the road, same as every other text (./send): STOP wins, caps
// hold, a number hears one copy. Clients are texted only when the company's
// "Text clients" switch is on, never between 9 PM and 8 AM company time (the
// text waits for the morning), and always with the company's name and the
// STOP line. The team's copies wait through 8 PM – 7 AM. Nobody is texted
// about their own click.

import { parseNotificationPrefs } from "@/lib/notificationPrefsShared";
import { db } from "@/lib/db";
import { appBaseUrl } from "@/lib/appUrl";
import { toE164 } from "@/lib/phone";
import { defaultNotificationPrefs, inQuietHours, nextLocalTime } from "@/lib/notificationPrefsShared";
import { clip, money, spanLabel, streetOf } from "./format";
import { sendText } from "./send";
import { renderRuleText, signed, triggerOf, withStopLine, type RuleField, type RuleTriggerKey } from "./textRules";

const OFFICE = ["OWNER", "ADMIN", "MANAGER"];

function log(what: string, err: unknown) {
  console.error(`[sms/rules] ${what}: ${err instanceof Error ? err.message : String(err)}`);
}

export type RuleContext = {
  organizationId: string;
  /** Once per rule per this: "p:<proposal>", "a:<appointment>", "j:<job>", "e:<job event>", "l:<lead>". */
  entity: string;
  vars: Partial<Record<RuleField, string>>;
  clientLink: string | null;
  staffLink: string | null;
  clientPhone: string | null;
  repUserId: string | null;
  crew: { phone: string | null; smsOptIn: boolean }[];
};

const firstName = (name: string | null | undefined) => (name ?? "").trim().split(/\s+/)[0] || "";
const prettyPhone = (raw: string | null | undefined) => {
  const e = raw ? toE164(raw) : null;
  if (!e) return raw ?? "";
  const d = e.slice(-10);
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
};

// ── the facts of each kind of moment ─────────────────────────────────────

export async function proposalContext(proposalId: string, extra: Partial<Record<RuleField, string>> = {}): Promise<RuleContext | null> {
  const p = await db.proposal.findUnique({
    where: { id: proposalId },
    select: {
      id: true,
      publicId: true,
      title: true,
      total: true,
      address: true,
      organizationId: true,
      ownerId: true,
      owner: { select: { name: true } },
      client: { select: { name: true, phone: true, address: true } },
      organization: { select: { name: true, phone: true } },
    },
  });
  if (!p) return null;
  const app = await appBaseUrl();
  return {
    organizationId: p.organizationId,
    entity: `p:${p.id}`,
    vars: {
      client: p.client?.name ?? "",
      first: firstName(p.client?.name),
      company: p.organization.name ?? "",
      phone: prettyPhone(p.organization.phone),
      job: p.title,
      total: money(p.total),
      address: streetOf(p.address ?? p.client?.address ?? null),
      rep: p.owner?.name ?? "",
      ...extra,
    },
    clientLink: `${app}/portal/q/${p.publicId}`,
    staffLink: `${app}/dashboard/proposals/${p.id}`,
    clientPhone: p.client?.phone ?? null,
    repUserId: p.ownerId ?? null,
    crew: [],
  };
}

export async function appointmentContext(appointmentId: string): Promise<RuleContext | null> {
  const a = await db.appointment.findUnique({
    where: { id: appointmentId },
    select: {
      id: true,
      organizationId: true,
      title: true,
      startsAt: true,
      endsAt: true,
      createdById: true,
      createdBy: { select: { name: true } },
      client: { select: { name: true, phone: true, address: true } },
      lead: { select: { name: true, phone: true, address: true } },
      booking: { select: { name: true, phone: true, address: true, manageToken: true } },
      organization: { select: { name: true, phone: true, timezone: true } },
      assignments: { select: { worker: { select: { phone: true, smsOptIn: true } } } },
    },
  });
  if (!a) return null;
  const app = await appBaseUrl();
  const person = a.client ?? a.lead ?? a.booking;
  const tz = a.organization.timezone || "America/New_York";
  return {
    organizationId: a.organizationId,
    entity: `a:${a.id}`,
    vars: {
      client: person?.name ?? "",
      first: firstName(person?.name),
      company: a.organization.name ?? "",
      phone: prettyPhone(a.organization.phone),
      job: a.title,
      when: spanLabel(a.startsAt, a.endsAt, tz),
      address: streetOf(person?.address ?? null),
      rep: a.createdBy?.name ?? "",
    },
    clientLink: a.booking?.manageToken ? `${app}/book/manage/${a.booking.manageToken}` : null,
    staffLink: `${app}/dashboard/calendar`,
    clientPhone: a.client?.phone ?? a.lead?.phone ?? a.booking?.phone ?? null,
    repUserId: a.createdById ?? null,
    crew: a.assignments.map((x) => x.worker),
  };
}

/** A job's facts; `slot` is the crew day in question when there is one. */
export async function jobContext(jobId: string, slot?: { startsAt: Date; endsAt?: Date | null; eventId?: string }): Promise<RuleContext | null> {
  const j = await db.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      organizationId: true,
      title: true,
      startsAt: true,
      endsAt: true,
      client: { select: { name: true, phone: true, address: true } },
      proposal: { select: { ownerId: true, total: true, publicId: true, address: true, owner: { select: { name: true } } } },
      organization: { select: { name: true, phone: true, timezone: true } },
      assignments: { select: { worker: { select: { phone: true, smsOptIn: true } } } },
    },
  });
  if (!j) return null;
  const app = await appBaseUrl();
  const tz = j.organization.timezone || "America/New_York";
  const start = slot?.startsAt ?? j.startsAt;
  return {
    organizationId: j.organizationId,
    entity: slot?.eventId ? `e:${slot.eventId}` : `j:${j.id}`,
    vars: {
      client: j.client?.name ?? "",
      first: firstName(j.client?.name),
      company: j.organization.name ?? "",
      phone: prettyPhone(j.organization.phone),
      job: j.title,
      when: start ? spanLabel(start, slot ? (slot.endsAt ?? null) : j.endsAt, tz) : "",
      address: streetOf(j.client?.address ?? j.proposal?.address ?? null),
      total: j.proposal ? money(j.proposal.total) : "",
      rep: j.proposal?.owner?.name ?? "",
    },
    clientLink: j.proposal?.publicId ? `${app}/portal/q/${j.proposal.publicId}` : null,
    staffLink: `${app}/dashboard/jobs/${j.id}`,
    clientPhone: j.client?.phone ?? null,
    repUserId: j.proposal?.ownerId ?? null,
    crew: j.assignments.map((x) => x.worker),
  };
}

export async function leadContext(leadId: string): Promise<RuleContext | null> {
  const l = await db.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true,
      organizationId: true,
      name: true,
      phone: true,
      address: true,
      city: true,
      projectType: true,
      assignedToId: true,
      assignedTo: { select: { name: true } },
      organization: { select: { name: true, phone: true } },
    },
  });
  if (!l) return null;
  const app = await appBaseUrl();
  return {
    organizationId: l.organizationId,
    entity: `l:${l.id}`,
    vars: {
      client: l.name,
      first: firstName(l.name),
      company: l.organization.name ?? "",
      phone: prettyPhone(l.organization.phone),
      job: l.projectType ?? "",
      address: streetOf(l.address ?? l.city ?? null),
      rep: l.assignedTo?.name ?? "",
    },
    clientLink: null,
    staffLink: `${app}/dashboard/leads/${l.id}`,
    clientPhone: l.phone ?? null,
    repUserId: l.assignedToId ?? null,
    crew: [],
  };
}

// ── sending one rule ──────────────────────────────────────────────────────

type RuleRow = {
  id: string;
  organizationId: string;
  trigger: string;
  offset: number | null;
  toClient: boolean;
  toOffice: boolean;
  toRep: boolean;
  toCrew: boolean;
  toUserIdsJson: string | null;
  body: string;
};

function namedIds(json: string | null): string[] {
  try {
    const v: unknown = json ? JSON.parse(json) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 40) : [];
  } catch {
    return [];
  }
}

/** Every number one rule reaches for one moment, with the words for each. */
export async function sendRule(
  rule: RuleRow,
  ctx: RuleContext,
  opts: { actorUserId?: string | null; sendAfter?: Date | null; now?: Date } = {},
): Promise<number> {
  const now = opts.now ?? new Date();
  const kind = `rule:${rule.id}:${ctx.entity}`;
  const org = await db.organization.findUnique({ where: { id: ctx.organizationId }, select: { name: true, timezone: true, smsClientsOn: true } });
  if (!org) return 0;
  const tz = org.timezone || "America/New_York";
  const seen = new Set<string>();
  let sent = 0;
  const go = async (raw: string | null | undefined, body: string, after: Date | null) => {
    const to = raw ? toE164(raw) : null;
    if (!to || seen.has(to)) return;
    seen.add(to);
    const r = await sendText({ organizationId: ctx.organizationId, to, body, kind, sendAfter: after });
    if (r.ok) sent++;
  };
  // Staff: the company's name leads, the team's link fills {link}.
  const staffBody = clip(signed(org.name, renderRuleText(rule.body, { ...ctx.vars, link: ctx.staffLink ?? "" })));
  const defaults = defaultNotificationPrefs();
  const clientQuiet = { ...defaults, quietFrom: "21:00", quietTo: "08:00" };
  // A delayed text ("2 days after") keeps the day, not the hour: one that
  // would land at night waits for the morning — 7 AM for the team, 8 for clients.
  const daytime = (at: Date | null, quiet: typeof defaults, morning: string): Date | null => {
    const when = at ?? now;
    if (!inQuietHours(quiet, when, tz)) return at;
    return nextLocalTime(morning, when, tz);
  };
  const staffAfter = daytime(opts.sendAfter ?? null, defaults, defaults.quietTo);

  if (rule.toClient && org.smsClientsOn && ctx.clientPhone) {
    const body = withStopLine(clip(signed(org.name, renderRuleText(rule.body, { ...ctx.vars, link: ctx.clientLink ?? "" })), 290));
    const after = daytime(opts.sendAfter ?? null, clientQuiet, "08:00");
    await go(ctx.clientPhone, body, after);
  }
  const userIds = new Set<string>();
  if (rule.toOffice) {
    const office = await db.membership.findMany({ where: { organizationId: ctx.organizationId, role: { in: OFFICE } }, select: { userId: true } });
    office.forEach((m) => userIds.add(m.userId));
  }
  if (rule.toRep && ctx.repUserId) userIds.add(ctx.repUserId);
  for (const id of namedIds(rule.toUserIdsJson)) userIds.add(id);
  if (opts.actorUserId) userIds.delete(opts.actorUserId);
  if (userIds.size) {
    const [members, workers] = await Promise.all([
      db.membership.findMany({ where: { organizationId: ctx.organizationId, userId: { in: [...userIds] } }, select: { user: { select: { id: true, smsPhone: true, smsVerifiedAt: true, notificationPrefsJson: true } } } }),
      db.workerProfile.findMany({ where: { organizationId: ctx.organizationId, userId: { in: [...userIds] } }, select: { userId: true, phone: true, smsOptIn: true } }),
    ]);
    const workerOf = new Map(workers.map((w) => [w.userId, w]));
    for (const m of members) {
      const u = m.user;
      if (!u) continue;
      // Texts switched off for this member on Settings → Texting (2026-10-13).
      if (parseNotificationPrefs(u.notificationPrefsJson).smsPaused) continue;
      const w = workerOf.get(u.id);
      const phone = u.smsPhone && u.smsVerifiedAt ? u.smsPhone : w?.smsOptIn ? w.phone : null;
      await go(phone, staffBody, staffAfter);
    }
  }
  if (rule.toCrew) for (const w of ctx.crew) if (w.smsOptIn) await go(w.phone, staffBody, staffAfter);
  return sent;
}

/** The moment happened: every active rule on it goes out. `job.completed`
 *  also queues the company's "days after a job" rules. Never throws. */
export async function fireTextRules(
  trigger: RuleTriggerKey,
  ref: RuleContext | Promise<RuleContext | null> | null,
  opts: { actorUserId?: string | null } = {},
): Promise<void> {
  try {
    const ctx = await ref;
    if (!ctx) return;
    const triggers: string[] = trigger === "job.completed" ? ["job.completed", "job.after"] : [trigger];
    const rules = await db.textRule.findMany({ where: { organizationId: ctx.organizationId, trigger: { in: triggers }, active: true } });
    for (const rule of rules) {
      const t = triggerOf(rule.trigger);
      if (t?.timed?.dir === "after" && rule.trigger === "job.after") {
        const days = rule.offset ?? t.timed.default;
        await sendRule(rule, ctx, { actorUserId: opts.actorUserId, sendAfter: new Date(Date.now() + days * 86_400_000) });
      } else if (!t?.timed) {
        await sendRule(rule, ctx, { actorUserId: opts.actorUserId });
      }
    }
  } catch (err) {
    log(trigger, err);
  }
}

// ── the hourly sweep: the timed rules ─────────────────────────────────────

const HOUR = 3_600_000;

async function saidAlready(ruleId: string, entity: string): Promise<boolean> {
  return Boolean(await db.smsMessage.findFirst({ where: { kind: `rule:${ruleId}:${entity}` }, select: { id: true } }));
}

/**
 * Hours before a visit or a crew day, days with no answer on a proposal —
 * each hour looks one hour ahead of its target, so every moment is caught
 * exactly once (and a rule said once for a thing is never said again).
 */
export async function runTimedTextRules(now = new Date()): Promise<number> {
  let sent = 0;
  const rules = await db.textRule.findMany({ where: { active: true, trigger: { in: ["appointment.before", "job.before", "proposal.unanswered"] } } });
  for (const rule of rules) {
    try {
      const t = triggerOf(rule.trigger);
      if (!t?.timed) continue;
      const n = rule.offset ?? t.timed.default;
      if (rule.trigger === "appointment.before") {
        const from = new Date(now.getTime() + n * HOUR);
        const apts = await db.appointment.findMany({ where: { organizationId: rule.organizationId, status: "SCHEDULED", startsAt: { gte: from, lt: new Date(from.getTime() + HOUR) } }, select: { id: true }, take: 200 });
        for (const a of apts) {
          if (await saidAlready(rule.id, `a:${a.id}`)) continue;
          const ctx = await appointmentContext(a.id);
          if (ctx) sent += await sendRule(rule, ctx, { now });
        }
      } else if (rule.trigger === "job.before") {
        const from = new Date(now.getTime() + n * HOUR);
        const events = await db.jobEvent.findMany({ where: { organizationId: rule.organizationId, jobId: { not: null }, startsAt: { gte: from, lt: new Date(from.getTime() + HOUR) } }, select: { id: true, jobId: true, startsAt: true, endsAt: true }, take: 200 });
        for (const e of events) {
          if (!e.jobId || (await saidAlready(rule.id, `e:${e.id}`))) continue;
          const ctx = await jobContext(e.jobId, { startsAt: e.startsAt, endsAt: e.endsAt, eventId: e.id });
          if (ctx) sent += await sendRule(rule, ctx, { now });
        }
      } else if (rule.trigger === "proposal.unanswered") {
        const to = new Date(now.getTime() - n * 24 * HOUR);
        const props = await db.proposal.findMany({ where: { organizationId: rule.organizationId, status: { in: ["SENT", "VIEWED"] }, sentAt: { gte: new Date(to.getTime() - HOUR), lt: to } }, select: { id: true }, take: 200 });
        for (const p of props) {
          if (await saidAlready(rule.id, `p:${p.id}`)) continue;
          const ctx = await proposalContext(p.id);
          if (ctx) sent += await sendRule(rule, ctx, { now });
        }
      }
    } catch (err) {
      log(`timed rule ${rule.id}`, err);
    }
  }
  return sent;
}
