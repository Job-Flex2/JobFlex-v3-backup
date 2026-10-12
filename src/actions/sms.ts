"use server";

// TEXT MESSAGES — the office's settings (2026-09-24).
//
// A member verifies a mobile with a six-digit code (the code is the
// consent); a manager adds extra office numbers (each gets a welcome text
// with the STOP line) and can pause or drop them; anyone can text
// themselves a test. JobFlex owns the Twilio account, so none of this
// touches a key — only phone numbers. docs/sms.md.

import { createHash, randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireManager, requireRouteAccess } from "@/lib/orgContext";
import { toE164 } from "@/lib/phone";
import { enforceRateLimit, HOUR, RateLimitError } from "@/lib/rateLimit";
import { isTwilioEnabled } from "@/lib/sdk/twilio";
import { leadTextsOnText, testText, welcomeText } from "@/lib/sms/format";
import { checkVerifyCode, sendVerifyCode } from "@/lib/sms/verify";
import { sendText, TRIAL_TEXT_MESSAGE } from "@/lib/sms/send";
import { refreshRegistration, releaseRegistration, submitRegistration } from "@/lib/sms/registration";
import type { SmsRegistrationDetails } from "@/lib/sms/registrationShared";
import { SMS_GROUPS, audienceForRole, parseNotificationPrefs, textEventsFor, type PrefCells, type PrefKey, type SmsGroupKey } from "@/lib/notificationPrefsShared";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";

const OFFICE_ROLES = ["OWNER", "ADMIN", "MANAGER"];

const SETTINGS_PATH = "/dashboard/settings";
const CODE_TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;
const MAX_EXTRA_NUMBERS = 10;
/** In PhoneVerification.codeHash: Twilio Verify holds this code (lib/sms/verify). */
const VERIFY_HELD = "verify";

export type SmsActionResult = { ok: true; note?: string } | { ok: false; error: string };

function hashCode(code: string, userId: string): string {
  return createHash("sha256").update(`${code}:${userId}`).digest("hex");
}

/** "(206) 555-0100" for a saved E.164 number. */
function pretty(e164: string): string {
  const d = e164.replace(/\D/g, "");
  return d.length === 11 && d.startsWith("1") ? `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}` : e164;
}

/** Step one: text a code to the number the member typed. */
export async function startPhoneVerification(raw: string): Promise<SmsActionResult> {
  const { user } = await requireRouteAccess("/dashboard/settings");
  const phone = toE164(raw);
  if (!phone) return { ok: false, error: "That doesn't look like a US or Canadian mobile number." };
  try {
    await enforceRateLimit(`sms-verify:${user.id}`, 5, HOUR, "verification texts");
  } catch (err) {
    if (err instanceof RateLimitError) return { ok: false, error: err.message };
    throw err;
  }
  if (await db.smsOptOut.findUnique({ where: { phone }, select: { phone: true } })) {
    return { ok: false, error: `${pretty(phone)} replied STOP to JobFlex texts. Text START to our number from that phone first.` };
  }
  // The code goes through Twilio Verify (2026-10-02, lib/sms/verify): JobFlex
  // has no registered number of its own. The row only remembers which phone
  // is being verified; Twilio holds the code ("verify" in place of a hash).
  await db.phoneVerification.deleteMany({ where: { userId: user.id } });
  const sent = await sendVerifyCode(phone);
  if (sent.ok) {
    await db.phoneVerification.create({ data: { userId: user.id, phone, codeHash: VERIFY_HELD, expiresAt: new Date(Date.now() + CODE_TTL_MS) } });
    return { ok: true, note: `Code sent to ${pretty(phone)}.` };
  }
  if (!sent.notConfigured) return { ok: false, error: `Couldn't send the code: ${sent.error}` };
  // Texting is not configured on this server (the local stand): our own code,
  // in the server log and only there, so the flow can still be walked.
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db.phoneVerification.create({ data: { userId: user.id, phone, codeHash: hashCode(code, user.id), expiresAt: new Date(Date.now() + CODE_TTL_MS) } });
  if (process.env.NODE_ENV !== "production") console.info(`[sms] verification code for …${phone.slice(-4)}: ${code}`);
  return { ok: true, note: "Texting is not set up on this server — the code is in the server log." };
}

