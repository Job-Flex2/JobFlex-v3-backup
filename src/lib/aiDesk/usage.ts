// THE DESK'S MINUTES — server only. One SyncState row a month per company
// (`deskuse:<orgId>:<YYYY-MM>`, lib/aiDesk/shared DeskUse): the live desk's calls add
// to it when they end (liveCall finishCall), a browser test when it hangs up
// (actions/aiDesk endDeskTest). The settings card and the Phone page read it; the
// plan's included minutes and the packs (step 5) are counted against it.
import { db } from "@/lib/db";
import { EMPTY_USE, monthKey, parseDeskUse, type DeskUse } from "./shared";

const rowKey = (organizationId: string, month: string) => `deskuse:${organizationId}:${month}`;

export async function readDeskUse(organizationId: string, at: Date = new Date()): Promise<DeskUse> {
  const row = await db.syncState.findUnique({ where: { key: rowKey(organizationId, monthKey(at)) }, select: { cursor: true } }).catch(() => null);
  return row ? parseDeskUse(row.cursor) : { ...EMPTY_USE };
}

/** Add to this month's row. Two calls ending in the same instant can lose one's seconds to the other — a figure, not a ledger. */
export async function noteDeskUse(organizationId: string, add: Partial<DeskUse>, at: Date = new Date()): Promise<DeskUse> {
  const key = rowKey(organizationId, monthKey(at));
  const current = await readDeskUse(organizationId, at);
  const next: DeskUse = {
    ...current,
    callSeconds: current.callSeconds + Math.max(0, Math.round(add.callSeconds ?? 0)),
    calls: current.calls + Math.max(0, Math.round(add.calls ?? 0)),
    testSeconds: current.testSeconds + Math.max(0, Math.round(add.testSeconds ?? 0)),
    tests: current.tests + Math.max(0, Math.round(add.tests ?? 0)),
  };
  const cursor = JSON.stringify(next);
  await db.syncState.upsert({ where: { key }, create: { key, cursor }, update: { cursor } });
  return next;
}

/** Set fields on this month's row (the settle's pack seconds, the out-of-minutes notice). */
export async function patchDeskUse(organizationId: string, patch: Partial<Pick<DeskUse, "packSeconds" | "outNoticeAt">>, at: Date = new Date()): Promise<DeskUse> {
  const key = rowKey(organizationId, monthKey(at));
  const next: DeskUse = { ...(await readDeskUse(organizationId, at)), ...patch };
  const cursor = JSON.stringify(next);
  await db.syncState.upsert({ where: { key }, create: { key, cursor }, update: { cursor } });
  return next;
}
