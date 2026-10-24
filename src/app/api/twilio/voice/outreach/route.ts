// JobFlex's outreach call is answered (lib/outreach/server placeCall → this Url): a person gets the AI desk's voice
// server on JobFlex's own script; a machine, after its beep, the short voicemail; a fax, a hang-up.
import { NextResponse } from "next/server";
import { readTwilioForm } from "@/lib/sdk/twilioVoice";
import { twilioBase } from "@/lib/aiDesk/calls";
import { outreachAnswered } from "@/lib/outreach/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const url = new URL(req.url);
  // Twilio signs the URL it was given, query and all.
  const params = await readTwilioForm(req, `/api/twilio/voice/outreach${url.search}`);
  if (!params) return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  const xml = await outreachAnswered(url.searchParams.get("p") ?? "", params, twilioBase(req.url));
  return new NextResponse(xml, { headers: { "Content-Type": "text/xml" } });
}
