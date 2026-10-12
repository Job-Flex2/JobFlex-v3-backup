"use server";

// THE TRIALS BOARD'S READS (2026-10-12) — platform admin only. The board itself (lib/trialBoardRead → lib/trialBoard)
// and, opened from a trial's card, everything that account did: its trail, its proposals with their lines, its
// estimates, its Smart Proposal briefs and its sittings in the app. Read-only.

import { requirePlatformAdmin } from "@/lib/orgContext";
import { readTrialActivity, readTrialBoard, type TrialActivity } from "@/lib/trialBoardRead";
import type { TrialBoard } from "@/lib/trialBoard";

export async function getTrialBoard(): Promise<TrialBoard> {
  await requirePlatformAdmin();
  return readTrialBoard();
}

export async function getTrialActivity(input: Record<string, unknown> = {}): Promise<{ ok: true; activity: TrialActivity } | { ok: false; error: string }> {
  await requirePlatformAdmin();
  const orgId = typeof input.orgId === "string" ? input.orgId.trim() : "";
  if (!orgId || orgId.length > 64) return { ok: false, error: "No account given." };
  try {
    const activity = await readTrialActivity(orgId);
    return activity ? { ok: true, activity } : { ok: false, error: "That account was not found." };
  } catch {
    return { ok: false, error: "The activity could not be read. Try again." };
  }
}
