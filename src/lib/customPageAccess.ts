// THE CUSTOM PLAN'S PAGE GATE — the server half.
//
// A custom-plan org paid for the base workspace plus the add-on pages it
// picked (lib/customPlan). The selection lives in SyncState
// `orgPages:<orgId>` and is the source of truth: Stripe's page quantity and
// metadata follow it (lib/customBilling), never the other way round.
//
// THREE DOORS, ONE ANSWER (owner, 2026-10-06 — the audit found the layouts
// were the only door that asked):
//   · the layouts (src/app/dashboard/layout.tsx, src/app/(dashboard)/layout.tsx,
//     src/app/(mobile)/layout.tsx) draw the offer at a blocked URL and hand
//     the list to the nav (getBlockedCustomPages — courtesy, fail-open once);
//   · every page server component of an add-on calls customPageGate
//     (components/v3/upgrade-gate/custom-page-gate) BEFORE it loads anything,
//     so a client-side navigation, which skips the layout, still loads no data;
//   · every server action and API route of an add-on calls requirePage — the
//     boundary. It fails CLOSED: an unreadable plan is a refusal.
// The middleware takes no part: it is edge-runtime and cannot read the DB.
//
// A LAPSED PLAN CLOSES EVERY ADD-ON (owner, 2026-10-07), whatever the plan:
// a cancelled Professional shop no longer opens the roof estimator. The rule
// is lib/planStatus — the one the limits engine and the feature tier read;
// PAST_DUE keeps the pages while Stripe retries the card.
//
// A PLATFORM ADMIN IN THE ORGANIZATION OPENS EVERY PAGE (owner, 2026-10-17),
// whatever the plan and its status — lib/fullAccess hasFullAccess, asked as
// the session's user. With no session (a cron) the organization decides.

import { db } from "@/lib/db";
import {
  CUSTOM_DECK_PAGE,
  CUSTOM_PAGES,
  PLAN_ENDED_MARK,
  blockedCustomHrefs,
  normalizeCustomPages,
  type CustomPageId,
} from "@/lib/customPlan";
import { planLapsed } from "@/lib/planStatus";
import { readAccessSubscription } from "@/lib/subscriptionAccess";
import { hasFullAccess } from "@/lib/fullAccess";

/** The error an add-on's server code throws for an org that did not buy it. */
export class CustomPageLockedError extends Error {
  readonly code = "CUSTOM_PAGE_LOCKED";
  constructor(
    readonly page: CustomPageId,
    /** "ended": the plan lapsed (lib/planStatus), not a page left unbought. */
    readonly reason: "not-included" | "ended" = "not-included",
  ) {
    const label = CUSTOM_PAGES.find((p) => p.id === page)?.label ?? "This page";
    super(
      reason === "ended"
        ? `Your plan has ended, so ${label} is closed. Choose a plan on Subscription to open it again.`
        : `${label} isn't in your plan.`,
    );
    this.name = "CustomPageLockedError";
  }
}

export function isCustomPageLockedError(err: unknown): err is CustomPageLockedError {
  return err instanceof Error && (err as { code?: string }).code === "CUSTOM_PAGE_LOCKED";
}

/** The org's pages: null when the org is not on the custom plan, else the
 *  pages it holds; `lapsed` when its plan no longer opens anything. Throws
 *  when the plan cannot be read — callers that must fail closed (requirePage)
 *  let it propagate. */
async function readPageAccess(organizationId: string): Promise<{ lapsed: boolean; pages: string[] | null }> {
  if (await hasFullAccess(organizationId)) return { lapsed: false, pages: null };
  const sub = await readAccessSubscription(organizationId);
  if (planLapsed(sub)) return { lapsed: true, pages: [] };
  return { lapsed: false, pages: await readCustomPages(organizationId, sub?.plan ?? null) };
}

/** The organization is on the Custom plan and its bought pages include the Deck estimator — the Deck Studio
 *  add-on bought as a page (lib/editions). `plan` when the caller has read it already. */
