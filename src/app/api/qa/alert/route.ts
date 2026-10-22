// POST /api/qa/alert — the QA Lab's CI tells the team that a run against
// production went red (qa/bin/alert.ts; docs/qa-ci.md). The text goes out
// through fireAdminAlert under the "qa" key: only the /admin/tasks → Team
// members who ticked "QA failures" hear it, in their texting hours.
//
// THE GATE IS THE FIRST LINE, as on /api/qa/otp: without a QA_SECRET on this
// server, or with a missing or wrong x-qa-secret header, a plain 404 before
// anything is read. Unlike /api/qa/otp it is open on Vercel production — that
// is where the team list lives — and it can only send this one kind of text,
// at most a few an hour.
//
// Body: { text: string, run?: string } — `run` (the CI run id) makes a retried
// step text nobody twice.

import { NextResponse } from "next/server";
import { tokensEqual } from "@/lib/tokens";
import { fireAdminAlert } from "@/lib/adminAlerts";
import { rateLimitShared } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_TEXT = 300;

export async function POST(req: Request) {
  const secret = process.env.QA_SECRET;
  if (!secret || !tokensEqual(req.headers.get("x-qa-secret"), secret)) {
    return new NextResponse(null, { status: 404 });
  }
  const body = (await req.json().catch(() => null)) as { text?: unknown; run?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.replace(/\s+/g, " ").trim() : "";
  if (!text) return NextResponse.json({ error: "text is required" }, { status: 400, headers: NO_STORE });
  const run = typeof body?.run === "string" ? body.run.replace(/[^\w.:-]/g, "").slice(0, 80) : "";

  // A failing nightly and a re-run should not page anyone ten times an hour.
  const gate = await rateLimitShared("qa-alert", 6, 60 * 60_000);
  if (!gate.ok) return NextResponse.json({ sent: 0, limited: true }, { status: 429, headers: NO_STORE });

  const line = `JobFlex QA: ${text}`;
  const sent = await fireAdminAlert("qa", line.length > MAX_TEXT ? `${line.slice(0, MAX_TEXT - 1).trimEnd()}…` : line, run ? `qa:${run}` : undefined);
  return NextResponse.json({ sent }, { headers: NO_STORE });
}
