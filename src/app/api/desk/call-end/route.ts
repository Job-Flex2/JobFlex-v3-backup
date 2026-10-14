// The call is over: the transcript and outcome (lib/aiDesk/liveCall finishCall).
import { finishCall, type CallOutcome } from "@/lib/aiDesk/liveCall";
import { deskRequest, json, str } from "../route-helpers";

export const runtime = "nodejs";

const OUTCOMES = new Set<CallOutcome["outcome"]>(["done", "transfer", "voicemail", "failed"]);

export async function POST(req: Request) {
  const r = await deskRequest(req);
  if (!r.ok) return r.res;
  const outcome = OUTCOMES.has(r.body.outcome as CallOutcome["outcome"]) ? (r.body.outcome as CallOutcome["outcome"]) : "failed";
  const transcript = (Array.isArray(r.body.transcript) ? r.body.transcript : [])
    .map((l) => (l && typeof l === "object" ? { role: str((l as Record<string, unknown>).role, 10), text: str((l as Record<string, unknown>).text, 2000) } : null))
    .filter((l): l is { role: string; text: string } => !!l && !!l.text)
    .slice(0, 400);
  const booked = r.body.booked && typeof r.body.booked === "object" ? { appointmentId: str((r.body.booked as Record<string, unknown>).appointmentId, 60) } : null;
  await finishCall({ callSid: r.token.callSid, organizationId: r.token.organizationId }, { outcome, transcript, seconds: Number(r.body.seconds) || 0, booked: booked?.appointmentId ? booked : null, messageTaken: r.body.messageTaken === true, error: str(r.body.error, 300) || null });
  return json({ ok: true });
}
