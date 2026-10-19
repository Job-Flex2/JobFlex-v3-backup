"use server";

// HVAC SERVICES — THE DESK'S ACTIONS (2026-10-18). What /dashboard/hvac-estimator/service-desk
// adds to the plan actions (actions/servicePlans): the contractor's reminder
// settings, their own reminders, the proposal or project a plan belongs to,
// and moving or staffing a plan visit. Owner, admin, manager (the page shuts
// the limited roles out, like the Service plans page always did). Every
// action answers in words; nothing throws to the browser.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireEstimatorOrManager, requireRouteAccess } from "@/lib/orgContext";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { updateAppointment } from "@/actions/appointments";
import { atLocalHour } from "@/lib/servicePlans";
import { SERVICE_DESK_PATH, addDay, isDayString, localDay, normalizeDeskPrefs, prefsLine, type DeskPrefs } from "@/lib/serviceDesk";
import { clientLinkChoices } from "@/lib/serviceDeskBook";

export type DeskResult = { ok: true; note?: string } | { ok: false; error: string };

async function guard() {
  const ctx = await requireEstimatorOrManager();
  await requireRouteAccess(SERVICE_DESK_PATH);
  return ctx;
}

function failed(err: unknown): DeskResult {
  const msg = err instanceof Error ? err.message : "";
  if (/sign|unauthor|access/i.test(msg)) return { ok: false, error: "Your sign-in or role doesn't open this — refresh the page and try again." };
  if (/limit/i.test(msg)) return { ok: false, error: msg };
  console.error("[serviceDesk] action failed:", msg || err);
  return { ok: false, error: "That didn't save — try again in a minute." };
}

function refresh() {
  revalidatePath(SERVICE_DESK_PATH);
  revalidatePath("/dashboard/service-plans");
}

/** When JobFlex reminds the contractor: heads-up days, unsigned follow-up, the daily digest. */
export async function saveDeskPrefs(raw: Partial<DeskPrefs>): Promise<DeskResult> {
  try {
    const { organizationId, user } = await guard();
    const prefs = normalizeDeskPrefs(raw);
    await logActivity({ organizationId, actorId: user.id, kind: TRAIL_KINDS.SERVICE_PREFS, summary: `Service reminders set: ${prefsLine(prefs)}`, meta: { ...prefs } });
    refresh();
    return { ok: true, note: "Saved." };
  } catch (err) {
    return failed(err);
  }
}

const reminderInput = z.object({
  dueOn: z.string().refine(isDayString, "Pick a day"),
  note: z.string().trim().min(2, "Say what to remember").max(400),
  clientId: z.string().nullable().optional(),
  planId: z.string().nullable().optional(),
});

/** A reminder for a day: rung in the bell and the day's digest on that day, listed until it is ticked done. */
export async function addServiceReminder(raw: z.input<typeof reminderInput>): Promise<DeskResult> {
  try {
    const { organizationId, user } = await guard();
    const parsed = reminderInput.safeParse(raw);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the reminder" };
    const data = parsed.data;
    const org = await db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
    if (data.dueOn < addDay(localDay(new Date(), org?.timezone || "America/New_York"), -1)) return { ok: false, error: "Pick today or a day ahead." };
    const client = data.clientId ? await db.client.findFirst({ where: { id: data.clientId, organizationId, deletedAt: null }, select: { id: true, name: true } }) : null;
    const plan = data.planId ? await db.servicePlan.findFirst({ where: { id: data.planId, organizationId }, select: { id: true, clientId: true } }) : null;
    await db.activityEvent.create({
      data: {
        organizationId,
        actorId: user.id,
        kind: TRAIL_KINDS.SERVICE_REMINDER,
        clientId: client?.id ?? plan?.clientId ?? null,
        summary: `Set a service reminder for ${data.dueOn}: ${data.note}${client ? ` — ${client.name}` : ""}`.slice(0, 500),
        meta: JSON.stringify({ dueOn: data.dueOn, note: data.note, planId: plan?.id ?? null, href: SERVICE_DESK_PATH }),
      },
    });
    refresh();
    return { ok: true, note: "Reminder set." };
  } catch (err) {
    return failed(err);
  }
}

