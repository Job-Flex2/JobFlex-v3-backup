import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { isCronAuthorized } from "@/lib/cronAuth";
import { sweepPendingDaysEverywhere } from "@/lib/workDays";
import { EMAIL_LOG_KEEP_DAYS } from "@/lib/emailLog";
import { API_SPEND_KEEP_MONTHS, utcMonthStart } from "@/lib/apiSpend";
import { expireStaleInstantOrders } from "@/lib/instantOrderExpiry";

export const runtime = "nodejs";

// A worker token idle for this long is rotated (the old /w/<token> link dies).
const INACTIVE_MONTHS = 6;
// Price-cache rows not refreshed within this window are pruned.
const CACHE_TTL_DAYS = 90;

// Daily maintenance: (1) revoke tokens of long-inactive workers, (2) prune stale
// price-cache rows. Fail-closed cron auth, same as the other cron routes.
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── 1) Revoke tokens of workers inactive for > 6 months ───────────────────
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - INACTIVE_MONTHS);

  // ⛔ SAFETY: only rows with a REAL lastSeenAt older than the cutoff. `lt`
  // already excludes NULL (in SQL, NULL < date is unknown, never true), and
  // `not: null` states that guarantee explicitly. A worker with lastSeenAt =
  // NULL — never backfilled, or brand new — is NEVER revoked here.
  const stale = await db.workerProfile.findMany({
    where: { lastSeenAt: { not: null, lt: cutoff } },
    select: { id: true },
  });

  let revoked = 0;
  for (const w of stale) {
    // Same rotation as revokeWorker: a fresh token instantly kills the old link.
    await db.workerProfile.update({
      where: { id: w.id },
      data: { token: randomUUID() },
    });
    revoked += 1;
  }

  // ── 2) Prune stale price-cache rows ───────────────────────────────────────
  const cacheCutoff = new Date(Date.now() - CACHE_TTL_DAYS * 24 * 60 * 60 * 1000);
  const pruned = await db.productPriceCache.deleteMany({
    where: { updatedAt: { lt: cacheCutoff } },
  });

  // Unselected Meta Page tokens expire after 15 minutes; purge leftovers daily.
  const pendingMeta = await db.syncState.deleteMany({
    where: { key: { startsWith: "meta:pending:" }, updatedAt: { lt: new Date(Date.now() - 15 * 60_000) } },
  });

  // ── 3) Days on site left open past their date read PENDING (stage A) ──────
  const pendingDays = await sweepPendingDaysEverywhere();

  // ── 4) The mail log keeps 90 days (lib/emailLog) ──────────────────────────
  // Zero, not a failed cron, while the table is not in this database yet.
  const mailLog = await db.emailLog
    .deleteMany({ where: { createdAt: { lt: new Date(Date.now() - EMAIL_LOG_KEEP_DAYS * 24 * 60 * 60 * 1000) } } })
    .catch((err) => {
      console.warn("[cron/daily-cleanup] mail log not pruned:", err instanceof Error ? err.message : err);
      return { count: 0 };
    });

  // ── 5) The API spend keeps 13 months (lib/apiSpend) ───────────────────────
  // Zero, not a failed cron, while the table is not in this database yet.
  const apiSpend = await db.apiSpendDaily
    .deleteMany({ where: { day: { lt: utcMonthStart(new Date(), -API_SPEND_KEEP_MONTHS) } } })
    .catch((err) => {
      console.warn("[cron/daily-cleanup] API spend not pruned:", err instanceof Error ? err.message : err);
      return { count: 0 };
    });

  // ── 6) EagleView orders that never arrived (lib/instantOrderExpiry) ───────
  const expiredOrders = await expireStaleInstantOrders().catch((err) => {
    console.warn("[cron/daily-cleanup] stale roof orders not closed:", err instanceof Error ? err.message : err);
    return 0;
  });

  console.info(
    `[cron/daily-cleanup] revoked ${revoked} inactive worker token(s); pruned ${pruned.count} price-cache row(s); ${pendingDays} day(s) on site now pending; pruned ${mailLog.count} mail-log row(s); pruned ${apiSpend.count} API-spend row(s); closed ${expiredOrders} stale roof order(s).`,
  );
  return NextResponse.json({ ok: true, revokedWorkers: revoked, prunedCache: pruned.count, prunedMetaAuthorizations: pendingMeta.count, pendingDays, prunedMailLog: mailLog.count, prunedApiSpend: apiSpend.count, expiredRoofOrders: expiredOrders });
}
