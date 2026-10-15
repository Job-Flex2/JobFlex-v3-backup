// How the forwarding test call ended (Twilio's status callback): nobody answered and it never came back to the
// desk → "noanswer"; it could not go through → "failed". An answered call was already settled when it was answered.
import { NextResponse } from "next/server";
import { readTwilioForm } from "@/lib/sdk/twilioVoice";
import { settleForwardTest } from "@/lib/aiDesk/forwardTest";
import { statusAfterCall } from "@/lib/aiDesk/forwardCheck";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const url = new URL(req.url);
  const params = await readTwilioForm(req, `/api/twilio/voice/forward-test/status${url.search}`);
  if (!params) return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  const orgId = url.searchParams.get("o") ?? "";
  const testId = url.searchParams.get("t") ?? "";
  const status = statusAfterCall(params.CallStatus ?? "");
  if (orgId && testId && status) await settleForwardTest(orgId, testId, status, status === "failed" ? "The test call could not go through to your phone." : undefined);
  return new NextResponse(null, { status: 204 });
}
