// ADMIN TASKS — the vocabulary and the pure rules (2026-10-11, /admin/tasks).
//
// Client-safe: no db, no next/*. The page, the sheet, the server service and
// scripts/qa/admin-tasks.check.ts all read the same lists and the same rules,
// so "what counts as open", "what progress means" and "who is the console"
// are said once.

export const PRIORITIES = ["URGENT", "HIGH", "NORMAL", "LOW"] as const;
export const STATUSES = ["TODO", "IN_PROGRESS", "BLOCKED", "DONE", "CANCELED"] as const;
export const CATEGORIES = ["BUG", "FEATURE", "SUPPORT", "BILLING", "MARKETING", "OTHER"] as const;

export type Priority = (typeof PRIORITIES)[number];
export type Status = (typeof STATUSES)[number];
export type Category = (typeof CATEGORIES)[number];

/** Statuses that keep a task on the Active tab. */
export const ACTIVE_STATUSES: readonly Status[] = ["TODO", "IN_PROGRESS", "BLOCKED"];
/** Statuses that send a task to Archive and stamp closedAt. */
export const CLOSED_STATUSES: readonly Status[] = ["DONE", "CANCELED"];

export const PRIORITY_LABEL: Record<Priority, string> = { URGENT: "Urgent", HIGH: "High", NORMAL: "Normal", LOW: "Low" };
export const STATUS_LABEL: Record<Status, string> = {
  TODO: "To do",
  IN_PROGRESS: "In progress",
  BLOCKED: "Blocked",
  DONE: "Done",
  CANCELED: "Canceled",
};
export const CATEGORY_LABEL: Record<Category, string> = {
  BUG: "Bug",
  FEATURE: "Feature",
  SUPPORT: "Support",
  BILLING: "Billing",
  MARKETING: "Marketing",
  OTHER: "Other",
};

/** Higher sorts first under "priority". */
export const PRIORITY_RANK: Record<Priority, number> = { URGENT: 3, HIGH: 2, NORMAL: 1, LOW: 0 };

export const TITLE_MAX = 200;
export const DESCRIPTION_MAX = 10_000;
export const COMMENT_MAX = 5_000;
export const SUBTASK_MAX = 200;
export const SUBTASKS_PER_TASK = 100;
export const LINK_MAX = 500;

export function isPriority(v: unknown): v is Priority {
  return typeof v === "string" && (PRIORITIES as readonly string[]).includes(v);
}
export function isStatus(v: unknown): v is Status {
  return typeof v === "string" && (STATUSES as readonly string[]).includes(v);
}
export function isCategory(v: unknown): v is Category {
  return typeof v === "string" && (CATEGORIES as readonly string[]).includes(v);
}
export function isClosed(status: string): boolean {
  return (CLOSED_STATUSES as readonly string[]).includes(status);
}
export function isActive(status: string): boolean {
  return (ACTIVE_STATUSES as readonly string[]).includes(status);
}

export function priorityLabel(p: string): string {
  return isPriority(p) ? PRIORITY_LABEL[p] : p;
}
export function statusLabel(s: string): string {
  return isStatus(s) ? STATUS_LABEL[s] : s;
}
export function categoryLabel(c: string): string {
  return isCategory(c) ? CATEGORY_LABEL[c] : c;
}

// ── People ─────────────────────────────────────────────────────────

/** The shared username/password door mints its principal at this domain
 *  (actions/adminAuth). It may read and create, but is nobody to assign to. */
export const CONSOLE_EMAIL_DOMAIN = "@platform.jobflex.local";

export function isConsoleEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith(CONSOLE_EMAIL_DOMAIN);
}

/** How a person reads everywhere on the page and in the journal. */
export function personName(u: { email: string; name: string | null } | null | undefined): string {
  if (!u) return "Someone";
  if (isConsoleEmail(u.email)) return "Console";
  const n = u.name?.trim();
  return n || u.email;
}

