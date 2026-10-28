// ADMIN · USER ACTIVITY — /admin/activity
//
// What each member of every workspace did — proposals created and sent,
// estimates made, and the rest of what the activity trail records — counted
// per user over a range, with the trail itself underneath and any proposal in
// it open to read. Read-only: nothing here writes; the page queries Prisma
// directly, the way /admin/referrals does (owner's ask 2026-09-18).
//
// Two sources, on purpose. The trail (ActivityEvent) is what a USER did — only
// rows with an actor count; a client opening or accepting a proposal has no
// actor and is an OUTCOME, read off the proposal's own dates. Estimates are
// not in the trail at all (only their conversion to a proposal is), so the
// roof measurements and HVAC estimates are read from their own tables and
// woven into the feed as "Measured a roof" / "Sized an HVAC system".
//
// A search (?q=, 2026-10-19 — owner: "search any client by his company name or email and look what he's doing")
// narrows the whole page to the members it finds — by name, email or company, active in the range or not — and
// weaves the screens they opened (the trial watch's page views) into their trail. Above it all, who is working in
// the app right now, refreshed every half minute.

import { requirePlatformAdmin } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { findMembers, readWorkingNow, screenRuns } from "@/lib/adminActivityRead";
import { readActivityInsights } from "@/lib/activityInsightsRead";
import { TEAM_TZ } from "@/lib/adminTasks/teamShared";
import {
  AdminActivityContent,
  type ActivityEventDTO,
  type ActivityRange,
  type ActivityUserRow,
  type ProposalPeek,
} from "@/components/v3/admin-activity/activity-content";

const RANGES: Record<ActivityRange, number | null> = { "7": 7, "30": 30, "90": 90, all: null };
/** The start of the range, read off the clock at request time (null = all time). */
function sinceFor(range: ActivityRange): Date | null {
  const days = RANGES[range];
  return days ? new Date(Date.now() - days * 86_400_000) : null;
}
/** The trail is read newest-first up to this many rows; the counts above it cover the whole range. */
const FEED_LIMIT = 500;
const ESTIMATE_LIMIT = 200;
/** A searched member's screens: this many page views read, newest first. */
const VIEW_LIMIT = 1500;

