"use client";

// ADMIN · TASKS — the open task, in the kit's sheet (centred on a desk, a
// bottom sheet on a phone), like a support ticket.
//
// EVERY FIELD EDITS IN PLACE, one field per write (actions/adminTasks), drawn
// at once through the store's pending layer and rolled back with the reason
// if the server refuses.
//
// TYPING IS NEVER OVERWRITTEN. A text field holds its own draft from focus to
// blur; while it does, another admin's change to that same field does not
// replace what is being typed — the field says it changed meanwhile, and the
// draft wins only if it is saved. Every other field keeps following the live
// copy.
//
// No delete: Cancel sends the task to Archive. Closing a task (Done or
// Canceled) with subtasks still open asks first.

import { useCallback, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import type { Route } from "next";
import { Field, Note, Select, SheetBody, SheetFoot, Toggle } from "@/components/v3/admin-users/admin-kit";
import { toast } from "@/components/ui/Toast";
import {
  addAdminSubtask,
  addAdminTaskComment,
  removeAdminSubtask,
  reorderAdminSubtasks,
  takeAdminTask,
  updateAdminSubtask,
  updateAdminTaskField,
  type TaskResult,
} from "@/actions/adminTasks";
import { Check, Hand } from "lucide-react";
import { TaskPictures } from "./task-pictures";
import { TaskDictate } from "./task-dictate";
import { rememberTakeAs, takeOptions, useTakeAs } from "./take-as";
import { isMemberRef } from "@/lib/adminTasks/teamShared";
import {
  CATEGORIES,
  CATEGORY_LABEL,
  COMMENT_MAX,
  DESCRIPTION_MAX,
  PRIORITIES,
  PRIORITY_LABEL,
  STATUSES,
  STATUS_LABEL,
  SUBTASK_MAX,
  TITLE_MAX,
  cleanLink,
  eventWords,
  isClosed,
  isOverdue,
  type AdminPersonDTO,
  type FeedItemDTO,
  type SubtaskDTO,
  type TaskDetailDTO,
  type TaskRowDTO,
} from "@/lib/adminTasks/model";
import type { TaskField } from "@/lib/adminTasks/service";
import { fieldPatch, subtaskPatch, type Patch, type TaskStore } from "./use-task-store";
import { cx, Ic, Linkified, ProgressBar, dateLabel, stampLabel, useHydrated } from "./task-bits";

const PRIORITY_OPTIONS = PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }));
const STATUS_OPTIONS = STATUSES.map((st) => ({ value: st, label: STATUS_LABEL[st] }));
const CATEGORY_OPTIONS = CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }));

/** "T-ABC123 · Created Oct 11, 2026 by Ana" — the head's kicker, always in view. */
export function sheetKicker(t: Pick<TaskRowDTO, "createdAt" | "authorName">, ref: string, hydrated: boolean): string {
  const when = hydrated ? dateLabel(t.createdAt) : t.createdAt.slice(0, 10);
  return `${ref} · Created ${when} by ${t.authorName}`;
}

// ── A text field that keeps its own draft while it has focus ───────

function useDraft(value: string) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [base, setBase] = useState(value);
  return {
    editing,
    shown: editing ? draft : value,
    /** The live value moved on while this field was being typed in. */
    changedMeanwhile: editing && value !== base,
    begin: () => {
      setEditing(true);
      setDraft(value);
      setBase(value);
    },
    set: setDraft,
    end: () => setEditing(false),
    draft,
  };
}

