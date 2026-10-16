import "server-only";
// SUPPORT · THE AI ON A TICKET (2026-10-15) — the server half of
// lib/support/aiReply: what the model is told about the customer, the call,
// the sends, the copies to the support inbox, and the fix decisions.
//
// WHEN IT RUNS
//   · a new ticket — actions/support submitSupportTicket hands it over with
//     after(), so the customer's "Send" returns at once;
//   · the safety net — /api/cron/support-ai every 10 minutes answers a new
//     ticket the AI never read (the request that filed it ended first);
//   · an admin's "Ask AI" on any ticket — always a draft, never a send.
//
// ITS OWN OPENAI CLIENT. The shared one (lib/sdk/openai) bills each call to
// the request's organization through lib/trialMeter, and a new ticket's
// answer runs inside the CUSTOMER's request — their trial AI budget would pay
// for our support. Answering tickets is the platform's cost, so this client is
// not metered. Same key, same model (resolveOpenAIModel), same sampling rule.
//
// NOTHING HERE CHANGES AN ACCOUNT. It reads the customer's facts, writes a
// letter, keeps a record (SyncState `supportAi:<ticketId>`, `supportAi:
// settings` — no schema change) and sends email. A fix is a proposal that
// waits for an admin's Approve; "Mark fixed" only tells the customer.

import OpenAI from "openai";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { appBaseUrl } from "@/lib/appUrl";
import { isOpenAIEnabled, resolveOpenAIModel, samplingOptions } from "@/lib/sdk/openai";
import { isEmailEnabled, sendEmail } from "@/lib/sdk/resend";
import { supportRecipients, supportTicketRef } from "@/lib/notify";
import { addSupportReply, canOpenSupportPage, readSupportReplies, recipientForTicket, repliesForTickets } from "@/lib/supportReplies";
import { replyLetter, statusAfterReply, type SupportReply } from "@/lib/supportReply";
import { getOrgLimitUsage } from "@/lib/limitsEngine";
import { recentServerErrors } from "@/lib/posthog";
import {
  DEFAULT_SUPPORT_AI_MODE,
  FIXED_NOTE_RULES,
  deliveryFor,
  failedRecord,
  firstNameOf,
  fixApprovedEmail,
  fixedNoteUserPrompt,
  fixedReplyTemplate,
  holdingReply,
  liveStateOf,
  parseSupportAiRecord,
  stillStuckEmail,
  recordFor,
  supportAiAnswerSchema,
  supportAiMode,
  supportSystemPrompt,
  supportUserPrompt,
  teamCopyEmail,
  type LiveState,
  type SupportAiMode,
  type SupportAiOutcome,
  type SupportAiRecord,
} from "./aiReply";

const SETTINGS_KEY = "supportAi:settings";
const RECORD_KEY = (ticketId: string) => `supportAi:${ticketId}`;
const TEAM_SIGNATURE = "JobFlex support";
const REPLY_TO = "support@jobflex.app";

// ── The switch and the records ───────────────────────────────────────────────

export async function readSupportAiMode(): Promise<SupportAiMode> {
  const row = await db.syncState.findUnique({ where: { key: SETTINGS_KEY } }).catch(() => null);
  if (!row?.cursor) return DEFAULT_SUPPORT_AI_MODE;
  try {
    return supportAiMode((JSON.parse(row.cursor) as { mode?: unknown }).mode);
  } catch {
    return DEFAULT_SUPPORT_AI_MODE;
  }
}

export async function writeSupportAiMode(mode: SupportAiMode, by: string): Promise<void> {
  const cursor = JSON.stringify({ mode, by, at: new Date().toISOString() });
  await db.syncState.upsert({ where: { key: SETTINGS_KEY }, create: { key: SETTINGS_KEY, cursor }, update: { cursor } });
}

export async function readSupportAi(ticketId: string): Promise<SupportAiRecord | null> {
  const row = await db.syncState.findUnique({ where: { key: RECORD_KEY(ticketId) } }).catch(() => null);
  return parseSupportAiRecord(row?.cursor);
}