/** Step two: the code came back — the number is verified, and that is the opt-in. */
export async function confirmPhoneVerification(rawCode: string): Promise<SmsActionResult> {
  const { user } = await requireRouteAccess("/dashboard/settings");
  const code = (rawCode ?? "").replace(/\D/g, "");
  if (code.length !== 6) return { ok: false, error: "Enter the six digits from the text." };
  const v = await db.phoneVerification.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });
  if (!v) return { ok: false, error: "Ask for a new code first." };
  if (v.expiresAt.getTime() < Date.now()) {
    await db.phoneVerification.delete({ where: { id: v.id } }).catch(() => null);
    return { ok: false, error: "That code expired. Ask for a new one." };
  }
  if (v.attempts >= MAX_ATTEMPTS) {
    await db.phoneVerification.delete({ where: { id: v.id } }).catch(() => null);
    return { ok: false, error: "Too many tries. Ask for a new code." };
  }
  let matched: boolean;
  if (v.codeHash === VERIFY_HELD) {
    const check = await checkVerifyCode(v.phone, code);
    if (!check.ok) return { ok: false, error: check.error };
    matched = check.approved;
  } else {
    matched = v.codeHash === hashCode(code, user.id);
  }
  if (!matched) {
    await db.phoneVerification.update({ where: { id: v.id }, data: { attempts: { increment: 1 } } });
    return { ok: false, error: `That's not the code. ${MAX_ATTEMPTS - v.attempts - 1} tries left.` };
  }
  await db.$transaction([
    db.user.update({ where: { id: user.id }, data: { smsPhone: v.phone, smsVerifiedAt: new Date() } }),
    db.phoneVerification.deleteMany({ where: { userId: user.id } }),
  ]);
  revalidatePath(SETTINGS_PATH);
  return { ok: true, note: `${pretty(v.phone)} is verified. The events ticked under Text will reach it.` };
}

/** Drop the mobile: no more texts to this member. */
export async function removeSmsPhone(): Promise<SmsActionResult> {
  const { user } = await requireRouteAccess("/dashboard/settings");
  await db.user.update({ where: { id: user.id }, data: { smsPhone: null, smsVerifiedAt: null } });
  await db.phoneVerification.deleteMany({ where: { userId: user.id } });
  revalidatePath(SETTINGS_PATH);
  return { ok: true };
}

