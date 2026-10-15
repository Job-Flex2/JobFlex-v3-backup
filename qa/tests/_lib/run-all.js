/* eslint-disable @typescript-eslint/no-require-imports -- a plain CommonJS node script, like the rest of _lib */
// The old QA set, one verdict line each:   node qa/tests/_lib/run-all.js [--checks | --pages]
// (also reachable as node scripts/qa/run-all.js). The list is qa/config/legacy.yaml; the same
// scripts run inside the QA Lab as qa/tests/legacy.spec.ts (`npm run qa`), which is the way to
// run them now — this file stays for the habit and for qa-guard.check.js, which drives it.
//  · checks — every live check (no browser, or its own production build: mobile-sweep, the
//    signup checks, plan-terms, sidebar-motion, free-plan — see their headers);
//  · pages  — the Playwright passes. They sign in as qa@acme.test, work ONLY in QA Co, make the
//    records they need there (_world, seed-phone, seed-roof) and remove them. They need the dev
//    server on QA_BASE_URL (or localhost:$QA_PORT, default 3000).
// Left out on purpose: the `manual` entries (*.live.ts — real provider calls) and the tools.
const { runnable, runEntry, guard } = require("./legacy-run");

const only = process.argv.includes("--checks") ? "checks" : process.argv.includes("--pages") ? "pages" : "all";
const BASE = process.env.QA_BASE_URL || `http://localhost:${process.env.QA_PORT || 3000}`;

(async () => {
  const refused = await guard();
  if (refused) {
    console.error(refused);
    process.exit(1);
  }
  const rows = [];
  for (const e of runnable()) {
    const isPage = e.kind === "page";
    if ((only === "checks" && isPage) || (only === "pages" && !isPage)) continue;
    const r = await runEntry(e, { baseUrl: BASE });
    rows.push({ name: e.file, verdict: r.verdict });
    console.log(`${r.verdict}  ${e.suite}/${e.file}  · ${String(r.detail).slice(0, 90)}`);
  }
  const count = (v) => rows.filter((r) => r.verdict === v).length;
  console.log(`\n== ${count("PASS")} passed, ${count("FAIL")} failed, ${count("STALE")} stale — of ${rows.length}`);
  process.exit(count("FAIL") ? 1 : 0);
})();