/** The records of many tickets in one read, keyed by ticket id. */
export async function supportAiForTickets(ticketIds: string[]): Promise<Record<string, SupportAiRecord>> {
  if (!ticketIds.length) return {};
  const rows = await db.syncState.findMany({ where: { key: { in: ticketIds.map(RECORD_KEY) } } }).catch(() => []);
  const out: Record<string, SupportAiRecord> = {};
  for (const r of rows) {
    const rec = parseSupportAiRecord(r.cursor);
    if (rec) out[r.key.slice("supportAi:".length)] = rec;
  }
  return out;
}

async function writeSupportAi(ticketId: string, rec: SupportAiRecord): Promise<void> {
  const cursor = JSON.stringify(rec);
  await db.syncState.upsert({ where: { key: RECORD_KEY(ticketId) }, create: { key: RECORD_KEY(ticketId), cursor }, update: { cursor } });
}

// ── What the model is told about the customer ───────────────────────────────

const day = (d: Date | null | undefined) =>
  d ? d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }) : null;

type TicketRow = NonNullable<Awaited<ReturnType<typeof loadTicket>>>;

function loadTicket(ticketId: string) {
  return db.supportTicket.findUnique({
    where: { id: ticketId },
    include: {
      organization: {
        select: {
          id: true,
          name: true,
          billingEmail: true,
          createdAt: true,
          timezone: true,
          tradeTypesJson: true,
          smsFromNumber: true,
          smsClientsOn: true,
          logoUrl: true,
          deletedAt: true,
        },
      },
      user: { select: { id: true, email: true, name: true, emailVerified: true, hashedPassword: true, createdAt: true } },
    },
  });
}

/** Plain sentences about the account — accurate, and nothing the customer couldn't see themselves. */
async function accountFacts(t: TicketRow): Promise<string[]> {
  const org = t.organization;
  const facts: string[] = [];
  const [sub, membership, members, google, proposals, proposals30, clients, others, usage] = await Promise.all([
    db.subscription.findUnique({ where: { organizationId: org.id } }).catch(() => null),
    t.user ? db.membership.findFirst({ where: { organizationId: org.id, userId: t.user.id }, select: { role: true } }).catch(() => null) : null,
    db.membership.findMany({ where: { organizationId: org.id }, select: { role: true } }).catch(() => []),
    t.user ? db.account.count({ where: { userId: t.user.id, provider: "google" } }).catch(() => 0) : 0,
    db.proposal.count({ where: { organizationId: org.id } }).catch(() => null),
    db.proposal.count({ where: { organizationId: org.id, createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } } }).catch(() => null),
    db.client.count({ where: { organizationId: org.id } }).catch(() => null),
    db.supportTicket
      .findMany({ where: { organizationId: org.id, id: { not: t.id } }, orderBy: { createdAt: "desc" }, take: 4, select: { id: true, subject: true, status: true, createdAt: true } })
      .catch(() => []),
    getOrgLimitUsage(org.id).catch(() => []),
  ]);

  const who = t.user;
  if (who) {
    facts.push(`They are ${who.name?.trim() || "(no name on file)"}, ${who.email}${membership ? `, role ${membership.role} in the company` : ""}; user since ${day(who.createdAt)}.`);
    facts.push(
      `Signs in with ${[who.hashedPassword ? "email + password" : null, google ? "Google" : null].filter(Boolean).join(" and ") || "an unknown method"}; email ${who.emailVerified ? "verified" : "NOT verified"}.`,
    );
  } else {
    facts.push("Filed without a signed-in user on record; answers go to the account owner or billing email.");
  }
  facts.push(`Company: ${org.name}, on JobFlex since ${day(org.createdAt)}, timezone ${org.timezone}${org.deletedAt ? " — this company account is CLOSED" : ""}.`);
  try {
    const trades = JSON.parse(org.tradeTypesJson ?? "[]") as unknown;
    if (Array.isArray(trades) && trades.length) facts.push(`Trades: ${trades.slice(0, 6).join(", ")}.`);
  } catch {
    /* no trades */
  }
  facts.push(`Team: ${members.length} member${members.length === 1 ? "" : "s"} (${[...new Set(members.map((m) => m.role))].join(", ") || "none"}).`);
  if (sub) {
    const bits = [
      `Plan ${sub.plan}, status ${sub.status}`,
      sub.trialEndsAt ? `trial ${sub.trialEndsAt > new Date() ? "ends" : "ended"} ${day(sub.trialEndsAt)}` : null,
      sub.currentPeriodEnd ? `current period ends ${day(sub.currentPeriodEnd)}` : null,
      sub.canceledAt ? `canceled ${day(sub.canceledAt)}` : null,
      sub.externalSubId ? "has a Stripe subscription" : "no Stripe subscription on file",
    ].filter(Boolean);
    facts.push(`${bits.join("; ")}.`);
  } else {
    facts.push("No subscription row: on the free tier.");
  }
  const limited = usage.filter((u) => u.limit !== null);
  if (limited.length) facts.push(`Usage this period: ${limited.map((u) => `${u.resource} ${u.used}/${u.limit}`).join(", ")}.`);
  if (proposals !== null) facts.push(`Proposals: ${proposals} in total, ${proposals30 ?? 0} in the last 30 days. Clients: ${clients ?? 0}.`);
  facts.push(`Texting: ${org.smsFromNumber ? "has a JobFlex texting number" : "no texting number yet"}; texts to clients ${org.smsClientsOn ? "on" : "off"}. Logo ${org.logoUrl ? "uploaded" : "not uploaded"}.`);
  if (others.length) {
    facts.push(`Their other recent tickets: ${others.map((o) => `${supportTicketRef(o.id)} "${o.subject.slice(0, 60)}" (${o.status}, ${day(o.createdAt)})`).join("; ")}.`);
  }
  return facts;
}

