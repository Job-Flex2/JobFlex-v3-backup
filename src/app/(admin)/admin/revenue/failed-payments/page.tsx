// Admin · Revenue · Failed payments (owner, 2026-10-21) — why plan charges
// fail and how many come back: the last 90 days of PaymentFailure rows
// (lib/paymentFailures — the Stripe webhook and the backfill write them), cut
// by period on the page. Its own page under Revenue, not a tab inside it: the
// Revenue overview reads Stripe live and can take minutes, this reads only the
// database. Read-only.

import type { Metadata } from "next";
import { requirePlatformAdmin } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { getStripeMode } from "@/lib/stripeMode";
import { cardFunding, failureCode } from "@/lib/paymentFailureShared";
import { AdminFailedPaymentsContent, type FailureRowDTO } from "@/components/v3/admin-failed-payments/failed-payments-content";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "JobFlex Admin · Failed payments",
  description: "Why plan charges fail, and how many are won back.",
};

const WINDOW_DAYS = 90;
const MAX_ROWS = 5000;

/** The moment of the read and the window's start (the periods on the page count back from the same moment). */
function readWindow(): { asOf: number; since: Date } {
  const asOf = Date.now();
  return { asOf, since: new Date(asOf - WINDOW_DAYS * 86_400_000) };
}

export default async function AdminFailedPaymentsPage() {
  await requirePlatformAdmin();
  const { asOf, since } = readWindow();
  const [rows, mode] = await Promise.all([
    db.paymentFailure
      .findMany({
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
        take: MAX_ROWS,
        include: { organization: { select: { name: true } } },
      })
      // The table is not in this database yet (prisma/sql/prod-2026-10-21-payment-failures.sql).
      .catch(() => null),
    getStripeMode().catch(() => "live" as const),
  ]);
  const dto: FailureRowDTO[] | null = rows
    ? rows.map((r) => ({
        id: r.id,
        at: r.createdAt.toISOString(),
        orgId: r.organizationId,
        orgName: r.organization?.name ?? "Deleted company",
        invoiceId: r.stripeInvoiceId,
        attempt: r.attempt,
        amountCents: r.amountCents,
        currency: r.currency,
        code: failureCode(r),
        errorCode: r.errorCode,
        message: r.errorMessage,
        cardBrand: r.cardBrand,
        cardFunding: cardFunding(r.cardFunding),
        cardLast4: r.cardLast4,
        isTrialEnd: r.isTrialEnd,
        ignored: r.ignored,
        recoveredAt: r.recoveredAt?.toISOString() ?? null,
      }))
    : null;
  return <AdminFailedPaymentsContent rows={dto} asOf={asOf} truncated={(rows?.length ?? 0) >= MAX_ROWS} stripeTest={mode === "test"} />;
}
