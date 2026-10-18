"use client";
import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { Check, Inbox, Mail, Send } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { cn } from "@/lib/cn";
import { relative } from "@/lib/format";
import { postSupportReply, supportConversation } from "@/actions/support";
import { REPLY_LIMITS, type ThreadMessage } from "@/lib/supportReply";
import { answerParts } from "@/lib/support/aiState";

// YOUR CONVERSATIONS (owner, 2026-10-17: one dialog per ticket). A ticket
// opens as a chat — every message in order (yours on the right; ours and the
// AI's, signed JobFlex support, on the left), the box at the bottom. While it
// is open it asks for news every 5 s, so our answer appears without a reload.
// Writing in a resolved or closed ticket opens it again. ?ticket=<id> (the
// "Open conversation" button in every letter) opens that one on arrival.

export interface SupportTicketView {
  id: string;
  subject: string;
  body: string;
  category: string;
  priority: string;
  status: string;
  createdAt: Date;
  /** ISO — the conversation's latest message; the poll's "anything new?" stamp. */
  lastMessageAt: string;
  /** The ticket's own words first, then every message, oldest first. */
  messages: ThreadMessage[];
}

const CATEGORY_LABEL: Record<string, string> = {
  billing: "Billing",
  technical: "Technical",
  account: "Account",
  feature: "Feature idea",
  general: "General",
};

const STATUS_TONE: Record<string, "accent" | "warn" | "success" | "neutral"> = {
  OPEN: "accent",
  IN_PROGRESS: "warn",
  RESOLVED: "success",
  CLOSED: "neutral",
};

// The journey every ticket walks. CLOSED collapses onto the final node, relabeled.
const STEPS = ["OPEN", "IN_PROGRESS", "RESOLVED"] as const;
const STEP_LABEL: Record<string, string> = {
  OPEN: "Received",
  IN_PROGRESS: "In progress",
  RESOLVED: "Resolved",
};

/** How often an open conversation asks for news. */
const LIVE_MS = 5_000;

function currentStep(status: string): number {
  if (status === "IN_PROGRESS") return 1;
  if (status === "RESOLVED" || status === "CLOSED") return 2;
  return 0;
}