// ── The call ─────────────────────────────────────────────────────────────────

/** Unmetered on purpose — see the header. Reads OPENAI_BASE_URL like the SDK always does. */
function supportClient(): OpenAI {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 1, timeout: 120_000 });
}

async function askModel(system: string, user: string): Promise<{ model: string; text: string }> {
  const model = await resolveOpenAIModel();
  const completion = await supportClient().chat.completions.create({
    model,
    ...(await samplingOptions(0.3)),
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
  });
  return { model, text: completion.choices[0]?.message?.content ?? "{}" };
}

// ── Sends ────────────────────────────────────────────────────────────────────

async function sendToCustomer(t: TicketRow, to: string, body: string, kind: NonNullable<SupportReply["kind"]>, base: string): Promise<SupportReply> {
  const letter = replyLetter({
    body,
    sender: TEAM_SIGNATURE,
    ticket: { subject: t.subject, body: t.body, ref: supportTicketRef(t.id), filedAt: t.createdAt.toISOString() },
    base,
    supportPage: await canOpenSupportPage(t, to),
  });
  await sendEmail({ to, subject: letter.subject, html: letter.html, text: letter.text, replyTo: REPLY_TO });
  const reply: SupportReply = { id: randomUUID(), at: new Date().toISOString(), by: TEAM_SIGNATURE, to, body, ai: true, kind };
  await addSupportReply(t.id, reply);
  return reply;
}

/** One send per address, as notifySupportTicket does — one bad address never silences the rest. */
async function sendToTeam(mail: { subject: string; html: string; text: string }, replyTo: string | null): Promise<boolean> {
  if (!isEmailEnabled()) return false;
  const to = await supportRecipients().catch(() => [] as string[]);
  let sent = 0;
  for (const address of to) {
    try {
      await sendEmail({ to: address, subject: mail.subject, html: mail.html, text: mail.text, replyTo: replyTo ?? undefined });
      sent += 1;
    } catch (err) {
      console.error(`[support-ai] copy to ${address} failed:`, err instanceof Error ? err.message : err);
    }
  }
  return sent > 0;
}

// ── Answering a ticket ───────────────────────────────────────────────────────

export interface AnswerOptions {
  /** "new": a ticket just filed — answers per the switch. "admin": Ask AI from admin — a draft, never sent. */
  trigger: "new" | "admin";
}

