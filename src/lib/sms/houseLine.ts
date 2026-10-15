// JOBFLEX'S OWN COMPANY TEXTS FROM JOBFLEX'S OWN LINE (owner, 2026-10-14: "the
// account I am is the admin account — we are testing here") — server only.
//
// Every other company texts only from a number registered in its name
// (registration.ts); the JobFlex number is registered to JobFlex, so a text
// signed "Ridgeline Roofing" from it would be the ISV problem the carriers
// reject. JobFlex's own company is the one exception: it IS the registered
// business. It is recognised, not configured — the company a platform admin
// owns or administers, to which JobFlex's own line is lent on /admin/health
// (the same index that routes its calls). Both must hold.

import { db } from "@/lib/db";
import { numbersAssignedTo } from "@/lib/aiDesk/numbers";
import { jobflexSender } from "./jobflexSender";

/** The JobFlex line this company may text from (E.164), or null for every company that is not JobFlex's own. */
export async function houseLineFor(organizationId: string): Promise<string | null> {
  const sender = await jobflexSender().catch(() => null);
  if (!sender) return null;
  const lent = await numbersAssignedTo(organizationId).catch(() => [] as string[]);
  if (!lent.includes(sender)) return null;
  const admin = await db.membership
    .findFirst({ where: { organizationId, role: { in: ["OWNER", "ADMIN"] }, user: { isPlatformAdmin: true } }, select: { id: true } })
    .catch(() => null);
  return admin ? sender : null;
}
