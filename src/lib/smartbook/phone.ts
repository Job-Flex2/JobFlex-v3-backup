// SMARTBOOK · ON THE PHONE (owner, 2026-10-31: "offer availability by text or email or calling from AI desk"; decision
// 1: one AI call when a lead hasn't answered in 2 business hours, off until switched on, only to leads who agreed to
// calls, on the plan's desk minutes) — server only.
//
//   A lead SmartBook is talking with calls the company's number:
//     leadCalling / deskCallExtras  the desk's brief (lib/aiDesk/liveCall callBrief) learns who it is — the times they
//                                   were sent, the time they asked for, the visit they booked — and brings the desk's
//                                   tools plus request_time and not_interested
//   SmartBook's one call (engine step "call"):
//     placeSmartBookCall            from the company's own number, answering-machine detection on
//     smartBookAnswered             a person: the desk on SmartBook's script; a machine, after its beep: a short voicemail
//     smartBookCallBrief            that script, the desk's own knowledge under it, the company's voice
//     smartBookAfter / smartBookCallStatus   Twilio's word after the AI's part and when the call ends
//   Either way:
//     leadForToken                  which lead a call is about (the desk's tools act on it, never a second lead)
//     smartBookTool                 request_time and not_interested (/api/desk/tool)
//     finishSmartBookCall           the minutes, the transcript, a line on the lead's timeline
//
// No change to the voice server: it sends open_times / book_visit / take_message to the desk's own routes, which ask
// leadForToken first, and any other tool a brief brings to /api/desk/tool (voice/README "A brief's own tools").
import { db } from "@/lib/db";
import { appBaseUrl } from "@/lib/appUrl";
import { toE164 } from "@/lib/phone";
import { twilioSettings } from "@/lib/sdk/twilio";
import { signCallToken, voiceServerConfigured, voiceStreamUrl, type CallToken } from "@/lib/aiDesk/voiceToken";
import { assistantOnPlan } from "@/lib/aiDesk/calls";
import { deskBalanceFor } from "@/lib/aiDesk/minutes";
import { deskNumberFor } from "@/lib/aiDesk/forwardTest";
import { companyFacts } from "@/lib/aiDesk/facts";
import { readDeskSettings } from "@/lib/aiDesk/numbers";
import { deskInstructions, profileFromFacts } from "@/lib/aiDesk/profile";
import { finishCall, readCallOutcome, type CallOutcome } from "@/lib/aiDesk/liveCall";
import { callContext, noteOnCall, notInterestedOnCall, requestOnCall } from "./engine";
import { convByPhone, readConv, type Conversation } from "./store";

const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const HANGUP = `<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`;

// ── the tools ───────────────────────────────────────────────────────────────

type Tool = { type: "function"; name: string; description: string; parameters: { type: "object"; properties: Record<string, unknown>; required: string[] } };
const tool = (name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []): Tool => ({ type: "function", name, description, parameters: { type: "object", properties, required } });

/**
 * What the desk may do on a call about a SmartBook lead. The first three keep the desk's own names, so the voice server
 * sends them to the desk's routes (which act on this lead); the voice server runs transfer_call and end_call itself.
 */
export function smartBookTools(): Tool[] {
  return [
    tool("open_times", "The open times for this customer: the ones already sent to them first, then the next open ones. Call it before offering any time. Each has an id.", { days: { type: "integer", description: "How many days ahead (default 7)" } }),
    tool(
      "book_visit",
      "Book one of the open times for this customer once they chose it. Their name, phone and address are already on file.",
      { time_id: { type: "string", description: "The id of the chosen time from open_times" }, name: { type: "string" }, phone: { type: "string" }, notes: { type: "string", description: "Anything new for the team, as short labelled lines" } },
      ["time_id"],
    ),
    tool(
      "request_time",
      "The customer wants a day or time that open_times doesn't have. The team is asked to confirm it, and the customer hears back by text or email. Use a day (and a time, or a part of the day) on the company's calendar.",
      {
        day: { type: "string", description: "YYYY-MM-DD" },
        time: { type: "string", description: "HH:MM, 24-hour, when they named an hour" },
        part: { type: "string", enum: ["morning", "afternoon", "evening"], description: "When they named only a part of the day" },
        words: { type: "string", description: "What they said, briefly" },
      },
      ["day"],
    ),
    tool("not_interested", "The customer isn't interested any more, or asks not to be contacted. SmartBook stops and the company is told.", { said: { type: "string", description: "Their words, briefly" } }),
    tool("take_message", "A message for the company — a question you can't answer, a call back they want. It goes onto their request.", { name: { type: "string" }, phone: { type: "string" }, about: { type: "string" } }, ["about"]),
    tool("transfer_call", "Hand the call to a person at the company (their phone rings). Only when the customer asks for a person and the instructions allow it. Say you are transferring first.", { reason: { type: "string" } }),
    tool("end_call", "End the call after the goodbye."),
  ];
}

