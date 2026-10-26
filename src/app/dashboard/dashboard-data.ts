// Overview — the one read that fills the sheet, on either surface.
//
// This used to live inline in ./page.tsx, which was fine while the desktop
// blueprint was the only edition that showed real numbers. The handheld build
// (src/app/(mobile)/mobile-v2/mobile-dashboard.tsx) is mounted PROPS-LESS by
// the responsive shell at ≤768px, so it cannot be handed the page's server
// data the way a child normally would — and it was still painting the donor's
// demo fixture as a result. Extracting the query here gives both editions one
// origin: the server page awaits it directly, the handheld build reaches it
// through ./dashboard-actions.ts. Neither can drift from the other, and there
// is exactly one definition of "revenue · 30D" in the product.
//
// The queries are the archived classic overview's (git a8bd532^:
// src/app/(dashboard)/dashboard/page.tsx): same 30/60/90-day revenue windows,
// same ACTIVE_PIPELINE definition, same week window, same lead slice.

import { requireOrg, isSalesRole } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { money, relative } from "@/lib/format";
import { parseTradeTypes } from "@/lib/tradeTypes";
import { firstEstimateTarget } from "@/lib/firstEstimate";
import { readCustomPages } from "@/lib/customPageAccess";
import { estimatesSoFar as estimatesSoFarOf } from "@/lib/onboarding/progress";
import { actorsOf, whoOfEvent } from "@/lib/activityLog";
import { isOrgNameUnset } from "@/lib/orgName";
import {
  BOARD_STATUSES,
  activityIcon,
  activityLabel,
  makeDataset,
  type ActivityRow,
  type BoardLead,
  type DashboardData,
  type JobRow,
  type WeekDay,
  type WeekEvent,
} from "@/components/v3/dashboard-blueprint/blueprint-data";

/** Local calendar day key. `toISOString()` would shift the boundary by the UTC
 *  offset and file an 8pm job under tomorrow. */
function dayKey(d: Date): string {
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

const TIME_FMT = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });
const MONTH_FMT = new Intl.DateTimeFormat("en-US", { month: "short" });
const WEEKDAY_FMT = new Intl.DateTimeFormat("en-US", { weekday: "short" });
const PLATE_FMT = new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit" });
const TICK_FMT = new Intl.DateTimeFormat("en-US", { month: "numeric", day: "numeric" });

/** The donor's "SU / MO / TU" strip labels. */
function dayLabel(d: Date): string {
  return WEEKDAY_FMT.format(d).slice(0, 2).toUpperCase();
}

/** The donor's "JUL 28" date plate. */
function datePlate(d: Date): string {
  return PLATE_FMT.format(d).toUpperCase();
}

/** The workspace name Google sign-in invents when it provisions an org for a
 *  first-time user — "Dana's workspace", or "My workspace" when even the first
 *  name is missing (src/lib/auth.ts). It names a person, never a business. */
