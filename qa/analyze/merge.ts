// Findings that are one cause under several signatures, put together by rule (before the model,
// which may merge more): the report shows each cause once.
//   · coverageFindings — QA's own lost coverage (analyze/coverage.ts), one P1 per suite;
//   · sharedVisual    — the same strip changed on many pages (a header, the sidebar): one finding;
//   · mergeSameCause  — a 500's console line and the 500 itself, the 404 and the request that never
//                       answered on one page, a page's look and the P0/P1 that broke it, Lighthouse
//                       and the slow-page finding of the same page.
import type { RawRun } from "../lib/raw";
import { coverageLosses } from "./coverage";
import { findingId, severityOf } from "./group";
import type { Finding, Severity, Signal } from "./types";

type Bare = Omit<Finding, "human" | "title">;
const ORDER: Record<Severity, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

export function coverageFindings(raw: RawRun, runsDir: string): { finding: Bare; signals: Signal[] }[] {
  const losses = coverageLosses(raw, runsDir);
  const bySuite = new Map<string, typeof losses>();
  for (const l of losses) bySuite.set(l.suite, [...(bySuite.get(l.suite) ?? []), l]);
  const out: { finding: Bare; signals: Signal[] }[] = [];
  for (const [suite, list] of bySuite) {
    const signals: Signal[] = list.map((l) => ({
      kind: "coverage", testId: l.test.id, testTitle: l.test.title, suite, project: l.test.project, file: l.test.file,
      route: typeof l.test.meta?.route === "string" ? (l.test.meta.route as string) : null, role: null, primary: true,
      message: `${l.test.title.replace(/@\w+/g, "").trim()}: ${l.now} (в прогоне ${l.before.run}: ${l.before.forms ? `форма найдена, кнопка «${l.before.submit ?? "?"}»` : l.before.outcome})`,
      rawRef: `tests[${raw.tests.indexOf(l.test)}]`,
    }));
    const sig = `coverage ${suite}`;
    const sev = severityOf("coverage", signals);
    out.push({
      finding: {
        id: findingId(sig), signature: sig, kind: "coverage", severity: sev.severity, severityWhy: sev.why,
        evidence: {
          message: signals.slice(0, 6).map((s) => s.message).join("\n") + (signals.length > 6 ? `\n… и ещё ${signals.length - 6}` : ""),
          tests: list.map((l) => ({ id: l.test.id, title: l.test.title, project: l.test.project, file: l.test.file, outcome: l.test.outcome })),
          routes: [...new Set(signals.map((s) => s.route).filter(Boolean) as string[])],
          rawRefs: signals.map((s) => s.rawRef).slice(0, 20),
          alsoSeen: [],
        },
        location: null,
      },
      signals,
    });
  }
  return out;
}

function absorb(into: Finding, f: Finding, bySig: Map<string, Signal[]>, why: string) {
  into.evidence.tests.push(...f.evidence.tests.filter((t) => !into.evidence.tests.some((x) => x.id === t.id)));
  into.evidence.routes = [...new Set([...into.evidence.routes, ...f.evidence.routes])];
  into.evidence.alsoSeen = [...new Set([...into.evidence.alsoSeen, `(${why}) ${f.title}`])].slice(0, 12);
  into.evidence.rawRefs = [...into.evidence.rawRefs, ...f.evidence.rawRefs].slice(0, 30);
  bySig.set(into.id, [...(bySig.get(into.id) ?? []), ...(bySig.get(f.id) ?? [])]);
}

type Box = { x: number; y: number; w: number; h: number };
const near = (a: Box, b: Box, d = 16) => Math.abs(a.x - b.x) <= d && Math.abs(a.y - b.y) <= d && Math.abs(a.w - b.w) <= d && Math.abs(a.h - b.h) <= d;

/** Visual differences in the same place (±16 px) on 5+ pages of one screen size → one finding. */
export function sharedVisual(findings: Finding[], bySig: Map<string, Signal[]>, min = 5): Finding[] {
  const vis = findings.filter((f) => f.kind === "visual" && f.signature.startsWith("visual "));
  const boxOf = (f: Finding) => { const s = (bySig.get(f.id) ?? []).find((x) => x.extra?.box); return s ? { box: s.extra!.box as Box, vp: String(s.extra!.viewport ?? "") } : null; };
  const used = new Set<string>();
  const out = [...findings];
  for (const f of vis) {
    if (used.has(f.id)) continue;
    const a = boxOf(f);
    if (!a) continue;
    const members = vis.filter((g) => !used.has(g.id) && (() => { const b = boxOf(g); return !!b && b.vp === a.vp && near(a.box, b.box); })());
    if (members.length < min) continue;
    for (const m of members) used.add(m.id);
    const sig = `visual-shared ${a.vp} ${Math.round(a.box.y / 16) * 16}x${Math.round(a.box.x / 16) * 16}`;
    const signals = members.flatMap((m) => bySig.get(m.id) ?? []);
    const shared: Finding = {
      ...members[0],
      id: findingId(sig),
      signature: sig,
      severity: "P2",
      severityWhy: `один и тот же участок (x≈${a.box.x}, y≈${a.box.y}, ${a.box.w}×${a.box.h} px) изменился на ${members.length} страницах — общий элемент (шапка, меню), не шум`,
      title: `Один и тот же участок изменился на ${members.length} страницах (${a.vp} px, x≈${a.box.x} y≈${a.box.y}, ${a.box.w}×${a.box.h})`,
      human: { ...members[0].human, what: `На ${members.length} страницах изменилась одна и та же область экрана — скорее всего общий элемент: шапка, меню, кнопка в топбаре. Сравните «было / стало» любой из страниц ниже.` },
      evidence: {
        message: `visual difference in the same place on ${members.length} pages: ${members.map((m) => m.evidence.routes[0]).filter(Boolean).slice(0, 8).join(", ")}`,
        tests: members.flatMap((m) => m.evidence.tests),
        routes: [...new Set(members.flatMap((m) => m.evidence.routes))],
        rawRefs: members.flatMap((m) => m.evidence.rawRefs).slice(0, 30),
        alsoSeen: [],
      },
      location: null,
    };
    bySig.set(shared.id, signals);
    out.splice(out.indexOf(members[0]), 1, shared);
    for (const m of members.slice(1)) out.splice(out.indexOf(m), 1);
  }
  return out;
}

