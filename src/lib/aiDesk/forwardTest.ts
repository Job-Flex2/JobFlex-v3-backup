import "server-only";
// THE FORWARDING CHECK, server half (lib/aiDesk/forwardCheck is the pure half): where the result is kept (one
// SyncState row per company — no schema change), the desk's number, and the test call itself. The call is placed
// with Twilio's REST API from the desk's own number to the business phone; Twilio then asks
// /api/twilio/voice/forward-test what to say when it is answered and reports how it ended to …/forward-test/status.
// TWILIO_API_BASE points it at a stand-in outside production.
import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import { toE164 } from "@/lib/phone";
import { twilioSettings } from "@/lib/sdk/twilio";
import { readRegistration } from "@/lib/sms/registration";
import { numbersAssignedTo, readDeskSettings } from "./numbers";
import { forwardCheckView, isForwardedCustomerCall, isForwardTestCall, TEST_RING_SECONDS, testArrivedTwiml, type ForwardCheck, type ForwardHow, type ForwardStatus } from "./forwardCheck";

const KEY = (orgId: string) => `deskfwd:${orgId}`;

export async function readForwardCheck(orgId: string): Promise<ForwardCheck | null> {
  const row = await db.syncState.findUnique({ where: { key: KEY(orgId) }, select: { cursor: true } }).catch(() => null);
  if (!row) return null;
  try {
    const v = JSON.parse(row.cursor) as ForwardCheck;
    return v && typeof v === "object" && typeof v.status === "string" ? v : null;
  } catch {
    return null;
  }
}

async function writeForwardCheck(orgId: string, c: ForwardCheck): Promise<void> {
  const cursor = JSON.stringify(c);
  await db.syncState.upsert({ where: { key: KEY(orgId) }, create: { key: KEY(orgId), cursor }, update: { cursor } });
}

/** Move the running test (by id) to its result; a newer test or a finished one is left alone. */
export async function settleForwardTest(orgId: string, testId: string, status: ForwardStatus, error?: string): Promise<ForwardCheck | null> {
  const c = await readForwardCheck(orgId);
  if (!c || c.id !== testId || c.status !== "calling") return c;
  const next: ForwardCheck = { ...c, status, at: Date.now(), ...(error ? { error } : {}) };
  await writeForwardCheck(orgId, next);
  return next;
}

/** The number the desk answers for this company: its own, else the line JobFlex assigned it. E.164 or null. */
export async function deskNumberFor(orgId: string): Promise<string | null> {
  const [reg, assigned] = await Promise.all([readRegistration(orgId).catch(() => null), numbersAssignedTo(orgId).catch(() => [] as string[])]);
  return toE164(reg?.number ?? "") ?? toE164(assigned[0] ?? "") ?? null;
}

/** The check as it stands for the company now (null: none for this forwarding / phone / number). */
export async function currentForwardCheck(orgId: string): Promise<ForwardCheck | null> {
  const [c, desk, org, deskNumber] = await Promise.all([
    readForwardCheck(orgId),
    readDeskSettings(orgId),
    db.organization.findUnique({ where: { id: orgId }, select: { phone: true } }).catch(() => null),
    deskNumberFor(orgId),
  ]);
  return forwardCheckView(c, { forwarding: desk.forwarding, phone: toE164(org?.phone ?? ""), desk: deskNumber });
}

/** The owner says it works (or doesn't) — they called it themselves. */
export async function noteForwardCheck(orgId: string, kind: "all" | "missed", phone: string, desk: string, status: ForwardStatus, how: ForwardHow): Promise<ForwardCheck> {
  const c: ForwardCheck = { id: randomBytes(6).toString("hex"), status, how, kind, phone, desk, startedAt: Date.now(), at: Date.now() };
  await writeForwardCheck(orgId, c);
  return c;
}

