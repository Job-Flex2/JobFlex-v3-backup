// PAID OUTSIDE SERVICES: THE CEILINGS AND THE PLAN THEY NEED (2026-10-12,
// money audit P0-7 / P0-8 / P1-8) — server only.
//
// Every call here spends JobFlex's money with someone else — EagleView,
// Cool Calc, Twilio, ReportAll, OpenAI — so it is counted per COMPANY on the
// shared limiter (lib/rateLimit enforceRateLimit: in memory, then the
// cross-instance row) and, where the owner said so, needs a plan that is
// still open. The card-less trial's own ceilings (lib/trialMeter
// takeTrialCap) stay where they are; these sit beside them for everyone.
//
// A refusal is a RESULT a person can read — { ok: false, error } — never an
// exception: a thrown message is redacted in production.

import { DAY, HOUR, RateLimitError, enforceRateLimit, retryInWords } from "@/lib/rateLimit";
import { planLapsed } from "@/lib/planStatus";
import { readAccessSubscription } from "@/lib/subscriptionAccess";
import { hasFullAccess } from "@/lib/fullAccess";

export type PaidRefusal = { ok: false; error: string; capped: true };

interface PaidCap {
  /** The limiter key's prefix; the company id follows. */
  key: string;
  max: number;
  windowMs: number;
  /** What the person reads, given "in N minutes". */
  says: (wait: string) => string;
}

export const PAID_CAPS = {
  /** A roof the company has not measured yet: an EagleView order. Reopening a measured roof is not counted. */
  roofNew: {
    key: "paid:roof-new",
    max: 30,
    windowMs: DAY,
    says: (wait: string) => `Your company has ordered 30 new roof measurements today — that is the daily limit. Roofs you already measured still open as before; new ones can be ordered again in ${wait}.`,
  },
  /** "Measure again" on a roof already measured: a fresh paid order. */
  roofReorder: {
    key: "paid:roof-reorder",
    max: 5,
    windowMs: DAY,
    says: (wait: string) => `Your company has re-measured 5 roofs today — that is the daily limit for a fresh order. The saved measurement still opens; a new one can be ordered in ${wait}.`,
  },
  /** A Cool Calc project + system: a report credit. The hour's key is the one the action always used. */
  hvacReportHour: {
    key: "coolcalc",
    max: 20,
    windowMs: HOUR,
    says: (wait: string) => `Your company has requested 20 Cool Calc reports this hour — that is the limit. Try again in ${wait}.`,
  },
  hvacReportDay: {
    key: "paid:coolcalc-day",
    max: 30,
    windowMs: DAY,
    says: (wait: string) => `Your company has requested 30 Cool Calc reports today — that is the daily limit. Reports can be requested again in ${wait}.`,
  },
} satisfies Record<string, PaidCap>;

export type PaidCapKind = keyof typeof PAID_CAPS;

/** Count one paid call for this company; a refusal says when it opens again. */
export async function takePaidCap(kind: PaidCapKind, organizationId: string): Promise<{ ok: true } | PaidRefusal> {
  const cap: PaidCap = PAID_CAPS[kind];
  try {
    await enforceRateLimit(`${cap.key}:${organizationId}`, cap.max, cap.windowMs);
    return { ok: true };
  } catch (err) {
    if (err instanceof RateLimitError) return { ok: false, capped: true, error: cap.says(retryInWords(err.retryAfterMs)) };
    throw err;
  }
}

/** A roof order about to be placed: "measure again" has its own 5 a day, and
 *  every order counts toward the 30 a day. The tighter one is asked first,
 *  so a refused re-measure does not use up a new measurement. */
export async function takeRoofOrderCap(organizationId: string, forceNewOrder: boolean): Promise<{ ok: true } | PaidRefusal> {
  if (forceNewOrder) {
    const again = await takePaidCap("roofReorder", organizationId);
    if (!again.ok) return again;
  }
  return takePaidCap("roofNew", organizationId);
}

/** A Cool Calc report about to be created: 20 an hour and 30 a day. */
export async function takeHvacReportCap(organizationId: string): Promise<{ ok: true } | PaidRefusal> {
  const day = await takePaidCap("hvacReportDay", organizationId);
  if (!day.ok) return day;
  return takePaidCap("hvacReportHour", organizationId);
}

// ── the plan ───────────────────────────────────────────────────────────────
//
// Two questions, both on the one rule of lib/planStatus over the effective
// row (lib/subscriptionAccess — a grant's terms, a stale Stripe row checked):
//   · planEnded   — the plan was cancelled, unpaid, expired or its trial ran
//                   out, or the company is on the Free plan (lib/planStatus,
//                   2026-10-14). A company with no plan has nothing to end.
//   · planOpen    — the company HOLDS a plan that is still open: a
//                   subscription that is not FREE and not ended. What the
//                   owner asked for before a text code or a parcel tile.
// A platform admin in the company (lib/fullAccess hasFullAccess, asked as the
// session's user when no user is passed) finds the plan open and not ended,
// whatever the row says. A cron or a webhook has no session: the company decides.

export const PLAN_NEEDED_MESSAGE = "This needs an active plan. Choose a plan on Subscription to turn it on.";

export async function planEnded(organizationId: string, userId?: string | null): Promise<boolean> {
  if (await hasFullAccess(organizationId, userId)) return false;
  return planLapsed(await readAccessSubscription(organizationId));
}

export async function planOpen(organizationId: string, userId?: string | null): Promise<boolean> {
  if (await hasFullAccess(organizationId, userId)) return true;
  const sub = await readAccessSubscription(organizationId);
  return !!sub && sub.status !== "FREE" && !planLapsed(sub);
}

/** For a paid action: the refusal when the company's plan has ended, else null. */
export async function planEndedRefusal(organizationId: string, what: string): Promise<{ ok: false; error: string; planEnded: true } | null> {
  if (!(await planEnded(organizationId))) return null;
  return { ok: false, planEnded: true, error: `Your plan has ended, so ${what} is closed. Choose a plan on Subscription to open it again.` };
}

/** Whether a text may still leave the company's own number: not after its
 *  plan ended. The dispatcher runs in crons and webhooks too, with no session,
 *  so there it is the company's plan that answers; a text a platform admin
 *  sends from the dashboard of their company is sent. */
export async function orgMayText(organizationId: string): Promise<boolean> {
  return !(await planEnded(organizationId));
}