export async function customDeckPageHeld(organizationId: string, plan?: string | null): Promise<boolean> {
  if (plan !== undefined && (plan ?? "").toUpperCase() !== "CUSTOM") return false;
  const pages = await readCustomPages(organizationId, plan).catch(() => null);
  return !!pages?.includes(CUSTOM_DECK_PAGE);
}

/** The pages a custom-plan org holds (null when the org is not on it). */
export async function readCustomPages(organizationId: string, knownPlan?: string | null): Promise<string[] | null> {
  const plan =
    knownPlan !== undefined
      ? knownPlan
      : (await db.subscription.findUnique({ where: { organizationId }, select: { plan: true } }))?.plan ?? null;
  if ((plan ?? "").toUpperCase() !== "CUSTOM") return null;
  const row = await db.syncState.findUnique({ where: { key: `orgPages:${organizationId}` } });
  if (!row) return [];
  try {
    return normalizeCustomPages(JSON.parse(row.cursor) as string[]);
  } catch {
    return [];
  }
}

/**
 * The hrefs this org may NOT open, or null when the org is not on the custom
 * plan — null, not [], so callers can tell "unrestricted" from "bought
 * everything" without a second read. For the layouts and the nav.
 *
 * One retry: dev SQLite throws transient "database is locked" under a
 * dashboard's burst of parallel reads. Two misses in a row read as
 * unrestricted HERE — a layout that bricks every org on a flaky DB is worse —
 * because the page gate and requirePage below fail closed behind it.
 */
export async function getBlockedCustomPages(
  organizationId: string | null | undefined,
): Promise<string[] | null> {
  if (!organizationId) return null;
  const access = await readPageAccess(organizationId).catch(() =>
    readPageAccess(organizationId).catch(() => null),
  );
  if (!access) return null;
  if (access.lapsed) return [...blockedCustomHrefs([]), PLAN_ENDED_MARK];
  return access.pages === null ? null : blockedCustomHrefs(access.pages);
}

/** Why `pages` are closed to the org, or null when one of them is open:
 *  "ended" — its plan lapsed; "not-included" — on the custom plan without
 *  them. Fails closed: an unreadable plan counts as not included (one retry). */
async function lockReason(
  organizationId: string,
  pages: CustomPageId | readonly CustomPageId[],
): Promise<"ended" | "not-included" | null> {
  const wanted = typeof pages === "string" ? [pages] : pages;
  let access: { lapsed: boolean; pages: string[] | null };
  try {
    access = await readPageAccess(organizationId).catch(() => readPageAccess(organizationId));
  } catch {
    return "not-included";
  }
  if (access.lapsed) return "ended";
  const owned = access.pages;
  if (owned === null) return null;
  return wanted.some((p) => owned.includes(p)) ? null : "not-included";
}

/** True when the org's plan has lapsed, or it is on the custom plan and holds
 *  NONE of `pages`. Fails closed: an unreadable plan counts as locked. */
export async function isPageLocked(
  organizationId: string,
  pages: CustomPageId | readonly CustomPageId[],
): Promise<boolean> {
  return (await lockReason(organizationId, pages)) !== null;
}

/**
 * THE SERVER BOUNDARY. Throws CustomPageLockedError when the org is on the
 * custom plan and holds none of `pages` (an array is "any of" — the HVAC
 * estimator reads the fence's lot lookup, the video estimator runs Smart
 * Proposal's engine). Every server action and API route of an add-on calls
 * this right after it resolves the org.
 */
export async function requirePage(
  organizationId: string,
  pages: CustomPageId | readonly CustomPageId[],
): Promise<void> {
  const reason = await lockReason(organizationId, pages);
  if (reason) throw new CustomPageLockedError(typeof pages === "string" ? pages : pages[0], reason);
}

/** For API routes: the 403 a locked add-on answers with, or null to go on. */
export async function pageLockedResponse(
  organizationId: string,
  pages: CustomPageId | readonly CustomPageId[],
): Promise<Response | null> {
  const reason = await lockReason(organizationId, pages);
  if (!reason) return null;
  const err = new CustomPageLockedError(typeof pages === "string" ? pages : pages[0], reason);
  return Response.json({ ok: false, error: err.message, code: err.code }, { status: 403 });
}
