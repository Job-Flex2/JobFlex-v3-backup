// The next open visits for the caller (lib/aiDesk/liveCall openTimes).
import { openTimes } from "@/lib/aiDesk/liveCall";
import { deskRequest, json, str } from "../route-helpers";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const r = await deskRequest(req);
  if (!r.ok) return r.res;
  const days = Number(r.body.days);
  return json(await openTimes(r.token.organizationId, str(r.body.service, 200) || null, Number.isFinite(days) ? days : 7));
}
