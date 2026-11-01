// How SmartBook's call ended, in Twilio's words: nobody picked up, busy, didn't connect — a line on the lead.
import { NextResponse } from "next/server";
import { readTwilioForm } from "@/lib/sdk/twilioVoice";
import { smartBookCallStatus } from "@/lib/smartbook/phone";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const url = new URL(req.url);
  const params = await readTwilioForm(req, `/api/twilio/voice/smartbook/status${url.search}`);
  if (!params) return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  await smartBookCallStatus(url.searchParams.get("o") ?? "", url.searchParams.get("l") ?? "", params);
  return new NextResponse(null, { status: 204 });
}
