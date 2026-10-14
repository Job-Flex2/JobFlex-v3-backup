"use client";

// ADMIN · SUPPORT — the triage queue.
// Route: /admin/support. Renders ONLY the shell's `.content` children (the
// admin layout mounts the blueprint chrome), as a fragment, so the reveal
// cascade walks `.content > *`.
//
// Every ticket any org has filed, newest first: who, which org, category,
// status, age, and whether it arrived since the operator last looked. Opening
// a row shows the message verbatim and changes the status. The write is the
// existing `updateTicketStatus` (src/actions/admin.ts), which whitelists the
// four statuses — the column is a free String, so that guard is the only one.
//
// THE ANSWER (owner, 2026-10-14: "respond to the client from admin right
// away"): under the message, the answers already given and a box to write the
// next one — sent by email to whoever filed the ticket as a plain letter with
// the ticket quoted under it (replyToSupportTicket), kept in the thread here
// and on the contractor's own support page; an Open ticket turns In progress.
//
// The controls are components/v3/admin-users/admin-kit, and the vocabulary is
// its admin-shared.module.css: same buttons, same estimate-style table, same
// status badges, same hand-rolled sheet as /admin/users and /admin/plans.
// decisions.md — "never create parallel style sets for identical blocks".

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { replyToSupportTicket, updateTicketStatus } from "@/actions/admin";
import type { SupportReply } from "@/lib/supportReply";
import { createTaskFromSupportTicket } from "@/actions/adminTasks";
import { taskPath } from "@/lib/adminTasks/model";
import shared from "@/components/v3/admin-users/admin-shared.module.css";
import {
  makeCx,
  KIT_BTN_CLASS,
  useSheet,
  Sheet,
  SheetBody,
  SheetFoot,
  Field,
  Select,
  Note,
  errorMessage,
} from "@/components/v3/admin-users/admin-kit";
import { useAdminMotion } from "@/components/v3/admin-users/use-admin-motion";
import s from "./admin-support.module.css";

const cx = makeCx(s, shared);

export interface SupportTicketDTO {
  id: string;
  /** Short reference, derived from the id by the page (lib/notify). */
  ref: string;
  subject: string;
  body: string;
  category: string;
  priority: string;
  status: string;
  orgName: string;
  submitterEmail: string | null;
  createdAt: string;
  /** No adminReadAt yet — the ticket arrived since the last inbox visit. */
  unread: boolean;
  /** The task made from this ticket on /admin/tasks, if any. */
  task: { id: string; title: string; status: string } | null;
  /** The answers already given, oldest first (lib/supportReplies). */
  replies: SupportReply[];
  /** Where an answer goes — whoever filed it, else the account's owner, else its billing email; null = nowhere. */
  to: string | null;
}

export interface SupportCounts {
  open: number;
  inProgress: number;
  resolved: number;
  closed: number;
}

/** The four statuses `updateTicketStatus` accepts. Any other string in the
 *  column is shown as-is and never offered. */
const STATUS_OPTIONS = [
  { value: "OPEN", label: "Open" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "RESOLVED", label: "Resolved" },
  { value: "CLOSED", label: "Closed" },
];

/** `SupportTicket.category` — the taxonomy both writers share (the
 *  /dashboard/support form and the corner Help widget). */
const CATEGORY_LABEL: Record<string, string> = {
  technical: "Technical",
  billing: "Billing",
  account: "Account",
  feature: "Feature",
  general: "General",
};

function categoryLabel(c: string): string {
  return CATEGORY_LABEL[c] ?? c;
}

function statusLabel(status: string): string {
  return STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status.replace(/_/g, " ");
}

function statusTone(status: string): string | false {
  switch (status) {
    case "OPEN":
      return "st--bp";
    case "IN_PROGRESS":
      return "st--warn";
    case "RESOLVED":
      return "st--ok";
    default:
      return false;
  }
}

/** Age, anchored on a clock the SERVER read, so the first paint and the
 *  hydration agree. `Date.now()` here would differ between the two and React
 *  would report a mismatch on every row. */
