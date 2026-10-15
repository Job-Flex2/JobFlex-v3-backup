"use client";

// ADMIN · TASKS — "New task". Only the title is required; everything else can
// be filled in later from the task's own sheet. Submitting closes the sheet at
// once (the row appears before the server answers); if the server refuses,
// the parent reopens this sheet with the same draft and the reason.

import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { ImagePlus, X } from "lucide-react";
import { Field, Note, Select, SheetBody, SheetFoot } from "@/components/v3/admin-users/admin-kit";
import { CATEGORIES, CATEGORY_LABEL, DESCRIPTION_MAX, PRIORITIES, PRIORITY_LABEL, TITLE_MAX, type AdminPersonDTO } from "@/lib/adminTasks/model";
import { cx, Ic } from "./task-bits";
import { TaskDictate } from "./task-dictate";
import { teamOf } from "./take-as";

export interface NewTaskDraft {
  title: string;
  priority: string;
  category: string;
  assigneeId: string;
  dueDate: string;
  description: string;
  /** Pictures to put on the task once it exists (2026-10-15). */
  files: File[];
}

export const EMPTY_DRAFT: NewTaskDraft = { title: "", priority: "NORMAL", category: "OTHER", assigneeId: "", dueDate: "", description: "", files: [] };
const MAX_NEW_PICTURES = 24;

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
  const picker = useRef<HTMLInputElement>(null);
  // Previews of the picked pictures; their object URLs freed when the list changes or the form goes.
  const previews = useMemo(() => d.files.map((f) => ({ name: f.name, url: URL.createObjectURL(f) })), [d.files]);
  useEffect(() => () => previews.forEach((p) => URL.revokeObjectURL(p.url)), [previews]);
  const addFiles = (list: FileList | null) => {
    const picked = Array.from(list ?? []).filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
    if (picker.current) picker.current.value = "";
    if (picked.length) setD((x) => ({ ...x, files: [...x.files, ...picked].slice(0, MAX_NEW_PICTURES) }));
  };
  // Who hears of it (lib/adminTasks/teamShared): someone on the team list gets a text; an admin with their own
  // sign-in gets the email; nobody yet → everyone on the team list.
  const team = teamOf(people);
  const textHint = d.assigneeId
    ? team.some((p) => p.id === d.assigneeId)
      ? "They get a text with the task and confirm by replying OK."
      : "They get an email with the task."
    : team.length
      ? "Unassigned: everyone on the team gets a text — the first to reply OK takes it."
      : "Unassigned. Add the team's phones (Team) and they get a text to take it.";

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
          <div className={cx("dictRow")}>
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
            <TaskDictate
              value={d.title}
              max={TITLE_MAX}
              label="Speak"
              onChange={(title) => {
                set({ title });
                if (problem) setProblem(null);
              }}
            />
          </div>
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
          <Field label="Assignee" hint={textHint}>
            <Select
              value={d.assigneeId}
              onChange={(v) => set({ assigneeId: v })}
              placeholder="Unassigned — anyone can take it"
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
            maxLength={DESCRIPTION_MAX}
            onChange={(e) => set({ description: e.target.value })}
          />
          <TaskDictate value={d.description} max={DESCRIPTION_MAX} label="Speak the details" onChange={(description) => set({ description })} />
        </Field>
        <Field label="Pictures" hint="Optional — screenshots, photos of the problem. They go up once the task is created.">
          <div className={cx("pics", "picsNew")} data-new-pictures>
            {previews.map((p, i) => (
              <div key={p.url} className={cx("pic")}>
                {/* eslint-disable-next-line @next/next/no-img-element -- a local preview */}
                <img src={p.url} alt={p.name} />
                <button type="button" className={cx("picDel")} onClick={() => set({ files: d.files.filter((_, k) => k !== i) })} aria-label={`Remove ${p.name}`}>
                  <X size={14} aria-hidden />
                </button>
              </div>
            ))}
            {d.files.length < MAX_NEW_PICTURES ? (
              <button type="button" className={cx("picAdd")} onClick={() => picker.current?.click()} data-new-picture-add>
                <ImagePlus size={20} aria-hidden />
                <span>Add pictures</span>
              </button>
            ) : null}
          </div>
          <input ref={picker} type="file" accept="image/*,.heic,.heif" multiple hidden onChange={(e) => addFiles(e.target.files)} data-new-picture-input />
        </Field>
        {problem ? <Note tone="danger">{problem}</Note> : null}
      </SheetBody>
      <SheetFoot>
        <button type="button" className={cx("btn", "btn-ghost")} onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className={cx("btn", "btn-primary")}>
          <Ic name="plus" />
          {d.files.length ? `Create task · ${d.files.length} picture${d.files.length === 1 ? "" : "s"}` : "Create task"}
        </button>
      </SheetFoot>
    </form>
  );
}
