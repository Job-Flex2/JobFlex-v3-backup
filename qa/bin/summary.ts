// npm run qa:summary [-- --run <folder>] [--title "…"] [--link <url>] [--out <file>] [--step-summary]
// A short Markdown summary of a run for CI: the verdict, the target, then one row per test —
// test / status / time — with the first error line of each failure under the table.
//   --out <file>      also write it to that file (the nightly writes qa/runs/latest-nightly.md)
//   --step-summary    append it to $GITHUB_STEP_SUMMARY (the job's summary page)
//   --link <url>      the deployment under test, linked in the header (default: the run's base URL)
// Reads raw.json only; everything in it is already redacted (lib/reporter.ts).
import fs from "node:fs";
import path from "node:path";
import { RUNS_DIR, latestRunDir } from "../lib/env";
import type { RawRun, RawTest } from "../lib/raw";

const argv = process.argv.slice(2);
const val = (name: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };

const ICON: Record<RawTest["outcome"], string> = { passed: "✅ passed", failed: "❌ failed", skipped: "⏭️ skipped", flaky: "⚠️ flaky" };
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
/** The test's name without its tags, under its describe blocks (titlePath: project, file, describes…, title). */
const name = (t: RawTest) => t.titlePath.slice(2).filter(Boolean).slice(-3).join(" › ").replace(/\s*@[\w-]+/g, "").trim();

function render(raw: RawRun, dir: string): string {
  const r = raw.run;
  const s = raw.stats;
  // no test at all is red too: the setup stopped the run (a server that did not answer, a guard)
  const red = s.failed > 0 || s.total === 0 || r.health?.status === "FAILED";
  const link = val("link") || r.baseUrl;
  const title = val("title") || "QA Lab";
  const out: string[] = [];
  out.push(`## ${red ? "🔴" : "🟢"} ${title} — ${r.suites.join(", ")}`);
  out.push("");
  out.push(`Target: [${new URL(r.baseUrl).host}](${link}) (${r.target}${r.server ? `, ${r.server}` : ""}) · run \`${path.basename(dir)}\` · ${secs(r.durationMs)} · ${r.git.commit ?? "?"}`);
  out.push("");
  out.push(`**${s.total} tests:** ${s.passed} passed · ${s.failed} failed · ${s.skipped} skipped${s.flaky ? ` · ${s.flaky} flaky` : ""}`);
  if (r.health?.status === "FAILED") out.push("", `**The run itself is not to be trusted:** ${r.health.problems.join("; ")}`);
  if (s.total === 0) out.push("", "**No test ran** — the setup stopped the run; the reason is in the job log (step «Smoke» / «Run the suites»).");
  const setupBad = (r.setup ?? []).filter((x) => !x.ok);
  if (setupBad.length) out.push("", `Sign-in setup: ${setupBad.map((x) => `${x.role} — ${cell(x.note)}`).join("; ")}`);
  out.push("", "| Test | Browser | Status | Time |", "| --- | --- | --- | --- |");
  const order: Record<string, number> = { failed: 0, flaky: 1, passed: 2, skipped: 3 };
  const tests = [...raw.tests].sort((a, b) => order[a.outcome] - order[b.outcome] || a.file.localeCompare(b.file) || a.line - b.line);
  for (const t of tests) {
    const why = t.outcome === "skipped" ? t.annotations.find((a) => a.type === "skip")?.description : undefined;
    out.push(`| ${cell(name(t))}${why ? `<br><sub>${cell(why).slice(0, 160)}</sub>` : ""} | ${t.project} | ${ICON[t.outcome]} | ${secs(t.durationMs)} |`);
  }
  const failed = tests.filter((t) => t.outcome === "failed");
  if (failed.length) {
    out.push("", "### Failures");
    for (const t of failed) out.push(`- **${cell(name(t))}** (${t.project}) — ${cell((t.errors[0]?.message ?? "no message").split("\n")[0]).slice(0, 300)}`);
  }
  out.push("", "Full report: the run's artifact (report.html, raw.json, screenshots).", "");
  return out.join("\n");
}

const named = val("run");
const dir = named ? path.resolve(RUNS_DIR, named) : process.env.QA_RUN_DIR && fs.existsSync(path.join(process.env.QA_RUN_DIR, "raw.json")) ? process.env.QA_RUN_DIR : latestRunDir();
let md: string;
if (!dir || !fs.existsSync(path.join(dir, "raw.json"))) {
  md = `## 🔴 ${val("title") || "QA Lab"}\n\nThe run left no raw.json — it stopped before the tests (the server did not answer, a guard refused, or setup failed). See the job log.\n`;
} else {
  md = render(JSON.parse(fs.readFileSync(path.join(dir, "raw.json"), "utf8")) as RawRun, dir);
}
const outFile = val("out");
if (outFile) {
  fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
  fs.writeFileSync(outFile, md);
}
if (argv.includes("--step-summary") && process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + "\n");
console.log(md);
