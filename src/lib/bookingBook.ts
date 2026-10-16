// ONLINE BOOKING — THE BOOK (2026-09-23), server only. The rules live in
// lib/booking; this is what touches the database: the shop's settings, what
// is already on the calendar, a visit booked by a customer (a client the
// shop knows, or a new lead), the appointment it becomes, the manage link,
// confirmations and reminders.

import { db } from "@/lib/db";
import { sendOrgEmail } from "@/lib/email/orgSend";
import { renderEmail } from "@/lib/email/renderEmail";
import type { EmailDoc } from "@/lib/email/doc";
import { appBaseUrl } from "@/lib/appUrl";
import { afterResponse } from "@/lib/server-events";
import { textAppointmentBooked, textAppointmentCancelled, textAppointmentMoved as textVisitMoved, visitFacts } from "@/lib/sms/schedule";
import { parseTradeTypes } from "@/lib/tradeTypes";
import { toE164 } from "@/lib/phone";
import { aptSourceKey, bookingNoteHead, type AptSource } from "@/lib/calendar/visitVia";
import { availableSlots, bookingScope, parseBookingSettings, slotLabel, type BookingService, type BookingSettings, type Busy, type DaySlots } from "@/lib/booking";

const ORG_SELECT = { id: true, name: true, slug: true, timezone: true, logoUrl: true, phone: true, billingEmail: true, gmailSettingsJson: true, gmailTokensJson: true, tradeTypesJson: true, bookingSettingsJson: true } as const;
type OrgRow = { id: string; name: string | null; slug: string; timezone: string; logoUrl: string | null; phone: string | null; billingEmail: string | null; gmailSettingsJson: string | null; gmailTokensJson: string | null; tradeTypesJson: string | null; bookingSettingsJson: string | null };
const DAY = 86400000;

export function settingsOf(org: { tradeTypesJson: string | null; bookingSettingsJson: string | null }): BookingSettings {
  return parseBookingSettings(org.bookingSettingsJson, parseTradeTypes(org.tradeTypesJson));
}

export async function orgBySlug(slug: string): Promise<OrgRow | null> {
  return db.organization.findUnique({ where: { slug }, select: ORG_SELECT });
}

/** Everything that already takes the crew's time between two instants. */
export async function busyBetween(organizationId: string, from: Date, to: Date): Promise<Busy[]> {
  const [appts, jobs, blocks] = await Promise.all([
    db.appointment.findMany({ where: { organizationId, status: { notIn: ["CANCELED", "NO_SHOW"] }, startsAt: { lt: to }, endsAt: { gt: from } }, select: { startsAt: true, endsAt: true } }),
    db.job.findMany({ where: { organizationId, status: { notIn: ["CANCELED", "DONE", "COMPLETED"] }, startsAt: { not: null, lt: to }, endsAt: { not: null, gt: from } }, select: { startsAt: true, endsAt: true } }),
    db.blockedTime.findMany({ where: { organizationId, ownerId: null, startsAt: { lt: to }, endsAt: { gt: from } }, select: { startsAt: true, endsAt: true } }),
  ]);
  return [...appts, ...blocks, ...jobs.map((j) => ({ startsAt: j.startsAt!, endsAt: j.endsAt! }))];
}

/** The client the shop knows by this email, whatever its case (SQLite on the stand has no insensitive mode). */
async function clientByEmail(organizationId: string, email: string): Promise<{ id: string; name: string } | null> {
  const exact = await db.client.findFirst({ where: { organizationId, deletedAt: null, email }, select: { id: true, name: true } });
  if (exact) return exact;
  const at = email.indexOf("@");
  if (at < 0) return null;
  const same = await db.client.findMany({ where: { organizationId, deletedAt: null, email: { endsWith: email.slice(at) } }, select: { id: true, name: true, email: true }, take: 50 });
  const hit = same.find((c) => (c.email ?? "").toLowerCase() === email);
  return hit ? { id: hit.id, name: hit.name } : null;
}

