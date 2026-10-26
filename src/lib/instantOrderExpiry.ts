// AN EAGLEVIEW ORDER THAT NEVER ARRIVED (owner, 2026-10-26, ticket 8KETUL).
//
// EagleView answers a Property Data order in seconds. One still `pending` in
// the ledger PENDING_EXPIRE_MS after it was placed is not coming: it is closed
// as failed — with the reason on the row — and taken back off the spend count
// it was put on when EagleView accepted it (lib/trialMeter notePaidCall at the
// order, refundPaidCall here). Nothing is ordered or asked of EagleView.
//
// Run for one company before its roof orders are read (actions/roofMeasurement)
// and for everyone by /api/cron/daily-cleanup. The close is a conditional
// update, so two sweeps at once refund an order once.
import { db } from "@/lib/db";
import { PENDING_EXPIRE_MS, rowPacks } from "@/lib/eagleviewOrder";
import { refundPaidCall } from "@/lib/trialMeter";

/** The error a closed order carries — also how a later click knows its area order was closed, not refused. */
export const EXPIRED_ORDER_ERROR = `Not delivered in ${Math.round(PENDING_EXPIRE_MS / 60_000)} min — closed and taken off the spend count`;

/** Close every order older than the limit (one company's, or all); returns how many were closed. */
export async function expireStaleInstantOrders(scope: { organizationId?: string } = {}, now = Date.now()): Promise<number> {
  const stale = await db.instantOrder.findMany({
    where: { status: "pending", createdAt: { lt: new Date(now - PENDING_EXPIRE_MS) }, ...(scope.organizationId ? { organizationId: scope.organizationId } : {}) },
    select: { id: true, organizationId: true, packs: true, createdAt: true },
    take: 500,
  });
  let closed = 0;
  for (const o of stale) {
    const done = await db.instantOrder.updateMany({
      where: { id: o.id, status: "pending" },
      data: { status: "failed", error: `${EXPIRED_ORDER_ERROR} (${new Date(now).toISOString()})` },
    });
    if (done.count !== 1) continue;
    closed += 1;
    await refundPaidCall(o.organizationId, "eagleview", "pack", { units: rowPacks(o.packs).length, at: o.createdAt });
  }
  if (closed) console.warn(`[instantOrderExpiry] closed ${closed} order(s) pending over ${Math.round(PENDING_EXPIRE_MS / 60_000)} min`);
  return closed;
}
