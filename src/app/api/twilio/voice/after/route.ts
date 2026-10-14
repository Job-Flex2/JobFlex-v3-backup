// After the live desk's stream ended (the <Redirect> that follows <Connect><Stream>):
// how the call went decides what Twilio does next — hang up, dial the company phone for a
// transfer, or take a message when the desk never spoke (lib/aiDesk/calls afterStreamTwiml).
import { NextResponse } from "next/server";
import { readTwilioForm } from "@/lib/sdk/twilioVoice";
import { afterStreamTwiml, twilioBase } from "@/lib/aiDesk/calls";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const params = await readTwilioForm(req, "/api/twilio/voice/after");
  if (!params) return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  const { CallSid: callSid, From: from, To: to } = params;
  if (!callSid || !from || !to) return NextResponse.json({ error: "Missing call params" }, { status: 400 });
  const xml = await afterStreamTwiml({ to, from, callSid, base: twilioBase(req.url) });
  return new NextResponse(xml, { headers: { "Content-Type": "text/xml" } });
}
