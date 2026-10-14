"use client";
import * as React from "react";
import { Check, Inbox } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";
import { relative } from "@/lib/format";

export interface SupportTicketView {
  id: string;
  subject: string;
  body: string;
  category: string;
  priority: string;
  status: string;
  createdAt: Date;
  /** Our answers, oldest first (2026-10-14) — the same words that went by email. */
  replies: Array<{ id: string; at: string; body: string }>;
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

function currentStep(status: string): number {
  if (status === "IN_PROGRESS") return 1;
  if (status === "RESOLVED" || status === "CLOSED") return 2;
  return 0;
}

export function SupportTickets({ tickets }: { tickets: SupportTicketView[] }) {
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
        <TicketCard key={t.id} ticket={t} />
      ))}
    </div>
  );
}

function TicketCard({ ticket }: { ticket: SupportTicketView }) {
  const [open, setOpen] = React.useState(false);
  const step = currentStep(ticket.status);
  const closed = ticket.status === "CLOSED";
  // A terminal ticket (RESOLVED or CLOSED) has finished the journey — its final
  // node should read "done", not "current".
  const complete = ticket.status === "RESOLVED" || closed;

  return (
    <div className="paper-card p-0 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-black/[0.015] focus-ring"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-medium text-[color:var(--ink)] truncate">
              {ticket.subject}
            </span>
            {ticket.priority === "high" && (
              <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.04em] text-rose-700">
                Urgent
              </span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-[color:var(--ink-muted)]">
            <span className="rounded-full bg-[color:var(--paper-deep)] px-2 py-0.5 font-medium text-[color:var(--ink-soft)]">
              {CATEGORY_LABEL[ticket.category] ?? "General"}
            </span>
            <span className="tabular">{relative(ticket.createdAt)}</span>
            {ticket.replies.length ? (
              <span className="rounded-full bg-[color:var(--accent-soft)] px-2 py-0.5 font-medium text-[color:var(--accent-ink)]" data-support-answered>
                {ticket.replies.length === 1 ? "Answered" : `${ticket.replies.length} answers`}
              </span>
            ) : null}
          </div>
        </div>
        <Badge tone={STATUS_TONE[ticket.status] ?? "neutral"}>
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
        <div className="border-t border-[color:var(--ink-line)] px-5 py-4">
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[color:var(--ink-soft)]">
            {ticket.body}
          </p>
          {ticket.replies.map((r) => (
            <div key={r.id} className="mt-3 rounded-md border-l-2 border-[color:var(--accent)] bg-[color:var(--accent-soft)] px-3 py-2.5" data-support-reply-card>
              <div className="text-[11px] font-medium text-[color:var(--accent-ink)]">JobFlex support · {relative(new Date(r.at))}</div>
              <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-[color:var(--ink)]">{r.body}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
