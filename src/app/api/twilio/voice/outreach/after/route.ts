// After the AI's part of an outreach call (the <Redirect> after <Connect><Stream>): a transfer to a person at JobFlex,
// or a hang-up (lib/outreach/server outreachAfter).
import { NextResponse } from "next/server";
import { readTwilioForm } from "@/lib/sdk/twilioVoice";
import { outreachAfter } from "@/lib/outreach/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const url = new URL(req.url);
  const params = await readTwilioForm(req, `/api/twilio/voice/outreach/after${url.search}`);
  if (!params) return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  const xml = await outreachAfter(url.searchParams.get("p") ?? "");
  return new NextResponse(xml, { headers: { "Content-Type": "text/xml" } });
}
