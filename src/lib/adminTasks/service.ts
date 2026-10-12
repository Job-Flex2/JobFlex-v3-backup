// ADMIN TASKS — the reads and writes (2026-10-11, /admin/tasks).
//
// SERVER ONLY (Prisma). The caller has already proved the actor is a platform
// admin — actions/adminTasks.ts and /api/admin/tasks/changes call
// requirePlatformAdmin first and pass the row in. Nothing here reads cookies,
// so scripts/qa/admin-tasks.check.ts can drive the same code on throwaway rows.
//
// THE LIVE RULE. Every write — a field, a subtask, a comment — ends by setting
// the task's updatedAt inside the same transaction, and changesSince() reads
// nothing but that column. One index, one comparison, no per-viewer state.
//
// ONE FIELD PER WRITE. updateTaskField() changes exactly one column, so two
// admins editing different fields of one task never overwrite each other;
// two editing the same field is last-write-wins, and both writes are in the
// journal.
//
// Errors meant for the reader are TaskError; the action layer returns their
// message as a value (a thrown server-action message is withheld in prod).

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  COMMENT_MAX,
  CONSOLE_EMAIL_DOMAIN,
  DESCRIPTION_MAX,
  SUBTASKS_PER_TASK,
  SUBTASK_MAX,
  TITLE_MAX,
  ACTIVE_STATUSES,
  categoryLabel,
  cleanLink,
  dayLabel,
  emailsAssignee,
  emailsAuthorOnClose,
  isCategory,
  isClosed,
  isDay,
  isPriority,
  isStatus,
  personName,
  priorityLabel,
  statusLabel,
  type AdminPersonDTO,
  type FeedItemDTO,
  type TaskDetailDTO,
  type TaskRowDTO,
} from "./model";

export class TaskError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskError";
  }
}

export interface Actor {
  id: string;
  email: string;
  name: string | null;
}

/** An email the action layer sends after the response (never the actor). */
export type TaskNotice =
  | { kind: "assigned"; to: { email: string; name: string }; by: string; task: { id: string; title: string; priority: string; dueDate: string | null; description: string } }
  | { kind: "closed"; to: { email: string; name: string }; by: string; task: { id: string; title: string; status: string } };

export interface TaskWrite {
  task: TaskDetailDTO;
  notices: TaskNotice[];
}

type Tx = Prisma.TransactionClient;
/** The app's client, a transaction, or (in the check) a stand-in. */
type Client = Tx | typeof db;

const PERSON = { select: { id: true, email: true, name: true } } as const;

const ROW_INCLUDE = {
  assignee: PERSON,
  author: PERSON,
  subtasks: { select: { done: true } },
  _count: { select: { comments: true } },
} satisfies Prisma.AdminTaskInclude;

type RowRecord = Prisma.AdminTaskGetPayload<{ include: typeof ROW_INCLUDE }>;

/** The list keeps everything; a cap only so a runaway table cannot stall the page. */
const LIST_CAP = 3000;

function toRow(t: RowRecord): TaskRowDTO {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    priority: t.priority,
    status: t.status,
    category: t.category,
    assigneeId: t.assigneeId,
    assigneeName: t.assignee ? personName(t.assignee) : null,
    authorId: t.authorId,
    authorName: personName(t.author),
    dueDate: t.dueDate,
    linkUrl: t.linkUrl,
    supportTicketId: t.supportTicketId,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    closedAt: t.closedAt ? t.closedAt.toISOString() : null,
    subtasksDone: t.subtasks.filter((s) => s.done).length,
    subtasksTotal: t.subtasks.length,
    comments: t._count.comments,
  };
}

// ── Reads ──────────────────────────────────────────────────────────

export async function listTasks(client: Client = db): Promise<TaskRowDTO[]> {
  const rows = await client.adminTask.findMany({ include: ROW_INCLUDE, orderBy: { updatedAt: "desc" }, take: LIST_CAP });
  return rows.map(toRow);
}