export async function answerTicketWithAi(ticketId: string, opts: AnswerOptions): Promise<SupportAiRecord | null> {
  const mode = await readSupportAiMode();
  if (opts.trigger === "new" && mode === "off") return null;
  const t = await loadTicket(ticketId);
  if (!t) return null;
  const at = new Date().toISOString();
  const ref = supportTicketRef(t.id);
  const base = await appBaseUrl();
  const link = `${base.replace(/\/$/, "")}/admin/support?ticket=${t.id}`;
  const customerEmail = t.user?.email ?? null;
  const ticketForMail = { ref, subject: t.subject, body: t.body, orgName: t.organization.name, customerEmail };
  const previous = await readSupportAi(t.id);

  const fail = async (model: string, reason: string) => {
    const rec = failedRecord(at, model, reason);
    if (previous?.fix) rec.fix = previous.fix;
    if (opts.trigger === "new") rec.copied = await sendToTeam(teamCopyEmail({ ticket: ticketForMail, record: rec, sentBody: null, facts: [], link }), customerEmail);
    await writeSupportAi(t.id, rec);
    return rec;
  };

  if (!isOpenAIEnabled()) return fail("-", "No OpenAI key on this server (OPENAI_API_KEY), so the AI cannot read tickets.");

  const [facts, thread, errors] = await Promise.all([
    accountFacts(t),
    readSupportReplies(t.id),
    recentServerErrors(t.organizationId).catch(() => [] as string[]),
  ]);
  let model = "-";
  let answer;
  try {
    const asked = await askModel(
      supportSystemPrompt(),
      supportUserPrompt({
        ticket: { ref, subject: t.subject, body: t.body, category: t.category, priority: t.priority, filedAt: t.createdAt.toISOString() },
        facts,
        thread: thread.map((r) => ({ by: r.by, at: r.at, body: r.body })),
        errors,
        appUrl: base,
      }),
    );
    model = asked.model;
    answer = supportAiAnswerSchema.parse(JSON.parse(asked.text));
  } catch (err) {
    console.error(`[support-ai] ${ref}: reading failed:`, err instanceof Error ? err.message : err);
    return fail(model, `The model call failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const effective: SupportAiMode = opts.trigger === "admin" ? "draft" : mode;
  const delivery = deliveryFor(answer, effective);
  const to = await recipientForTicket(t);
  const canMail = Boolean(to) && isEmailEnabled();
  let outcome: SupportAiOutcome = effective === "auto" ? "held" : "drafted";
  let reason: string | undefined;
  let sentBody: string | null = null;
  let ackSent = false;
  let statusTouched = false;

  if (delivery.send && canMail) {
    try {
      await sendToCustomer(t, to!, answer.reply, "answer", base);
      outcome = "sent";
      sentBody = answer.reply;
      statusTouched = true;
    } catch (err) {
      reason = `The answer didn't go out by email: ${err instanceof Error ? err.message : String(err)}`;
    }
  } else {
    reason = delivery.send ? (to ? "Email isn't set up on this server." : "This ticket has no address to answer.") : delivery.reason;
  }
  // Held in "answers on its own": the customer still hears from us at once.
  if (outcome === "held" && opts.trigger === "new" && canMail) {
    try {
      const note = holdingReply(firstNameOf(t.user?.name, customerEmail), t.subject);
      await sendToCustomer(t, to!, note, "ack", base);
      ackSent = true;
      sentBody = note;
      statusTouched = true;
    } catch (err) {
      console.error(`[support-ai] ${ref}: holding note failed:`, err instanceof Error ? err.message : err);
    }
  }
  if (statusTouched) {
    // In progress, and still UNREAD for the admins — an AI answer is one they should see.
    await db.supportTicket.update({ where: { id: t.id }, data: { status: statusAfterReply(t.status) } }).catch(() => {});
  }

  const rec = recordFor(answer, { at, model, outcome, reason, ackSent });
  // A fix already decided keeps its decision when the AI reads the ticket again.
  if (previous?.fix && previous.fix.status !== "awaiting") rec.fix = previous.fix;
  if (opts.trigger === "new") {
    rec.copied = await sendToTeam(teamCopyEmail({ ticket: ticketForMail, record: rec, sentBody, facts, link }), customerEmail);
  }
  await writeSupportAi(t.id, rec);
  console.info(`[support-ai] ${ref}: ${rec.outcome} · ${rec.category} · ${rec.confidence}%${rec.fix ? ` · fix ${rec.fix.status}` : ""}${reason ? ` · ${reason}` : ""}`);
  return rec;
}

// ── The customer's Help window ───────────────────────────────────────────────

type Who = { userId: string; organizationId: string };

/** Only the person who filed a ticket reads its live state, and only the words that went to them. */
async function ownTicket(ticketId: string, who: Who) {
  const t = await loadTicket(ticketId);
  return t && t.organizationId === who.organizationId && t.userId === who.userId ? t : null;
}

