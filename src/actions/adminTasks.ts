"use server";

// ADMIN TASKS — the server actions behind /admin/tasks (2026-10-11).
//
// Every action proves the caller is a platform admin first (requirePlatformAdmin,
// cookie door or flagged session) and answers with a value, never a throw: a
// thrown server-action message is withheld in production and the sheet would
// show nothing useful. The work itself is lib/adminTasks/service.
//
// Emails (a task given to someone, a task closed for its author) go out after
// the response (next/server after), so the sheet never waits on the mail.
//
// No revalidatePath: the page keeps its own state and the live poll
// (/api/admin/tasks/changes) carries every change to the other admins. A
// revalidation would re-render the whole route under the person typing.

import { after } from "next/server";
import { requirePlatformAdmin } from "@/lib/orgContext";
import { appBaseUrl } from "@/lib/appUrl";
import { sendTaskNotices } from "@/lib/adminTasks/mail";
import { PictureError, removeTaskPicture } from "@/lib/adminTasks/pictures";
import { addMember, removeMember, sendTaskTexts, teamView, testMember, textingStatus, updateMember, type TeamWrite } from "@/lib/adminTasks/team";
import { isAlertKey, type AlertKey, type TeamMemberView, type TextingStatus } from "@/lib/adminTasks/teamShared";
import { alertSettings, setSurgeThreshold, SURGE_DEFAULT } from "@/lib/adminAlerts";
import {
  TaskError,
  addComment,
  addSubtask,
  createTask,
  createTaskFromTicket,
  getTaskDetail,
  removeSubtask,
  takeTask,
  taskPeople,
  reorderSubtasks,
  updateSubtask,
  updateTaskField,
  type Actor,
  type NewTaskInput,
  type SubtaskPatch,
  type TaskField,
  type TaskWrite,
} from "@/lib/adminTasks/service";
import { isConsoleEmail, type AdminPersonDTO, type TaskDetailDTO } from "@/lib/adminTasks/model";

export type TaskResult = { ok: true; task: TaskDetailDTO } | { ok: false; error: string };

const DENIED = "Only platform admins can use the task tracker. Sign in again at /admin/login.";

async function asAdmin(): Promise<Actor | null> {
  try {
    const a = await requirePlatformAdmin();
    return { id: a.id, email: a.email, name: a.name };
  } catch {
    return null;
  }
}

function isId(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= 64;
}

async function run(write: (actor: Actor) => Promise<TaskWrite>): Promise<TaskResult> {
  const actor = await asAdmin();
  if (!actor) return { ok: false, error: DENIED };
  try {
    const w = await write(actor);
    if (w.notices.length > 0 || w.texts?.length) {
      const base = await appBaseUrl();
      if (w.notices.length > 0) after(() => sendTaskNotices(w.notices, base));
      // The team's texts (2026-10-15): who took it, who has it, what got done.
      if (w.texts?.length) after(() => sendTaskTexts(w.texts!, base).then(() => undefined));
    }
    return { ok: true, task: w.task };
  } catch (err) {
    if (err instanceof TaskError) return { ok: false, error: err.message };
    console.error("[adminTasks] write failed:", err);
    return { ok: false, error: "Couldn't save that. Check your connection and try again." };
  }
}

export async function getAdminTask(taskId: string): Promise<TaskResult> {
  const actor = await asAdmin();
  if (!actor) return { ok: false, error: DENIED };
  if (!isId(taskId)) return { ok: false, error: "That task doesn't exist." };
  const task = await getTaskDetail(taskId);
  return task ? { ok: true, task } : { ok: false, error: "That task doesn't exist." };
}

export async function createAdminTask(input: NewTaskInput): Promise<TaskResult> {
  return run((actor) => createTask(actor, input ?? { title: "" }));
}

export async function updateAdminTaskField(taskId: string, field: TaskField, value: string | null): Promise<TaskResult> {
  if (!isId(taskId)) return { ok: false, error: "That task doesn't exist." };
  return run((actor) => updateTaskField(actor, taskId, field, value));
}

export async function addAdminSubtask(taskId: string, title: string): Promise<TaskResult> {
  if (!isId(taskId)) return { ok: false, error: "That task doesn't exist." };
  return run((actor) => addSubtask(actor, taskId, title));
}

export async function updateAdminSubtask(subtaskId: string, patch: SubtaskPatch): Promise<TaskResult> {
  if (!isId(subtaskId) || !patch || typeof patch !== "object") return { ok: false, error: "That subtask was removed." };
  return run((actor) => updateSubtask(actor, subtaskId, patch));
}

export async function removeAdminSubtask(subtaskId: string): Promise<TaskResult> {
  if (!isId(subtaskId)) return { ok: false, error: "That subtask was already removed." };
  return run((actor) => removeSubtask(actor, subtaskId));
}

export async function reorderAdminSubtasks(taskId: string, orderedIds: string[]): Promise<TaskResult> {
  if (!isId(taskId)) return { ok: false, error: "That task doesn't exist." };
  return run((actor) => reorderSubtasks(actor, taskId, orderedIds));
}

export async function addAdminTaskComment(taskId: string, body: string): Promise<TaskResult> {
  if (!isId(taskId)) return { ok: false, error: "That task doesn't exist." };
  return run((actor) => addComment(actor, taskId, body));
}

