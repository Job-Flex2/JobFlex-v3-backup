import "server-only";
// A lawn plan's season, kept beside the plan (SyncState `lawnplan:<planId>`): the service-plan engine books these
// visits on activation and renewal instead of its evenly spread tune-ups (lib/servicePlanBook). No table of its own.
import { db } from "@/lib/db";
import type { StoredSchedule } from "./calendar";

const key = (planId: string) => `lawnplan:${planId}`;

export async function readLawnSchedule(planId: string): Promise<StoredSchedule | null> {
  const row = await db.syncState.findUnique({ where: { key: key(planId) }, select: { cursor: true } }).catch(() => null);
  if (!row) return null;
  try {
    const s = JSON.parse(row.cursor) as StoredSchedule;
    return s && s.v === 1 && Array.isArray(s.visits) ? s : null;
  } catch {
    return null;
  }
}

export async function writeLawnSchedule(planId: string, schedule: StoredSchedule): Promise<void> {
  const cursor = JSON.stringify(schedule);
  await db.syncState.upsert({ where: { key: key(planId) }, create: { key: key(planId), cursor }, update: { cursor } });
}
