"use server";

// ONLINE BOOKING — THE ACTIONS (2026-09-23). Public: what is open, book,
// move, cancel — keyed by the company's slug or the booking's manage token,
// rate-limited by address. Office: the settings, the services, the list.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireEstimatorOrManager, requireRouteAccess } from "@/lib/orgContext";
import { clientIp, enforceRateLimit, MINUTE, rateLimitShared } from "@/lib/rateLimit";
import { availabilityFor, bookingByToken, cancelBooking, createBooking, loadBookingDashboard, orgBySlug, rescheduleBooking, saveSettings, settingsOf, type BookingReceipt } from "@/lib/bookingBook";
import { defaultServicesFor, slotLabel, type BookingService, type BookingSettings } from "@/lib/booking";
import { parseTradeTypes } from "@/lib/tradeTypes";
import { recordTextConsent } from "@/lib/sms/consent";

export interface PublicDay {
  day: string;
  weekday: string;
  slots: Array<{ iso: string; label: string }>;
}

/** PUBLIC. The open slots for one service, as the customer reads them. */
export async function bookingAvailability(slug: string, serviceKey: string): Promise<{ ok: true; days: PublicDay[] } | { ok: false; error: string }> {
  const gate = await rateLimitShared(`booking-avail:${await clientIp()}`, 90, MINUTE);
  if (!gate.ok) return { ok: false, error: "Too many requests — try again in a minute." };
  const org = await orgBySlug(String(slug ?? "").slice(0, 80));
  if (!org) return { ok: false, error: "Not found." };
  const settings = settingsOf(org);
  const service = settings.services.find((s) => s.key === serviceKey);
  if (!service || !settings.enabled) return { ok: false, error: "That service is not open for booking." };
  const tz = org.timezone || "America/New_York";
  const days = await availabilityFor(org, service);
  return { ok: true, days: days.map((d) => ({ day: d.day, weekday: d.weekday, slots: d.slots.map((s) => ({ iso: s.startsAt.toISOString(), label: s.startsAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz }) + (settings.arrivalWindow ? `–${new Date(s.startsAt.getTime() + settings.arrivalWindow * 60000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz })}` : "") })) })) };
}

const bookInput = z.object({
  serviceKey: z.string().min(1).max(60),
  startsAtISO: z.string().min(10).max(40),
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(160).optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional(),
  address: z.string().trim().max(240).optional(),
  notes: z.string().trim().max(1500).optional(),
  /** "Text me about my visit and estimate" (2026-10-02, lib/sms/consent). */
  smsOk: z.boolean().optional(),
  answers: z.array(z.object({ key: z.string().max(40), label: z.string().max(120), value: z.string().max(200) })).max(8).default([]),
});

/** PUBLIC. Book the visit. */
export async function createBookingPublic(slug: string, raw: unknown): Promise<BookingReceipt | { ok: false; error: string }> {
  const parsed = bookInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Please check your name, email and the time." };
  await enforceRateLimit(`booking:${await clientIp()}`, 6, 10 * MINUTE, "bookings");
  const org = await orgBySlug(String(slug ?? "").slice(0, 80));
  if (!org) return { ok: false, error: "Not found." };
  const { smsOk, ...booking } = parsed.data;
  const r = await createBooking(org, { ...booking, email: booking.email || null });
  if (r.ok) {
    // The client's yes to texts, kept for the company's own number (lib/sms/consent).
    if (smsOk && booking.phone) await recordTextConsent(org.id, booking.phone, { source: "booking", name: booking.name }).catch(() => false);
    revalidatePath("/dashboard/booking");
    revalidatePath("/dashboard/calendar");
    revalidatePath("/dashboard/leads");
  }
  return r;
}

