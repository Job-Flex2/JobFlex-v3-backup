// VISUAL — a screenshot of every page at 390 and 1440 in Chromium, against its baseline in
// qa/baselines/. One role per page: the owner for the dashboard, the platform admin for /admin,
// a guest for the public pages (whoever qa/config/access-matrix.yaml lets open it first).
import { test, expect, open } from "../../lib/fixtures";
import { appRoutes } from "../../lib/routes";
import { concretePath } from "../../lib/params";
import { readMatrix, matches } from "../../lib/matrix";
import type { RoleName } from "../../lib/roles";
import { qaConfig } from "../../lib/config";
import { compare, steadyShot, visualId } from "../../lib/visual";
import { targetKind } from "../../lib/target";

test.describe.configure({ mode: "parallel" });

const matrix = readMatrix();
const cfg = qaConfig();
const PREFER: RoleName[] = ["owner", "admin", "guest", "homeowner", "manager", "worker"];

function roleFor(pattern: string): RoleName | null {
  const row = matrix.routes[pattern];
  if (!row) return pattern.startsWith("/admin") ? "admin" : /^\/(dashboard|v3|mobile-|trade-services)/.test(pattern) ? "owner" : "guest";
  return PREFER.find((r) => matches(row[r], "open")) ?? null;
}

const VIEWPORTS = [
  { name: "390", use: { viewport: cfg.viewports.phone, isMobile: true, hasTouch: true, deviceScaleFactor: 1 } },
  { name: "1440", use: { viewport: cfg.viewports.desk, isMobile: false, hasTouch: false, deviceScaleFactor: 1 } },
];

for (const vp of VIEWPORTS) {
  test.describe(`at ${vp.name}`, () => {
    test.use(vp.use);
    for (const route of appRoutes()) {
      const role = roleFor(route.pattern);
      if (!role || /^\/dev\//.test(route.pattern)) continue;
      if (targetKind() !== "local" && role !== "guest") continue;
      test.describe(() => {
        test.use({ role });
        test(`${route.pattern} at ${vp.name} as ${role} @visual`, async ({ page, qa }, info) => {
          test.skip(info.project.name !== "chromium", "visual baselines are Chromium only");
          const { path } = await concretePath(route, { real: role !== "guest" });
          await open(page, path, { settleMs: 2000 });
          const id = visualId(vp.name, role, route.pattern);
          const shot = info.outputPath("visual.png");
          await steadyShot(page, shot);
          const res = await compare(id, shot);
          await info.attach("qa-visual", { body: JSON.stringify(res), contentType: "application/json" });
          qa.meta({ kind: "visual", route: route.pattern, role, viewport: vp.name, visualId: id, ratio: res.ratio ?? null, created: !!res.created, note: res.note ?? null });
          if (res.created) info.annotations.push({ type: "baseline-created", description: id });
          expect(res.ratio ?? 0, `visual difference ${(((res.ratio ?? 0) * 100)).toFixed(2)}% (over ${(cfg.visual.maxDiffRatio * 100).toFixed(2)}%) — npm run qa:accept -- ${id}`).toBeLessThanOrEqual(cfg.visual.maxDiffRatio);
        });
      });
    }
  });
}
