// "THE COMPANY NAME IS NOT SET YET" (2026-10-10). The passwordless sign-up
// asks for a name and an email only, so the organization is created under the
// person's own name and marked here — a SyncState row, no schema change —
// until the owner names the business: on the company page, in the dashboard
// banner, or in the one-field prompt before the first send to a client
// (components/company-name/company-name-gate). Saving any name clears it.
import { db } from "@/lib/db";

export const orgNameUnsetKey = (orgId: string) => `orgNameUnset:${orgId}`;

/** True while the organization still carries the stand-in name. Never throws:
 *  a failed read answers false (no prompt is better than a blocked send). */
export async function isOrgNameUnset(orgId: string): Promise<boolean> {
  try {
    return Boolean(await db.syncState.findUnique({ where: { key: orgNameUnsetKey(orgId) }, select: { key: true } }));
  } catch {
    return false;
  }
}

/** The business has a name now. */
export async function clearOrgNameUnset(orgId: string): Promise<void> {
  await db.syncState.deleteMany({ where: { key: orgNameUnsetKey(orgId) } }).catch(() => {});
}

/** Where the name is typed: the company page's name field. */
export const COMPANY_NAME_HREF = "/dashboard/company#company-name";
