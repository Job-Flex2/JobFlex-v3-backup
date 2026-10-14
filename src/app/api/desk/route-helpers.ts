// The voice server's internal API (lib/aiDesk/liveCall): one way in for every route —
// the shared secret in a header, the call's signed token in the body.
import { NextResponse } from "next/server";
import { deskRequestAuthorized, verifyCallToken, type CallToken } from "@/lib/aiDesk/voiceToken";

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

export async function deskRequest(req: Request): Promise<{ ok: true; token: CallToken; body: Record<string, unknown> } | { ok: false; res: NextResponse }> {
  if (!deskRequestAuthorized(req)) return { ok: false, res: json({ ok: false, error: "forbidden" }, 403) };
  let body: Record<string, unknown> = {};
  try {
    const raw: unknown = await req.json();
    if (raw && typeof raw === "object") body = raw as Record<string, unknown>;
  } catch {
    return { ok: false, res: json({ ok: false, error: "bad body" }, 400) };
  }
  const token = verifyCallToken(typeof body.token === "string" ? body.token : null);
  if (!token) return { ok: false, res: json({ ok: false, error: "bad token" }, 403) };
  return { ok: true, token, body };
}

export const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
