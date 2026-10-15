// PERF — Lighthouse (performance, accessibility, best practices) on a phone and on a desk for the
// key pages (qa/config/qa.config.yaml → perf.pages). Scores under perf.minScores become findings
// in the analysis; the test itself fails only when Lighthouse cannot measure the page.
// On a dev server the performance score is not the production one (no minification, on-demand
// compiles); compare runs against the same kind of server.
import fs from "node:fs";
import { chromium } from "@playwright/test";
import { test, expect } from "../../lib/fixtures";
import { qaConfig } from "../../lib/config";
import { baseUrl } from "../../lib/env";
import { authFile, type RoleName } from "../../lib/roles";

test.describe.configure({ mode: "serial" }); // one Chrome at a time: parallel runs skew the timings

const cfg = qaConfig();

type Audit = { id: string; title: string; score: number | null; scoreDisplayMode: string; displayValue?: string; numericValue?: number };
type Lhr = { categories: Record<string, { score: number | null }>; audits: Record<string, Audit>; finalDisplayedUrl?: string; finalUrl?: string; fetchTime?: string; runWarnings?: string[] };

function cookieHeader(role: RoleName): string | undefined {
  if (role === "guest" || role === "homeowner") return undefined;
  const file = authFile(role);
  if (!fs.existsSync(file)) return undefined;
  const state = JSON.parse(fs.readFileSync(file, "utf8")) as { cookies: { name: string; value: string; domain: string }[] };
  const host = new URL(baseUrl()).hostname;
  return state.cookies.filter((c) => host.endsWith(c.domain.replace(/^\./, ""))).map((c) => `${c.name}=${c.value}`).join("; ");
}

for (const { path, role } of cfg.perf.pages) {
  for (const form of ["mobile", "desktop"] as const) {
    test(`lighthouse ${path} ${form} @perf`, async ({ qa }, info) => {
      test.skip(info.project.name !== "chromium", "Lighthouse runs in Chromium");
      test.setTimeout(6 * 60_000);
      const cookie = cookieHeader(role as RoleName);
      test.skip(role !== "guest" && !cookie, `no signed-in state for ${role}`);
      const { default: lighthouse } = (await import("lighthouse")) as unknown as { default: (url: string, flags: Record<string, unknown>, config?: unknown) => Promise<{ lhr: Lhr } | undefined> };
      const { launch } = (await import("chrome-launcher")) as unknown as { launch: (o: Record<string, unknown>) => Promise<{ port: number; kill: () => Promise<void> | void }> };
      const desktopConfig = form === "desktop" ? ((await import("lighthouse/core/config/desktop-config.js")) as { default: unknown }).default : undefined;
      // Warm the route first: a dev server compiles it on the first visit.
      await fetch(baseUrl() + path, { headers: cookie ? { cookie } : {}, signal: AbortSignal.timeout(180_000) }).catch(() => {});
      const chrome = await launch({ chromePath: chromium.executablePath(), chromeFlags: ["--headless=new", "--no-first-run", "--disable-gpu"] });
      try {
        const result = await lighthouse(
          baseUrl() + path,
          { port: chrome.port, output: "json", logLevel: "error", onlyCategories: ["performance", "accessibility", "best-practices"], extraHeaders: cookie ? { Cookie: cookie } : undefined, disableStorageReset: true },
          desktopConfig,
        );
        expect(result?.lhr, "Lighthouse produced a report").toBeTruthy();
        const lhr = result!.lhr;
        const scores = Object.fromEntries(Object.entries(lhr.categories as Record<string, { score: number | null }>).map(([k, v]) => [k, v.score == null ? null : Math.round(v.score * 100)]));
        const audit = (id: string) => (lhr.audits?.[id]?.numericValue as number | undefined) ?? null;
        const metrics = { fcpMs: audit("first-contentful-paint"), lcpMs: audit("largest-contentful-paint"), tbtMs: audit("total-blocking-time"), cls: audit("cumulative-layout-shift"), speedIndexMs: audit("speed-index") };
        const below = Object.entries(cfg.perf.minScores).filter(([k, min]) => scores[k] != null && (scores[k] as number) < min).map(([k, min]) => `${k} ${scores[k]} < ${min}`);
        const finalUrl = String(lhr.finalDisplayedUrl ?? lhr.finalUrl ?? "");
        const file = info.outputPath(`lighthouse-${form}-${path.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "home"}.json`);
        // the categories and audits that matter, not the whole 1 MB report
        const slim = { finalUrl, fetchTime: lhr.fetchTime, formFactor: form, categories: scores, metrics, failing: Object.values(lhr.audits as Record<string, { id: string; title: string; score: number | null; scoreDisplayMode: string; displayValue?: string }>).filter((a) => a.score !== null && a.score < 0.5 && a.scoreDisplayMode !== "informative").map((a) => ({ id: a.id, title: a.title, score: a.score, displayValue: a.displayValue })).slice(0, 40), runWarnings: lhr.runWarnings };
        fs.writeFileSync(file, JSON.stringify(slim, null, 1));
        await info.attach("qa-lighthouse", { path: file, contentType: "application/json" });
        qa.meta({ kind: "lighthouse", route: path, role, formFactor: form, scores, metrics, below, finalUrl });
        if (below.length) info.annotations.push({ type: "below-threshold", description: below.join(", ") });
        expect(new URL(finalUrl || baseUrl()).pathname.startsWith("/auth/login") && role !== "guest", "Lighthouse was sent to the sign-in page").toBe(false);
      } finally {
        await chrome.kill();
      }
    });
  }
}
