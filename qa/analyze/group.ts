// Signals → findings: one finding per cause. A failing test counts under the signal that explains
// it (lib: signals.ts marks it primary) — so one API error that brought down twelve tests is one
// finding with twelve tests, not twelve. Severity by rule (P0–P3, below); the model may refine
// the words and merge groups that are one cause under two signatures (index.ts).
import { createHash } from "node:crypto";
import type { RawRun } from "../lib/raw";
import { normalisePath } from "../lib/matrix";
import { pathOf } from "./signals";
import type { Finding, Severity, Signal, SignalKind } from "./types";
import { qaConfig } from "../lib/config";

export function norm(s: string): string {
  return s
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/https?:\/\/[^/\s"']+/g, "")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":uuid")
    .replace(/\bc[a-z0-9]{20,}\b/g, ":id")
    .replace(/qa-[a-z0-9-]+@qa\.jobflex\.test/gi, ":qa-email")
    .replace(/\d+(\.\d+)?/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function topFrame(stack?: string): string {
  if (!stack) return "";
  const m = stack.match(/(src\/[\w\-./()[\]@]+\.(?:tsx?|jsx?))/);
  return m ? m[1] : "";
}

const area = (route: string | null) => (route ? route.split("/").slice(0, 3).join("/") : "");

/** What makes two signals the same cause. */
export function signatureOf(s: Signal): string {
  // One root (error name + the function it was thrown in) is one cause, however it surfaced:
  // a server action's 500, the dev overlay's console line, a page error.
  if (s.extra?.root && (s.kind === "api-error" || s.kind === "page-error" || s.kind === "console-error")) return `root ${String(s.extra.root)}`;
  switch (s.kind) {
    case "api-error":
      // a server action's error is one cause wherever the page is; group by it (and the role)
      if (s.extra?.serverAction) return `server-action ${s.status} ${s.extra.cause ? norm(String(s.extra.cause)) : "(the error is not in the console)"} as ${s.role ?? "?"}`;
      return `api ${s.status} ${s.method} ${normalisePath(pathOf(s.url ?? ""))}`;
    case "environment": return "environment server-unavailable";
    // a generic message (React's hydration text) is one cause per page, not one for the app
    case "page-error": return `page-error ${norm(s.message).slice(0, 120)} @ ${topFrame(s.stack) || normalisePath(pathOf(s.url ?? ""))}`;
    case "network": return `network ${norm(s.message)}`;
    case "console-error": return `console ${norm(s.message)}`;
    case "forbidden": return `forbidden ${norm(s.message)}`;
    case "access": {
      const cells = (s.extra?.cells ?? {}) as Record<string, string>;
      const exp = ((s.extra?.expected ?? {}) as Record<string, string>) || {};
      const diffs = Object.keys(cells).filter((r) => exp[r] && !exp[r].split("|").includes(cells[r])).map((r) => `${r}:${exp[r]}→${cells[r]}`).sort();
      return `access ${area(s.route)} ${diffs.join(",") || norm(s.message)}`;
    }
    case "unknown-access": return "unknown-access";
    case "layout": return `layout ${s.route}`;
    case "broken-link": return `broken-link ${norm(s.message.replace(/^link on the page leads to /, ""))}`;
    case "slow": return "slow pages";
    case "a11y": return `a11y ${String(s.extra?.rule ?? norm(s.message))}`;
    case "perf": return `perf ${norm(s.message.replace(/ \d+ < /g, " < "))}`;
    case "forms": return `forms ${s.route} ${norm(s.message)}`;
    case "legacy": return `legacy ${s.file}`;
    case "visual": return `visual ${String(s.extra?.visualId ?? s.testTitle)}`;
    case "timeout":
    case "assertion":
    default: return `${s.kind} ${s.file} ${norm(s.message)}`;
  }
}

export const findingId = (sig: string) => "F-" + createHash("sha1").update(sig).digest("hex").slice(0, 8);

const SIGNIN = /\/(auth\/(login|register)|api\/(auth|checkout|billing|qa\/otp))/;
const KEY_PAGES = /^\/dashboard(\/(proposals|projects|jobs|clients|leads|financials|calendar|manual-blueprint|roof-estimator|fence-estimator|hvac-estimator|deck-estimator|subscription|upgrade))?(\/|$)/;
const MAIN_PATH = /code|plan|card|dashboard|sign[- ]?(up|in)|log[- ]?in|checkout|trial|password|register/i;
const HARD: SignalKind[] = ["api-error", "page-error", "timeout", "assertion", "network", "legacy"];

/** The rule-based severity and its reason. P0 — cannot sign up / sign in / pay; P1 — a key
 *  function broken; P2 — works with a defect; P3 — cosmetic, speed, warnings. */
export function severityOf(kind: SignalKind, signals: Signal[]): { severity: Severity; why: string } {
  // Only a test that FAILED counts toward P0/P1; an error a passing test merely saw is P2 at most.
  const failed = signals.filter((s) => s.primary);
  const routes = failed.map((s) => s.route ?? pathOf(s.url ?? "")).filter(Boolean);
  // Money: a price, an amount to pay — wrong is P1 whatever kind of check saw it (@money tests)
  if (failed.some((s) => s.extra?.money)) return { severity: "P1", why: "деньги: цена или сумма не совпадает с каталогом" };
  if (HARD.includes(kind) || kind === "console-error") {
    // the test could not find an element: most likely its own selector — P2, said so
    if (failed.length && failed.every((s) => s.extra?.testSide)) return { severity: "P2", why: "вероятно, ошибка теста: элемент не найден (locator), а не сбой продукта" };
    // P0: the sign-up, sign-in or payment step itself did not go through — a signup/billing test
    // (or the smoke sign-in / sign-up check) failed on its action
    const actionFailed = failed.some((s) => !s.extra?.testSide && (s.suite === "signup" || s.suite === "billing" || (s.suite === "smoke" && /sign-?in|sign-?up|code step|register/i.test(s.testTitle))) && MAIN_PATH.test(s.testTitle) && !/google/i.test(s.testTitle));
    if (actionFailed) return { severity: "P0", why: "шаг регистрации, входа или оплаты не прошёл — тест упал на действии" };
    if (!failed.length) {
      // seen, nothing failed: a console line or a hydration error on /auth/*, /pricing … — P2
      return { severity: "P2", why: `ошибка видна (${kind === "console-error" ? "консоль" : kind === "page-error" ? "страница" : kind}), но ни один тест из-за неё не упал` };
    }
    if (failed.some((s) => s.suite === "smoke")) return { severity: "P1", why: "a smoke check fails" };
    if ((kind === "api-error" || kind === "page-error") && routes.some((r) => KEY_PAGES.test(r) || SIGNIN.test(r))) return { severity: "P1", why: "a key page breaks" };
    if (failed.some((s) => s.suite === "billing" || s.suite === "signup")) return { severity: "P1", why: "a sign-up or billing check fails" };
    if (failed.length >= 5) return { severity: "P1", why: "one cause fails five or more tests" };
    return { severity: "P2", why: "a function works with a defect" };
  }
  switch (kind) {
    case "environment": return { severity: "P3", why: "не дефект продукта: сервер под тестом пропадал или браузер теста не смог сделать снимок — перепрогнать" };
    case "coverage": return { severity: "P1", why: "QA потерял покрытие: то, что прошлый прогон проверял, этот не проверил" };
    case "forbidden": return { severity: "P2", why: "a test pressed a forbidden control — the guard stopped it; the test or the control's label needs a look" };
    case "access": {
      // a leak: ANY role gets "open" where the matrix says it must not (a worker on the financials,
      // a guest on the dashboard) — P1 (2026-10-17: before, only guest / homeowner / admin pages were)
      const leak = signals.some((s) => {
        const cells = (s.extra?.cells ?? {}) as Record<string, string>;
        const exp = (s.extra?.expected ?? {}) as Record<string, string>;
        // a refusal (login / forbidden / redirect) that became "open" — not a "not-found" that found its record
        return Object.entries(cells).some(([r, c]) => c === "open" && !!exp[r] && exp[r].split("|").every((e) => e === "login" || e === "forbidden" || e.startsWith("redirect:")));
      });
      return leak ? { severity: "P1", why: "утечка доступа: страница открывается роли, которой её видеть нельзя" } : { severity: "P2", why: "access differs from the matrix" };
    }
    case "broken-link": {
      const pages = new Set(signals.map((s) => s.route).filter(Boolean)).size;
      const min = qaConfig().severity?.sharedLinkPages ?? 5;
      return pages >= min ? { severity: "P1", why: `битая ссылка общего элемента (меню, шапка): видна на ${pages} страницах` } : { severity: "P2", why: "works with a defect" };
    }
    case "slow": {
      const key = (qaConfig().severity?.slowKeyRoutes ?? []).map((r) => new RegExp(r));
      return signals.some((s) => key.some((r) => r.test(s.route ?? ""))) ? { severity: "P2", why: "ключевая страница грузится дольше порога" } : { severity: "P3", why: "speed, accessibility or a warning" };
    }
    case "forms": return signals.some((s) => /ran in the page|broke/.test(s.message)) ? { severity: "P1", why: "a form breaks or runs typed HTML" } : signals.some((s) => /saved without/.test(s.message)) ? { severity: "P2", why: "a form saves invalid input" } : { severity: "P3", why: "a form shows no validation message" };
    case "unknown-access":
    case "layout":
    case "visual":
      return { severity: "P2", why: kind === "unknown-access" ? "pages nobody has decided the access for" : kind === "layout" ? "the page does not fit a 390 phone" : "works with a defect" };
    case "a11y":
    case "perf":
    default:
      return { severity: "P3", why: "speed, accessibility or a warning" };
  }
}

const KINDS_ALONE: SignalKind[] = ["api-error", "page-error", "network", "console-error", "layout", "broken-link", "a11y", "perf", "forms", "unknown-access"];

/** Groups signals into findings (without the words yet — words.ts writes them). */
export function group(raw: RawRun, signals: Signal[]): { finding: Omit<Finding, "human" | "title">; signals: Signal[] }[] {
  const failing = new Set(raw.tests.filter((t) => t.outcome === "failed").map((t) => t.id));
  const buckets = new Map<string, Signal[]>();
  const push = (sig: string, s: Signal) => { const b = buckets.get(sig) ?? []; b.push(s); buckets.set(sig, b); };
  for (const s of signals) {
    if (s.primary) push(signatureOf(s), s);
    else if (s.kind === "a11y" || s.kind === "perf") push(signatureOf(s), s); // independent of why a test failed
    else if (!failing.has(s.testId) && KINDS_ALONE.includes(s.kind)) push(signatureOf(s), s); // a defect a passing test did not assert
  }
  // a failing test that had no signal at all still counts
  for (const t of raw.tests.filter((x) => x.outcome === "failed")) {
    if (signals.some((s) => s.testId === t.id && s.primary)) continue;
    push(`assertion ${t.file} ${norm(t.title)}`, { kind: "assertion", testId: t.id, testTitle: t.title, suite: t.suite, project: t.project, file: t.file, route: null, role: null, message: t.title, rawRef: `tests[${raw.tests.indexOf(t)}]`, primary: true });
  }
  const out: { finding: Omit<Finding, "human" | "title">; signals: Signal[] }[] = [];
  for (const [sig, unsorted] of buckets) {
    // the signal that failed a test leads (its kind names the finding); the ones only seen follow
    const list = [...unsorted].sort((a, b) => Number(b.primary) - Number(a.primary));
    const kind = list[0].kind;
    const sev = severityOf(kind, list);
    const testIds = [...new Set(list.map((s) => s.testId))];
    const tests = testIds.map((id) => raw.tests.find((t) => t.id === id)!).filter(Boolean).map((t) => ({ id: t.id, title: t.title, project: t.project, file: t.file, outcome: t.outcome }));
    const also = new Set<string>();
    for (const id of testIds) for (const s of signals) if (s.testId === id && !s.primary && signatureOf(s) !== sig && HARD.concat(["console-error"]).includes(s.kind)) also.add(`${s.kind}: ${s.message.slice(0, 160)}`);
    // the same root seen elsewhere (the dev overlay's console lines, a page error): shown here, not a finding of its own
    if (sig.startsWith("root ")) {
      const seen = new Set<string>();
      for (const s of signals) {
        if (signatureOf(s) !== sig || list.includes(s)) continue;
        const line = `${s.kind === "console-error" ? "консоль" : s.kind}: ${norm(s.message).slice(0, 140)}`;
        if (!seen.has(line)) { seen.add(line); also.add(line); }
      }
    }
    const first = list.find((s) => s.primary) ?? list[0];
    out.push({
      finding: {
        id: findingId(sig),
        signature: sig,
        kind,
        severity: sev.severity,
        severityWhy: sev.why,
        evidence: { message: first.message, stack: first.stack, tests, routes: [...new Set(list.map((s) => s.route).filter(Boolean) as string[])], rawRefs: list.map((s) => s.rawRef).slice(0, 20), alsoSeen: [...also].slice(0, 8) },
        location: null,
      },
      signals: list,
    });
  }
  const order = { P0: 0, P1: 1, P2: 2, P3: 3 } as const;
  return out.sort((a, b) => order[a.finding.severity] - order[b.finding.severity] || b.finding.evidence.tests.length - a.finding.evidence.tests.length || a.finding.signature.localeCompare(b.finding.signature));
}
