// Support — Blueprint edition (2026-10-17). Moved out of the classic
// (dashboard) tree, whose WORK / DELIVERY / MONEY sidebar it wore, into the
// blueprint shell mounted by ../layout.tsx: the sidebar with the coloured
// estimators, the topbar, the support widget. Same URL; the classic page and
// its form / FAQ / ticket cards are gone.
//
// THE READ is the old page's, unchanged: every role (owner, 2026-10-17 —
// installers, sales and estimators too; the route gate is lib/roleRoutes and
// the layout enforces it), and only the viewer's OWN tickets, newest message
// first, each with its whole conversation (lib/supportThread). The writes are
// the existing actions (@/actions/support). Both editions — the desk above
// 768px and the handheld build at or below — get this one object through
// ./support-responsive. ?ticket=<id> (the letters' "Open conversation", the
// Help window's link) opens that ticket.

import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { NoOrgError, UnauthorizedError, requireOrg } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { customerLabel, threadsFor } from "@/lib/supportThread";
import { openingMessage } from "@/lib/supportReply";
import { supportTicketRef } from "@/lib/notify";
import type { SupportTicketView } from "@/components/v3/support-blueprint/support-workspace";
import { SupportResponsive } from "./support-responsive";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "JobFlex · Support",
  description: "Support — your tickets with the JobFlex team, each one a conversation.",
};

export default async function SupportPage({
  searchParams,
}: {
  searchParams: Promise<{ ticket?: string | string[] }>;
}) {
  let ctx;
  try {
    ctx = await requireOrg();
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login?next=%2Fdashboard%2Fsupport");
    if (err instanceof NoOrgError) redirect("/dashboard?error=forbidden");
    throw err;
  }
  const { organizationId, user } = ctx;
  const sp = await searchParams;
  const openTicketId = typeof sp.ticket === "string" ? sp.ticket : null;

  // The viewer's OWN tickets only. A ticket is addressed to the JobFlex
  // platform, not to the contractor: an installer writing about their employer
  // must not be read verbatim by that employer from here.
  const tickets = await db.supportTicket.findMany({
    where: { organizationId, userId: user.id },
    orderBy: { lastMessageAt: "desc" },
    take: 50,
    select: { id: true, subject: true, body: true, category: true, priority: true, status: true, createdAt: true, lastMessageAt: true },
  });
  const [threads, me] = await Promise.all([
    threadsFor(tickets.map((t) => t.id)),
    db.user.findUnique({ where: { id: user.id }, select: { name: true, email: true } }),
  ]);
  const by = customerLabel({ user: me });

  const view: SupportTicketView[] = tickets.map((t) => ({
    id: t.id,
    ref: supportTicketRef(t.id),
    subject: t.subject,
    category: t.category,
    priority: t.priority,
    status: t.status,
    createdAt: t.createdAt.toISOString(),
    lastMessageAt: t.lastMessageAt.toISOString(),
    messages: [openingMessage({ id: t.id, body: t.body, createdAt: t.createdAt.toISOString(), by }), ...(threads[t.id] ?? [])],
  }));

  return <SupportResponsive tickets={view} openId={openTicketId} />;
}