export async function getTaskDetail(id: string, client: Client = db): Promise<TaskDetailDTO | null> {
  const t = await client.adminTask.findUnique({
    where: { id },
    include: {
      ...ROW_INCLUDE,
      subtasks: { orderBy: [{ position: "asc" }, { createdAt: "asc" }] },
      comments: { orderBy: { createdAt: "asc" }, include: { author: PERSON } },
      events: { orderBy: { createdAt: "asc" }, include: { actor: PERSON } },
    },
  });
  if (!t) return null;
  const feed: FeedItemDTO[] = [
    ...t.comments.map((c) => ({
      type: "comment" as const,
      id: c.id,
      at: c.createdAt.toISOString(),
      actorId: c.authorId,
      actorName: personName(c.author),
      body: c.body,
    })),
    ...t.events.map((e) => ({
      type: "event" as const,
      id: e.id,
      at: e.createdAt.toISOString(),
      actorId: e.actorId,
      actorName: personName(e.actor),
      kind: e.kind,
      from: e.from,
      to: e.to,
    })),
  ].sort((a, b) => (a.at === b.at ? (a.type === b.type ? a.id.localeCompare(b.id) : a.type === "event" ? -1 : 1) : a.at < b.at ? -1 : 1));
  return {
    ...toRow({ ...t, subtasks: t.subtasks }),
    subtasks: t.subtasks.map((s) => ({ id: s.id, title: s.title, done: s.done, assigneeId: s.assigneeId, position: s.position })),
    feed,
  };
}

/**
 * What changed after `since`: every task whose updatedAt is later, and the
 * open task in full when it is one of them. `now` is read BEFORE the query, so
 * a write that lands while it runs is still later than the next `since`.
 */
export async function changesSince(since: Date, openId: string | null): Promise<{ now: string; rows: TaskRowDTO[]; detail: TaskDetailDTO | null }> {
  const now = new Date();
  const rows = (await db.adminTask.findMany({ where: { updatedAt: { gt: since } }, include: ROW_INCLUDE, orderBy: { updatedAt: "asc" }, take: 500 })).map(toRow);
  const detail = openId && rows.some((r) => r.id === openId) ? await getTaskDetail(openId) : null;
  return { now: now.toISOString(), rows, detail };
}

/** Who a task can be given to: platform admins with a real address. The
 *  console's shared login (…@platform.jobflex.local) is nobody to assign to. */