/** An extra office number — the dispatcher, the spouse who runs the books. */
export async function addNotificationPhone(input: { name: string; phone: string }): Promise<SmsActionResult> {
  const { organizationId } = await requireManager();
  const name = (input.name ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  const phone = toE164(input.phone);
  if (!name) return { ok: false, error: "Give the number a name — who is this?" };
  if (!phone) return { ok: false, error: "That doesn't look like a US or Canadian number." };
  const count = await db.notificationPhone.count({ where: { organizationId } });
  if (count >= MAX_EXTRA_NUMBERS) return { ok: false, error: `Up to ${MAX_EXTRA_NUMBERS} extra numbers.` };
  if (await db.notificationPhone.findFirst({ where: { organizationId, phone }, select: { id: true } })) return { ok: false, error: "That number is already on the list." };
  await db.notificationPhone.create({ data: { organizationId, name, phone } });
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
  const r = await sendText({ organizationId, to: phone, body: welcomeText(org?.name ?? null), kind: "welcome" });
  revalidatePath(SETTINGS_PATH);
  if (!r.ok && r.reason === "opted-out") return { ok: true, note: `${name} added — but ${pretty(phone)} replied STOP to JobFlex texts earlier and won't get any until it texts START.` };
  return { ok: true, note: r.ok && r.status === "SENT" ? `${name} added and welcomed by text.` : `${name} added.` };
}

export async function setNotificationPhoneActive(id: string, active: boolean): Promise<SmsActionResult> {
  const { organizationId } = await requireManager();
  const row = await db.notificationPhone.findFirst({ where: { id, organizationId }, select: { id: true } });
  if (!row) return { ok: false, error: "Not found." };
  await db.notificationPhone.update({ where: { id }, data: { active } });
  revalidatePath(SETTINGS_PATH);
  return { ok: true };
}

export async function removeNotificationPhone(id: string): Promise<SmsActionResult> {
  const { organizationId } = await requireManager();
  const row = await db.notificationPhone.findFirst({ where: { id, organizationId }, select: { id: true } });
  if (!row) return { ok: false, error: "Not found." };
  await db.notificationPhone.delete({ where: { id } });
  revalidatePath(SETTINGS_PATH);
  return { ok: true };
}

/** "Send me a test text" — to the member's own verified mobile. */
export async function sendTestText(): Promise<SmsActionResult> {
  const { organizationId, user } = await requireRouteAccess("/dashboard/settings");
  const me = await db.user.findUnique({ where: { id: user.id }, select: { smsPhone: true, smsVerifiedAt: true } });
  if (!me?.smsPhone || !me.smsVerifiedAt) return { ok: false, error: "Verify a mobile first." };
  if (!await isTwilioEnabled()) return { ok: false, error: "Texting is not set up on this server." };
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
  const r = await sendText({ organizationId, to: me.smsPhone, body: testText(org?.name ?? null), kind: "test" });
  if (!r.ok) return { ok: false, error: r.reason === "duplicate" ? "A test just went out — give it a minute." : r.reason === "opted-out" ? "That number replied STOP." : r.reason === "trial" ? TRIAL_TEXT_MESSAGE : "Couldn't send. Try again in a moment." };
  return { ok: true, note: `Test text sent to ${pretty(me.smsPhone)}.` };
}

/** Client-facing texts on/off: the proposal link when sent, a reminder the evening before a visit. */
export async function setClientTextsOn(on: boolean): Promise<SmsActionResult> {
  const { organizationId } = await requireManager();
  await db.organization.update({ where: { id: organizationId }, data: { smsClientsOn: on } });
  revalidatePath(SETTINGS_PATH);
  return { ok: true, note: on ? "Clients get the proposal link and a reminder the evening before a visit." : "Clients are not texted." };
}

/**
 * "Get your texting number" (2026-10-02, lib/sms/registration): a toll-free
 * number bought on JobFlex's account and registered with Twilio in the
 * company's name. Paid plans only; JobFlex pays for it. It starts sending once
 * Twilio approves the business.
 */
export async function submitSmsRegistration(details: SmsRegistrationDetails): Promise<SmsActionResult> {
  const { organizationId, user } = await requireManager();
  const r = await submitRegistration(organizationId, user.id, details);
  revalidatePath(SETTINGS_PATH);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, note: r.state.stage === "approved" ? `${pretty(r.state.number ?? "")} is approved and sending.` : `${pretty(r.state.number ?? "")} is yours. Twilio is checking your business now; texts start when it approves.` };
}

/**
 * "Lead texts from JobFlex" (2026-10-02): JobFlex texts the company phone when
 * a lead is reserved for it — the opt-in the JobFlex number is registered on.
 * Only the one key changes in the stored leads settings; turning it on sends
 * the confirmation with the STOP and HELP words.
 */
export async function setLeadTexts(on: boolean): Promise<SmsActionResult> {
  const { organizationId, user } = await requireManager();
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { name: true, phone: true, leadsSettingsJson: true } });
  if (!org) return { ok: false, error: "Not found." };
  const phone = toE164(org.phone ?? "");
  if (on && !phone) return { ok: false, error: "Add the company phone (a US number that takes texts) in Company settings first." };
  let stored: Record<string, unknown> = {};
  try {
    const v: unknown = JSON.parse(org.leadsSettingsJson || "{}");
    if (v && typeof v === "object" && !Array.isArray(v)) stored = v as Record<string, unknown>;
  } catch {
    /* unreadable settings: start from nothing but this key */
  }
  await db.organization.update({ where: { id: organizationId }, data: { leadsSettingsJson: JSON.stringify({ ...stored, instantSms: on }) } });
  await logActivity({ organizationId, actorId: user.id, kind: TRAIL_KINDS.SETTINGS, summary: on ? "Turned on JobFlex's lead texts to the company phone" : "Turned off JobFlex's lead texts" });
  if (on && phone) await sendText({ organizationId: null, to: phone, body: leadTextsOnText(org.name), kind: "jobflex-lead-texts-on" });
  revalidatePath(SETTINGS_PATH);
  return { ok: true, note: on ? "Lead texts are on. JobFlex texts the company phone when a lead is reserved for you." : "Lead texts are off." };
}

