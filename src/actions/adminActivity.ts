"use server";
// USER ACTIVITY — the "Working right now" panel's refresh (2026-10-19). Platform admins only; reads only.
import { requirePlatformAdmin } from "@/lib/orgContext";
import { readWorkingNow, type WorkingNowRow } from "@/lib/adminActivityRead";

export async function refreshWorkingNow(): Promise<{ ok: true; rows: WorkingNowRow[]; at: number } | { ok: false }> {
  try {
    await requirePlatformAdmin();
  } catch {
    return { ok: false };
  }
  const at = Date.now();
  return { ok: true, rows: await readWorkingNow(at).catch(() => []), at };
}
