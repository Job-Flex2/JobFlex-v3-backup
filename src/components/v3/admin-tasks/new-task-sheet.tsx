"use client";

// ADMIN · TASKS — "New task". Only the title is required; everything else can
// be filled in later from the task's own sheet. Submitting closes the sheet at
// once (the row appears before the server answers); if the server refuses,
// the parent reopens this sheet with the same draft and the reason.

import { useId, useState, type FormEvent } from "react";
import { Field, Note, Select, SheetBody, SheetFoot } from "@/components/v3/admin-users/admin-kit";
import { CATEGORIES, CATEGORY_LABEL, PRIORITIES, PRIORITY_LABEL, TITLE_MAX, type AdminPersonDTO } from "@/lib/adminTasks/model";
import { cx, Ic } from "./task-bits";

export interface NewTaskDraft {
  title: string;
  priority: string;
  category: string;
  assigneeId: string;
  dueDate: string;
  description: string;
}

export const EMPTY_DRAFT: NewTaskDraft = { title: "", priority: "NORMAL", category: "OTHER", assigneeId: "", dueDate: "", description: "" };

const PRIORITY_OPTIONS = PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }));
const CATEGORY_OPTIONS = CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }));

export function NewTaskForm({
  initial,
  error,
  people,
  onSubmit,
  onCancel,
}: {
  initial: NewTaskDraft;
  error: string | null;
  people: AdminPersonDTO[];
  onSubmit: (d: NewTaskDraft) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [d, setD] = useState<NewTaskDraft>(initial);
  const [problem, setProblem] = useState<string | null>(error);
  const set = (patch: Partial<NewTaskDraft>) => setD((x) => ({ ...x, ...patch }));

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!d.title.trim()) {
      setProblem("Give the task a title.");
      return;
    }
    onSubmit({ ...d, title: d.title.trim() });
  }

  return (
    <form onSubmit={submit} className={cx("formFrame")} noValidate>
      <SheetBody>
        <Field label="Title" htmlFor={`${id}-t`}>
          <input
            id={`${id}-t`}
            className={cx("in")}
            value={d.title}
            maxLength={TITLE_MAX}
            autoComplete="off"
            placeholder="What needs doing"
            aria-invalid={problem && !d.title.trim() ? true : undefined}
            onChange={(e) => {
              set({ title: e.target.value });
              if (problem) setProblem(null);
            }}
          />
        </Field>
        <div className={cx("row")}>
          <Field label="Priority">
            <Select value={d.priority} onChange={(v) => set({ priority: v })} options={PRIORITY_OPTIONS} ariaLabel="Priority" />
          </Field>
          <Field label="Category">
            <Select value={d.category} onChange={(v) => set({ category: v })} options={CATEGORY_OPTIONS} ariaLabel="Category" />
          </Field>
        </div>
        <div className={cx("row")}>
          <Field label="Assignee">
            <Select
              value={d.assigneeId}
              onChange={(v) => set({ assigneeId: v })}
              placeholder="Unassigned"
              options={people.map((p) => ({ value: p.id, label: p.name }))}
              ariaLabel="Assignee"
            />
          </Field>
          <Field label="Due" htmlFor={`${id}-due`}>
            <input id={`${id}-due`} type="date" className={cx("in", "in--mono")} value={d.dueDate} onChange={(e) => set({ dueDate: e.target.value })} />
          </Field>
        </div>
        <Field label="Description" htmlFor={`${id}-desc`} hint="Optional. Links become clickable.">
          <textarea
            id={`${id}-desc`}
            className={cx("in", "ta")}
            rows={4}
            value={d.description}
            onChange={(e) => set({ description: e.target.value })}
          />
        </Field>
        {problem ? <Note tone="danger">{problem}</Note> : null}
      </SheetBody>
      <SheetFoot>
        <button type="button" className={cx("btn", "btn-ghost")} onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className={cx("btn", "btn-primary")}>
          <Ic name="plus" />
          Create task
        </button>
      </SheetFoot>
    </form>
  );
}