/** Ask Twilio now instead of waiting for the hourly check. */
export async function checkSmsRegistration(): Promise<SmsActionResult> {
  const { organizationId } = await requireManager();
  const s = await refreshRegistration(organizationId, true);
  revalidatePath(SETTINGS_PATH);
  if (s.stage === "approved") return { ok: true, note: "Approved — your texts go out from your own number." };
  if (s.stage === "rejected") return { ok: true, note: "Twilio sent it back — see what it asks below." };
  return { ok: true, note: "Still with Twilio. It usually answers within a few days." };
}

export async function releaseSmsNumber(): Promise<SmsActionResult> {
  const { organizationId, user } = await requireManager();
  const r = await releaseRegistration(organizationId, user.id);
  revalidatePath(SETTINGS_PATH);
  return r.ok ? { ok: true, note: "Number released. Texts wait until you get a new one; your team gets its alerts by email and in the app." } : { ok: false, error: r.error };
}

/**
 * Settings → Texting → Who gets texted (2026-09-27, the owner's roster, the
 * way SmartSpace Pro does it): a manager switches a member's texts on or
 * off by group — crew on site, sales & leads, money. It writes the Text cell
 * of every event in the group on THAT member's stored matrix, which is what
 * `textOffice` already reads, so nothing else changes. Only office members
 * are on the roster: the office is who the texts are for.
 */
export async function setMemberTextGroups(userId: string, groups: Partial<Record<SmsGroupKey, boolean>>): Promise<SmsActionResult> {
  const { organizationId } = await requireManager();
  const m = await db.membership.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
    select: { role: true, user: { select: { id: true, notificationPrefsJson: true, smsPhone: true, smsVerifiedAt: true } } },
  });
  if (!m || !m.user) return { ok: false, error: "Not on the team." };
  if (!OFFICE_ROLES.includes(m.role)) return { ok: false, error: "Only the office is texted about the company's events." };
  const prefs = parseNotificationPrefs(m.user.notificationPrefsJson);
  const matrix = { ...prefs.matrix } as Record<PrefKey, PrefCells>;
  for (const g of SMS_GROUPS) {
    const on = groups[g.key];
    if (typeof on !== "boolean") continue;
    for (const key of g.keys) {
      const cells = matrix[key] ?? [true, false, false];
      matrix[key] = [cells[0], cells[1], on];
    }
  }
  await db.user.update({ where: { id: m.user.id }, data: { notificationPrefsJson: JSON.stringify({ ...prefs, matrix }) } });
  revalidatePath(SETTINGS_PATH);
  const anyOn = SMS_GROUPS.some((g) => g.keys.some((k) => matrix[k]?.[2]));
  const noPhone = !m.user.smsPhone || !m.user.smsVerifiedAt;
  return { ok: true, note: anyOn && noPhone ? "Saved — they will get texts once they verify a mobile (Settings → Texting on their account)." : "Saved." };
}

// ── the roster, person by person (2026-09-29) ──────────────────────────────
//
// Owner: "if I have managers I just add their name and phone number and the
// list of what they will receive". The owner (or a manager) types a member's
// mobile in; the member gets a welcome text with the STOP line — that text is
// the notice, and the trail records who added the number. A worker's number
// is the one the crew texts use (WorkerProfile.phone + smsOptIn), so it is
// written there too.

/** Who may be texted, and the row that holds their switches. */
async function memberFor(organizationId: string, userId: string) {
  const m = await db.membership.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
    select: { role: true, user: { select: { id: true, name: true, email: true, notificationPrefsJson: true, smsPhone: true, smsVerifiedAt: true } } },
  });
  if (!m?.user) return null;
  const audience = audienceForRole(m.role);
  if (!audience) return null;
  const worker = await db.workerProfile.findFirst({ where: { userId, organizationId }, select: { id: true, phone: true, smsOptIn: true } });
  // The number texts go to: the crew's is on its worker profile.
  const texted = audience === "crew" && worker ? Boolean(worker.phone && worker.smsOptIn) : Boolean(m.user.smsPhone && m.user.smsVerifiedAt);
  return { role: m.role, audience, user: m.user, workerId: worker?.id ?? null, texted };
}

