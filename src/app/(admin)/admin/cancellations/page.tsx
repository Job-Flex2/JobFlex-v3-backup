// Admin · Cancellations (owner, 2026-10-20) — every cancellation booked from
// Settings → Billing, newest first, with the reasons the owner ticked on
// "Cancel <plan>?" (lib/cancelFeedback) and the words under Other. A plain
// table with a filter by reason; read-only.

import type { Metadata } from "next";
import { requirePlatformAdmin } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { getPlanNamesBySlug } from "@/lib/planCatalogServer";
import { planDisplayName } from "@/lib/planCatalog";
import { parseReasons } from "@/lib/cancelFeedback";
import { AdminCancellationsContent, type CancellationDTO } from "@/components/v3/admin-cancellations/cancellations-content";
import { readCameBack } from "@/lib/cameBackRead";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "JobFlex Admin · Cancellations",
  description: "Why companies cancelled their plan.",
};

/** How many were booked in the last `days` days. */
function bookedWithin(rows: { createdAt: Date }[], days: number): number {
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  return rows.filter((r) => r.createdAt.getTime() >= since).length;
}

export default async function AdminCancellationsPage() {
  await requirePlatformAdmin();
  // Who came back (2026-10-28): card-less trials that ran out and later paid, cancellations whose company pays
  // again — read beside the rows; a failed read leaves the card out, never the table.
  const cameBackP = readCameBack().catch(() => null);
  const [rows, names] = await Promise.all([
    db.cancellationFeedback
      .findMany({
        orderBy: { createdAt: "desc" },
        take: 500,
        include: { organization: { select: { name: true } }, user: { select: { email: true } } },
      })
      // The table is not in this database yet (prisma/sql/prod-2026-10-20-…).
      .catch(() => null),
    getPlanNamesBySlug().catch(() => ({})),
  ]);
  const dto: CancellationDTO[] | null = rows
    ? rows.map((r) => ({
        id: r.id,
        orgName: r.organization.name,
        email: r.user?.email ?? "—",
        planName: planDisplayName(r.plan, names),
        reasons: parseReasons(r.reasons),
        otherText: r.otherText,
        periodEnd: r.periodEnd?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      }))
    : null;
  const cameBack = await cameBackP;
  return <AdminCancellationsContent rows={dto} last30={rows ? bookedWithin(rows, 30) : 0} cameBack={cameBack} />;
}
