"use server";

// MOBILE JOBS — the server read.
//
// The handheld surface is mounted PROPS-LESS from two places (its own route at
// /mobile-jobs-v2, and responsive-dashboard-shell at ≤768px on the live
// /dashboard/jobs), so it cannot be handed a server component's data the way
// the desktop sheet is. It asks for the board itself, on mount and again after
// every write — exactly the arrangement mobile-clients-v2/client-book.ts
// established.
//
// THE QUERY IS THE DESKTOP PAGE'S (src/app/dashboard/jobs/page.tsx),
// deliberately duplicated in shape rather than approximated: same field-worker
// scoping, same `createdAt: desc` ordering, same client/assignment joins, same
// two option lists. The proposal list is the classic /dashboard/jobs/new page's
// query, because the create sheet replaces that form on this surface. If the
// desktop board changes, this changes with it.
//
// Scoped through requireOrg like every neighbouring read: a signed-in user with
// no membership has no board to show, and the org id is never taken from the
// client.

import { db } from "@/lib/db";
import { requireRouteAccess, isWorkerRole, isOwnerOrManager } from "@/lib/orgContext";
import {
  siteOf,
  toDay,
  type Job,
  type JobClientOption,
  type JobCrewOption,
  type JobProposalOption,
  type JobsBoard,
  type JobStatus,
  type MyAssignmentStatus,
} from "./jobs-data";

/**
 * The org's whole delivery board, newest job first, plus the option lists the
 * create sheet and the crew sheet pick from.
 *
 * Unpaged on purpose: the handheld surface pages and searches in the browser,
 * the same eight-at-a-time slice the layout was designed around. Paging it at
 * the server would cost a round trip per page turn and break the search box,
 * which looks across the whole board rather than the visible page.
 */
export async function loadJobsBoard(): Promise<JobsBoard> {
  const { organizationId, role, user } = await requireRouteAccess("/dashboard/jobs");

  const isWorker = isWorkerRole(role);
  const canManage = isOwnerOrManager(role);

  // A field worker only sees jobs they're assigned to. Resolve their profile id
  // and scope the query; a missing profile collapses to "no jobs" (never the
  // whole org).
  let workerId: string | null = null;
  if (isWorker) {
    const wp = await db.workerProfile.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    workerId = wp?.id ?? null;
  }

  const [jobs, clientRows, workerRows, proposalRows] = await Promise.all([
    db.job.findMany({
      where: isWorker
        ? { organizationId, assignments: { some: { workerId: workerId ?? "__none__" } } }
        : { organizationId },
      orderBy: { createdAt: "desc" },
      include: {
        client: {
          select: { id: true, name: true, address: true, city: true, state: true },
        },
        proposal: { select: { title: true } },
        assignments: {
          include: { worker: { select: { id: true, displayName: true } } },
        },
      },
    }),
    db.client.findMany({
      where: { organizationId, deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    // Installers are auto-assigned to their own jobs server-side and can't staff
    // anyone else, so they get no crew list at all.
    isWorker
      ? Promise.resolve([] as { id: string; displayName: string }[])
      : db.workerProfile.findMany({
          where: { organizationId },
          orderBy: { displayName: "asc" },
          select: { id: true, displayName: true },
        }),
    // The classic new-job form's list: proposals still in play, most recently
    // touched first, capped at 40 — a picker, not an archive.
    db.proposal.findMany({
      where: { organizationId, status: { in: ["ACCEPTED", "SENT", "VIEWED"] } },
      orderBy: { updatedAt: "desc" },
      take: 40,
      select: { id: true, title: true, clientId: true },
    }),
  ]);

  const rows: Job[] = jobs.map((j) => ({
    id: j.id,
    title: j.title,
    client: j.client?.name ?? null,
    clientId: j.clientId ?? null,
    status: j.status as JobStatus,
    start: toDay(j.startsAt),
    end: toDay(j.endsAt),
    crew: j.assignments.map((a) => a.worker.displayName),
    assignments: j.assignments.map((a) => ({
      id: a.id,
      workerId: a.workerId,
      name: a.worker.displayName,
    })),
    // Where the crew is going. The client's address is the real answer; the
    // title's tail is the fallback for a job with no client on file.
    site:
      [j.client?.address, j.client?.city, j.client?.state].filter(Boolean).join(", ") ||
      siteOf(j.title),
    proposal: j.proposal?.title ?? null,
    // The offer state (2026-08-21). Same include, no extra query — the
    // assignment rows already carry `status`. A crew member's row headlines
    // THEIR answer; an office row hints while anyone assigned hasn't answered.
    myAssignment: isWorker
      ? ((j.assignments.find((a) => a.workerId === workerId)?.status as
          | MyAssignmentStatus
          | undefined) ?? null)
      : null,
    pendingCrew: isWorker ? 0 : j.assignments.filter((a) => a.status === "PENDING").length,
  }));

  const clients: JobClientOption[] = clientRows.map((c) => ({ id: c.id, name: c.name }));
  const crew: JobCrewOption[] = workerRows.map((w) => ({ id: w.id, name: w.displayName }));
  const proposals: JobProposalOption[] = proposalRows.map((p) => ({
    id: p.id,
    title: p.title,
    clientId: p.clientId ?? null,
  }));

  return { jobs: rows, clients, crew, proposals, canManage, isWorker };
}
