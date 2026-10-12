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
import {
  TaskError,
  addComment,
  addSubtask,
  createTask,
  createTaskFromTicket,
  getTaskDetail,
  removeSubtask,
  reorderSubtasks,
  updateSubtask,
  updateTaskField,
  type Actor,
  type NewTaskInput,
  type SubtaskPatch,
  type TaskField,
  type TaskWrite,
} from "@/lib/adminTasks/service";
import type { TaskDetailDTO } from "@/lib/adminTasks/model";

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
    if (w.notices.length > 0) {
      const base = await appBaseUrl();
      after(() => sendTaskNotices(w.notices, base));
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
