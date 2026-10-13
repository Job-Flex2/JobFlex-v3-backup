import { requirePlatformAdmin } from "@/lib/orgContext";
import { getSubscribersData } from "@/actions/subscribers";
import { AdminSubscribersContent } from "@/components/v3/admin-subscribers/admin-subscribers-content";
import { computeMetrics } from "@/components/v3/admin-subscribers/billing-metrics";
import { freeWasLabel } from "@/lib/freePlan";

export default async function AdminSubscribersPage() {
  await requirePlatformAdmin();
  const { rows, metrics, stripeEnabled, stripeLive, stripeError, truncated } =
    await getSubscribersData({ cards: true });

  // CANCELED SUBSCRIPTIONS ARE NOT SHOWN, for now (owner, 2026-09-05): the
  // record keeps them, this page lists neither the rows nor a count of them,
  // and the numerals above the table are counted over what is listed.
  // A company on the Free plan IS listed (owner, 2026-10-13; lib/freePlan):
  // its current subscription ended, so it reads "Free (was <plan>)" — never
  // in MRR or Paying (an ended row is neither).
  const visible = rows.filter((r) => r.status !== "CANCELED" || r.onFree);
  const shown = computeMetrics(visible, metrics.currency);

  return (
    <AdminSubscribersContent
      rows={visible.map((r) => ({
        ...r,
        ...(r.onFree ? { planName: freeWasLabel(r.planName), status: "FREE" } : {}),
        currentPeriodEnd: r.currentPeriodEnd?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
        changedAt: r.changedAt.toISOString(),
      }))}
      metrics={shown}
      stripeEnabled={stripeEnabled}
      stripeLive={stripeLive}
      stripeError={stripeError}
      truncated={truncated}
    />
  );
}
