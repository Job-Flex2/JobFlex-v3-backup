// DID QA STOP LOOKING SOMEWHERE? This run against the runs before it, test by test (title + browser):
//   · a forms test that found a form before and finds none now ("нет формы"), or is skipped now;
//   · any other test that ran before (passed or failed) and is skipped now, for a reason that is
//     not one of health.expectedSkips.
// Each such test is a lost piece of coverage: one finding per suite, P1 "QA потерял покрытие".
// That is how 41dd0170 would have been caught: its stricter form finder stopped seeing the hiring
// form (the one that had found ZodError → 500), and the run stayed green.
// A test missing from this run (another --suite / --grep) is not a loss — only one that was here.
import fs from "node:fs";
import path from "node:path";
import type { RawRun, RawTest } from "../lib/raw";
import { qaConfig } from "../lib/config";
import { RUNS_DIR } from "../lib/env";

export type CoverageLoss = { suite: string; test: RawTest; before: { run: string; outcome: string; forms?: number; submit?: string | null }; now: string };

const key = (t: RawTest) => `${t.project}|${t.title}`;
const formsOf = (t: RawTest) => (Array.isArray(t.meta?.forms) ? (t.meta.forms as { submit?: string | null }[]) : null);
const skipWhy = (t: RawTest) => t.annotations.filter((a) => a.type === "skip").map((a) => a.description ?? "").join("; ");

/** The latest earlier run's record of each test of this run (up to `maxRuns` runs back). */
function earlierRecords(raw: RawRun, runsDir: string, maxRuns = 6): Map<string, { run: string; t: RawTest }> {
  const out = new Map<string, { run: string; t: RawTest }>();
  if (!fs.existsSync(runsDir)) return out;
  const want = new Set(raw.tests.map(key));
  const dirs = fs.readdirSync(runsDir).filter((d) => d < raw.run.id && fs.existsSync(path.join(runsDir, d, "raw.json"))).sort().reverse().slice(0, maxRuns);
  for (const d of dirs) {
    let prev: RawRun;
    try { prev = JSON.parse(fs.readFileSync(path.join(runsDir, d, "raw.json"), "utf8")) as RawRun; } catch { continue; }
    for (const t of prev.tests) {
      const k = key(t);
      // the most recent run where the test really ran (or found a form) is the one to compare with
      if (!want.has(k) || out.has(k) || t.outcome === "skipped") continue;
      out.set(k, { run: d, t });
    }
    if (out.size === want.size) break;
  }
  return out;
}

export function coverageLosses(raw: RawRun, runsDir = RUNS_DIR): CoverageLoss[] {
  const expected = (qaConfig().health?.expectedSkips ?? []).map((r) => new RegExp(r, "i"));
  const before = earlierRecords(raw, runsDir);
  const out: CoverageLoss[] = [];
  for (const t of raw.tests) {
    const prev = before.get(key(t));
    if (!prev) continue;
    const prevForms = formsOf(prev.t);
    const nowForms = formsOf(t);
    if (t.suite === "forms" && prevForms?.length) {
      if (t.outcome === "skipped" || (nowForms && nowForms.length === 0)) {
        out.push({ suite: t.suite, test: t, before: { run: prev.run, outcome: prev.t.outcome, forms: prevForms.length, submit: prevForms[0]?.submit ?? null }, now: t.outcome === "skipped" ? `пропущен: ${skipWhy(t) || "без причины"}` : "форма больше не находится («нет формы»)" });
      }
      continue;
    }
    if (t.outcome === "skipped" && !expected.some((r) => r.test(skipWhy(t)))) {
      out.push({ suite: t.suite, test: t, before: { run: prev.run, outcome: prev.t.outcome }, now: `пропущен: ${skipWhy(t) || "без причины"}` });
    }
  }
  return out;
}
