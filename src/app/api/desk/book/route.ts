// The desk books one of the open times (lib/aiDesk/liveCall bookVisit).
import { bookVisit } from "@/lib/aiDesk/liveCall";
import { deskRequest, json, str } from "../route-helpers";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const r = await deskRequest(req);
  if (!r.ok) return r.res;
  return json(await bookVisit(r.token.organizationId, r.token.callSid, { timeId: str(r.body.timeId, 120), name: str(r.body.name, 120), phone: str(r.body.phone, 40) || r.token.from, address: str(r.body.address, 300) || null, notes: str(r.body.notes, 500) || null }));
}
