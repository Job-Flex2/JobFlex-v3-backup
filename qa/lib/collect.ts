// BACKGROUND COLLECTION — on every test, through the fixtures (lib/fixtures.ts), never as a
// test of its own: console errors and warnings, uncaught exceptions, every 4xx/5xx answer,
// failed and hung requests, slow ones, page-load timings and the forbidden-action guard.
// Each event carries its time; the reporter (lib/reporter.ts) puts it under the test step
// that was running then. Every string is redacted before it is stored.
import type { BrowserContext, Page, Request } from "@playwright/test";
import { baseUrl } from "./env";
import { qaConfig } from "./config";
import { redact } from "./redact";
import type { ForbiddenHit } from "./forbidden";

export type ConsoleEvent = { t: number; type: string; text: string; url: string; location?: string };
export type PageErrorEvent = { t: number; message: string; stack?: string; url: string };
export type HttpErrorEvent = { t: number; status: number; method: string; url: string; resourceType: string; sameOrigin: boolean; page: string; body?: string };
export type FailedRequestEvent = { t: number; method: string; url: string; resourceType: string; error: string; sameOrigin: boolean; page: string };
export type SlowRequestEvent = { t: number; method: string; url: string; resourceType: string; ms: number; finished: boolean; sameOrigin: boolean; page: string };
export type NavigationEvent = { t: number; url: string; ttfbMs?: number; domContentLoadedMs?: number; loadMs?: number; transferKb?: number; status?: number };

export type Collected = {
  console: ConsoleEvent[];
  pageErrors: PageErrorEvent[];
  httpErrors: HttpErrorEvent[];
  failedRequests: FailedRequestEvent[];
  slowRequests: SlowRequestEvent[];
  hungRequests: SlowRequestEvent[];
  navigations: NavigationEvent[];
  forbidden: ForbiddenHit[];
};

export function emptyCollected(): Collected {
  return { console: [], pageErrors: [], httpErrors: [], failedRequests: [], slowRequests: [], hungRequests: [], navigations: [], forbidden: [] };
}

// Requests that stay open by design: the dev server's hot reload, streams, analytics beacons.
const LONG_LIVED = /_next\/webpack-hmr|__nextjs_original-stack-frame|\/_next\/static\/chunks\/.*hot-update|text\/event-stream|\/api\/.*\/(stream|events|live)(\?|$)|posthog|facebook|google-analytics/;

export class Collector {
  readonly data = emptyCollected();
  private readonly origin = new URL(baseUrl()).origin;
  private readonly open = new Map<Request, { t: number; page: string }>();
  private readonly ignore = qaConfig().ignoreConsole.map((r) => new RegExp(r, "i"));
  private readonly pages: Page[] = [];
  /** Statuses the test expects (qa.expectStatus, @expects-NNN): not recorded as errors. */
  readonly expected = new Set<number>();

  expectStatus(...codes: number[]): void {
    for (const c of codes) this.expected.add(c);
  }

  attach(ctx: BrowserContext): void {
    ctx.on("page", (p) => this.watch(p));
    for (const p of ctx.pages()) this.watch(p);
  }

  lastPage(): Page | null {
    for (let i = this.pages.length - 1; i >= 0; i--) if (!this.pages[i].isClosed()) return this.pages[i];
    return null;
  }

  forbiddenHit(hit: ForbiddenHit): void {
    this.data.forbidden.push({ ...hit, what: redact(hit.what), url: redact(hit.url ?? "") });
  }

  private same(url: string): boolean {
    try { return new URL(url).origin === this.origin; } catch { return false; }
  }

