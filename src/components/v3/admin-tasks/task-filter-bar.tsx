"use client";

// ADMIN · TASKS — the filter bar. Search and "My tasks" always in view; the
// rest (priority, assignee, status, progress, category, created from–to) in a
// second row that folds behind one "Filters" button on a phone. Sorting sits
// at the end of the first row. Every value lives in the address (the parent
// writes it back with history.replaceState), so a reload keeps the list.

import { useId, useState } from "react";
import { Select } from "@/components/v3/admin-users/admin-kit";
import {
  CATEGORIES,
  CATEGORY_LABEL,
  PRIORITIES,
  PRIORITY_LABEL,
  STATUS_LABEL,
  ACTIVE_STATUSES,
  CLOSED_STATUSES,
  type AdminPersonDTO,
} from "@/lib/adminTasks/model";
import { DEFAULT_DIR, SORT_KEYS, SORT_LABEL, activeFilterCount, defaultFilters, type SortKey, type TaskFilters } from "@/lib/adminTasks/filters";
import { cx, Ic } from "./task-bits";

const PRIORITY_OPTIONS = PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }));
const CATEGORY_OPTIONS = CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }));
const PROGRESS_OPTIONS = [
  { value: "none", label: "Not started" },
  { value: "partial", label: "Under way" },
  { value: "done", label: "Complete" },
];
const SORT_OPTIONS = SORT_KEYS.map((k) => ({ value: k, label: `Sort: ${SORT_LABEL[k]}` }));

export function TaskFilterBar({
  filters,
  onChange,
  people,
  canBeAssigned,
}: {
  filters: TaskFilters;
  onChange: (next: TaskFilters) => void;
  people: AdminPersonDTO[];
  /** False for the console's shared login — it is never an assignee. */
  canBeAssigned: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const set = (patch: Partial<TaskFilters>) => onChange({ ...filters, ...patch });
  const narrowing = activeFilterCount(filters);
  const anything = narrowing > 0 || filters.q.trim() !== "";

  const statusOptions = (filters.tab === "archive" ? CLOSED_STATUSES : ACTIVE_STATUSES).map((st) => ({ value: st, label: STATUS_LABEL[st] }));
  const whoOptions = [
    ...(canBeAssigned ? [{ value: "me", label: "Me" }] : []),
    { value: "none", label: "Unassigned" },
    ...people.map((p) => ({ value: p.id, label: p.name })),
  ];
  const mine = filters.who === "me";

  return (
    <section className={cx("card", "filters")} aria-label="Filter tasks">
      <div className={cx("fRow")}>
        <label className={cx("search", "fSearch")}>
          <Ic name="search" />
          <input
            type="search"
            placeholder="Search titles and descriptions…"
            value={filters.q}
            onChange={(e) => set({ q: e.target.value })}
            aria-label="Search tasks"
          />
        </label>
        {canBeAssigned ? (
          <button
            type="button"
            className={cx("btn", "btn-ghost", "btn-field", "mine")}
            aria-pressed={mine}
            onClick={() => set({ who: mine ? "" : "me" })}
          >
            <Ic name="user" />
            My tasks
          </button>
        ) : null}
        <button
          type="button"
          className={cx("btn", "btn-ghost", "btn-field", "fToggle")}
          aria-expanded={open}
          aria-controls={`${id}-more`}
          onClick={() => setOpen((o) => !o)}
        >
          <Ic name="filter" />
          Filters
          {narrowing > 0 ? <span className={cx("fN")}>{narrowing}</span> : null}
        </button>
        <div className={cx("fSort")}>
          <Select
            value={filters.sort}
            onChange={(v) => set({ sort: v as SortKey, dir: DEFAULT_DIR[v as SortKey] })}
            options={SORT_OPTIONS}
            ariaLabel="Sort by"
          />
          <button
            type="button"
            className={cx("btn", "btn-ghost", "btn-field", "dirBtn")}
            onClick={() => set({ dir: filters.dir === "asc" ? "desc" : "asc" })}
            aria-label={filters.dir === "asc" ? "Ascending — switch to descending" : "Descending — switch to ascending"}
            title={filters.dir === "asc" ? "Ascending" : "Descending"}
          >
            <Ic name="chev" className={cx("dirIc", filters.dir === "asc" && "dirAsc")} />
          </button>
        </div>
      </div>

      <div id={`${id}-more`} className={cx("fRow", "fMore", open && "fMoreOpen")}>
        <div className={cx("fSel")}>
          <Select value={filters.pri} onChange={(v) => set({ pri: v })} placeholder="Any priority" options={PRIORITY_OPTIONS} ariaLabel="Priority" />
        </div>
        <div className={cx("fSel")}>
          <Select value={filters.who} onChange={(v) => set({ who: v })} placeholder="Anyone" options={whoOptions} ariaLabel="Assignee" />
        </div>
        <div className={cx("fSel")}>
          <Select value={filters.st} onChange={(v) => set({ st: v })} placeholder="Any status" options={statusOptions} ariaLabel="Status" />
        </div>
        <div className={cx("fSel")}>
          <Select
            value={filters.prog}
            onChange={(v) => set({ prog: v as TaskFilters["prog"] })}
            placeholder="Any progress"
            options={PROGRESS_OPTIONS}
            ariaLabel="Progress"
          />
        </div>
        <div className={cx("fSel")}>
          <Select value={filters.cat} onChange={(v) => set({ cat: v })} placeholder="Any category" options={CATEGORY_OPTIONS} ariaLabel="Category" />
        </div>
        <div className={cx("fDates")} role="group" aria-label="Created between">
          <span className={cx("fDatesLbl")}>Created</span>
          <input
            type="date"
            className={cx("in", "in--mono", "fDate")}
            value={filters.from}
            max={filters.to || undefined}
            onChange={(e) => set({ from: e.target.value })}
            aria-label="Created from"
          />
          <span className={cx("fDash")} aria-hidden="true">
            –
          </span>
          <input
            type="date"
            className={cx("in", "in--mono", "fDate")}
            value={filters.to}
            min={filters.from || undefined}
            onChange={(e) => set({ to: e.target.value })}
            aria-label="Created to"
          />
        </div>
        {anything ? (
          <button
            type="button"
            className={cx("btn", "btn-quiet", "btn-field")}
            onClick={() => onChange({ ...defaultFilters(filters.tab), sort: filters.sort, dir: filters.dir })}
          >
            <Ic name="x" />
            Clear
          </button>
        ) : null}
      </div>
    </section>
  );
}
