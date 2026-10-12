"use client";

// ADMIN · TASKS — the page's one store.
//
// TWO LAYERS. `rows` / `detail` are what the server last said (the page load,
// an action's answer, the live poll). `pending` is this admin's own edits that
// the server has not answered yet, drawn ON TOP of the server layer. So:
//   · an edit shows at once, before the answer;
//   · a failed edit simply drops its layer — whatever the server says now
//     (including another admin's change that arrived meanwhile) shows through,
//     and the caller gets the error text to show;
//   · a poll can never undo an edit in flight, because the overlay still wins.
//
// NEWER WINS. A row or a detail is replaced only by one whose updatedAt is the
// same or later, so an old answer that arrives late cannot roll a task back.

import { useCallback, useMemo, useRef, useState } from "react";
import { rowFromDetail, type TaskDetailDTO, type TaskRowDTO } from "@/lib/adminTasks/model";
import type { TaskResult } from "@/actions/adminTasks";

export interface Patch {
  row?: (r: TaskRowDTO) => TaskRowDTO;
  detail?: (d: TaskDetailDTO) => TaskDetailDTO;
}

interface Pending {
  key: number;
  taskId: string;
  patch: Patch;
}

interface State {
  rows: Record<string, TaskRowDTO>;
  /** The open task as the server last said, or null. */
  detail: TaskDetailDTO | null;
  pending: Pending[];
  /** Rows made here and not yet answered (New task). */
  temps: TaskRowDTO[];
  /** Rows to highlight briefly: id → when. */
  flash: Record<string, number>;
}

const FLASH_MS = 1600;

const newer = (a: string, b: string) => Date.parse(a) >= Date.parse(b);

/** A patch that sets plain fields on both the row and the open detail. */
export function fieldPatch(fields: Partial<TaskRowDTO>): Patch {
  return { row: (r) => ({ ...r, ...fields }), detail: (d) => ({ ...d, ...fields }) };
}

/** A patch on the open task's subtasks; the row's counts follow. */
export function subtaskPatch(fn: (subs: TaskDetailDTO["subtasks"]) => TaskDetailDTO["subtasks"]): Patch {
  return { detail: (d) => ({ ...d, subtasks: fn(d.subtasks) }) };
}

