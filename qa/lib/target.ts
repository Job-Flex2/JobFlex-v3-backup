// What the server under test is, and what may run against it. Enforced in code, twice:
// bin/qa.ts refuses before Playwright starts, and every test's fixture (lib/fixtures.ts) refuses
// again, so a bare `npx playwright test` against production cannot write either.
import { baseUrl } from "./env";
import { qaConfig } from "./config";
import { SUITES } from "./raw";

export type TargetKind = "local" | "preview" | "production";

/** This machine or the LAN (a phone on the same Wi-Fi reaches the dev server that way). */
export function isLocalHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h === "::1" || h.endsWith(".localhost") || h.endsWith(".local")) return true;
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

/** production unless proven otherwise: VERCEL_ENV=production, a listed production host, or any
 *  remote host without QA_TARGET_ENV=preview. */
export function targetKind(url = baseUrl()): TargetKind {
  const host = new URL(url).hostname.toLowerCase();
  if (process.env.VERCEL_ENV === "production") return "production";
  if (qaConfig().productionHosts.some((p) => host === p || host.endsWith("." + p))) return "production";
  if (isLocalHost(host)) return "local";
  return process.env.QA_TARGET_ENV === "preview" ? "preview" : "production";
}

/** Suites that write (accounts, payments, records) or sign in as non-guest roles. */
export const WRITE_SUITES = ["signup", "billing", "forms", "roles"] as const;

/** Throws when `suite` may not run against the target. */
export function assertSuiteAllowed(suite: string, url = baseUrl()): void {
  const kind = targetKind(url);
  if (kind === "local") return;
  const allowed = qaConfig().productionSuites;
  if (kind === "production" && !allowed.includes(suite)) {
    throw new Error(`QA guard: the "${suite}" suite never runs against production (${new URL(url).host}). Allowed there: ${allowed.join(", ")}.`);
  }
  if (kind === "preview" && (WRITE_SUITES as readonly string[]).includes(suite) && !previewWritesAllowed()) {
    throw new Error(`QA guard: "${suite}" writes; against a preview deployment it needs QA_ALLOW_PREVIEW_WRITES=1 (and a preview database).`);
  }
}

/** A preview may be written to only when it has its own database: on this project the Preview
 *  environment shares Production's DATABASE_URL (2026-10-22, docs/qa-ci.md), so a preview is
 *  read-only unless QA_ALLOW_PREVIEW_WRITES=1 says otherwise. */
export function previewWritesAllowed(): boolean {
  return process.env.QA_ALLOW_PREVIEW_WRITES === "1";
}

/** The guard a single test applies: write tags and signed-in roles are refused on production;
 *  write tags on a preview without its own database. */
export function refusalFor(tags: string[], role: string, url = baseUrl()): string | null {
  const kind = targetKind(url);
  if (kind === "local") return null;
  const names = tags.map((t) => t.replace(/^@/, ""));
  // Only suite tags are suites: @webkit, @money, @expects-404 say something else about the test (they
  // used to be refused against production as "suites", which skipped half of the guest smoke there).
  for (const s of names.filter((n) => (SUITES as readonly string[]).includes(n))) {
    try { assertSuiteAllowed(s, url); } catch (e) { return (e as Error).message; }
  }
  const suites = names;
  if (kind === "production") {
    if (suites.includes("writes")) return "QA guard: this test writes (@writes) — skipped against production.";
    if (suites.includes("legacy")) return "QA guard: the old checks (@legacy) never run against production.";
    if (role !== "guest") return `QA guard: against production only guest pages are opened (role ${role} refused).`;
  }
  if (kind === "preview" && suites.includes("writes") && !previewWritesAllowed()) {
    return "QA guard: this test writes (@writes) — skipped against a preview on the production database (QA_ALLOW_PREVIEW_WRITES is not 1).";
  }
  return null;
}