/** Twilio's REST API, one call: from the desk's number to the business phone. */
async function placeCall(input: { to: string; from: string; url: string; statusCallback: string; timeout: number }): Promise<string> {
  const s = await twilioSettings();
  if (!s) throw new Error("Calls aren't set up on JobFlex yet.");
  const base = (process.env.NODE_ENV !== "production" && process.env.TWILIO_API_BASE?.trim()) || "https://api.twilio.com";
  const body = new URLSearchParams({ To: input.to, From: input.from, Url: input.url, Method: "POST", StatusCallback: input.statusCallback, StatusCallbackMethod: "POST", Timeout: String(input.timeout) });
  body.append("StatusCallbackEvent", "completed");
  const res = await fetch(`${base.replace(/\/$/, "")}/2010-04-01/Accounts/${s.accountSid}/Calls.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${s.accountSid}:${s.authToken}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  const j = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
  if (!res.ok || !j.sid) throw new Error(j.message ? `Twilio: ${j.message}` : `Twilio refused the call (HTTP ${res.status}).`);
  return j.sid;
}

/** Start the test call. The page polls currentForwardCheck for the result. */
export async function startForwardTest(orgId: string, base: string): Promise<{ ok: true; check: ForwardCheck } | { ok: false; error: string }> {
  const [desk, org, deskNumber] = await Promise.all([
    readDeskSettings(orgId),
    db.organization.findUnique({ where: { id: orgId }, select: { phone: true } }),
    deskNumberFor(orgId),
  ]);
  const phone = toE164(org?.phone ?? "");
  if (desk.forwarding === "none") return { ok: false, error: "Pick how your number forwards to the desk first." };
  if (!deskNumber) return { ok: false, error: "The desk needs its number first." };
  if (!phone) return { ok: false, error: "Add your business phone first — that's the number the test calls." };
  if (phone === deskNumber) return { ok: false, error: "Your business phone is the desk's own number — there's nothing to forward." };
  const kind = desk.forwarding;
  const check: ForwardCheck = { id: randomBytes(6).toString("hex"), status: "calling", how: "test", kind, phone, desk: deskNumber, startedAt: Date.now(), at: Date.now() };
  await writeForwardCheck(orgId, check);
  const q = `?o=${encodeURIComponent(orgId)}&t=${check.id}`;
  try {
    await placeCall({ to: phone, from: deskNumber, url: `${base}/api/twilio/voice/forward-test${q}`, statusCallback: `${base}/api/twilio/voice/forward-test/status${q}`, timeout: TEST_RING_SECONDS[kind] });
  } catch (err) {
    const error = err instanceof Error ? err.message : "The test call could not be placed.";
    await settleForwardTest(orgId, check.id, "failed", error);
    return { ok: false, error };
  }
  return { ok: true, check };
}

/**
 * On every call to a desk number (lib/aiDesk/calls): our own test arriving back → its TwiML (and the check marked
 * working); a customer's call the carrier marks as forwarded from the business phone → marked working, and the call
 * goes on as usual (null). Never throws — a check must not cost a real call.
 */
export async function forwardingOnInbound(org: { id: string; phone: string | null }, call: { from: string; to: string; forwardedFrom?: string | null }): Promise<string | null> {
  try {
    const c = await readForwardCheck(org.id);
    const at = Date.now();
    if (isForwardTestCall(c, { ...call, at })) {
      await settleForwardTest(org.id, c!.id, "works");
      return testArrivedTwiml();
    }
    if (call.forwardedFrom && isForwardedCustomerCall(call, toE164(org.phone ?? ""), call.to)) {
      const desk = await readDeskSettings(org.id);
      if (desk.forwarding !== "none" && !(c?.status === "works" && c.kind === desk.forwarding)) {
        await noteForwardCheck(org.id, desk.forwarding, toE164(org.phone ?? "") ?? "", toE164(call.to) ?? call.to, "works", "call");
      }
    }
  } catch (err) {
    console.warn("[aiDesk] forwarding check skipped:", err instanceof Error ? err.message : err);
  }
  return null;
}