async function reminderRow(organizationId: string, id: string) {
  return db.activityEvent.findFirst({ where: { id, organizationId, kind: { in: [TRAIL_KINDS.SERVICE_REMINDER, TRAIL_KINDS.SERVICE_REMINDER_DONE] } }, select: { id: true, kind: true, meta: true } });
}
const metaOf = (m: string | null) => {
  try {
    return (JSON.parse(m ?? "{}") ?? {}) as Record<string, unknown>;
  } catch {
    return {};
  }
};

/** Ticked done — or opened again. */
export async function setServiceReminderDone(id: string, done: boolean): Promise<DeskResult> {
  try {
    const { organizationId } = await guard();
    const row = await reminderRow(organizationId, String(id));
    if (!row) return { ok: false, error: "That reminder is gone." };
    const meta = metaOf(row.meta);
    await db.activityEvent.update({
      where: { id: row.id },
      data: { kind: done ? TRAIL_KINDS.SERVICE_REMINDER_DONE : TRAIL_KINDS.SERVICE_REMINDER, meta: JSON.stringify({ ...meta, doneAt: done ? new Date().toISOString() : null }) },
    });
    refresh();
    return { ok: true };
  } catch (err) {
    return failed(err);
  }
}

/** Later: the reminder moves `days` ahead of today (or of its own day, when that is still ahead) and rings again then. */
export async function snoozeServiceReminder(id: string, days: number): Promise<DeskResult> {
  try {
    const { organizationId } = await guard();
    const n = z.number().int().min(1).max(365).parse(days);
    const row = await reminderRow(organizationId, String(id));
    if (!row) return { ok: false, error: "That reminder is gone." };
    const org = await db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
    const today = localDay(new Date(), org?.timezone || "America/New_York");
    const meta = metaOf(row.meta);
    const from = isDayString(meta.dueOn) && meta.dueOn > today ? meta.dueOn : today;
    await db.activityEvent.update({ where: { id: row.id }, data: { kind: TRAIL_KINDS.SERVICE_REMINDER, meta: JSON.stringify({ ...meta, dueOn: addDay(from, n), firedAt: null, doneAt: null }) } });
    refresh();
    return { ok: true };
  } catch (err) {
    return failed(err);
  }
}

export async function removeServiceReminder(id: string): Promise<DeskResult> {
  try {
    const { organizationId } = await guard();
    const row = await reminderRow(organizationId, String(id));
    if (!row) return { ok: true };
    await db.activityEvent.delete({ where: { id: row.id } });
    refresh();
    return { ok: true };
  } catch (err) {
    return failed(err);
  }
}

/** The proposal or project a plan belongs to (both empty = not tied to anything). */
export async function linkServicePlan(planId: string, link: { proposalId?: string | null; projectId?: string | null }): Promise<DeskResult> {
  try {
    const { organizationId, user } = await guard();
    const plan = await db.servicePlan.findFirst({ where: { id: String(planId), organizationId }, select: { id: true, name: true, clientId: true, client: { select: { name: true } } } });
    if (!plan) return { ok: false, error: "That plan is gone." };
    const proposal = link.proposalId ? await db.proposal.findFirst({ where: { id: link.proposalId, organizationId, clientId: plan.clientId }, select: { id: true, title: true, projectId: true } }) : null;
    const project = link.projectId ? await db.project.findFirst({ where: { id: link.projectId, organizationId }, select: { id: true, name: true } }) : null;
    if (link.proposalId && !proposal) return { ok: false, error: "That proposal is not this client's." };
    const projectId = project?.id ?? proposal?.projectId ?? null;
    await logActivity({
      organizationId,
      actorId: user.id,
      kind: TRAIL_KINDS.SERVICE_LINK,
      summary: proposal ? `Tied ${plan.client.name}'s ${plan.name} to "${proposal.title}"` : project ? `Tied ${plan.client.name}'s ${plan.name} to the project ${project.name}` : `Untied ${plan.client.name}'s ${plan.name} from any proposal or project`,
      clientId: plan.clientId,
      proposalId: proposal?.id ?? null,
      meta: { planId: plan.id, projectId },
    });
    refresh();
    return { ok: true, note: "Saved." };
  } catch (err) {
    return failed(err);
  }
}

