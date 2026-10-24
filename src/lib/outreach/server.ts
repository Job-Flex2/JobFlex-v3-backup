// JOBFLEX'S OUTREACH CALLS, SERVER SIDE (2026-10-23) — server only. The list (lib/outreach/store), the line check
// (Twilio's lookup: landline or not), the call itself (Twilio's REST API from JobFlex's number, its answering-machine
// check; a person gets the AI desk's voice server on JobFlex's own script, a machine a short voicemail), what the call
// may do (email the trial link, note how it went, never call again), how it ended, the one email to the contractors
// the AI may not call, and the "Have the AI desk call me" request that is their consent. Who may be called when is
// lib/outreach/rules; the words are lib/outreach/script and ./letter.
import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { toE164, isUsCanadaNumber } from "@/lib/phone";
import { twilioSettings } from "@/lib/sdk/twilio";
import { jobflexSender } from "@/lib/sms/jobflexSender";
import { getPlanCatalog } from "@/lib/planCatalogServer";
import { formatPlanPrice } from "@/lib/planCatalog";
import { signCallToken, voiceServerConfigured, voiceStreamUrl, type CallToken } from "@/lib/aiDesk/voiceToken";
import { isEmailEnabled, sendEmail } from "@/lib/sdk/resend";
import { readOptOut, unsubscribeHeaders, unsubscribeUrl } from "@/lib/adminMail/optout";
import { fromLine } from "@/lib/adminMail/server";
import { logServerError } from "@/lib/server-events";
import {
  OUTREACH_CONSENT_TEXT,
  callableNow,
  lineTypeOf,
  parseProspectList,
  routeFor,
  stateCode,
  tradeKey,
  twilioWords,
  type CallStatus,
  type LineType,
  type Outcome,
  type OutreachCall,
  type Prospect,
} from "./rules";
import { outreachInstructions, outreachTools, outreachVoicemail, type ScriptFacts } from "./script";
import { outreachLetter } from "./letter";
import { listProspects, newProspectId, optOutId, readProspect, updateProspect, writeProspect } from "./store";

/** The company a call token names for these calls: none — JobFlex itself. */
export const OUTREACH_ORG = "jobflex-outreach";
/** Emails a day at most: a first email to a stranger is judged by how few go out at once. */
export const EMAILS_PER_DAY = 40;
const nowIso = () => new Date().toISOString();
const SITE = "jobflex.app";

/** The caller id: TWILIO_SALES_FROM (a local number answers better), else JobFlex's own line. */
export async function outreachFrom(): Promise<string | null> {
  const env = process.env.TWILIO_SALES_FROM?.trim();
  if (env) return toE164(env) ?? env;
  return jobflexSender().catch(() => null);
}
const transferTo = () => toE164(process.env.OUTREACH_TRANSFER_TO ?? "");
const postal = () => process.env.JOBFLEX_POSTAL_ADDRESS?.trim() || null;

export interface OutreachReadiness {
  calls: boolean;
  emails: boolean;
  /** What is missing, in words, for the page. */
  missing: string[];
  from: string | null;
  transfer: boolean;
}

export async function outreachReadiness(): Promise<OutreachReadiness> {
  const [tw, from] = await Promise.all([twilioSettings().catch(() => null), outreachFrom()]);
  const missing: string[] = [];
  if (!tw) missing.push("Twilio isn't connected (Admin → Texting).");
  if (!voiceServerConfigured()) missing.push("The AI desk's voice server isn't connected (VOICE_SERVER_URL and VOICE_SERVER_SECRET).");
  if (!from) missing.push("No number to call from: set TWILIO_SALES_FROM to a JobFlex Twilio number (a local one answers best).");
  const emailsOk = isEmailEnabled() && !!postal();
  if (!isEmailEnabled()) missing.push("Email isn't set up on this server.");
  if (!postal()) missing.push("Emails need JobFlex's postal address in their footer — the email law asks for it in every email like this. Set JOBFLEX_POSTAL_ADDRESS (a street address or a PO box).");
  return { calls: !!tw && voiceServerConfigured() && !!from, emails: emailsOk, missing, from, transfer: !!transferTo() };
}

