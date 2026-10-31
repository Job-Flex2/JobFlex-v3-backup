// The desk takes a message (lib/aiDesk/liveCall takeMessage).
import { takeMessage } from "@/lib/aiDesk/liveCall";
import { leadCallMessage } from "@/lib/aiDesk/leadCalls";
import { deskRequest, json, str } from "../route-helpers";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const r = await deskRequest(req);
  if (!r.ok) return r.res;
  // On the desk's own call to a lead the message joins that lead (lib/aiDesk/leadCalls) — never a second lead.
  if (r.token.kind === "lead") return json(await leadCallMessage(r.token, { name: str(r.body.name, 120), phone: str(r.body.phone, 40) || r.token.from, about: str(r.body.about, 2000) }));
  return json(await takeMessage(r.token.organizationId, r.token.callSid, { name: str(r.body.name, 120), phone: str(r.body.phone, 40) || r.token.from, about: str(r.body.about, 2000) }));
}
