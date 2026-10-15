// npm run qa:analyze [-- --run <folder>] [--offline] [--budget 2.50]
// Analyses the latest run (or the named one) and writes analysis.json, report.md and report.html
// beside its raw.json. Without ANTHROPIC_API_KEY it runs on its rules alone (and says so).
import path from "node:path";
import fs from "node:fs";
import { ROOT, RUNS_DIR, latestRunDir } from "../lib/env";
import { analyzeRun } from "../analyze";

const argv = process.argv.slice(2);
const val = (name: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };

(async () => {
  const named = val("run");
  const dir = named ? path.resolve(RUNS_DIR, named) : latestRunDir();
  if (!dir || !fs.existsSync(path.join(dir, "raw.json"))) {
    console.error("No run with raw.json under qa/runs — run `npm run qa` (or `npm run qa:smoke`) first.");
    process.exit(1);
  }
  const budget = val("budget") ? Number(val("budget")) : undefined;
  const a = await analyzeRun(dir, { offline: argv.includes("--offline"), budgetUsd: budget });
  const f = a.summary.findings;
  console.log(`QA Lab analysis · run ${a.runId}`);
  console.log(`  tests ${a.summary.tests.total}: ${a.summary.tests.passed} passed, ${a.summary.tests.failed} failed, ${a.summary.tests.skipped} skipped`);
  console.log(`  findings: P0 ${f.P0} · P1 ${f.P1} · P2 ${f.P2} · P3 ${f.P3} · known ${a.summary.known}${a.summary.previousRun ? ` · vs ${a.summary.previousRun}: +${a.summary.diff.new} new, ${a.summary.diff.gone} gone, ${a.summary.diff.stale} stale` : ""}`);
  console.log(`  cost: $${a.cost.usd.toFixed(3)} (${a.cost.mode}${a.cost.stoppedForBudget ? ", stopped at the budget" : ""})`);
  for (const x of a.findings.slice(0, 10)) console.log(`  ${x.severity} ${x.id} ${x.title.slice(0, 100)}${x.evidence.tests.length > 1 ? ` (${x.evidence.tests.length} tests)` : ""}`);
  console.log(`\n  report: ${path.relative(ROOT, path.join(dir, "report.html"))}\n          ${path.relative(ROOT, path.join(dir, "report.md"))}`);
})().catch((e) => { console.error(e); process.exit(1); });