export function mergeSameCause(findings: Finding[], bySig: Map<string, Signal[]>): Finding[] {
  const gone = new Set<string>();
  const rolesOf = (f: Finding) => new Set((bySig.get(f.id) ?? []).map((s) => s.role).filter(Boolean) as string[]);
  const sameSet = (a: string[], b: string[]) => a.length > 0 && a.length === b.length && a.every((x) => b.includes(x));
  const within = (a: string[], b: string[]) => a.length > 0 && a.every((x) => b.includes(x));
  const live = () => findings.filter((f) => !gone.has(f.id));

  // 1. "Failed to load resource: … status of 5xx" with no root of its own → the 500 that role got
  //    (test by test: an admin's line goes to the admin's NoOrgError, a guest's to the guest's 500)
  for (const f of live()) {
    if (f.kind !== "console-error" || !/status of 5\d\d/.test(f.evidence.message)) continue;
    const sigs = bySig.get(f.id) ?? [];
    const servers = live().filter((x) => x !== f && (x.kind === "api-error" || x.signature.startsWith("root ")));
    const target = (role: string | null) => servers.filter((x) => !!role && rolesOf(x).has(role))
      .sort((a, b) => b.evidence.routes.filter((r) => f.evidence.routes.includes(r)).length - a.evidence.routes.filter((r) => f.evidence.routes.includes(r)).length || b.evidence.tests.length - a.evidence.tests.length)[0];
    const plan = f.evidence.tests.map((t) => { const s = sigs.find((x) => x.testId === t.id); return { t, s, into: target(s?.role ?? null) }; });
    if (!plan.length || plan.some((p) => !p.into)) continue;
    for (const p of plan) {
      const into = p.into!;
      if (!into.evidence.tests.some((x) => x.id === p.t.id)) into.evidence.tests.push(p.t);
      if (p.s?.route && !into.evidence.routes.includes(p.s.route)) into.evidence.routes.push(p.s.route);
      into.evidence.alsoSeen = [...new Set([...into.evidence.alsoSeen, "(та же причина) консоль: Failed to load resource — status of 5xx"])].slice(0, 12);
      bySig.set(into.id, [...(bySig.get(into.id) ?? []), ...sigs.filter((x) => x.testId === p.t.id)]);
    }
    gone.add(f.id);
  }
  // 2. console lines / requests on exactly the same page(s): one cause there (a 404 and the request
  //    that never answered; two lines of one sandboxed frame)
  const MINOR = ["console-error", "network", "broken-link"];
  for (const f of live()) {
    if (!MINOR.includes(f.kind)) continue;
    const into = live().find((x) => x !== f && (MINOR.includes(x.kind) || x.kind === "api-error" || x.kind === "page-error") && sameSet(f.evidence.routes, x.evidence.routes) && ORDER[x.severity] <= ORDER[f.severity] && f.evidence.routes.length <= 2);
    if (into) { absorb(into, f, bySig, "та же страница, та же причина"); gone.add(f.id); }
  }
  // 3. a page's look changed where a P0 / P1 broke it: that P0 / P1 is the finding
  for (const f of live()) {
    if (f.kind !== "visual") continue;
    const roles = [...rolesOf(f)];
    const into = live().find((x) => x !== f && x.kind !== "visual" && (x.severity === "P0" || x.severity === "P1") && within(f.evidence.routes, x.evidence.routes) && (rolesOf(x).size === 0 || roles.every((r) => rolesOf(x).has(r))));
    if (into) { absorb(into, f, bySig, "вид страницы изменился из-за этой причины"); gone.add(f.id); }
  }
  // 4. Lighthouse below the line on a page that is already "slow"
  for (const f of live()) {
    if (f.kind !== "perf") continue;
    const into = live().find((x) => x.kind === "slow" && within(f.evidence.routes, x.evidence.routes));
    if (into) { absorb(into, f, bySig, "та же медленная страница, Lighthouse"); gone.add(f.id); }
  }
  return findings.filter((f) => !gone.has(f.id));
}