/** One client's proposals and projects for the "belongs to" pick, with the smart guess. */
export async function deskClientLinks(clientId: string) {
  try {
    const { organizationId } = await guard();
    const client = await db.client.findFirst({ where: { id: String(clientId), organizationId, deletedAt: null }, select: { id: true } });
    if (!client) return { ok: false as const, error: "That client is not in this company." };
    return { ok: true as const, ...(await clientLinkChoices(organizationId, client.id)) };
  } catch (err) {
    const r = failed(err);
    return { ok: false as const, error: r.ok ? "" : r.error };
  }
}

async function visitOf(organizationId: string, visitId: string) {
  return db.servicePlanVisit.findFirst({ where: { id: String(visitId), organizationId }, select: { id: true, appointmentId: true, dueAt: true, remindedAt: true, appointment: { select: { startsAt: true, endsAt: true } } } });
}

/**
 * A plan visit moves to another day and time: its calendar appointment moves
 * (the crew and the office hear, as on the calendar), and the visit's own day
 * follows so the plans' reminders read the new date.
 */
export async function moveServiceVisit(visitId: string, day: string, time: string): Promise<DeskResult> {
  try {
    const { organizationId } = await guard();
    if (!isDayString(day) || !/^\d{1,2}:\d{2}$/.test(time)) return { ok: false, error: "Pick a day and a time." };
    const v = await visitOf(organizationId, visitId);
    if (!v || !v.appointmentId || !v.appointment) return { ok: false, error: "That visit has no calendar entry to move." };
    const org = await db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
    const tz = org?.timezone || "America/New_York";
    const [h, m] = time.split(":").map(Number);
    if (h > 23 || m > 59) return { ok: false, error: "Pick a time of day." };
    const dayAt = new Date(`${day}T00:00:00Z`);
    const start = new Date(atLocalHour(dayAt, h, tz).getTime() + m * 60000);
    const length = Math.max(30 * 60000, v.appointment.endsAt.getTime() - v.appointment.startsAt.getTime());
    await updateAppointment(v.appointmentId, { startsAt: start.toISOString(), endsAt: new Date(start.getTime() + length).toISOString() });
    const farther = dayAt.getTime() - Date.now() > 14 * 86400000;
    await db.servicePlanVisit.update({ where: { id: v.id }, data: { dueAt: dayAt, ...(farther && v.remindedAt ? { remindedAt: null } : {}) } });
    refresh();
    return { ok: true, note: `Moved to ${day} ${time}.` };
  } catch (err) {
    return failed(err);
  }
}

/** Who goes: the people staffed on the visit's appointment (they get the crew's text, as from the calendar). */
export async function staffServiceVisit(visitId: string, workerIds: string[]): Promise<DeskResult> {
  try {
    const { organizationId } = await guard();
    const ids = z.array(z.string().min(1)).max(10).parse(workerIds);
    const v = await visitOf(organizationId, visitId);
    if (!v || !v.appointmentId) return { ok: false, error: "That visit has no calendar entry to staff." };
    await updateAppointment(v.appointmentId, { workerIds: ids });
    refresh();
    return { ok: true, note: ids.length ? "Staffed." : "Nobody on it now." };
  } catch (err) {
    return failed(err);
  }
}