// ── Days ───────────────────────────────────────────────────────────

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar day as "YYYY-MM-DD", or false. */
export function isDay(s: string): boolean {
  if (!DAY_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** The local calendar day of an instant (the viewer's own zone). */
export function localDay(at: Date | number = Date.now()): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const DAY_FMT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const DAY_FMT_Y = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** "Oct 14" (this year) or "Oct 14, 2027" — for a "YYYY-MM-DD" day. */
export function dayLabel(day: string | null | undefined, thisYear?: number): string {
  if (!day || !isDay(day)) return "";
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (thisYear ?? new Date().getFullYear()) === y ? DAY_FMT.format(dt) : DAY_FMT_Y.format(dt);
}

/** An open task whose due day is before today. */
export function isOverdue(t: { status: string; dueDate: string | null }, today: string): boolean {
  return !!t.dueDate && isActive(t.status) && t.dueDate < today;
}

// ── Links ──────────────────────────────────────────────────────────

/** The related-object field: an app path ("/admin/…") or an http(s) URL.
 *  Returns the cleaned value, "" for empty, or null when it is neither. */
export function cleanLink(raw: string): string | null {
  const v = raw.trim();
  if (!v) return "";
  if (v.length > LINK_MAX) return null;
  if (v.startsWith("/") && !v.startsWith("//")) return v;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

// ── Progress ───────────────────────────────────────────────────────

export type ProgressBand = "none" | "partial" | "done";

export interface Progress {
  /** 0…1, what the bar draws. */
  ratio: number;
  band: ProgressBand;
  /** "3 / 5" with subtasks; the state in words without. */
  label: string;
  /** True when the figure comes from subtasks, false when from the status. */
  fromSubtasks: boolean;
}

/**
 * The share of subtasks done ("3 / 5"). With no subtasks the status stands in:
 * To do and Canceled are not started, In progress and Blocked are under way,
 * Done is done.
 */
export function progressOf(t: { status: string; subtasksDone: number; subtasksTotal: number }): Progress {
  if (t.subtasksTotal > 0) {
    const ratio = Math.min(1, t.subtasksDone / t.subtasksTotal);
    return {
      ratio,
      band: ratio >= 1 ? "done" : ratio > 0 ? "partial" : "none",
      label: `${t.subtasksDone} / ${t.subtasksTotal}`,
      fromSubtasks: true,
    };
  }
  switch (t.status) {
    case "DONE":
      return { ratio: 1, band: "done", label: "Done", fromSubtasks: false };
    case "IN_PROGRESS":
    case "BLOCKED":
      return { ratio: 0.5, band: "partial", label: "Under way", fromSubtasks: false };
    default:
      return { ratio: 0, band: "none", label: "Not started", fromSubtasks: false };
  }
}

// ── DTOs (server → client, JSON-safe) ──────────────────────────────

export interface AdminPersonDTO {
  id: string;
  name: string;
  email: string;
}

export interface TaskRowDTO {
  id: string;
  title: string;
  description: string;
  priority: string;
  status: string;
  category: string;
  assigneeId: string | null;
  assigneeName: string | null;
  authorId: string | null;
  authorName: string;
  dueDate: string | null;
  linkUrl: string | null;
  supportTicketId: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  subtasksDone: number;
  subtasksTotal: number;
  comments: number;
  /** How many pictures the task carries (2026-10-15). */
  pictures: number;
}

/** A picture on a task, as a page shows it: a short signed link (lib/adminTasks/pictures). */
export interface PictureDTO {
  id: string;
  href: string;
  name: string;
  by: string | null;
  byName: string;
  at: string;
}

export interface SubtaskDTO {
  id: string;
  title: string;
  done: boolean;
  assigneeId: string | null;
  position: number;
}

export type FeedItemDTO =
  | { type: "comment"; id: string; at: string; actorId: string | null; actorName: string; body: string }
  | { type: "event"; id: string; at: string; actorId: string | null; actorName: string; kind: string; from: string | null; to: string | null };

export interface TaskDetailDTO extends TaskRowDTO {
  subtasks: SubtaskDTO[];
  /** Comments and journal entries, oldest first. */
  feed: FeedItemDTO[];
  /** Its pictures, oldest first. */
  photos: PictureDTO[];
}

/** The list row a detail implies — the open sheet and its row never disagree. */
export function rowFromDetail(d: TaskDetailDTO): TaskRowDTO {
  const { subtasks, feed, photos, ...row } = d;
  return {
    ...row,
    subtasksTotal: subtasks.length,
    subtasksDone: subtasks.filter((s) => s.done).length,
    comments: feed.filter((f) => f.type === "comment").length,
    pictures: photos.length,
  };
}

/** The journal entry in words, without the actor ("changed status to Done"). */
export function eventWords(e: { kind: string; from: string | null; to: string | null }): string {
  const q = (s: string | null) => (s ? `“${s}”` : "");
  switch (e.kind) {
    case "CREATED":
      return "created the task";
    case "TITLE":
      return `renamed the task to ${q(e.to)}`;
    case "STATUS":
      return `changed the status from ${e.from ?? "—"} to ${e.to ?? "—"}`;
    case "PRIORITY":
      return `changed the priority from ${e.from ?? "—"} to ${e.to ?? "—"}`;
    case "ASSIGNEE":
      return e.to ? `assigned it to ${e.to}` : `unassigned ${e.from ?? "it"}`;
    case "DUE":
      return e.to ? `set the due date to ${e.to}` : "removed the due date";
    case "CATEGORY":
      return `changed the category to ${e.to ?? "—"}`;
    case "DESCRIPTION":
      return "edited the description";
    case "LINK":
      return e.to ? "set the related link" : "removed the related link";
    case "SUBTASK_ADDED":
      return `added the subtask ${q(e.to)}`;
    case "SUBTASK_DONE":
      return `checked off ${q(e.to)}`;
    case "SUBTASK_REOPENED":
      return `unchecked ${q(e.to)}`;
    case "SUBTASK_RENAMED":
      return `renamed the subtask ${q(e.from)} to ${q(e.to)}`;
    case "SUBTASK_REMOVED":
      return `removed the subtask ${q(e.from)}`;
    case "SUBTASK_ASSIGNED":
      return e.to ? `gave ${q(e.from)} to ${e.to}` : `unassigned the subtask ${q(e.from)}`;
    case "PICTURE_ADDED":
      return `added a picture${e.to ? ` (${e.to})` : ""}`;
    case "PICTURE_REMOVED":
      return `removed a picture${e.from ? ` (${e.from})` : ""}`;
    case "TAKEN":
      return e.from ? `took the task from ${e.from}` : "took the task";
    case "TAKEN_STARTED":
      return `${e.from ? `took the task from ${e.from}` : "took the task"} — now In progress`;
    default:
      return "changed the task";
  }
}

// ── Who hears of a change by email ─────────────────────────────────
// Never the person who made the change, never the console's shared address.

export interface Mailable {
  id: string;
  email: string;
}

/** The new assignee hears of it — unless they assigned themselves. */
export function emailsAssignee(prevAssigneeId: string | null, next: Mailable | null, actorId: string): boolean {
  return !!next && next.id !== prevAssigneeId && next.id !== actorId && !isConsoleEmail(next.email);
}

/** The author hears their task was closed (Done or Canceled) — unless they closed it. */
export function emailsAuthorOnClose(prevStatus: string, nextStatus: string, author: Mailable | null, actorId: string): boolean {
  return !!author && !isClosed(prevStatus) && isClosed(nextStatus) && author.id !== actorId && !isConsoleEmail(author.email);
}

/** The task's address on the console — the deep link the emails carry. */
export function taskPath(id: string): string {
  return `/admin/tasks?task=${encodeURIComponent(id)}`;
}

/** Short reference for a task, like the support ticket's (T-XXXXXX). */
export function taskRef(id: string): string {
  return `T-${id.slice(-6).toUpperCase()}`;
}