// ── which lead a call is about ──────────────────────────────────────────────

/** A lead SmartBook is talking with, calling from this number (a test never counts). */
export async function leadCalling(organizationId: string, from: string): Promise<Conversation | null> {
  const phone = toE164(from);
  if (!phone) return null;
  const conv = await convByPhone(organizationId, phone);
  if (!conv || conv.test) return null;
  return conv.status !== "closed" || conv.why === "no-reply" ? conv : null;
}

/** The lead a call's tools act on: SmartBook's own call names it; a desk call has one when the caller is a SmartBook lead. */
export async function leadForToken(t: CallToken): Promise<string | null> {
  if (t.kind === "smartbook") return t.ref ?? null;
  if (t.kind) return null;
  return (await leadCalling(t.organizationId, t.from))?.leadId ?? null;
}

const ago = (iso: string, now: Date) => {
  const m = Math.max(1, Math.round((now.getTime() - Date.parse(iso)) / 60000));
  return m < 90 ? `${m} minutes ago` : m < 36 * 60 ? `${Math.round(m / 60)} hours ago` : `${Math.round(m / 1440)} days ago`;
};

/** Where SmartBook stands with this lead, as lines for the desk's instructions. */
async function standing(organizationId: string, conv: Conversation, now: Date): Promise<string[] | null> {
  const c = await callContext(organizationId, conv.leadId, now);
  if (!c) return null;
  const who = c.first || c.name;
  return [
    `${c.name} asked ${c.company} about ${c.project || "a visit"}; SmartBook, the company's scheduling assistant, has been finding them a time by ${c.channel ?? "text and email"} (started ${ago(conv.createdAt, now)}).`,
    c.status === "offered" && c.offers.length ? `Times already sent to ${who}: ${c.offers.map((o) => `${o.label} (id ${o.id})`).join("; ")}. open_times returns these first.` : "",
    c.status === "asked" && c.asked ? `${who} asked for ${c.asked}; the team hasn't confirmed it yet. Say they'll hear back shortly — or, if another time works, book it from open_times.` : "",
    c.status === "countered" && c.counter ? `The company offered ${who} ${c.counter} instead of their time; a yes books it (book_visit with that time from open_times).` : "",
    c.status === "booked" && c.booked ? `${who} is booked for ${c.booked}. To move it, offer open_times and book the new one with book_visit (that moves the visit); to cancel, take_message.` : "",
    `The visit: ${c.visit} — ${c.price}.`,
  ].filter(Boolean);
}

/**
 * The desk's brief for a caller SmartBook is talking with: what it knows, and the tools that act on their lead. Null
 * when the caller isn't one (the desk's own brief stands as it is).
 */
export async function deskCallExtras(organizationId: string, from: string, now = new Date()): Promise<{ lines: string; tools: Tool[] } | null> {
  const conv = await leadCalling(organizationId, from);
  if (!conv) return null;
  const lines = await standing(organizationId, conv, now);
  if (!lines) return null;
  return {
    lines: [
      "THIS CALLER IS A LEAD SMARTBOOK IS SCHEDULING — greet them by name once they confirm it is them:",
      ...lines.map((l) => `- ${l}`),
      "- Help them pick a time: open_times, then book_visit. A day or time that isn't open: request_time. Not interested any more: not_interested. A question you can't answer: take_message. Their details are on file — don't ask again for what you know.",
    ].join("\n"),
    tools: smartBookTools(),
  };
}

// ── SmartBook's one call ────────────────────────────────────────────────────

