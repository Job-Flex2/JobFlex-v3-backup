// Playwright reporter → qa/runs/<run>/raw.json (lib/raw.ts) plus screenshots/, traces/,
// baselines-diff/, lighthouse/ and outputs/ beside it. Everything written is redacted.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import type { FullConfig, FullResult, Reporter, TestCase, TestResult, TestStep } from "@playwright/test/reporter";
import { ROOT, baseUrl, runDir, runId } from "./env";
import { targetKind } from "./target";
import { redact, redactDeep } from "./redact";
import { SCHEMA, SUITES, type RawRun, type RawStep, type RawTest } from "./raw";
import { emptyCollected, type Collected } from "./collect";

const slug = (s: string) => s.replace(/@\w+/g, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 70) || "test";

function git(cmd: string): string | null {
  try { return execSync(`git ${cmd}`, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; }
}

/** Fill steps carry the typed value in their title (`Fill "…" locator(…)`): never stored. */
function stepTitle(s: TestStep): string {
  let t = s.title;
  if (s.category === "pw:api" && /^(Fill|Type|Press sequentially|Insert text|Set input files)\b/i.test(t)) t = t.replace(/"(?:[^"\\]|\\.)*"/, '"•••"');
  return redact(t);
}

function steps(list: TestStep[], t0: number, depth = 0): RawStep[] {
  return list
    .filter((s) => s.category === "test.step" || s.category === "expect" || s.category === "pw:api" || s.category === "hook" || s.category === "fixture")
    .filter((s) => !(s.category === "fixture" && !s.error))
    .map((s) => ({
      title: stepTitle(s),
      category: s.category,
      startMs: s.startTime.getTime() - t0,
      durationMs: s.duration,
      ...(s.error ? { error: redact(s.error.message ?? String(s.error.value ?? "")).slice(0, 1500) } : {}),
      ...(depth < 3 && s.steps.length ? { steps: steps(s.steps, t0, depth + 1) } : {}),
    }));
}

/** The innermost user step (test.step) that was running at `t`. */
function stepAt(list: RawStep[], at: number, prefix = ""): string | undefined {
  let found: string | undefined;
  for (const s of list) {
    if (s.category !== "test.step") continue;
    if (at >= s.startMs && at <= s.startMs + Math.max(s.durationMs, 1)) {
      const name = prefix ? `${prefix} › ${s.title}` : s.title;
      found = (s.steps && stepAt(s.steps, at, name)) || name;
    }
  }
  return found;
}

function suiteOf(test: TestCase): string {
  for (const tag of test.tags) {
    const s = tag.replace(/^@/, "");
    if ((SUITES as readonly string[]).includes(s)) return s;
  }
  const rel = path.relative(path.join(ROOT, "qa", "tests"), test.location.file).split(path.sep);
  return rel.length > 1 ? rel[0] : "misc";
}

export default class QaReporter implements Reporter {
  private started = new Date();
  private tests = new Map<string, RawTest>();
  private projects: string[] = [];
  private dir = runDir();

  onBegin(config: FullConfig): void {
    this.started = new Date();
    this.projects = config.projects.map((p) => p.name);
    for (const sub of ["screenshots", "traces", "baselines-diff", "lighthouse", "outputs"]) fs.mkdirSync(path.join(this.dir, sub), { recursive: true });
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const project = test.parent.project()?.name ?? "";
    const key = `${test.id}`;
    const t0 = result.startTime.getTime();
    const stepList = steps(result.steps, t0);
    const name = `${slug(test.title)}-${test.id.slice(-8)}${result.retry ? "-r" + result.retry : ""}`;
    const artifacts: RawTest["artifacts"] = {};
    let collected: Collected = emptyCollected();
    let meta: Record<string, unknown> = {};

    for (const a of result.attachments) {
      try {
        if (a.name === "qa-collect" && a.body) collected = JSON.parse(a.body.toString("utf8"));
        else if (a.name === "qa-meta" && a.body) meta = { ...meta, ...JSON.parse(a.body.toString("utf8")) };
        else if (a.name === "qa-screenshot" && a.path) artifacts.screenshot = this.copy(a.path, "screenshots", `${name}.png`);
        else if (a.name.startsWith("qa-shot:") && a.path) (artifacts.shots ??= []).push(this.copy(a.path, "screenshots", `${name}-${slug(a.name.slice(8))}.png`));
        else if (a.name === "trace" && a.path) artifacts.trace = this.copy(a.path, "traces", `${name}.zip`);
        else if (a.name === "qa-visual" && a.body) {
          const v = JSON.parse(a.body.toString("utf8")) as { baseline?: string; actual: string; diff?: string; ratio?: number; created?: boolean };
          artifacts.visual = {
            baseline: v.baseline ? path.relative(this.dir, v.baseline).split(path.sep).join("/") : undefined,
            actual: path.relative(this.dir, v.actual).split(path.sep).join("/"),
            diff: v.diff ? path.relative(this.dir, v.diff).split(path.sep).join("/") : undefined,
            ratio: v.ratio,
            created: v.created,
          };
        } else if (a.name === "qa-lighthouse" && a.path) artifacts.lighthouse = this.copy(a.path, "lighthouse", path.basename(a.path));
        else if (a.name === "qa-output" && a.body) {
          const file = path.join(this.dir, "outputs", `${name}.txt`);
          fs.writeFileSync(file, redact(a.body.toString("utf8")));
          artifacts.output = `outputs/${name}.txt`;
        }
      } catch { /* one unreadable attachment does not lose the test */ }
    }

    // each event under the step that was running then
    const withStep = <T extends { t: number }>(list: T[]) => list.map((e) => ({ ...e, step: stepAt(stepList, e.t - t0) }));
    const coll = Object.fromEntries(Object.entries(collected).map(([k, v]) => [k, withStep(v as { t: number }[])])) as RawTest["collected"];

    const prev = this.tests.get(key);
    const outcome = test.outcome();
    const rec: RawTest = {
      id: test.id,
      title: redact(test.title),
      titlePath: test.titlePath().filter(Boolean).map((t) => redact(t)),
      file: path.relative(ROOT, test.location.file).split(path.sep).join("/"),
      line: test.location.line,
      project,
      suite: suiteOf(test),
      tags: test.tags,
      status: result.status,
      expectedStatus: test.expectedStatus,
      outcome: outcome === "expected" ? (result.status === "skipped" ? "skipped" : "passed") : outcome === "flaky" ? "flaky" : outcome === "skipped" ? "skipped" : "failed",
      durationMs: result.duration + (prev?.durationMs ?? 0),
      retry: result.retry,
      startedAt: result.startTime.toISOString(),
      annotations: [...new Map([...test.annotations, ...result.annotations].map((a) => [`${a.type}|${a.description ?? ""}`, { type: a.type, description: a.description ? redact(a.description) : undefined }])).values()],
      errors: result.errors.map((e) => ({
        message: redact(e.message ?? String(e.value ?? "")).slice(0, 4000),
        stack: e.stack ? redact(e.stack).slice(0, 8000) : undefined,
        location: e.location ? { file: path.relative(ROOT, e.location.file).split(path.sep).join("/"), line: e.location.line, column: e.location.column } : undefined,
        snippet: e.snippet ? redact(e.snippet).slice(0, 2000) : undefined,
      })),
      steps: stepList,
      collected: coll,
      artifacts,
      meta: redactDeep(meta),
    };
    this.tests.set(key, rec);
  }

