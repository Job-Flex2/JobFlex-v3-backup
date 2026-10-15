"use server";

// Platform-admin read models for /admin (overview) and /admin/traffic.
//
// Every export is guarded by requirePlatformAdmin(). Every figure is either a
// database count, a billing figure from getSubscribersData (which owns the MRR
// rule AND the Stripe-live / local-mirror fallback — nothing here re-derives
// either) or a PostHog query. When a source is not configured the field says
// so instead of guessing.

import { requirePlatformAdmin } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { statsHiddenIds } from "@/lib/statsHidden";
import { QA_EMAIL_DOMAIN } from "@/lib/qaEmail";
import { QUOTA_KEY as PARCEL_QUOTA_KEY } from "@/lib/parcelLookup";
import { QUOTA_ALLTIME as PARCEL_QUOTA_TOTAL } from "@/lib/reportall";
import { getSubscribersData } from "@/actions/subscribers";
import type {
  ChangeKind,
  MatchedBy,
} from "@/components/v3/admin-subscribers/billing-metrics";
import {
  getTrafficSnapshot,
  isPostHogEnabled,
  POSTHOG_DEFAULT_HOST,
  POSTHOG_ENV,
  type TrafficResult,
} from "@/lib/posthog";

export interface WeekBucket {
  /** M/D of the week's Sunday. */
  label: string;
  count: number;
}

export interface AdminOverviewData {
  organizations: number;
  /** People who signed up: a User with at least one organization membership,
   *  minus the console's own synthetic principal. See PEOPLE_RULE. */
  users: number;
  payingCount: number;
  mrrCents: number;
  /** The currency mrrCents is denominated in. */
  mrrCurrency: string;
  /** How many subscriptions the MRR figure is the sum of. */
  mrrSubCount: number;
  /** Of those, how many resolve to no JobFlex organization (either reason). */
  mrrUnmatched: number;
  /** Of those, how many name an id this database can't resolve; the rest name nobody. */
  mrrNamedUnknown: number;
  /** Of those, how many carry an amount no source could name (they add 0). */
  mrrUnpriced: number;
  /** Of those, how many priced only some of their recurring items — a floor. */
  mrrPartlyPriced: number;
  /** Of those, how many take a product-limited coupon off the whole amount. */
  mrrRestrictedDiscount: number;
  /** Platform record rows Stripe answered about and did not return. */
  unconfirmedCount: number;
  /** Live subscriptions billed in another currency — beside the total, not in it. */
  otherCurrencyCount: number;
  otherCurrencies: string[];
  /** True when payingCount / mrrCents came from a live Stripe call. */
  stripeLive: boolean;
  stripeEnabled: boolean;
  /** Set only when Stripe IS configured and the live call failed. */
  stripeError: string | null;
  /** More Stripe subscriptions exist than were read — every billing figure is partial. */
  billingTruncated: boolean;
  /** Organizations created since the 1st — the signup unit everywhere on this
   *  page is an organization, never a person. */
  orgsThisMonth: number;
  supportUnread: number;
  /** THE PARCEL ALLOWANCE. ReportAll sells a fixed number of point lookups for
   *  the life of the account — ALLTIME, not monthly — and the only statement of
   *  what is left is the header every parcel call answers with, which
   *  lib/reportall writes to SyncState. Read from that row here: asking
   *  ReportAll would cost one of the lookups the tile is counting.
   *  `remaining` is null when no call has ever answered on this deployment;
   *  `stale` says the last answer is older than PARCEL_QUOTA_STALE_DAYS, so the
   *  figure is a memory rather than a reading. */
  parcelQuota: {
    remaining: number | null;
    total: number;
    updatedAt: string | null;
    stale: boolean;
  };
  /** 12 weeks of organization signups, oldest first; the last bucket is this week. */
  weeks: WeekBucket[];
  recentOrgs: { id: string; name: string; members: number; createdAt: string }[];
  /** `changedAt` is whatever the source last reported; `changeKind` says which. */
  recentSubs: {
    id: string;
    subscriber: string;
    linked: boolean;
    /** Why it is or isn't linked — "named nobody" reads nothing like "named an
     *  id this database has no record of", and the card says which. */
    matchedBy: MatchedBy;
    plan: string;
    /** Catalog name (what the chip prints); `plan` is the slug. */
    planName: string;
    status: string;
    changedAt: string;
    changeKind: ChangeKind;
  }[];
  /** Where recentSubs came from — the card says so on screen. */
  activitySource: string;
  posthog: {
    enabled: boolean;
    /** Unique visitors in the last 24h when PostHog answered, else null. */
    visitors24h: number | null;
    error: string | null;
  };
  env: { stripe: string; posthogKey: string; posthogProject: string };
  /** Server clock at build time — relative labels are computed from this so
   *  the client render matches the server render byte for byte. */
  generatedAt: string;
}

/** After this long without a parcel call, the stored allowance is a memory,
 *  not a reading — the tile says so rather than presenting it as current. */
