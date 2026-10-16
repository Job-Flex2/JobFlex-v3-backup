// THE CALENDAR'S TEXTS (2026-09-29) — server only.
//
// Owner: "for sales most of it is going to be appointments, or if their
// proposal was sold, and scheduling". The office hears about every visit and
// every install date; the rep hears about their own — the visit they booked
// or are staffed on, the job from their proposal. Both through their Text
// switches on Settings → Texting (the office roster and the sales roster
// list "Appointment booked", "Appointment moved or cancelled" and "Job
// scheduled"). The crew's own texts stay in ./crew. Best-effort: nothing
// here throws into the action that changed the calendar.

import { db } from "@/lib/db";
import { appBaseUrl } from "@/lib/appUrl";
import { appointmentBookedLine, appointmentCancelledLine, appointmentMovedLine, jobScheduledLine, spanLabel } from "./format";
import { textOffice } from "./send";
import { appointmentContext, fireTextRules, jobContext, type RuleContext } from "./rulesEngine";

function log(what: string, err: unknown) {
  console.error(`[sms/schedule] ${what}: ${err instanceof Error ? err.message : String(err)}`);
}

type Who = { name: string | null } | null;
const nameOf = (...people: Who[]): string | null => people.map((p) => p?.name?.trim() || null).find(Boolean) ?? null;

async function appointmentFacts(appointmentId: string) {
  const apt = await db.appointment.findUnique({
    where: { id: appointmentId },
    select: {
      organizationId: true,
      title: true,
      startsAt: true,
      endsAt: true,
      createdById: true,
      client: { select: { name: true, address: true } },
      lead: { select: { name: true, address: true } },
      booking: { select: { name: true, address: true } },
      organization: { select: { timezone: true } },
      // Staff on the visit who log in as sales: they hear about it too.
      assignments: { select: { worker: { select: { userId: true } } } },
    },
  });
  if (!apt) return null;
  return {
    organizationId: apt.organizationId,
    title: apt.title,
    startsAt: apt.startsAt,
    endsAt: apt.endsAt,
    tz: apt.organization.timezone || "America/New_York",
    who: nameOf(apt.client, apt.lead, apt.booking),
    where: apt.client?.address ?? apt.lead?.address ?? apt.booking?.address ?? null,
    people: [apt.createdById, ...apt.assignments.map((a) => a.worker.userId)],
  };
}

/** A visit went on the calendar — by a member (`actorUserId`, who is not
 *  texted about their own click) or online (`by: "online"`). */
/** `by`: "online" for the booking page, a name ("the AI desk") for anyone else who booked it. */
export async function textAppointmentBooked(appointmentId: string, actorUserId: string | null, by: "online" | string | null = null): Promise<void> {
  try {
    const a = await appointmentFacts(appointmentId);
    if (!a) return;
    const line = appointmentBookedLine(a.title, a.who, spanLabel(a.startsAt, a.endsAt, a.tz), a.where, by);
    await textOffice(a.organizationId, "appointment-booked", line, { alsoUserIds: a.people, excludeUserIds: actorUserId ? [actorUserId] : [] });
    await fireTextRules("appointment.booked", appointmentContext(appointmentId), { actorUserId });
  } catch (err) {
    log("booked", err);
  }
}

/** A visit changed day or time. `wasStartsAt` is the slot before the move. */
export async function textAppointmentMoved(appointmentId: string, wasStartsAt: Date | null, actorUserId: string | null): Promise<void> {
  try {
    const a = await appointmentFacts(appointmentId);
    if (!a) return;
    const was = wasStartsAt ? spanLabel(wasStartsAt, null, a.tz) : null;
    const line = appointmentMovedLine(a.title, a.who, was, spanLabel(a.startsAt, a.endsAt, a.tz));
    await textOffice(a.organizationId, "appointment-moved", line, { alsoUserIds: a.people, excludeUserIds: actorUserId ? [actorUserId] : [] });
    await fireTextRules("appointment.moved", appointmentContext(appointmentId), { actorUserId });
  } catch (err) {
    log("moved", err);
  }
}

/** A visit came off the calendar. Read the facts BEFORE a delete, then pass
 *  them here after the response. */
export type CancelledVisit = (NonNullable<Awaited<ReturnType<typeof appointmentFacts>>> & { rule: RuleContext | null }) | null;
export async function visitFacts(appointmentId: string): Promise<CancelledVisit> {
  const [facts, rule] = await Promise.all([appointmentFacts(appointmentId), appointmentContext(appointmentId).catch(() => null)]);
  return facts ? { ...facts, rule } : null;
}
export async function textAppointmentCancelled(a: CancelledVisit, actorUserId: string | null, by: "online" | null = null): Promise<void> {
  if (!a) return;
  try {
    const line = appointmentCancelledLine(a.title, a.who, spanLabel(a.startsAt, a.endsAt, a.tz), by);
    await textOffice(a.organizationId, "appointment-moved", line, { alsoUserIds: a.people, excludeUserIds: actorUserId ? [actorUserId] : [] });
    await fireTextRules("appointment.cancelled", a.rule, { actorUserId });
  } catch (err) {
    log("cancelled", err);
  }
}

/** A job got its date: the office and the rep who sold it. */
export async function textJobScheduled(jobId: string, startsAt: Date, endsAt: Date | null, actorUserId: string | null): Promise<void> {
  try {
    const job = await db.job.findUnique({
      where: { id: jobId },
      select: {
        organizationId: true,
        title: true,
        client: { select: { address: true } },
        proposal: { select: { ownerId: true, address: true } },
        organization: { select: { timezone: true } },
      },
    });
    if (!job) return;
    const tz = job.organization.timezone || "America/New_York";
    const line = jobScheduledLine(job.title, spanLabel(startsAt, endsAt, tz), job.client?.address ?? job.proposal?.address ?? null, `${await appBaseUrl()}/dashboard/jobs/${jobId}`);
    await textOffice(job.organizationId, "job-scheduled", line, { alsoUserIds: [job.proposal?.ownerId], excludeUserIds: actorUserId ? [actorUserId] : [] });
    await fireTextRules("job.scheduled", jobContext(jobId, { startsAt, endsAt }), { actorUserId });
  } catch (err) {
    log("job scheduled", err);
  }
}
