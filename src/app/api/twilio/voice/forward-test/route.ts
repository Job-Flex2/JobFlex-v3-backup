// The forwarding test call is answered (lib/aiDesk/forwardTest). Back at the desk's number — the carrier forwarded it —
// it says so and hangs up; answered at the business phone itself (a person, a voicemail), forwarding is not on yet,
// and whoever answered hears how to turn it on.
import { NextResponse } from "next/server";
import { readTwilioForm } from "@/lib/sdk/twilioVoice";
import { readForwardCheck, settleForwardTest } from "@/lib/aiDesk/forwardTest";
import { testAnsweredTwiml } from "@/lib/aiDesk/forwardCheck";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const url = new URL(req.url);
  // Twilio signs the URL it was given, query and all.
  const params = await readTwilioForm(req, `/api/twilio/voice/forward-test${url.search}`);
  if (!params) return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  const orgId = url.searchParams.get("o") ?? "";
  const testId = url.searchParams.get("t") ?? "";
  const c = orgId ? await readForwardCheck(orgId) : null;
  const ours = !!c && c.id === testId;
  const reachedDesk = ours && c!.status === "works";
  if (ours && c!.status === "calling") await settleForwardTest(orgId, testId, "rang");
  return new NextResponse(testAnsweredTwiml(reachedDesk, c?.kind ?? "all"), { headers: { "Content-Type": "text/xml" } });
}
