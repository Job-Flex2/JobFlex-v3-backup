// Which EagleView Property Data packs the ACCOUNT may order.
//
// A 403 / 10880 on a pack is a fact about the credentials, not about the
// address that was being ordered (2026-09-08: pack 001 orders, the seven-pack
// order does not — the entitlement is partial). So the record lives here,
// account-wide, not per address and not per organization:
//
//   live    an order for this pack was accepted (billed) — the pack is on.
//   denied  a single-pack order came back 403. A refusal costs nothing, so a
//           denied pack is probed again once the record is older than a day.
//   no row  never probed.
//
// The reader is lib/eagleviewOrder (the order planner); the only writers are
// that planner and scripts/eagleview-recheck-entitlements.ts, which resets
// the table so the next order re-probes everything.

import { db } from "@/lib/db";
import { PD_FIGURE_PACKS, type PdPack } from "@/lib/eagleview";

export type PackStatus = "live" | "denied";

export interface PackRecord {
  pack: string;
  status: PackStatus;
  checkedAt: Date;
  error: string | null;
  /** Not observed by this table — the starting assumption below. */
  assumed?: boolean;
}

/**
 * STARTING STATE, before the table has seen a single order: the figure packs
 * (001 area, 002 pitch + eave) are taken as live. That is the one thing the
 * upstream fix 5c727b0 (2026-09-08) knew from the field — the account, org
 * 347167560, was refused the seven-pack order and accepted 001 + 002 — and
 * its hard-coded "retry with 001 + 002" is replaced by this assumption
 * feeding the planner: 002 goes in the grouped known-live request, the rest
 * are probed one by one. The first real verdict on 002 overwrites it.
 */
export const ASSUMED_LIVE: readonly PdPack[] = PD_FIGURE_PACKS;
const ASSUMED_NOTE = "assumed live from the field observation of 2026-09-08 (upstream 5c727b0: org 347167560 accepted 001 + 002); not yet verified by this table";

/** A denied pack older than this is asked again on the next order. */
export const DENIED_RECHECK_MS = 24 * 60 * 60 * 1000;

/**
 * The order packs are probed one by one when a grouped order is refused —
 * the ones the roof page misses most first: imagery (ortho + parcel mask),
 * material / condition / SHAPE / FACET COUNT (all four ride in 003 — the
 * stored raw bodies say so, 2026-10-16), pitch + eave height, the outline,
 * then chimney / solar / AC (005) and the age classifier.
 */
export const PROBE_ORDER: readonly PdPack[] = [
  "property_data_id_008",
  "property_data_id_003",
  "property_data_id_002",
  "property_data_id_007",
  "property_data_id_005",
  "property_data_id_004",
];

export async function readEntitlements(): Promise<Map<string, PackRecord>> {
  const rows = await db.eagleViewEntitlement.findMany();
  const map = new Map<string, PackRecord>(
    rows.map((r) => [r.pack, { pack: r.pack, status: r.status as PackStatus, checkedAt: r.checkedAt, error: r.error }]),
  );
  for (const pack of ASSUMED_LIVE) {
    if (!map.has(pack)) map.set(pack, { pack, status: "live", checkedAt: new Date(0), error: ASSUMED_NOTE, assumed: true });
  }
  return map;
}

export async function markPacks(packs: readonly string[], status: PackStatus, error: string | null = null): Promise<void> {
  const now = new Date();
  for (const pack of packs) {
    await db.eagleViewEntitlement.upsert({
      where: { pack },
      update: { status, checkedAt: now, error },
      create: { pack, status, checkedAt: now, error },
    });
  }
}

/** No record, or a refusal old enough to be worth a free re-ask. */
export function needsProbe(rec: PackRecord | undefined, now = Date.now()): boolean {
  if (!rec) return true;
  return rec.status === "denied" && now - rec.checkedAt.getTime() > DENIED_RECHECK_MS;
}

/** Forget every verdict; the next order probes from scratch. Returns rows removed. */
export async function resetEntitlements(): Promise<number> {
  const r = await db.eagleViewEntitlement.deleteMany();
  return r.count;
}
