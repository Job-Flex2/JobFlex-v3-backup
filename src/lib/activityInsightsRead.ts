import "server-only";
// WHAT MEMBERS DO — the read behind the analyst on /admin/activity (2026-10-28). Everything the counted workspaces
// did in the range: the screens members opened (the trial watch's page views, in the sidebar's words), the trail,
// the roof measurements and HVAC estimates (they live in their own tables, not in the trail), the proposals with
// their dates, and every workspace with its plan and members. The staff (platform admins), the QA Lab's own
// accounts and the workspaces hidden from the stats are left out, the way the trial board leaves them out. Then
// lib/activityInsights reads it all into statistics and findings. Read-only; cached a few minutes per range, since
// the admin flips between ranges and nothing here needs to be fresher than that.
import { db } from "@/lib/db";
import { qaOrgIds } from "@/lib/qaOrg";
import { statsHiddenIds } from "@/lib/statsHidden";
import { screenWords } from "@/lib/trialBoardRead";
import { analyseActivity, type ActivityInsights, type InsightEvent, type InsightOrg, type InsightProposal, type InsightView } from "@/lib/activityInsights";

const VIEW_CAP = 60_000;
const EVENT_CAP = 40_000;
const PROPOSAL_CAP = 20_000;
const ESTIMATE_CAP = 10_000;
const CACHE_MS = 5 * 60_000;

/** A trail row's `trade`, and whether it stands for a row of the estimate tables (counted there, not twice). */
function metaOf(meta: string | null): { trade: string | null; tabled: boolean } {
  if (!meta) return { trade: null, tabled: false };
  try {
    const m = JSON.parse(meta) as { trade?: unknown; measurementId?: unknown; estimateId?: unknown };
    return { trade: typeof m.trade === "string" ? m.trade.toLowerCase() : null, tabled: typeof m.measurementId === "string" || typeof m.estimateId === "string" };
  } catch {
    return { trade: null, tabled: false };
  }
}

const cache = new Map<string, { at: number; value: Promise<ActivityInsights> }>();

/** The analyst's reading for the range (`since` null = all time), from the database; a reading a few minutes old is reused. */
export function readActivityInsights(since: Date | null, now: number, timezone: string): Promise<ActivityInsights> {
  const key = `${since ? since.getTime() : "all"}:${timezone}`;
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_MS) return hit.value;
  const value = readNow(since, now, timezone);
  cache.set(key, { at: now, value });
  // A failed read is not kept.
  value.catch(() => cache.delete(key));
  return value;
}

