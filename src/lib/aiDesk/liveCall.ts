// A LIVE CALL, served to the voice server — server only (the /api/desk routes call this).
//
//   callBrief   what the desk needs for this call: its instructions (the profile +
//               today's date and time, the caller's number, a client the shop knows by
//               it), its voice, the time cap
//   openTimes   the next open visits from the online-booking calendar, in words
//   bookVisit   one of them, booked the way the booking page books (lib/bookingBook)
//   takeMessage a lead with the caller's words, and the office told
//   finishCall  the transcript and outcome on the Phone page; the summary as before
import { db } from "@/lib/db";
import { toE164 } from "@/lib/phone";
import { availabilityFor, createBooking, settingsOf } from "@/lib/bookingBook";
import { slotLabel, type BookingService } from "@/lib/booking";
import { attachTranscript } from "@/lib/aiPhoneCalls";
import { logActivity } from "@/lib/activityLog";
import { companyFacts } from "./facts";
import { readDeskSettings } from "./numbers";
import { deskInstructions, profileFromFacts } from "./profile";
import { noteDeskUse } from "./usage";
import { deskBalanceFor, settleDeskUse } from "./minutes";

const ORG_SELECT = { id: true, name: true, slug: true, timezone: true, logoUrl: true, phone: true, billingEmail: true, gmailSettingsJson: true, gmailTokensJson: true, tradeTypesJson: true, bookingSettingsJson: true } as const;

/** How a call went, kept beside the call (SyncState `callout:<callSid>` — no schema change). */
export type CallOutcome = { outcome: "done" | "transfer" | "voicemail" | "failed"; appointmentId: string | null; seconds: number; messageTaken: boolean; at: string };

const outcomeKey = (callSid: string) => `callout:${callSid}`;

export async function readCallOutcome(callSid: string): Promise<CallOutcome | null> {
  const row = await db.syncState.findUnique({ where: { key: outcomeKey(callSid) }, select: { cursor: true } }).catch(() => null);
  if (!row) return null;
  try {
    return JSON.parse(row.cursor) as CallOutcome;
  } catch {
    return null;
  }
}

/** A client the shop knows by this number, for the desk to greet by name. */
async function knownCaller(organizationId: string, from: string): Promise<{ name: string; lastVisit: string | null } | null> {
  const e164 = toE164(from);
  if (!e164) return null;
  const tail = e164.slice(-7);
  const candidates = await db.client.findMany({ where: { organizationId, deletedAt: null, phone: { contains: tail } }, select: { id: true, name: true, phone: true }, take: 10 });
  const match = candidates.find((c) => toE164(c.phone ?? "") === e164);
  if (!match) return null;
  const last = await db.appointment.findFirst({ where: { organizationId, clientId: match.id }, orderBy: { startsAt: "desc" }, select: { title: true, startsAt: true } });
  return { name: match.name, lastVisit: last ? `${last.title} (${last.startsAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })})` : null };
}

export async function callBrief(t: { callSid: string; organizationId: string; from: string }): Promise<{ ok: true; instructions: string; voice: string; maxSeconds: number; callSid: string } | { ok: false; error: string }> {
  const [facts, settings, caller, balance] = await Promise.all([companyFacts(t.organizationId), readDeskSettings(t.organizationId), knownCaller(t.organizationId, t.from).catch(() => null), deskBalanceFor(t.organizationId).catch(() => null)]);
  if (!facts) return { ok: false, error: "no such company" };
  // Out of minutes: the webhook already routed the call elsewhere; this is the second lock.
  if (balance?.out) return { ok: false, error: "out of minutes" };
  const profile = settings.profile ?? profileFromFacts(facts);
  const nowWords = new Date().toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: facts.timezone });
  const extras = [
    `THIS CALL: it is ${nowWords} (${facts.timezone}). The caller's number is ${t.from}${caller ? `, which belongs to ${caller.name}, a client the company knows${caller.lastVisit ? ` (last visit: ${caller.lastVisit})` : ""} — greet them by name once they confirm it is them` : " — not a client the company knows yet"}.`,
    "Offer only times that open_times returns, and book only with book_visit. When the caller gives no other number, their phone is the number they are calling from.",
  ].join("\n");
  // A call is capped at ten minutes, or at what is left on the balance (a minute at least, so the desk can say so).
  const maxSeconds = balance ? Math.max(60, Math.min(600, balance.remainingSeconds)) : 600;
  return { ok: true, instructions: `${deskInstructions(profile, facts, settings.mode)}\n\n${extras}`, voice: settings.voice, maxSeconds, callSid: t.callSid };
}

