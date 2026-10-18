import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cronAuth";
import { runSupportMail } from "@/lib/supportMail/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// An IMAP login, a short search and a few letters.
export const maxDuration = 60;

// Every 2 minutes (vercel.json): replies to support letters, read from the
// platform's Gmail box over IMAP and added to their tickets
// (lib/supportMail/run). Production only — on a preview or a laptop it
// returns at once (lib/supportMail/config), so they never touch the real box.
// Always 200 for an authorised call: a failed login is logged and shown on
// /admin/health, not retried by Vercel.
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const res = await runSupportMail();
  return NextResponse.json(res);
}
