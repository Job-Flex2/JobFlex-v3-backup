import "server-only";
// THE SITE PLAN, KEPT BY THE PROPERTY (2026-10-20). A site plan belongs to the
// lot, not to one deck design: the draft, the proposal and an unsaved design
// at the same address all draw the same lot, house and street. So it is kept
// by the organization and the address (SyncState, no schema change), apart
// from the studio's drafts — the studio's auto-save can never overwrite it.

import { db } from "@/lib/db";
import { normalizeSitePlan, type SitePlan } from "./sitePlan";

/** "1840 Meadow Glen Dr, Allen, TX 75002" → "1840meadowglendrallentx75002". */
export function addressKey(address: string | null | undefined): string | null {
  const k = (address ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 120);
  return k.length >= 6 ? k : null;
}

const keyOf = (organizationId: string, address: string) => `decksiteplan:${organizationId}:${addressKey(address)}`;

export async function readSitePlan(organizationId: string, address: string | null | undefined, fallback: SitePlan): Promise<SitePlan | null> {
  if (!addressKey(address)) return null;
  try {
    const row = await db.syncState.findUnique({ where: { key: keyOf(organizationId, address as string) }, select: { cursor: true } });
    if (!row?.cursor) return null;
    return normalizeSitePlan(JSON.parse(row.cursor), fallback);
  } catch {
    return null;
  }
}

export async function writeSitePlan(organizationId: string, address: string, plan: SitePlan): Promise<void> {
  const key = keyOf(organizationId, address);
  const cursor = JSON.stringify(plan);
  await db.syncState.upsert({ where: { key }, create: { key, cursor }, update: { cursor } });
}