/* ── The list ─────────────────────────────────────────────────────────── */

function blank(row: Partial<Prospect>, source: Prospect["source"]): Prospect {
  const at = nowIso();
  return {
    id: newProspectId(),
    name: row.name ?? "",
    business: row.business ?? "",
    phone: row.phone ?? null,
    email: row.email ?? null,
    trade: row.trade ?? null,
    state: row.state ?? null,
    city: row.city ?? null,
    source,
    line: null,
    consent: null,
    dnc: null,
    calls: [],
    emailedAt: null,
    interest: null,
    linkSentAt: null,
    linkSentTo: null,
    createdAt: at,
    updatedAt: at,
  };
}

/** A pasted list in: new contractors added, ones already on it filled in, ones already on JobFlex left out. */
export async function importProspects(text: string): Promise<{ added: number; merged: number; skipped: number; onJobflex: number }> {
  const { rows, skipped } = parseProspectList(text);
  const list = await listProspects();
  const byPhone = new Map(list.filter((p) => p.phone).map((p) => [p.phone!, p]));
  const byEmail = new Map(list.filter((p) => p.email).map((p) => [p.email!, p]));
  // Already a JobFlex customer: a user with that email, or a company with that phone.
  const emails = rows.map((r) => r.email).filter((e): e is string => !!e);
  const phones = rows.map((r) => r.phone).filter((p): p is string => !!p);
  const [users, orgs] = await Promise.all([
    emails.length ? db.user.findMany({ where: { email: { in: emails } }, select: { email: true } }) : Promise.resolve([]),
    phones.length ? db.organization.findMany({ where: { phone: { in: [...phones, ...phones.map((p) => p.slice(2))] } }, select: { phone: true } }) : Promise.resolve([]),
  ]);
  const customerEmails = new Set(users.map((u) => u.email.toLowerCase()));
  const customerPhones = new Set(orgs.map((o) => toE164(o.phone ?? "")).filter(Boolean));
  let added = 0;
  let merged = 0;
  let onJobflex = 0;
  const fresh: Prospect[] = [];
  for (const r of rows) {
    if ((r.email && customerEmails.has(r.email)) || (r.phone && customerPhones.has(r.phone))) {
      onJobflex++;
      continue;
    }
    const had = (r.phone && byPhone.get(r.phone)) || (r.email && byEmail.get(r.email)) || null;
    if (had) {
      await writeProspect({ ...had, name: had.name || r.name, business: had.business || r.business, email: had.email ?? r.email, phone: had.phone ?? r.phone, trade: had.trade ?? r.trade, state: had.state ?? r.state, city: had.city ?? r.city });
      merged++;
      continue;
    }
    fresh.push(blank(r, "list"));
    added++;
  }
  if (fresh.length) await db.syncState.createMany({ data: fresh.map((p) => ({ key: `outreach:p:${p.id}`, cursor: JSON.stringify(p) })) });
  return { added, merged, skipped, onJobflex };
}

/* ── The line check ──────────────────────────────────────────────────── */

