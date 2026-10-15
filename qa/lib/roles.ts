// The people a test can be. Accounts come from .env.local / .env by name —
// QA_USER_<ROLE> / QA_PASS_<ROLE> — or from a ready storage state in qa/auth/<role>.json.
// `npm run qa:seed-roles` makes the local accounts (qa/bin/seed-roles.ts, qa/README.md).
//
//   guest      nobody signed in
//   owner      qa@acme.test — OWNER of QA Co (CLAUDE.md: the automation account)
//   manager    MANAGER seat in QA Co        (the full dashboard, no billing ownership)
//   worker     INSTALLER seat in QA Co      (jobs, calendar, messages — lib/roleRoutes)
//   admin      a platform admin (/admin), no seat in any organisation
//   homeowner  never signed in: a homeowner reaches the app only by links (a /home/<key>, a
//              /request/<token>, a /portal/q/<id>, a /review/<token>); the matrix opens those
//              links with real tokens from QA Co's records (lib/params.ts)
import fs from "node:fs";
import path from "node:path";
import type { Browser } from "@playwright/test";
import { AUTH_DIR, baseUrl } from "./env";

export const ROLES = ["guest", "owner", "manager", "worker", "admin", "homeowner"] as const;
export type RoleName = (typeof ROLES)[number];
export const SIGNED_IN: RoleName[] = ["owner", "manager", "worker", "admin"];

export const DEFAULT_USERS: Partial<Record<RoleName, string>> = {
  owner: "qa@acme.test",
  manager: "qa-manager@qa.jobflex.test",
  worker: "qa-worker@qa.jobflex.test",
  admin: "qa-admin@qa.jobflex.test",
};

export function credentials(role: RoleName): { email: string; password: string } | null {
  const key = role.toUpperCase();
  const email = process.env[`QA_USER_${key}`] || DEFAULT_USERS[role];
  const password = process.env[`QA_PASS_${key}`];
  return email && password ? { email, password } : null;
}

/** One storage state per role and server: cookies are per host. */
export function authFile(role: RoleName, url = baseUrl()): string {
  const host = new URL(url).host.replace(/[^a-z0-9]/gi, "_");
  return path.join(AUTH_DIR, `${role}.${host}.json`);
}

export function hasAuth(role: RoleName): boolean {
  return role === "guest" || role === "homeowner" || fs.existsSync(authFile(role));
}

/** Who a saved state is signed in as (null when it is not), without spending a sign-in. */
export async function sessionEmail(browser: Browser, file: string): Promise<string | null> {
  if (!fs.existsSync(file)) return null;
  const ctx = await browser.newContext({ storageState: file });
  try {
    const r = await ctx.request.get(baseUrl() + "/api/auth/session", { timeout: 60_000 });
    const j = (await r.json().catch(() => null)) as { user?: { email?: string } } | null;
    return j?.user?.email ?? null;
  } catch {
    return null;
  } finally {
    await ctx.close();
  }
}

/**
 * Signs `role` in with its password through the real sign-in page, once, and saves the state.
 * The sign-in brake allows 8 tries per address per 15 minutes (lib/auth): a kept, still-valid
 * state is always reused, and a refusal is never retried.
 */
export async function signInRole(browser: Browser, role: RoleName): Promise<{ ok: boolean; note: string }> {
  const creds = credentials(role);
  if (!creds) return { ok: false, note: `no QA_PASS_${role.toUpperCase()} — role skipped (npm run qa:seed-roles, qa/README.md)` };
  const file = authFile(role);
  const who = await sessionEmail(browser, file);
  if (who && who.toLowerCase() === creds.email.toLowerCase()) return { ok: true, note: "kept session" };
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: {} });
  const page = await ctx.newPage();
  try {
    // ?email= fills the field server-side; a dev server otherwise starts it on owner@acme.test.
    await page.goto(`${baseUrl()}/auth/login?email=${encodeURIComponent(creds.email)}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.locator("#loginEmail").waitFor({ timeout: 90_000 });
    await page.waitForTimeout(1500); // hydration: a fill before it is put back by the form's state
    await page.locator('[data-consent="accept-all"], [data-consent="reject-all"]').first().click({ timeout: 1500 }).catch(() => {});
    for (let i = 0; i < 5 && (await page.inputValue("#loginEmail")) !== creds.email; i++) {
      await page.fill("#loginEmail", creds.email);
      await page.waitForTimeout(400);
    }
    if ((await page.inputValue("#loginEmail")) !== creds.email) return { ok: false, note: "the email field would not hold the address — nothing submitted" };
    if (!(await page.locator("#loginPassword").isVisible().catch(() => false))) await page.click("#usePasswordLink");
    await page.fill("#loginPassword", creds.password);
    await Promise.all([
      page.waitForURL((u) => !u.pathname.startsWith("/auth/login"), { timeout: 60_000 }).catch(() => {}),
      page.click("#signInBtn"),
    ]);
    if (new URL(page.url()).pathname.startsWith("/auth/login")) {
      const msg = (await page.locator('[role="alert"], .err, [data-err]').first().innerText().catch(() => "")).trim();
      return { ok: false, note: `sign-in refused${msg ? ": " + msg.slice(0, 120) : ""} (wrong password, or the brake: 8 tries / 15 min)` };
    }
    fs.mkdirSync(AUTH_DIR, { recursive: true });
    await ctx.storageState({ path: file });
    const now = await sessionEmail(browser, file);
    if (!now || now.toLowerCase() !== creds.email.toLowerCase()) {
      fs.rmSync(file, { force: true });
      return { ok: false, note: `signed in as ${now ?? "nobody"}, not the ${role} account — state discarded` };
    }
    return { ok: true, note: "signed in" };
  } catch (e) {
    return { ok: false, note: String((e as Error).message).split("\n")[0].slice(0, 200) };
  } finally {
    await ctx.close();
  }
}
