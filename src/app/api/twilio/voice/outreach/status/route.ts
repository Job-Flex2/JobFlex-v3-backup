// How an outreach call ended, by Twilio's word (no answer, busy, failed, completed) — lib/outreach/server outreachStatus.
import { NextResponse } from "next/server";
import { readTwilioForm } from "@/lib/sdk/twilioVoice";
import { outreachStatus } from "@/lib/outreach/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const url = new URL(req.url);
  const params = await readTwilioForm(req, `/api/twilio/voice/outreach/status${url.search}`);
  if (!params) return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  await outreachStatus(url.searchParams.get("p") ?? "", params);
  return new NextResponse(null, { status: 204 });
}
