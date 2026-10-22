// WHAT THE PAID APIS COST US, PER ORGANIZATION (2026-10-22) — server only
// (database).
//
// lib/trialMeter notePaidCall prices each billed call (lib/paidApiCosts) and
// tallies a request's calls; after the response it hands the tally here, and
// each (service, op) is added to the organization's ApiSpendDaily row for the
// UTC day — an upsert that increments `calls` and `cents`. One row per
// organization, day, service and op, never one per call, so the table grows
// with the days, not with the traffic. Every organization is written — trial,
// paying, Free, grant — except the QA organizations (lib/qaOrg), whose
// test runs are not anybody's cost. The trial meter's own record (SyncState
// `trialMeter:<orgId>`) is written beside this, unchanged, for the trial
// screens.
//
// Rows older than API_SPEND_KEEP_MONTHS are dropped by /api/cron/daily-cleanup.
// /admin/usage and the /admin/users account sheet read them.
import { db } from "@/lib/db";
import { isQaOrg } from "@/lib/qaOrg";
import type { PaidService } from "@/lib/paidApiCosts";

/** Rows older than this many months are dropped by /api/cron/daily-cleanup. */
export const API_SPEND_KEEP_MONTHS = 13;

export type ApiSpendEntry = { service: PaidService; op: string; calls: number; cents: number };

/** The UTC midnight of `at` — the `day` a row is filed under. */
export function utcDay(at: Date = new Date()): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

/** The first UTC day of `at`'s month, `offset` months on (-1 = last month). */
export function utcMonthStart(at: Date = new Date(), offset = 0): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + offset, 1));
}

/* Whether an organization is a QA one, remembered for ten minutes per
   instance: the map tiles record a call per tile, and the answer does not
   change between them. */
const qaSeen = new Map<string, { qa: boolean; at: number }>();
async function isQa(orgId: string): Promise<boolean> {
  const hit = qaSeen.get(orgId);
  if (hit && Date.now() - hit.at < 600_000) return hit.qa;
  const qa = await isQaOrg(orgId);
  if (qaSeen.size > 2000) qaSeen.clear();
  qaSeen.set(orgId, { qa, at: Date.now() });
  return qa;
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** Add a request's paid calls to the organization's day. Never throws. */
export async function recordApiSpend(orgId: string, entries: ApiSpendEntry[], at: Date = new Date()): Promise<void> {
  try {
    if (!entries.length || (await isQa(orgId))) return;
    const day = utcDay(at);
    for (const e of entries) {
      const cents = round4(e.cents);
      const where = { organizationId_day_service_op: { organizationId: orgId, day, service: e.service, op: e.op } };
      const add = { calls: { increment: e.calls }, cents: { increment: cents } };
      try {
        await db.apiSpendDaily.upsert({
          where,
          create: { organizationId: orgId, day, service: e.service, op: e.op, calls: e.calls, cents },
          update: add,
        });
      } catch {
        // Two requests created the day's row at once — the loser adds to it.
        await db.apiSpendDaily.update({ where, data: add });
      }
    }
  } catch (err) {
    console.warn(`[api-spend] spend for ${orgId} not written:`, err instanceof Error ? err.message : err);
  }
}

/** Cents the organization's paid calls cost since `since` (this month by
 *  default); null while the table is not in this database. */
export async function orgApiSpendCents(orgId: string, since: Date = utcMonthStart()): Promise<number | null> {
  try {
    const r = await db.apiSpendDaily.aggregate({ where: { organizationId: orgId, day: { gte: since } }, _sum: { cents: true } });
    return r._sum.cents ?? 0;
  } catch {
    return null;
  }
}
