// A tool a call's brief brought (voice/call.mjs: anything but the desk's own). JobFlex's outreach calls bring theirs
// (lib/outreach/server outreachTool); the desk's call to a lead brings do_not_call (lib/aiDesk/leadCalls
// leadCallTool); a desk call answering its own line brings none, and asking here is refused.
import { appBaseUrl } from "@/lib/appUrl";
import { leadCallTool } from "@/lib/aiDesk/leadCalls";
import { outreachTool } from "@/lib/outreach/server";
import { deskRequest, json, str } from "../route-helpers";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const r = await deskRequest(req);
  if (!r.ok) return r.res;
  const args = r.body.args && typeof r.body.args === "object" ? (r.body.args as Record<string, unknown>) : {};
  if (r.token.kind === "lead") {
    const out = await leadCallTool(r.token, str(r.body.name, 60), args);
    return json(out, out.ok ? 200 : 400);
  }
  if (r.token.kind !== "outreach") return json({ ok: false, error: "no such tool on this call" }, 404);
  const out = await outreachTool(r.token, str(r.body.name, 60), args, (await appBaseUrl()).replace(/\/$/, ""));
  return json(out, out.ok ? 200 : 400);
}