/** A client the shop knows by this number (the AI desk's caller has a number, rarely an email). */
async function clientByPhone(organizationId: string, phone: string): Promise<{ id: string; name: string } | null> {
  const e164 = toE164(phone);
  if (!e164) return null;
  const same = await db.client.findMany({ where: { organizationId, deletedAt: null, phone: { contains: e164.slice(-4) } }, select: { id: true, name: true, phone: true }, take: 25 });
  const hit = same.find((c) => toE164(c.phone ?? "") === e164);
  return hit ? { id: hit.id, name: hit.name } : null;
}

/** An open lead with this number — the caller who left a message yesterday and calls back to book. */
async function openLeadByPhone(organizationId: string, phone: string): Promise<{ id: string } | null> {
  const e164 = toE164(phone);
  if (!e164) return null;
  const same = await db.lead.findMany({ where: { organizationId, status: { notIn: ["WON", "LOST", "ARCHIVED"] }, phone: { contains: e164.slice(-4) } }, orderBy: { createdAt: "desc" }, select: { id: true, phone: true }, take: 25 });
  const hit = same.find((l) => toE164(l.phone ?? "") === e164);
  return hit ? { id: hit.id } : null;
}

export async function availabilityFor(org: OrgRow, service: BookingService, now = new Date()): Promise<DaySlots[]> {
  const settings = settingsOf(org);
  const busy = await busyBetween(org.id, new Date(now.getTime() - DAY), new Date(now.getTime() + (settings.horizonDays + 2) * DAY));
  return availableSlots({ settings, service, busy, timeZone: org.timezone || "America/New_York", now });
}