/** PUBLIC. The visit behind a manage link, as the customer reads it. */
export async function bookingForManage(token: string): Promise<{ ok: true; name: string; serviceLabel: string; serviceKey: string; when: string; status: string; orgName: string; slug: string } | { ok: false }> {
  const b = await bookingByToken(String(token ?? "").slice(0, 80));
  if (!b) return { ok: false };
  const settings = settingsOf(b.organization);
  return { ok: true, name: b.name, serviceLabel: b.serviceLabel, serviceKey: b.serviceKey, when: slotLabel({ startsAt: b.startsAt, endsAt: b.endsAt }, b.organization.timezone || "America/New_York", settings.arrivalWindow), status: b.status, orgName: b.organization.name ?? "Your contractor", slug: b.organization.slug };
}

export async function rescheduleBookingPublic(token: string, startsAtISO: string): Promise<{ ok: boolean; error?: string; when?: string }> {
  await enforceRateLimit(`booking-move:${await clientIp()}`, 10, 10 * MINUTE, "changes");
  const r = await rescheduleBooking(String(token ?? "").slice(0, 80), String(startsAtISO ?? ""));
  if (r.ok) {
    revalidatePath("/dashboard/booking");
    revalidatePath("/dashboard/calendar");
  }
  return r;
}

export async function cancelBookingPublic(token: string): Promise<{ ok: boolean }> {
  await enforceRateLimit(`booking-move:${await clientIp()}`, 10, 10 * MINUTE, "changes");
  const r = await cancelBooking(String(token ?? "").slice(0, 80));
  if (r.ok) {
    revalidatePath("/dashboard/booking");
    revalidatePath("/dashboard/calendar");
  }
  return r;
}

/** PUBLIC. Availability for a manage-page move (same rules as booking). */
export async function availabilityForToken(token: string): Promise<{ ok: true; days: PublicDay[]; slug: string } | { ok: false }> {
  const b = await bookingByToken(String(token ?? "").slice(0, 80));
  if (!b) return { ok: false };
  const r = await bookingAvailability(b.organization.slug, b.serviceKey);
  return r.ok ? { ok: true, days: r.days, slug: b.organization.slug } : { ok: false };
}

// ── the office ──────────────────────────────────────────────────────────────

async function currentSettings(organizationId: string): Promise<BookingSettings> {
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { tradeTypesJson: true, bookingSettingsJson: true } });
  if (!org) throw new Error("No organization");
  return settingsOf(org);
}

const hoursInput = z.object({ open: z.string().regex(/^\d{2}:\d{2}$/), close: z.string().regex(/^\d{2}:\d{2}$/) });

/** Hours, slots, lead time, crews, arrival window, intro. Form-driven. */
export async function saveBookingSettings(fd: FormData): Promise<void> {
  const { organizationId } = await requireEstimatorOrManager();
  await requireRouteAccess("/dashboard/booking");
  const cur = await currentSettings(organizationId);
  const hours = cur.hours.map((_, i) => {
    if (fd.get(`closed_${i}`) === "on") return null;
    const p = hoursInput.safeParse({ open: String(fd.get(`open_${i}`) ?? ""), close: String(fd.get(`close_${i}`) ?? "") });
    return p.success && p.data.open < p.data.close ? p.data : cur.hours[i];
  });
  const num = (k: string, lo: number, hi: number, d: number) => {
    const n = Number(fd.get(k));
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d;
  };
  const next: BookingSettings = {
    ...cur,
    enabled: fd.get("enabled") === "on",
    hours,
    slotMinutes: num("slotMinutes", 15, 240, cur.slotMinutes),
    leadHours: num("leadHours", 0, 168, cur.leadHours),
    horizonDays: num("horizonDays", 3, 60, cur.horizonDays),
    crews: num("crews", 1, 20, cur.crews),
    arrivalWindow: num("arrivalWindow", 0, 480, cur.arrivalWindow),
    intro: String(fd.get("intro") ?? "").trim().slice(0, 400) || undefined,
  };
  await saveSettings(organizationId, next);
  revalidatePath("/dashboard/booking");
}