/** What the Help window shows for a ticket the customer just filed. Null: not theirs. */
export async function liveAnswerFor(ticketId: string, who: Who): Promise<LiveState | null> {
  const t = await ownTicket(ticketId, who);
  if (!t) return null;
  const [rec, thread, mode] = await Promise.all([readSupportAi(t.id), readSupportReplies(t.id), readSupportAiMode()]);
  return liveStateOf(rec, thread, { mode, aiOn: isOpenAIEnabled() });
}

/**
 * "That solved it" — the ticket is resolved. "I still need help" — it goes back
 * to Open and unread for the admins, the customer's note is kept on the AI's
 * record, and the support inbox hears that a person is needed.
 */
export async function recordCustomerVerdict(
  ticketId: string,
  who: Who,
  verdict: "solved" | "needs-person",
  note?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const t = await ownTicket(ticketId, who);
  if (!t) return { ok: false, error: "That ticket isn't one of yours." };
  const rec = await readSupportAi(t.id);
  if (!rec || rec.outcome !== "sent") return { ok: false, error: "There's no answer on this ticket yet." };
  const clean = note?.trim().slice(0, 2000) || undefined;
  rec.customer = { verdict, ...(clean ? { note: clean } : {}), at: new Date().toISOString() };
  await writeSupportAi(t.id, rec);
  if (verdict === "solved") {
    await db.supportTicket.update({ where: { id: t.id }, data: { status: "RESOLVED" } }).catch(() => {});
    return { ok: true };
  }
  await db.supportTicket.update({ where: { id: t.id }, data: { status: "OPEN", adminReadAt: null } }).catch(() => {});
  const base = await appBaseUrl();
  await sendToTeam(
    stillStuckEmail({
      ticket: { ref: supportTicketRef(t.id), subject: t.subject, body: t.body, orgName: t.organization.name, customerEmail: t.user?.email ?? null },
      answer: rec.reply,
      note: clean,
      link: `${base.replace(/\/$/, "")}/admin/support?ticket=${t.id}`,
    }),
    t.user?.email ?? null,
  );
  return { ok: true };
}

// ── The safety net ───────────────────────────────────────────────────────────

/** A ticket younger than this may still be in its own request's after(). */
const MISSED_AFTER_MS = 5 * 60_000;
/** Older than this, a person has the queue — the AI does not open a stale one. */
const MISSED_BEFORE_MS = 48 * 3600_000;

/**
 * New tickets the AI never read: Open, between 5 minutes and 2 days old, no
 * record, nobody has answered. A few per run, oldest first, each the same
 * answer a new ticket gets (the switch decides). Off, or without a key: none.
 */
export async function answerMissedTickets(limit = 4): Promise<{ checked: number; answered: number }> {
  if ((await readSupportAiMode()) === "off" || !isOpenAIEnabled()) return { checked: 0, answered: 0 };
  const now = Date.now();
  const rows = await db.supportTicket.findMany({
    where: { status: "OPEN", createdAt: { lte: new Date(now - MISSED_AFTER_MS), gte: new Date(now - MISSED_BEFORE_MS) } },
    orderBy: { createdAt: "asc" },
    take: 40,
    select: { id: true },
  });
  if (!rows.length) return { checked: 0, answered: 0 };
  const ids = rows.map((r) => r.id);
  const [records, threads] = await Promise.all([supportAiForTickets(ids), repliesForTickets(ids)]);
  const missed = ids.filter((id) => !records[id] && !threads[id]?.length).slice(0, limit);
  let answered = 0;
  for (const id of missed) {
    const rec = await answerTicketWithAi(id, { trigger: "new" }).catch((err) => {
      console.error(`[support-ai] safety net: ${supportTicketRef(id)} failed:`, err instanceof Error ? err.message : err);
      return null;
    });
    if (rec) answered += 1;
  }
  return { checked: rows.length, answered };
}

// ── The fix: approve, decline, done ──────────────────────────────────────────

export type FixResult = { ok: true; record: SupportAiRecord; reply?: SupportReply } | { ok: false; error: string };

