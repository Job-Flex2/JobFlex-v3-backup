// QA Lab — Playwright configuration. Normally started by `npm run qa` (qa/bin/qa.ts), which
// picks the server, checks the production guard and names the run folder; a bare
// `npx playwright test -c qa/playwright.config.ts` works too and gets the same guards.
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { baseUrl, runDir } from "./lib/env";

const RUN = runDir();
const grepAll = process.env.QA_GREP ? new RegExp(process.env.QA_GREP) : undefined;
// WebKit runs only what is tagged @webkit (the phone checks), inside the selected suites.
const grepWebkit = new RegExp(`^(?=.*@webkit)${process.env.QA_GREP ? `(?=.*(?:${process.env.QA_GREP}))` : ""}`);

const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

export default defineConfig({
  testDir: path.join(__dirname, "tests"),
  testMatch: ["**/*.spec.ts"],
  testIgnore: ["**/_archive/**", "**/_lib/**"],
  outputDir: path.join(RUN, ".pw"),
  globalSetup: path.join(__dirname, "lib", "global-setup.ts"),
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: Number(process.env.QA_WORKERS || (process.env.CI ? 2 : 3)),
  reporter: [["list", { printSteps: false }], [path.join(__dirname, "lib", "reporter.ts")]],
  use: {
    baseURL: baseUrl(),
    // Our own masked screenshot on failure (lib/fixtures.ts); Playwright's would show passwords.
    screenshot: "off",
    trace: "retain-on-failure",
    video: "off",
    locale: "en-US",
    timezoneId: "America/Los_Angeles",
    navigationTimeout: 120_000,
    actionTimeout: 20_000,
    ignoreHTTPSErrors: true,
  },
  projects: [
    {
      name: "chromium",
      grep: grepAll,
      use: { ...devices["Desktop Chrome"], ...phone, userAgent: devices["iPhone 15"].userAgent },
    },
    {
      name: "webkit",
      grep: grepWebkit,
      use: { ...devices["iPhone 15"], viewport: phone.viewport },
    },
  ],
});