const PARCEL_QUOTA_STALE_DAYS = 7;

/** Sunday-anchored 12-week buckets, the overview's signups sparkline. */
function weekBuckets(createdAts: Date[]): WeekBucket[] {
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - now.getDay());
  weekStart.setHours(0, 0, 0, 0);

  const starts: Date[] = [];
  for (let i = 11; i >= 0; i--) {
    const s = new Date(weekStart);
    s.setDate(s.getDate() - i * 7);
    starts.push(s);
  }
  const buckets = starts.map((s) => ({ label: `${s.getMonth() + 1}/${s.getDate()}`, count: 0 }));
  for (const at of createdAts) {
    for (let i = 0; i < starts.length; i++) {
      const end = new Date(starts[i]);
      end.setDate(end.getDate() + 7);
      if (at >= starts[i] && at < end) {
        buckets[i].count++;
        break;
      }
    }
  }
  return buckets;
}

/** How many rows the subscription-activity card shows. */
const ACTIVITY_ROWS = 8;

/* ── THE PEOPLE RULE ───────────────────────────────────────────────────────
   "People" is signed-up humans, not User rows. Registration creates an
   Organization and an OWNER Membership in one transaction (actions/auth.ts),
   and an accepted worker invite creates a Membership too — so "has at least
   one membership" is exactly the set of people who completed a signup.
   The console's own principal (minted by adminAuth on first cookie login as
   <user>@platform.jobflex.local) is excluded by name as well, so it can never
   count even if it is later given a membership.
   Verify: SELECT COUNT(*) FROM User u WHERE EXISTS (SELECT 1 FROM Membership m
   WHERE m.userId = u.id) AND u.email NOT LIKE '%@platform.jobflex.local'; */
const ADMIN_EMAIL_DOMAIN = "@platform.jobflex.local";

function signedUpPeopleCount(hidden: readonly string[] = []) {
  return db.user.count({
    where: {
      memberships: hidden.length ? { some: { organizationId: { notIn: [...hidden] } } } : { some: {} },
      // and the QA Lab's own accounts (lib/qaTestMode)
      AND: [{ email: { not: { endsWith: ADMIN_EMAIL_DOMAIN } } }, { email: { not: { endsWith: QA_EMAIL_DOMAIN } } }],
    },
  });
}

/** Accounts an admin took out of the statistics (lib/statsHidden, 2026-10-05) — out of every count here too. */
const notHidden = (hidden: readonly string[]) => (hidden.length ? { id: { notIn: [...hidden] } } : {});