/** Twilio's REST API, one call, answering-machine detection on: a person is told apart in a second or two, a machine after its beep. */
async function twilioCall(input: { to: string; from: string; url: string; statusCallback: string }): Promise<string> {
  const s = await twilioSettings();
  if (!s) throw new Error("calls aren’t set up on JobFlex");
  const base = (process.env.NODE_ENV !== "production" && process.env.TWILIO_API_BASE?.trim()) || "https://api.twilio.com";
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
  if (!res.ok || !j.sid) throw new Error(j.message ? `Twilio: ${j.message}` : `Twilio refused the call (HTTP ${res.status})`);
  return j.sid;
}

/** Can SmartBook call for this company now — the live desk, a number to call from, the plan, minutes. Null: yes. */
export async function callBlocker(organizationId: string): Promise<string | null> {
  if (!voiceServerConfigured()) return "the AI desk isn’t live yet";
  const [from, onPlan, balance, twilio] = await Promise.all([deskNumberFor(organizationId).catch(() => null), assistantOnPlan(organizationId).catch(() => false), deskBalanceFor(organizationId).catch(() => null), twilioSettings()]);
  if (!twilio) return "calls aren’t set up on JobFlex";
  if (!from) return "the company has no calling number yet";
  if (!onPlan) return "the plan doesn’t include the AI desk";
  if (balance?.out) return "the AI desk's minutes are used up";
  return null;
}

const callBase = async () => (process.env.TWILIO_APP_URL ?? (await appBaseUrl())).replace(/\/$/, "");
const query = (organizationId: string, leadId: string) => `?o=${encodeURIComponent(organizationId)}&l=${encodeURIComponent(leadId)}`;

export async function placeSmartBookCall(organizationId: string, leadId: string, to: string): Promise<{ ok: true; sid: string } | { ok: false; error: string }> {
  const blocked = await callBlocker(organizationId);
  if (blocked) return { ok: false, error: blocked };
  const from = (await deskNumberFor(organizationId))!;
  const base = await callBase();
  const q = query(organizationId, leadId);
  try {
    const sid = await twilioCall({ to, from, url: `${base}/api/twilio/voice/smartbook${q}`, statusCallback: `${base}/api/twilio/voice/smartbook/status${q}` });
    // On the Phone page beside the desk's own calls, pointing at the lead.
    await db.aiPhoneCall.create({ data: { organizationId, direction: "OUTBOUND", fromNumber: from, toNumber: to, status: "IN_PROGRESS", callSid: sid, leadId, summary: "SmartBook's call about a time" } }).catch(() => null);
    return { ok: true, sid };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "the call couldn't be placed" };
  }
}

/** "an estimate visit", "a free estimate", "a repair visit". */
const withArticle = (words: string) => `${/^[aeiou]/i.test(words) ? "an" : "a"} ${words}`;

/** The short voicemail: who, why, and where the times are — nothing booked. */
export function voicemailWords(v: { first: string; company: string; visit: string; channel: "text" | "email" | null }): string {
  const where = v.channel === "email" ? "an email" : "a text";
  return `Hi${v.first ? ` ${v.first}` : ""}, this is the virtual assistant for ${v.company}, calling about your request for ${withArticle(v.visit.toLowerCase())}. We sent you ${where} with a few open times — just reply or tap the link to pick one. Thanks, and talk soon.`;
}

