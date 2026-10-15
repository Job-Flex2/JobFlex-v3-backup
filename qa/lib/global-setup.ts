// Before the first test: the server answers, the production guard holds for the selected
// suites, the database is a local one (for the suites that read or write it), and each role
// has a signed-in state (kept from the last run when still valid — the sign-in brake).
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { baseUrl, runDir } from "./env";
import { assertSuiteAllowed, targetKind } from "./target";
import { assertLocalDatabase } from "./db";
import { SIGNED_IN, authFile, credentials, sessionEmail, signInRole } from "./roles";

export default async function globalSetup(): Promise<void> {
  const dir = runDir();
  fs.mkdirSync(dir, { recursive: true });
  const suites = (process.env.QA_SUITES || "all").split(",").filter(Boolean);
  const kind = targetKind();
  for (const s of suites) if (s !== "all") assertSuiteAllowed(s);
  if (kind === "local" && suites.some((s) => s !== "perf")) assertLocalDatabase();

  // The server: up and answering as JobFlex (the logic suite alone needs none).
  if (suites.length && suites.every((s) => s === "logic")) {
    fs.writeFileSync(path.join(dir, "setup.json"), "[]");
    return;
  }
  const deadline = Date.now() + 180_000;
  let up = false;
  while (Date.now() < deadline && !up) {
    try {
      const r = await fetch(baseUrl() + "/auth/login", { signal: AbortSignal.timeout(120_000) });
      up = r.ok && /jobflex/i.test(await r.text());
    } catch { /* not yet */ }
    if (!up) await new Promise((r) => setTimeout(r, 3000));
  }
  if (!up) throw new Error(`QA Lab: ${baseUrl()} does not answer as JobFlex. Start the dev server first (qa/README.md → "Run").`);

  // Roles: only when a selected suite opens signed-in pages, and never against production.
  const setup: { role: string; ok: boolean; note: string }[] = [];
  const needsRoles = kind !== "production" && suites.some((s) => s === "all" || ["smoke", "roles", "pages", "forms", "visual", "perf", "billing"].includes(s));
  if (needsRoles) {
    const browser = await chromium.launch();
    try {
      for (const role of SIGNED_IN) {
        const file = authFile(role);
        if (!credentials(role)) {
          // A ready storage state in qa/auth/ is accepted as long as it is signed in.
          const who = await sessionEmail(browser, file);
          if (who) setup.push({ role, ok: true, note: "provided storage state" });
          else {
            fs.rmSync(file, { force: true });
            setup.push({ role, ok: false, note: `no credentials (QA_PASS_${role.toUpperCase()}) and no valid state — tests for this role are skipped` });
          }
          continue;
        }
        const r = await signInRole(browser, role);
        if (!r.ok) fs.rmSync(file, { force: true });
        setup.push({ role, ...r });
      }
    } finally {
      await browser.close();
    }
  }
  fs.writeFileSync(path.join(dir, "setup.json"), JSON.stringify(setup, null, 1));
  for (const s of setup) console.log(`  setup · ${s.role}: ${s.ok ? "ok" : "SKIPPED"} — ${s.note}`);
}
