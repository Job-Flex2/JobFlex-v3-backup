// GET /api/cron/traffic-surge — every five minutes: are there suddenly a lot of
// people on the site? Counts the last five minutes' visitors (the live map's own
// window) and texts the team members who asked for the "Traffic surge" alert —
// once per surge, re-armed when the crowd thins (lib/adminAlerts). Fail-closed auth.
import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cronAuth";
import { checkTrafficSurge } from "@/lib/adminAlerts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const r = await checkTrafficSurge();
    console.info(`[cron/traffic-surge] ${r.count} online · threshold ${r.threshold} · ${r.fired ? "texted" : r.armed ? "quiet" : "already told"}`);
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    console.error("[cron/traffic-surge] failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: "The traffic read did not answer." }, { status: 503 });
  }
}
