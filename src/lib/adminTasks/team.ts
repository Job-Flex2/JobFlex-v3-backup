import "server-only";
// THE JOBFLEX TEAM — server half (lib/adminTasks/teamShared is the pure half, teamStore the storage).
//
// Owner, 2026-10-15: "let's not do any logins — I just add their phone number; they receive the text because the team
// already has access to admin tasks". So the team is a list of names and mobiles the owner keeps on /admin/tasks; a
// new person gets one welcome text that says what these texts are and how to stop (STOP is honoured by lib/sms/send
// for every number). Texts go from JobFlex's own number (kind `jobflex-admin-task`: the daily cap and the delivery
// log apply), after the response; a failed text never fails a task write.
import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import { sendText, type SendTextResult } from "@/lib/sms/send";
import { jobflexSender } from "@/lib/sms/jobflexSender";
import { isTwilioEnabled } from "@/lib/sdk/twilio";
import { taskPath } from "./model";
import { sendTaskNotices } from "./mail";
import type { TaskReplyPlan } from "./textReply";
import { dropMemberAssignments, readAssignments, readMembers, writeMembers } from "./teamStore";
import { NAME_MAX, phoneE164, phoneWords, TEAM_MAX, TEAM_TZ, taskTextBody, textRecipients, welcomeTextBody, type LastText, type TaskText, type TeamMember, type TeamMemberView, type TextingStatus } from "./teamShared";

const KIND = "jobflex-admin-task";

/** The team as the sheet shows it: each person's open tasks, whether their last text arrived, whether they said STOP. */
export async function teamView(): Promise<TeamMemberView[]> {
  const [members, assign] = await Promise.all([readMembers(), readAssignments()]);
  const taskIds = Object.keys(assign);
  const phones = members.map((m) => m.phone);
  const [open, sent, stops, twilio] = await Promise.all([
    taskIds.length ? db.adminTask.findMany({ where: { id: { in: taskIds }, status: { in: ["TODO", "IN_PROGRESS", "BLOCKED"] } }, select: { id: true } }).catch(() => []) : [],
    phones.length
      ? db.smsMessage.findMany({ where: { kind: KIND, direction: "OUT", to: { in: phones } }, orderBy: { createdAt: "desc" }, take: 400, select: { to: true, status: true, error: true, createdAt: true } }).catch(() => [])
      : [],
    phones.length ? db.smsOptOut.findMany({ where: { phone: { in: phones } }, select: { phone: true } }).catch(() => []) : [],
    isTwilioEnabled().catch(() => false),
  ]);
  const count = new Map<string, number>();
  for (const t of open) count.set(assign[t.id], (count.get(assign[t.id]) ?? 0) + 1);
  const last = new Map<string, LastText>();
  // Without Twilio there is no JobFlex number either: say the real reason.
  for (const r of sent) if (!last.has(r.to)) last.set(r.to, { status: r.status, error: r.error === "no-number" && !twilio ? "not-configured" : r.error, at: r.createdAt.toISOString() });
  const stopped = new Set(stops.map((s) => s.phone));
  return members.map((m) => ({
    id: m.id,
    name: m.name,
    phone: phoneWords(m.phone),
    on: m.on,
    quietNights: m.quietNights,
    open: count.get(m.id) ?? 0,
    last: last.get(m.phone) ?? null,
    stopped: stopped.has(m.phone),
  }));
}

/** Can texts go at all from this server — Twilio set up, JobFlex's number approved. */
export async function textingStatus(): Promise<TextingStatus> {
  if (!(await isTwilioEnabled().catch(() => false))) return { ready: false, words: "Texting isn't set up on this server (no Twilio account), so no texts go out." };
  const from = await jobflexSender().catch(() => null);
  if (!from) return { ready: false, words: "Twilio hasn't approved JobFlex's number yet, so no texts go out." };
  return { ready: true, words: `Texts go out from JobFlex's number ${phoneWords(from)} through Twilio.` };
}

export type TeamWrite = { ok: true; note?: string } | { ok: false; error: string };

/** What became of a text, in words. `twilio`: is Twilio set up here at all (without it there is no number either). */
function sentWords(r: SendTextResult | null, twilio: boolean): string {
  if (!r) return "the text couldn't go out";
  if (r.ok && r.status !== "SKIPPED") return "texted";
  if (r.ok)
    return r.why === "not-configured" || (r.why === "no-number" && !twilio)
      ? "texting isn't set up on this server, so no text went"
      : r.why === "no-number"
        ? "Twilio hasn't approved JobFlex's number yet, so no text went"
        : "no text went";
  return r.reason === "opted-out"
    ? "they replied STOP earlier, so no text went (they text START to get them again)"
    : r.reason === "duplicate"
      ? "the same text went to them minutes ago"
      : r.reason === "cap"
        ? "today's texts for that number are used up"
      : r.reason === "invalid-number"
        ? "that number can't take texts"
        : "the text couldn't go out";
}