const PLACEHOLDER_ORG_NAME = /^(my workspace|.+'s workspace)$/i;

function isBlank(v: string | null | undefined): boolean {
  return !v || v.trim() === "";
}

function greetingFor(d: Date): string {
  const h = d.getHours();
  return h < 12 ? "Morning" : h < 18 ? "Afternoon" : "Evening";
}

/** "Bothell, WA" — either half may be missing on a real row. */
function placeLabel(city: string | null, state: string | null): string {
  return [city, state].filter(Boolean).join(", ") || "—";
}

/** `Membership.role` is a raw enum-ish string ("OWNER", "INSTALLER"); both
 *  account blocks show it to a human, so title-case it. Same rule as the
 *  desktop layout's `humanRole`. */
function humanRole(role: string): string {
  return role.charAt(0) + role.slice(1).toLowerCase();
}

/**
 * Sum PAID payments into consecutive buckets. One 90-day read feeds all three
 * chart ranges, so switching the dropdown never hits the database.
 */
function bucketSums(
  payments: { amount: number; paidAt: Date | null }[],
  edges: Date[],
): number[] {
  const out = new Array(Math.max(0, edges.length - 1)).fill(0) as number[];
  for (const p of payments) {
    if (!p.paidAt) continue;
    const t = p.paidAt.getTime();
    for (let i = 0; i < out.length; i++) {
      if (t >= edges[i].getTime() && t < edges[i + 1].getTime()) {
        out[i] += p.amount;
        break;
      }
    }
  }
  return out;
}

/** `count` buckets of `span` days each, ending at the end of today. */
function buildRange(
  payments: { amount: number; paidAt: Date | null }[],
  today: Date,
  count: number,
  span: number,
  label: (bucketEnd: Date) => string,
) {
  const end = addDays(startOfDay(today), 1); // exclusive: tomorrow 00:00
  const edges: Date[] = [];
  for (let i = count; i >= 0; i--) edges.push(addDays(end, -i * span));
  const values = bucketSums(payments, edges);
  // The label names the LAST day inside the bucket, so it never reads as a day
  // that has not happened yet.
  const labels = edges.slice(1).map((e) => label(addDays(e, -1)));
  return makeDataset(labels, values);
}

/**
 * Every region of the Overview, for the signed-in org.
 *
 * Throws `UnauthorizedError` / `NoOrgError` out of `requireOrg` — the caller
 * decides whether that means a redirect (the server page) or an error state
 * (the handheld build, which reaches this through a server action).
 */
export async function buildDashboardData(opts: { showTour?: boolean } = {}): Promise<DashboardData> {
  const { organizationId, role, user } = await requireOrg();
  const userId = user.id;

  const now = new Date();
  const today = startOfDay(now);
  const thirtyDaysAgo = addDays(now, -30);
  const ninetyDaysAgo = addDays(today, -90);
  const sevenDaysAgo = addDays(now, -7);

  // Current week, Sunday 00:00 → next Sunday 00:00 (the calendar's Sunday-first
  // convention, same as the classic overview's This Week card).
  const weekStart = addDays(today, -today.getDay());
  const weekEnd = addDays(weekStart, 7);

  const ACTIVE_PIPELINE = { notIn: ["DECLINED", "ARCHIVED", "EXPIRED"] };

  const [
    firstRunOrg,
    estimatesSoFar,
    leadProfileOrg,
    paymentsLast90,
    pipelineAgg,
    openProposals,
    newLeads7,
    activityRows,
    upcomingRows,
    weekRows,
    leadRows,
    actors,
  ] = await Promise.all([
    // The first-run card (landing-e pass A; every shop since 2026-09-16): a
    // shop that has not made an estimate yet. The counts are the things an
    // "estimate" can be here — a proposal, an AI estimate, a roof
    // measurement, an HVAC estimate. The custom plan's pages ride along so the
    // card's button never opens an upgrade offer (lib/firstEstimate).
    Promise.all([
      db.organization.findUnique({
        where: { id: organizationId },
        select: { landingIndustry: true, tradeTypesJson: true },
      }),
      readCustomPages(organizationId).catch(() => null),
    ]).then(([org, pages]) => (org ? { ...org, pages } : null)),
    estimatesSoFarOf(organizationId),
    // Owners/admins see the Lead Center nudge until the org is matchable
    // (geocoded address + at least one trade). Everyone else never sees it.
    role === "OWNER" || role === "ADMIN"
      ? db.organization.findUnique({
          where: { id: organizationId },
          select: {
            name: true,
            phone: true,
            website: true,
            lat: true,
            lng: true,
            tradeTypesJson: true,
          },
        })
      : Promise.resolve(null),
    db.payment.findMany({
      where: { organizationId, status: "PAID", paidAt: { gte: ninetyDaysAgo } },
      orderBy: { paidAt: "asc" },
      select: { amount: true, paidAt: true },
    }),
    db.proposal.aggregate({
      where: { organizationId, status: ACTIVE_PIPELINE },
      _sum: { total: true },
    }),
    db.proposal.count({
      where: { organizationId, status: { in: ["DRAFT", "SENT", "VIEWED"] } },
    }),
    db.lead.count({ where: { organizationId, createdAt: { gte: sevenDaysAgo } } }),
    db.activityEvent.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      // The donor's Recent Activity card shows at most ten rows.
      take: 10,
      select: { id: true, kind: true, summary: true, createdAt: true, actorId: true },
    }),
    db.jobEvent.findMany({
      where: { organizationId, startsAt: { gte: now } },
      orderBy: { startsAt: "asc" },
      take: 12,
      select: {
        id: true,
        title: true,
        startsAt: true,
        notes: true,
        job: {
          select: {
            id: true,
            client: { select: { name: true } },
            assignments: { select: { status: true } },
          },
        },
      },
    }),
    db.jobEvent.findMany({
      where: { organizationId, startsAt: { gte: weekStart, lt: weekEnd } },
      orderBy: { startsAt: "asc" },
      select: { id: true, title: true, startsAt: true },
    }),
    // Sales reps only see leads assigned to them, claimed by them, or still NEW
    // in the shared pool — the same slice the leads page and `updateLeadStatus`
    // enforce, so a card on this board is always a card they may move.
    db.lead.findMany({
      where: {
        organizationId,
        status: { in: [...BOARD_STATUSES] },
        ...(isSalesRole(role)
          ? { OR: [{ assignedToId: userId }, { claimedById: userId }, { status: "NEW" }] }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 60,
      select: {
        id: true,
        name: true,
        city: true,
        state: true,
        projectType: true,
        status: true,
        createdAt: true,
        assignedTo: { select: { name: true, email: true } },
      },
    }),
    // The members, so every activity row can carry its author's mark.
    actorsOf(organizationId),
  ]);

  // ── KPI strip ─────────────────────────────────────────────────────────────
  const revenue30 = paymentsLast90
    .filter((p) => p.paidAt && p.paidAt >= thirtyDaysAgo)
    .reduce((acc, p) => acc + p.amount, 0);
  const pipelineTotal = pipelineAgg._sum.total ?? 0;

  // ── Revenue trend ─────────────────────────────────────────────────────────
  // One 90-day read, three views of it: seven days, ten three-day buckets,
  // thirteen weeks — the donor's own point counts for each range.
  const chart = {
    "7d": buildRange(paymentsLast90, now, 7, 1, (d) => WEEKDAY_FMT.format(d).toUpperCase()),
    "30d": buildRange(paymentsLast90, now, 10, 3, (d) => TICK_FMT.format(d)),
    "90d": buildRange(paymentsLast90, now, 13, 7, (d) => TICK_FMT.format(d)),
  };

  // ── Recent activity ───────────────────────────────────────────────────────
  const activities: ActivityRow[] = activityRows.map((a) => ({
    i: activityIcon(a.kind),
    t: a.summary,
    m: activityLabel(a.kind) + " · " + relative(a.createdAt),
    who: whoOfEvent(a, actors),
    // The reader's own doing: the row names an author only when it is
    // someone else (owner, 2026-09-26) — decided here, by id, never by name.
    mine: !!a.actorId && a.actorId === userId,
  }));

  // ── This week ─────────────────────────────────────────────────────────────
  const weekEventsByDay: Record<string, WeekEvent[]> = {};
  for (const e of weekRows) {
    const key = dayKey(e.startsAt);
    (weekEventsByDay[key] ??= []).push({
      m: e.startsAt.getHours() * 60 + e.startsAt.getMinutes(),
      t: TIME_FMT.format(e.startsAt),
      title: e.title,
    });
  }
  const todayIso = dayKey(today);
  const days: WeekDay[] = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(weekStart, i);
    const iso = dayKey(d);
    return {
      iso,
      num: d.getDate(),
      lbl: dayLabel(d),
      today: iso === todayIso,
      has: (weekEventsByDay[iso]?.length ?? 0) > 0,
    };
  });
  const lastDay = addDays(weekStart, 6);
  const weekRange =
    MONTH_FMT.format(weekStart) +
    " " +
    weekStart.getDate() +
    " – " +
    (weekStart.getMonth() === lastDay.getMonth() ? "" : MONTH_FMT.format(lastDay) + " ") +
    lastDay.getDate();

  // ── Upcoming jobs ─────────────────────────────────────────────────────────
  // The donor's chip is two-state. "Confirmed" is a job whose crew have all
  // accepted their assignment; anything else — nobody staffed yet, an
  // outstanding invite, or a calendar hold with no job behind it — is "Pending".
  const jobs: JobRow[] = upcomingRows.map((e) => {
    const asg = e.job?.assignments ?? [];
    const confirmed =
      asg.length > 0 && asg.every((a) => a.status === "ACCEPTED" || a.status === "COMPLETED");
    return {
      id: e.id,
      date: datePlate(e.startsAt),
      title: e.title,
      sub: TIME_FMT.format(e.startsAt) + " · " + (e.job?.client?.name ?? e.notes ?? "Scheduled"),
      st: confirmed ? "ok" : "wait",
      today: dayKey(e.startsAt) === todayIso,
    };
  });

  // ── Lead flow ─────────────────────────────────────────────────────────────
  const leads: BoardLead[] = leadRows.map((l) => ({
    id: l.id,
    stage: l.status.toLowerCase(),
    name: l.name,
    job: l.projectType ?? "General inquiry",
    city: placeLabel(l.city, l.state),
    owner: l.assignedTo?.name ?? l.assignedTo?.email ?? null,
    age: relative(l.createdAt),
  }));

  const needsAddress =
    leadProfileOrg != null && (leadProfileOrg.lat == null || leadProfileOrg.lng == null);
  const needsTrades =
    leadProfileOrg != null && parseTradeTypes(leadProfileOrg.tradeTypesJson).length === 0;
  // "The company isn't set up yet." `name` is never blank in practice — the
  // register form requires a business name (src/actions/auth.ts) — so a bare
  // emptiness check would never fire. Two things do mean an unconfigured shop:
  // the workspace still carries the placeholder name Google sign-in invents for
  // an org it knows nothing about (src/lib/auth.ts), or nobody can reach the
  // business — no phone AND no website. `address` deliberately stays out of the
  // test: the geocoded address is already `needsAddress`, and folding it in here
  // would make the two gaps report the same fact twice.
  const needsCompany =
    leadProfileOrg != null &&
    (isBlank(leadProfileOrg.name) ||
      PLACEHOLDER_ORG_NAME.test(leadProfileOrg.name.trim()) ||
      (isBlank(leadProfileOrg.phone) && isBlank(leadProfileOrg.website)));

  // The passwordless sign-up names the shop after its owner until the owner
  // names the business (lib/orgName): that alone raises the banner.
  const needsName = leadProfileOrg != null && (await isOrgNameUnset(organizationId));

  return {
    greeting: "Good " + greetingFor(now) + " · " + MONTH_FMT.format(now) + " " + now.getDate(),
    viewer: {
      name: user.name || user.email || "Account",
      role: humanRole(role),
    },
    // The Lead Center nag rises for the two gaps that actually stop a lead:
    // no trades, or no geocoded pin. The pin was added back on 2026-09-17,
    // after a test run found that the shop most in need of this sentence —
    // one whose address never geocoded, which before the signup fix was every
    // shop created through checkout — was the one shop it never reached. The
    // 2026-09-04 rule it replaces (trades only) was written when a missing pin
    // meant the owner had skipped a field; it now also means the geocode
    // failed, which the owner cannot know any other way.
    // `needsCompany` still only rides along in the sentence; it does not raise
    // the banner on its own.
    leadProfile:
      needsTrades || needsAddress || needsName ? { needsCompany, needsAddress, needsTrades, needsName } : null,
    firstRun:
      // `?tour=show` (2026-10-26): the card — and its "Show me how" — for a
      // company that has estimates already, so the tour can be started there.
      firstRunOrg && (estimatesSoFar === 0 || opts.showTour)
        ? firstEstimateTarget(parseTradeTypes(firstRunOrg.tradeTypesJson), firstRunOrg.landingIndustry, firstRunOrg.pages)
        : null,
    kpis: {
      revenue: money(revenue30),
      pipeline: money(pipelineTotal),
      openProposals: String(openProposals),
      newLeads: String(newLeads7),
    },
    // The handheld build animates and compacts these ("$132K"), which it cannot
    // do from a pre-formatted string without parsing money back out of it.
    kpiRaw: {
      revenue: revenue30,
      pipeline: pipelineTotal,
      openProposals,
      newLeads: newLeads7,
    },
    chart,
    activities,
    week: {
      range: weekRange,
      scheduled: weekRows.length,
      days,
      events: weekEventsByDay,
      todayIso,
    },
    jobs,
    leads,
  };
}
