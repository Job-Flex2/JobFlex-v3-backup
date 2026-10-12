// ADMIN TASKS — the list's filters and sort, kept in the address (2026-10-11).
//
// Pure: the server page parses the same query the client writes back with
// history.replaceState, so a reload (or a shared link) shows the same list.
// Only values that differ from the defaults are written, so a plain
// /admin/tasks means "Active, priority first".
//
//   tab=archive · q= · pri=URGENT · who=me|none|<userId> · st=BLOCKED
//   prog=none|partial|done · cat=BUG · from=2026-10-01 · to=2026-10-11
//   sort=priority|created|due|updated · dir=asc|desc

import {
  PRIORITY_RANK,
  isActive,
  isCategory,
  isClosed,
  isDay,
  isPriority,
  isStatus,
  localDay,
  progressOf,
  type Priority,
  type ProgressBand,
  type TaskRowDTO,
} from "./model";

export type Tab = "active" | "archive";
export type SortKey = "priority" | "created" | "due" | "updated";
export type SortDir = "asc" | "desc";

export interface TaskFilters {
  tab: Tab;
  q: string;
  pri: string;
  /** "" any · "me" · "none" (unassigned) · a user id */
  who: string;
  st: string;
  prog: "" | ProgressBand;
  cat: string;
  from: string;
  to: string;
  sort: SortKey;
  dir: SortDir;
}

export const SORT_KEYS: readonly SortKey[] = ["priority", "created", "due", "updated"];
export const SORT_LABEL: Record<SortKey, string> = {
  priority: "Priority",
  created: "Date created",
  due: "Due date",
  updated: "Last change",
};

/** The direction each sort starts in: most urgent, newest, soonest, latest. */
export const DEFAULT_DIR: Record<SortKey, SortDir> = { priority: "desc", created: "desc", due: "asc", updated: "desc" };

/** Active opens on priority; Archive on what changed last (what was closed last). */
export function defaultSort(tab: Tab): SortKey {
  return tab === "archive" ? "updated" : "priority";
}

export function defaultFilters(tab: Tab = "active"): TaskFilters {
  const sort = defaultSort(tab);
  return { tab, q: "", pri: "", who: "", st: "", prog: "", cat: "", from: "", to: "", sort, dir: DEFAULT_DIR[sort] };
}

type Params = URLSearchParams | Record<string, string | string[] | undefined>;

