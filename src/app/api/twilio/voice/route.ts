// A call comes in (Twilio's voice webhook, the number's VoiceUrl). Which company and
// what happens are lib/aiDesk/calls: the company whose number was dialed; its phone
// rings first or the assistant answers, as its desk is set.
import { NextResponse } from "next/server";
import { readTwilioForm } from "@/lib/sdk/twilioVoice";
import { inboundTwiml, twilioBase } from "@/lib/aiDesk/calls";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const params = await readTwilioForm(req, "/api/twilio/voice");
  if (!params) return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  const { CallSid: callSid, From: from, To: to } = params;
  if (!callSid || !from || !to) return NextResponse.json({ error: "Missing call params" }, { status: 400 });
  const xml = await inboundTwiml({ to, from, callSid, base: twilioBase(req.url) });
  return new NextResponse(xml, { headers: { "Content-Type": "text/xml" } });
}
