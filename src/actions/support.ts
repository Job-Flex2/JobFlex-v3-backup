"use server";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { requireOrg, requirePlatformAdmin } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { notifySupportTicket, supportTicketRef } from "@/lib/notify";
import { rateLimitShared, retryInWords } from "@/lib/rateLimit";
import { answerTicketWithAi } from "@/lib/support/aiSupport";
import { alertSupportTicket } from "@/lib/adminAlerts";

// Support taxonomy — kept in lockstep with the customer form's chips, the
// corner Help widget's categories and the admin triage tags. Not exported: a
// "use server" module may only export async functions, and these are used
// internally by the validators below.
const SUPPORT_CATEGORIES = ["billing", "technical", "account", "feature", "general"] as const;
const SUPPORT_PRIORITIES = ["low", "normal", "high"] as const;

const ticketInput = z.object({
  // Optional since the Help widget landed: that composer is one message field
  // and one button, deliberately — a subject line is a form asking the user to
  // summarise their own problem before they have described it. When it is
  // absent the subject is taken from the message's own first line (below), so
  // the column stays a real, human-written summary rather than a placeholder.
  subject: z.string().max(200).optional(),
  // Trimmed BEFORE the length check: a body of spaces satisfied `min(1)`, and
  // the derived subject below then came out empty — a blank row in the admin
  // queue that no filter or search could reach.
  body: z.string().trim().min(1, "Describe the issue").max(5000),
  category: z.enum(SUPPORT_CATEGORIES).default("general"),
  priority: z.enum(SUPPORT_PRIORITIES).default("normal"),
});

/** The message's first line, clipped to a subject-sized string. The user's own
 *  words — nothing is generated. Falls back to the whole message when it is a
 *  single unbroken paragraph. */
function subjectFromBody(body: string): string {
  const firstLine = body.split(/\r?\n/).find((l) => l.trim().length > 0)?.trim() ?? body.trim();
  if (firstLine.length <= 80) return firstLine;
  const cut = firstLine.slice(0, 80);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export interface SubmitTicketResult {
  id: string;
  /** Short human reference, shown to the submitter and printed on the alert. */
  ref: string;
  /** Whether the operator alert actually went out. False is not a failure of
   *  the submission — the ticket is filed either way — but the caller is told
   *  the truth rather than a blanket success. */
  notified: boolean;
}

/**
 * Raise a support ticket.
 *
 * GUARD: `requireOrg`, not `requireManager` (changed with the Help widget). The
 * widget is mounted for every signed-in user on every surface, crew included,
 * and a field worker who cannot open the app is exactly the person who needs to
 * say so. Manager-only was never a security property here — a ticket is the
 * submitter's own words about their own org, scoped to their own membership;
 * it read no data and wrote nothing a limited role can reach. Viewing the
 * ticket HISTORY at /dashboard/support is still manager-only, and scoped to
 * the viewer's own tickets.
 *
 * RATE LIMIT: widening the guard to every org member also widened who can make
 * this write a row and send mail, and the composer is two taps from every
 * screen in the app. Five in ten minutes per user — far above anyone with a
 * real problem to report, far below a stuck retry loop. Counted BEFORE the
 * validator so a malformed body cannot be replayed for free.
 */
const TICKETS_PER_WINDOW = 5;
const TICKET_WINDOW_MS = 10 * 60 * 1000;

export async function submitSupportTicket(raw: unknown): Promise<SubmitTicketResult> {
  const { organizationId, user } = await requireOrg();

  const gate = await rateLimitShared(`support:${user.id}`, TICKETS_PER_WINDOW, TICKET_WINDOW_MS);
  if (!gate.ok) {
    throw new Error(
      `That is several tickets in a row. Try again in ${retryInWords(gate.retryAfterMs)}.`,
    );
  }

  const data = ticketInput.parse(raw);
  const subject = data.subject?.trim() || subjectFromBody(data.body);

  const ticket = await db.supportTicket.create({
    data: {
      organizationId,
      userId: user.id,
      subject,
      body: data.body,
      category: data.category,
      priority: data.priority,
      status: "OPEN",
    },
  });

  // Heads-up to the operator. Best-effort by contract — notifySupportTicket
  // never throws, so a dead transport cannot fail a submission that is already
  // in the database — but it no longer fails SILENTLY either: it logs, and it
  // reports back so this return can say what actually happened.
  const [org, submitter] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId }, select: { name: true } }),
    db.user.findUnique({ where: { id: user.id }, select: { email: true } }),
  ]);
  const ref = supportTicketRef(ticket.id);
  const alert = await notifySupportTicket({
    ticketId: ticket.id,
    ref,
    subject,
    body: data.body,
    category: data.category,
    priority: data.priority,
    orgName: org?.name ?? "A customer",
    submitterEmail: submitter?.email ?? null,
  });
  // The team's "Support" alert texts (lib/adminAlerts) — best-effort like the email.
  await alertSupportTicket({ orgName: org?.name ?? "A customer", subject, ref });

  // The support AI reads it and answers (owner, 2026-10-15) — after the
  // response, so "Send" never waits on a model. What it may send on its own,
  // and the copy every outcome sends to the support inbox: lib/support.
  after(() =>
    answerTicketWithAi(ticket.id, { trigger: "new" }).then(
      () => undefined,
      (err) => console.error(`[support-ai] ticket ${ref} was not answered:`, err instanceof Error ? err.message : err),
    ),
  );

  revalidatePath("/dashboard/support");
  revalidatePath("/admin/support");
  revalidatePath("/admin");
  return { id: ticket.id, ref, notified: alert.sent };
}

// ── Admin notification feed (platform-admin only) ─────────────────────────────
//
// `recentSupportTickets` used to live here — a cross-org feed of every ticket's
// subject, org and submitter. Its one consumer (the admin header bell's inline
// list) was replaced by the /admin/support queue, and every export of a
// "use server" module is a live POST endpoint whether or not any component
// imports it. An unused one is an endpoint nobody is reading the guard on, so
// it is gone rather than kept warm. The queue's own page loader is the feed.

/** Count of tickets the admin hasn't seen yet — drives the nav + bell badges. */
export async function unreadSupportCount(): Promise<number> {
  await requirePlatformAdmin();
  return db.supportTicket.count({ where: { adminReadAt: null } });
}

/** Mark every unread ticket as seen. Called when the admin opens the inbox or
 *  clears the bell. Idempotent — a no-op once nothing is unread. */
export async function markSupportTicketsRead(): Promise<void> {
  await requirePlatformAdmin();
  await db.supportTicket.updateMany({
    where: { adminReadAt: null },
    data: { adminReadAt: new Date() },
  });
  revalidatePath("/admin/support");
  revalidatePath("/admin");
}
