// The emailed code, read through the app's test endpoint (GET /api/qa/otp, QA_TEST_MODE=1).
// Fetched by Node, not by the page or Playwright's request context, so the code never enters a
// trace; addSecret() masks it in everything the run writes.
import { baseUrl } from "./env";
import { addSecret } from "./redact";
import { bypassHeaders } from "./vercel";

export const QA_DOMAIN = "qa.jobflex.test";

/** qa-<label>-<timestamp>-<random>@qa.jobflex.test */
export function qaEmail(label: string): string {
  return `qa-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@${QA_DOMAIN}`;
}

/** The server runs the QA test mode with this QA_SECRET: the gate answers 400 for an address that is
 *  not a QA one (a closed gate is a bare 404). Nothing is read or written. */
export async function qaTestModeServing(): Promise<boolean> {
  const secret = process.env.QA_SECRET;
  if (!secret) return false;
  const r = await fetch(`${baseUrl()}/api/qa/otp?email=${encodeURIComponent("probe@example.com")}`, { headers: { "x-qa-secret": secret, ...bypassHeaders() }, signal: AbortSignal.timeout(60_000) }).catch(() => null);
  return r?.status === 400;
}

export type OtpEntry = { code: string | null; link: string | null; kind: string; at: number };

export class TestModeOff extends Error {}

/** Waits for a code newer than `after` (ms since epoch). Throws TestModeOff on a 404 gate. */
export async function fetchOtp(email: string, opts: { after?: number; timeoutMs?: number } = {}): Promise<OtpEntry> {
  const secret = process.env.QA_SECRET;
  if (!secret) throw new TestModeOff("QA_SECRET is not set (.env.local) — the test mode cannot be read");
  const until = Date.now() + (opts.timeoutMs ?? 30_000);
  let last = "";
  while (Date.now() < until) {
    const r = await fetch(`${baseUrl()}/api/qa/otp?email=${encodeURIComponent(email)}`, { headers: { "x-qa-secret": secret, ...bypassHeaders() }, signal: AbortSignal.timeout(60_000) }).catch((e: Error) => ({ status: 0, ok: false, json: async () => ({ error: e.message }) }) as unknown as Response);
    if (r.status === 404) {
      const body = (await r.json().catch(() => null)) as { found?: boolean } | null;
      if (!body) throw new TestModeOff("GET /api/qa/otp answered 404 — the server runs without QA_TEST_MODE=1, or its QA_SECRET is not this one");
    } else if (r.ok) {
      const j = (await r.json()) as OtpEntry & { found: boolean };
      if (j.found && (!opts.after || j.at >= opts.after)) {
        addSecret(j.code);
        if (j.link) addSecret(j.link.split("k=")[1]);
        return j;
      }
    } else last = `HTTP ${r.status}`;
    await new Promise((res) => setTimeout(res, 500));
  }
  throw new Error(`no code arrived for the address within ${Math.round((opts.timeoutMs ?? 30_000) / 1000)} s${last ? ` (${last})` : ""}`);
}
