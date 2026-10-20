// GET /api/cron/integrations-health — the nightly sweep.
//
// Shares the v2 cache, lease and backoff with admin checks. The existing daily
// schedule remains unchanged. Existing alert delivery is not a free probe.
import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cronAuth";
import { alertIfDown, runIntegrationsHealth } from "@/lib/integrationsHealth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let report;
  try { report = await runIntegrationsHealth(); }
  catch { return NextResponse.json({ error: "Monitoring unavailable or another check is running" }, { status: 503, headers: { "Retry-After": "300", "Cache-Control": "no-store" } }); }
  const alert = await alertIfDown(report);
  console.info(
    `[cron/integrations-health] ${report.worst} in ${report.tookMs} ms · ` +
      report.services.map((s) => `${s.key}=${s.level}`).join(" ") +
      ` · alert=${alert}`,
  );
  return NextResponse.json({
    ok: true,
    worst: report.worst,
    ranAt: report.ranAt,
    nextCheckAt: report.nextCheckAt,
    alert,
    services: report.services.map((s) => ({ key: s.key, level: s.level, reason: s.reason })),
  });
}