async function emailCustomer(org: OrgRow, to: string | null | undefined, doc: Omit<EmailDoc, "lockup" | "footer">): Promise<boolean> {
  if (!to) return false;
  try {
    const name = org.name ?? "Your contractor";
    const { subject, html } = renderEmail({ ...doc, lockup: { kind: "org", name, logoUrl: org.logoUrl }, footer: { name, contact: org.phone ?? org.billingEmail ?? undefined } });
    const r = await sendOrgEmail(org, { to, subject, html });
    return !!r && (r as { ok?: boolean }).ok !== false;
  } catch (err) {
    console.warn(`[booking] email not sent: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

export interface NewBooking {
  serviceKey: string;
  startsAtISO: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  notes?: string | null;
  answers: Array<{ key: string; label: string; value: string }>;
  /** Who booked: the customer on the booking page (default) or the AI desk on a call. */
  channel?: "online" | "ai-desk";
  /** The desk's call, kept with the visit so the calendar can point back to it. */
  callSid?: string | null;
}

export interface BookingReceipt {
  ok: true;
  manageToken: string;
  when: string;
  serviceLabel: string;
  member: boolean;
  priceText: string;
  arrivalWindow: number;
}

/**
 * A customer books: the slot is checked against the calendar again, the
 * customer is matched to a client the shop knows (by email) or becomes a
 * lead with the booking as its scope, the appointment lands on the
 * calendar, the office hears, the customer gets the confirmation with the
 * manage link. A member (an active plan on the matched client) gets the
 * member price on the receipt.
 */
export async function createBooking(org: OrgRow, input: NewBooking, now = new Date()): Promise<BookingReceipt | { ok: false; error: string }> {
  const settings = settingsOf(org);
  if (!settings.enabled) return { ok: false, error: "Online booking is off for this company right now — please call." };
  const service = settings.services.find((s) => s.key === input.serviceKey);
  if (!service) return { ok: false, error: "That service is no longer offered online." };
  const startsAt = new Date(input.startsAtISO);
  if (!Number.isFinite(startsAt.getTime())) return { ok: false, error: "Pick a time." };
  const days = await availabilityFor(org, service, now);
  const slot = days.flatMap((d) => d.slots).find((s) => s.startsAt.getTime() === startsAt.getTime());
  if (!slot) return { ok: false, error: "That time was just taken — please pick another." };
  const tz = org.timezone || "America/New_York";
  const email = input.email?.trim().toLowerCase() || null;
  const channel = input.channel === "ai-desk" ? "ai-desk" : "online";
  const desk = channel === "ai-desk";
  const phone = input.phone?.trim() || null;
  // A caller is matched by their number (the desk rarely has an email); a web
  // booking only by email — a number typed into a form proves nothing.
  const client = (email ? await clientByEmail(org.id, email) : null) ?? (desk && phone ? await clientByPhone(org.id, phone) : null);
  const knownLead = !client && desk && phone ? await openLeadByPhone(org.id, phone) : null;
  const memberPlan = client ? await db.servicePlan.findFirst({ where: { organizationId: org.id, clientId: client.id, status: "ACTIVE" }, select: { name: true } }) : null;
  const member = !!memberPlan;
  const scope = bookingScope(service, input.answers.map((a) => ({ label: a.label, value: a.value })), input.notes, channel);
  const when = slotLabel(slot, tz, settings.arrivalWindow);
  const priceText = member && service.memberPriceText ? service.memberPriceText : service.priceText;
  let manageToken = "";
  let bookedAppointmentId: string | null = null;
  await db.$transaction(async (tx) => {
    let leadId: string | null = knownLead?.id ?? null;
    if (!client && !leadId) {
      const lead = await tx.lead.create({
        data: { organizationId: org.id, name: input.name, email, phone, address: input.address?.trim() || null, projectType: service.label, description: scope, scope, source: desk ? "AI_DESK" : "BOOKING", status: "NEW", aiCategory: service.trade },
        select: { id: true },
      });
      leadId = lead.id;
    }
    const appt = await tx.appointment.create({
      data: {
        organizationId: org.id,
        clientId: client?.id ?? null,
        leadId,
        title: `${service.label} — ${input.name}`,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        status: "SCHEDULED",
        notes: [bookingNoteHead(channel, priceText, member ? memberPlan!.name : null), input.phone ? `Phone ${input.phone}` : null, input.address ? `Address ${input.address}` : null, "", scope].filter((x) => x !== null).join("\n"),
      },
      select: { id: true },
    });
    const booking = await tx.booking.create({
      data: { organizationId: org.id, appointmentId: appt.id, leadId, clientId: client?.id ?? null, serviceKey: service.key, serviceLabel: service.label, minutes: service.minutes, name: input.name, email, phone: input.phone?.trim() || null, address: input.address?.trim() || null, notes: input.notes?.trim() || null, answersJson: JSON.stringify(input.answers), member, startsAt: slot.startsAt, endsAt: slot.endsAt },
      select: { manageToken: true },
    });
    manageToken = booking.manageToken;
    bookedAppointmentId = appt.id;
    // How it was booked, beside the appointment (no schema change) — the
    // calendar reads it to tag the visit (lib/calendar/visitVia).
    const marker: AptSource = { channel, callSid: desk ? input.callSid?.trim().slice(0, 64) || null : null, at: now.toISOString() };
    await tx.syncState.upsert({ where: { key: aptSourceKey(appt.id) }, create: { key: aptSourceKey(appt.id), cursor: JSON.stringify(marker) }, update: { cursor: JSON.stringify(marker) } });
    const tail = member ? " · member" : knownLead ? " · lead on file" : leadId ? " · new lead" : "";
    const summary = desk ? `The AI desk booked ${input.name} for ${service.label.toLowerCase()} on a call — ${when}${tail}` : `${input.name} booked ${service.label.toLowerCase()} — ${when}${tail}`;
    await tx.activityEvent.create({ data: { organizationId: org.id, kind: "BOOKING_NEW", clientId: client?.id ?? null, leadId, summary, meta: JSON.stringify({ href: "/dashboard/booking", appointmentId: appt.id, channel }) } });
  });
  // The office hears about it by text (2026-09-29): "Booked: … · online."
  // A desk booking says so: "Booked: … · by the AI desk."
  if (bookedAppointmentId) {
    const id = bookedAppointmentId;
    afterResponse(() => textAppointmentBooked(id, null, desk ? "the AI desk" : "online"));
  }
  const manageHref = `${await appBaseUrl()}/book/manage/${manageToken}`;
  await emailCustomer(org, email, {
    subject: `Booked: ${service.label} — ${when}`,
    kicker: { text: "Your visit", tone: "ok" },
    headline: when,
    prose: [`Thank you, ${input.name.split(" ")[0]}. ${org.name ?? "We"} will be there for your ${service.label.toLowerCase()}.${settings.arrivalWindow ? ` The technician arrives inside that window and calls on the way.` : ""}`, `Price: ${priceText}.`],
    box: [{ type: "field", label: "Service", value: service.label }, ...(input.address ? [{ type: "field" as const, label: "Address", value: input.address }] : []), ...input.answers.filter((a) => a.value).map((a) => ({ type: "field" as const, label: a.label, value: a.value }))],
    cta: { label: "Change or cancel this visit", href: manageHref },
    after: ["Please make sure the equipment is reachable — the indoor unit, the outdoor unit and the electrical panel."],
  });
  return { ok: true, manageToken, when, serviceLabel: service.label, member, priceText, arrivalWindow: settings.arrivalWindow };
}

export async function bookingByToken(token: string) {
  return db.booking.findUnique({ where: { manageToken: token }, include: { organization: { select: ORG_SELECT }, appointment: { select: { id: true, status: true } } } });
}

export async function rescheduleBooking(token: string, startsAtISO: string, now = new Date()): Promise<{ ok: boolean; error?: string; when?: string }> {
  const b = await bookingByToken(token);
  if (!b || b.status === "CANCELED") return { ok: false, error: "This visit can no longer be changed." };
  const settings = settingsOf(b.organization);
  const service = settings.services.find((s) => s.key === b.serviceKey) ?? { key: b.serviceKey, label: b.serviceLabel, kind: "other" as const, minutes: b.minutes, priceText: "", trade: "" };
  const startsAt = new Date(startsAtISO);
  const days = await availabilityFor(b.organization, service, now);
  const slot = days.flatMap((d) => d.slots).find((s) => s.startsAt.getTime() === startsAt.getTime());
  if (!slot) return { ok: false, error: "That time is not open — pick another." };
  const tz = b.organization.timezone || "America/New_York";
  const when = slotLabel(slot, tz, settings.arrivalWindow);
  await db.$transaction(async (tx) => {
    await tx.booking.update({ where: { id: b.id }, data: { startsAt: slot.startsAt, endsAt: slot.endsAt, status: "RESCHEDULED", remindedAt: null } });
    if (b.appointmentId) await tx.appointment.update({ where: { id: b.appointmentId }, data: { startsAt: slot.startsAt, endsAt: slot.endsAt, status: "SCHEDULED" } });
    await tx.activityEvent.create({ data: { organizationId: b.organizationId, kind: "BOOKING_MOVED", clientId: b.clientId, leadId: b.leadId, summary: `${b.name} moved their ${b.serviceLabel.toLowerCase()} to ${when}`, meta: JSON.stringify({ href: "/dashboard/booking", appointmentId: b.appointmentId }) } });
  });
  if (b.appointmentId) {
    const id = b.appointmentId;
    const was = b.startsAt;
    afterResponse(() => textVisitMoved(id, was, null));
  }
  await emailCustomer(b.organization, b.email, { subject: `Moved: ${b.serviceLabel} — ${when}`, kicker: { text: "Your visit" }, headline: when, prose: [`Your ${b.serviceLabel.toLowerCase()} with ${b.organization.name ?? "us"} is now ${when}.`], cta: { label: "Change or cancel this visit", href: `${await appBaseUrl()}/book/manage/${b.manageToken}` } });
  return { ok: true, when };
}

export async function cancelBooking(token: string): Promise<{ ok: boolean }> {
  const b = await bookingByToken(token);
  if (!b || b.status === "CANCELED") return { ok: false };
  const visit = b.appointmentId ? await visitFacts(b.appointmentId).catch(() => null) : null;
  await db.$transaction(async (tx) => {
    await tx.booking.update({ where: { id: b.id }, data: { status: "CANCELED", canceledAt: new Date() } });
    if (b.appointmentId) await tx.appointment.update({ where: { id: b.appointmentId }, data: { status: "CANCELED" } });
    await tx.activityEvent.create({ data: { organizationId: b.organizationId, kind: "BOOKING_CANCELED", clientId: b.clientId, leadId: b.leadId, summary: `${b.name} canceled their ${b.serviceLabel.toLowerCase()}`, meta: JSON.stringify({ href: "/dashboard/booking" }) } });
  });
  afterResponse(() => textAppointmentCancelled(visit, null, "online"));
  await emailCustomer(b.organization, b.email, { subject: `Canceled: ${b.serviceLabel}`, kicker: { text: "Your visit" }, headline: "Your visit is canceled", prose: [`We have taken your ${b.serviceLabel.toLowerCase()} off the calendar. Book again any time.`], link: { label: "Book a visit", href: `${await appBaseUrl()}/book/${b.organization.slug}` } });
  return { ok: true };
}

/** The day before: one reminder to the customer. Runs from the daily cron. */
export async function runBookingReminders(now = new Date()): Promise<{ reminded: number }> {
  const soon = new Date(now.getTime() + 36 * 3600000);
  const rows = await db.booking.findMany({ where: { status: { in: ["BOOKED", "RESCHEDULED"] }, remindedAt: null, startsAt: { gte: now, lte: soon } }, include: { organization: { select: ORG_SELECT } } });
  let reminded = 0;
  for (const b of rows) {
    try {
      const settings = settingsOf(b.organization);
      const when = slotLabel({ startsAt: b.startsAt, endsAt: b.endsAt }, b.organization.timezone || "America/New_York", settings.arrivalWindow);
      await db.booking.update({ where: { id: b.id }, data: { remindedAt: now } });
      if (await emailCustomer(b.organization, b.email, { subject: `Tomorrow: ${b.serviceLabel} — ${when}`, kicker: { text: "Your visit" }, headline: when, prose: [`A reminder from ${b.organization.name ?? "us"}: your ${b.serviceLabel.toLowerCase()} is ${when}. The technician calls on the way.`], cta: { label: "Change or cancel", href: `${await appBaseUrl()}/book/manage/${b.manageToken}` } })) reminded++;
    } catch (err) {
      console.error(`[booking] reminder ${b.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { reminded };
}

// ── the office ──────────────────────────────────────────────────────────────

export interface BookingDashboard {
  settings: BookingSettings;
  trades: string[];
  link: string;
  slug: string;
  timeZone: string;
  upcoming: Array<{ id: string; when: Date; name: string; serviceLabel: string; member: boolean; status: string; phone: string | null; email: string | null; address: string | null; clientId: string | null; leadId: string | null; appointmentId: string | null; manageToken: string; answers: Array<{ label: string; value: string }>; notes: string | null }>;
  stats: { thisWeek: number; next30: number; services: number; allTime: number };
}

export async function loadBookingDashboard(organizationId: string, now = new Date()): Promise<BookingDashboard> {
  const [org, rows, allTime, appUrl] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId }, select: ORG_SELECT }),
    db.booking.findMany({ where: { organizationId, startsAt: { gte: new Date(now.getTime() - DAY) } }, orderBy: { startsAt: "asc" }, take: 60 }),
    db.booking.count({ where: { organizationId } }),
    appBaseUrl(),
  ]);
  if (!org) throw new Error("No organization");
  const settings = settingsOf(org);
  const week = new Date(now.getTime() + 7 * DAY);
  const month = new Date(now.getTime() + 30 * DAY);
  const live = rows.filter((b) => b.status !== "CANCELED");
  return {
    settings,
    trades: parseTradeTypes(org.tradeTypesJson),
    link: `${appUrl}/book/${org.slug}`,
    slug: org.slug,
    timeZone: org.timezone || "America/New_York",
    upcoming: rows.map((b) => ({ id: b.id, when: b.startsAt, name: b.name, serviceLabel: b.serviceLabel, member: b.member, status: b.status, phone: b.phone, email: b.email, address: b.address, clientId: b.clientId, leadId: b.leadId, appointmentId: b.appointmentId, manageToken: b.manageToken, answers: parseAnswers(b.answersJson), notes: b.notes })),
    stats: { thisWeek: live.filter((b) => b.startsAt <= week && b.startsAt >= now).length, next30: live.filter((b) => b.startsAt <= month && b.startsAt >= now).length, services: settings.services.length, allTime },
  };
}
const parseAnswers = (json: string): Array<{ label: string; value: string }> => {
  try {
    const v = JSON.parse(json) as Array<{ label?: string; value?: string }>;
    return Array.isArray(v) ? v.filter((a) => a && typeof a.label === "string" && typeof a.value === "string").map((a) => ({ label: a.label!, value: a.value! })) : [];
  } catch {
    return [];
  }
};

export async function saveSettings(organizationId: string, next: BookingSettings): Promise<void> {
  await db.organization.update({ where: { id: organizationId }, data: { bookingSettingsJson: JSON.stringify(next) } });
}
