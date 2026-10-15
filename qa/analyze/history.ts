// This run against the earlier ones: new findings, findings that went away, findings still there;
// one seen in `staleAfterRuns` analysed runs in a row is "застарелое" (stale).
import fs from "node:fs";
import path from "node:path";
import { RUNS_DIR } from "../lib/env";
import { qaConfig } from "../lib/config";
import type { Analysis, Finding } from "./types";

/** Analyses of the runs before `runId`, newest first. */
export function earlierAnalyses(runId: string, runsDir = RUNS_DIR): Analysis[] {
  if (!fs.existsSync(runsDir)) return [];
  return fs.readdirSync(runsDir)
    .filter((d) => d < runId && fs.existsSync(path.join(runsDir, d, "analysis.json")))
    .sort()
    .reverse()
    .map((d) => { try { return JSON.parse(fs.readFileSync(path.join(runsDir, d, "analysis.json"), "utf8")) as Analysis; } catch { return null; } })
    .filter((a): a is Analysis => !!a);
}

export function compareHistory(findings: Finding[], earlier: Analysis[]): { previous: string | null; gone: Analysis["summary"]["gone"]; counts: Analysis["summary"]["diff"] } {
  const prev = earlier[0] ?? null;
  const prevIds = new Set(prev ? [...prev.findings.map((f) => f.id), ...prev.hiddenByKnown.map((h) => h.id)] : []);
  const stale = qaConfig().analysis.staleAfterRuns;
  let nNew = 0, nStill = 0, nStale = 0;
  for (const f of findings) {
    let seen = 1;
    for (const a of earlier) { if (a.findings.some((x) => x.id === f.id)) seen++; else break; }
    const everBefore = earlier.some((a) => a.findings.some((x) => x.id === f.id));
    const status = prevIds.has(f.id) ? "still" : everBefore ? "returned" : "new";
    f.history = { status, seenRuns: seen, stale: seen >= stale };
    if (status === "new" || status === "returned") nNew++; else nStill++;
    if (f.history.stale) nStale++;
  }
  const now = new Set(findings.map((f) => f.id));
  const gone = prev ? prev.findings.filter((f) => !now.has(f.id)).map((f) => ({ id: f.id, title: f.title, severity: f.severity })) : [];
  return { previous: prev?.runId ?? null, gone, counts: { new: prev ? nNew : findings.length, gone: gone.length, still: nStill, stale: nStale } };
}
