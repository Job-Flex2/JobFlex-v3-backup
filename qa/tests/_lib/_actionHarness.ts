// Calling the REAL server actions as a chosen member, outside Next (2026-10-12).
// Carried over from the security / money audit's harness (.cache/audit/sec).
// Import FIRST in a check:
//
//   import { actAs, check, outcome, summary } from "./_actionHarness";
//
// - the database is the local dev database the other checks use; a check
//   makes its own throwaway organisations (isInternal) and removes them;
// - every outside service is switched off: its keys are blanked and fetch
//   refuses, so nothing a check calls can spend money or mail anyone;
// - next/headers, next/cache, next/server and src/lib/auth resolve to the
//   stand-ins in ./_stubs, so an action runs as whoever actAs() names.
import "./_server-only";
import Module from "node:module";
import path from "node:path";

process.env.NEXTAUTH_SECRET = "qa-local-secret-not-a-real-key-000000000000";
process.env.AUTH_SECRET = process.env.NEXTAUTH_SECRET;
for (const k of [
  "DIRECT_URL", "GOOGLE_CLIENT_SECRET", "OPENAI_API_KEY", "SERPAPI_API_KEY", "STRIPE_SECRET_KEY", "STRIPE_SECRET_KEY_TEST", "STRIPE_WEBHOOK_SECRET",
  "SQUARE_ACCESS_TOKEN", "PAYPAL_CLIENT_SECRET", "RESEND_API_KEY", "SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN",
  "TWILIO_VERIFY_SERVICE_SID", "GMAIL_OAUTH_CLIENT_SECRET", "FAL_KEY", "REGRID_API_KEY", "EAGLEVIEW_CLIENT_ID", "EAGLEVIEW_CLIENT_SECRET", "GOOGLE_MAPS_API_KEY",
  "BLOB_READ_WRITE_TOKEN", "BLOB_PRIVATE_READ_WRITE_TOKEN", "META_CAPI_ACCESS_TOKEN", "POSTHOG_PERSONAL_API_KEY", "REPORTALL_CLIENT_KEY", "ADMIN_USERNAME",
  "ADMIN_PASSWORD", "CRON_SECRET", "COOLCALC_CLIENT_ID", "COOLCALC_API_KEY", "COOLCALC_DEALER_ID",
]) process.env[k] = "";
(process.env as Record<string, string>).NODE_ENV = "production";
globalThis.fetch = (async (u: unknown) => { throw new Error(`qa: network is off (${String(u).slice(0, 60)})`); }) as typeof fetch;

const STUBS = path.resolve(__dirname, "_stubs");
const M = Module as unknown as { _resolveFilename: (r: string, ...rest: unknown[]) => string };
const resolve = M._resolveFilename;
M._resolveFilename = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "next/headers") return path.join(STUBS, "next-headers.js");
  if (request === "next/cache") return path.join(STUBS, "next-cache.js");
  if (request === "next/server" && !(rest[0] as { filename?: string })?.filename?.includes("_stubs")) return path.join(STUBS, "next-server.js");
  const out = resolve.call(this, request, ...rest);
  if (out.split(path.sep).join("/").endsWith("/src/lib/auth.ts")) return path.join(STUBS, "auth.js");
  // a verification text is recorded, never sent (stubs/sms-verify.js; sentSms() below)
  if (out.split(path.sep).join("/").endsWith("/src/lib/sms/verify.ts")) return path.join(STUBS, "sms-verify.js");
  return out;
};

// A layout or page that imports a stylesheet can be called too: Next bundles
// the CSS, plain node has nothing to do with it.
(Module as unknown as { _extensions: Record<string, unknown> })._extensions[".css"] = () => {};

type G = typeof globalThis & { __auditSession?: unknown; __auditHeaders?: Record<string, string> };
/** Every later call runs as this member (null = signed out). */
/** The verification texts the actions asked for in this process (stubs/sms-verify.js). */
export function sentSms(): { kind: string; to: string; channel: string; body: string }[] {
  return ((globalThis as unknown as { __qaSms?: { kind: string; to: string; channel: string; body: string }[] }).__qaSms ??= []);
}

export function actAs(user: { id: string; activeOrgId?: string | null } | null) {
  (globalThis as G).__auditSession = user ? { user: { id: user.id, activeOrgId: user.activeOrgId ?? null, credentialVersion: 0, principal: "USER" } } : null;
}
export function setHeaders(h: Record<string, string>) {
  (globalThis as G).__auditHeaders = h;
}

let passes = 0;
let failures = 0;
export function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) passes++;
  else failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || detail === undefined ? "" : " — " + String(typeof detail === "string" ? detail : JSON.stringify(detail)).slice(0, 300)}`);
}
/** The last line run-all shows; returns the failure count. */
export function summary() {
  console.log(`${passes} passed, ${failures} failed`);
  return failures;
}

/** Run fn; "refused" = it threw or answered { ok: false }. */
export async function outcome(fn: () => Promise<unknown>): Promise<{ refused: boolean; text: string; value?: unknown }> {
  try {
    const v = await fn();
    if (v && typeof v === "object" && "ok" in v && (v as { ok: unknown }).ok === false) return { refused: true, text: JSON.stringify(v).slice(0, 200), value: v };
    return { refused: false, text: JSON.stringify(v ?? null).slice(0, 200), value: v };
  } catch (err) {
    return { refused: true, text: err instanceof Error ? `${err.name}: ${err.message}`.slice(0, 200) : String(err) };
  }
}