const serviceInput = z.object({
  key: z.string().trim().max(60).optional(),
  label: z.string().trim().min(2).max(80),
  kind: z.enum(["diagnostic", "tune-up", "emergency", "estimate", "consult", "other"]),
  minutes: z.coerce.number().int().min(15).max(480),
  priceText: z.string().trim().max(80),
  memberPriceText: z.string().trim().max(80).optional(),
  description: z.string().trim().max(300).optional(),
  questions: z.string().max(1500).optional(),
  urgent: z.coerce.boolean().optional(),
  trade: z.string().trim().max(40).optional(),
});

/** One bookable service, new or edited: "Question? | option, option" lines become its questions. Form-driven. */
export async function saveBookingService(fd: FormData): Promise<void> {
  const { organizationId } = await requireEstimatorOrManager();
  await requireRouteAccess("/dashboard/booking");
  const raw: Record<string, unknown> = {};
  fd.forEach((v, k) => {
    if (typeof v === "string") raw[k] = v;
  });
  const data = serviceInput.parse({ ...raw, urgent: raw.urgent === "on" });
  const cur = await currentSettings(organizationId);
  const questions = (data.questions ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 6)
    .map((l, i) => {
      const [label, opts] = l.split("|").map((s) => s.trim());
      const options = opts ? opts.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 10) : undefined;
      return { key: `q${i + 1}`, label: label.slice(0, 120), ...(options && options.length ? { options } : {}) };
    });
  const key = data.key || data.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || `svc-${Date.now()}`;
  const svc: BookingService = { key, label: data.label, kind: data.kind, minutes: data.minutes, priceText: data.priceText || "We'll confirm", memberPriceText: data.memberPriceText || undefined, description: data.description || undefined, questions: questions.length ? questions : undefined, urgent: !!data.urgent || data.kind === "emergency", trade: data.trade || cur.services.find((s) => s.key === key)?.trade || "General" };
  const services = cur.services.some((s) => s.key === key) ? cur.services.map((s) => (s.key === key ? svc : s)) : [...cur.services, svc];
  await saveSettings(organizationId, { ...cur, services });
  revalidatePath("/dashboard/booking");
}

export async function removeBookingService(key: string): Promise<void> {
  const { organizationId } = await requireEstimatorOrManager();
  await requireRouteAccess("/dashboard/booking");
  const cur = await currentSettings(organizationId);
  await saveSettings(organizationId, { ...cur, services: cur.services.filter((s) => s.key !== key) });
  revalidatePath("/dashboard/booking");
}

/** Back to the smart defaults for the shop's trades. */
export async function resetBookingServices(): Promise<void> {
  const { organizationId } = await requireEstimatorOrManager();
  await requireRouteAccess("/dashboard/booking");
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { tradeTypesJson: true, bookingSettingsJson: true } });
  if (!org) return;
  const cur = settingsOf(org);
  await saveSettings(organizationId, { ...cur, services: defaultServicesFor(parseTradeTypes(org.tradeTypesJson)) });
  revalidatePath("/dashboard/booking");
}

export async function markBookingDone(id: string): Promise<void> {
  const { organizationId } = await requireEstimatorOrManager();
  await requireRouteAccess("/dashboard/booking");
  const b = await db.booking.findFirst({ where: { id, organizationId }, select: { id: true, appointmentId: true } });
  if (!b) return;
  await db.$transaction(async (tx) => {
    await tx.booking.update({ where: { id: b.id }, data: { status: "DONE" } });
    if (b.appointmentId) await tx.appointment.update({ where: { id: b.appointmentId }, data: { status: "COMPLETED" } });
  });
  revalidatePath("/dashboard/booking");
}

export async function cancelBookingOffice(id: string): Promise<void> {
  const { organizationId } = await requireEstimatorOrManager();
  await requireRouteAccess("/dashboard/booking");
  const b = await db.booking.findFirst({ where: { id, organizationId }, select: { manageToken: true } });
  if (!b) return;
  await cancelBooking(b.manageToken);
  revalidatePath("/dashboard/booking");
  revalidatePath("/dashboard/calendar");
}

export type { BookingDashboard } from "@/lib/bookingBook";
export { loadBookingDashboard };
