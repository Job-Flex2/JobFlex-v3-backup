// What "the page is fine" means for the pages suite, measured in the browser.
import type { APIRequestContext, Page } from "@playwright/test";
import { baseUrl } from "./env";

/** Sideways scroll and elements that stick out past the screen's edges. */
export async function layoutProblems(page: Page): Promise<{ scrollX: boolean; docWidth: number; viewWidth: number; outside: string[] }> {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const docWidth = Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0);
    const describe = (el: Element) => {
      const id = el.id ? `#${el.id}` : "";
      const cls = typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : "";
      const text = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 30);
      return `${el.tagName.toLowerCase()}${id}${cls}${text ? ` "${text}"` : ""}`;
    };
    const out: string[] = [];
    const reported: Element[] = [];
    for (const el of Array.from(document.body?.querySelectorAll("*") ?? [])) {
      if (out.length >= 8) break;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (r.right <= vw + 1 && r.left >= -1) continue;
      if (reported.some((p) => p.contains(el))) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) continue;
      if ((cs.position === "fixed" || cs.position === "absolute") && (r.left >= vw - 1 || r.right <= 1)) continue; // an off-canvas drawer
      if (el.closest('[aria-hidden="true"], [inert], [hidden]')) continue;
      let p = el.parentElement;
      let clipped = false;
      while (p && p !== document.body && p !== document.documentElement) {
        if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(p).overflowX)) { clipped = true; break; }
        p = p.parentElement;
      }
      if (clipped) continue;
      reported.push(el);
      out.push(`${describe(el)} at ${Math.round(r.left)}…${Math.round(r.right)}px`);
    }
    return { scrollX: docWidth > vw + 1, docWidth, viewWidth: vw, outside: out };
  });
}

/** The page's own links (same origin, not the API, not sign-out), unique, at most `limit`. */
export async function internalLinks(page: Page, limit = 30): Promise<string[]> {
  const origin = new URL(baseUrl()).origin;
  const hrefs = await page.evaluate(() => Array.from(document.querySelectorAll("a[href]")).map((a) => (a as HTMLAnchorElement).href));
  const seen = new Set<string>();
  for (const h of hrefs) {
    let u: URL;
    try { u = new URL(h); } catch { continue; }
    if (u.origin !== origin) continue;
    if (/^\/(api|_next)\//.test(u.pathname) || /sign-?out|log-?out/i.test(u.pathname)) continue;
    if (/\.(pdf|csv|zip|png|jpe?g|svg|mp4|mov)$/i.test(u.pathname)) continue;
    seen.add(u.pathname + u.search);
    if (seen.size >= limit) break;
  }
  return [...seen];
}

const linkCache = new Map<string, number>();
/** Status of each link as the same role gets it (redirects followed), cached for the run's worker. */
export async function brokenLinks(req: APIRequestContext, role: string, links: string[]): Promise<string[]> {
  const bad: string[] = [];
  for (const l of links) {
    const key = `${role} ${l}`;
    let status = linkCache.get(key);
    if (status === undefined) {
      status = await req.get(l, { maxRedirects: 5, timeout: 120_000, failOnStatusCode: false }).then((r) => r.status()).catch(() => 0);
      linkCache.set(key, status);
    }
    if (status === 404 || status >= 500) bad.push(`${l} → ${status}`);
  }
  return bad;
}
