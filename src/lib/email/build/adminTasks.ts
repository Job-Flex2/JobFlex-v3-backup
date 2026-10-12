// The admin task tracker's two emails (2026-10-11, /admin/tasks): a task was
// given to you, and a task you wrote was closed. Operator voice (operator.ts):
// a work item, not a letter — no greeting, no sign-off. Pure, no I/O; the
// sender is lib/adminTasks/mail, the gallery renders these from fixtures.
import type { BoxRow, EmailDoc, Lockup } from "../doc";
import { truncate } from "../fit";
import { dayLabel, priorityLabel, statusLabel } from "@/lib/adminTasks/model";

const PLATFORM_LOCKUP: Lockup = { kind: "platform" };
const TITLE_MAX = 90;

export interface TaskAssignedInput {
  title: string;
  by: string;
  priority: string;
  dueDate: string | null;
  description: string;
  href: string;
  ref: string;
}

export function buildTaskAssigned(i: TaskAssignedInput): EmailDoc {
  const urgent = i.priority === "URGENT" || i.priority === "HIGH";
  const box: BoxRow[] = [{ type: "field", label: "Priority", value: priorityLabel(i.priority) }];
  if (i.dueDate) box.push({ type: "cond", label: "Due", chip: dayLabel(i.dueDate), tone: urgent ? "bad" : undefined });
  const excerpt = i.description.trim();
  return {
    subject: `Task for you — ${truncate(i.title, 70)}`,
    lockup: PLATFORM_LOCKUP,
    kicker: urgent ? { text: `${priorityLabel(i.priority)} task`, tone: "bad" } : { text: "Task assigned" },
    headline: truncate(i.title, TITLE_MAX),
    prose: [`${i.by} gave you this task on the admin console.`],
    box,
    cta: { label: "Open the task", href: i.href },
    after: excerpt ? [truncate(excerpt, 600)] : undefined,
    footer: { name: "JobFlex admin", ref: i.ref },
  };
}

export interface TaskClosedInput {
  title: string;
  by: string;
  status: string;
  href: string;
  ref: string;
}

export function buildTaskClosed(i: TaskClosedInput): EmailDoc {
  const done = i.status === "DONE";
  return {
    subject: `${done ? "Done" : "Canceled"} — ${truncate(i.title, 70)}`,
    lockup: PLATFORM_LOCKUP,
    kicker: done ? { text: "Task done", tone: "ok" } : { text: "Task canceled" },
    headline: truncate(i.title, TITLE_MAX),
    prose: [`${i.by} marked the task you wrote as ${statusLabel(i.status).toLowerCase()}. It is in the archive now; it can be reopened from there.`],
    link: { label: "Open the task", href: i.href },
    footer: { name: "JobFlex admin", ref: i.ref },
  };
}