async function lookupLine(e164: string): Promise<{ type: LineType; carrier: string | null }> {
  const s = await twilioSettings();
  if (!s) throw new Error("Twilio isn't connected.");
  const base = (process.env.NODE_ENV !== "production" && process.env.TWILIO_LOOKUP_BASE?.trim()) || "https://lookups.twilio.com";
  const res = await fetch(`${base.replace(/\/$/, "")}/v2/PhoneNumbers/${encodeURIComponent(e164)}?Fields=line_type_intelligence`, {
    headers: { Authorization: `Basic ${Buffer.from(`${s.accountSid}:${s.authToken}`).toString("base64")}` },
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  const j = (await res.json().catch(() => ({}))) as { line_type_intelligence?: { type?: string; carrier_name?: string } | null; message?: string };
  if (!res.ok) throw new Error(j.message ? `Twilio: ${j.message}` : `Twilio's lookup answered ${res.status}.`);
  return { type: lineTypeOf(j.line_type_intelligence?.type), carrier: j.line_type_intelligence?.carrier_name?.slice(0, 80) ?? null };
}

/** Which numbers are landlines: `limit` unchecked numbers at a time (each lookup is a fraction of a cent). */
export async function checkLines(limit = 50): Promise<{ checked: number; failed: number; left: number; error: string | null }> {
  const todo = (await listProspects()).filter((p) => p.phone && !p.line && !p.dnc && isUsCanadaNumber(p.phone));
  let checked = 0;
  let failed = 0;
  let error: string | null = null;
  for (const p of todo.slice(0, Math.max(1, Math.min(200, limit)))) {
    try {
      const line = await lookupLine(p.phone!);
      await writeProspect({ ...p, line: { ...line, at: nowIso() } });
      checked++;
    } catch (err) {
      failed++;
      error = err instanceof Error ? err.message : String(err);
      if (failed >= 3 && !checked) break;
    }
  }
  return { checked, failed, left: Math.max(0, todo.length - checked), error };
}

/* ── The call ─────────────────────────────────────────────────────────── */

async function placeCall(input: { to: string; from: string; url: string; statusCallback: string }): Promise<string> {
  const s = await twilioSettings();
  if (!s) throw new Error("Twilio isn't connected.");
  const base = (process.env.NODE_ENV !== "production" && process.env.TWILIO_API_BASE?.trim()) || "https://api.twilio.com";
  // DetectMessageEnd: a person is told apart in a second or two; a machine is answered after its beep.
  const body = new URLSearchParams({ To: input.to, From: input.from, Url: input.url, Method: "POST", StatusCallback: input.statusCallback, StatusCallbackMethod: "POST", Timeout: "25", MachineDetection: "DetectMessageEnd" });
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

const lastCall = (p: Prospect): OutreachCall | null => p.calls[p.calls.length - 1] ?? null;
function withLastCall(p: Prospect, change: Partial<OutreachCall>): Prospect {
  const calls = p.calls.slice();
  if (calls.length) calls[calls.length - 1] = { ...calls[calls.length - 1], ...change };
  return { ...p, calls };
}

/** Call one contractor now — if the rules allow it. */
export async function callProspect(id: string, base: string): Promise<{ ok: true; sid: string } | { ok: false; error: string }> {
  const p = await readProspect(id);
  if (!p) return { ok: false, error: "That contractor isn't on the list." };
  const may = callableNow(p, new Date());
  if (!may.ok) return { ok: false, error: may.why };
  const ready = await outreachReadiness();
  if (!ready.calls || !ready.from) return { ok: false, error: ready.missing.find((m) => !/mail|postal/i.test(m)) ?? "Calls aren't set up." };
  const call: OutreachCall = { sid: null, at: nowIso(), status: "calling", seconds: 0, answeredBy: null, outcome: null, summary: null, transcript: null, error: null };
  await writeProspect({ ...p, calls: [...p.calls, call] });
  const q = `?p=${encodeURIComponent(id)}`;
  try {
    const sid = await placeCall({ to: p.phone!, from: ready.from, url: `${base}/api/twilio/voice/outreach${q}`, statusCallback: `${base}/api/twilio/voice/outreach/status${q}` });
    await updateProspect(id, (x) => withLastCall(x, { sid }));
    return { ok: true, sid };
  } catch (err) {
    const error = twilioWords(err instanceof Error ? err.message : "The call could not be placed.");
    await updateProspect(id, (x) => withLastCall(x, { status: "failed", outcome: "failed", error }));
    return { ok: false, error };
  }
}

/** The next `n` the AI may call now: who asked for a call first, then the landlines in the order they came in. */
export async function callNext(n: number, base: string): Promise<{ placed: number; failed: number; waiting: number; errors: string[] }> {
  const now = new Date();
  const list = (await listProspects()).filter((p) => callableNow(p, now).ok);
  list.sort((a, b) => Number(!!b.consent) - Number(!!a.consent) || a.createdAt.localeCompare(b.createdAt));
  let placed = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const p of list.slice(0, Math.max(1, Math.min(25, n)))) {
    const r = await callProspect(p.id, base);
    if (r.ok) placed++;
    else {
      failed++;
      if (!errors.includes(r.error)) errors.push(r.error);
      if (failed >= 3 && !placed) break;
    }
  }
  return { placed, failed, waiting: Math.max(0, list.length - placed - failed), errors };
}

const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const HANGUP = `<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`;

/** The call is answered: a person gets the AI on JobFlex's script; a machine, after its beep, the short voicemail. */
export async function outreachAnswered(id: string, params: Record<string, string>, base: string): Promise<string> {
  const p = await readProspect(id);
  const call = p ? lastCall(p) : null;
  if (!p || !call || (call.sid && params.CallSid && call.sid !== params.CallSid)) return HANGUP;
  const answeredBy = (params.AnsweredBy ?? "").slice(0, 40) || null;
  if (answeredBy && /^machine_end/.test(answeredBy)) {
    await updateProspect(id, (x) => withLastCall(x, { status: "voicemail", outcome: "voicemail", answeredBy }));
    const say = outreachVoicemail(p, await outreachFrom(), SITE);
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Pause length="1"/><Say voice="Polly.Joanna">${xmlEsc(say)}</Say><Hangup/></Response>`;
  }
  if (answeredBy && (/^machine/.test(answeredBy) || answeredBy === "fax")) {
    await updateProspect(id, (x) => withLastCall(x, { status: "no-answer", outcome: "no-answer", answeredBy }));
    return HANGUP;
  }
  const ws = voiceStreamUrl();
  if (!ws || !voiceServerConfigured()) return HANGUP;
  await updateProspect(id, (x) => withLastCall(x, { status: "answered", answeredBy }));
  const token = signCallToken({ callSid: params.CallSid ?? call.sid ?? "", organizationId: OUTREACH_ORG, from: p.phone ?? "", kind: "outreach", ref: id }, 30 * 60_000);
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${xmlEsc(ws)}">
      <Parameter name="token" value="${xmlEsc(token)}"/>
    </Stream>
  </Connect>
  <Redirect method="POST">${xmlEsc(`${base}/api/twilio/voice/outreach/after?p=${encodeURIComponent(id)}`)}</Redirect>
</Response>`;
}

/** After the AI's part: put the contractor through to a person at JobFlex if that is how it ended; else hang up. */
export async function outreachAfter(id: string): Promise<string> {
  const p = await readProspect(id);
  const to = transferTo();
  if (p && to && lastCall(p)?.summary === "transfer") return `<?xml version="1.0" encoding="UTF-8"?><Response><Dial timeout="25">${xmlEsc(to)}</Dial></Response>`;
  return HANGUP;
}

/** Twilio's word on how the call ended: a call nobody (or no machine) picked up. */
export async function outreachStatus(id: string, params: Record<string, string>): Promise<void> {
  const status = (params.CallStatus ?? "").toLowerCase();
  await updateProspect(id, (p) => {
    const c = lastCall(p);
    if (!c || (c.sid && params.CallSid && c.sid !== params.CallSid)) return p;
    const seconds = Number(params.CallDuration) || c.seconds;
    if (status === "no-answer" || status === "busy" || status === "canceled") return withLastCall(p, { status: status === "busy" ? "busy" : "no-answer", outcome: c.outcome ?? "no-answer", seconds });
    if (status === "failed") return withLastCall(p, { status: "failed", outcome: c.outcome ?? "failed", seconds, error: c.error ?? "The call didn't connect." });
    // Completed: still "calling" means the answer never reached us (a machine Twilio hung up on).
    if (c.status === "calling") return withLastCall(p, { status: "no-answer", outcome: c.outcome ?? "no-answer", seconds });
    return withLastCall(p, { seconds: Math.max(c.seconds, seconds) });
  });
}

/* ── What the voice server asks while the AI talks ───────────────────── */

async function scriptFacts(): Promise<ScriptFacts> {
  const plans = await getPlanCatalog().catch(() => []);
  const onSale = plans.filter((x) => x.active && !x.isFree).sort((a, b) => a.order - b.order);
  return { plans: onSale.map((x) => ({ name: x.name, price: formatPlanPrice(x.priceCents) })), trialDays: Math.max(0, ...onSale.map((x) => x.trialDays)) || 7, canTransfer: !!transferTo(), site: SITE };
}

export async function outreachBrief(t: CallToken): Promise<{ ok: true; instructions: string; voice: string; maxSeconds: number; callSid: string; tools: ReturnType<typeof outreachTools> } | { ok: false; error: string }> {
  const p = t.ref ? await readProspect(t.ref) : null;
  if (!p) return { ok: false, error: "no such contractor" };
  if (p.dnc) return { ok: false, error: "asked not to be called" };
  const facts = await scriptFacts();
  return { ok: true, instructions: outreachInstructions(p, facts, new Date()), voice: "marin", maxSeconds: 300, callSid: t.callSid, tools: outreachTools(facts.canTransfer) };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

/** The trial's sign-up page, marked as coming from this call. */
const trialUrl = (base: string, p: Prospect) => `${base}/auth/register?utm_source=jobflex-call&utm_medium=ai-desk${p.trade ? `&utm_campaign=${encodeURIComponent(p.trade)}` : ""}`;

export async function outreachTool(t: CallToken, name: string, args: Record<string, unknown>, base: string): Promise<{ ok: true; outcome?: "done"; output: Record<string, unknown> } | { ok: false; error: string }> {
  const id = t.ref ?? "";
  const p = await readProspect(id);
  if (!p) return { ok: false, error: "no such contractor" };
  switch (name) {
    case "email_trial_link": {
      const email = String(args.email ?? "").trim().toLowerCase().slice(0, 160);
      if (!EMAIL_RE.test(email)) return { ok: false, error: "That doesn't look like an email address — ask them to spell it." };
      if (!isEmailEnabled()) return { ok: false, error: "Email isn't working right now — give them the site, jobflex.app, instead." };
      const first = p.name.trim().split(/\s+/)[0] || "";
      const link = trialUrl(base, p);
      const text = `${first ? `Hi ${first},` : "Hi,"}\n\nThanks for taking the call just now. Here is the link to start your free JobFlex trial:\n${link}\n\nIt takes a couple of minutes; the AI desk, the estimates and the proposals are all in it.\n\nJobFlex · jobflex.app`;
      const html = `<div style="max-width:560px;margin:0 auto;padding:24px 18px;font:15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;"><p>${first ? `Hi ${xmlEsc(first)},` : "Hi,"}</p><p>Thanks for taking the call just now. Here is the link to start your free JobFlex trial:</p><p><a href="${xmlEsc(link)}" style="color:#1854a0;font-weight:600;">Start my JobFlex trial</a></p><p>It takes a couple of minutes; the AI desk, the estimates and the proposals are all in it.</p><p style="color:#6a6a6a;">JobFlex · jobflex.app</p></div>`;
      try {
        await sendEmail({ to: email, subject: "Your JobFlex trial link", html, text, from: fromLine("JobFlex") });
      } catch (err) {
        logServerError("outreach-email-link", err, { kind: "action" });
        return { ok: false, error: "The email didn't go out — give them the site, jobflex.app, instead." };
      }
      await writeProspect({ ...p, email: p.email ?? email, linkSentAt: nowIso(), linkSentTo: email });
      return { ok: true, outcome: "done", output: { sent: true, to: email, say: "Tell them it's on its way to that address." } };
    }
    case "note_interest": {
      const level = args.level === "hot" || args.level === "warm" ? args.level : "cold";
      const note = String(args.note ?? "").trim().slice(0, 400);
      const callBack = String(args.call_back ?? "").trim().slice(0, 120) || null;
      await writeProspect({ ...p, interest: { level, note, callBack, at: nowIso() } });
      return { ok: true, outcome: "done", output: { noted: true } };
    }
    case "do_not_call": {
      await writeProspect({ ...p, dnc: { at: nowIso(), via: "call" } });
      return { ok: true, outcome: "done", output: { done: true, say: "Tell them they won't be called again, apologise for the interruption, say goodbye and call end_call." } };
    }
    default:
      return { ok: false, error: `unknown tool ${name}` };
  }
}

/** The AI's part is over: the transcript and how it went, on the contractor's record. */
export async function finishOutreachCall(t: CallToken, input: { outcome: string; transcript: Array<{ role: string; text: string }>; seconds: number; error: string | null }): Promise<void> {
  const id = t.ref ?? "";
  await updateProspect(id, (p) => {
    const c = lastCall(p);
    if (!c) return p;
    const text = input.transcript.map((l) => `${l.role === "desk" ? "JobFlex" : "Contractor"}: ${l.text}`).join("\n").slice(0, 20_000);
    const spoke = input.transcript.some((l) => l.role === "caller");
    const outcome: Outcome = p.dnc
      ? "do-not-call"
      : p.linkSentAt && (!c.at || p.linkSentAt >= c.at)
        ? "link-sent"
        : p.interest && p.interest.at >= c.at
          ? p.interest.level === "cold"
            ? /someone else|receptionist|not (in|here|available)|left a message/i.test(p.interest.note)
              ? "gatekeeper"
              : "not-interested"
            : p.interest.callBack
              ? "call-back"
              : "interested"
          : input.outcome === "failed"
            ? "failed"
            : spoke
              ? "not-interested"
              : "no-answer";
    const status: CallStatus = input.outcome === "failed" ? "failed" : "done";
    return withLastCall(p, { status, seconds: Math.max(c.seconds, Math.round(input.seconds)), outcome, transcript: text || null, summary: input.outcome === "transfer" ? "transfer" : (p.interest?.note ?? null), error: input.error });
  });
}

/* ── The email, and the call-me page it links to ─────────────────────── */

function secret(): string | null {
  return process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? null;
}
const sign = (id: string) => {
  const s = secret();
  return s ? createHmac("sha256", s).update(`outreach-callme:${id}`).digest("base64url").slice(0, 22) : null;
};
/** The token in a contractor's call-me link: their record, signed. */
export function callMeToken(id: string): string | null {
  const s = sign(id);
  return s ? `${id}.${s}` : null;
}
export function readCallMeToken(token: string | null | undefined): string | null {
  const [id, sig] = String(token ?? "").split(".");
  const want = id ? sign(id) : null;
  if (!want || !sig || sig.length !== want.length) return null;
  try {
    return timingSafeEqual(Buffer.from(sig), Buffer.from(want)) ? id : null;
  } catch {
    return null;
  }
}

/** The one email, to `n` contractors the AI may not call and who were not written to yet (at most EMAILS_PER_DAY a day). */
export async function emailProspects(n: number, base: string, admin: { name: string | null; email: string }): Promise<{ sent: number; skipped: number; error: string | null }> {
  const addr = postal();
  if (!addr) return { sent: 0, skipped: 0, error: "Set JOBFLEX_POSTAL_ADDRESS first — the email law asks for a postal address in every email like this." };
  if (!isEmailEnabled()) return { sent: 0, skipped: 0, error: "Email isn't set up on this server." };
  const list = await listProspects();
  const today = new Date().toISOString().slice(0, 10);
  const sentToday = list.filter((p) => p.emailedAt?.startsWith(today)).length;
  const room = Math.max(0, EMAILS_PER_DAY - sentToday);
  if (!room) return { sent: 0, skipped: 0, error: `${EMAILS_PER_DAY} emails went out today already — the rest go tomorrow.` };
  const todo = list.filter((p) => routeFor(p).kind === "email" && p.email && !p.emailedAt).slice(0, Math.min(room, Math.max(1, n)));
  const sender = (admin.name ?? "").trim().split(/\s+/)[0] || "The JobFlex team";
  let sent = 0;
  let skipped = 0;
  let error: string | null = null;
  for (const p of todo) {
    if (await readOptOut(optOutId(p.id))) {
      skipped++;
      continue;
    }
    const token = callMeToken(p.id);
    if (!token) return { sent, skipped, error: "The server has no signing secret (NEXTAUTH_SECRET)." };
    const unsub = unsubscribeUrl(base, optOutId(p.id));
    const letter = outreachLetter({ p, sender, callMeUrl: `${base}/call-me/${token}`, siteUrl: `${base}/?utm_source=jobflex-email&utm_medium=outreach`, unsubscribeUrl: unsub, postal: addr });
    try {
      await sendEmail({ to: p.email!, subject: letter.subject, html: letter.html, text: letter.text, from: fromLine(sender), replyTo: admin.email, headers: unsubscribeHeaders(unsub) });
      await writeProspect({ ...p, emailedAt: nowIso() });
      sent++;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      break;
    }
  }
  return { sent, skipped, error };
}

/** "Have the AI desk call me", from the email's page or the open one: their consent kept, and the call placed now. */
export async function requestCallMe(
  input: { token: string | null; name: string; business: string; phone: string; email: string | null; trade: string | null; state: string | null; consent: boolean; ip: string | null; ua: string | null },
  base: string,
): Promise<{ ok: true; calling: boolean; note: string } | { ok: false; error: string }> {
  if (!input.consent) return { ok: false, error: "Tick the box so we may call you." };
  const phone = toE164(input.phone);
  if (!phone || !isUsCanadaNumber(phone)) return { ok: false, error: "That phone number doesn't look right — a US or Canadian number, with its area code." };
  const fromToken = readCallMeToken(input.token);
  const list = fromToken ? [] : await listProspects();
  const had = fromToken ? await readProspect(fromToken) : (list.find((p) => p.phone === phone) ?? null);
  const at = nowIso();
  const consent = { text: OUTREACH_CONSENT_TEXT, at, ip: input.ip?.slice(0, 64) ?? null, ua: input.ua?.slice(0, 200) ?? null, page: fromToken ? `call-me:${fromToken}` : "call-me" };
  const base0 = had ?? blank({}, "call-me");
  const p: Prospect = {
    ...base0,
    name: input.name.trim().slice(0, 120) || base0.name,
    business: input.business.trim().slice(0, 120) || base0.business,
    phone,
    email: input.email?.trim().toLowerCase().slice(0, 160) || base0.email,
    trade: tradeKey(input.trade) ?? base0.trade,
    state: stateCode(input.state) ?? base0.state,
    consent,
    // Asking for the call now is the newest word: an earlier "don't call" gives way to it. (The calls before it stay
    // on the record; the rules count only the ones since this consent.)
    dnc: null,
  };
  await writeProspect(p);
  const r = await callProspect(p.id, base);
  if (r.ok) return { ok: true, calling: true, note: "Calling you now — pick up in about half a minute." };
  // Nothing calls again by itself: say so. The admin's test call shows Twilio's reason; a contractor gets plain words.
  return { ok: true, calling: false, note: input.ua?.startsWith("admin test") ? `The call didn't go out: ${r.error}` : "We have your request, but the call couldn't go out just now — please try again in a few minutes." };
}

/** A test call to the admin's own phone: the admin's own consent, the script as a contractor hears it. */
export async function testCallToAdmin(input: { phone: string; name: string; business: string; trade: string | null; adminEmail: string }, base: string) {
  return requestCallMe({ token: null, name: input.name, business: input.business, phone: input.phone, email: input.adminEmail, trade: input.trade, state: null, consent: true, ip: null, ua: `admin test by ${input.adminEmail}` }, base);
}