/** /admin/support's "Create task": a Support task from the ticket, or the one already made. */
export async function createTaskFromSupportTicket(ticketId: string): Promise<TaskResult & { existed?: boolean }> {
  if (!isId(ticketId)) return { ok: false, error: "That ticket no longer exists." };
  let existed = false;
  const r = await run(async (actor) => {
    const w = await createTaskFromTicket(actor, ticketId);
    existed = w.existed;
    return w;
  });
  return r.ok ? { ...r, existed } : r;
}

/* ── take it, pictures, the team (2026-10-15) ───────────────────────────────── */

/** "I'll take it": the screen is shared, so it says who — someone on the team list ("m:<id>"). The team hears. */
export async function takeAdminTask(taskId: string, who: string): Promise<TaskResult> {
  if (!isId(taskId)) return { ok: false, error: "That task doesn't exist." };
  if (!isId(who)) return { ok: false, error: "Pick who's taking it." };
  return run((actor) => takeTask(actor, taskId, who));
}

/** A picture off a task (uploads go through /api/admin/tasks/[id]/pictures). */
export async function removeAdminTaskPicture(taskId: string, pictureId: string): Promise<TaskResult> {
  const actor = await asAdmin();
  if (!actor) return { ok: false, error: DENIED };
  if (!isId(taskId) || !isId(pictureId)) return { ok: false, error: "That picture doesn't exist." };
  try {
    await removeTaskPicture({ id: actor.id }, taskId, pictureId);
    const task = await getTaskDetail(taskId);
    return task ? { ok: true, task } : { ok: false, error: "This task no longer exists." };
  } catch (err) {
    if (err instanceof PictureError) return { ok: false, error: err.message };
    console.error("[adminTasks] picture removal failed:", err);
    return { ok: false, error: "Couldn't remove it. Try again." };
  }
}

/** The team sheet's answer: the list, everyone a task can go to now, whether texts can go at all, and the alert dial. */
export type TeamResult = { ok: true; team: TeamMemberView[]; people: AdminPersonDTO[]; texting: TextingStatus; surgeThreshold: number; note?: string } | { ok: false; error: string };

async function teamNow(note?: string): Promise<TeamResult> {
  const [team, people, texting, alerts] = await Promise.all([teamView(), taskPeople(), textingStatus(), alertSettings().catch(() => ({ surgeThreshold: SURGE_DEFAULT }))]);
  return { ok: true, team, people, texting, surgeThreshold: alerts.surgeThreshold, note };
}

async function teamRun(write: (actor: Actor) => Promise<TeamWrite>): Promise<TeamResult> {
  const actor = await asAdmin();
  if (!actor) return { ok: false, error: DENIED };
  try {
    const w = await write(actor);
    return w.ok ? await teamNow(w.note) : w;
  } catch (err) {
    console.error("[adminTasks] team write failed:", err);
    return { ok: false, error: "Couldn't save that. Try again." };
  }
}

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");

/** The team: names, phones, did their texts arrive. */
export async function getAdminTeam(): Promise<TeamResult> {
  if (!(await asAdmin())) return { ok: false, error: DENIED };
  return teamNow();
}

/** Someone onto the team — a name and a mobile; they get one welcome text. */
export async function addAdminTeamMember(name: string, phone: string): Promise<TeamResult> {
  return teamRun((actor) => addMember(clip(name, 120), clip(phone, 40), isConsoleEmail(actor.email) ? null : actor.name));
}

export async function updateAdminTeamMember(memberId: string, patch: { name?: string; phone?: string; on?: boolean; quietNights?: boolean; alerts?: string[]; alertSet?: { key: string; on: boolean } }): Promise<TeamResult> {
  if (!isId(memberId)) return { ok: false, error: "That person isn't on the team any more." };
  const p = patch && typeof patch === "object" ? patch : {};
  const alerts = Array.isArray(p.alerts) ? (p.alerts.filter(isAlertKey) as AlertKey[]).slice(0, 8) : undefined;
  const alertSet = p.alertSet && isAlertKey(p.alertSet.key) && typeof p.alertSet.on === "boolean" ? { key: p.alertSet.key as AlertKey, on: p.alertSet.on } : undefined;
  return teamRun(() =>
    updateMember(memberId, {
      name: typeof p.name === "string" ? clip(p.name, 120) : undefined,
      phone: typeof p.phone === "string" ? clip(p.phone, 40) : undefined,
      on: typeof p.on === "boolean" ? p.on : undefined,
      quietNights: typeof p.quietNights === "boolean" ? p.quietNights : undefined,
      alerts,
      alertSet,
    }),
  );
}

/** The traffic-surge dial: how many visitors at once count as "busy" (the five-minute cron reads it). */
export async function setAdminSurgeThreshold(n: number): Promise<TeamResult> {
  const v = Number(n);
  if (!Number.isFinite(v)) return { ok: false, error: "A number of visitors, like 10." };
  return teamRun(async () => {
    await setSurgeThreshold(v);
    return { ok: true, note: "Saved." };
  });
}

/** Off the team: their open tasks go back to nobody. */
export async function removeAdminTeamMember(memberId: string): Promise<TeamResult> {
  if (!isId(memberId)) return { ok: false, error: "That person isn't on the team any more." };
  return teamRun(() => removeMember(memberId));
}

/** "Send a test text" — proves the number before a task needs it. */
export async function testAdminTeamText(memberId: string): Promise<TeamResult> {
  if (!isId(memberId)) return { ok: false, error: "That person isn't on the team any more." };
  return teamRun(() => testMember(memberId));
}
