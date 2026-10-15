import "server-only";
// ACCOUNTS LEFT OUT OF THE STATISTICS (owner, 2026-10-05: "remove him from
// statistics everywhere" — a signup that canceled the same day). A platform
// admin hides an account from every count the admin reads: the signups list
// and its totals, the trial revenue, the live view's signups, the attribution
// tables, the analyst, the exports, the overview's counts and the trial
// watch. The account itself is untouched — it still signs in, it is still in
// /admin/users and in billing — and one tap shows it again.
//
// Kept as ONE SyncState row (`statsHidden`, a JSON list) — no table, no
// column, nothing to push to production by hand.
import { db } from "@/lib/db";
import { qaOrgIds } from "@/lib/qaTestMode";

export const STATS_HIDDEN_KEY = "statsHidden";
export type StatsHiddenEntry = { orgId: string; at: string; by: string | null };

export async function readStatsHidden(): Promise<StatsHiddenEntry[]> {
  try {
    const row = await db.syncState.findUnique({ where: { key: STATS_HIDDEN_KEY }, select: { cursor: true } });
    const list = row?.cursor ? (JSON.parse(row.cursor) as unknown) : [];
    return Array.isArray(list) ? list.filter((e): e is StatsHiddenEntry => !!e && typeof e === "object" && typeof (e as StatsHiddenEntry).orgId === "string") : [];
  } catch {
    return [];
  }
}

/** Every organisation the statistics leave out: the ones an admin hid, and the
 *  QA Lab's own accounts (@qa.jobflex.test, lib/qaTestMode — never counted,
 *  never listed, with no switch to show them). */
export async function statsHiddenIds(): Promise<string[]> {
  const [hidden, qa] = await Promise.all([readStatsHidden(), qaOrgIds()]);
  return [...new Set([...hidden.map((e) => e.orgId), ...qa])];
}

/** Hide or show one account. Returns the list as it now stands. */
export async function setStatsHidden(orgId: string, hidden: boolean, by: string | null): Promise<StatsHiddenEntry[]> {
  const now = await readStatsHidden();
  const rest = now.filter((e) => e.orgId !== orgId);
  const next = hidden ? [...rest, { orgId, at: new Date().toISOString(), by }] : rest;
  if (next.length === 0) await db.syncState.deleteMany({ where: { key: STATS_HIDDEN_KEY } });
  else await db.syncState.upsert({ where: { key: STATS_HIDDEN_KEY }, create: { key: STATS_HIDDEN_KEY, cursor: JSON.stringify(next) }, update: { cursor: JSON.stringify(next) } });
  return next;
}

/** The organizations a statistic counts: not deleted, not hidden. */
export function countedOrgs(hidden: readonly string[]): { deletedAt: null; id?: { notIn: string[] } } {
  return hidden.length ? { deletedAt: null, id: { notIn: [...hidden] } } : { deletedAt: null };
}
