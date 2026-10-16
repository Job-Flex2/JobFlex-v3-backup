// THE ANALYSIS of one run: raw.json (+ artefacts) → analysis.json, report.md, report.html.
//   signals (rules) → findings grouped by cause (rules) → words and merges (cheap model)
//   → file and line (rules, then the strong model for P0–P2) → fix prompt (P0–P2)
//   → visual verdicts → known false positives set aside → compared with earlier runs → reports.
import fs from "node:fs";
import path from "node:path";
import type { RawRun } from "../lib/raw";
import { knownIssues, qaConfig, type KnownIssue } from "../lib/config";
import { RUNS_DIR } from "../lib/env";
import { extractSignals } from "./signals";
import { serverDigests } from "./roots";
import { group } from "./group";
import { modelWords, ruleWords } from "./words";
import { fixPrompt, localize } from "./localize";
import { reviewVisual } from "./visual";
import { compareHistory, earlierAnalyses } from "./history";
import { renderHtml, renderMarkdown } from "./report";
import { Llm } from "./llm";
import { redact } from "../lib/redact";
import { SEVERITIES, type Analysis, type Finding, type Severity, type Signal } from "./types";

export type AnalyzeOptions = { offline?: boolean; budgetUsd?: number; runsDir?: string; known?: KnownIssue[]; write?: boolean };

function matchesKnown(f: Finding, k: KnownIssue): boolean {
  const re = (p?: string) => (p ? new RegExp(p, "i") : null);
  const checks: [RegExp | null, string[]][] = [
    [re(k.signature), [f.id, f.signature]],
    [re(k.message), [f.evidence.message]],
    [re(k.test), f.evidence.tests.map((t) => t.title)],
    [re(k.route), f.evidence.routes],
  ];
  const used = checks.filter(([r]) => r);
  return used.length > 0 && used.every(([r, vals]) => vals.some((v) => r!.test(v)));
}

