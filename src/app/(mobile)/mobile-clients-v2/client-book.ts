"use server";

// MOBILE CLIENTS — the server read.
//
// The handheld surface is mounted PROPS-LESS from two places (its own route at
// /mobile-clients-v2, and responsive-dashboard-shell at ≤768px on the live
// /dashboard/clients), so it cannot be handed a server component's data the way
// the desktop sheet is. It asks for the book itself, once, on mount.
//
// THE QUERY IS THE DESKTOP PAGE'S, deliberately duplicated in shape rather than
// approximated: same `deletedAt: null` filter, same proposal join, same
// pipeline formula, same "VIP is an org Tag, not a column" rule, same
// updatedAt-desc ordering. Both editions therefore describe the same book, and
// the ids in these rows are the ids proposals, jobs and the record page
// reference. If the desktop formula changes, this one changes with it.
//
// Scoped through requireOrg like every neighbouring read: a signed-in user with
// no membership has no book to show, and the org id is never taken from the
// client.

import { db } from "@/lib/db";
import { requireRouteAccess } from "@/lib/orgContext";
import type { Client } from "./clients-data";

/** Proposal states that are no longer in play. Same list the desktop page and
 *  the classic record page use to compute open pipeline. */
const CLOSED = ["DECLINED", "EXPIRED", "ARCHIVED"];

/** The row's short plate — "Jul 22", matching the desktop Updated column. */
function updatedLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "2-digit" });
}

/**
 * The org's whole client book, newest movement first.
 *
 * Unpaged on purpose: the handheld surface pages and searches in the browser,
 * the same eight-at-a-time slice the layout was designed around, and a
 * contractor's book is hundreds of rows rather than millions. Paging it at the
 * server would cost a round trip per page turn and break the search box, which
 * looks across the whole book and not across the visible page.
 */
export async function loadClientBook(): Promise<Client[]> {
  // Every client with its pipeline money: for whoever may open Clients.
  const { organizationId } = await requireRouteAccess("/dashboard/clients");

  const rows = await db.client.findMany({
    where: { organizationId, deletedAt: null },
    include: {
      proposals: { select: { total: true, status: true } },
      tags: { include: { tag: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    email: c.email,
    address: [c.city, c.state].filter(Boolean).join(", ") || c.address || "",
    proposalCount: c.proposals.length,
    pipelineValue: c.proposals
      .filter((p) => !CLOSED.includes(p.status))
      .reduce((a, p) => a + p.total, 0),
    // VIP is an org-scoped Tag (see createClient), not a column. It draws as its
    // own plate beside the name, so it is kept out of the tag list.
    vip: c.tags.some((t) => t.tag.label === "VIP"),
    tags: c.tags.filter((t) => t.tag.label !== "VIP").map((t) => t.tag.label),
    updated: updatedLabel(c.updatedAt),
    phone: c.phone,
    line1: c.address,
    city: c.city,
    state: c.state,
    zip: c.zip,
    notes: c.notes,
  }));
}
