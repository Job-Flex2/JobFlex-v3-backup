import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cronAuth";
import { appBaseUrl } from "@/lib/appUrl";
import { readSettings, runDueHunts, workOutreach } from "@/lib/outreach/find";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Every hour (2026-10-25, owner: "I'll put you on a schedule to call them and text them"): the hunts due this morning
// find the next contractors of their trade in their area (lib/outreach/find); then, when the schedule is on, the list
// is worked — new numbers checked, the first email sent, the AI's calls to the next landlines in their hours. Each step
// keeps to the outreach's own rules (calling hours on their clock, two calls at most, a cell only once they ask).
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const now = new Date();
  const hunts = await runDueHunts(now);
  const settings = await readSettings();
  const work = settings.autoWork ? await workOutreach((await appBaseUrl()).replace(/\/$/, ""), now) : null;
  return NextResponse.json({ ok: true, hunts: hunts.map((h) => ({ id: h.id, ...h.run })), work });
}
