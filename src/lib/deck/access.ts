import "server-only";
// WHO MAY USE THE DECK ESTIMATOR (2026-10-04). Owner: "Deck Estimator should
// be the name and mark it coming soon, but let it be available to work and
// test for admin." Every account sees the sidebar row with its Coming soon
// mark and a coming-soon page at the URL; a platform admin (the flag on the
// user, or the admin console's own sign-in) and the owner's early-access
// account get the working estimator. The page and both server actions ask
// this one function.
import { db } from "@/lib/db";
import { readAdminCookie } from "@/lib/adminAuth";
import { canSeeEarlyAccess } from "@/lib/earlyAccess";
import { editionFacts } from "@/lib/editionAccess";
import { editionLevel, type EditionLevel } from "@/lib/editions";

/**
 * HOW FAR THE STUDIO OPENS TO THIS USER (owner, 2026-10-19): "full" — the organization holds the Deck Studio (its
 * plan, a plan naming it, the add-on, the free trial — lib/editions) or the user is an admin; "preview" — its plan
 * runs without it: the studio designs, and every save, send and print asks for the add-on; "none" — the plan has
 * ended. The design-time actions ask for "preview" or better, every save for "full".
 */
export async function deckStudioAccess(user: { id: string; email?: string | null }, organizationId?: string | null): Promise<EditionLevel> {
  let level: EditionLevel = "none";
  if (organizationId) {
    try {
      level = editionLevel(await editionFacts(organizationId), "deck");
      if (level === "full") return "full";
    } catch {
      /* the plan could not be read: the admin checks below still answer */
    }
  }
  return (await adminOpens(user)) ? "full" : level;
}

/** The whole studio — saving, sending and printing included (deckStudioAccess "full"). */
export async function canUseDeckEstimator(user: { id: string; email?: string | null }, organizationId?: string | null): Promise<boolean> {
  return (await deckStudioAccess(user, organizationId)) === "full";
}

/** The studio to design in: the whole of it, or its preview. */
export async function canDesignDeck(user: { id: string; email?: string | null }, organizationId?: string | null): Promise<boolean> {
  return (await deckStudioAccess(user, organizationId)) !== "none";
}

async function adminOpens(user: { id: string; email?: string | null }): Promise<boolean> {
  if (canSeeEarlyAccess(user.email)) return true;
  try {
    const row = await db.user.findUnique({ where: { id: user.id }, select: { isPlatformAdmin: true } });
    if (row?.isPlatformAdmin) return true;
  } catch {
    /* fall through to the admin cookie */
  }
  try {
    return !!(await readAdminCookie());
  } catch {
    return false;
  }
}
