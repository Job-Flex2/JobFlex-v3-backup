// raw.json → signals. Deterministic: the same raw.json always gives the same signals, so the
// grouping and the severities can be self-tested without a model (qa/analyze/fixtures).
import type { RawRun, RawTest } from "../lib/raw";
import type { Signal, SignalKind } from "./types";
import { digestError, rootOf, type Digests } from "./roots";

const route = (t: RawTest) => (typeof t.meta?.route === "string" ? (t.meta.route as string) : null);
const role = (t: RawTest) => (typeof t.meta?.role === "string" ? (t.meta.role as string) : null);

function base(t: RawTest): Omit<Signal, "kind" | "message" | "rawRef" | "primary"> {
  return { testId: t.id, testTitle: t.title, suite: t.suite, project: t.project, file: t.file, route: route(t), role: role(t) };
}

/** Which collected event made the test fail, in order of how much it explains. */
const CAUSE_ORDER: SignalKind[] = ["environment", "forbidden", "legacy", "api-error", "page-error", "network", "timeout", "access", "unknown-access", "forms", "layout", "broken-link", "slow", "console-error", "visual", "assertion"];

/** `digests`: a production server's log (runs/<run>/server.log) — errors the browser knows only by digest. */
export function extractSignals(raw: RawRun, digests?: Digests): Signal[] {
  const out: Signal[] = [];
  const origin = (() => { try { return new URL(raw.run.baseUrl).origin; } catch { return ""; } })();
  raw.tests.forEach((t, i) => {
    const failed = t.outcome === "failed";
    const mine: Signal[] = [];
    const add = (s: Omit<Signal, keyof ReturnType<typeof base> | "primary"> & Partial<Signal>) => mine.push({ ...base(t), primary: false, ...s } as Signal);
    const c = t.collected;
    const fromLog = (body?: string): [string, string, string] | null => { const d = digestError([body], digests); return d ? ["", d.name, d.message] : null; };
    // statuses the test said it expects (qa.expectStatus(404) in lib/fixtures, or a tag @expects-404)
    const expected = new Set<number>([...((t.meta?.expectStatus as number[] | undefined) ?? []), ...t.tags.map((g) => Number(g.match(/^@expects-(\d{3})$/)?.[1])).filter(Boolean)]);

    c.forbidden.forEach((f, j) => add({ kind: "forbidden", message: `forbidden ${f.kind}: ${f.what}${f.why ? ` (${f.why})` : ""}`, url: f.url, step: f.step, rawRef: `tests[${i}].collected.forbidden[${j}]` }));
    c.httpErrors.forEach((e, j) => {
      if (!e.sameOrigin || expected.has(e.status)) return;
      const api = /\/api\//.test(e.url) || e.resourceType === "fetch" || e.resourceType === "xhr";
      // a made-up link token answering 404 is the expected answer
      if (e.status === 404 && t.meta?.realParams === false && e.resourceType === "document") return;
      if (e.status >= 500 || (api && e.status >= 400 && e.status !== 401 && e.status !== 403)) {
        // A Next server action POSTs to the page's own address: the page is not the cause. The
        // server's error, as the dev overlay logs it to the console ("NoOrgError: …"), is.
        const serverAction = e.method === "POST" && !/\/api\//.test(e.url);
        // the RSC answer itself names the error ({"name":"NoOrgError","message":…}); else the console
        const cause = !serverAction ? null : (e.body?.match(/"name":"(\w+)","message":"([^"]{0,120})"/) ?? c.console.map((x) => x.text.match(/\b([A-Z][A-Za-z]*Error): ([^\n]{3,120}?)(?:\s+at |\n|$)/)).find(Boolean) ?? fromLog(e.body) ?? null);
        add({ kind: "api-error", message: `HTTP ${e.status} ${e.method} ${pathOf(e.url)}${cause ? ` — ${cause[1]}: ${cause[2]}` : e.body ? ` — ${e.body.slice(0, 200)}` : ""}`, url: e.url, status: e.status, method: e.method, step: e.step, extra: { ...(serverAction ? { serverAction: true, cause: cause ? `${cause[1]}: ${cause[2]}` : null } : {}), body: e.body, root: rootOf([e.body, ...(serverAction ? c.console.map((x) => x.text) : [])], digests) }, rawRef: `tests[${i}].collected.httpErrors[${j}]` });
      } else if (e.status >= 400) {
        add({ kind: "broken-link", message: `HTTP ${e.status} ${e.method} ${pathOf(e.url)} (${e.resourceType})`, url: e.url, status: e.status, method: e.method, step: e.step, rawRef: `tests[${i}].collected.httpErrors[${j}]` });
      }
    });
    c.pageErrors.forEach((e, j) => add({ kind: "page-error", message: e.message, stack: e.stack, url: e.url, step: e.step, extra: { root: rootOf([e.message, e.stack], digests) }, rawRef: `tests[${i}].collected.pageErrors[${j}]` }));
    c.failedRequests.forEach((e, j) => { if (e.sameOrigin) add({ kind: DOWN.test(e.error) ? "environment" : "network", message: `${e.method} ${pathOf(e.url)} failed: ${e.error}`, url: e.url, method: e.method, step: e.step, rawRef: `tests[${i}].collected.failedRequests[${j}]` }); });
    // a line logged by another site's page (Stripe Checkout, hCaptcha) is that site's, never the cause of a failure here
    const ours = (u?: string) => !u || !/^https?:/.test(u) || u.startsWith(origin);
    c.console.forEach((e, j) => { if (e.type === "error" && !consoleExpected(e.text, expected)) add({ kind: "console-error", message: e.text, url: e.url, step: e.step, extra: { location: e.location, root: rootOf([e.text], digests), ...(ours(e.url) ? {} : { thirdParty: true }) }, rawRef: `tests[${i}].collected.console[${j}]` }); });
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
    // forms (before the annotations below): a wrong value SAVED explains a failed forms test better than
    // "no message was shown" — as the first forms signal it is the one that leads (2026-10-17: the
    // Settings → Proposals form that wrote 0 came out P3 "no validation message").
    if (m.kind === "forms") {
      (m.formResults as { scenario: string; savedRequests: number; validation: string[]; pressed: boolean; xss: boolean; crashed: boolean }[] | undefined)?.forEach((r, j) => {
        if (r.xss) add({ kind: "forms", message: `HTML typed into a field ran in the page (${r.scenario})`, rawRef: `tests[${i}].meta.formResults[${j}]` });
        else if (r.crashed) add({ kind: "forms", message: `the page broke on a ${r.scenario} submit`, rawRef: `tests[${i}].meta.formResults[${j}]` });
        else if (r.scenario === "invalid" && r.pressed && !r.validation.length && r.savedRequests > 0) add({ kind: "forms", message: "a wrong email / phone / number was saved without a word to the person", rawRef: `tests[${i}].meta.formResults[${j}]` });
      });
    }
    for (const a of t.annotations) {
      if (a.type === "unknown-access") add({ kind: "unknown-access", message: a.description ?? "unknown access", rawRef: `tests[${i}].annotations` });
      if (a.type === "warning" && /validation/.test(a.description ?? "")) add({ kind: "forms", message: a.description ?? "", rawRef: `tests[${i}].annotations` });
    }
    if (/^legacy /.test(t.title) && failed) {
      // the old script itself is the subject: qa/tests/<suite>/<file>, and its first FAIL line
      const script = t.title.match(/^legacy (\S+)/)?.[1] ?? "";
      const lines = (t.errors[0]?.message ?? "").replace(/\u001b\[[0-9;]*m/g, "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const why = lines.slice(1).find((l) => /FAIL|✗|✘|Error|expected/i.test(l) && !/^Expected:|^Received:/.test(l)) ?? lines[0] ?? "the script failed";
      add({ kind: "legacy", file: `qa/tests/${script}`, message: `${script}: ${why}`.slice(0, 400), stack: t.errors[0]?.message, rawRef: `tests[${i}].errors[0]` });
    }
    if (m.kind === "visual" && failed) add({ kind: "visual", message: firstLine(t.errors[0]?.message ?? "visual difference"), extra: { visualId: m.visualId, ratio: m.ratio, box: m.box ?? null, viewport: m.viewport }, rawRef: `tests[${i}].errors[0]` });

    // The browser's "Failed to load resource: … status of 500" is the same answer an api-error
    // above already holds: it takes that answer's root, so it never stands as a finding alone.
    for (const s of mine) {
      if (s.kind !== "console-error" || s.extra?.root) continue;
      const st = Number(s.message.match(/Failed to load resource: the server responded with a status of (\d{3})/)?.[1]);
      const twin = st ? mine.find((x) => x.kind === "api-error" && x.status === st && x.extra?.root) : null;
      if (twin) s.extra = { ...s.extra, root: twin.extra!.root };
    }
    // React's own line for the same failure ("Minified React error #441" beside "[route-error] <digest>"):
    // a console error with no root of its own, in a test where exactly one root was seen, is that root's
    const roots = new Set(mine.map((x) => x.extra?.root).filter(Boolean));
    if (roots.size === 1) for (const s of mine) if (s.kind === "console-error" && !s.extra?.root && /Minified React error|status of 5\d\d/.test(s.message)) s.extra = { ...s.extra, root: [...roots][0] };

    if (failed) {
      // the test's own error: a timeout or a failed check — or the server or browser gone
      t.errors.forEach((e, j) => {
        if (DOWN.test(e.message) || INFRA.test(e.message)) add({ kind: "environment", message: firstLine(e.message), rawRef: `tests[${i}].errors[${j}]` });
        const kind: SignalKind = /Timeout \d+ms exceeded|Test timeout of/.test(e.message) ? "timeout" : "assertion";
        // the test could not find an element: most likely the test's selector, not the product
        const testSide = LOCATOR_MISS.test(e.message);
        // @money: a price / an amount the person pays (lib/… smoke "pricing shows the catalogue's own prices")
        add({ kind, message: firstLine(e.message), stack: e.stack, extra: { location: e.location, snippet: e.snippet, testSide, money: t.tags.includes("@money") || t.meta?.money === true }, rawRef: `tests[${i}].errors[${j}]` });
      });
      // the cause: the most explaining signal seen
      const cause = CAUSE_ORDER.map((k) => mine.find((s) => s.kind === k && !s.extra?.thirdParty && !(k === "console-error" && mine.some((x) => x.kind === "api-error")))).find(Boolean);
      if (cause) cause.primary = true;
    }
    out.push(...mine);
  });
  return out;
}

/** A locator that never matched: "waiting for locator(…)", "element(s) not found", a fill/click timeout. */
// … or the test's own fixture never came up ("Test timeout … while setting up "page"": the sign-in
// state, the browser) — the product never got to answer
const LOCATOR_MISS = /locator\.\w+: Timeout \d+ms exceeded|waiting for (?:locator|getBy\w+)\(|element\(s\) not found|while setting up "/;

/** "Failed to load resource: … status of 404" for a status the test expects. */
function consoleExpected(text: string, expected: Set<number>): boolean {
  const m = text.match(/status of (\d{3})/);
  return !!m && expected.has(Number(m[1]));
}

/** The server under test (or the test's own browser) went away: not a product defect. */
/** The test's own browser could not take its picture — not the product. */
const INFRA = /Protocol error \(Page\.captureScreenshot\)|Unable to capture screenshot/;
const DOWN = /ERR_CONNECTION_REFUSED|ECONNREFUSED|ERR_CONNECTION_RESET|ECONNRESET|ERR_EMPTY_RESPONSE|socket hang up|Target page, context or browser has been closed|Page crashed|worker process exited unexpectedly/;

export function pathOf(url: string): string {
  try { return new URL(url).pathname; } catch { return url.replace(/[?#].*$/, ""); }
}
export function firstLine(s: string): string {
  return s.replace(/\u001b\[[0-9;]*m/g, "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[0]?.slice(0, 400) ?? "";
}
