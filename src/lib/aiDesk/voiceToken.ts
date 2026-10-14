// The live desk's wiring — server only.
//
// The app and the voice server share one secret (VOICE_SERVER_SECRET). The app signs a
// call token into the <Stream> TwiML (callSid, company, caller, an expiry); the server
// carries it on every internal call, and the app verifies it there — so a call can only
// act for the company it belongs to, and only while it lasts.
import { createHmac, timingSafeEqual } from "node:crypto";

export type CallToken = { callSid: string; organizationId: string; from: string; exp: number };

const secret = () => process.env.VOICE_SERVER_SECRET || "";

/** The live desk is on when the app knows where the voice server is and shares its secret. */
export function voiceServerConfigured(): boolean {
  return Boolean(process.env.VOICE_SERVER_URL && secret());
}

export function voiceStreamUrl(): string | null {
  const base = (process.env.VOICE_SERVER_URL || "").replace(/\/$/, "");
  return base ? `${base}/twilio/stream` : null;
}

const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64url");
const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

export function signCallToken(t: Omit<CallToken, "exp">, ttlMs = 2 * 3600_000): string {
  const payload = b64(JSON.stringify({ ...t, exp: Date.now() + ttlMs }));
  return `${payload}.${sign(payload)}`;
}

export function verifyCallToken(token: string | null | undefined): CallToken | null {
  if (!token || !secret()) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const t = JSON.parse(Buffer.from(payload, "base64url").toString()) as CallToken;
    if (!t.callSid || !t.organizationId || typeof t.exp !== "number" || t.exp < Date.now()) return null;
    return t;
  } catch {
    return null;
  }
}

/** The voice server's calls carry the shared secret in a header. Fail-closed: no secret, no access. */
export function deskRequestAuthorized(req: Request): boolean {
  const s = secret();
  const given = req.headers.get("x-desk-secret");
  if (!s || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(s);
  return a.length === b.length && timingSafeEqual(a, b);
}
