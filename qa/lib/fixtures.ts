// The one `test` every spec imports. It adds, to every test, without a line in the spec:
//   · the production guard (lib/target.ts) — a write suite or a signed-in role is skipped
//     against production, before the browser opens;
//   · the role's storage state (test.use({ role: "owner" }));
//   · the forbidden-action guard (qa/config/forbidden.yaml);
//   · trackers answered with 204, and a made-up client address per context (the sign-in and
//     sign-up brakes count per network);
//   · the Vercel protection bypass on requests to a protected preview (lib/vercel.ts), the browser's
//     and the `request` fixture's;
//   · background collection (lib/collect.ts), a masked screenshot when the test fails, and the
//     collected events attached for the reporter.
import fs from "node:fs";
import { test as base, expect, type Page, type TestInfo } from "@playwright/test";
import { Collector } from "./collect";
import { installForbidden } from "./forbidden";
import { refusalFor } from "./target";
import { authFile, hasAuth, type RoleName } from "./roles";
import { baseUrl } from "./env";
import { qaConfig } from "./config";
import { redactDeep } from "./redact";
import { bypassHeaders } from "./vercel";

export { expect };

/** What a password or a code field looks like; masked in every screenshot. */
export const SECRET_FIELDS = 'input[type="password"], input[autocomplete="one-time-code"], input[name*="otp" i], input[id*="otp" i], input[id*="code" i][inputmode="numeric"], [data-qa-secret]';

export function masks(page: Page) {
  return [page.locator(SECRET_FIELDS)];
}

type Meta = Record<string, unknown>;
export type Qa = {
  collector: Collector;
  /** Facts about this test for raw.json (route, role, measured numbers…). */
  meta: (m: Meta) => void;
  /** Answers with these statuses are expected here (an unknown address → 404): not collected as errors. */
  expectStatus: (...codes: number[]) => void;
  /** A screenshot with the secret fields masked, attached to the test. */
  shot: (page: Page, name: string) => Promise<string>;
};

const octet = () => 1 + Math.floor(Math.random() * 250);

