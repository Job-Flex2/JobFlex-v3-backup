// The voice server asks what the desk needs for this call (lib/aiDesk/liveCall callBrief).
import { callBrief } from "@/lib/aiDesk/liveCall";
import { outreachBrief } from "@/lib/outreach/server";
import { smartBookCallBrief } from "@/lib/smartbook/phone";
import { deskRequest, json } from "../route-helpers";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const r = await deskRequest(req);
  if (!r.ok) return r.res;
  // JobFlex's own outreach call to a contractor (lib/outreach): its own script and tools. SmartBook's call to a lead
  // (lib/smartbook/phone): the desk's knowledge on SmartBook's script.
  const brief =
    r.token.kind === "outreach"
      ? await outreachBrief(r.token)
      : r.token.kind === "smartbook"
        ? await smartBookCallBrief(r.token)
        : await callBrief({ callSid: r.token.callSid, organizationId: r.token.organizationId, from: r.token.from });
  return json(brief, brief.ok ? 200 : 404);
}
