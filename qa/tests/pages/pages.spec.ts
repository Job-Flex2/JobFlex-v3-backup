// PAGES — every page under every role that may open it (qa/config/access-matrix.yaml says
// "open"), at 390 px: it opens with no console error, no uncaught exception, no 4xx/5xx or
// failed request from this server, no link on it that leads to a 404, no sideways scroll, nothing
// sticking out past the screen, and a warm load under the threshold (qa/config/qa.config.yaml).
// axe-core runs on each one; its serious and critical findings go to the analysis.
import AxeBuilder from "@axe-core/playwright";
import { test, expect, open } from "../../lib/fixtures";
import { appRoutes } from "../../lib/routes";
import { concretePath } from "../../lib/params";
import { readMatrix, matches, roleRequest, disposeRequests } from "../../lib/matrix";
import { ROLES, type RoleName } from "../../lib/roles";
import { qaConfig } from "../../lib/config";
import { brokenLinks, internalLinks, layoutProblems } from "../../lib/pagecheck";
import { targetKind } from "../../lib/target";

test.describe.configure({ mode: "parallel" });
test.afterAll(async () => { await disposeRequests(); });

const matrix = readMatrix();
const cfg = qaConfig();
const production = targetKind() !== "local";

/** Who opens a page: the matrix's "open" cells; with no row yet, the obvious owner of the area. */
function rolesFor(pattern: string): RoleName[] {
  const row = matrix.routes[pattern];
  if (row) return ROLES.filter((r) => matches(row[r], "open"));
  if (pattern.startsWith("/admin")) return ["admin"];
  if (/^\/(dashboard|v3|mobile-|trade-services)/.test(pattern)) return ["owner"];
  return ["guest"];
}

for (const route of appRoutes()) {
  for (const role of rolesFor(route.pattern)) {
    if (production && role !== "guest") continue;
    test.describe(() => {
      test.use({ role });
      test(`${route.pattern} as ${role} @pages`, async ({ page, qa }) => {
        test.setTimeout(6 * 60_000);
        const { path, real } = await concretePath(route, { real: role !== "guest" });
        qa.meta({ kind: "page", route: route.pattern, file: route.file, role, path, realParams: real });

        const cold = await test.step(`open ${path}`, () => open(page, path, { settleMs: 1500 }));
        // A dev server compiles a route on its first visit: the threshold applies to a warm load.
        let warmMs = cold.ms;
        if (cold.ms > cfg.thresholds.pageLoadMs) {
          const warm = await test.step("open again (warm)", () => open(page, path, { settleMs: 1500 }));
          warmMs = warm.ms;
        }
        const d = qa.collector.data;
        const finalPath = new URL(page.url()).pathname;
        qa.meta({ coldMs: cold.ms, warmMs, status: cold.status, finalPath });

        const layout = await test.step("layout at 390", () => layoutProblems(page));
        const links = await test.step("links on the page", async () => brokenLinks(await roleRequest(role), role, await internalLinks(page)));
        const axe = await test.step("axe-core", async () => {
          try {
            const res = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
            return res.violations
              .filter((v) => cfg.perf.axeImpacts.includes(String(v.impact)))
              .map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, sample: v.nodes.slice(0, 2).map((n) => n.target.join(" ")) }));
          } catch (e) {
            return [{ id: "axe-failed", impact: "minor", help: String((e as Error).message).slice(0, 200), nodes: 0, sample: [] }];
          }
        });
        qa.meta({ layout, brokenLinks: links, axe });

        // A made-up link token (no real one in QA Co) must answer a plain 404, never a 5xx.
        if (real || cold.status !== 404) expect.soft(cold.status, `${path} answered ${cold.status}`).toBeLessThan(400);
        expect.soft(finalPath === path.split("?")[0] || !/^\/(auth|admin)\/login/.test(finalPath), `the page sent ${role} to ${finalPath}`).toBeTruthy();
        expect.soft(d.pageErrors.map((e) => e.message), "uncaught exceptions").toEqual([]);
        expect.soft(d.console.filter((c) => c.type === "error").map((c) => c.text.slice(0, 200)), "console errors").toEqual([]);
        expect.soft(d.httpErrors.filter((e) => e.sameOrigin && !(e.resourceType === "document" && !real && e.status === 404)).map((e) => `${e.status} ${e.method} ${e.url}`), "4xx/5xx from this server").toEqual([]);
        expect.soft(d.failedRequests.filter((e) => e.sameOrigin).map((e) => `${e.method} ${e.url} — ${e.error}`), "failed requests").toEqual([]);
        expect.soft(links, "links on the page that lead to 404 / 5xx").toEqual([]);
        expect.soft(layout.scrollX, `sideways scroll at 390: the page is ${layout.docWidth}px wide`).toBe(false);
        expect.soft(layout.outside, "elements past the screen's edge").toEqual([]);
        expect.soft(warmMs, `warm load ${warmMs} ms (threshold ${cfg.thresholds.pageLoadMs} ms)`).toBeLessThanOrEqual(cfg.thresholds.pageLoadMs);
      });
    });
  }
}
