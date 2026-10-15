// THE RAW RESULT — qa/runs/<run>/raw.json. A stable, self-contained format: the analysis
// (qa/analyze) reads only this file and the artefacts it names, and stage 2 will store it as is.
// Change it only by adding fields; a breaking change bumps SCHEMA.
import type { Collected } from "./collect";

export const SCHEMA = "jobflex-qa-raw/1";

export type RawStep = { title: string; category: string; startMs: number; durationMs: number; error?: string; steps?: RawStep[] };
export type RawError = { message: string; stack?: string; location?: { file: string; line: number; column: number }; snippet?: string };
export type RawEvent<T> = T & { step?: string };
export type RawArtifacts = {
  screenshot?: string;
  shots?: string[];
  trace?: string;
  visual?: { baseline?: string; actual: string; diff?: string; ratio?: number; created?: boolean };
  lighthouse?: string;
  output?: string;
};

export type RawTest = {
  /** Stable across runs: Playwright's id (file + title path + project). */
  id: string;
  title: string;
  titlePath: string[];
  file: string;
  line: number;
  project: string;
  suite: string;
  tags: string[];
  status: "passed" | "failed" | "timedOut" | "skipped" | "interrupted";
  expectedStatus: string;
  /** passed | failed | skipped | flaky — the verdict that counts. */
  outcome: "passed" | "failed" | "skipped" | "flaky";
  durationMs: number;
  retry: number;
  startedAt: string;
  annotations: { type: string; description?: string }[];
  errors: RawError[];
  steps: RawStep[];
  collected: {
    [K in keyof Collected]: RawEvent<Collected[K][number]>[];
  };
  artifacts: RawArtifacts;
  meta: Record<string, unknown>;
};

export type RawRun = {
  schema: typeof SCHEMA;
  run: {
    id: string;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    baseUrl: string;
    target: string;
    suites: string[];
    grep: string | null;
    projects: string[];
    git: { commit: string | null; branch: string | null; dirty: boolean | null };
    playwright: string;
    node: string;
    status: string;
    setup: { role: string; ok: boolean; note: string }[];
    notes: string[];
  };
  stats: { total: number; passed: number; failed: number; skipped: number; flaky: number; bySuite: Record<string, { total: number; passed: number; failed: number; skipped: number; flaky: number }> };
  tests: RawTest[];
};

export const SUITES = ["smoke", "signup", "billing", "roles", "pages", "forms", "visual", "perf", "logic"] as const;
