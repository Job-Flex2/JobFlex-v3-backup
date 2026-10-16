// ROLES — every page of the app (src/app/**/page.tsx, read at run time) × every role, as the
// server answers it, against qa/config/access-matrix.yaml. A page the matrix does not know yet
// fails with "unknown access": someone decides who may open it.
import { test, expect } from "../../lib/fixtures";
import { appRoutes } from "../../lib/routes";
import { concretePath } from "../../lib/params";
import { ROLES, hasAuth, type RoleName } from "../../lib/roles";
import { devOnlyHere } from "../../lib/config";
import { disposeRequests, matches, probe, readMatrix, saveObserved, type Cell } from "../../lib/matrix";

test.describe.configure({ mode: "parallel" });
test.afterAll(async () => { await disposeRequests(); });

const matrix = readMatrix();
const updating = process.env.QA_UPDATE_MATRIX === "1";

for (const route of appRoutes()) {
  test(`access ${route.pattern} @roles`, async ({ qa }) => {
    test.setTimeout(10 * 60_000);
    const row = matrix.routes[route.pattern];
    const cells: Partial<Record<RoleName, Cell>> = {};
    const detail: Record<string, unknown> = {};
    for (const role of ROLES) {
      if (!hasAuth(role)) continue;
      const { path } = await concretePath(route, { real: role !== "guest" });
      const r = await test.step(`${role} opens ${path}`, () => probe(role, path));
      cells[role] = r.cell;
      detail[role] = { path, status: r.status, location: r.location, ms: r.ms };
    }
    // a dev-only page on a production build: 404 for everyone, and the matrix keeps its dev answer
    const devOnly = devOnlyHere(route.pattern);
    if (!devOnly) saveObserved(route, cells);
    qa.meta({ kind: "access", route: route.pattern, file: route.file, cells, detail, expected: row ?? null, review: row?.review ?? [] });

    if (!row) {
      if (updating) return;
      test.info().annotations.push({ type: "unknown-access", description: `${route.pattern} is not in qa/config/access-matrix.yaml` });
      throw new Error(`unknown access: ${route.pattern} (${route.file}) is not in qa/config/access-matrix.yaml — observed ${JSON.stringify(cells)}`);
    }
    const want = (role: RoleName) => (devOnly ? "not-found" : row[role]);
    const wrong = Object.entries(cells).filter(([role, cell]) => !matches(want(role as RoleName), cell!)).map(([role, cell]) => `${role}: expected ${want(role as RoleName) ?? "(no cell)"}, got ${cell}`);
    if (updating) return;
    expect(wrong, `access differs from the matrix for ${route.pattern}`).toEqual([]);
  });
}