export const test = base.extend<{ role: RoleName; qa: Qa; _guard: void }>({
  role: ["guest", { option: true }],

  _guard: [
    async ({ role }, provide, testInfo) => {
      const why = refusalFor(testInfo.tags, role);
      if (why) testInfo.skip(true, why);
      if (!hasAuth(role)) testInfo.skip(true, `no signed-in state for the ${role} role (credentials missing or sign-in refused — see the run's setup notes)`);
      await provide();
    },
    { auto: true },
  ],

  // Playwright's own `request`, with the bypass header for a protected preview (none without the secret).
  request: async ({ playwright }, provide) => {
    const req = await playwright.request.newContext({ baseURL: baseUrl(), ignoreHTTPSErrors: true, extraHTTPHeaders: bypassHeaders() });
    await provide(req);
    await req.dispose();
  },

  storageState: async ({ role, storageState }, provide) => {
    if (role === "guest" || role === "homeowner") return provide(storageState);
    const file = authFile(role);
    await provide(fs.existsSync(file) ? file : storageState);
  },

  context: async ({ context }, provide, testInfo) => {
    const collector = new Collector();
    collector.attach(context);
    // a tag @expects-404 (or any @expects-NNN) declares an expected status for the whole test
    for (const tag of testInfo.tags) { const m = tag.match(/^@expects-(\d{3})$/); if (m) collector.expectStatus(Number(m[1])); }
    (testInfo as unknown as { __qaCollector: Collector }).__qaCollector = collector;
    await installForbidden(context, (hit) => collector.forbiddenHit(hit));
    const origin = new URL(baseUrl()).origin;
    const ip = `10.${octet()}.${octet()}.${octet()}`;
    const block = qaConfig().blockThirdParty.map((r) => new RegExp(r, "i"));
    await context.route("**/*", (route) => {
      const url = route.request().url();
      // `next dev -H 0.0.0.0` builds absolute links (Stripe's success_url) on 0.0.0.0, which a
      // browser refuses (ERR_ADDRESS_INVALID): send them to the server under test instead.
      if (/^https?:\/\/0\.0\.0\.0[:/]/.test(url)) {
        const to = origin + url.replace(/^https?:\/\/0\.0\.0\.0(:\d+)?/, "");
        return route.fulfill({ status: 302, headers: { location: to } });
      }
      if (url.startsWith(origin)) return route.fallback({ headers: { ...route.request().headers(), "x-forwarded-for": ip, ...bypassHeaders() } });
      if (block.some((r) => r.test(url))) return route.fulfill({ status: 204, body: "" });
      return route.fallback();
    });
    // Consent answered (analytics and marketing off): the banner never covers a control.
    const host = new URL(origin).hostname;
    await context.addCookies([{ name: "jf_consent", value: encodeURIComponent(JSON.stringify({ v: 1, at: new Date().toISOString(), analytics: false, marketing: false, ack: true })), domain: host, path: "/" }]);
    // tsx/esbuild name helpers inside page.evaluate with __name; the page has none.
    await context.addInitScript({ content: "window.__name = window.__name || function (f) { return f; };" });
    await provide(context);
  },

  qa: [
    async ({ context }, provide, testInfo) => {
      const collector = (testInfo as unknown as { __qaCollector?: Collector }).__qaCollector ?? new Collector();
      if (!(testInfo as unknown as { __qaCollector?: Collector }).__qaCollector) collector.attach(context);
      const meta: Meta = {};
      let shots = 0;
      const qa: Qa = {
        collector,
        meta: (m) => Object.assign(meta, m),
        expectStatus: (...codes) => {
          collector.expectStatus(...codes);
          meta.expectStatus = [...new Set([...((meta.expectStatus as number[] | undefined) ?? []), ...codes])];
        },
        shot: async (page, name) => {
          const file = testInfo.outputPath(`${String(++shots).padStart(2, "0")}-${name.replace(/[^a-z0-9-]+/gi, "-")}.png`);
          await page.screenshot({ path: file, mask: masks(page), fullPage: false, animations: "disabled" });
          await testInfo.attach(`qa-shot:${name}`, { path: file, contentType: "image/png" });
          return file;
        },
      };
      await provide(qa);
      await finishTest(testInfo, collector, meta);
    },
    { auto: true },
  ],
});

async function finishTest(testInfo: TestInfo, collector: Collector, meta: Meta): Promise<void> {
  const data = collector.finish();
  const forbidden = data.forbidden.length > 0;
  if (forbidden || (testInfo.status !== testInfo.expectedStatus && testInfo.status !== "skipped")) {
    const page = collector.lastPage();
    if (page) {
      const file = testInfo.outputPath("failure.png");
      try {
        await page.screenshot({ path: file, mask: masks(page), animations: "disabled", timeout: 10_000 });
        await testInfo.attach("qa-screenshot", { path: file, contentType: "image/png" });
      } catch { /* the page is gone */ }
    }
  }
  await testInfo.attach("qa-collect", { body: JSON.stringify(redactDeep(data)), contentType: "application/json" });
  if (Object.keys(meta).length) await testInfo.attach("qa-meta", { body: JSON.stringify(redactDeep(meta)), contentType: "application/json" });
  // A forbidden press or request fails the test, whatever the spec asserted.
  if (forbidden) throw new Error(`QA guard: forbidden action — ${data.forbidden.map((f) => `${f.kind} ${f.what}${f.why ? ` (${f.why})` : ""}`).join("; ")}`);
}

/** Opens a path, waits for the page to settle, returns the answer's status. */
export async function open(page: Page, path: string, opts: { timeout?: number; settleMs?: number } = {}) {
  const t0 = Date.now();
  const resp = await page.goto(baseUrl() + path, { waitUntil: "domcontentloaded", timeout: opts.timeout ?? 120_000 });
  await page.waitForLoadState("load", { timeout: 30_000 }).catch(() => {});
  if (opts.settleMs !== 0) await page.waitForTimeout(opts.settleMs ?? 800);
  return { status: resp?.status() ?? 0, ms: Date.now() - t0, finalPath: new URL(page.url()).pathname + new URL(page.url()).search };
}
