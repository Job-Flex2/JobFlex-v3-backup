// A PLATFORM ADMIN SEES EVERYTHING IN THEIR ORGANIZATION (owner, 2026-10-17).
//
// A user who carries isPlatformAdmin and holds a seat — any role — in an
// organization has the whole dashboard there, whatever the subscription says
// (FREE, CANCELED, TRIAL_ENDED, a trial or a grant run out), whatever the
// plan's limits and whatever the seat's role. Everyone else is untouched: the
// plan, its status and the role decide as before.
//
// ONE QUESTION, EVERY DOOR. hasFullAccess is the only place the rule lives;
// every access check asks it and none keeps an exception of its own:
//   · the add-on pages      — lib/customPageAccess (readPageAccess);
//   · the feature tier      — lib/orgPlan, lib/planCatalogServer (getOrgPlanContext);
//   · the plan's limits     — lib/limitsEngine (resolvePlan);
//   · the paid services     — lib/paidCaps (planOpen, planEnded);
//   · the role route gates  — lib/orgContext (resolveOrg), the JWT role the
//                             middleware reads (lib/auth), the (dashboard)
//                             layout — through accessRole below.
// Money ceilings that protect JobFlex's own spend (PAID_CAPS, the card-less
// trial's ceilings) and the owner-only billing guard (requireOwner) are not
// access to a feature and stay as they are.
//
// WHO IS ASKING. With no user passed, the session is read, so no caller has to
// thread one through. Outside a request — a cron, a webhook, a public form —
// there is no session and the organization's own plan decides. `null` asks as
// nobody (the QA harness, a caller that must not count as anyone).
import { cache } from "react";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { fullAccessFor } from "@/lib/fullAccessRule";

export { accessRole, fullAccessFor } from "@/lib/fullAccessRule";

/** The session's user id, or null outside a request or for a partner session. */
export async function sessionUserId(): Promise<string | null> {
  try {
    const u = (await auth())?.user;
    if (!u?.id || u.principal === "INFLUENCER") return null;
    return u.id;
  } catch {
    // No request scope (cron, script, build): nobody is asking.
    return null;
  }
}

const readFullAccess = cache(async (organizationId: string, userId: string): Promise<boolean> => {
  const user = await db.user
    .findUnique({
      where: { id: userId },
      select: { isPlatformAdmin: true, memberships: { where: { organizationId }, select: { id: true }, take: 1 } },
    })
    .catch(() => null);
  return fullAccessFor(user, user?.memberships[0]);
});

/**
 * Everything in this organization is open to this user. `userId` undefined =
 * the session's user; null = nobody. Deduplicated within a server render.
 */
export async function hasFullAccess(organizationId: string | null | undefined, userId?: string | null): Promise<boolean> {
  if (!organizationId) return false;
  const uid = userId === undefined ? await sessionUserId() : userId;
  if (!uid) return false;
  return readFullAccess(organizationId, uid);
}