/** The call is answered: a person gets the desk on SmartBook's script; a machine, after its beep, the voicemail; a fax, a hang-up. */
export async function smartBookAnswered(organizationId: string, leadId: string, params: Record<string, string>, base: string): Promise<string> {
  const [conv, c] = await Promise.all([readConv(organizationId, leadId), callContext(organizationId, leadId)]);
  if (!conv || !c || !conv.phone) return HANGUP;
  const callSid = params.CallSid ?? "";
  const answeredBy = (params.AnsweredBy ?? "").slice(0, 40);
  if (/^machine_end/.test(answeredBy)) {
    await noteOnCall(organizationId, leadId, `SmartBook called ${conv.name} and left a voicemail`);
    await db.aiPhoneCall.updateMany({ where: { callSid }, data: { summary: "SmartBook left a voicemail" } }).catch(() => null);
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Pause length="1"/><Say voice="Polly.Joanna">${xmlEsc(voicemailWords(c))}</Say><Hangup/></Response>`;
  }
  if (/^machine/.test(answeredBy) || answeredBy === "fax") {
    await noteOnCall(organizationId, leadId, `SmartBook called ${conv.name} — no answer`);
    return HANGUP;
  }
  const ws = voiceStreamUrl();
  if (!ws || !voiceServerConfigured()) return HANGUP;
  const token = signCallToken({ callSid, organizationId, from: conv.phone, kind: "smartbook", ref: leadId }, 30 * 60_000);
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${xmlEsc(ws)}">
      <Parameter name="token" value="${xmlEsc(token)}"/>
    </Stream>
  </Connect>
  <Redirect method="POST">${xmlEsc(`${base}/api/twilio/voice/smartbook/after${query(organizationId, leadId)}`)}</Redirect>
</Response>`;
}

/** After the AI's part: a person at the company when the customer asked for one (and there is a phone to ring); else goodbye. */
export async function smartBookAfter(organizationId: string, callSid: string): Promise<string> {
  const outcome = await readCallOutcome(callSid);
  if (outcome?.outcome !== "transfer") return HANGUP;
  const [org, desk] = await Promise.all([db.organization.findUnique({ where: { id: organizationId }, select: { phone: true } }), readDeskSettings(organizationId)]);
  const phone = desk.forwarding === "all" ? null : toE164(org?.phone ?? "");
  return phone ? `<?xml version="1.0" encoding="UTF-8"?><Response><Dial timeout="25">${xmlEsc(phone)}</Dial></Response>` : HANGUP;
}

/** Twilio's word on how the call ended: a call nobody picked up, a busy line, one that didn't connect. */
export async function smartBookCallStatus(organizationId: string, leadId: string, params: Record<string, string>): Promise<void> {
  const status = (params.CallStatus ?? "").toLowerCase();
  const callSid = params.CallSid ?? "";
  if (status === "no-answer" || status === "busy" || status === "failed" || status === "canceled") {
    const conv = await readConv(organizationId, leadId);
    const words = status === "busy" ? "the line was busy" : status === "failed" ? "the call didn't connect" : "no answer";
    if (conv) await noteOnCall(organizationId, leadId, `SmartBook called ${conv.name} — ${words}`);
    await db.aiPhoneCall.updateMany({ where: { callSid, status: "IN_PROGRESS" }, data: { status: status === "failed" ? "FAILED" : "COMPLETED", endedAt: new Date(), durationSeconds: 0, summary: `SmartBook's call — ${words}` } }).catch(() => null);
  }
}

/** SmartBook's own call: the desk's knowledge of the company, on SmartBook's script. */
export async function smartBookCallBrief(t: CallToken, now = new Date()): Promise<{ ok: true; instructions: string; voice: string; maxSeconds: number; callSid: string; tools: Tool[] } | { ok: false; error: string }> {
  const leadId = t.ref ?? "";
  const [conv, c, facts, settings, balance] = await Promise.all([readConv(t.organizationId, leadId), callContext(t.organizationId, leadId, now), companyFacts(t.organizationId), readDeskSettings(t.organizationId), deskBalanceFor(t.organizationId).catch(() => null)]);
  if (!conv || !c || !facts) return { ok: false, error: "no such lead" };
  if (balance?.out) return { ok: false, error: "out of minutes" };
  const lines = (await standing(t.organizationId, conv, now)) ?? [];
  const who = c.first || "there";
  const nowWords = now.toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: facts.timezone });
  const visit = withArticle(/^free\b/i.test(c.price.trim()) ? `free ${c.visit.toLowerCase()}` : c.visit.toLowerCase());
  const script = [
    `THIS CALL — YOU ARE CALLING THEM, not answering. Ignore the GREETING above; it is for calls coming in. It is ${nowWords} (${facts.timezone}).`,
    ...lines.map((l) => `- ${l}`),
    `- Open with this, then stop and listen: "Hi, is this ${who}? This is the virtual assistant for ${c.company}, calling about your request for ${visit}. Is now a good moment to pick a time?" The call is recorded; say so if they ask.`,
    `- Not ${who}: ask when is a good time to reach them, take_message with it, say goodbye and end_call.`,
    "- Not a good moment: say they can pick a time from the text or email whenever suits them, say goodbye and end_call.",
    "- Finding a time: call open_times and offer two or three, the earliest first. Book the one they choose with book_visit and read it back — a text confirms it.",
    "- None of those work: ask what day and time suit them. If open_times has it, book it; if not, use request_time and tell them the team will confirm and they'll hear back shortly.",
    "- Not interested any more, or they don't want calls: call not_interested, thank them, say goodbye and end_call.",
    "- Questions about the job or prices: answer only from what the company told you above; otherwise take_message so someone calls back.",
    "- Keep it short, about two minutes. Never pressure them; one gentle try is enough.",
  ].join("\n");
  const profile = settings.profile ?? profileFromFacts(facts);
  // SmartBook's call is short: five minutes at most, or what is left on the balance.
  const maxSeconds = balance ? Math.max(60, Math.min(300, balance.remainingSeconds)) : 300;
  return { ok: true, instructions: `${deskInstructions(profile, facts, settings.mode, settings.forwarding)}\n\n${script}`, voice: settings.voice, maxSeconds, callSid: t.callSid, tools: smartBookTools() };
}

