import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cronAuth";
import { runSmartBook } from "@/lib/smartbook/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Each connected Facebook Page read once, then the steps that are due (a text, a reminder) — a model call at most.
export const maxDuration = 120;

// Every 2 minutes (vercel.json): Facebook's new leads come in by themselves (lib/meta/connections syncMetaLeads) and
// SmartBook does what is due — the morning text, the nudges, the reminders to the company, the "still checking"
// (lib/smartbook/engine). Always 200 for an authorised call; a failure is logged, not retried by Vercel.
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const res = await runSmartBook();
  return NextResponse.json(res);
}
