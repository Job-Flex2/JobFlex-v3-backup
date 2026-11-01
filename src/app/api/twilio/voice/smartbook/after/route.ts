// After the AI's part of SmartBook's call: a person at the company when the customer asked for one; else goodbye.
import { NextResponse } from "next/server";
import { readTwilioForm } from "@/lib/sdk/twilioVoice";
import { smartBookAfter } from "@/lib/smartbook/phone";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const url = new URL(req.url);
  const params = await readTwilioForm(req, `/api/twilio/voice/smartbook/after${url.search}`);
  if (!params) return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  const xml = await smartBookAfter(url.searchParams.get("o") ?? "", params.CallSid ?? "");
  return new NextResponse(xml, { headers: { "Content-Type": "text/xml" } });
}