type OrgRow = { id: string; name: string | null; slug: string; timezone: string; logoUrl: string | null; phone: string | null; billingEmail: string | null; gmailSettingsJson: string | null; gmailTokensJson: string | null; tradeTypesJson: string | null; bookingSettingsJson: string | null };

/** The booked service that fits the caller's words — an estimate unless they said repair, leak, no heat…; "other" for anything else. */
function serviceFor(services: BookingService[], words: string | null): BookingService | null {
  const w = (words ?? "").toLowerCase();
  const by = (pred: (s: BookingService) => boolean) => services.find(pred) ?? null;
  if (/leak|no (heat|cool|hot water|water)|broke|not working|repair|emergency|urgent|today/.test(w)) return by((s) => s.kind === "emergency" && !!s.urgent) ?? by((s) => s.kind === "diagnostic") ?? by((s) => s.kind === "estimate") ?? services[0] ?? null;
  if (/tune|maintenance|service/.test(w)) return by((s) => s.kind === "tune-up") ?? by((s) => s.kind === "estimate") ?? services[0] ?? null;
  return by((s) => s.kind === "estimate") ?? by((s) => s.kind === "consult") ?? by((s) => s.kind === "diagnostic") ?? services[0] ?? null;
}

export type OpenTime = { id: string; label: string; startsAt: string };

export async function openTimes(organizationId: string, serviceWords: string | null, days = 7, now = new Date()): Promise<{ ok: true; times: OpenTime[]; note: string; serviceKey: string } | { ok: false; error: string }> {
  const org = (await db.organization.findUnique({ where: { id: organizationId }, select: ORG_SELECT })) as OrgRow | null;
  if (!org) return { ok: false, error: "no such company" };
  const settings = settingsOf(org);
  if (!settings.enabled) return { ok: false, error: "The company does not book visits by phone right now — offer to take a message instead." };
  const service = serviceFor(settings.services, serviceWords);
  if (!service) return { ok: false, error: "No visit types are set up — offer to take a message." };
  const daysOut = await availabilityFor(org, service, now);
  const tz = org.timezone || "America/New_York";
  const times: OpenTime[] = [];
  for (const d of daysOut.slice(0, Math.max(1, Math.min(days, 14)))) {
    // Two a day — enough to offer without reading a list.
    for (const s of d.slots.slice(0, 2)) times.push({ id: `${service.key}|${s.startsAt.toISOString()}`, label: slotLabel(s, tz, settings.arrivalWindow), startsAt: s.startsAt.toISOString() });
    if (times.length >= 6) break;
  }
  if (!times.length) return { ok: false, error: "Nothing is open in that time — offer to take a message so the office can find a time." };
  return { ok: true, times, note: `${service.label} — ${service.priceText}${settings.arrivalWindow ? `, a ${settings.arrivalWindow / 60}-hour arrival window` : ""}.`, serviceKey: service.key };
}

