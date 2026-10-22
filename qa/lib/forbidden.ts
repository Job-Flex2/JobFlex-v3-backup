// qa/config/forbidden.yaml, installed in a browser context before its first page loads.
// A forbidden control: the press is swallowed in the page (nothing happens there) and the
// test is failed with a "forbidden" event. A forbidden request: aborted in the browser.
//
// One exception, made by a test and only for the page it is on: allowQaSend() lets "Save & send"
// through when the recipient is a @qa.jobflex.test address AND the server proved it runs the QA
// test mode (lib/otp qaTestModeServing — mail to those addresses is then never sent).
import type { BrowserContext, Page, Route } from "@playwright/test";
import { forbiddenConfig } from "./config";
import { baseUrl } from "./env";
import { QA_DOMAIN, qaTestModeServing } from "./otp";

export type ForbiddenHit = { t: number; kind: "control" | "request"; what: string; why?: string; url?: string };

const installed = new WeakSet<BrowserContext>();

export async function installForbidden(ctx: BrowserContext, onHit: (hit: ForbiddenHit) => void): Promise<void> {
  if (installed.has(ctx)) return;
  installed.add(ctx);
  const cfg = forbiddenConfig();
  await ctx.exposeBinding("__qaForbidden", (src, what: string) => {
    onHit({ t: Date.now(), kind: "control", what, url: src.page?.url() });
  });
  await ctx.addInitScript(({ selectors, labels }: { selectors: string[]; labels: string[] }) => {
    const rules = labels.map((l) => new RegExp(l, "i"));
    const hit = (target: EventTarget | null): string | null => {
      const el = target instanceof Element ? target.closest('button, a, [role="button"], input[type="submit"], input[type="button"], [data-act]') : null;
      if (!el) return null;
      // a press a test allowed on this page (allowQaSend) — labels only, never a selector rule
      const allowed = ((window as unknown as { __qaAllowLabels?: string[] }).__qaAllowLabels ?? []).map((l) => new RegExp(l, "i"));
      const own = String(el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim();
      if (allowed.some((r) => r.test(own)) && !selectors.some((sel) => { try { return el.matches(sel) || !!el.closest(sel); } catch { return false; } })) return null;
      for (const sel of selectors) {
        try { if (el.matches(sel) || el.closest(sel)) return sel; } catch { /* a selector this engine cannot parse */ }
      }
      const texts = [el.getAttribute("aria-label") || "", el.textContent || "", (el as HTMLInputElement).value || ""];
      for (const raw of texts) {
        const t = String(raw).replace(/\s+/g, " ").trim();
        if (t && rules.some((r) => r.test(t))) return '"' + t.slice(0, 60) + '"';
      }
      return null;
    };
    const stop = (ev: Event) => {
      if (ev.type === "keydown" && (ev as KeyboardEvent).key !== "Enter" && (ev as KeyboardEvent).key !== " ") return;
      const what = hit(ev.target);
      if (!what) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      (window as unknown as { __qaForbidden?: (w: string) => void }).__qaForbidden?.(what);
    };
    for (const type of ["pointerdown", "mousedown", "click", "keydown", "touchstart", "submit"]) window.addEventListener(type, stop, true);
  }, { selectors: cfg.controls.selectors, labels: cfg.controls.labels });

  const origin = new URL(baseUrl()).origin;
  const rules = cfg.requests.map((r) => ({ ...r, pathRe: r.path ? new RegExp(r.path, "i") : null, hostRe: r.host ? new RegExp(r.host, "i") : null, urlRe: r.url ? new RegExp(r.url, "i") : null }));
  const hits = (r: (typeof rules)[number], u: URL) => (r.urlRe ? r.urlRe.test(u.href) : r.hostRe ? r.hostRe.test(u.hostname) : u.origin === origin && !!r.pathRe && r.pathRe.test(u.pathname));
  await ctx.route(
    (url) => rules.some((r) => hits(r, url)),
    async (route: Route) => {
      const req = route.request();
      const u = new URL(req.url());
      const rule = rules.find((r) => (!r.method || r.method === req.method()) && hits(r, u));
      if (!rule) return route.fallback();
      onHit({ t: Date.now(), kind: "request", what: `${req.method()} ${u.origin === origin ? u.pathname : u.host + u.pathname.slice(0, 40)}`, why: rule.why, url: req.frame()?.url() });
      return route.abort("blockedbyclient");
    },
  );
}

/** Lets "Save & send" through on this page, for a QA recipient on a server in QA test mode only.
 *  Throws (the test fails) when either is not so — a real address is never sent to. */
export async function allowQaSend(page: Page, recipient: string): Promise<void> {
  if (!recipient.toLowerCase().endsWith("@" + QA_DOMAIN)) throw new Error(`QA guard: ${recipient} is not a @${QA_DOMAIN} address — nothing is sent`);
  if (!(await qaTestModeServing())) throw new Error("QA guard: the server is not in QA test mode (QA_TEST_MODE=1 + this QA_SECRET) — mail to the test client would leave; nothing is sent");
  await page.evaluate(() => { (window as unknown as { __qaAllowLabels?: string[] }).__qaAllowLabels = ["^save (&|and) send\\b"]; });
}

/** The forms suite: does this submit control's text say it would send, pay, invite or delete? */
export function submitIsForbidden(label: string): boolean {
  const t = label.replace(/\s+/g, " ").trim();
  return forbiddenConfig().formsNoSubmit.some((re) => new RegExp(re, "i").test(t)) || forbiddenConfig().controls.labels.some((re) => new RegExp(re, "i").test(t));
}
