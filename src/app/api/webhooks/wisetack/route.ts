import { NextResponse } from "next/server";
import { getProvider } from "@/lib/financing/provider";
import { applyEvent } from "@/lib/financing/service";
import { runWebhookEnvelope } from "@/lib/webhookEnvelope";

// Wisetack → JobFlex (lib/financing): a contractor's application decided, a client's loan moving, a payout, someone
// pre-qualified through a contractor's link. Believed only with Wisetack's signature (lib/financing/wisetack); each
// event once (WebhookEvent, provider WISETACK). A failure answers 500 and Wisetack retries.
export const runtime = "nodejs";

export async function POST(req: Request) {
  const provider = getProvider();
  if (!provider) return NextResponse.json({ error: "Not available" }, { status: 404 });
  const raw = await req.text();
  const events = provider.parseWebhook(raw, req.headers);
  if (events === null) return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  let failed = false;
  for (const ev of events) {
    const r = await runWebhookEnvelope({ provider: "WISETACK", eventId: ev.id, type: ev.kind }, () => applyEvent(ev));
    if (r.outcome === "failed") failed = true;
  }
  return failed ? NextResponse.json({ error: "Failed" }, { status: 500 }) : NextResponse.json({ ok: true });
}