export async function bookVisit(organizationId: string, callSid: string, input: { timeId: string; name: string; phone: string; address: string | null; notes: string | null }): Promise<{ ok: true; appointmentId: string; when: string; serviceLabel: string } | { ok: false; error: string }> {
  const org = (await db.organization.findUnique({ where: { id: organizationId }, select: ORG_SELECT })) as OrgRow | null;
  if (!org) return { ok: false, error: "no such company" };
  const [serviceKey, startsAtISO] = (input.timeId ?? "").split("|");
  if (!serviceKey || !startsAtISO) return { ok: false, error: "Pick one of the open times first." };
  const name = input.name.trim().slice(0, 80);
  if (!name) return { ok: false, error: "The caller's name is needed." };
  const phone = toE164(input.phone) ?? input.phone.trim().slice(0, 30);
  const r = await createBooking(org, { serviceKey, startsAtISO, name, phone, address: input.address?.trim().slice(0, 200) || null, notes: `Booked by the AI desk on a call${input.notes ? ` — ${input.notes.trim().slice(0, 300)}` : ""}`, answers: [] });
  if (!r.ok) return r;
  const appt = await db.booking.findUnique({ where: { manageToken: r.manageToken }, select: { appointmentId: true } });
  await db.aiPhoneCall.updateMany({ where: { callSid }, data: { summary: `Booked ${r.serviceLabel} — ${r.when}` } });
  return { ok: true, appointmentId: appt?.appointmentId ?? "", when: r.when, serviceLabel: r.serviceLabel };
}

export async function takeMessage(organizationId: string, callSid: string, input: { name: string; phone: string; about: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const name = input.name.trim().slice(0, 80) || "Caller";
  const phone = toE164(input.phone) ?? input.phone.trim().slice(0, 30);
  const about = input.about.trim().slice(0, 1000);
  const lead = await db.lead.create({ data: { organizationId, name, phone, description: about, source: "phone", status: "NEW" }, select: { id: true } });
  await db.aiPhoneCall.updateMany({ where: { callSid }, data: { leadId: lead.id, summary: `Message from ${name}: ${about.slice(0, 100)}` } });
  await logActivity({ organizationId, actorId: null, kind: "CREATED", summary: `The AI desk took a message from ${name} (${phone}): ${about.slice(0, 120)}`, leadId: lead.id });
  return { ok: true };
}

export async function finishCall(t: { callSid: string; organizationId: string }, input: { outcome: CallOutcome["outcome"]; transcript: Array<{ role: string; text: string }>; seconds: number; booked: { appointmentId: string } | null; messageTaken: boolean }): Promise<void> {
  const text = input.transcript.map((l) => `${l.role === "desk" ? "Desk" : "Caller"}: ${l.text}`).join("\n").slice(0, 20_000);
  const outcome: CallOutcome = { outcome: input.outcome, appointmentId: input.booked?.appointmentId ?? null, seconds: Math.max(0, Math.round(input.seconds)), messageTaken: input.messageTaken, at: new Date().toISOString() };
  const key = outcomeKey(t.callSid);
  await db.syncState.upsert({ where: { key }, create: { key, cursor: JSON.stringify(outcome) }, update: { cursor: JSON.stringify(outcome) } });
  await db.aiPhoneCall.updateMany({ where: { callSid: t.callSid, organizationId: t.organizationId }, data: { status: "COMPLETED", endedAt: new Date(), durationSeconds: outcome.seconds } });
  // The month's minutes (the settings card, the Phone page; the plan's allowance in step 5), and the spend.
  await noteDeskUse(t.organizationId, { callSeconds: outcome.seconds, calls: 1 }).catch(() => null);
  // Overage off the packs, auto top-up, the out-of-minutes notice (lib/aiDesk/minutes).
  await settleDeskUse(t.organizationId);
  void import("@/lib/trialMeter").then((m) => m.notePaidCall("openai", "realtime-minute", { units: Math.max(1, Math.ceil(outcome.seconds / 60)), orgId: t.organizationId })).catch(() => null);
  // The transcript on the Phone page, summarized as before; a lead only when the desk booked nothing and took no message.
  if (text) await attachTranscript(t.callSid, text, { lead: !input.booked && !input.messageTaken }).catch(() => null);
}