export function useTaskStore(initialRows: TaskRowDTO[], initialDetail: TaskDetailDTO | null) {
  const [state, setState] = useState<State>(() => ({
    rows: Object.fromEntries(initialRows.map((r) => [r.id, r])),
    detail: initialDetail,
    pending: [],
    temps: [],
    flash: {},
  }));
  const keyRef = useRef(0);

  /** Drop the highlight stamped `at` once it has played. */
  const clearFlashLater = useCallback((at: number) => {
    window.setTimeout(() => {
      setState((st) => {
        const ids = Object.keys(st.flash).filter((id) => st.flash[id] === at);
        if (ids.length === 0) return st;
        const flash = { ...st.flash };
        for (const id of ids) delete flash[id];
        return { ...st, flash };
      });
    }, FLASH_MS + 50);
  }, []);

  /** Rows from the poll: newer ones replace, and each one that changed flashes. */
  const ingestRows = useCallback(
    (incoming: TaskRowDTO[]) => {
      if (incoming.length === 0) return;
      const at = Date.now();
      setState((st) => {
        let rows = st.rows;
        let flash = st.flash;
        for (const r of incoming) {
          const cur = rows[r.id];
          if (cur && (cur.updatedAt === r.updatedAt || !newer(r.updatedAt, cur.updatedAt))) continue;
          if (rows === st.rows) rows = { ...st.rows };
          if (flash === st.flash) flash = { ...st.flash };
          rows[r.id] = r;
          flash[r.id] = at;
        }
        return rows === st.rows ? st : { ...st, rows, flash };
      });
      clearFlashLater(at);
    },
    [clearFlashLater],
  );

  /** A full task from an action's answer or the poll. */
  const ingestDetail = useCallback((d: TaskDetailDTO, opts?: { open?: boolean }) => {
    setState((st) => {
      const curRow = st.rows[d.id];
      const rows = !curRow || newer(d.updatedAt, curRow.updatedAt) ? { ...st.rows, [d.id]: rowFromDetail(d) } : st.rows;
      let detail = st.detail;
      if (opts?.open || detail?.id === d.id) {
        if (!detail || detail.id !== d.id || newer(d.updatedAt, detail.updatedAt)) detail = d;
      }
      return { ...st, rows, detail };
    });
  }, []);

  const setDetail = useCallback((d: TaskDetailDTO | null) => {
    setState((st) => ({ ...st, detail: d }));
  }, []);

  /**
   * Apply `patch` now, run `call`, then take the server's answer — or drop the
   * patch and hand back the error. Resolves to the error text, or null.
   */
  const mutate = useCallback(
    async (taskId: string, patch: Patch, call: () => Promise<TaskResult>): Promise<string | null> => {
      const key = ++keyRef.current;
      setState((st) => ({ ...st, pending: [...st.pending, { key, taskId, patch }] }));
      let res: TaskResult;
      try {
        res = await call();
      } catch {
        res = { ok: false, error: "Couldn't reach the server. Check your connection and try again." };
      }
      setState((st) => {
        const pending = st.pending.filter((p) => p.key !== key);
        if (!res.ok) return { ...st, pending };
        const d = res.task;
        const curRow = st.rows[d.id];
        const rows = !curRow || newer(d.updatedAt, curRow.updatedAt) ? { ...st.rows, [d.id]: rowFromDetail(d) } : st.rows;
        const detail = st.detail?.id === d.id && newer(d.updatedAt, st.detail.updatedAt) ? d : st.detail;
        return { ...st, pending, rows, detail };
      });
      return res.ok ? null : res.error;
    },
    [],
  );

  /** New task: a temporary row at once, the real one when the server answers. */
  const create = useCallback(
    async (temp: TaskRowDTO, call: () => Promise<TaskResult>): Promise<{ error: string | null; task: TaskDetailDTO | null }> => {
      setState((st) => ({ ...st, temps: [temp, ...st.temps] }));
      let res: TaskResult;
      try {
        res = await call();
      } catch {
        res = { ok: false, error: "Couldn't reach the server. Check your connection and try again." };
      }
      const at = Date.now();
      setState((st) => {
        const temps = st.temps.filter((t) => t.id !== temp.id);
        if (!res.ok) return { ...st, temps };
        return { ...st, temps, rows: { ...st.rows, [res.task.id]: rowFromDetail(res.task) }, flash: { ...st.flash, [res.task.id]: at } };
      });
      if (res.ok) clearFlashLater(at);
      return res.ok ? { error: null, task: res.task } : { error: res.error, task: null };
    },
    [clearFlashLater],
  );

  const view = useMemo(() => {
    const overlay = (taskId: string) => state.pending.filter((p) => p.taskId === taskId);
    let detail: TaskDetailDTO | null = state.detail;
    if (detail) {
      for (const p of overlay(detail.id)) if (p.patch.detail) detail = p.patch.detail(detail);
    }
    const rows: TaskRowDTO[] = [...state.temps];
    for (const r0 of Object.values(state.rows)) {
      if (detail && detail.id === r0.id && newer(detail.updatedAt, r0.updatedAt)) {
        rows.push(rowFromDetail(detail));
        continue;
      }
      let r = r0;
      for (const p of overlay(r.id)) {
        if (p.patch.row) r = p.patch.row(r);
      }
      rows.push(r);
    }
    return { rows, detail };
  }, [state]);

  const lastServerDetail = state.detail;

  return {
    rows: view.rows,
    detail: view.detail,
    /** The server's own copy of the open task, without this admin's pending edits. */
    serverDetail: lastServerDetail,
    flash: state.flash,
    knownIds: state.rows,
    ingestRows,
    ingestDetail,
    setDetail,
    mutate,
    create,
  };
}

export type TaskStore = ReturnType<typeof useTaskStore>;
