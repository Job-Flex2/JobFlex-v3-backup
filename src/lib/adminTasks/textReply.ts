// A TEXT BACK FROM THE TEAM (owner, 2026-10-15: "make to mark to confirm they will do it task in sms reply").
//
// Someone on the team list answers a task text from their phone: OK takes the task or confirms the one given to
// them, DONE finishes it, NO hands it back, anything else lands on the task as their note (lib/adminTasks/teamShared
// parseTaskReply). The task is the one named in the reply ("T-3G60GE"), else the last task text that number got (its
// link carries the id) within two weeks. A number that isn't on the team, or a plain message from a team member who
// got no task text lately, is not ours: /api/twilio/sms goes on as before.
//
// This file decides; the webhook sends (lib/adminTasks/team deliverTaskReply), so the check can drive it without
// Twilio.

import { db } from "@/lib/db";
import { answerByText } from "./service";
import { readMembers } from "./teamStore";
import { parseTaskReply, phoneE164, replyTextBody, taskIdInText, type TaskText, type TeamMember } from "./teamShared";
import type { TaskNotice } from "./service";

const KIND = "jobflex-admin-task";
const LOOKBACK_MS = 14 * 86_400_000;

export type TaskReplyPlan =
  | { handled: false }
  | { handled: true; member: TeamMember; taskId: string | null; reply: string; texts: TaskText[]; notices: TaskNotice[] };

/** The task a reply is about: the one it names, else the last one texted to that number. */
async function taskFor(phone: string, ref: string | null, now: Date): Promise<string | null> {
  if (ref) {
    const named = await db.adminTask.findFirst({ where: { id: { endsWith: ref.toLowerCase() } }, orderBy: { createdAt: "desc" }, select: { id: true } });
    if (named) return named.id;
  }
  const sent = await db.smsMessage.findMany({
    where: { to: phone, direction: "OUT", kind: KIND, createdAt: { gte: new Date(now.getTime() - LOOKBACK_MS) } },
    orderBy: { createdAt: "desc" },
    take: 40,
    select: { body: true },
  });
  for (const s of sent) {
    const id = taskIdInText(s.body);
    if (id) return id;
  }
  return null;
}

export async function planTaskReply(fromRaw: string, body: string, now = new Date()): Promise<TaskReplyPlan> {
  const from = phoneE164(fromRaw);
  if (!from) return { handled: false };
  const member = (await readMembers()).find((m) => m.phone === from);
  if (!member) return { handled: false };
  const { intent, ref, note } = parseTaskReply(body);
  if (!note && intent === "note") return { handled: false };
  const taskId = await taskFor(from, ref, now);
  if (!taskId) {
    // A plain message with no task to hang it on is someone else's conversation; a command gets told why nothing changed.
    if (intent === "note") return { handled: false };
    return { handled: true, member, taskId: null, reply: replyTextBody("none", null, member.name), texts: [], notices: [] };
  }
  const a = await answerByText(member, taskId, intent, note);
  return { handled: true, member, taskId, reply: replyTextBody(a.outcome, a.title, member.name, a.holder), texts: a.texts, notices: a.notices };
}
