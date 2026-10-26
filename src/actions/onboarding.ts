"use server";
// The first-estimate tour's progress (2026-10-26, owner-approved
// OnboardingProgress): one row per person × organization × tour, written as
// the person moves through it, and the tour_* events sent from here — at the
// point the row was written, like the rest of lib/activation-events.
//
// It never fails its caller: the tour is a guide, and a failed write costs the
// remembered step, never the estimate the person is making.

import { z } from "zod";
import { db } from "@/lib/db";
import { requireOrg } from "@/lib/orgContext";
import { trackActivation } from "@/lib/activation-events";
import { TOUR_PATHS, isTourPathId } from "@/lib/onboarding/tour-paths";

const input = z.object({
  tour: z.enum(["first_estimate", "next_steps"]),
  op: z.enum(["start", "resume", "step", "pause", "skip", "complete"]),
  path: z.string().max(16),
  step: z.number().int().min(0).max(40),
});

export type TourWrite = z.infer<typeof input>;

export async function saveTourProgress(raw: TourWrite): Promise<boolean> {
  const parsed = input.safeParse(raw);
  if (!parsed.success) return false;
  const { tour, op, path, step } = parsed.data;
  if (tour === "first_estimate" && !isTourPathId(path)) return false;
  try {
    const { user, organizationId } = await requireOrg();
    const steps = isTourPathId(path) ? TOUR_PATHS[path].steps : [];
    const at = Math.min(step, Math.max(steps.length - 1, 0));
    const now = new Date();
    const status = op === "skip" ? "skipped" : op === "complete" ? "completed" : op === "pause" ? "paused" : "active";
    const data = {
      path,
      step: at,
      status,
      ...(op === "start" ? { startedAt: now, completedAt: null, skippedAt: null } : {}),
      ...(op === "complete" ? { completedAt: now } : {}),
      ...(op === "skip" ? { skippedAt: now } : {}),
    };
    await db.onboardingProgress.upsert({
      where: { userId_organizationId_tour: { userId: user.id, organizationId, tour } },
      create: { userId: user.id, organizationId, tour, ...data },
      update: data,
    });
    if (tour === "first_estimate") {
      // `step` names the step just passed (tour_step) or the one left open (tour_skipped).
      if (op === "start") trackActivation("tour_started", organizationId, { path });
      if (op === "step" && at > 0) trackActivation("tour_step", organizationId, { path, step: steps[at - 1]?.id ?? String(at) });
      if (op === "complete") trackActivation("tour_completed", organizationId, { path });
      if (op === "skip") trackActivation("tour_skipped", organizationId, { path, step: steps[at]?.id ?? String(at) });
    }
    return true;
  } catch {
    return false;
  }
}
