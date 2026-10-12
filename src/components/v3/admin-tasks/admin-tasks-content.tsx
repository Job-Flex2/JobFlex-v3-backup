"use client";

// ADMIN · TASKS — the platform team's task list.
// Route: /admin/tasks. Renders ONLY the shell's `.content` children, as a
// fragment, like /admin/support — same kit (admin-users/admin-kit +
// admin-shared.module.css), same tiles, same table, same sheet.
//
// Two tabs: Active (To do / In progress / Blocked) and Archive (Done /
// Canceled, with the day each was closed). The tiles count what the page
// holds, so they move with every change the page learns of.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Sheet, useSheet, KIT_BTN_CLASS } from "@/components/v3/admin-users/admin-kit";
import { useAdminMotion } from "@/components/v3/admin-users/use-admin-motion";
import ui from "@/components/v3/admin-influencers/admin-ui.module.css";
import { toast } from "@/components/ui/Toast";
import { createAdminTask } from "@/actions/adminTasks";
import {
  categoryLabel,
  dayLabel,
  isOverdue,
  taskRef,
  type AdminPersonDTO,
  type TaskDetailDTO,
  type TaskRowDTO,
} from "@/lib/adminTasks/model";
import { DEFAULT_DIR, applyFilters, countTasks, defaultSort, serializeFilters, sortRows, type Tab, type TaskFilters } from "@/lib/adminTasks/filters";
import { useTaskStore } from "./use-task-store";
import { EMPTY_DRAFT, NewTaskForm, type NewTaskDraft } from "./new-task-sheet";
import { TaskFilterBar } from "./task-filter-bar";
import { cx, Ic, PriorityStamp, ProgressBar, StatusStamp, useDayOf, useToday } from "./task-bits";

export interface AdminTasksProps {
  initialRows: TaskRowDTO[];
  initialDetail: TaskDetailDTO | null;
  initialFilters: TaskFilters;
  people: AdminPersonDTO[];
  me: { id: string; console: boolean };
  serverNow: string;
  serverToday: string;
  missingTask: boolean;
}

