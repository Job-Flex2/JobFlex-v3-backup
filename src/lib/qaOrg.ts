// QA ORGANISATIONS (moved out of lib/qaTestMode, 2026-10-22, unchanged): the
// organisations of QA Lab accounts, left out of the statistics and analytics
// (lib/statsHidden) and of the API spend (lib/apiSpend). Not "server-only" —
// lib/apiSpend sits under lib/trialMeter, which client graphs reach through
// lib/externalCall — but it reads the database, so it runs on the server only.
import { db } from "@/lib/db";
import { QA_EMAIL_DOMAIN } from "@/lib/qaEmail";

/** Organisations of QA accounts: their billing address, or any member's address, is a QA one. */
export async function qaOrgIds(): Promise<string[]> {
  try {
    const rows = await db.organization.findMany({
      where: {
        OR: [
          { billingEmail: { endsWith: QA_EMAIL_DOMAIN } },
          { memberships: { some: { user: { email: { endsWith: QA_EMAIL_DOMAIN } } } } },
        ],
      },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  } catch {
    return [];
  }
}

/** One organisation, for the analytics senders that know only its id. */
export async function isQaOrg(organizationId: string | null | undefined): Promise<boolean> {
  if (!organizationId) return false;
  try {
    const hit = await db.organization.findFirst({
      where: {
        id: organizationId,
        OR: [
          { billingEmail: { endsWith: QA_EMAIL_DOMAIN } },
          { memberships: { some: { user: { email: { endsWith: QA_EMAIL_DOMAIN } } } } },
        ],
      },
      select: { id: true },
    });
    return !!hit;
  } catch {
    return false;
  }
}