function InlineText({
  value,
  onCommit,
  label,
  className,
  maxLength,
  placeholder,
  allowEmpty,
  validate,
}: {
  value: string;
  onCommit: (v: string) => void;
  label: string;
  className?: string;
  maxLength?: number;
  placeholder?: string;
  allowEmpty?: boolean;
  /** Returns an error to show instead of saving. */
  validate?: (v: string) => string | null;
}) {
  const d = useDraft(value);
  const [problem, setProblem] = useState<string | null>(null);
  const cancelled = useRef(false);

  const commit = () => {
    d.end();
    if (cancelled.current) {
      cancelled.current = false;
      setProblem(null);
      return;
    }
    const v = d.draft.replace(/\s+/g, " ").trim();
    if (v === value.trim()) {
      setProblem(null);
      return;
    }
    if (!v && !allowEmpty) {
      setProblem(`${label} can't be empty — kept the old one.`);
      return;
    }
    const err = validate?.(v) ?? null;
    if (err) {
      setProblem(err);
      return;
    }
    setProblem(null);
    onCommit(v);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      (e.currentTarget as HTMLElement).blur();
    } else if (e.key === "Escape") {
      // Escape drops the draft; the sheet itself stays open.
      e.stopPropagation();
      cancelled.current = true;
      (e.currentTarget as HTMLElement).blur();
    }
  };

  return (
    <>
      <input
        type="text"
        autoComplete="off"
        value={d.shown}
        aria-label={label}
        maxLength={maxLength}
        placeholder={placeholder}
        className={className}
        onFocus={d.begin}
        onBlur={commit}
        onKeyDown={onKey}
        onChange={(e) => d.set(e.target.value)}
      />
      {d.changedMeanwhile ? (
        <span className={cx("fld-hint", "tsHint")} role="status">
          Someone changed this to “{value || "nothing"}” while you were typing — Enter keeps yours, Esc takes theirs.
        </span>
      ) : null}
      {problem ? (
        <span className={cx("fld-hint", "tsHint")} role="alert">
          {problem}
        </span>
      ) : null}
    </>
  );
}

// ── The sheet's body ───────────────────────────────────────────────

