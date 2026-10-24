// A tool a call's brief brought (voice/call.mjs: anything but the desk's own). Today only JobFlex's outreach calls
// bring tools (lib/outreach/server outreachTool); a desk call asking here is refused.
import { appBaseUrl } from "@/lib/appUrl";
import { outreachTool } from "@/lib/outreach/server";
import { deskRequest, json, str } from "../route-helpers";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const r = await deskRequest(req);
  if (!r.ok) return r.res;
  if (r.token.kind !== "outreach") return json({ ok: false, error: "no such tool on this call" }, 404);
  const args = r.body.args && typeof r.body.args === "object" ? (r.body.args as Record<string, unknown>) : {};
  const out = await outreachTool(r.token, str(r.body.name, 60), args, (await appBaseUrl()).replace(/\/$/, ""));
  return json(out, out.ok ? 200 : 400);
}
