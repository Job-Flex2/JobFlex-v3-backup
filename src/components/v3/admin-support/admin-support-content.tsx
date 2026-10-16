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
// THE AI (owner, 2026-10-15: "add smart AI that answers them automatically …
// copy to our email … a bug: tell the user we're on it, but don't fix
// anything — ask in admin and email us, we confirm"): the switch above the
// queue, a state chip on every row the AI has read, and in the sheet what it
// did — the answer it sent or the one waiting for you, its notes, and a bug's
// fix proposal with Approve / Decline and, once approved and live, "Mark
// fixed — tell the customer". The work is lib/support; the writes are
// actions/supportAi.
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
import { approveSupportFix, askSupportAi, declineSupportFix, markSupportFixed, setSupportAiMode } from "@/actions/supportAi";
import {
  SUPPORT_AI_CATEGORY_LABEL,
  SUPPORT_AI_MODES,
  SUPPORT_AI_MODE_LABEL,
  badgeFor,
  needsPersonSince,
  waitingForPerson,
  type SupportAiBadge,
  type SupportAiMode,
  type SupportAiRecord,
} from "@/lib/support/aiState";
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
  /** What the support AI did on this ticket (lib/support), or null when it hasn't read it. */
  ai: SupportAiRecord | null;
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

/** A person answered after the AI read the ticket — or after the customer said
 *  it still isn't solved: what was waiting is handled. */
function answeredByPerson(t: { replies: SupportReply[] }, ai: SupportAiRecord | null): boolean {
  if (!ai) return false;
  const since = needsPersonSince(ai);
  return t.replies.some((r) => !r.ai && r.at > since);
}

function badgeTone(b: SupportAiBadge): string | false {
  return b.tone === "ok" ? "st--ok" : b.tone === "warn" ? "st--warn" : b.tone === "danger" ? "st--danger" : b.tone === "info" ? "st--sky" : false;
}

