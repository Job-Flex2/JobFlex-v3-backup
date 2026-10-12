// Admin · Support — Blueprint edition.
//
// The triage queue for every ticket any org has filed. The admin layout mounts
// the blueprint shell; this page renders only the `.content` children through
// components/v3/admin-support.
//
// It was classic Tailwind cards inside the blueprint chrome — a mismatch that
// predated the shell. Same data, same reads, same mark-as-read: only the
// presentation and the filters are new.

import type { Metadata } from "next";
import { requirePlatformAdmin } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { supportTicketRef } from "@/lib/notify";
import {
  AdminSupportContent,
  type SupportTicketDTO,
} from "@/components/v3/admin-support/admin-support-content";
import { tasksForTicketsSafe } from "@/lib/adminTasks/service";
import { MarkSupportSeen } from "./mark-seen";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "JobFlex Admin · Support",
  description: "Every support ticket raised across the platform, and its status.",
};

export default async function AdminSupportPage({
  searchParams,
}: {
  searchParams: Promise<{ ticket?: string | string[] }>;
}) {
  await requirePlatformAdmin();
  // ?ticket=<id> opens that ticket — the link a task made from it carries.
  const sp = await searchParams;
  const openTicketId = typeof sp.ticket === "string" ? sp.ticket : null;

  const [rows, open, inProgress, resolved, closed, unread] = await Promise.all([
    db.supportTicket.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        organization: { select: { name: true } },
        user: { select: { email: true } },
      },
    }),
    db.supportTicket.count({ where: { status: "OPEN" } }),
    db.supportTicket.count({ where: { status: "IN_PROGRESS" } }),
    db.supportTicket.count({ where: { status: "RESOLVED" } }),
    db.supportTicket.count({ where: { status: "CLOSED" } }),
    db.supportTicket.count({ where: { adminReadAt: null } }),
  ]);

  // The task made from each ticket, if any (/admin/tasks, "Create task").
  // Without the task tables the tickets show as before and "Create task" hides.
  const { available: tasksAvailable, tasks } = await tasksForTicketsSafe(rows.map((t) => t.id));

  const tickets: SupportTicketDTO[] = rows.map((t) => ({
    id: t.id,
    ref: supportTicketRef(t.id),
    subject: t.subject,
    body: t.body,
    category: t.category,
    priority: t.priority,
    status: t.status,
    orgName: t.organization.name,
    submitterEmail: t.user?.email ?? null,
    createdAt: t.createdAt.toISOString(),
    unread: t.adminReadAt === null,
    task: tasks[t.id] ?? null,
  }));

  return (
    <>
      {/* Opening the inbox is "seeing" the queue — clears the unread badge. */}
      <MarkSupportSeen hasUnread={unread > 0} />

      <AdminSupportContent
        tickets={tickets}
        counts={{ open, inProgress, resolved, closed }}
        initialTicketId={openTicketId}
        tasksAvailable={tasksAvailable}
        // One clock, read on the server, so every age renders identically here
        // and after hydration.
        now={new Date().toISOString()}
      />
    </>
  );
}