export function TaskSheetContent({
  task,
  people,
  me,
  store,
  today,
}: {
  task: TaskDetailDTO;
  people: AdminPersonDTO[];
  me: { id: string; console: boolean };
  store: TaskStore;
  today: string;
}) {
  const id = useId();
  const hydrated = useHydrated();
  const [error, setError] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState<"DONE" | "CANCELED" | null>(null);
  const [editingDesc, setEditingDesc] = useState(false);

  const run = useCallback(
    async (patch: Patch, call: () => Promise<TaskResult>) => {
      setError(null);
      const err = await store.mutate(task.id, patch, call);
      if (err) {
        setError(err);
        toast.error("Not saved", err);
      }
      return err;
    },
    [store, task.id],
  );

  // ── fields ──
  const setField = (field: TaskField, value: string | null, extra: Partial<TaskRowDTO> = {}) =>
    run(fieldPatch({ [field]: value, ...extra } as Partial<TaskRowDTO>), () => updateAdminTaskField(task.id, field, value));

  const openSubtasks = task.subtasks.filter((s) => !s.done).length;
  const setStatus = (next: string, confirmed = false) => {
    if (next === task.status) return;
    if (isClosed(next) && !isClosed(task.status) && openSubtasks > 0 && !confirmed) {
      setConfirmClose(next as "DONE" | "CANCELED");
      return;
    }
    setConfirmClose(null);
    const closedAt = isClosed(next) ? (isClosed(task.status) ? task.closedAt : new Date().toISOString()) : null;
    void setField("status", next, { closedAt });
  };

  const setAssignee = (v: string) => {
    const p = people.find((x) => x.id === v) ?? null;
    void setField("assigneeId", v || null, { assigneeName: p?.name ?? null });
  };

  // ── take it (2026-10-15): the login is shared, so it asks who; a To-do starts; the team hears who took it ──
  const mine = useTakeAs();
  const takeChoices = takeOptions(people, mine).filter((o) => o.value !== task.assigneeId);
  const [taker, setTaker] = useState("");
  const [switching, setSwitching] = useState(false);
  const who = takeChoices.some((o) => o.value === taker) ? taker : takeChoices[0]?.value ?? "";
  const firstName = (n: string | null) => (n ?? "").split(/\s+/)[0] || "them";
  const take = async () => {
    if (!who) return;
    const name = people.find((x) => x.id === who)?.name ?? null;
    rememberTakeAs(who);
    setSwitching(false);
    const err = await run(fieldPatch({ assigneeId: who, assigneeName: name, status: task.status === "TODO" ? "IN_PROGRESS" : task.status }), () => takeAdminTask(task.id, who));
    if (!err) toast.success(`${firstName(name)} has it`, "The rest of the team got a text.");
  };

  // ── subtasks ──
  const subRun = (patch: (subs: SubtaskDTO[]) => SubtaskDTO[], call: () => Promise<TaskResult>) => run(subtaskPatch(patch), call);
  const [newSub, setNewSub] = useState("");
  const addSub = async () => {
    const title = newSub.replace(/\s+/g, " ").trim();
    if (!title) return;
    setNewSub("");
    const temp: SubtaskDTO = { id: `tmp-${Date.now()}`, title, done: false, assigneeId: null, position: 1e9 };
    const err = await subRun((subs) => [...subs, temp], () => addAdminSubtask(task.id, title));
    if (err) setNewSub(title);
  };
  const move = (index: number, by: -1 | 1) => {
    const order = task.subtasks.map((s) => s.id);
    const j = index + by;
    if (j < 0 || j >= order.length || order.some((x) => x.startsWith("tmp-"))) return;
    [order[index], order[j]] = [order[j], order[index]];
    void subRun(
      (subs) => order.map((sid) => subs.find((s) => s.id === sid)).filter((s): s is SubtaskDTO => !!s),
      () => reorderAdminSubtasks(task.id, order),
    );
  };

  // ── comments ──
  const [comment, setComment] = useState("");
  const sendComment = async () => {
    const body = comment.trim();
    if (!body) return;
    setComment("");
    const temp: FeedItemDTO = { type: "comment", id: `tmp-${Date.now()}`, at: new Date().toISOString(), actorId: me.id, actorName: "You", body };
    const err = await run(
      { detail: (d) => ({ ...d, feed: [...d.feed, temp] }), row: (r) => ({ ...r, comments: r.comments + 1 }) },
      () => addAdminTaskComment(task.id, body),
    );
    if (err) setComment(body);
  };

  const closed = isClosed(task.status);
  const overdue = isOverdue(task, today);
  const linkHref = task.linkUrl;
  const internal = !!linkHref && linkHref.startsWith("/");

  return (
    <>
      <SheetBody>
        {error ? <Note tone="danger">{error}</Note> : null}

        {!isClosed(task.status) && (task.assigneeId || takeChoices.length) ? (
          <div className={cx("takeBar", task.assigneeId && "takeMine")} data-take-bar={task.assigneeId ? (isMemberRef(task.assigneeId) ? "member" : "admin") : "free"}>
            <span className={cx("takeWho")}>
              {task.assigneeId ? (
                <>
                  <b>{task.assigneeId === me.id ? "You have" : `${task.assigneeName} has`} this task.</b> Mark it done when it&apos;s finished — the team gets a text.
                </>
              ) : (
                <b>Nobody has this task yet.</b>
              )}
            </span>
            <span className={cx("rowBtns")}>
              {task.assigneeId && !switching ? (
                <>
                  {takeChoices.length ? (
                    <button type="button" className={cx("btn", "btn-quiet", "btn-sm")} onClick={() => setSwitching(true)} data-take-switch>
                      Someone else is taking it
                    </button>
                  ) : null}
                  <button type="button" className={cx("btn", "btn-primary", "btn-sm")} onClick={() => setStatus("DONE")} data-take-done>
                    <Check size={14} aria-hidden />
                    Mark done
                  </button>
                </>
              ) : (
                <>
                  <select className={cx("in", "takePick")} value={who} onChange={(e) => setTaker(e.target.value)} aria-label="Who's taking it" data-take-who>
                    {takeChoices.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  {switching ? (
                    <button type="button" className={cx("btn", "btn-quiet", "btn-sm")} onClick={() => setSwitching(false)}>
                      Keep it with {firstName(task.assigneeName)}
                    </button>
                  ) : null}
                  <button type="button" className={cx("btn", "btn-primary", "btn-sm")} onClick={() => void take()} disabled={!who} data-take>
                    <Hand size={14} aria-hidden />
                    {switching ? `Take it from ${firstName(task.assigneeName)}` : "Take it"}
                  </button>
                </>
              )}
            </span>
          </div>
        ) : null}

        <Field label="Title">
          <InlineText value={task.title} onCommit={(v) => void setField("title", v)} label="Title" maxLength={TITLE_MAX} className={cx("in")} />
        </Field>

        <div className={cx("tsGrid")}>
          <Field label="Status">
            <Select value={task.status} onChange={(v) => setStatus(v)} options={STATUS_OPTIONS} ariaLabel="Status" />
          </Field>
          <Field label="Priority">
            <Select value={task.priority} onChange={(v) => void setField("priority", v)} options={PRIORITY_OPTIONS} ariaLabel="Priority" />
          </Field>
          <Field label="Assignee">
            <Select
              value={task.assigneeId ?? ""}
              onChange={setAssignee}
              placeholder="Unassigned"
              options={people.map((p) => ({ value: p.id, label: p.name }))}
              ariaLabel="Assignee"
            />
          </Field>
          <Field label="Category">
            <Select value={task.category} onChange={(v) => void setField("category", v)} options={CATEGORY_OPTIONS} ariaLabel="Category" />
          </Field>
          <Field label={overdue ? "Due · overdue" : "Due"} htmlFor={`${id}-due`}>
            <input
              id={`${id}-due`}
              type="date"
              className={cx("in", "in--mono", overdue && "overdue")}
              value={task.dueDate ?? ""}
              onChange={(e) => void setField("dueDate", e.target.value || null)}
            />
          </Field>
          <Field label="Progress">
            <ProgressBar task={{ status: task.status, subtasksDone: task.subtasks.filter((s) => s.done).length, subtasksTotal: task.subtasks.length }} />
          </Field>
        </div>

        <Field label="Related link" hint="An admin page (/admin/…) or a web address.">
          <div className={cx("tsLinkRow")}>
            <div>
              <InlineText
                value={task.linkUrl ?? ""}
                onCommit={(v) => void setField("linkUrl", v || null)}
                label="Related link"
                className={cx("in", "in--mono")}
                placeholder="/admin/support?ticket=…"
                allowEmpty
                validate={(v) => (cleanLink(v) === null ? "Use an admin path (/admin/…) or an http(s) address." : null)}
              />
            </div>
            {linkHref ? (
              internal ? (
                <Link href={linkHref as Route} className={cx("btn", "btn-ghost", "btn-field", "tsOpenLink")}>
                  <Ic name="link" />
                  Open
                </Link>
              ) : (
                <a href={linkHref} target="_blank" rel="noopener noreferrer" className={cx("btn", "btn-ghost", "btn-field", "tsOpenLink")}>
                  <Ic name="ext" />
                  Open
                </a>
              )
            ) : null}
          </div>
        </Field>

        <section className={cx("sec")}>
          <div className={cx("sec-h")}>
            <span className={cx("sec-t")}>Description</span>
            {!editingDesc ? (
              <button type="button" className={cx("btn", "btn-quiet", "btn-sm")} onClick={() => setEditingDesc(true)}>
                <Ic name="pen" />
                Edit
              </button>
            ) : null}
          </div>
          {editingDesc ? (
            <DescriptionEditor
              value={task.description}
              onCancel={() => setEditingDesc(false)}
              onSave={(v) => {
                setEditingDesc(false);
                if (v !== task.description) void setField("description", v);
              }}
            />
          ) : (
            <div className={cx("desc", !task.description && "descEmpty")}>{task.description ? <Linkified text={task.description} /> : "No description yet."}</div>
          )}
        </section>

        <TaskPictures task={task} store={store} />

        <section className={cx("sec")} aria-labelledby={`${id}-subs`}>
          <div className={cx("sec-h")}>
            <span className={cx("sec-t")} id={`${id}-subs`}>
              Subtasks
            </span>
            <span className={cx("sec-m")}>
              {task.subtasks.length ? `${task.subtasks.filter((s) => s.done).length} / ${task.subtasks.length} done` : "None yet"}
            </span>
          </div>
          {task.subtasks.length ? (
            <div className={cx("subs")}>
              {task.subtasks.map((st, i) => (
                <SubtaskRow
                  key={st.id}
                  sub={st}
                  first={i === 0}
                  last={i === task.subtasks.length - 1}
                  people={people}
                  onToggle={(done) => void subRun((subs) => subs.map((x) => (x.id === st.id ? { ...x, done } : x)), () => updateAdminSubtask(st.id, { done }))}
                  onRename={(title) => void subRun((subs) => subs.map((x) => (x.id === st.id ? { ...x, title } : x)), () => updateAdminSubtask(st.id, { title }))}
                  onAssign={(assigneeId) =>
                    void subRun((subs) => subs.map((x) => (x.id === st.id ? { ...x, assigneeId } : x)), () => updateAdminSubtask(st.id, { assigneeId }))
                  }
                  onRemove={() => void subRun((subs) => subs.filter((x) => x.id !== st.id), () => removeAdminSubtask(st.id))}
                  onMove={(by) => move(i, by)}
                />
              ))}
            </div>
          ) : null}
          <form
            className={cx("subAdd")}
            onSubmit={(e) => {
              e.preventDefault();
              void addSub();
            }}
          >
            <input
              className={cx("in")}
              value={newSub}
              maxLength={SUBTASK_MAX}
              onChange={(e) => setNewSub(e.target.value)}
              placeholder="Add a subtask"
              aria-label="New subtask"
            />
            <button type="submit" className={cx("btn", "btn-ghost", "btn-field")} disabled={!newSub.trim()}>
              <Ic name="plus" />
              Add
            </button>
          </form>
        </section>

        <section className={cx("sec")} aria-labelledby={`${id}-feed`}>
          <div className={cx("sec-h")}>
            <span className={cx("sec-t")} id={`${id}-feed`}>
              Activity
            </span>
            <span className={cx("sec-m")}>
              {task.feed.filter((f) => f.type === "comment").length} comments
            </span>
          </div>
          <div className={cx("feed")}>
            {task.feed.map((f) => (
              <FeedRow key={f.id} item={f} hydrated={hydrated} />
            ))}
          </div>
          <form
            className={cx("compose")}
            onSubmit={(e) => {
              e.preventDefault();
              void sendComment();
            }}
          >
            <textarea
              className={cx("in", "ta")}
              rows={3}
              value={comment}
              maxLength={COMMENT_MAX}
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void sendComment();
                }
              }}
              placeholder="Write a comment — links become clickable"
              aria-label="Comment"
            />
            <div className={cx("rowBtns", "composeBtns")}>
              <TaskDictate value={comment} max={COMMENT_MAX} label="Speak a comment" onChange={setComment} />
              <button type="submit" className={cx("btn", "btn-ghost", "btn-sm")} disabled={!comment.trim()}>
                <Ic name="send" />
                Comment
              </button>
            </div>
          </form>
        </section>
      </SheetBody>

      <SheetFoot>
        {confirmClose ? (
          <div className={cx("confirm")} role="alertdialog" aria-label="Close with open subtasks">
            <Note tone="warn">
              {openSubtasks} of {task.subtasks.length} subtasks {openSubtasks === 1 ? "is" : "are"} still open. {confirmClose === "DONE" ? "Mark the task done" : "Cancel the task"} anyway?
            </Note>
            <div className={cx("rowBtns")}>
              <button type="button" className={cx("btn", "btn-ghost")} onClick={() => setConfirmClose(null)}>
                Keep it open
              </button>
              <button type="button" className={cx("btn", confirmClose === "DONE" ? "btn-primary" : "btn-danger")} onClick={() => setStatus(confirmClose, true)}>
                {confirmClose === "DONE" ? "Mark done anyway" : "Cancel anyway"}
              </button>
            </div>
          </div>
        ) : closed ? (
          <>
            <span className={cx("footGrow", "busy")}>
              {STATUS_LABEL[task.status as "DONE"] ?? task.status}
              {task.closedAt ? ` · ${hydrated ? stampLabel(task.closedAt) : task.closedAt.slice(0, 10)}` : ""}
            </span>
            <button type="button" className={cx("btn", "btn-primary")} onClick={() => setStatus("TODO")}>
              <Ic name="undo" />
              Reopen
            </button>
          </>
        ) : (
          <>
            <button type="button" className={cx("btn", "btn-quiet", "btn-danger")} onClick={() => setStatus("CANCELED")}>
              <Ic name="ban" />
              Cancel task
            </button>
            <button type="button" className={cx("btn", "btn-primary")} onClick={() => setStatus("DONE")}>
              <Ic name="check" />
              Mark done
            </button>
          </>
        )}
      </SheetFoot>
    </>
  );
}

