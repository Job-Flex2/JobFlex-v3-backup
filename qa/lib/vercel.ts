// Vercel Deployment Protection (Vercel Authentication) answers every request to a preview with a
// 302 to vercel.com/sso-api. A run against a preview carries the project's "Protection Bypass for
// Automation" secret (VERCEL_AUTOMATION_BYPASS_SECRET; docs/qa-ci.md says where it lives) in the
// x-vercel-protection-bypass header — on requests to the server under test only, never to a third
// party. x-vercel-set-bypass-cookie asks Vercel for its bypass cookie too, so the requests the page
// makes on its own (a context's request API, a context opened from a saved state) pass as well.
import type { BrowserContext } from "@playwright/test";
import { baseUrl } from "./env";

export function bypassSecret(): string | null {
  return process.env.VERCEL_AUTOMATION_BYPASS_SECRET || null;
}

/** The headers for one request to the server under test; {} when no secret is set. */
export function bypassHeaders(): Record<string, string> {
  const s = bypassSecret();
  return s ? { "x-vercel-protection-bypass": s, "x-vercel-set-bypass-cookie": "true" } : {};
}

/** Adds the bypass headers to this context's same-origin requests (a context lib/fixtures did not make). */
export async function installBypass(ctx: BrowserContext): Promise<void> {
  if (!bypassSecret()) return;
  const origin = new URL(baseUrl()).origin;
  await ctx.route((u) => u.origin === origin, (route) => route.fallback({ headers: { ...route.request().headers(), ...bypassHeaders() } }));
}

/** A 302/401 from Vercel's own sign-in wall rather than from the app. */
export function isVercelWall(status: number, location: string | null): boolean {
  return (status === 401 || status === 302 || status === 307) && /vercel\.com\/(sso-api|login)/.test(location ?? "");
}
