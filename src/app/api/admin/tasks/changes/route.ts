// GET /api/admin/tasks/changes?since=<iso>&open=<taskId>
//
// The task tracker's live feed (2026-10-11): what changed after `since`. The
// page asks every 3 seconds while its tab is visible and merges the answer —
// no router.refresh, no re-render of the route. One indexed comparison on
// AdminTask.updatedAt (every write touches it), plus the open task in full
// when it is among the changed ones.
//
// Platform admins only: 401 without a session, 403 for anyone else, the same
// requirePlatformAdmin every action calls. Never cached.

import { requirePlatformAdmin } from "@/lib/orgContext";
import { changesSince } from "@/lib/adminTasks/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "private, no-store" };
/** A tab asleep longer than this starts over from a fresh page load. */
const MAX_LOOKBACK_MS = 24 * 60 * 60 * 1000;

export async function GET(req: Request) {
  try {
    await requirePlatformAdmin();
  } catch (err) {
    const forbidden = err instanceof Error && err.message === "Platform admin only";
    return Response.json(
      { error: forbidden ? "Platform admins only." : "Sign in to the admin console." },
      { status: forbidden ? 403 : 401, headers: NO_STORE },
    );
  }

  const url = new URL(req.url);
  const sinceRaw = url.searchParams.get("since") ?? "";
  const since = new Date(sinceRaw);
  if (!sinceRaw || Number.isNaN(since.getTime())) {
    return Response.json({ error: "since must be an ISO timestamp." }, { status: 400, headers: NO_STORE });
  }
  if (Date.now() - since.getTime() > MAX_LOOKBACK_MS) {
    return Response.json({ error: "Too far behind — reload the page.", reload: true }, { status: 410, headers: NO_STORE });
  }
  const openRaw = url.searchParams.get("open");
  const open = openRaw && openRaw.length <= 64 && /^[\w-]+$/.test(openRaw) ? openRaw : null;

  const changes = await changesSince(since, open);
  return Response.json(changes, { headers: NO_STORE });
}