export async function assignableAdmins(client: Client = db): Promise<AdminPersonDTO[]> {
  const users = await client.user.findMany({
    where: { isPlatformAdmin: true, NOT: { email: { endsWith: CONSOLE_EMAIL_DOMAIN } } },
    select: { id: true, email: true, name: true },
  });
  return users
    .map((u) => ({ id: u.id, email: u.email, name: personName(u) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The nav badge: open tasks given to this admin. */
export async function myOpenTaskCount(userId: string, client: Client = db): Promise<number> {
  return client.adminTask.count({ where: { assigneeId: userId, status: { in: [...ACTIVE_STATUSES] } } });
}

/** ticketId → its task, for the support sheet's "Create task" / "Open task". */
export async function tasksForTickets(ticketIds: string[], client: Client = db): Promise<Record<string, { id: string; title: string; status: string }>> {
  if (ticketIds.length === 0) return {};
  const tasks = await client.adminTask.findMany({
    where: { supportTicketId: { in: ticketIds } },
    select: { id: true, title: true, status: true, supportTicketId: true },
  });
  const out: Record<string, { id: string; title: string; status: string }> = {};
  for (const t of tasks) if (t.supportTicketId) out[t.supportTicketId] = { id: t.id, title: t.title, status: t.status };
  return out;
}

// ── When the tracker's tables are not there ────────────────────────
// The tables are added to production by hand (prisma/sql/prod-2026-10-11-
// admin-tasks.sql), and a dev server started before `prisma generate` keeps a
// client that has never heard of them. Either way the rest of the console
// must keep working: the nav badge reads 0, /admin/support works without
// "Create task", and /admin/tasks says it is not set up — never a 500.

/** The error means the AdminTask* tables, or a client that knows them, are missing. */
export function trackerMissing(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  const msg = err instanceof Error ? err.message : String(err);
  const names = /AdminTask/.test(msg) || /AdminTask/.test(JSON.stringify((err as { meta?: unknown } | null)?.meta ?? ""));
  if ((code === "P2021" || code === "P2022") && names) return true;
  if (/no such table:\s*(main\.)?"?AdminTask/i.test(msg)) return true;
  if (/relation "AdminTask\w*" does not exist/i.test(msg)) return true;
  // An old generated client: `db.adminTask` is undefined.
  return err instanceof TypeError && /reading '(count|findMany|findUnique|findFirst|create)'/.test(msg);
}

/** The nav badge, never in the way: 0 (and a log line) when the count fails. */
export async function myOpenTaskCountSafe(userId: string, client: Client = db): Promise<number> {
  try {
    return await myOpenTaskCount(userId, client);
  } catch (err) {
    console.error(`[adminTasks] nav badge unavailable${trackerMissing(err) ? " (task tables missing)" : ""}:`, err instanceof Error ? err.message.slice(0, 200) : err);
    return 0;
  }
}

/** The support page's ticket → task map, or `available: false` when it can't be read. */
export async function tasksForTicketsSafe(
  ticketIds: string[],
  client: Client = db,
): Promise<{ available: boolean; tasks: Record<string, { id: string; title: string; status: string }> }> {
  try {
    // Asked even with no tickets, so "available" is a real answer.
    await client.adminTask.count({ where: { id: "" } });
    return { available: true, tasks: await tasksForTickets(ticketIds, client) };
  } catch (err) {
    console.error(`[adminTasks] support → task links unavailable${trackerMissing(err) ? " (task tables missing)" : ""}:`, err instanceof Error ? err.message.slice(0, 200) : err);
    return { available: false, tasks: {} };
  }
}

/** Everything /admin/tasks reads, or `missing` when the tracker isn't set up. Other errors throw. */
export async function loadTasksPage(
  openId: string | null,
  client: Client = db,
): Promise<{ status: "ready"; rows: TaskRowDTO[]; people: AdminPersonDTO[]; detail: TaskDetailDTO | null } | { status: "missing" }> {
  try {
    const [rows, people, detail] = await Promise.all([listTasks(client), assignableAdmins(client), openId ? getTaskDetail(openId, client) : Promise.resolve(null)]);
    return { status: "ready", rows, people, detail };
  } catch (err) {
    if (!trackerMissing(err)) throw err;
    console.error("[adminTasks] /admin/tasks: task tables missing —", err instanceof Error ? err.message.slice(0, 200) : err);
    return { status: "missing" };
  }
}

// ── Validation ─────────────────────────────────────────────────────

function cleanTitle(raw: unknown, what = "The title"): string {
  const v = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (!v) throw new TaskError(`${what} can't be empty.`);
  if (v.length > TITLE_MAX) throw new TaskError(`${what} is too long (${TITLE_MAX} characters at most).`);
  return v;
}

function cleanDescription(raw: unknown): string {
  const v = typeof raw === "string" ? raw.replace(/\r\n/g, "\n").replace(/\s+$/, "") : "";
  if (v.length > DESCRIPTION_MAX) throw new TaskError(`The description is too long (${DESCRIPTION_MAX.toLocaleString("en-US")} characters at most).`);
  return v;
}

async function assignable(client: Tx, id: string | null): Promise<{ id: string; email: string; name: string | null } | null> {
  if (id === null || id === "") return null;
  const u = await client.user.findUnique({ where: { id }, select: { id: true, email: true, name: true, isPlatformAdmin: true } });
  if (!u || !u.isPlatformAdmin || u.email.toLowerCase().endsWith(CONSOLE_EMAIL_DOMAIN)) {
    throw new TaskError("That person can't be given tasks — only platform admins with their own email.");
  }
  return u;
}

async function touch(tx: Tx, taskId: string): Promise<void> {
  await tx.adminTask.update({ where: { id: taskId }, data: { updatedAt: new Date() } });
}

async function event(tx: Tx, taskId: string, actorId: string, kind: string, from: string | null = null, to: string | null = null) {
  await tx.adminTaskEvent.create({ data: { taskId, actorId, kind, from, to } });
}

async function finish(tx: Tx, taskId: string): Promise<TaskDetailDTO> {
  const d = await getTaskDetail(taskId, tx);
  if (!d) throw new TaskError("This task no longer exists.");
  return d;
}

function assignedNotice(task: { id: string; title: string; priority: string; dueDate: string | null; description: string }, to: { email: string; name: string | null }, actor: Actor): TaskNotice {
  return {
    kind: "assigned",
    to: { email: to.email, name: personName({ email: to.email, name: to.name }) },
    by: personName(actor),
    task: { id: task.id, title: task.title, priority: task.priority, dueDate: task.dueDate, description: task.description },
  };
}

// ── Create ─────────────────────────────────────────────────────────

export interface NewTaskInput {
  title: unknown;
  description?: unknown;
  priority?: unknown;
  category?: unknown;
  assigneeId?: unknown;
  dueDate?: unknown;
  linkUrl?: unknown;
  status?: unknown;
}

export async function createTask(actor: Actor, input: NewTaskInput, extra?: { supportTicketId?: string }): Promise<TaskWrite> {
  const title = cleanTitle(input.title);
  const description = cleanDescription(input.description ?? "");
  const priority = input.priority === undefined || input.priority === "" ? "NORMAL" : input.priority;
  if (!isPriority(priority)) throw new TaskError("Pick a priority from the list.");
  const category = input.category === undefined || input.category === "" ? "OTHER" : input.category;
  if (!isCategory(category)) throw new TaskError("Pick a category from the list.");
  const status = input.status === undefined || input.status === "" ? "TODO" : input.status;
  if (!isStatus(status) || isClosed(status)) throw new TaskError("A new task starts open.");
  const dueDate = typeof input.dueDate === "string" && input.dueDate ? input.dueDate : null;
  if (dueDate !== null && !isDay(dueDate)) throw new TaskError("The due date isn't a real day.");
  const link = typeof input.linkUrl === "string" ? cleanLink(input.linkUrl) : "";
  if (link === null) throw new TaskError("The link must be an app path (/admin/…) or an http(s) address.");
  const assigneeId = typeof input.assigneeId === "string" && input.assigneeId ? input.assigneeId : null;

  return db.$transaction(async (tx) => {
    const assignee = await assignable(tx, assigneeId);
    const t = await tx.adminTask.create({
      data: {
        title,
        description,
        priority,
        category,
        status,
        dueDate,
        linkUrl: link || null,
        assigneeId: assignee?.id ?? null,
        authorId: actor.id,
        supportTicketId: extra?.supportTicketId ?? null,
      },
    });
    await event(tx, t.id, actor.id, "CREATED");
    if (assignee) await event(tx, t.id, actor.id, "ASSIGNEE", null, personName(assignee));
    const notices: TaskNotice[] = [];
    if (assignee && emailsAssignee(null, assignee, actor.id)) notices.push(assignedNotice(t, assignee, actor));
    return { task: await finish(tx, t.id), notices };
  });
}

// ── One field ──────────────────────────────────────────────────────

export type TaskField = "title" | "description" | "priority" | "status" | "category" | "assigneeId" | "dueDate" | "linkUrl";
export const TASK_FIELDS: readonly TaskField[] = ["title", "description", "priority", "status", "category", "assigneeId", "dueDate", "linkUrl"];

export async function updateTaskField(actor: Actor, taskId: string, field: TaskField, raw: unknown): Promise<TaskWrite> {
  if (!TASK_FIELDS.includes(field)) throw new TaskError("That field can't be changed.");
  return db.$transaction(async (tx) => {
    const t = await tx.adminTask.findUnique({ where: { id: taskId }, include: { assignee: PERSON, author: PERSON } });
    if (!t) throw new TaskError("This task no longer exists.");
    const notices: TaskNotice[] = [];
    let data: Prisma.AdminTaskUpdateInput | null = null;
    let log: [string, string | null, string | null] | null = null;

    switch (field) {
      case "title": {
        const v = cleanTitle(raw);
        if (v !== t.title) [data, log] = [{ title: v }, ["TITLE", t.title, v]];
        break;
      }
      case "description": {
        const v = cleanDescription(raw);
        if (v !== t.description) [data, log] = [{ description: v }, ["DESCRIPTION", null, null]];
        break;
      }
      case "priority": {
        if (!isPriority(raw)) throw new TaskError("Pick a priority from the list.");
        if (raw !== t.priority) [data, log] = [{ priority: raw }, ["PRIORITY", priorityLabel(t.priority), priorityLabel(raw)]];
        break;
      }
      case "category": {
        if (!isCategory(raw)) throw new TaskError("Pick a category from the list.");
        if (raw !== t.category) [data, log] = [{ category: raw }, ["CATEGORY", categoryLabel(t.category), categoryLabel(raw)]];
        break;
      }
      case "status": {
        if (!isStatus(raw)) throw new TaskError("Pick a status from the list.");
        if (raw !== t.status) {
          const closing = isClosed(raw);
          data = { status: raw, closedAt: closing ? (isClosed(t.status) && t.closedAt ? t.closedAt : new Date()) : null };
          log = ["STATUS", statusLabel(t.status), statusLabel(raw)];
          if (emailsAuthorOnClose(t.status, raw, t.author, actor.id) && t.author) {
            notices.push({ kind: "closed", to: { email: t.author.email, name: personName(t.author) }, by: personName(actor), task: { id: t.id, title: t.title, status: raw } });
          }
        }
        break;
      }
      case "assigneeId": {
        const next = await assignable(tx, typeof raw === "string" ? raw : null);
        if ((next?.id ?? null) !== t.assigneeId) {
          data = next ? { assignee: { connect: { id: next.id } } } : { assignee: { disconnect: true } };
          log = ["ASSIGNEE", t.assignee ? personName(t.assignee) : null, next ? personName(next) : null];
          if (next && emailsAssignee(t.assigneeId, next, actor.id)) notices.push(assignedNotice(t, next, actor));
        }
        break;
      }
      case "dueDate": {
        const v = typeof raw === "string" && raw ? raw : null;
        if (v !== null && !isDay(v)) throw new TaskError("The due date isn't a real day.");
        if (v !== t.dueDate) [data, log] = [{ dueDate: v }, ["DUE", t.dueDate ? dayLabel(t.dueDate) : null, v ? dayLabel(v) : null]];
        break;
      }
      case "linkUrl": {
        const v = cleanLink(typeof raw === "string" ? raw : "");
        if (v === null) throw new TaskError("The link must be an app path (/admin/…) or an http(s) address.");
        const next = v || null;
        if (next !== t.linkUrl) [data, log] = [{ linkUrl: next }, ["LINK", t.linkUrl, next]];
        break;
      }
    }

    if (data && log) {
      await tx.adminTask.update({ where: { id: taskId }, data });
      await event(tx, taskId, actor.id, ...log);
    }
    return { task: await finish(tx, taskId), notices };
  });
}

// ── Subtasks ───────────────────────────────────────────────────────

export async function addSubtask(actor: Actor, taskId: string, rawTitle: unknown): Promise<TaskWrite> {
  const title = cleanTitle(rawTitle, "A subtask");
  if (title.length > SUBTASK_MAX) throw new TaskError(`A subtask is ${SUBTASK_MAX} characters at most.`);
  return db.$transaction(async (tx) => {
    const t = await tx.adminTask.findUnique({ where: { id: taskId }, select: { id: true, _count: { select: { subtasks: true } } } });
    if (!t) throw new TaskError("This task no longer exists.");
    if (t._count.subtasks >= SUBTASKS_PER_TASK) throw new TaskError(`A task holds ${SUBTASKS_PER_TASK} subtasks at most.`);
    const last = await tx.adminTaskSubtask.findFirst({ where: { taskId }, orderBy: { position: "desc" }, select: { position: true } });
    await tx.adminTaskSubtask.create({ data: { taskId, title, position: (last?.position ?? -1) + 1 } });
    await event(tx, taskId, actor.id, "SUBTASK_ADDED", null, title);
    await touch(tx, taskId);
    return { task: await finish(tx, taskId), notices: [] };
  });
}

export type SubtaskPatch = { done: boolean } | { title: string } | { assigneeId: string | null };

export async function updateSubtask(actor: Actor, subtaskId: string, patch: SubtaskPatch): Promise<TaskWrite> {
  return db.$transaction(async (tx) => {
    const s = await tx.adminTaskSubtask.findUnique({ where: { id: subtaskId } });
    if (!s) throw new TaskError("That subtask was removed.");
    if ("done" in patch) {
      if (typeof patch.done !== "boolean") throw new TaskError("Check or uncheck the subtask.");
      if (patch.done !== s.done) {
        await tx.adminTaskSubtask.update({ where: { id: s.id }, data: { done: patch.done } });
        await event(tx, s.taskId, actor.id, patch.done ? "SUBTASK_DONE" : "SUBTASK_REOPENED", null, s.title);
      }
    } else if ("title" in patch) {
      const title = cleanTitle(patch.title, "A subtask");
      if (title.length > SUBTASK_MAX) throw new TaskError(`A subtask is ${SUBTASK_MAX} characters at most.`);
      if (title !== s.title) {
        await tx.adminTaskSubtask.update({ where: { id: s.id }, data: { title } });
        await event(tx, s.taskId, actor.id, "SUBTASK_RENAMED", s.title, title);
      }
    } else if ("assigneeId" in patch) {
      const next = await assignable(tx, patch.assigneeId);
      if ((next?.id ?? null) !== s.assigneeId) {
        await tx.adminTaskSubtask.update({ where: { id: s.id }, data: { assigneeId: next?.id ?? null } });
        await event(tx, s.taskId, actor.id, "SUBTASK_ASSIGNED", s.title, next ? personName(next) : null);
      }
    } else {
      throw new TaskError("Nothing to change.");
    }
    await touch(tx, s.taskId);
    return { task: await finish(tx, s.taskId), notices: [] };
  });
}

export async function removeSubtask(actor: Actor, subtaskId: string): Promise<TaskWrite> {
  return db.$transaction(async (tx) => {
    const s = await tx.adminTaskSubtask.findUnique({ where: { id: subtaskId } });
    if (!s) throw new TaskError("That subtask was already removed.");
    await tx.adminTaskSubtask.delete({ where: { id: s.id } });
    await event(tx, s.taskId, actor.id, "SUBTASK_REMOVED", s.title, null);
    await touch(tx, s.taskId);
    return { task: await finish(tx, s.taskId), notices: [] };
  });
}

/** `orderedIds` must be exactly the task's subtasks, in the new order. */
export async function reorderSubtasks(actor: Actor, taskId: string, orderedIds: unknown): Promise<TaskWrite> {
  if (!Array.isArray(orderedIds) || !orderedIds.every((x) => typeof x === "string")) throw new TaskError("The new order didn't arrive.");
  return db.$transaction(async (tx) => {
    const current = await tx.adminTaskSubtask.findMany({ where: { taskId }, select: { id: true } });
    const have = new Set(current.map((s) => s.id));
    if (current.length !== orderedIds.length || new Set(orderedIds).size !== orderedIds.length || !orderedIds.every((id) => have.has(id))) {
      throw new TaskError("The subtasks changed meanwhile — try again.");
    }
    for (let i = 0; i < orderedIds.length; i++) {
      await tx.adminTaskSubtask.update({ where: { id: orderedIds[i] as string }, data: { position: i } });
    }
    await touch(tx, taskId);
    return { task: await finish(tx, taskId), notices: [] };
  });
}

// ── Comments ───────────────────────────────────────────────────────

export async function addComment(actor: Actor, taskId: string, rawBody: unknown): Promise<TaskWrite> {
  const body = typeof rawBody === "string" ? rawBody.replace(/\r\n/g, "\n").trim() : "";
  if (!body) throw new TaskError("Write something first.");
  if (body.length > COMMENT_MAX) throw new TaskError(`A comment is ${COMMENT_MAX.toLocaleString("en-US")} characters at most.`);
  return db.$transaction(async (tx) => {
    const t = await tx.adminTask.findUnique({ where: { id: taskId }, select: { id: true } });
    if (!t) throw new TaskError("This task no longer exists.");
    await tx.adminTaskComment.create({ data: { taskId, authorId: actor.id, body } });
    await touch(tx, taskId);
    return { task: await finish(tx, taskId), notices: [] };
  });
}

// ── From a support ticket ──────────────────────────────────────────

/** A Support task from the ticket — or the one already made from it. */
export async function createTaskFromTicket(actor: Actor, ticketId: string): Promise<TaskWrite & { existed: boolean }> {
  const existing = await db.adminTask.findUnique({ where: { supportTicketId: ticketId }, select: { id: true } });
  if (existing) {
    const d = await getTaskDetail(existing.id);
    if (d) return { task: d, notices: [], existed: true };
  }
  const ticket = await db.supportTicket.findUnique({
    where: { id: ticketId },
    include: { organization: { select: { name: true } }, user: { select: { email: true } } },
  });
  if (!ticket) throw new TaskError("That ticket no longer exists.");
  const from = `${ticket.organization.name}${ticket.user?.email ? ` · ${ticket.user.email}` : ""}`;
  const body = `${ticket.body.trim()}\n\n— From ${from}`;
  try {
    const w = await createTask(
      actor,
      {
        title: ticket.subject.replace(/\s+/g, " ").trim().slice(0, TITLE_MAX) || "Support ticket",
        description: body.slice(0, DESCRIPTION_MAX),
        priority: ticket.priority === "high" ? "HIGH" : "NORMAL",
        category: "SUPPORT",
        linkUrl: `/admin/support?ticket=${encodeURIComponent(ticket.id)}`,
      },
      { supportTicketId: ticket.id },
    );
    return { ...w, existed: false };
  } catch (err) {
    // Two admins pressed it at once: the unique column let one through.
    if ((err as { code?: string })?.code === "P2002") {
      const won = await db.adminTask.findUnique({ where: { supportTicketId: ticketId }, select: { id: true } });
      const d = won ? await getTaskDetail(won.id) : null;
      if (d) return { task: d, notices: [], existed: true };
    }
    throw err;
  }
}
