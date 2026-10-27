// THE PUBLIC ROOF READ'S STORE (2026-10-27) — server only. One Google Solar call per address per 30 days, whoever
// asks: the second homeowner (or the contractor-website twin) on the same house reads the cached answer. A roof Google
// can't see is cached too, so a bad address isn't retried by every visitor; a timeout is not (asking again is right).
// Keys: `pubroof:<EagleView address key>` in SyncState (the app's key→string store); `leadCenter:houseOrgId` names the
// internal organization the house path's spend is filed under (none set: nothing is filed).
import { db } from "@/lib/db";
import { instantAddressKey } from "@/lib/eagleview";
import type { SolarFailureKind } from "@/lib/solar";
import type { SolarRoofEstimate } from "@/lib/roofSolarEstimate";

export const PUBROOF_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const HOUSE_ORG_KEY = "leadCenter:houseOrgId";

export type PubRoofCache = { v: 1; at: string; solar: SolarRoofEstimate | null; error: string | null };

export function pubRoofKey(input: { address: string; city?: string | null; state?: string | null; zip?: string | null }): string {
  return `pubroof:${instantAddressKey(input)}`;
}

export function cacheFresh(row: PubRoofCache | null, now: Date): boolean {
  if (!row || row.v !== 1) return false;
  const at = Date.parse(row.at);
  return Number.isFinite(at) && now.getTime() - at < PUBROOF_TTL_MS;
}

/** Whether an outcome is worth keeping for 30 days: an answer, "no building", or Google's own "no coverage". */
export function cacheable(outcome: "ok" | SolarFailureKind): boolean {
  return outcome === "ok" || outcome === "no-coverage" || outcome === "error";
}

export async function readPubRoof(key: string): Promise<PubRoofCache | null> {
  try {
    const row = await db.syncState.findUnique({ where: { key } });
    if (!row?.cursor) return null;
    const parsed = JSON.parse(row.cursor) as PubRoofCache;
    return parsed && parsed.v === 1 ? parsed : null;
  } catch {
    return null;
  }
}

export async function writePubRoof(key: string, row: PubRoofCache): Promise<void> {
  const cursor = JSON.stringify(row);
  await db.syncState.upsert({ where: { key }, update: { cursor }, create: { key, cursor } }).catch((err: unknown) => {
    console.error("[price] roof read not cached — the answer still stands:", err);
  });
}

export async function houseOrgId(): Promise<string | null> {
  try {
    const row = await db.syncState.findUnique({ where: { key: HOUSE_ORG_KEY } });
    return row?.cursor?.trim() || null;
  } catch {
    return null;
  }
}
