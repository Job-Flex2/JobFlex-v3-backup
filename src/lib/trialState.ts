// WHERE A CARD-LESS TRIAL STANDS (owner, 2026-10-01).
//
// The trial that starts without a card (lib/cardlessTrial) is an ordinary
// Stripe subscription in `trialing`, with no payment method and
// trial_settings.end_behavior.missing_payment_method = "cancel". This module
// reads it back for the app: how many days are left, whether a card is on
// file, and — once the trial is over with no card — TRIAL_ENDED, in which the
// workspace reads but nothing writes (lib/trialLock) until a card restarts
// the same plan.
//
// THE RECORD. What Stripe knows is mirrored on the Subscription row (status,
// trialEndsAt, the plan and its price). What only this flow knows — that the
// trial is card-less, the plan and pages it was started on, when a card
// arrived, which reminder emails went out — is one SyncState row per
// organization, `cardlessTrial:<orgId>`, the app's key→string store (no
// schema change).
//
// Database only — no Stripe client — so the write guard in lib/orgContext
// can ask it on every server action without loading the SDK.
import { db } from "@/lib/db";
import { SubscriptionStatus } from "@/lib/prismaEnums";

export type CardlessRecord = {
  subId: string;
  customerId: string;
  /** The plan picked at SIGNUP: a catalog slug, or "custom". The plan the
   *  trial is on now is the subscription's (lib/trialPlan); these three are
   *  only its fallback and are never updated. */
  planSlug: string;
  interval: "MONTH" | "YEAR";
  customPages: string[];
  mode: "live" | "test";
  trialDays?: number;
  startedAt: string;
  endsAt: string;
  /** Set when a card was attached during the trial (it converts on its own). */
  cardAt?: string | null;
  /** Set when the trial ended without one (webhook or the daily sweep). */
  endedAt?: string | null;
  /** Set when a card restarted the plan after the end. */
  restartedAt?: string | null;
  /** The reminder emails, once each. */
  mailedSoonAt?: string | null;
  mailedTodayAt?: string | null;
  mailedEndedAt?: string | null;
};

export const cardlessKey = (orgId: string) => `cardlessTrial:${orgId}`;

export async function readCardlessRecord(orgId: string): Promise<CardlessRecord | null> {
  const row = await db.syncState.findUnique({ where: { key: cardlessKey(orgId) } }).catch(() => null);
  if (!row) return null;
  try {
    const rec = JSON.parse(row.cursor) as CardlessRecord;
    return rec?.subId ? rec : null;
  } catch {
    return null;
  }
}

export async function writeCardlessRecord(orgId: string, rec: CardlessRecord): Promise<void> {
  const cursor = JSON.stringify(rec);
  await db.syncState.upsert({ where: { key: cardlessKey(orgId) }, update: { cursor }, create: { key: cardlessKey(orgId), cursor } });
}

export async function patchCardlessRecord(orgId: string, patch: Partial<CardlessRecord>): Promise<CardlessRecord | null> {
  const rec = await readCardlessRecord(orgId);
  if (!rec) return null;
  const next = { ...rec, ...patch };
  await writeCardlessRecord(orgId, next);
  return next;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export type CardlessTrialState =
  | {
      kind: "trialing";
      endsAt: Date;
      daysLeft: number;
      hasCard: boolean;
      /** The owner cancelled: the trial ends on the Free plan (lib/freePlan),
       *  not in the trial lock — no "add a card" reminders on the way. */
      toFree: boolean;
      record: CardlessRecord;
    }
  | { kind: "ended"; endedAt: Date; record: CardlessRecord };

// The ribbon's steps over this state (the 2-day boundary, the dismissal
// cookie) live in lib/trialNotice, which has no imports: the client ribbon
// reads them too, and this module reaches the database.
export { TRIAL_NOTICE_DAYS } from "@/lib/trialNotice";

/**
 * Null for every organization that is not on (or past) a card-less trial —
 * a paid signup, a converted trial, a comp, a free account. Ended when the
 * mirror says TRIAL_ENDED, or when the trial's end has passed with no card
 * on file and the webhook has not landed yet: the lock does not wait for it.
 * A trial the owner cancelled is past by then — it ends on the Free plan.
 */
export async function cardlessTrialState(orgId: string, now = new Date()): Promise<CardlessTrialState | null> {
  const rec = await readCardlessRecord(orgId);
  if (!rec || rec.restartedAt) return null;
  const sub = await db.subscription.findUnique({
    where: { organizationId: orgId },
    select: { status: true, trialEndsAt: true, externalSubId: true, canceledAt: true },
  });
  if (!sub || sub.externalSubId !== rec.subId) return null;
  const endsAt = sub.trialEndsAt ?? new Date(rec.endsAt);
  if (sub.status === SubscriptionStatus.TRIAL_ENDED) {
    return { kind: "ended", endedAt: rec.endedAt ? new Date(rec.endedAt) : endsAt, record: rec };
  }
  if (sub.status !== SubscriptionStatus.TRIALING) return null;
  const hasCard = Boolean(rec.cardAt);
  // Cancelled during the trial: its end is the move to Free, never the lock.
  const toFree = Boolean(sub.canceledAt);
  if (!hasCard && endsAt.getTime() <= now.getTime()) {
    return toFree ? null : { kind: "ended", endedAt: endsAt, record: rec };
  }
  // Whole days, rounded up — the first day reads "7 days left" — except the
  // last 24 hours, which read as the day it ends (daysLeft 0, "Ends today").
  const leftMs = endsAt.getTime() - now.getTime();
  const daysLeft = leftMs <= DAY_MS ? 0 : Math.ceil(leftMs / DAY_MS);
  return { kind: "trialing", endsAt, daysLeft, hasCard, toFree, record: rec };
}

/** The same rule for a route handler (a POST that writes for the
 *  organization): a 403 with the lock's own text, or null to go on. Route
 *  handlers are not server actions, so requireOrg cannot note them. */
export async function trialEndedResponse(orgId: string): Promise<Response | null> {
  if (!(await isTrialWriteLocked(orgId))) return null;
  const { TRIAL_ENDED_MESSAGE } = await import("@/lib/trialLock");
  return Response.json({ ok: false, error: TRIAL_ENDED_MESSAGE, trialEnded: true }, { status: 403 });
}

/** Never, since 2026-10-14 (owner): a card-less trial that ran out with no
 *  card is on the Free plan (lib/freePlan) — it reads and writes within the
 *  "free" catalog row's limits, and lib/planStatus closes everything paid,
 *  exactly as for a cancelled company. The write lock (lib/trialLock) and its
 *  callers stay wired; this answer keeps it open. */
export async function isTrialWriteLocked(orgId: string): Promise<boolean> {
  void orgId;
  return false;
}
