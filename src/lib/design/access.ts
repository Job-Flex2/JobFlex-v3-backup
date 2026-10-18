import "server-only";
// WHO MAY USE THE HOME DESIGN STUDIO (owner, 2026-10-17: "for now it would be only in admin — I will be working there
// and test it. Not for the users"). A platform admin (the flag on the user, or the admin console's own sign-in) and the
// owner's early-access account. No plan or edition opens it yet; the page and every server action ask this one function.
import { db } from "@/lib/db";
import { readAdminCookie } from "@/lib/adminAuth";
import { canSeeEarlyAccess } from "@/lib/earlyAccess";

export async function canUseDesignStudio(user: { id: string; email?: string | null }): Promise<boolean> {
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
