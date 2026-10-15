// raw.json → signals. Deterministic: the same raw.json always gives the same signals, so the
// grouping and the severities can be self-tested without a model (qa/analyze/fixtures).
import type { RawRun, RawTest } from "../lib/raw";
import type { Signal, SignalKind } from "./types";

const route = (t: RawTest) => (typeof t.meta?.route === "string" ? (t.meta.route as string) : null);
const role = (t: RawTest) => (typeof t.meta?.role === "string" ? (t.meta.role as string) : null);

function base(t: RawTest): Omit<Signal, "kind" | "message" | "rawRef" | "primary"> {
  return { testId: t.id, testTitle: t.title, suite: t.suite, project: t.project, file: t.file, route: route(t), role: role(t) };
}

/** Which collected event made the test fail, in order of how much it explains. */
const CAUSE_ORDER: SignalKind[] = ["forbidden", "api-error", "page-error", "network", "timeout", "access", "unknown-access", "legacy", "forms", "layout", "broken-link", "slow", "console-error", "assertion", "visual"];

export function extractSignals(raw: RawRun): Signal[] {
  const out: Signal[] = [];
  raw.tests.forEach((t, i) => {
    const failed = t.outcome === "failed";
    const mine: Signal[] = [];
    const add = (s: Omit<Signal, keyof ReturnType<typeof base> | "primary"> & Partial<Signal>) => mine.push({ ...base(t), primary: false, ...s } as Signal);
    const c = t.collected;

    c.forbidden.forEach((f, j) => add({ kind: "forbidden", message: `forbidden ${f.kind}: ${f.what}${f.why ? ` (${f.why})` : ""}`, url: f.url, step: f.step, rawRef: `tests[${i}].collected.forbidden[${j}]` }));
    c.httpErrors.forEach((e, j) => {
      if (!e.sameOrigin) return;
      const api = /\/api\//.test(e.url) || e.resourceType === "fetch" || e.resourceType === "xhr";
      // a made-up link token answering 404 is the expected answer
      if (e.status === 404 && t.meta?.realParams === false && e.resourceType === "document") return;
      if (e.status >= 500 || (api && e.status >= 400 && e.status !== 401 && e.status !== 403)) {
        add({ kind: "api-error", message: `HTTP ${e.status} ${e.method} ${pathOf(e.url)}${e.body ? ` — ${e.body.slice(0, 200)}` : ""}`, url: e.url, status: e.status, method: e.method, step: e.step, rawRef: `tests[${i}].collected.httpErrors[${j}]` });
      } else if (e.status >= 400) {
        add({ kind: "broken-link", message: `HTTP ${e.status} ${e.method} ${pathOf(e.url)} (${e.resourceType})`, url: e.url, status: e.status, method: e.method, step: e.step, rawRef: `tests[${i}].collected.httpErrors[${j}]` });
      }
    });
    c.pageErrors.forEach((e, j) => add({ kind: "page-error", message: e.message, stack: e.stack, url: e.url, step: e.step, rawRef: `tests[${i}].collected.pageErrors[${j}]` }));
    c.failedRequests.forEach((e, j) => { if (e.sameOrigin) add({ kind: "network", message: `${e.method} ${pathOf(e.url)} failed: ${e.error}`, url: e.url, method: e.method, step: e.step, rawRef: `tests[${i}].collected.failedRequests[${j}]` }); });
    c.console.forEach((e, j) => { if (e.type === "error") add({ kind: "console-error", message: e.text, url: e.url, step: e.step, extra: { location: e.location }, rawRef: `tests[${i}].collected.console[${j}]` }); });
    c.hungRequests.forEach((e, j) => { if (e.sameOrigin) add({ kind: "network", message: `${e.method} ${pathOf(e.url)} never answered (${Math.round(e.ms / 1000)} s)`, url: e.url, step: e.step, rawRef: `tests[${i}].collected.hungRequests[${j}]` }); });

    const m = t.meta ?? {};
    // the pages suite's measurements
    const layout = m.layout as { scrollX?: boolean; docWidth?: number; outside?: string[] } | undefined;
    if (layout?.scrollX || layout?.outside?.length) add({ kind: "layout", message: `${layout.scrollX ? `sideways scroll at 390 (page ${layout.docWidth}px wide)` : "content past the screen's edge"}${layout.outside?.length ? `: ${layout.outside.slice(0, 3).join("; ")}` : ""}`, rawRef: `tests[${i}].meta.layout` });
    const links = m.brokenLinks as string[] | undefined;
    links?.forEach((l, j) => add({ kind: "broken-link", message: `link on the page leads to ${l}`, rawRef: `tests[${i}].meta.brokenLinks[${j}]` }));
    if (typeof m.warmMs === "number" && t.errors.some((e) => /warm load/.test(e.message))) add({ kind: "slow", message: `warm load ${m.warmMs} ms`, rawRef: `tests[${i}].meta.warmMs` });
    (m.axe as { id: string; impact: string; help: string; nodes: number }[] | undefined)?.forEach((v, j) => add({ kind: "a11y", message: `${v.id} (${v.impact}): ${v.help} — ${v.nodes} element(s)`, extra: { rule: v.id, impact: v.impact }, rawRef: `tests[${i}].meta.axe[${j}]` }));
    if (m.kind === "lighthouse" && Array.isArray(m.below) && (m.below as string[]).length) add({ kind: "perf", message: `Lighthouse ${m.formFactor}: ${(m.below as string[]).join(", ")}`, extra: { formFactor: m.formFactor, scores: m.scores }, rawRef: `tests[${i}].meta.below` });
    if (m.kind === "access" && failed) add({ kind: "access", message: firstLine(t.errors[0]?.message ?? "access differs"), extra: { cells: m.cells, expected: m.expected }, rawRef: `tests[${i}].errors[0]` });
    for (const a of t.annotations) {
      if (a.type === "unknown-access") add({ kind: "unknown-access", message: a.description ?? "unknown access", rawRef: `tests[${i}].annotations` });
      if (a.type === "warning" && /validation/.test(a.description ?? "")) add({ kind: "forms", message: a.description ?? "", rawRef: `tests[${i}].annotations` });
    }
    if (m.kind === "forms") {
      (m.formResults as { scenario: string; savedRequests: number; validation: string[]; pressed: boolean; xss: boolean; crashed: boolean }[] | undefined)?.forEach((r, j) => {
        if (r.xss) add({ kind: "forms", message: `HTML typed into a field ran in the page (${r.scenario})`, rawRef: `tests[${i}].meta.formResults[${j}]` });
        else if (r.crashed) add({ kind: "forms", message: `the page broke on a ${r.scenario} submit`, rawRef: `tests[${i}].meta.formResults[${j}]` });
        else if (r.scenario === "invalid" && r.pressed && !r.validation.length && r.savedRequests > 0) add({ kind: "forms", message: "a wrong email / phone / number was saved without a word to the person", rawRef: `tests[${i}].meta.formResults[${j}]` });
      });
    }
    if (/^legacy /.test(t.title) && failed) {
      // the old script itself is the subject: qa/tests/<suite>/<file>, and its first FAIL line
      const script = t.title.match(/^legacy (\S+)/)?.[1] ?? "";
      const lines = (t.errors[0]?.message ?? "").replace(/\u001b\[[0-9;]*m/g, "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const why = lines.slice(1).find((l) => /FAIL|✗|✘|Error|expected/i.test(l) && !/^Expected:|^Received:/.test(l)) ?? lines[0] ?? "the script failed";
      add({ kind: "legacy", file: `qa/tests/${script}`, message: `${script}: ${why}`.slice(0, 400), stack: t.errors[0]?.message, rawRef: `tests[${i}].errors[0]` });
    }
    if (m.kind === "visual" && failed) add({ kind: "visual", message: firstLine(t.errors[0]?.message ?? "visual difference"), extra: { visualId: m.visualId, ratio: m.ratio }, rawRef: `tests[${i}].errors[0]` });

    if (failed) {
      // the test's own error: a timeout or a failed check
      t.errors.forEach((e, j) => {
        const kind: SignalKind = /Timeout \d+ms exceeded|Test timeout of/.test(e.message) ? "timeout" : "assertion";
        add({ kind, message: firstLine(e.message), stack: e.stack, extra: { location: e.location, snippet: e.snippet }, rawRef: `tests[${i}].errors[${j}]` });
      });
      // the cause: the most explaining signal seen
      const cause = CAUSE_ORDER.map((k) => mine.find((s) => s.kind === k && !(k === "console-error" && mine.some((x) => x.kind === "api-error")))).find(Boolean);
      if (cause) cause.primary = true;
    }
    out.push(...mine);
  });
  return out;
}

export function pathOf(url: string): string {
  try { return new URL(url).pathname; } catch { return url.replace(/[?#].*$/, ""); }
}
export function firstLine(s: string): string {
  return s.replace(/\u001b\[[0-9;]*m/g, "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[0]?.slice(0, 400) ?? "";
}