export async function getAdminOverview(): Promise<AdminOverviewData> {
  await requirePlatformAdmin();

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const twelveWeeksAgo = new Date();
  twelveWeeksAgo.setDate(twelveWeeksAgo.getDate() - 7 * 12 - 7);

  // ONE billing read for the whole page. getSubscribersData() is the single
  // owner of the MRR rule and of the Stripe-live / local-mirror fallback, so
  // the overview never re-derives either — it reads the same rows the
  // subscribers page reads, and says which source answered.
  const hidden = await statsHiddenIds();
  const [organizations, users, orgsThisMonth, supportUnread, recentOrgs, recentCreatedAts, billing] =
    await Promise.all([
      db.organization.count({ where: notHidden(hidden) }),
      signedUpPeopleCount(hidden),
      db.organization.count({ where: { createdAt: { gte: monthStart }, ...notHidden(hidden) } }),
      db.supportTicket.count({ where: { adminReadAt: null } }),
      db.organization.findMany({
        where: notHidden(hidden),
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, name: true, createdAt: true, _count: { select: { memberships: true } } },
      }),
      db.organization.findMany({
        where: { createdAt: { gte: twelveWeeksAgo }, ...notHidden(hidden) },
        select: { createdAt: true },
      }),
      getSubscribersData(),
    ]);

  // Subscription activity: the most recently changed subscriptions from
  // whichever source answered. When Stripe is live these ARE the business —
  // the local Subscription mirror is only written for orgs that checked out
  // through this deployment, so reading it alone would under-report.
  const recentSubs = [...billing.rows]
    .sort((a, b) => b.changedAt.getTime() - a.changedAt.getTime())
    .slice(0, ACTIVITY_ROWS)
    .map((r) => ({
      id: r.id,
      // Column is headed "Subscriber", not "Organization": most rows resolve to
      // an org, but an unlinked Stripe subscription only has a customer.
      subscriber: r.orgName,
      linked: r.organizationId !== null,
      matchedBy: r.matchedBy,
      plan: r.plan,
      planName: r.planName,
      status: r.status,
      changedAt: r.changedAt.toISOString(),
      changeKind: r.changeKind,
    }));

  // PostHog is optional and slow-ish; never let it fail the page.
  let posthog: AdminOverviewData["posthog"] = { enabled: false, visitors24h: null, error: null };
  if (isPostHogEnabled()) {
    const t = await getTrafficSnapshot();
    posthog = {
      enabled: true,
      visitors24h: t.status === "ok" ? t.data.visitors24h : null,
      error: t.status === "error" ? t.message : null,
    };
  }

  /* One indexed row, read rather than requested — see AdminOverviewData. A
     failure here must not take the overview down: the tile then reads "—". */
  const quotaRow = await db.syncState.findUnique({ where: { key: PARCEL_QUOTA_KEY } }).catch(() => null);
  const quotaLeft = Number(quotaRow?.cursor);
  const parcelQuota = {
    remaining: Number.isFinite(quotaLeft) ? quotaLeft : null,
    total: PARCEL_QUOTA_TOTAL,
    updatedAt: quotaRow?.updatedAt.toISOString() ?? null,
    stale: quotaRow
      ? Date.now() - quotaRow.updatedAt.getTime() > PARCEL_QUOTA_STALE_DAYS * 24 * 60 * 60 * 1000
      : false,
  };

  return {
    organizations,
    users,
    payingCount: billing.metrics.payingCount,
    mrrCents: billing.metrics.mrrCents,
    mrrCurrency: billing.metrics.currency,
    mrrSubCount: billing.metrics.mrrSubCount,
    mrrUnmatched: billing.metrics.mrrUnmatched,
    mrrNamedUnknown: billing.metrics.mrrNamedUnknown,
    mrrUnpriced: billing.metrics.mrrUnpriced,
    mrrPartlyPriced: billing.metrics.mrrPartlyPriced,
    mrrRestrictedDiscount: billing.metrics.mrrRestrictedDiscount,
    unconfirmedCount: billing.metrics.unconfirmedCount,
    otherCurrencyCount: billing.metrics.otherCurrencyCount,
    otherCurrencies: billing.metrics.otherCurrencies,
    stripeLive: billing.stripeLive,
    stripeEnabled: billing.stripeEnabled,
    stripeError: billing.stripeError,
    billingTruncated: billing.truncated,
    orgsThisMonth,
    supportUnread,
    parcelQuota,
    weeks: weekBuckets(recentCreatedAts.map((o) => o.createdAt)),
    recentOrgs: recentOrgs.map((o) => ({
      id: o.id,
      name: o.name,
      members: o._count.memberships,
      createdAt: o.createdAt.toISOString(),
    })),
    recentSubs,
    activitySource: billing.stripeLive
      ? "Stripe · live"
      : billing.stripeEnabled
        ? "Platform record · Stripe unreachable"
        : "Platform record",
    posthog,
    env: { stripe: "STRIPE_SECRET_KEY", posthogKey: POSTHOG_ENV.key, posthogProject: POSTHOG_ENV.project },
    generatedAt: new Date().toISOString(),
  };
}

// ── Traffic ───────────────────────────────────────────────────────────

export interface AdminTrafficData {
  traffic: TrafficResult;
  env: { key: string; project: string; host: string; defaultHost: string };
  /** Organization signups per day, last 30 days, oldest first (server-local dates). */
  signupsByDay: { date: string; count: number }[];
  signups30d: number;
  /** Promo-link landing visits per code (PromoCode.clicks), top 10. */
  promoClicks: { code: string; clicks: number; influencer: string }[];
  promoClicksTotal: number;
}

function localDayKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export async function getAdminTraffic(): Promise<AdminTrafficData> {
  await requirePlatformAdmin();

  const since = new Date();
  since.setDate(since.getDate() - 29);
  since.setHours(0, 0, 0, 0);

  const [traffic, orgs, promos, promoTotal] = await Promise.all([
    getTrafficSnapshot(),
    db.organization.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } }),
    db.promoCode.findMany({
      where: { clicks: { gt: 0 } },
      orderBy: { clicks: "desc" },
      take: 10,
      select: { code: true, clicks: true, influencer: { select: { displayName: true } } },
    }),
    db.promoCode.aggregate({ _sum: { clicks: true } }),
  ]);

  const counts = new Map<string, number>();
  for (const o of orgs) {
    const k = localDayKey(o.createdAt);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const signupsByDay: AdminTrafficData["signupsByDay"] = [];
  for (let i = 0; i < 30; i++) {
    const d = new Date(since);
    d.setDate(d.getDate() + i);
    const date = localDayKey(d);
    signupsByDay.push({ date, count: counts.get(date) ?? 0 });
  }

  return {
    traffic,
    env: {
      key: POSTHOG_ENV.key,
      project: POSTHOG_ENV.project,
      host: POSTHOG_ENV.host,
      defaultHost: POSTHOG_DEFAULT_HOST,
    },
    signupsByDay,
    signups30d: orgs.length,
    promoClicks: promos.map((p) => ({
      code: p.code,
      clicks: p.clicks,
      influencer: p.influencer.displayName,
    })),
    promoClicksTotal: promoTotal._sum.clicks ?? 0,
  };
}
