"use client";

// ADMIN · TASKS — the small pieces both the list and the sheet draw with:
// the sprite icon, the priority / status stamps (the kit's 3-tone `.st`), the
// progress bar, and user text with its links made clickable.

import { useSyncExternalStore, type ReactNode } from "react";
import shared from "@/components/v3/admin-users/admin-shared.module.css";
import { makeCx } from "@/components/v3/admin-users/admin-kit";
import { localDay, priorityLabel, progressOf, statusLabel, type TaskRowDTO } from "@/lib/adminTasks/model";
import { localDayOf, utcDayOf } from "@/lib/adminTasks/filters";
import s from "./admin-tasks.module.css";

export const cx = makeCx(s, shared);

/** A symbol from the shell's sprite (proposals-blueprint/sprite.tsx). */
export function Ic({ name, className }: { name: string; className?: string }) {
  return (
    <svg className={cx("ic", className)} aria-hidden="true" focusable="false">
      <use href={`#i-${name}`} />
    </svg>
  );
}

export function priorityTone(p: string): string | false {
  switch (p) {
    case "URGENT":
      return "st--danger";
    case "HIGH":
      return "st--warn";
    case "LOW":
      return "priLow";
    default:
      return false;
  }
}

export function statusTone(st: string): string | false {
  switch (st) {
    case "IN_PROGRESS":
      return "st--bp";
    case "BLOCKED":
      return "st--warn";
    case "DONE":
      return "st--ok";
    case "CANCELED":
      return "stCanceled";
    default:
      return false;
  }
}

export function PriorityStamp({ priority }: { priority: string }) {
  return <span className={cx("st", priorityTone(priority))}>{priorityLabel(priority)}</span>;
}

export function StatusStamp({ status }: { status: string }) {
  return <span className={cx("st", statusTone(status))}>{statusLabel(status)}</span>;
}

/** The bar and its figure: "3 / 5" from subtasks, the state in words without. */
export function ProgressBar({ task, compact }: { task: Pick<TaskRowDTO, "status" | "subtasksDone" | "subtasksTotal">; compact?: boolean }) {
  const p = progressOf(task);
  const pct = Math.round(p.ratio * 100);
  return (
    <div className={cx("prog", compact && "progCompact")}>
      <div
        className={cx("progTrack")}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={p.fromSubtasks ? `${p.label} subtasks done` : p.label}
      >
        <span className={cx("progFill", p.band === "done" && "progDone")} style={{ width: `${pct}%` }} />
      </div>
      <span className={cx("progLbl")}>{p.label}</span>
    </div>
  );
}

const URL_RE = /(https?:\/\/[^\s<>"']+)/g;

/** User text, line breaks kept, every http(s) address a link. */
export function Linkified({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    let url = m[0];
    // A sentence's own full stop or bracket is not part of the address.
    const trail = /[.,;:!?)\]]+$/.exec(url)?.[0] ?? "";
    if (trail) url = url.slice(0, -trail.length);
    const at = m.index ?? 0;
    if (at > last) parts.push(text.slice(last, at));
    parts.push(
      <a key={at} href={url} target="_blank" rel="noopener noreferrer" className={cx("txtLink")}>
        {url}
      </a>,
    );
    last = at + url.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

// ── Today, on the viewer's own calendar ────────────────────────────
// The server renders with its own day; after hydration the viewer's day takes
// over and is re-read every minute, so "Overdue" turns at local midnight.

function subscribeMinute(cb: () => void) {
  const t = window.setInterval(cb, 60_000);
  return () => window.clearInterval(t);
}

export function useToday(serverToday: string): string {
  return useSyncExternalStore(subscribeMinute, () => localDay(), () => serverToday);
}

const STAMP = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const DAY_ONLY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

/** "Oct 11, 4:05 PM" in the viewer's zone (client only — after hydration). */
export function stampLabel(iso: string): string {
  return STAMP.format(new Date(iso));
}

/** "Oct 11, 2026" in the viewer's zone. */
export function dateLabel(iso: string): string {
  return DAY_ONLY.format(new Date(iso));
}

const subscribeNever = () => () => {};
/** False during SSR and hydration, true after — for anything in the viewer's zone. */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribeNever, () => true, () => false);
}

/** An instant's calendar day: UTC through hydration (what the server drew), the viewer's own after. */
export function useDayOf(): (iso: string) => string {
  return useHydrated() ? localDayOf : utcDayOf;
}