  private watch(page: Page): void {
    if (this.pages.includes(page)) return;
    this.pages.push(page);
    const where = () => redact(page.url());
    page.on("console", (m) => {
      const type = m.type();
      if (type !== "error" && type !== "warning" && type !== "assert") return;
      const text = m.text();
      if (this.ignore.some((r) => r.test(text))) return;
      const st = text.match(/status of (d{3})/);
      if (st && this.expected.has(Number(st[1]))) return; // the browser's line for an expected answer
      const loc = m.location();
      this.data.console.push({ t: Date.now(), type, text: redact(text).slice(0, 2000), url: where(), location: loc?.url ? redact(`${loc.url}:${loc.lineNumber}:${loc.columnNumber}`) : undefined });
    });
    page.on("pageerror", (e) => {
      this.data.pageErrors.push({ t: Date.now(), message: redact(String(e?.message ?? e)).slice(0, 8000), stack: e?.stack ? redact(e.stack).slice(0, 6000) : undefined, url: where() });
    });
    page.on("request", (r) => this.open.set(r, { t: Date.now(), page: where() }));
    page.on("requestfinished", async (r) => {
      const started = this.open.get(r);
      this.open.delete(r);
      const ms = started ? Date.now() - started.t : 0;
      const resp = await r.response().catch(() => null);
      const status = resp?.status() ?? 0;
      const sameOrigin = this.same(r.url());
      if (status >= 400 && !this.expected.has(status)) {
        let body: string | undefined;
        if (sameOrigin && (r.resourceType() === "fetch" || r.resourceType() === "xhr" || r.resourceType() === "document")) {
          body = await resp!.text().then((t) => redact(t).slice(0, 600)).catch(() => undefined);
        }
        this.data.httpErrors.push({ t: Date.now(), status, method: r.method(), url: redact(r.url()), resourceType: r.resourceType(), sameOrigin, page: started?.page ?? where(), body });
      }
      if (ms > qaConfig().thresholds.slowRequestMs && !LONG_LIVED.test(r.url())) {
        this.data.slowRequests.push({ t: Date.now(), method: r.method(), url: redact(r.url()), resourceType: r.resourceType(), ms, finished: true, sameOrigin, page: started?.page ?? where() });
      }
    });
    page.on("requestfailed", (r) => {
      const started = this.open.get(r);
      this.open.delete(r);
      const error = r.failure()?.errorText ?? "failed";
      // A navigation away cancels what the old page still had in flight; that is not a defect.
      if (/ERR_ABORTED|NS_BINDING_ABORTED|cancelled|Load request cancelled/i.test(error) && r.resourceType() !== "document") return;
      if (/blockedbyclient|ERR_BLOCKED_BY_CLIENT/i.test(error)) return; // our own blocks (trackers, forbidden.yaml)
      this.data.failedRequests.push({ t: Date.now(), method: r.method(), url: redact(r.url()), resourceType: r.resourceType(), error: redact(error), sameOrigin: this.same(r.url()), page: started?.page ?? where() });
    });
    page.on("load", async () => {
      const t = Date.now();
      const url = where();
      try {
        const nav = await page.evaluate(() => {
          const e = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
          if (!e) return null;
          return { ttfb: e.responseStart - e.startTime, dcl: e.domContentLoadedEventEnd - e.startTime, load: e.loadEventEnd > 0 ? e.loadEventEnd - e.startTime : performance.now(), kb: (e.transferSize || 0) / 1024, status: (e as unknown as { responseStatus?: number }).responseStatus };
        });
        if (nav) this.data.navigations.push({ t, url, ttfbMs: Math.round(nav.ttfb), domContentLoadedMs: Math.round(nav.dcl), loadMs: Math.round(nav.load), transferKb: Math.round(nav.kb), status: nav.status });
      } catch {
        this.data.navigations.push({ t, url });
      }
    });
  }

  /** At the end of a test: requests still open past the hung threshold. */
  finish(): Collected {
    const now = Date.now();
    for (const [r, s] of this.open) {
      const ms = now - s.t;
      if (ms < qaConfig().thresholds.hungRequestMs || LONG_LIVED.test(r.url())) continue;
      this.data.hungRequests.push({ t: s.t, method: r.method(), url: redact(r.url()), resourceType: r.resourceType(), ms, finished: false, sameOrigin: this.same(r.url()), page: s.page });
    }
    this.open.clear();
    return this.data;
  }
}