export default async function AdminActivityPage({ searchParams }: { searchParams: Promise<{ range?: string; q?: string }> }) {
  await requirePlatformAdmin();
  const sp = await searchParams;
  const range: ActivityRange = sp.range && sp.range in RANGES ? (sp.range as ActivityRange) : "30";
  const since = sinceFor(range);
  const inRange = since ? { gte: since } : undefined;
  const at = (field: "createdAt" | "sentAt" | "acceptedAt") =>
    inRange ? { [field]: inRange } : field === "createdAt" ? {} : { [field]: { not: null } };
  // eslint-disable-next-line react-hooks/purity -- one read per request: the clock the trail's "4m ago" and "working now" are drawn from
  const now = Date.now();

  // A search narrows every count and the trail to the members it finds.
  const q = (sp.q ?? "").trim().slice(0, 80);
  // The analyst (2026-10-28): what members do across every workspace, read beside the rest; a search narrows the
  // page to people, so it steps aside then. A failed read leaves the page without it, never without the trail.
  const insightsP = q.length >= 2 ? Promise.resolve(null) : readActivityInsights(since, now, TEAM_TZ).catch(() => null);
  const [found, working] = await Promise.all([q.length >= 2 ? findMembers(q) : Promise.resolve(null), readWorkingNow(now).catch(() => [])]);
  const foundIds = found?.map((u) => u.id) ?? null;
  const who = foundIds ? { in: foundIds } : { not: null };

  // Rows a user is behind. The notification self-test is the one kind that
  // is nobody's work.
  const userEvents = { actorId: who, kind: { not: "TEST" }, ...at("createdAt") };

  const [events, proposalWork, allWork, sentByOwner, acceptedByOwner, roofRows, hvacRows, roofByUser, hvacByUser, views] = await Promise.all([
    db.activityEvent.findMany({
      where: userEvents,
      orderBy: { createdAt: "desc" },
      take: FEED_LIMIT,
      select: {
        id: true,
        kind: true,
        summary: true,
        createdAt: true,
        actorId: true,
        proposalId: true,
        leadId: true,
        clientId: true,
        organization: { select: { id: true, name: true } },
        proposal: {
          select: {
            id: true,
            title: true,
            status: true,
            address: true,
            subtotal: true,
            discountTotal: true,
            taxTotal: true,
            total: true,
            currency: true,
            createdAt: true,
            sentAt: true,
            viewedAt: true,
            viewCount: true,
            acceptedAt: true,
            declinedAt: true,
            paidAt: true,
            client: { select: { name: true } },
            owner: { select: { name: true, email: true } },
            organization: { select: { name: true } },
            lineItems: { select: { name: true, quantity: true, unitPrice: true, total: true }, orderBy: { position: "asc" }, take: 40 },
          },
        },
      },
    }),
    db.activityEvent.groupBy({
      by: ["actorId", "kind"],
      where: { ...userEvents, proposalId: { not: null }, kind: { in: ["CREATED", "SENT", "EDITED"] } },
      _count: { _all: true },
    }),
    db.activityEvent.groupBy({ by: ["actorId"], where: userEvents, _count: { _all: true }, _max: { createdAt: true } }),
    db.proposal.groupBy({ by: ["ownerId"], where: { ownerId: who, ...at("sentAt") }, _count: { _all: true }, _sum: { total: true } }),
    db.proposal.groupBy({ by: ["ownerId"], where: { ownerId: who, ...at("acceptedAt") }, _count: { _all: true }, _sum: { total: true } }),
    db.roofMeasurement.findMany({
      where: { createdById: who, ...at("createdAt") },
      orderBy: { createdAt: "desc" },
      take: ESTIMATE_LIMIT,
      select: { id: true, createdById: true, createdAt: true, address: true, city: true, state: true, squares: true, predominantPitch: true, organizationId: true },
    }),
    db.hvacEstimate.findMany({
      where: { ...(foundIds ? { createdById: { in: foundIds } } : {}), ...at("createdAt") },
      orderBy: { createdAt: "desc" },
      take: ESTIMATE_LIMIT,
      select: { id: true, createdById: true, createdAt: true, address: true, state: true, sizedTons: true, status: true, subtotal: true, proposalId: true, organizationId: true },
    }),
    db.roofMeasurement.groupBy({ by: ["createdById"], where: { createdById: who, ...at("createdAt") }, _count: { _all: true } }),
    db.hvacEstimate.groupBy({ by: ["createdById"], where: { ...(foundIds ? { createdById: { in: foundIds } } : {}), ...at("createdAt") }, _count: { _all: true } }),
    // The screens a searched member opened — what they've been doing in the app, not only what they saved.
    foundIds?.length
      ? db.pageView
          .findMany({ where: { userId: { in: foundIds }, ...(inRange ? { at: inRange } : {}) }, orderBy: { at: "desc" }, take: VIEW_LIMIT, select: { userId: true, organizationId: true, route: true, at: true } })
          .catch(() => [])
      : Promise.resolve([]),
  ]);
  const runs = screenRuns(views);

  // Everyone the range touched, in one sweep — including members whose only
  // work was an estimate, and owners whose proposals were accepted.
  const userIds = new Set<string>();
  for (const e of events) if (e.actorId) userIds.add(e.actorId);
  for (const g of allWork) if (g.actorId) userIds.add(g.actorId);
  for (const g of sentByOwner) if (g.ownerId) userIds.add(g.ownerId);
  for (const g of acceptedByOwner) if (g.ownerId) userIds.add(g.ownerId);
  for (const g of roofByUser) if (g.createdById) userIds.add(g.createdById);
  for (const g of hvacByUser) userIds.add(g.createdById);
  // Everyone a search found, whether or not they did anything in the range.
  for (const id of foundIds ?? []) userIds.add(id);
  const orgIds = new Set<string>();
  for (const r of roofRows) orgIds.add(r.organizationId);
  for (const h of hvacRows) orgIds.add(h.organizationId);
  for (const r of runs) orgIds.add(r.organizationId);

  const [users, orgs] = await Promise.all([
    userIds.size
      ? db.user.findMany({
          where: { id: { in: [...userIds] } },
          select: {
            id: true,
            name: true,
            email: true,
            createdAt: true,
            memberships: { select: { role: true, organization: { select: { id: true, name: true } } }, take: 3 },
          },
        })
      : [],
    orgIds.size ? db.organization.findMany({ where: { id: { in: [...orgIds] } }, select: { id: true, name: true } }) : [],
  ]);
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));
  const userById = new Map(users.map((u) => [u.id, u]));

  // ── per-user counts, over the whole range ──
  type Acc = Omit<ActivityUserRow, "id" | "name" | "email" | "orgName" | "role" | "memberSince">;
  const acc = new Map<string, Acc>();
  const rowFor = (id: string): Acc => {
    let a = acc.get(id);
    if (!a) {
      a = { created: 0, sent: 0, edited: 0, actions: 0, lastActive: null, sentValue: 0, accepted: 0, acceptedValue: 0, roof: 0, hvac: 0 };
      acc.set(id, a);
    }
    return a;
  };
  for (const g of proposalWork) {
    if (!g.actorId) continue;
    const a = rowFor(g.actorId);
    if (g.kind === "CREATED") a.created += g._count._all;
    else if (g.kind === "SENT") a.sent += g._count._all;
    else if (g.kind === "EDITED") a.edited += g._count._all;
  }
  for (const g of allWork) {
    if (!g.actorId) continue;
    const a = rowFor(g.actorId);
    a.actions += g._count._all;
    const last = g._max.createdAt;
    if (last && (!a.lastActive || last.toISOString() > a.lastActive)) a.lastActive = last.toISOString();
  }
  for (const g of sentByOwner) {
    if (!g.ownerId) continue;
    rowFor(g.ownerId).sentValue += g._sum.total ?? 0;
  }
  for (const g of acceptedByOwner) {
    if (!g.ownerId) continue;
    const a = rowFor(g.ownerId);
    a.accepted += g._count._all;
    a.acceptedValue += g._sum.total ?? 0;
  }
  for (const g of roofByUser) if (g.createdById) rowFor(g.createdById).roof += g._count._all;
  for (const g of hvacByUser) rowFor(g.createdById).hvac += g._count._all;
  // An estimate is activity too: a member who only measured still shows a last-active time.
  for (const r of roofRows) {
    if (!r.createdById) continue;
    const a = rowFor(r.createdById);
    const iso = r.createdAt.toISOString();
    if (!a.lastActive || iso > a.lastActive) a.lastActive = iso;
  }
  for (const h of hvacRows) {
    const a = rowFor(h.createdById);
    const iso = h.createdAt.toISOString();
    if (!a.lastActive || iso > a.lastActive) a.lastActive = iso;
  }
  // A searched member is listed even with nothing in the range; a screen opened is "last seen" too.
  for (const id of foundIds ?? []) rowFor(id);
  for (const r of runs) {
    const a = rowFor(r.userId);
    if (!a.lastActive || r.at > a.lastActive) a.lastActive = r.at;
  }

  const userRows: ActivityUserRow[] = [...acc.entries()].map(([id, a]) => {
    const u = userById.get(id);
    const m = u?.memberships[0];
    return {
      id,
      name: u?.name?.trim() || u?.email || "Former member",
      email: u?.email ?? null,
      orgName: m?.organization.name ?? null,
      role: m?.role ?? null,
      memberSince: u ? u.createdAt.toISOString() : null,
      ...a,
    };
  });

  // ── the trail, with estimates woven in ──
  const proposals: Record<string, ProposalPeek> = {};
  const feed: ActivityEventDTO[] = events.map((e) => {
    const u = e.actorId ? userById.get(e.actorId) : undefined;
    if (e.proposal && !proposals[e.proposal.id]) {
      const p = e.proposal;
      proposals[p.id] = {
        id: p.id,
        title: p.title,
        status: p.status,
        address: p.address,
        clientName: p.client?.name ?? null,
        ownerName: p.owner?.name?.trim() || p.owner?.email || null,
        orgName: p.organization.name,
        subtotal: p.subtotal,
        discountTotal: p.discountTotal,
        taxTotal: p.taxTotal,
        total: p.total,
        currency: p.currency,
        createdAt: p.createdAt.toISOString(),
        sentAt: p.sentAt?.toISOString() ?? null,
        viewedAt: p.viewedAt?.toISOString() ?? null,
        viewCount: p.viewCount,
        acceptedAt: p.acceptedAt?.toISOString() ?? null,
        declinedAt: p.declinedAt?.toISOString() ?? null,
        paidAt: p.paidAt?.toISOString() ?? null,
        lineItems: p.lineItems.map((li) => ({ name: li.name, quantity: li.quantity, unitPrice: li.unitPrice, total: li.total })),
      };
    }
    return {
      id: e.id,
      at: e.createdAt.toISOString(),
      kind: e.kind,
      summary: e.summary,
      actorId: e.actorId,
      actorName: u?.name?.trim() || u?.email || "Former member",
      orgName: e.organization.name,
      proposalId: e.proposalId,
      leadId: e.leadId,
      clientId: e.clientId,
    };
  });
  for (const r of roofRows) {
    if (!r.createdById) continue;
    const u = userById.get(r.createdById);
    const where = [r.address, r.city, r.state].filter(Boolean).join(", ") || "an address";
    const figs = [r.squares != null ? `${r.squares.toFixed(1)} squares` : null, r.predominantPitch ? `${r.predominantPitch} pitch` : null].filter(Boolean).join(" · ");
    feed.push({
      id: `roof:${r.id}`,
      at: r.createdAt.toISOString(),
      kind: "ESTIMATE_ROOF",
      summary: `Measured the roof at ${where}${figs ? ` — ${figs}` : ""}`,
      actorId: r.createdById,
      actorName: u?.name?.trim() || u?.email || "Former member",
      orgName: orgName.get(r.organizationId) ?? "—",
      proposalId: null,
      leadId: null,
      clientId: null,
    });
  }
  for (const h of hvacRows) {
    const u = userById.get(h.createdById);
    const where = [h.address, h.state].filter(Boolean).join(", ") || "an address";
    const figs = [h.sizedTons != null ? `${h.sizedTons} tons` : null, h.status === "converted" ? "converted to a proposal" : null].filter(Boolean).join(" · ");
    feed.push({
      id: `hvac:${h.id}`,
      at: h.createdAt.toISOString(),
      kind: "ESTIMATE_HVAC",
      summary: `Sized the HVAC replacement at ${where}${figs ? ` — ${figs}` : ""}`,
      actorId: h.createdById,
      actorName: u?.name?.trim() || u?.email || "Former member",
      orgName: orgName.get(h.organizationId) ?? "—",
      proposalId: h.proposalId,
      leadId: null,
      clientId: null,
    });
  }
  for (const r of runs) {
    const u = userById.get(r.userId);
    feed.push({
      id: `view:${r.userId}:${r.at}`,
      at: r.at,
      kind: "SCREEN",
      summary: `On ${r.screen}${r.views > 1 ? ` · ${r.views} views` : ""}`,
      actorId: r.userId,
      actorName: u?.name?.trim() || u?.email || "Former member",
      orgName: orgName.get(r.organizationId) ?? "—",
      proposalId: null,
      leadId: null,
      clientId: null,
    });
  }
  feed.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  const totals = {
    activeUsers: userRows.filter((r) => r.actions + r.roof + r.hvac > 0).length,
    created: userRows.reduce((n, r) => n + r.created, 0),
    sent: userRows.reduce((n, r) => n + r.sent, 0),
    accepted: userRows.reduce((n, r) => n + r.accepted, 0),
    acceptedValue: userRows.reduce((n, r) => n + r.acceptedValue, 0),
    estimates: userRows.reduce((n, r) => n + r.roof + r.hvac, 0),
    feedTruncated: events.length >= FEED_LIMIT || roofRows.length >= ESTIMATE_LIMIT || hvacRows.length >= ESTIMATE_LIMIT || views.length >= VIEW_LIMIT,
  };

  const insights = await insightsP;
  return <AdminActivityContent range={range} users={userRows} feed={feed} proposals={proposals} totals={totals} now={now} q={q} found={found ? found.length : null} working={working} insights={insights} />;
}
