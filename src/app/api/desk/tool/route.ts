// A tool a call's brief brought (voice/call.mjs: anything but the desk's own). JobFlex's outreach calls bring theirs
// (lib/outreach/server outreachTool); a call about a lead SmartBook is scheduling — its own call, or the lead calling
// the desk — brings request_time and not_interested (lib/smartbook/phone smartBookTool).
import { appBaseUrl } from "@/lib/appUrl";
import { outreachTool } from "@/lib/outreach/server";
import { smartBookTool } from "@/lib/smartbook/phone";
import { deskRequest, json, str } from "../route-helpers";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const r = await deskRequest(req);
  if (!r.ok) return r.res;
  const args = r.body.args && typeof r.body.args === "object" ? (r.body.args as Record<string, unknown>) : {};
  const name = str(r.body.name, 60);
  const out = r.token.kind === "outreach" ? await outreachTool(r.token, name, args, (await appBaseUrl()).replace(/\/$/, "")) : await smartBookTool(r.token, name, args);
  return json(out, out.ok ? 200 : out.error.startsWith("no such tool") ? 404 : 400);
}