function DescriptionEditor({ value, onSave, onCancel }: { value: string; onSave: (v: string) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState(value);
  const [base] = useState(value);
  const changedMeanwhile = value !== base;
  return (
    <div className={cx("compose")}>
      <textarea
        className={cx("in", "ta")}
        rows={6}
        value={draft}
        maxLength={DESCRIPTION_MAX}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onCancel();
          } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onSave(draft.replace(/\s+$/, ""));
          }
        }}
        aria-label="Description"
        autoFocus
      />
      <TaskDictate value={draft} max={DESCRIPTION_MAX} label="Speak" onChange={setDraft} />
      {changedMeanwhile ? (
        <span className={cx("fld-hint", "tsHint")} role="status">
          Someone changed the description while you were editing — saving replaces their version.
        </span>
      ) : null}
      <div className={cx("rowBtns")}>
        <button type="button" className={cx("btn", "btn-ghost", "btn-sm")} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className={cx("btn", "btn-primary", "btn-sm")} onClick={() => onSave(draft.replace(/\s+$/, ""))}>
          Save
        </button>
      </div>
    </div>
  );
}

function SubtaskRow({
  sub,
  first,
  last,
  people,
  onToggle,
  onRename,
  onAssign,
  onRemove,
  onMove,
}: {
  sub: SubtaskDTO;
  first: boolean;
  last: boolean;
  people: AdminPersonDTO[];
  onToggle: (done: boolean) => void;
  onRename: (title: string) => void;
  onAssign: (assigneeId: string | null) => void;
  onRemove: () => void;
  onMove: (by: -1 | 1) => void;
}) {
  const temp = sub.id.startsWith("tmp-");
  return (
    <div className={cx("sub", sub.done && "subDone")}>
      <span className={cx("subBox")}>
        <Toggle on={sub.done} onChange={onToggle} label={<span className={cx("sr")}>Done</span>} ariaLabel={`Done: ${sub.title}`} disabled={temp} />
      </span>
      <span className={cx("subTitle")}>
        <InlineText value={sub.title} onCommit={onRename} label={`Subtask: ${sub.title}`} maxLength={SUBTASK_MAX} className={cx("subIn")} />
      </span>
      <span className={cx("subWho")}>
        <Select
          value={sub.assigneeId ?? ""}
          onChange={(v) => onAssign(v || null)}
          placeholder="Anyone"
          // A subtask goes to an admin with a sign-in (its column holds an account); the task itself to anyone.
          options={people.filter((p) => !isMemberRef(p.id)).map((p) => ({ value: p.id, label: p.name }))}
          ariaLabel={`Who does “${sub.title}”`}
          disabled={temp}
        />
      </span>
      <span className={cx("subTools")}>
        <button type="button" className={cx("iconBtn", "up")} onClick={() => onMove(-1)} disabled={first || temp} aria-label={`Move “${sub.title}” up`}>
          <Ic name="chev" />
        </button>
        <button type="button" className={cx("iconBtn", "down")} onClick={() => onMove(1)} disabled={last || temp} aria-label={`Move “${sub.title}” down`}>
          <Ic name="chev" />
        </button>
        <button type="button" className={cx("iconBtn", "iconDanger")} onClick={onRemove} disabled={temp} aria-label={`Remove “${sub.title}”`}>
          <Ic name="trash" />
        </button>
      </span>
    </div>
  );
}

function FeedRow({ item, hydrated }: { item: FeedItemDTO; hydrated: boolean }) {
  const when = hydrated ? stampLabel(item.at) : item.at.slice(0, 16).replace("T", " ");
  const pending = item.id.startsWith("tmp-");
  let body: ReactNode;
  if (item.type === "comment") {
    body = (
      <div className={cx("fBody")}>
        <Linkified text={item.body} />
      </div>
    );
  } else {
    body = (
      <div className={cx("fEvent")}>
        <b>{item.actorName}</b> {eventWords(item)}
      </div>
    );
  }
  return (
    <div className={cx("fItem", pending && "fPending")}>
      {item.type === "comment" ? (
        <div className={cx("fMeta")}>
          <span className={cx("fWho")}>{item.actorName}</span>
          <time dateTime={item.at}>{pending ? "Sending…" : when}</time>
        </div>
      ) : (
        <div className={cx("fMeta")}>
          <time dateTime={item.at}>{when}</time>
        </div>
      )}
      {body}
    </div>
  );
}
