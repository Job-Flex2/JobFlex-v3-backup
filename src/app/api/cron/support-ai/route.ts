import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cronAuth";
import { answerMissedTickets } from "@/lib/support/aiSupport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A few model calls in series.
export const maxDuration = 300;

// Every 10 minutes: the support AI's safety net (lib/support/aiSupport
// answerMissedTickets) — a new ticket the AI never read because the request
// that filed it ended before the answer did. Idempotent: a ticket with a
// record, or any reply, is never touched again.
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const res = await answerMissedTickets();
  return NextResponse.json({ ok: true, ...res });
}
