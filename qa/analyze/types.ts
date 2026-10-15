// The analysis' own types. analysis.json (beside raw.json) is written in this shape; the next
// run's analysis reads it for the "new / gone / still there" comparison, and qa:accept reads
// its visual verdicts.
export type Severity = "P0" | "P1" | "P2" | "P3";
export const SEVERITIES: Severity[] = ["P0", "P1", "P2", "P3"];

export type SignalKind =
  | "forbidden" // a forbidden action was attempted
  | "api-error" // a 5xx (or 4xx on an API) from this server
  | "page-error" // an uncaught exception in the page
  | "network" // a request that failed (no answer)
  | "console-error"
  | "timeout"
  | "assertion" // the test's own check failed
  | "access" // roles matrix: a cell differs
  | "unknown-access" // a page the matrix does not know
  | "layout" // sideways scroll / elements past the edge
  | "broken-link"
  | "slow" // page over the load threshold
  | "forms" // a form accepted bad input / showed no validation
  | "legacy" // an old script failed
  | "visual"
  | "a11y"
  | "perf"; // Lighthouse under the threshold

/** One observation, with the exact place in raw.json it came from. */
export type Signal = {
  kind: SignalKind;
  testId: string;
  testTitle: string;
  suite: string;
  project: string;
  file: string;
  route: string | null;
  role: string | null;
  message: string;
  stack?: string;
  url?: string;
  status?: number;
  method?: string;
  step?: string;
  /** e.g. tests[12].collected.httpErrors[0] */
  rawRef: string;
  /** true when this signal is why the test failed (not only seen on the way) */
  primary: boolean;
  extra?: Record<string, unknown>;
};

export type Location = { file: string; line: number | null; why: string; confidence: "high" | "medium" | "low"; source: "stack" | "route" | "component" | "model" };

export type Finding = {
  id: string; // F-<signature hash>, stable across runs
  signature: string;
  kind: SignalKind;
  severity: Severity;
  severityWhy: string;
  title: string;
  /** "Для человека" */
  human: { what: string; whoIsAffected: string; steps: string[]; screenshot?: string };
  /** "Откуда это известно" */
  evidence: { message: string; stack?: string; tests: { id: string; title: string; project: string; file: string; outcome: string }[]; routes: string[]; rawRefs: string[]; alsoSeen: string[] };
  location: Location | null;
  locationNote?: string;
  fixPrompt?: string;
  history?: { status: "new" | "still" | "returned"; seenRuns: number; stale: boolean };
  known?: string; // id of the known-issues.yaml entry that hides it
  model?: { describedBy?: string; localizedBy?: string };
};

export type VisualVerdict = { id: string; testTitle: string; route: string; viewport: string; role: string; ratio: number; verdict: "bug" | "intended" | "noise" | "unreviewed"; why: string; reviewedBy: string; before?: string; after: string; diff?: string; accept: string };

export type Cost = { calls: number; inputTokens: number; outputTokens: number; usd: number; byModel: Record<string, { calls: number; usd: number }>; budgetUsd: number; stoppedForBudget: boolean; mode: "model" | "offline" };

export type Analysis = {
  schema: "jobflex-qa-analysis/1";
  runId: string;
  analyzedAt: string;
  summary: {
    tests: { total: number; passed: number; failed: number; skipped: number; flaky: number };
    bySuite: Record<string, { total: number; passed: number; failed: number; skipped: number; flaky: number }>;
    findings: Record<Severity, number>;
    known: number;
    durationMs: number;
    target: string;
    baseUrl: string;
    previousRun: string | null;
    diff: { new: number; gone: number; still: number; stale: number };
    gone: { id: string; title: string; severity: Severity }[];
  };
  findings: Finding[];
  hiddenByKnown: { id: string; knownId: string; title: string }[];
  visual: VisualVerdict[];
  perf: { route: string; role: string; viewport: string; coldMs?: number; warmMs?: number; lighthouse?: Record<string, number | null>; metrics?: Record<string, number | null> }[];
  matrix: { routes: string[]; roles: string[]; cells: Record<string, Record<string, { actual: string; expected?: string; ok: boolean; review: boolean }>> };
  cost: Cost;
  notes: string[];
};
