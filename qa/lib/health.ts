// IS THIS RUN TO BE TRUSTED? A suite that skipped most of its tests tested nothing, and a green
// report over it is a lie: on 2026-10-16 the QA guard skipped 175 old checks (a Prisma client
// without its .env path) and the report showed "logic: 0 passed, 117 skipped" without a word.
//   · a suite with every test skipped, or more than `health.maxSkipShare` of them skipped, marks the
//     run FAILED — the reporter prints it, bin/qa.ts exits non-zero, the report's first line says why;
//   · skips whose reason matches `health.expectedSkips` (qa.config.yaml: a mode this server is not in,
//     said in the test) are listed but do not count toward the share.
import type { RawRun } from "./raw";
import { qaConfig } from "./config";

export type RunHealth = { status: "ok" | "FAILED"; problems: string[]; skipped: { suite: string; total: number; skipped: number; counted: number; reasons: { why: string; n: number }[] }[] };

const skipWhy = (t: RawRun["tests"][number]) => (t.annotations.filter((a) => a.type === "skip").map((a) => a.description ?? "").join("; ") || "(no reason given)").replace(/\s+/g, " ");

export function runHealth(raw: Pick<RawRun, "tests">): RunHealth {
  const cfg = qaConfig().health ?? { maxSkipShare: 0.2, expectedSkips: [] };
  const expected = (cfg.expectedSkips ?? []).map((r) => new RegExp(r, "i"));
  const suites = [...new Set(raw.tests.map((t) => t.suite))].sort();
  const problems: string[] = [];
  const skipped: RunHealth["skipped"] = [];
  for (const s of suites) {
    const list = raw.tests.filter((t) => t.suite === s);
    const sk = list.filter((t) => t.outcome === "skipped");
    if (!sk.length) continue;
    const counted = sk.filter((t) => !expected.some((r) => r.test(skipWhy(t))));
    const byWhy = new Map<string, number>();
    for (const t of sk) { const w = skipWhy(t).slice(0, 160); byWhy.set(w, (byWhy.get(w) ?? 0) + 1); }
    const reasons = [...byWhy].map(([why, n]) => ({ why, n })).sort((a, b) => b.n - a.n);
    skipped.push({ suite: s, total: list.length, skipped: sk.length, counted: counted.length, reasons });
    const top = reasons[0] ? ` — чаще всего: «${reasons[0].why.slice(0, 140)}» (${reasons[0].n})` : "";
    if (sk.length === list.length) problems.push(`набор ${s} пропущен целиком (${sk.length} из ${list.length})${top}`);
    else if (counted.length / list.length > cfg.maxSkipShare) problems.push(`набор ${s}: пропущено ${counted.length} из ${list.length} (${Math.round((100 * counted.length) / list.length)}% > ${Math.round(cfg.maxSkipShare * 100)}%)${top}`);
  }
  return { status: problems.length ? "FAILED" : "ok", problems, skipped };
}