function modeHint(mode: SupportAiMode, copyTo: string[]): string {
  const inbox = copyTo.length ? copyTo.join(", ") : "the support inbox";
  if (mode === "auto") {
    return `Answers new tickets on its own and copies every answer to ${inbox}. Money back, account changes, upset customers and anything it isn't sure of wait for you — the customer gets a "we're on it" note at once. Bugs come with a fix proposal for your OK; nothing is changed without it.`;
  }
  if (mode === "draft") return `Writes an answer for every new ticket and copies it to ${inbox}. Nothing reaches the customer until you send it.`;
  return `Off — new tickets wait for you. "Ask AI" on a ticket still writes a draft.`;
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
  aiMode = "auto",
  aiCopyTo = [],
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
  /** The support AI's switch, and where its copies go. */
  aiMode?: SupportAiMode;
  aiCopyTo?: string[];
}) {
  useAdminMotion(KIT_BTN_CLASS);

  // The AI: its switch, what it did on tickets touched this visit, and the queue filter.
  const [mode, setMode] = useState<SupportAiMode>(aiMode);
  const [modeBusy, setModeBusy] = useState(false);
  const [modeError, setModeError] = useState<string | null>(null);
  const [liveAi, setLiveAi] = useState<Record<string, SupportAiRecord>>({});
  const [aiFilter, setAiFilter] = useState<"" | "fix" | "needs">("");
  const aiOf = useCallback((t: SupportTicketDTO) => liveAi[t.id] ?? t.ai, [liveAi]);
  const fixesWaiting = tickets.filter((t) => aiOf(t)?.fix?.status === "awaiting").length;
  const answersWaiting = tickets.filter((t) => waitingForPerson(aiOf(t), answeredByPerson(t, aiOf(t)))).length;

  async function changeMode(next: string) {
    const previous = mode;
    setMode(next as SupportAiMode);
    setModeBusy(true);
    setModeError(null);
    try {
      const r = await setSupportAiMode(next);
      if (!r.ok) {
        setMode(previous);
        setModeError(r.error);
      }
    } catch {
      setMode(previous);
      setModeError("Couldn't change it. Check the connection and try again.");
    } finally {
      setModeBusy(false);
    }
  }

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
      const ai = liveAi[t.id] ?? t.ai;
      if (aiFilter === "fix" && ai?.fix?.status !== "awaiting") return false;
      if (aiFilter === "needs" && !waitingForPerson(ai, answeredByPerson(t, ai))) return false;
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
  }, [tickets, query, status, category, aiFilter, liveAi]);

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

  const filtering = Boolean(query.trim() || status || category || aiFilter);

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

      {/* The support AI: its switch, and what is waiting for you. */}
      <section className={cx("card", "aiPanel")} data-support-ai-panel>
        <div className={cx("aiPanelRow")}>
          <div className={cx("aiPanelTxt")}>
            <div className={cx("aiPanelT")}>AI support</div>
            <div className={cx("aiPanelS")} data-support-ai-hint>{modeHint(mode, aiCopyTo)}</div>
          </div>
          <div className={cx("aiMode")}>
            <Select
              value={mode}
              onChange={changeMode}
              options={SUPPORT_AI_MODES.map((m) => ({ value: m, label: SUPPORT_AI_MODE_LABEL[m] }))}
              disabled={modeBusy}
              ariaLabel="What the support AI does"
            />
          </div>
        </div>
        {fixesWaiting || answersWaiting ? (
          <div className={cx("aiChips")}>
            {fixesWaiting ? (
              <button type="button" className={cx("aiChip", "aiChip--fix", aiFilter === "fix" && "on")} onClick={() => setAiFilter(aiFilter === "fix" ? "" : "fix")} aria-pressed={aiFilter === "fix"} data-support-fix-filter>
                {fixesWaiting} fix{fixesWaiting === 1 ? "" : "es"} waiting for your OK
              </button>
            ) : null}
            {answersWaiting ? (
              <button type="button" className={cx("aiChip", aiFilter === "needs" && "on")} onClick={() => setAiFilter(aiFilter === "needs" ? "" : "needs")} aria-pressed={aiFilter === "needs"} data-support-needs-filter>
                {answersWaiting} answer{answersWaiting === 1 ? "" : "s"} waiting for you
              </button>
            ) : null}
          </div>
        ) : null}
        {modeError ? <Note tone="danger">{modeError}</Note> : null}
      </section>

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
                setAiFilter("");
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
                        {(() => {
                          const ai = liveAi[t.id] ?? t.ai;
                          const b = badgeFor(ai, answeredByPerson(t, ai));
                          return b ? (
                            <span className={cx("st", badgeTone(b), "aiBadge")} data-support-ai-badge>
                              {b.label}
                            </span>
                          ) : null;
                        })()}
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
            ai={liveAi[selected.id] ?? selected.ai}
            onAi={(rec) => setLiveAi((m) => ({ ...m, [selected.id]: rec }))}
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
  ai,
  onAi,
}: {
  ticket: SupportTicketDTO;
  task: SupportTicketDTO["task"];
  onTask: (t: NonNullable<SupportTicketDTO["task"]>) => void;
  tasksAvailable: boolean;
  signer: string;
  ai: SupportAiRecord | null;
  onAi: (rec: SupportAiRecord) => void;
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
  // The AI on this ticket: its record, the call in flight, and the fix's note.
  const [aiRec, setAiRec] = useState<SupportAiRecord | null>(ai);
  const [aiBusy, setAiBusy] = useState<"ask" | "approve" | "decline" | "done" | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [fixNote, setFixNote] = useState("");

  function keepAi(rec: SupportAiRecord) {
    setAiRec(rec);
    onAi(rec);
  }

  async function askAi() {
    setAiBusy("ask");
    setAiError(null);
    try {
      const r = await askSupportAi(ticket.id);
      if (r.ok) {
        keepAi(r.record);
        if (r.record.reply) setDraft(r.record.reply);
      } else setAiError(r.error);
    } catch {
      setAiError("The AI didn't answer. Check the connection and try again.");
    } finally {
      setAiBusy(null);
    }
  }

  async function decide(decision: "approve" | "decline") {
    setAiBusy(decision);
    setAiError(null);
    try {
      const r = decision === "approve" ? await approveSupportFix(ticket.id, fixNote) : await declineSupportFix(ticket.id, fixNote);
      if (r.ok) {
        keepAi(r.record);
        setFixNote("");
        router.refresh();
      } else setAiError(r.error);
    } catch {
      setAiError("That didn't save. Check the connection and try again.");
    } finally {
      setAiBusy(null);
    }
  }

  async function fixedNow() {
    setAiBusy("done");
    setAiError(null);
    try {
      const r = await markSupportFixed(ticket.id);
      if (r.ok) {
        keepAi(r.record);
        setReplies((list) => [...list, r.reply]);
        setStatus("RESOLVED");
        router.refresh();
      } else setAiError(r.error);
    } catch {
      setAiError("The customer wasn't told. Check the connection and try again.");
    } finally {
      setAiBusy(null);
    }
  }

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

        {/* What the support AI did here — and, for a bug, the fix waiting for a decision. */}
        <div className={cx("aiCard")} data-support-ai>
          {aiRec ? (
            <>
              <div className={cx("aiHead")}>
                {(() => {
                  const b = badgeFor(aiRec, answeredByPerson({ replies }, aiRec));
                  return b ? <span className={cx("st", badgeTone(b))}>{b.label}</span> : null;
                })()}
                {aiRec.outcome !== "failed" ? (
                  <span className={cx("aiMeta")}>
                    {SUPPORT_AI_CATEGORY_LABEL[aiRec.category]} · {aiRec.confidence}% sure · {filedAt(aiRec.at)}
                  </span>
                ) : null}
              </div>
              {aiRec.summary ? <div className={cx("aiSummary")}>{aiRec.summary}</div> : null}
              {aiRec.customer ? (
                <div className={cx("aiVerdict", aiRec.customer.verdict === "solved" ? "aiVerdict--ok" : "aiVerdict--stuck")} data-support-verdict={aiRec.customer.verdict}>
                  <b>{aiRec.customer.verdict === "solved" ? "The customer pressed “That solved it”" : "The customer pressed “I still need help”"}</b>
                  <span> · {filedAt(aiRec.customer.at)}</span>
                  {aiRec.customer.note ? <div className={cx("aiVerdictNote")}>{aiRec.customer.note}</div> : null}
                </div>
              ) : null}
              {aiRec.reason ? <div className={cx("aiWhy")}>{aiRec.outcome === "failed" ? "What happened: " : "Why it waited: "}{aiRec.reason}</div> : null}
              {aiRec.outcome !== "sent" && aiRec.reply ? (
                <details className={cx("aiMore")} open={aiRec.outcome === "held" || aiRec.outcome === "drafted"}>
                  <summary>The AI&apos;s answer{aiRec.outcome === "held" || aiRec.outcome === "drafted" ? ", waiting for you" : ""}</summary>
                  <div className={cx("replyBody")} data-support-ai-draft>{aiRec.reply}</div>
                  <button type="button" className={cx("btn", "btn-ghost", "btn-sm")} onClick={() => setDraft(aiRec.reply)} disabled={!ticket.to} data-support-ai-use>
                    Put it in the reply box
                  </button>
                </details>
              ) : null}
              {aiRec.internalNotes ? (
                <details className={cx("aiMore")}>
                  <summary>Notes for the team</summary>
                  <div className={cx("replyBody")}>{aiRec.internalNotes}</div>
                </details>
              ) : null}
              {aiRec.factsUsed.length ? (
                <details className={cx("aiMore")}>
                  <summary>What it relied on</summary>
                  <ul className={cx("aiFacts")}>
                    {aiRec.factsUsed.map((f, i) => (
                      <li key={i}>{f}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
              {aiRec.fix ? (
                <div className={cx("fix", `fix--${aiRec.fix.status}`)} data-support-fix data-fix-status={aiRec.fix.status}>
                  <div className={cx("fixHead")}>
                    <span className={cx("fixKicker")}>Fix proposal · {aiRec.fix.severity}</span>
                    <b className={cx("fixTitle")}>{aiRec.fix.title}</b>
                  </div>
                  <dl className={cx("fixList")}>
                    <dt>Symptoms</dt>
                    <dd>{aiRec.fix.symptoms}</dd>
                    <dt>Likely cause</dt>
                    <dd>{aiRec.fix.likelyCause}</dd>
                    <dt>Proposed fix</dt>
                    <dd>{aiRec.fix.proposedFix}</dd>
                    {aiRec.fix.areas.length ? (
                      <>
                        <dt>Where to look</dt>
                        <dd className={cx("fixAreas")}>{aiRec.fix.areas.join("\n")}</dd>
                      </>
                    ) : null}
                    {aiRec.fix.workaround ? (
                      <>
                        <dt>Workaround told to the customer</dt>
                        <dd>{aiRec.fix.workaround}</dd>
                      </>
                    ) : null}
                  </dl>
                  {aiRec.fix.status === "awaiting" || aiRec.fix.status === "declined" ? (
                    <div className={cx("fixActs")}>
                      {aiRec.fix.status === "declined" ? (
                        <div className={cx("aiWhy")}>
                          Declined by {aiRec.fix.decidedBy}
                          {aiRec.fix.note ? ` — ${aiRec.fix.note}` : ""}.
                        </div>
                      ) : null}
                      <input
                        className={cx("in")}
                        value={fixNote}
                        onChange={(e) => setFixNote(e.target.value)}
                        placeholder="A note for the team (optional)"
                        aria-label="A note about this fix"
                        disabled={!!aiBusy}
                      />
                      <div className={cx("replyActs")}>
                        <button type="button" className={cx("btn", "btn-primary", "btn-sm")} onClick={() => decide("approve")} disabled={!!aiBusy} data-support-fix-approve>
                          {aiBusy === "approve" ? "Approving…" : "Approve the fix"}
                        </button>
                        {aiRec.fix.status === "awaiting" ? (
                          <button type="button" className={cx("btn", "btn-ghost", "btn-sm")} onClick={() => decide("decline")} disabled={!!aiBusy} data-support-fix-decline>
                            {aiBusy === "decline" ? "Declining…" : "Decline"}
                          </button>
                        ) : null}
                      </div>
                      <div className={cx("aiWhy")}>Approving emails the brief to the team and puts it on the task board. Nothing in JobFlex changes until someone makes the fix.</div>
                    </div>
                  ) : null}
                  {aiRec.fix.status === "approved" ? (
                    <div className={cx("fixActs")}>
                      <div className={cx("aiWhy")}>
                        Approved by {aiRec.fix.decidedBy} · {aiRec.fix.decidedAt ? filedAt(aiRec.fix.decidedAt) : ""}
                        {aiRec.fix.note ? ` — ${aiRec.fix.note}` : ""}. When the fix is live:
                      </div>
                      <div className={cx("replyActs")}>
                        <button type="button" className={cx("btn", "btn-primary", "btn-sm")} onClick={fixedNow} disabled={!!aiBusy || !ticket.to} data-support-fix-done>
                          {aiBusy === "done" ? "Telling the customer…" : "Mark fixed — tell the customer"}
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {aiRec.fix.status === "done" ? (
                    <div className={cx("aiWhy")} data-support-fix-told>
                      Fixed · the customer was told {aiRec.fix.doneAt ? filedAt(aiRec.fix.doneAt) : ""}
                      {aiRec.fix.doneBy ? ` by ${aiRec.fix.doneBy}` : ""}.
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : (
            <div className={cx("aiWhy")}>The AI hasn&apos;t read this ticket.</div>
          )}
          <div className={cx("replyActs")}>
            <button type="button" className={cx("btn", "btn-ghost", "btn-sm")} onClick={askAi} disabled={!!aiBusy} data-support-ask-ai>
              {aiBusy === "ask" ? "The AI is reading…" : aiRec ? "Ask AI again" : "Ask AI for an answer"}
            </button>
            <span className={cx("aiWhy")}>A draft lands in the reply box — nothing is sent.</span>
          </div>
          {aiError ? <Note tone="danger">{aiError}</Note> : null}
        </div>

        {/* The answers so far, and the next one. */}
        {replies.length ? (
          <div className={cx("thread")} data-support-thread>
            {replies.map((r) => (
              <div key={r.id} className={cx("reply")}>
                <div className={cx("replyMeta")}>
                  {r.ai ? <span className={cx("aiTag")}>AI{r.kind === "ack" ? " · holding note" : r.kind === "fixed" ? " · fixed note" : ""}</span> : null}
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