const PARTS = new Set(["morning", "afternoon", "evening"]);

/** request_time and not_interested — for SmartBook's own call and for a desk call from one of its leads. */
export async function smartBookTool(t: CallToken, name: string, args: Record<string, unknown>): Promise<{ ok: true; outcome?: "done"; output: Record<string, unknown> } | { ok: false; error: string }> {
  const leadId = await leadForToken(t);
  if (!leadId) return { ok: false, error: `no such tool on this call: ${name}` };
  const words = typeof args.words === "string" ? args.words.trim().slice(0, 300) : "";
  if (name === "request_time") {
    const day = typeof args.day === "string" ? args.day.trim() : "";
    const time = typeof args.time === "string" && /^\d{1,2}:\d{2}$/.test(args.time.trim()) ? args.time.trim().padStart(5, "0") : null;
    const part = typeof args.part === "string" && PARTS.has(args.part) ? (args.part as "morning" | "afternoon" | "evening") : null;
    const r = await requestOnCall(t.organizationId, leadId, { day, time, part }, words);
    if (!r.ok) return r;
    await db.aiPhoneCall.updateMany({ where: { callSid: t.callSid }, data: { leadId } }).catch(() => null);
    return { ok: true, outcome: "done", output: { outcome: r.outcome, say: r.say, ...(r.times ? { times: r.times } : {}) } };
  }
  if (name === "not_interested") {
    const said = typeof args.said === "string" ? args.said.trim().slice(0, 300) : "";
    await notInterestedOnCall(t.organizationId, leadId, said);
    await db.aiPhoneCall.updateMany({ where: { callSid: t.callSid }, data: { leadId } }).catch(() => null);
    return { ok: true, outcome: "done", output: { done: true, say: "Thank them, say goodbye and call end_call." } };
  }
  return { ok: false, error: `unknown tool ${name}` };
}

/** SmartBook's call is over: the desk's minutes and the transcript (lib/aiDesk/liveCall), and how it went on the lead. */
export async function finishSmartBookCall(t: CallToken, input: { outcome: CallOutcome["outcome"]; transcript: Array<{ role: string; text: string }>; seconds: number; booked: { appointmentId: string } | null; messageTaken: boolean; error: string | null }): Promise<void> {
  const leadId = t.ref ?? "";
  await finishCall({ callSid: t.callSid, organizationId: t.organizationId }, { ...input, noLead: true });
  const conv = await readConv(t.organizationId, leadId);
  if (!conv) return;
  const minutes = Math.max(1, Math.round(input.seconds / 60));
  const spoke = input.transcript.some((l) => l.role === "caller");
  const how = !spoke
    ? "nobody spoke"
    : conv.status === "booked"
      ? "they picked a time"
      : conv.status === "asked" && conv.request
        ? `they asked for ${conv.request.label}`
        : conv.status === "closed" && conv.why === "not-interested"
          ? "they're not interested"
          : input.outcome === "transfer"
            ? "they asked for a person"
            : "no time picked yet";
  await noteOnCall(t.organizationId, leadId, `SmartBook talked with ${conv.name} on the phone (${minutes} min) — ${how}`);
  await db.aiPhoneCall.updateMany({ where: { callSid: t.callSid }, data: { leadId, summary: `SmartBook's call — ${how}` } }).catch(() => null);
}
