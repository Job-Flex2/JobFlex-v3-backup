// GET /api/cron/signup-watch — the sign-up form's alarm (2026-10-14), every fifteen minutes.
//
// Reads the last hour's problems on the sign-up form; three visitors on one reason, or two on a hard fault of ours,
// emails the platform admins (one reason at most every six hours) and puts the line on the office screen
// (lib/signup-alerts). Fail-closed auth.
import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cronAuth";
import { runSignupAlertCheck } from "@/lib/signup-alerts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const run = await runSignupAlertCheck();
    console.info(`[cron/signup-watch] ${run.checked} reasons · ${run.alerts.length} alerts · ${run.emailed.length} emailed${run.email?.error ? ` · ${run.email.error}` : ""}`);
    return NextResponse.json({ ok: true, checked: run.checked, alerts: run.alerts.map((a) => ({ reason: a.reason, side: a.side, visits: a.visits, times: a.times })), emailed: run.emailed.map((a) => a.reason) });
  } catch (err) {
    console.error("[cron/signup-watch] failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: "PostHog did not answer." }, { status: 503 });
  }
}