async function readNow(since: Date | null, now: number, timezone: string): Promise<ActivityInsights> {
  const [hidden, qa, staff] = await Promise.all([
    statsHiddenIds().catch(() => [] as string[]),
    qaOrgIds().catch(() => [] as string[]),
    db.user.findMany({ where: { isPlatformAdmin: true }, select: { id: true } }).catch(() => [] as { id: string }[]),
  ]);
  const leftOut = [...new Set([...hidden, ...qa])];
  const staffIds = staff.map((u) => u.id);
  const orgFilter = leftOut.length ? { organizationId: { notIn: leftOut } } : {};
  const inRange = since ? { gte: since } : undefined;
  const made = inRange ? { createdAt: inRange } : {};

  const [orgRows, viewRows, eventRows, proposalRows, roofRows, hvacRows] = await Promise.all([
    db.organization.findMany({
      where: { deletedAt: null, ...(leftOut.length ? { id: { notIn: leftOut } } : {}) },
      select: { id: true, name: true, createdAt: true, subscription: { select: { plan: true, status: true, trialEndsAt: true } }, memberships: { select: { userId: true, role: true } } },
    }),
    db.pageView
      .findMany({
        where: { ...(inRange ? { at: inRange } : {}), userId: staffIds.length ? { not: null, notIn: staffIds } : { not: null }, ...orgFilter },
        orderBy: { at: "desc" },
        take: VIEW_CAP,
        select: { organizationId: true, userId: true, route: true, at: true },
      })
      .catch(() => []),
    db.activityEvent
      .findMany({
        where: { ...made, kind: { not: "TEST" }, ...orgFilter },
        orderBy: { createdAt: "desc" },
        take: EVENT_CAP,
        select: { organizationId: true, actorId: true, kind: true, createdAt: true, proposalId: true, clientId: true, meta: true },
      })
      .catch(() => []),
    db.proposal
      .findMany({
        where: { ...(inRange ? { OR: [{ createdAt: inRange }, { sentAt: inRange }] } : {}), ...orgFilter },
        orderBy: { createdAt: "desc" },
        take: PROPOSAL_CAP,
        select: { organizationId: true, createdAt: true, sentAt: true, viewedAt: true, acceptedAt: true, declinedAt: true, paidAt: true, total: true, trade: true },
      })
      .catch(() => []),
    db.roofMeasurement
      .findMany({ where: { ...made, ...orgFilter }, orderBy: { createdAt: "desc" }, take: ESTIMATE_CAP, select: { organizationId: true, createdById: true, createdAt: true } })
      .catch(() => []),
    db.hvacEstimate
      .findMany({ where: { ...made, ...orgFilter }, orderBy: { createdAt: "desc" }, take: ESTIMATE_CAP, select: { organizationId: true, createdById: true, createdAt: true } })
      .catch(() => []),
  ]);

  const orgs: InsightOrg[] = orgRows.map((o) => ({
    id: o.id,
    name: o.name,
    createdAt: o.createdAt.getTime(),
    plan: o.subscription?.plan ?? "",
    status: o.subscription?.status ?? "",
    trialEndsAt: o.subscription?.trialEndsAt?.getTime() ?? null,
    members: o.memberships.length,
    owners: o.memberships.filter((m) => m.role === "OWNER").map((m) => m.userId),
  }));
  // The same route is opened thousands of times: its words are read once.
  const words = new Map<string, string>();
  const screenOf = (route: string): string => {
    let w = words.get(route);
    if (w === undefined) {
      w = screenWords(route);
      words.set(route, w);
    }
    return w;
  };
  const views: InsightView[] = viewRows.map((v) => {
    const screen = screenOf(v.route);
    return { orgId: v.organizationId, userId: v.userId as string, at: v.at.getTime(), screen, area: screen.split(" · ")[0] };
  });
  const events: InsightEvent[] = [];
  for (const e of eventRows) {
    const m = metaOf(e.meta);
    if (e.kind === "ESTIMATE" && m.tabled) continue;
    events.push({ orgId: e.organizationId, actorId: e.actorId, kind: e.kind, at: e.createdAt.getTime(), trade: m.trade, proposalId: e.proposalId, clientId: e.clientId });
  }
  for (const r of roofRows) events.push({ orgId: r.organizationId, actorId: r.createdById ?? null, kind: "ESTIMATE", at: r.createdAt.getTime(), trade: "roof", proposalId: null, clientId: null });
  for (const h of hvacRows) events.push({ orgId: h.organizationId, actorId: h.createdById ?? null, kind: "ESTIMATE", at: h.createdAt.getTime(), trade: "hvac", proposalId: null, clientId: null });
  const proposals: InsightProposal[] = proposalRows.map((p) => ({
    orgId: p.organizationId,
    createdAt: p.createdAt.getTime(),
    sentAt: p.sentAt?.getTime() ?? null,
    viewedAt: p.viewedAt?.getTime() ?? null,
    acceptedAt: p.acceptedAt?.getTime() ?? null,
    declinedAt: p.declinedAt?.getTime() ?? null,
    paidAt: p.paidAt?.getTime() ?? null,
    total: Number(p.total) || 0,
    trade: p.trade ? p.trade.toLowerCase() : null,
  }));
  const truncated = viewRows.length >= VIEW_CAP || eventRows.length >= EVENT_CAP || proposalRows.length >= PROPOSAL_CAP || roofRows.length >= ESTIMATE_CAP || hvacRows.length >= ESTIMATE_CAP;
  return analyseActivity({ now, since: since ? since.getTime() : null, timezone, orgs, views, events, proposals, truncated });
}
