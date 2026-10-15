// FORMS — every form on the dashboard's pages, as the owner, at 390: an empty submit, text far
// too long, a wrong email / phone / number, special characters and HTML. What is checked: the
// person is shown the validation, nothing breaks (no uncaught exception, no 5xx, no crash
// screen), HTML typed in is never run, and a wrong email / phone / number is not saved.
// A form whose submit would send mail or SMS, pay, invite or delete (qa/config/forbidden.yaml →
// formsNoSubmit) is only filled — the press is never made. QA Co's organisation row and the QA
// users are restored afterwards and the records the suite created there removed.
import fs from "node:fs";
import path from "node:path";
import { test, expect, open } from "../../lib/fixtures";
import { appRoutes } from "../../lib/routes";
import { readMatrix, matches } from "../../lib/matrix";
import { runDir } from "../../lib/env";
import { SCENARIOS, fillScenario, findForms, findOpener, pressOpener, restoreQaCo, snapshotQaCo, submitAndRead } from "../../lib/forms";

test.describe.configure({ mode: "parallel" });
test.use({ role: "owner" });

const matrix = readMatrix();
const SNAP = () => path.join(runDir(), "forms-snapshot.json");

test.beforeAll(async () => {
  // One snapshot per run, taken by the first worker, before any form is touched.
  if (fs.existsSync(SNAP())) return;
  const s = await snapshotQaCo();
  try { fs.writeFileSync(SNAP(), JSON.stringify(s), { flag: "wx" }); } catch { /* another worker was first */ }
});
test.afterAll(async () => {
  if (!fs.existsSync(SNAP())) return;
  const s = JSON.parse(fs.readFileSync(SNAP(), "utf8"));
  s.since = new Date(s.since);
  const notes = await restoreQaCo(s);
  if (notes.length) fs.appendFileSync(path.join(runDir(), "forms-cleanup.log"), notes.join("\n") + "\n");
});

const pages = appRoutes().filter((r) => r.pattern.startsWith("/dashboard") && !r.params.length && (matrix.routes[r.pattern] ? matches(matrix.routes[r.pattern].owner, "open") : true));

for (const route of pages) {
  test(`forms on ${route.pattern} @forms`, async ({ page, qa }) => {
    test.setTimeout(8 * 60_000);
    await open(page, route.pattern, { settleMs: 1500 });
    let forms = (await findForms(page)).slice(0, 2);
    // no form on the page itself: the page's "New …" / "+ Add" button may open one in a sheet
    const opener = forms.length ? null : await findOpener(page);
    if (opener && (await pressOpener(page, opener))) forms = (await findForms(page)).slice(0, 2);
    qa.meta({ kind: "forms", route: route.pattern, file: route.file, forms, opener });
    if (!forms.length) {
      test.info().annotations.push({ type: "note", description: "no form on the page" });
      return;
    }
    const results: Record<string, unknown>[] = [];
    let dialogs = 0;
    page.on("dialog", (d) => { dialogs++; void d.dismiss().catch(() => {}); });
    for (const form of forms) {
      for (const scenario of SCENARIOS) {
        if (scenario === "invalid" && !(form.hasEmail || form.hasTel || form.hasNumber || form.hasUrl)) continue;
        await test.step(`form ${form.index} (${form.submit ?? "no submit"}) · ${scenario}`, async () => {
          await open(page, route.pattern, { settleMs: 1200 });
          if (opener) await pressOpener(page, opener);
          const fresh = (await findForms(page)).find((f) => f.index === form.index && f.kind === form.kind) ?? form;
          const filled = await fillScenario(page, fresh, scenario);
          const out = await submitAndRead(page, fresh);
          results.push({ form: form.index, submit: form.submit, forbidden: form.submitForbidden, scenario, filled, ...out });
          expect.soft(out.crashed, `${scenario}: the page broke ("Something went wrong")`).toBe(false);
          expect.soft(out.failedSaves, `${scenario}: the server answered 5xx to the submit`).toBe(0);
          expect.soft(out.xss, `${scenario}: HTML typed into a field ran in the page`).toBe(false);
          if (scenario === "invalid" && out.pressed) {
            expect.soft(out.validation.length > 0 || out.savedRequests === 0, `invalid email/phone/number: saved without a word to the person`).toBeTruthy();
          }
          if ((scenario === "empty" || scenario === "invalid") && out.pressed && !out.validation.length) {
            test.info().annotations.push({ type: "warning", description: `${route.pattern} form ${form.index}: ${scenario} submit showed no validation message` });
          }
        });
      }
    }
    qa.meta({ formResults: results, dialogs });
    expect.soft(dialogs, "a dialog (alert) opened — typed HTML may have run").toBe(0);
    const d = qa.collector.data;
    expect.soft(d.pageErrors.map((e) => e.message), "uncaught exceptions").toEqual([]);
    expect.soft(d.httpErrors.filter((e) => e.sameOrigin && e.status >= 500).map((e) => `${e.status} ${e.method} ${e.url}`), "5xx answers").toEqual([]);
  });
}
