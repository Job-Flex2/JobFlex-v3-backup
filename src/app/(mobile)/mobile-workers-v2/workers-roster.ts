"use server";

// MOBILE WORKERS — the server read.
//
// The handheld surface is mounted PROPS-LESS from two places (its own route at
// /mobile-workers-v2, and responsive-dashboard-shell at ≤768px on the live
// /dashboard/workers), so it cannot be handed a server component's data the way
// the desktop sheet is. It asks for the roster itself, once, on mount — the
// same shape mobile-clients-v2 settled on (see ./client-book.ts's sibling
// rationale in the clients folder).
//
// THE QUERY IS THE DESKTOP PAGE'S, duplicated in shape rather than
// approximated: same organizationId scope, same displayName ordering, same
// SCHEDULED/IN_PROGRESS assignment join, same "role comes from Membership, not
// from WorkerProfile" map, same JSON specialties parse and the same short
// "Mar 2024" joined plate. Both editions therefore describe the same roster,
// and the ids in these rows are the ids the worker actions write against. If
// the desktop query changes, this one changes with it.
//
// Scoped through requireOrg like every neighbouring read: the org id is never
// taken from the client.

import { db } from "@/lib/db";
import { requireRouteAccess } from "@/lib/orgContext";
import type { InviteStatus, WorkerEntry } from "./workers-data";
import { lastActiveLabel, laterOf } from "@/components/v3/workers-blueprint/workers-data";
import { requirePage } from "@/lib/customPageAccess";

/** `WorkerProfile.specialties` is a JSON string column. */
function parseSpec(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** The roster's `joined` column is a short "Mar 2024" plate, not a full date. */
function joinedLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

/**
 * The org's whole crew, A–Z by display name.
 *
 * Unpaged on purpose: the handheld surface pages and searches in the browser,
 * the same six-at-a-time slice the layout was designed around, and a
 * contractor's crew is a roster rather than a table of millions.
 */
export async function loadRoster(): Promise<WorkerEntry[]> {
  const { organizationId } = await requireRouteAccess("/dashboard/workers");
  await requirePage(organizationId, "workers");

  const workers = await db.workerProfile.findMany({
    where: { organizationId },
    orderBy: { displayName: "asc" },
    include: {
      user: { select: { email: true } },
      assignments: {
        where: { job: { status: { in: ["SCHEDULED", "IN_PROGRESS"] } } },
        select: { job: { select: { id: true, title: true } } },
      },
    },
  });

  // Membership carries the role (INSTALLER/SALES/ESTIMATOR/MANAGER/…); map it in
  // by user so the roster shows each member's role.
  const memberships = await db.membership.findMany({
    where: { organizationId },
    select: { userId: true, role: true },
  });
  const roleByUser = new Map(memberships.map((m) => [m.userId, m.role]));

  // LAST ACTIVE (2026-09-24) — the desktop page's read, duplicated in shape:
  // the newest ActivityEvent per member, against the portal's lastSeenAt.
  const lastEventByUser = new Map<string, Date>();
  try {
    const rows = await db.activityEvent.groupBy({
      by: ["actorId"],
      where: { organizationId, actorId: { not: null } },
      _max: { createdAt: true },
    });
    for (const r of rows) if (r.actorId && r._max.createdAt) lastEventByUser.set(r.actorId, r._max.createdAt);
  } catch {
    /* no trail, no plate */
  }

  return workers.map((w) => ({
    id: w.id,
    name: w.displayName,
    email: w.user?.email ?? null,
    phone: w.phone,
    specialties: parseSpec(w.specialties),
    rate: w.hourlyRate,
    token: w.token,
    invite: w.inviteStatus as InviteStatus,
    role: roleByUser.get(w.userId) ?? "INSTALLER",
    joined: joinedLabel(w.createdAt),
    lastActive: lastActiveLabel(laterOf(w.lastSeenAt, lastEventByUser.get(w.userId))),
    jobs: w.assignments.map((a) => ({ id: a.job.id, title: a.job.title })),
  }));
}
