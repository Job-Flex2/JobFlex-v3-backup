// The pass a blueprint estimate runs on. Server-only.
//
// Reading a plan set is one sheet per request (a 30-sheet set never fits one request),
// and pricing it is one trade per request (a whole house never fits one function's
// time). Each of those requests is a model call, and a card-less trial is capped at a
// handful of them — so the cap is taken ONCE, when the plan set is opened, and the
// requests after it carry this signed pass instead: the organization it was issued to,
// a nonce the per-pass rate limit counts against, and an expiry.
import "server-only";
import crypto from "node:crypto";

export type PlanPass = { organizationId: string; nonce: string; exp: number };

/** Long enough to read a big set, review the takeoff over coffee and price it. */
const TTL_MS = 6 * 60 * 60 * 1000;

function secret(): string {
  const key = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET;
  if (!key?.trim()) throw new Error("Plan reading is not configured on this server.");
  return key;
}

const sign = (body: string) => crypto.createHmac("sha256", secret()).update(`plans:${body}`).digest("base64url");

export function issuePlanPass(organizationId: string): { token: string; pass: PlanPass } {
  const pass: PlanPass = { organizationId, nonce: crypto.randomBytes(12).toString("base64url"), exp: Date.now() + TTL_MS };
  const body = Buffer.from(JSON.stringify(pass)).toString("base64url");
  return { token: `${body}.${sign(body)}`, pass };
}

/** The pass, when the token is ours, unexpired and issued to this organization. */
export function readPlanPass(token: string | null | undefined, organizationId: string): PlanPass | null {
  if (!token || token.length > 1024) return null;
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  try {
    const expected = sign(body);
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const p = JSON.parse(Buffer.from(body, "base64url").toString()) as PlanPass;
    if (p.organizationId !== organizationId || typeof p.nonce !== "string" || !p.nonce) return null;
    if (!Number.isSafeInteger(p.exp) || Date.now() >= p.exp) return null;
    return p;
  } catch {
    return null;
  }
}