function age(iso: string, now: string): string {
  const diff = (new Date(now).getTime() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d`;
  return `${Math.floor(diff / (86400 * 30))}mo`;
}

const FILED = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});
/** UTC, so server and client render the same string. */
function filedAt(iso: string): string {
  return `${FILED.format(new Date(iso))} UTC`;
}

export function AdminSupportContent({
  tickets,
  counts,
  now,
  initialTicketId = null,
  tasksAvailable = true,
  signer = "JobFlex support",
}: {
  tickets: SupportTicketDTO[];
  counts: SupportCounts;
  /** ?ticket=<id> — open this ticket on arrival (a task's related link). */
  initialTicketId?: string | null;
  /** False when the task tables can't be read: no "Create task" then. */
  tasksAvailable?: boolean;
  /** ISO clock read in the server page — the anchor for every age. */
  now: string;
  /** The name a reply is signed with — this admin's. */
  signer?: string;
}) {
  useAdminMotion(KIT_BTN_CLASS);

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  // A task's "related link" lands here with ?ticket=<id>: that ticket starts selected.
  const [selected, setSelected] = useState<SupportTicketDTO | null>(() =>
    initialTicketId ? (tickets.find((x) => x.id === initialTicketId) ?? null) : null,
  );
  /** Tasks made from tickets on this visit (the rows themselves are not re-read). */
  const [madeTasks, setMadeTasks] = useState<Record<string, NonNullable<SupportTicketDTO["task"]>>>({});
  const sheet = useSheet();

  /** Only the categories actually present, so the filter can never offer a
   *  choice that returns nothing. */
  const categoryOptions = useMemo(() => {
    const seen = Array.from(new Set(tickets.map((t) => t.category)));
    return seen.sort().map((c) => ({ value: c, label: categoryLabel(c) }));
  }, [tickets]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tickets.filter((t) => {
      if (status && t.status !== status) return false;
      if (category && t.category !== category) return false;
      if (!q) return true;
      return (
        t.subject.toLowerCase().includes(q) ||
        t.body.toLowerCase().includes(q) ||
        t.orgName.toLowerCase().includes(q) ||
        t.ref.toLowerCase().includes(q) ||
        (t.submitterEmail ?? "").toLowerCase().includes(q)
      );
    });
  }, [tickets, query, status, category]);

  const openRow = useCallback(
    (t: SupportTicketDTO) => {
      setSelected(t);
      sheet.open();
    },
    [sheet],
  );
  const closeSheet = useCallback(() => sheet.close(() => setSelected(null)), [sheet]);

  // …and its sheet opens once, on arrival.
  const linked = useRef(false);
  useEffect(() => {
    if (linked.current) return;
    linked.current = true;
    if (selected) sheet.open();
  }, [selected, sheet]);

  const onRowKey = (e: KeyboardEvent<HTMLTableRowElement>, t: SupportTicketDTO) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openRow(t);
    }
  };

  const filtering = Boolean(query.trim() || status || category);

  return (
    <>
      <div className={cx("page-head")}>
        <div>
          <div className={cx("kicker")}>Platform</div>
          <h1 className={cx("page-title")}>Support tickets</h1>
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
          <div className={cx("kpi-lbl")}>Resolved</div>
          <div className={cx("kpi-val")}>{counts.resolved}</div>
        </div>
        <div className={cx("kpi")}>
          <div className={cx("kpi-lbl")}>Closed</div>
          <div className={cx("kpi-val")}>{counts.closed}</div>
        </div>
      </div>

      <section className={cx("card")}>
        <div className={cx("filters")}>
          <label className={cx("search", "fSearch")}>
            <Search className={cx("ic")} aria-hidden="true" />
            <input
              type="search"
              placeholder="Subject, message, org, email or ref…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search tickets"
            />
          </label>
          <div className={cx("fSel")}>
            <Select
              value={status}
              onChange={setStatus}
              placeholder="Any status"
              options={STATUS_OPTIONS}
              ariaLabel="Filter by status"
            />
          </div>
          <div className={cx("fSel")}>
            <Select
              value={category}
              onChange={setCategory}
              placeholder="Any category"
              options={categoryOptions}
              ariaLabel="Filter by category"
            />
          </div>
          {filtering ? (
            <button
              type="button"
              className={cx("btn", "btn-ghost", "btn-sm")}
              onClick={() => {
                setQuery("");
                setStatus("");
                setCategory("");
              }}
            >
              Clear
            </button>
          ) : null}
          <span className={cx("count")}>
            {filtered.length}/{tickets.length}
          </span>
        </div>
      </section>

      <section className={cx("card", "tbl-card")}>
        {filtered.length === 0 ? (
          <div className={cx("tbl-empty")}>
            {tickets.length === 0 ? "No tickets yet." : "Nothing matches those filters."}
          </div>
        ) : (
          <div className={cx("tbl-wrap")}>
            <table className={cx("tbl", "tbl--stack")}>
              <colgroup>
                <col className={cx("cTicket")} />
                <col className={cx("cCat")} />
                <col className={cx("cStatus")} />
                <col className={cx("cAge")} />
              </colgroup>
              <thead>
                <tr>
                  <th>Ticket</th>
                  <th>Category</th>
                  <th>Status</th>
                  <th>Age</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => (
                  <tr
                    key={t.id}
                    className={cx("is-link")}
                    tabIndex={0}
                    role="button"
                    aria-label={`Open ticket ${t.ref}`}
                    onClick={() => openRow(t)}
                    onKeyDown={(e) => onRowKey(e, t)}
                  >
                    <td>
                      <div className={cx("subj")}>
                        {t.unread ? (
                          <span className={cx("mark")} role="img" aria-label="New" />
                        ) : null}
                        <div
                          className={cx("t-title", t.unread && "unread")}
                          title={t.subject}
                        >
                          {t.subject}
                        </div>
                        {t.priority === "high" ? (
                          <span className={cx("st", "st--danger")}>Urgent</span>
                        ) : null}
                      </div>
                      <div className={cx("t-sub")} title={t.submitterEmail ?? undefined}>
                        {t.orgName}
                        {t.submitterEmail ? ` · ${t.submitterEmail}` : ""}
                      </div>
                    </td>
                    <td data-l="Category" className={cx("t-mono")}>
                      {categoryLabel(t.category)}
                    </td>
                    <td data-l="Status">
                      <span className={cx("st", statusTone(t.status))}>{statusLabel(t.status)}</span>
                    </td>
                    <td data-l="Age" className={cx("t-mono")}>
                      {age(t.createdAt, now)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Sheet
        handle={sheet}
        kicker={selected ? `${selected.ref} · ${selected.orgName}` : "Ticket"}
        title={selected?.subject ?? "Ticket"}
        onClose={closeSheet}
      >
        {selected ? (
          <TicketDetail
            key={selected.id}
            ticket={selected}
            task={madeTasks[selected.id] ?? selected.task}
            onTask={(t) => setMadeTasks((m) => ({ ...m, [selected.id]: t }))}
            tasksAvailable={tasksAvailable}
            signer={signer}
          />
        ) : null}
      </Sheet>
    </>
  );
}

// ── The open ticket ────────────────────────────────────────────────
// Keyed on the ticket id by the parent, so every field initialises from props
// and no effect syncs state — the sheet stays mounted through its 190ms exit
// with the last ticket's values still in place (admin-kit's contract).

function TicketDetail({
  ticket,
  task,
  onTask,
  tasksAvailable,
  signer,
}: {
  ticket: SupportTicketDTO;
  task: SupportTicketDTO["task"];
  onTask: (t: NonNullable<SupportTicketDTO["task"]>) => void;
  tasksAvailable: boolean;
  signer: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(ticket.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [making, setMaking] = useState(false);
  // The answer: the thread so far, the one being written, and the last send.
  const [replies, setReplies] = useState<SupportReply[]>(ticket.replies);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sentAt, setSentAt] = useState<string | null>(null);
  const [replyError, setReplyError] = useState<string | null>(null);

  async function sendReply() {
    if (sending || !ticket.to) return;
    setSending(true);
    setReplyError(null);
    try {
      const r = await replyToSupportTicket(ticket.id, draft);
      if (r.ok) {
        setReplies((list) => [...list, r.reply]);
        setDraft("");
        setSentAt(r.reply.at);
        setStatus(r.status);
        router.refresh();
      } else setReplyError(r.error);
    } catch {
      setReplyError("The reply did not go out. Check the connection and try again.");
    } finally {
      setSending(false);
    }
  }

  // "Create task" (2026-10-11): a Support task on /admin/tasks with the
  // ticket's subject and message and a link back here. A second press — or a
  // second admin — gets the task already made, never a duplicate.
  async function makeTask() {
    setMaking(true);
    setError(null);
    try {
      const r = await createTaskFromSupportTicket(ticket.id);
      if (r.ok) onTask({ id: r.task.id, title: r.task.title, status: r.task.status });
      else setError(r.error);
    } catch {
      setError("Couldn't create the task. Check your connection and try again.");
    } finally {
      setMaking(false);
    }
  }

  async function change(next: string) {
    const previous = status;
    setStatus(next);
    setBusy(true);
    setError(null);
    try {
      await updateTicketStatus(ticket.id, next);
      router.refresh();
    } catch (err: unknown) {
      setStatus(previous);
      setError(errorMessage(err, "Could not change the status."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <SheetBody>
        <div className={cx("meta")}>
          <span>
            Filed <b>{filedAt(ticket.createdAt)}</b>
          </span>
          <span>
            Category <b>{categoryLabel(ticket.category)}</b>
          </span>
          <span>
            Priority <b>{ticket.priority}</b>
          </span>
          {ticket.submitterEmail ? (
            <span>
              From <b>{ticket.submitterEmail}</b>
            </span>
          ) : null}
        </div>

        <div className={cx("msg")}>{ticket.body}</div>

        {/* The answers so far, and the next one. */}
        {replies.length ? (
          <div className={cx("thread")} data-support-thread>
            {replies.map((r) => (
              <div key={r.id} className={cx("reply")}>
                <div className={cx("replyMeta")}>
                  {r.by} · {filedAt(r.at)} · to {r.to}
                </div>
                <div className={cx("replyBody")}>{r.body}</div>
              </div>
            ))}
          </div>
        ) : null}
        <div className={cx("replyBox")} data-support-reply>
          <Field
            label={ticket.to ? "Reply" : "Reply — no address to send to"}
            htmlFor="ticket-reply"
            hint={ticket.to ? `Goes by email to ${ticket.to} as a plain letter signed ${signer} · JobFlex support — no need to sign it — with the ticket quoted under it. Their reply comes back to support@jobflex.app.` : "Nobody is on this ticket and the account has no owner or billing email."}
          >
            <textarea
              id="ticket-reply"
              className={cx("in", "ta")}
              rows={4}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Write the answer as you'd say it."
              disabled={!ticket.to || sending}
              data-support-reply-text
            />
          </Field>
          <div className={cx("replyActs")}>
            <button type="button" className={cx("btn", "btn-primary", "btn-sm")} onClick={sendReply} disabled={!ticket.to || sending || draft.trim().length < 2} data-support-send>
              {sending ? "Sending…" : "Send the reply"}
            </button>
            {sentAt && !draft ? <span className={cx("replySent")} data-support-sent>Sent · {filedAt(sentAt)}</span> : null}
          </div>
          {replyError ? <Note tone="danger">{replyError}</Note> : null}
        </div>

        {/* Without the task tables (not set up yet) there is nothing to link or make. */}
        {tasksAvailable ? (
          <div className={cx("taskBar")}>
            {task ? (
              <Link href={taskPath(task.id) as Route} className={cx("btn", "btn-ghost", "btn-sm", "taskLink")}>
                <svg className={cx("ic")} aria-hidden="true" focusable="false">
                  <use href="#i-board" />
                </svg>
                <span className={cx("taskLinkTxt")}>Task: {task.title}</span>
              </Link>
            ) : (
              <button type="button" className={cx("btn", "btn-ghost", "btn-sm")} onClick={makeTask} disabled={making}>
                <svg className={cx("ic")} aria-hidden="true" focusable="false">
                  <use href="#i-plus" />
                </svg>
                {making ? "Creating…" : "Create task"}
              </button>
            )}
          </div>
        ) : null}

        {error ? <Note tone="danger">{error}</Note> : null}
      </SheetBody>

      <SheetFoot>
        <div className={cx("grow")}>
          <Field label="Status" hint={busy ? "Saving" : undefined}>
            <Select
              value={status}
              onChange={change}
              options={STATUS_OPTIONS}
              disabled={busy}
              ariaLabel="Ticket status"
            />
          </Field>
        </div>
      </SheetFoot>
    </>
  );
}