function read(p: Params, key: string): string {
  if (p instanceof URLSearchParams) return p.get(key) ?? "";
  const v = p[key];
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

export function parseFilters(p: Params): TaskFilters {
  const tab: Tab = read(p, "tab") === "archive" ? "archive" : "active";
  const f = defaultFilters(tab);
  f.q = read(p, "q").slice(0, 200);
  const pri = read(p, "pri");
  if (isPriority(pri)) f.pri = pri;
  const who = read(p, "who");
  if (who && who.length <= 64 && /^[\w-]+$/.test(who)) f.who = who;
  const st = read(p, "st");
  if (isStatus(st) && (tab === "archive" ? isClosed(st) : isActive(st))) f.st = st;
  const prog = read(p, "prog");
  if (prog === "none" || prog === "partial" || prog === "done") f.prog = prog;
  const cat = read(p, "cat");
  if (isCategory(cat)) f.cat = cat;
  const from = read(p, "from");
  if (isDay(from)) f.from = from;
  const to = read(p, "to");
  if (isDay(to)) f.to = to;
  const sort = read(p, "sort");
  if ((SORT_KEYS as readonly string[]).includes(sort)) f.sort = sort as SortKey;
  const dir = read(p, "dir");
  f.dir = dir === "asc" || dir === "desc" ? dir : DEFAULT_DIR[f.sort];
  return f;
}

/** The query string for `f` — defaults left out. No leading "?". */
export function serializeFilters(f: TaskFilters, extra?: Record<string, string | null>): string {
  const q = new URLSearchParams();
  if (f.tab !== "active") q.set("tab", f.tab);
  if (f.q.trim()) q.set("q", f.q.trim());
  if (f.pri) q.set("pri", f.pri);
  if (f.who) q.set("who", f.who);
  if (f.st) q.set("st", f.st);
  if (f.prog) q.set("prog", f.prog);
  if (f.cat) q.set("cat", f.cat);
  if (f.from) q.set("from", f.from);
  if (f.to) q.set("to", f.to);
  if (f.sort !== defaultSort(f.tab) || f.dir !== DEFAULT_DIR[f.sort]) {
    q.set("sort", f.sort);
    q.set("dir", f.dir);
  }
  for (const [k, v] of Object.entries(extra ?? {})) if (v) q.set(k, v);
  return q.toString();
}

/** How many filters narrow the list (search, tab and sort not counted). */
export function activeFilterCount(f: TaskFilters): number {
  return [f.pri, f.who, f.st, f.prog, f.cat, f.from || f.to].filter(Boolean).length;
}

export interface FilterContext {
  /** The viewer, for who=me. */
  meId: string;
  /** An instant's calendar day as the viewer reads it ("YYYY-MM-DD"). */
  dayOf: (iso: string) => string;
}

/** The instant's day in the viewer's zone — the page swaps this in after hydration. */
export const localDayOf = (iso: string) => localDay(Date.parse(iso));
/** The instant's UTC day — what the server renders with. */
export const utcDayOf = (iso: string) => iso.slice(0, 10);

/** "YYYY-MM-DD" moved by `n` days. */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

/** The rows `f` keeps, in no particular order. */
export function applyFilters(rows: TaskRowDTO[], f: TaskFilters, ctx: FilterContext): TaskRowDTO[] {
  const needle = f.q.trim().toLowerCase();
  return rows.filter((t) => {
    if (f.tab === "archive" ? !isClosed(t.status) : isClosed(t.status)) return false;
    if (f.pri && t.priority !== f.pri) return false;
    if (f.who === "me" ? t.assigneeId !== ctx.meId : f.who === "none" ? t.assigneeId !== null : f.who && t.assigneeId !== f.who) return false;
    if (f.st && t.status !== f.st) return false;
    if (f.prog && progressOf(t).band !== f.prog) return false;
    if (f.cat && t.category !== f.cat) return false;
    if (f.from || f.to) {
      const day = ctx.dayOf(t.createdAt);
      if (f.from && day < f.from) return false;
      if (f.to && day > f.to) return false;
    }
    if (needle && !t.title.toLowerCase().includes(needle) && !t.description.toLowerCase().includes(needle)) return false;
    return true;
  });
}

const rank = (p: string) => (isPriority(p) ? PRIORITY_RANK[p as Priority] : -1);
const time = (iso: string | null) => (iso ? Date.parse(iso) : 0);

/**
 * Sorted copy. Ties fall back to priority, then the sooner due day, then the
 * newest — so the order is stable however the rows arrived. Rows without a
 * due date sit last under "due" in either direction.
 */
export function sortRows(rows: TaskRowDTO[], sort: SortKey, dir: SortDir): TaskRowDTO[] {
  const sign = dir === "asc" ? 1 : -1;
  const tie = (a: TaskRowDTO, b: TaskRowDTO) =>
    rank(b.priority) - rank(a.priority) ||
    (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") ||
    time(b.createdAt) - time(a.createdAt) ||
    a.id.localeCompare(b.id);
  return [...rows].sort((a, b) => {
    switch (sort) {
      case "priority":
        return sign * (rank(a.priority) - rank(b.priority)) || tie(a, b);
      case "created":
        return sign * (time(a.createdAt) - time(b.createdAt)) || tie(a, b);
      case "updated":
        return sign * (time(a.updatedAt) - time(b.updatedAt)) || tie(a, b);
      case "due": {
        if (!a.dueDate && !b.dueDate) return tie(a, b);
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return sign * a.dueDate.localeCompare(b.dueDate) || tie(a, b);
      }
    }
  });
}

export interface TaskCounts {
  open: number;
  inProgress: number;
  overdue: number;
  doneWeek: number;
  active: number;
  archive: number;
}

/** The four tiles and the two tab counts, from the rows the page holds.
 *  "Done in 7 days" is today and the six days before it. */
export function countTasks(rows: TaskRowDTO[], today: string, dayOf: (iso: string) => string): TaskCounts {
  const weekStart = addDays(today, -6);
  let open = 0, inProgress = 0, overdue = 0, doneWeek = 0, archive = 0;
  for (const t of rows) {
    if (isActive(t.status)) {
      open++;
      if (t.status === "IN_PROGRESS") inProgress++;
      if (t.dueDate && t.dueDate < today) overdue++;
    } else {
      archive++;
      if (t.status === "DONE" && t.closedAt && dayOf(t.closedAt) >= weekStart) doneWeek++;
    }
  }
  return { open, inProgress, overdue, doneWeek, active: open, archive };
}
