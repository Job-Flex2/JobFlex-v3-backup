// The company phone was rung (forwardTwiml's action): Twilio says how it went.
// A conversation that ended hangs up; no answer, busy or failed goes to the assistant —
// the live desk, or a recording after the desk's own transfer or when the minutes are
// out (lib/aiDesk/calls).
import { NextResponse } from "next/server";
import { readTwilioForm } from "@/lib/sdk/twilioVoice";
import { afterDialTwiml, twilioBase } from "@/lib/aiDesk/calls";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const params = await readTwilioForm(req, "/api/twilio/voice/dial");
  if (!params) return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  const { CallSid: callSid, From: from, To: to, DialCallStatus: dialStatus = "" } = params;
  if (!callSid || !from || !to) return NextResponse.json({ error: "Missing call params" }, { status: 400 });
  const xml = await afterDialTwiml({ to, from, callSid, base: twilioBase(req.url), dialStatus });
  return new NextResponse(xml, { headers: { "Content-Type": "text/xml" } });
}