export async function decideFix(
  ticketId: string,
  decision: "approve" | "decline",
  by: { id: string; email: string; name: string | null },
  note?: string,
): Promise<FixResult> {
  const rec = await readSupportAi(ticketId);
  if (!rec?.fix) return { ok: false, error: "This ticket has no fix proposal." };
  if (rec.fix.status === "done") return { ok: false, error: "This fix is already done." };
  const t = await loadTicket(ticketId);
  if (!t) return { ok: false, error: "That ticket is gone." };
  const who = by.name?.trim() || by.email;
  rec.fix = {
    ...rec.fix,
    status: decision === "approve" ? "approved" : "declined",
    decidedBy: who,
    decidedAt: new Date().toISOString(),
    ...(note?.trim() ? { note: note.trim().slice(0, 500) } : {}),
  };
  await writeSupportAi(ticketId, rec);
  if (decision === "approve") {
    const base = await appBaseUrl();
    const link = `${base.replace(/\/$/, "")}/admin/support?ticket=${ticketId}`;
    await sendToTeam(
      fixApprovedEmail({ ticket: { ref: supportTicketRef(t.id), subject: t.subject, body: t.body, orgName: t.organization.name }, fix: rec.fix, by: who, link }),
      t.user?.email ?? null,
    );
    // The approved fix lands on the team's board (/admin/tasks) — once.
    try {
      const { createTaskFromTicket } = await import("@/lib/adminTasks/service");
      await createTaskFromTicket(by, ticketId);
    } catch (err) {
      console.warn("[support-ai] no task for the approved fix:", err instanceof Error ? err.message : err);
    }
  }
  return { ok: true, record: rec };
}

/** The fix is live: the customer is told (by the AI's words, or the plain note), and the ticket is resolved. */
export async function markFixDone(ticketId: string, by: { email: string; name: string | null }): Promise<FixResult> {
  const rec = await readSupportAi(ticketId);
  if (!rec?.fix) return { ok: false, error: "This ticket has no fix proposal." };
  if (rec.fix.status !== "approved") return { ok: false, error: rec.fix.status === "done" ? "The customer was already told." : "Approve the fix first." };
  const t = await loadTicket(ticketId);
  if (!t) return { ok: false, error: "That ticket is gone." };
  const to = await recipientForTicket(t);
  if (!to) return { ok: false, error: "This ticket has no address to answer." };
  if (!isEmailEnabled()) return { ok: false, error: "Email isn't set up on this server, so the customer can't be told." };
  const name = firstNameOf(t.user?.name, t.user?.email);
  let body = fixedReplyTemplate(name, t.subject);
  if (isOpenAIEnabled()) {
    try {
      const asked = await askModel(FIXED_NOTE_RULES, fixedNoteUserPrompt({ firstName: name, subject: t.subject, message: t.body, fixTitle: rec.fix.title, note: rec.fix.note }));
      const written = String((JSON.parse(asked.text) as { reply?: unknown }).reply ?? "").trim();
      if (written.length >= 40 && written.length <= 2000) body = written;
    } catch (err) {
      console.warn("[support-ai] fixed note fell back to the template:", err instanceof Error ? err.message : err);
    }
  }
  const base = await appBaseUrl();
  let reply: SupportReply;
  try {
    reply = await sendToCustomer(t, to, body, "fixed", base);
  } catch (err) {
    return { ok: false, error: `The email didn't go out: ${err instanceof Error ? err.message : String(err)}` };
  }
  rec.fix = { ...rec.fix, status: "done", doneBy: by.name?.trim() || by.email, doneAt: new Date().toISOString() };
  await writeSupportAi(ticketId, rec);
  await db.supportTicket.update({ where: { id: ticketId }, data: { status: "RESOLVED" } }).catch(() => {});
  const ref = supportTicketRef(t.id);
  await sendToTeam(
    {
      subject: `[Fixed — customer told] ${ref} · ${rec.fix.title.slice(0, 90)}`,
      html: `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;color:#111">Marked fixed by ${escapeHtml(rec.fix.doneBy ?? "")}. Sent to ${escapeHtml(to)}:<div style="background:#eef6ef;border-radius:6px;padding:12px 14px;margin-top:8px;line-height:1.5">${escapeHtml(body).replace(/\n/g, "<br>")}</div></div>`,
      text: `Marked fixed by ${rec.fix.doneBy}. Sent to ${to}:\n\n${body}`,
    },
    t.user?.email ?? null,
  );
  return { ok: true, record: rec, reply };
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