export function SupportTickets({ tickets, openId = null }: { tickets: SupportTicketView[]; openId?: string | null }) {
  if (tickets.length === 0) {
    return (
      <div className="paper-card px-6 py-14 text-center">
        <span className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-full bg-[color:var(--paper-deep)]">
          <Inbox className="h-5 w-5 text-[color:var(--ink-faint)]" />
        </span>
        <div className="font-display text-[16px] text-[color:var(--ink)]">No messages yet</div>
        <p className="mx-auto mt-1 max-w-sm text-[12.5px] text-[color:var(--ink-muted)]">
          When you send us a message it&apos;ll appear here, with its status tracked from received to resolved.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {tickets.map((t) => (
        <TicketCard key={t.id} ticket={t} startOpen={t.id === openId} />
      ))}
    </div>
  );
}

function TicketCard({ ticket, startOpen }: { ticket: SupportTicketView; startOpen: boolean }) {
  const [open, setOpen] = React.useState(startOpen);
  const [status, setStatus] = React.useState(ticket.status);
  const [messages, setMessages] = React.useState<ThreadMessage[]>(ticket.messages);
  const [lastAt, setLastAt] = React.useState(ticket.lastMessageAt);
  const cardRef = React.useRef<HTMLDivElement>(null);

  // A letter's "Open conversation" lands here: bring the ticket into view once.
  React.useEffect(() => {
    if (startOpen) cardRef.current?.scrollIntoView({ block: "start" });
  }, [startOpen]);

  // THE LIVE CONVERSATION — only while open and the tab is visible; one cheap read ("changed since?").
  const live = React.useRef({ lastAt, status });
  React.useEffect(() => {
    live.current = { lastAt, status };
  }, [lastAt, status]);
  React.useEffect(() => {
    if (!open) return;
    let busy = false;
    const tick = async () => {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      try {
        const r = await supportConversation(ticket.id, live.current.lastAt, live.current.status);
        if (r && "messages" in r) {
          setMessages(r.messages);
          setLastAt(r.lastMessageAt);
          setStatus(r.status);
        }
      } catch {
        /* offline: the next tick retries */
      } finally {
        busy = false;
      }
    };
    const id = window.setInterval(() => void tick(), LIVE_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [open, ticket.id]);

  const step = currentStep(status);
  const closed = status === "CLOSED";
  // A terminal ticket (RESOLVED or CLOSED) has finished the journey — its final
  // node should read "done", not "current".
  const complete = status === "RESOLVED" || closed;
  const ours = messages.filter((m) => m.from !== "customer").length;
  const last = messages[messages.length - 1];
  const answerWaiting = !open && last && last.from !== "customer";

  return (
    <div ref={cardRef} className="paper-card p-0 overflow-hidden scroll-mt-4" data-support-ticket={ticket.id}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-[44px] w-full items-start justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-black/[0.015] focus-ring"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 text-[14px] font-medium text-[color:var(--ink)] [overflow-wrap:anywhere]">
              {ticket.subject}
            </span>
            {ticket.priority === "high" && (
              <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.04em] text-rose-700">
                Urgent
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[color:var(--ink-muted)]">
            <span className="rounded-full bg-[color:var(--paper-deep)] px-2 py-0.5 font-medium text-[color:var(--ink-soft)]">
              {CATEGORY_LABEL[ticket.category] ?? "General"}
            </span>
            <span className="tabular">{relative(new Date(lastAt))}</span>
            {ours ? (
              <span className="rounded-full bg-[color:var(--accent-soft)] px-2 py-0.5 font-medium text-[color:var(--accent-ink)]" data-support-answered>
                {answerWaiting ? "New answer" : ours === 1 ? "Answered" : `${ours} answers`}
              </span>
            ) : null}
          </div>
        </div>
        <Badge tone={STATUS_TONE[status] ?? "neutral"}>
          {closed ? "Closed" : STEP_LABEL[STEPS[step]]}
        </Badge>
      </button>

      {/* Status journey — sage marks how far the ticket has travelled. */}
      <div className="px-5 pb-4">
        <ol className="flex items-center">
          {STEPS.map((s, i) => {
            const done = i < step || (complete && i <= step);
            const current = i === step && !complete;
            const label = closed && i === 2 ? "Closed" : STEP_LABEL[s];
            return (
              <React.Fragment key={s}>
                <li className="flex flex-col items-center gap-1.5">
                  <span
                    className={cn(
                      "grid h-6 w-6 place-items-center rounded-full text-[10px] font-semibold transition-colors",
                      done && "bg-[color:var(--accent)] text-white",
                      current && "bg-[color:var(--accent-soft)] text-[color:var(--accent-ink)] shadow-[inset_0_0_0_1.5px_var(--accent)]",
                      !done && !current && "bg-[color:var(--paper-deep)] text-[color:var(--ink-faint)]",
                    )}
                  >
                    {done ? <Check className="h-3 w-3" strokeWidth={3} /> : i + 1}
                  </span>
                  <span
                    className={cn(
                      "text-[10px] tracking-[0.01em] whitespace-nowrap",
                      done || current ? "text-[color:var(--ink-soft)] font-medium" : "text-[color:var(--ink-faint)]",
                    )}
                  >
                    {label}
                  </span>
                </li>
                {i < STEPS.length - 1 && (
                  <span
                    className={cn(
                      "mx-1.5 mb-5 h-px flex-1 transition-colors",
                      i < step ? "bg-[color:var(--accent)]" : "bg-[color:var(--ink-line)]",
                    )}
                  />
                )}
              </React.Fragment>
            );
          })}
        </ol>
      </div>

      {open && (
        <Conversation
          ticketId={ticket.id}
          status={status}
          messages={messages}
          onPosted={(c) => {
            setMessages(c.messages);
            setLastAt(c.lastMessageAt);
            setStatus(c.status);
          }}
        />
      )}
    </div>
  );
}

function Conversation({
  ticketId,
  status,
  messages,
  onPosted,
}: {
  ticketId: string;
  status: string;
  messages: ThreadMessage[];
  onPosted: (c: { messages: ThreadMessage[]; lastMessageAt: string; status: string }) => void;
}) {
  const [draft, setDraft] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const endRef = React.useRef<HTMLDivElement>(null);
  const reopens = status === "RESOLVED" || status === "CLOSED";

  // A new message brings the bottom of the conversation into view.
  const count = messages.length;
  const seen = React.useRef(count);
  React.useEffect(() => {
    if (count > seen.current) endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    seen.current = count;
  }, [count]);

  async function send() {
    const body = draft.trim();
    if (sending || body.length < REPLY_LIMITS.min) return;
    setSending(true);
    setError(null);
    try {
      const r = await postSupportReply(ticketId, body);
      if (r.ok) {
        setDraft("");
        onPosted(r.conversation);
      } else setError(r.error);
    } catch {
      setError("Your message didn't go. Check the connection and try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="border-t border-[color:var(--ink-line)] px-5 py-4" data-support-conversation>
      <div className="flex flex-col gap-3" role="log" aria-label="Conversation" aria-live="polite">
        {messages.map((m) => (
          <Bubble key={m.id} m={m} />
        ))}
        <div ref={endRef} />
      </div>

      <div className="mt-4">
        <Textarea
          label="Reply"
          rows={3}
          value={draft}
          maxLength={REPLY_LIMITS.body}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={reopens ? "Write here and the ticket opens again." : "Write your reply…"}
          disabled={sending}
          data-support-reply-text
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <span className="text-[12px] text-[color:var(--ink-muted)]">
            {reopens ? "This ticket is closed — your reply opens it again." : "We get it at once, and reply here and by email."}
          </span>
          <Button size="lg" icon={<Send className="h-4 w-4" />} loading={sending} disabled={sending || draft.trim().length < REPLY_LIMITS.min} onClick={send} data-support-send>
            Send
          </Button>
        </div>
        {error ? (
          <p className="mt-2 text-[12.5px] text-[color:var(--rose)]" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** One message: yours on the right; ours and the AI's (signed JobFlex support) on the left. */
function Bubble({ m }: { m: ThreadMessage }) {
  const mine = m.from === "customer";
  return (
    <div
      className={cn(
        "max-w-[88%] min-w-0 rounded-[var(--r-sm)] px-3 py-2.5",
        mine
          ? "self-end border-[1.5px] border-[color:var(--ink-line)] bg-[color:var(--paper-deep)]"
          : "self-start border-l-2 border-[color:var(--accent)] bg-[color:var(--accent-soft)]",
      )}
      data-support-message={m.from}
      data-support-reply-card={mine ? undefined : ""}
    >
      <div className={cn("flex flex-wrap items-center gap-1.5 text-[11px] font-medium", mine ? "text-[color:var(--ink-muted)]" : "text-[color:var(--accent-ink)]")}>
        <span>{mine ? "You" : "JobFlex support"}</span>
        <span aria-hidden="true">·</span>
        <time dateTime={m.at} className="tabular">{relative(new Date(m.at))}</time>
        {m.channel === "email" ? (
          <span className="inline-flex items-center gap-1">
            <Mail className="h-3 w-3" aria-hidden="true" /> by email
          </span>
        ) : null}
      </div>
      {mine ? (
        <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-[color:var(--ink)] [overflow-wrap:anywhere]">{m.body}</p>
      ) : (
        // Our answers: paragraphs, JobFlex's own links clickable (answerParts, the Help window's rule).
        <div className="mt-1 space-y-2 text-[13px] leading-relaxed text-[color:var(--ink)] [overflow-wrap:anywhere]">
          {answerParts(m.body).map((para, i) => (
            <p key={i}>
              {para.map((piece, j) =>
                "br" in piece ? (
                  <br key={j} />
                ) : "path" in piece ? (
                  <Link key={j} href={piece.path as Route} className="underline underline-offset-2 text-[color:var(--accent-ink)]">
                    {piece.label}
                  </Link>
                ) : (
                  <React.Fragment key={j}>{piece.text}</React.Fragment>
                ),
              )}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
