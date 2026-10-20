"use server";

// "Check now" on Admin → Overview. Same sweep the nightly cron runs, on
// demand, for the moment somebody has just fixed a key and wants to see it go
// green without waiting until 04:00.
//
// Platform-admin only, like every other admin action. It does not send the
// alert email: a person watching the panel does not need to be told by mail,
// and a button that mails the whole admin list on every press would train
// everyone to ignore the alert that matters.

import { requirePlatformAdmin } from "@/lib/orgContext";
import { runIntegrationsHealth, type HealthReport } from "@/lib/integrationsHealth";

export async function checkIntegrationsNow(): Promise<{ ok: true; report: HealthReport } | { ok: false; error: string }> {
  try {
    await requirePlatformAdmin();
  } catch {
    return { ok: false, error: "Platform admin access required" };
  }
  try {
    const report = await runIntegrationsHealth();
    return { ok: true, report };
  } catch {
    return { ok: false, error: "Monitoring is unavailable or another check is running. Retry in five minutes." };
  }
}