  private copy(from: string, sub: string, name: string): string {
    const to = path.join(this.dir, sub, name);
    try { fs.copyFileSync(from, to); } catch { return ""; }
    return `${sub}/${name}`;
  }

  onEnd(result: FullResult): void {
    if (process.argv.includes("--list")) return; // a listing ran nothing
    const finished = new Date();
    const tests = [...this.tests.values()];
    const count = (list: RawTest[]) => ({
      total: list.length,
      passed: list.filter((t) => t.outcome === "passed").length,
      failed: list.filter((t) => t.outcome === "failed").length,
      skipped: list.filter((t) => t.outcome === "skipped").length,
      flaky: list.filter((t) => t.outcome === "flaky").length,
    });
    const bySuite: RawRun["stats"]["bySuite"] = {};
    for (const s of [...new Set(tests.map((t) => t.suite))].sort()) bySuite[s] = count(tests.filter((t) => t.suite === s));
    let setup: RawRun["run"]["setup"] = [];
    try { setup = JSON.parse(fs.readFileSync(path.join(this.dir, "setup.json"), "utf8")); } catch { /* no setup notes */ }
    let notes: string[] = [];
    try { notes = JSON.parse(fs.readFileSync(path.join(this.dir, "notes.json"), "utf8")); } catch { /* none */ }
    const raw: RawRun = {
      schema: SCHEMA,
      run: {
        id: runId(),
        startedAt: this.started.toISOString(),
        finishedAt: finished.toISOString(),
        durationMs: finished.getTime() - this.started.getTime(),
        baseUrl: baseUrl(),
        target: targetKind(),
        suites: (process.env.QA_SUITES || "all").split(","),
        grep: process.env.QA_GREP || null,
        projects: this.projects,
        git: { commit: git("rev-parse --short HEAD"), branch: git("rev-parse --abbrev-ref HEAD"), dirty: (() => { const s = git("status --porcelain"); return s === null ? null : s.length > 0; })() },
        playwright: (() => { try { return (JSON.parse(fs.readFileSync(require.resolve("@playwright/test/package.json"), "utf8")) as { version: string }).version; } catch { return "?"; } })(),
        node: process.version,
        status: result.status,
        setup: redactDeep(setup),
        notes: notes.map((n) => redact(n)),
      },
      stats: { ...count(tests), bySuite },
      tests: tests.sort((a, b) => a.suite.localeCompare(b.suite) || a.file.localeCompare(b.file) || a.line - b.line || a.project.localeCompare(b.project)),
    };
    fs.writeFileSync(path.join(this.dir, "raw.json"), JSON.stringify(raw, null, 1));
    const s = raw.stats;
    console.log(`\nQA Lab · ${s.total} tests: ${s.passed} passed, ${s.failed} failed, ${s.skipped} skipped, ${s.flaky} flaky\n  raw:     ${path.relative(ROOT, path.join(this.dir, "raw.json"))}\n  analyse: npm run qa:analyze`);
  }

  printsToStdio(): boolean {
    return false;
  }
}