export async function setMemberMobile(userId: string, raw: string): Promise<SmsActionResult> {
  const { organizationId, user: me } = await requireManager();
  const m = await memberFor(organizationId, userId);
  if (!m) return { ok: false, error: "Only the office, sales and crew can be texted." };
  const phone = toE164(raw);
  if (!phone) return { ok: false, error: "That doesn't look like a US or Canadian mobile number." };
  if (await db.smsOptOut.findUnique({ where: { phone }, select: { phone: true } })) {
    return { ok: false, error: `${pretty(phone)} replied STOP to JobFlex texts. They text START to our number from that phone first.` };
  }
  const prefs = parseNotificationPrefs(m.user.notificationPrefsJson, m.role);
  const now = new Date();
  await db.user.update({
    where: { id: userId },
    data: { smsPhone: phone, smsVerifiedAt: now, notificationPrefsJson: JSON.stringify({ ...prefs, smsAddedBy: me.id === userId ? null : me.id }) },
  });
  if (m.workerId) await db.workerProfile.update({ where: { id: m.workerId }, data: { phone, smsOptIn: true, smsOptedInAt: now } });
  const name = m.user.name?.trim() || m.user.email || "They";
  await logActivity({ organizationId, actorId: me.id, kind: TRAIL_KINDS.TEAM, summary: `Added ${name}'s mobile …${phone.slice(-4)} for job texts`, meta: { userId, texting: true } });
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
  const r = await sendText({ organizationId, to: phone, body: welcomeText(org?.name ?? null), kind: "welcome" });
  revalidatePath(SETTINGS_PATH);
  return { ok: true, note: r.ok && r.status === "SENT" ? `Saved — ${name} got a welcome text with the STOP line.` : `Saved for ${name}.` };
}

export async function clearMemberMobile(userId: string): Promise<SmsActionResult> {
  const { organizationId, user: me } = await requireManager();
  const m = await memberFor(organizationId, userId);
  if (!m) return { ok: false, error: "Not on the team." };
  const prefs = parseNotificationPrefs(m.user.notificationPrefsJson, m.role);
  await db.user.update({ where: { id: userId }, data: { smsPhone: null, smsVerifiedAt: null, notificationPrefsJson: JSON.stringify({ ...prefs, smsAddedBy: null }) } });
  if (m.workerId) await db.workerProfile.update({ where: { id: m.workerId }, data: { smsOptIn: false } });
  const name = m.user.name?.trim() || m.user.email || "They";
  await logActivity({ organizationId, actorId: me.id, kind: TRAIL_KINDS.TEAM, summary: `Stopped job texts to ${name}`, meta: { userId, texting: false } });
  revalidatePath(SETTINGS_PATH);
  return { ok: true, note: `${name} won't be texted.` };
}

/** One member's Text switches — only the events their roster shows. */
export async function setMemberTextEvents(userId: string, cells: Partial<Record<string, boolean>>): Promise<SmsActionResult> {
  const { organizationId } = await requireManager();
  const m = await memberFor(organizationId, userId);
  if (!m) return { ok: false, error: "Only the office, sales and crew can be texted." };
  const allowed = new Set(textEventsFor(m.audience).map((e) => e.key));
  const prefs = parseNotificationPrefs(m.user.notificationPrefsJson, m.role);
  const matrix = { ...prefs.matrix } as Record<PrefKey, PrefCells>;
  let changed = 0;
  for (const [key, on] of Object.entries(cells)) {
    if (typeof on !== "boolean" || !allowed.has(key as PrefKey)) continue;
    const prev = matrix[key as PrefKey] ?? [true, false, false];
    matrix[key as PrefKey] = [prev[0], prev[1], on];
    changed++;
  }
  if (!changed) return { ok: false, error: "Nothing to change." };
  await db.user.update({ where: { id: userId }, data: { notificationPrefsJson: JSON.stringify({ ...prefs, matrix }) } });
  revalidatePath(SETTINGS_PATH);
  return { ok: true, note: m.texted ? "Saved." : "Saved — add their mobile and these start going out." };
}