export function AdminTasksContent(props: AdminTasksProps) {
  const { people, me, serverToday } = props;
  useAdminMotion(KIT_BTN_CLASS);

  const store = useTaskStore(props.initialRows, props.initialDetail);
  const [filters, setFilters] = useState<TaskFilters>(props.initialFilters);
  const today = useToday(serverToday);
  const dayOf = useDayOf();
  const thisYear = Number(today.slice(0, 4));

  const counts = useMemo(() => countTasks(store.rows, today, dayOf), [store.rows, today, dayOf]);
  const visible = useMemo(
    () => sortRows(applyFilters(store.rows, filters, { meId: me.id, dayOf }), filters.sort, filters.dir),
    [store.rows, filters, me.id, dayOf],
  );

  // Switching tabs drops the status filter (each tab has its own statuses) and,
  // if the list was on its tab's default order, takes the other tab's default.
  const setTab = (tab: Tab) =>
    setFilters((f) => {
      if (f.tab === tab) return f;
      const onDefault = f.sort === defaultSort(f.tab) && f.dir === DEFAULT_DIR[f.sort];
      const sort = onDefault ? defaultSort(tab) : f.sort;
      return { ...f, tab, st: "", sort, dir: onDefault ? DEFAULT_DIR[sort] : f.dir };
    });

  // The address carries the filters (and the open task), so a reload or a
  // shared link shows the same list. replaceState with a null state: Next
  // skips its own sync when handed window.history.state.
  useEffect(() => {
    const qs = serializeFilters(filters);
    const next = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
    if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, "", next);
  }, [filters]);

  // ── New task ──
  const newSheet = useSheet();
  const [draft, setDraft] = useState<{ key: number; value: NewTaskDraft; error: string | null }>({ key: 0, value: EMPTY_DRAFT, error: null });
  const openNew = useCallback(() => {
    setDraft((d) => ({ key: d.key + 1, value: EMPTY_DRAFT, error: null }));
    newSheet.open();
  }, [newSheet]);
  const closeNew = useCallback(() => newSheet.close(), [newSheet]);

  const submitNew = useCallback(
    async (d: NewTaskDraft) => {
      newSheet.close();
      const now = new Date().toISOString();
      const assignee = people.find((p) => p.id === d.assigneeId) ?? null;
      const temp: TaskRowDTO = {
        id: `tmp-${now}`,
        title: d.title,
        description: d.description,
        priority: d.priority,
        status: "TODO",
        category: d.category,
        assigneeId: assignee?.id ?? null,
        assigneeName: assignee?.name ?? null,
        authorId: me.id,
        authorName: "You",
        dueDate: d.dueDate || null,
        linkUrl: null,
        supportTicketId: null,
        createdAt: now,
        updatedAt: now,
        closedAt: null,
        subtasksDone: 0,
        subtasksTotal: 0,
        comments: 0,
      };
      // A new task belongs on Active — show it there even if Archive was open.
      setFilters((f) => (f.tab === "active" ? f : { ...f, tab: "active", st: "" }));
      const { error } = await store.create(temp, () =>
        createAdminTask({
          title: d.title,
          description: d.description,
          priority: d.priority,
          category: d.category,
          assigneeId: d.assigneeId || null,
          dueDate: d.dueDate || null,
        }),
      );
      if (error) {
        toast.error("The task wasn't created", error);
        setDraft((x) => ({ key: x.key + 1, value: d, error }));
        newSheet.open();
      }
    },
    [newSheet, people, me.id, store],
  );

  const archive = filters.tab === "archive";

  return (
    <>
      <div className={cx("page-head")}>
        <div>
          <div className={cx("kicker")}>Platform</div>
          <h1 className={cx("page-title")}>Tasks</h1>
        </div>
        <div className={cx("page-actions")}>
          <button type="button" className={cx("btn", "btn-primary")} onClick={openNew}>
            <Ic name="plus" />
            New task
          </button>
        </div>
      </div>

      <div className={cx("kpi-grid")}>
        <div className={cx("kpi")}>
          <div className={cx("kpi-lbl")}>Open</div>
          <div className={cx("kpi-val", "accent")}>{counts.open}</div>
        </div>
        <div className={cx("kpi")}>
          <div className={cx("kpi-lbl")}>In progress</div>
          <div className={cx("kpi-val")}>{counts.inProgress}</div>
        </div>
        <div className={cx("kpi")}>
          <div className={cx("kpi-lbl")}>Overdue</div>
          <div className={cx("kpi-val", counts.overdue > 0 && "kpiBad")}>{counts.overdue}</div>
        </div>
        <div className={cx("kpi")}>
          <div className={cx("kpi-lbl")}>Done · 7 days</div>
          <div className={cx("kpi-val")}>{counts.doneWeek}</div>
        </div>
      </div>

      <TaskFilterBar filters={filters} onChange={setFilters} people={people} canBeAssigned={!me.console} />

      <section className={cx("card", "tbl-card")}>
        <div className={cx("listHead")}>
          <div className={cx(ui.seg, "tabs")} role="tablist" aria-label="Which tasks">
            <button type="button" role="tab" aria-selected={!archive} className={cx(ui.segBtn, !archive && ui.segOn)} onClick={() => setTab("active")}>
              Active <span className={cx("tabN")}>{counts.active}</span>
            </button>
            <button type="button" role="tab" aria-selected={archive} className={cx(ui.segBtn, archive && ui.segOn)} onClick={() => setTab("archive")}>
              Archive <span className={cx("tabN")}>{counts.archive}</span>
            </button>
          </div>
          <span className={cx("count")}>
            {visible.length} shown
          </span>
        </div>

        {visible.length === 0 ? (
          <div className={cx("tbl-empty")}>
            {archive
              ? counts.archive === 0
                ? "Nothing in the archive yet. Done and canceled tasks land here."
                : "No archived task matches those filters."
              : counts.active === 0
                ? "No open tasks. Press New task to add one."
                : "No open task matches those filters."}
          </div>
        ) : (
          <div className={cx("tbl-wrap")}>
            <table className={cx("tbl", "taskTbl")}>
              <colgroup>
                <col className={cx("cPri")} />
                <col className={cx("cTask")} />
                <col className={cx("cWho")} />
                <col className={cx("cStatus")} />
                <col className={cx("cProg")} />
                <col className={cx("cDue")} />
                <col className={cx("cCreated")} />
                <col className={cx("cCmt")} />
              </colgroup>
              <thead>
                <tr>
                  <th>Priority</th>
                  <th>Task</th>
                  <th>Assignee</th>
                  <th>Status</th>
                  <th>Progress</th>
                  <th>{archive ? "Closed" : "Due"}</th>
                  <th>Created</th>
                  <th className={cx("num")}>
                    <span className={cx("sr")}>Comments</span>
                    <Ic name="msg" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((t) => {
                  const overdue = isOverdue(t, today);
                  const temp = t.id.startsWith("tmp-");
                  return (
                    <tr key={t.id} className={cx("taskRow", !!store.flash[t.id] && "rowFlash", temp && "rowTemp")}>
                      <td className={cx("tdPri")}>
                        <PriorityStamp priority={t.priority} />
                      </td>
                      <td className={cx("tdTask")}>
                        <div className={cx("t-title")} title={t.title}>
                          {t.title}
                        </div>
                        <div className={cx("t-sub")}>
                          {categoryLabel(t.category)} · {temp ? "Saving…" : taskRef(t.id)}
                        </div>
                      </td>
                      <td className={cx("tdWho")} data-l="Assignee">
                        {t.assigneeName ? <span className={cx("who")}>{t.assigneeName}</span> : <span className={cx("whoNone")}>Unassigned</span>}
                      </td>
                      <td className={cx("tdStatus")}>
                        <StatusStamp status={t.status} />
                      </td>
                      <td className={cx("tdProg")}>
                        <ProgressBar task={t} />
                      </td>
                      <td className={cx("tdDue", "t-mono", overdue && "overdue")} data-l={archive ? "Closed" : "Due"}>
                        {archive ? (t.closedAt ? dayLabel(dayOf(t.closedAt), thisYear) : "—") : t.dueDate ? dayLabel(t.dueDate, thisYear) : "—"}
                        {overdue ? <span className={cx("sr")}> (overdue)</span> : null}
                      </td>
                      <td className={cx("tdCreated", "t-mono")} data-l="Created">
                        {dayLabel(dayOf(t.createdAt), thisYear)}
                      </td>
                      <td className={cx("tdCmt", "t-mono", "num")}>
                        <span className={cx("cmt", t.comments === 0 && "cmtNone")} aria-label={`${t.comments} comments`}>
                          <Ic name="msg" />
                          {t.comments}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Sheet handle={newSheet} kicker="Tasks" title="New task" onClose={closeNew}>
        <NewTaskForm key={draft.key} initial={draft.value} error={draft.error} people={people} onSubmit={submitNew} onCancel={closeNew} />
      </Sheet>
    </>
  );
}