async function textOne(phone: string, body: string): Promise<SendTextResult | null> {
  try {
    return await sendText({ organizationId: null, to: phone, body, kind: KIND });
  } catch (err) {
    console.warn("[adminTasks] text not sent:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Someone onto the list: a name and a mobile; they get the welcome text. */
export async function addMember(nameRaw: string, phoneRaw: string, by: string | null): Promise<TeamWrite> {
  const name = (nameRaw ?? "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
  if (!name) return { ok: false, error: "Their name, please." };
  const phone = phoneE164(phoneRaw ?? "");
  if (!phone) return { ok: false, error: "That isn't a phone number — digits with the area code, like (425) 555-0100." };
  const list = await readMembers();
  if (list.length >= TEAM_MAX) return { ok: false, error: `The team holds ${TEAM_MAX} people.` };
  if (list.some((m) => m.phone === phone)) return { ok: false, error: "That number is already on the team." };
  const member: TeamMember = { id: randomBytes(6).toString("hex"), name, phone, on: true, quietNights: true, addedAt: new Date().toISOString() };
  await writeMembers([...list, member]);
  const r = await textOne(phone, welcomeTextBody(name, by));
  const sent = !!r && r.ok && r.status !== "SKIPPED";
  return { ok: true, note: `${name} is on the team — ${sent ? "texted a welcome that says how to stop" : sentWords(r, await isTwilioEnabled().catch(() => false))}.` };
}

/** A name, a number, texts on/off, quiet nights. */
export async function updateMember(id: string, patch: { name?: string; phone?: string; on?: boolean; quietNights?: boolean }): Promise<TeamWrite> {
  const list = await readMembers();
  const i = list.findIndex((m) => m.id === id);
  if (i < 0) return { ok: false, error: "That person isn't on the team any more." };
  const next = { ...list[i] };
  if (typeof patch.name === "string") {
    const name = patch.name.replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
    if (!name) return { ok: false, error: "Their name, please." };
    next.name = name;
  }
  if (typeof patch.phone === "string") {
    const phone = phoneE164(patch.phone);
    if (!phone) return { ok: false, error: "That isn't a phone number — digits with the area code, like (425) 555-0100." };
    if (list.some((m, k) => k !== i && m.phone === phone)) return { ok: false, error: "That number is already on the team." };
    next.phone = phone;
  }
  if (typeof patch.on === "boolean") next.on = patch.on;
  if (typeof patch.quietNights === "boolean") next.quietNights = patch.quietNights;
  const renamed = next.name !== list[i].name;
  list[i] = next;
  await writeMembers(list);
  if (renamed) {
    // Their tasks carry the new name to every open list (the live poll reads updatedAt).
    const assign = await readAssignments();
    const ids = Object.keys(assign).filter((k) => assign[k] === id);
    if (ids.length) await db.adminTask.updateMany({ where: { id: { in: ids } }, data: { updatedAt: new Date() } }).catch(() => undefined);
  }
  return { ok: true, note: "Saved." };
}

/** Off the list: their open tasks go back to nobody (and every admin's list shows it). */
export async function removeMember(id: string): Promise<TeamWrite> {
  const list = await readMembers();
  const m = list.find((x) => x.id === id);
  if (!m) return { ok: true };
  await db.$transaction(async (tx) => {
    await writeMembers(list.filter((x) => x.id !== id), tx);
    const ids = await dropMemberAssignments(id, tx);
    if (ids.length) {
      await tx.adminTask.updateMany({ where: { id: { in: ids } }, data: { updatedAt: new Date() } });
      for (const taskId of ids) await tx.adminTaskEvent.create({ data: { taskId, actorId: null, kind: "ASSIGNEE", from: m.name, to: null } });
    }
  });
  return { ok: true, note: `${m.name} is off the team.` };
}

/** "Send a test text" — proves the number before a real task needs it. */
export async function testMember(id: string): Promise<TeamWrite> {
  const m = (await readMembers()).find((x) => x.id === id);
  if (!m) return { ok: false, error: "That person isn't on the team any more." };
  // The time in it: the same words twice in 10 minutes count as a duplicate (lib/sms/send) and would not go.
  const at = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", timeZone: TEAM_TZ });
  const r = await textOne(m.phone, `JobFlex: test text (${at}) — ${m.name.split(/\s+/)[0]}, this phone gets the team's task texts. Reply STOP to stop.`);
  if (r && r.ok && r.status !== "SKIPPED") return { ok: true, note: `Test text sent to ${phoneWords(m.phone)} — the line below turns green when their carrier confirms it arrived.` };
  const why = sentWords(r, await isTwilioEnabled().catch(() => false));
  return { ok: false, error: `${why.charAt(0).toUpperCase()}${why.slice(1)}.` };
}

/** The texts a task write produced — after the response. Never throws. */
export async function sendTaskTexts(texts: TaskText[], baseUrl: string, now = new Date()): Promise<{ sent: number }> {
  if (!texts.length) return { sent: 0 };
  let sent = 0;
  try {
    const members = await readMembers();
    const base = baseUrl.replace(/\/$/, "");
    for (const t of texts) {
      const href = `${base}${taskPath(t.task.id)}`;
      for (const id of textRecipients(t, members, now)) {
        const m = members.find((x) => x.id === id)!;
        const r = await textOne(m.phone, taskTextBody(t, href));
        if (r?.ok && r.status !== "SKIPPED") sent += 1;
      }
    }
  } catch (err) {
    console.warn("[adminTasks] task texts skipped:", err instanceof Error ? err.message : err);
  }
  return { sent };
}

/** A reply from the team was answered (lib/adminTasks/textReply): text them what it did, then whoever else hears. */
export async function deliverTaskReply(plan: Extract<TaskReplyPlan, { handled: true }>, baseUrl: string): Promise<void> {
  await textOne(plan.member.phone, plan.reply);
  if (plan.texts.length) await sendTaskTexts(plan.texts, baseUrl);
  if (plan.notices.length) await sendTaskNotices(plan.notices, baseUrl).catch((err) => console.warn("[adminTasks] reply notice not sent:", err instanceof Error ? err.message : err));
}
