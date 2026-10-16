"use server";
// The welcome card's "Got it" (lib/autoPlanWelcome) — the shop's own members only.
import { requireOrg } from "@/lib/orgContext";
import { dismissAutoPlanWelcomeFor } from "@/lib/autoPlanWelcome";

export async function dismissAutoPlanWelcome(): Promise<{ ok: boolean }> {
  try {
    const { organizationId } = await requireOrg();
    await dismissAutoPlanWelcomeFor(organizationId);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
