// The desk takes a message (lib/aiDesk/liveCall takeMessage) — on a call about a lead SmartBook is scheduling, onto
// that lead (lib/smartbook/engine messageOnCall), never a second one.
import { db } from "@/lib/db";
import { takeMessage } from "@/lib/aiDesk/liveCall";
import { messageOnCall } from "@/lib/smartbook/engine";
import { leadForToken } from "@/lib/smartbook/phone";
import { deskRequest, json, str } from "../route-helpers";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const r = await deskRequest(req);
  if (!r.ok) return r.res;
  const lead = await leadForToken(r.token);
  if (lead) {
    const about = str(r.body.about, 2000);
    if (!about) return json({ ok: false, error: "What is the message about?" });
    const ok = await messageOnCall(r.token.organizationId, lead, about);
    if (ok) await db.aiPhoneCall.updateMany({ where: { callSid: r.token.callSid }, data: { leadId: lead, summary: `Message: ${about.slice(0, 100)}` } }).catch(() => null);
    return json(ok ? { ok: true } : { ok: false, error: "The message couldn't be saved — say someone will call back." });
  }
  return json(await takeMessage(r.token.organizationId, r.token.callSid, { name: str(r.body.name, 120), phone: str(r.body.phone, 40) || r.token.from, about: str(r.body.about, 2000) }));
}