export async function analyzeRun(runDir: string, opts: AnalyzeOptions = {}): Promise<Analysis> {
  const raw = JSON.parse(fs.readFileSync(path.join(runDir, "raw.json"), "utf8")) as RawRun;
  const llm = new Llm({ offline: opts.offline, budgetUsd: opts.budgetUsd });
  const notes: string[] = [];
  if (llm.cost.mode === "offline") notes.push(opts.offline ? "Анализ без модели (--offline): группировка, важность и тексты — по правилам." : "ANTHROPIC_API_KEY не задан: группировка, важность и тексты — по правилам, без модели.");

  // 1–2. signals → groups → words by rule
  // a production build's server log (qa:build-run) names the errors the browser saw only by digest
  let digests;
  try { digests = serverDigests(fs.readFileSync(path.join(runDir, "server.log"), "utf8")); } catch { /* a dev run: no log */ }
  const signals = extractSignals(raw, digests);
  const groups = group(raw, signals);
  const bySig = new Map<string, Signal[]>();
  let findings: Finding[] = groups.map(({ finding, signals: list }) => {
    bySig.set(finding.id, list);
    return { ...finding, ...ruleWords(finding, list) } as Finding;
  });

  // 3. the cheap model: the words, the severity (with its reason) and merges of one cause
  const words = await modelWords(llm, findings);
  const merged = new Set<string>();
  for (const f of findings) {
    const w = words.get(f.id);
    if (!w) continue;
    f.title = w.title || f.title;
    f.human = { ...f.human, what: w.what || f.human.what, whoIsAffected: w.whoIsAffected || f.human.whoIsAffected, steps: w.steps?.length ? w.steps : f.human.steps };
    if (SEVERITIES.includes(w.severity as Severity) && w.severity !== f.severity) {
      f.severityWhy = `${w.severityWhy} (модель; по правилу было ${f.severity}: ${f.severityWhy})`;
      f.severity = w.severity as Severity;
    }
    f.model = { describedBy: "cheap model" };
    const into = w.sameCauseAs && findings.find((x) => x.id === w.sameCauseAs && x.id !== f.id);
    if (into && !merged.has(into.id)) {
      into.evidence.tests.push(...f.evidence.tests.filter((t) => !into.evidence.tests.some((x) => x.id === t.id)));
      into.evidence.routes = [...new Set([...into.evidence.routes, ...f.evidence.routes])];
      into.evidence.alsoSeen = [...new Set([`(тот же источник) ${f.title}`, ...into.evidence.alsoSeen])].slice(0, 10);
      into.evidence.rawRefs = [...into.evidence.rawRefs, ...f.evidence.rawRefs].slice(0, 30);
      bySig.set(into.id, [...(bySig.get(into.id) ?? []), ...(bySig.get(f.id) ?? [])]);
      merged.add(f.id);
    }
  }
  findings = findings.filter((f) => !merged.has(f.id));

  // screenshots: the first failing test's masked failure shot
  for (const f of findings) {
    const shot = f.evidence.tests.map((t) => raw.tests.find((x) => x.id === t.id)?.artifacts.screenshot).find(Boolean);
    if (shot) f.human.screenshot = shot;
  }

  // 4. known false positives — not shown, counted
  const known = opts.known ?? knownIssues();
  const hidden: Analysis["hiddenByKnown"] = [];
  findings = findings.filter((f) => {
    const k = known.find((x) => matchesKnown(f, x));
    if (k) hidden.push({ id: f.id, knownId: k.id, title: f.title });
    return !k;
  });

  // 5. where in the code, and the fix prompt (P0–P2)
  const order = { P0: 0, P1: 1, P2: 2, P3: 3 } as const;
  findings.sort((a, b) => order[a.severity] - order[b.severity] || b.evidence.tests.length - a.evidence.tests.length);
  let strong = 0;
  for (const f of findings) {
    const list = bySig.get(f.id) ?? [];
    const allowModel = f.severity !== "P3" && strong < qaConfig().analysis.maxLocalize;
    const r = await localize(allowModel ? llm : new Llm({ offline: true }), f, list);
    if (r.byModel) { strong++; f.model = { ...f.model, localizedBy: "strong model" }; }
    f.location = r.location;
    if (r.note) f.locationNote = r.note;
    if (!f.location && !f.locationNote) f.locationNote = "не найдено";
    if (f.severity !== "P3") f.fixPrompt = fixPrompt(f);
  }

  // 6. visual pairs
  const visual = await reviewVisual(llm, raw, runDir);
  for (const v of visual.filter((x) => x.verdict === "bug")) {
    const f = findings.find((x) => x.kind === "visual" && x.signature === `visual ${v.id}`);
    if (f) { f.title = `Вёрстка сломалась: ${v.route} (${v.viewport} px)`; f.human.what = v.why; }
  }
  // a difference judged intended or noise is not a defect: out of the findings, still in the section
  findings = findings.filter((f) => !(f.kind === "visual" && visual.some((v) => `visual ${v.id}` === f.signature && (v.verdict === "intended" || v.verdict === "noise"))));

  // 7. history
  const hist = compareHistory(findings, earlierAnalyses(raw.run.id, opts.runsDir ?? RUNS_DIR));

  // 8. speed by page, and role × page
  const perf: Analysis["perf"] = [];
  for (const t of raw.tests) {
    const m = t.meta ?? {};
    if (m.kind === "page" && typeof m.coldMs === "number") perf.push({ route: String(m.route), role: String(m.role), viewport: "390", coldMs: m.coldMs as number, warmMs: m.warmMs as number });
    if (m.kind === "lighthouse") perf.push({ route: String(m.route), role: String(m.role), viewport: String(m.formFactor), lighthouse: m.scores as Record<string, number | null>, metrics: m.metrics as Record<string, number | null> });
  }
  const matrix: Analysis["matrix"] = { routes: [], roles: ["guest", "owner", "manager", "worker", "admin", "homeowner"], cells: {} };
  for (const t of raw.tests.filter((x) => x.meta?.kind === "access")) {
    const route = String(t.meta.route);
    const cells = (t.meta.cells ?? {}) as Record<string, string>;
    const exp = (t.meta.expected ?? null) as Record<string, string> | null;
    const review = new Set(((t.meta.review ?? []) as string[]));
    matrix.routes.push(route);
    matrix.cells[route] = Object.fromEntries(Object.entries(cells).map(([r, c]) => [r, { actual: c, expected: exp?.[r], ok: !!exp?.[r] && exp[r].split("|").includes(c), review: review.has(r) }]));
  }
  matrix.routes.sort();

  const counts = Object.fromEntries(SEVERITIES.map((s) => [s, findings.filter((f) => f.severity === s).length])) as Record<Severity, number>;
  if (llm.cost.stoppedForBudget) notes.push(`Бюджет анализа $${llm.cost.budgetUsd.toFixed(2)} исчерпан: остальное — по правилам.`);
  const analysis: Analysis = {
    schema: "jobflex-qa-analysis/1",
    runId: raw.run.id,
    analyzedAt: new Date().toISOString(),
    summary: {
      tests: { total: raw.stats.total, passed: raw.stats.passed, failed: raw.stats.failed, skipped: raw.stats.skipped, flaky: raw.stats.flaky },
      bySuite: raw.stats.bySuite,
      findings: counts,
      known: hidden.length,
      durationMs: raw.run.durationMs,
      target: raw.run.target,
      baseUrl: raw.run.baseUrl,
      previousRun: hist.previous,
      diff: hist.counts,
      gone: hist.gone,
    },
    findings,
    hiddenByKnown: hidden,
    visual,
    perf,
    matrix,
    cost: llm.cost,
    notes: [...notes, ...(raw.run.notes ?? []), ...raw.run.setup.filter((s) => !s.ok).map((s) => `Роль ${s.role}: ${s.note}`)],
  };
  if (opts.write !== false) {
    fs.writeFileSync(path.join(runDir, "analysis.json"), JSON.stringify(analysis, null, 1));
    // one more pass of the redaction over what people read (raw.json was redacted when written)
    fs.writeFileSync(path.join(runDir, "report.md"), redact(renderMarkdown(analysis, raw)));
    fs.writeFileSync(path.join(runDir, "report.html"), renderHtml(analysis, raw, runDir).split(/(data:image\/png;base64,[A-Za-z0-9+/=]+|<style>[\s\S]*?<\/style>)/).map((part, i) => (i % 2 ? part : redact(part))).join(""));
  }
  return analysis;
}
