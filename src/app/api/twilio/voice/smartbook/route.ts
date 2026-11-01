// SmartBook's call is answered (lib/smartbook/phone placeSmartBookCall → this Url): a person gets the AI desk on
// SmartBook's script; a machine, after its beep, the short voicemail; a fax, a hang-up.
import { NextResponse } from "next/server";
import { readTwilioForm } from "@/lib/sdk/twilioVoice";
import { twilioBase } from "@/lib/aiDesk/calls";
import { smartBookAnswered } from "@/lib/smartbook/phone";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const url = new URL(req.url);
  // Twilio signs the URL it was given, query and all.
  const params = await readTwilioForm(req, `/api/twilio/voice/smartbook${url.search}`);
  if (!params) return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  const xml = await smartBookAnswered(url.searchParams.get("o") ?? "", url.searchParams.get("l") ?? "", params, twilioBase(req.url));
  return new NextResponse(xml, { headers: { "Content-Type": "text/xml" } });
}
