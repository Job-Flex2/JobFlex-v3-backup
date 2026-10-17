// npm run qa:selftest [-- --with-model]
// The analyser against its three prepared runs (qa/analyze/fixtures): all green; the sign-up
// broken at the code step; one API error that brings down twelve tests. Checks the findings,
// their grouping (how many tests each holds) and their severity, and that the reports are
// written and carry no secret. Offline by default — the rules must hold on their own; with
// --with-model the model's words are used too (and cost a little).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { analyzeRun } from "../analyze";
import { rootOf, serverDigests } from "../analyze/roots";

type Expected = { failedTests: number; findings: { kind: string; severity: string; tests: number; signature: string; location?: string }[] };
const FIX = path.join(__dirname, "..", "analyze", "fixtures");
const withModel = process.argv.includes("--with-model");

(async () => {
  let bad = 0;
  const check = (name: string, ok: boolean, extra = "") => { if (!ok) bad++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };
  const runs = fs.mkdtempSync(path.join(os.tmpdir(), "qa-selftest-"));
  for (const name of ["green", "signup-code", "api-cascade", "rules"]) {
    const exp = JSON.parse(fs.readFileSync(path.join(FIX, name, "expected.json"), "utf8")) as Expected;
    const raw = JSON.parse(fs.readFileSync(path.join(FIX, name, "raw.json"), "utf8"));
    const dir = path.join(runs, raw.run.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(path.join(FIX, name, "raw.json"), path.join(dir, "raw.json"));
    const a = await analyzeRun(dir, { offline: !withModel, runsDir: path.join(runs, "_none"), known: [] });
    check(`${name}: failed tests counted`, a.summary.tests.failed === exp.failedTests, `${a.summary.tests.failed} vs ${exp.failedTests}`);
    check(`${name}: ${exp.findings.length} finding(s)`, a.findings.length === exp.findings.length, a.findings.map((f) => `${f.severity} ${f.signature} (${f.evidence.tests.length})`).join(" | ") || "none");
    for (const e of exp.findings) {
      const f = a.findings.find((x) => x.kind === e.kind && x.signature.startsWith(e.signature));
      check(`${name}: "${e.signature}" is one finding`, !!f, f ? "" : "missing");
      if (!f) continue;
      check(`${name}: "${e.signature}" groups ${e.tests} test(s)`, f.evidence.tests.length === e.tests, String(f.evidence.tests.length));
      check(`${name}: "${e.signature}" is ${e.severity}`, f.severity === e.severity, `${f.severity} — ${f.severityWhy}`);
      check(`${name}: "${e.signature}" has the human part and the evidence`, !!f.human.what && f.human.steps.length > 0 && !!f.evidence.message && f.evidence.rawRefs.length > 0);
      if (f.severity !== "P3") check(`${name}: "${e.signature}" has a fix prompt`, !!f.fixPrompt && f.fixPrompt.includes(f.id));
      if (e.location) check(`${name}: "${e.signature}" is placed in ${e.location} by the names in its stack (no model)`, f.location?.file === e.location && !!f.fixPrompt?.includes(e.location), `${f.location?.file}:${f.location?.line} — ${f.location?.why}`);
    }
    for (const file of ["analysis.json", "report.md", "report.html"]) check(`${name}: ${file} written`, fs.existsSync(path.join(dir, file)));
    const html = fs.readFileSync(path.join(dir, "report.html"), "utf8");
    check(`${name}: report.html has the summary, the matrix and the visual sections`, ["Сводка", "Роль × страница", "Визуальные диффы", "Скорость по страницам"].every((s) => html.includes(s)));
    check(`${name}: no secret in the reports`, !/cs_(live|test)_[A-Za-z0-9]{8,}|sk_(live|test)_[A-Za-z0-9]{8,}|sk-ant-[A-Za-z0-9]/.test(html + fs.readFileSync(path.join(dir, "report.md"), "utf8")));
    if (name === "rules") {
      check("rules: no P0 — nothing failed on a sign-up, sign-in or payment action", a.summary.findings.P0 === 0, JSON.stringify(a.summary.findings));
      check("rules: the expected 404 of the smoke check is no finding (status or console)", !a.findings.some((x) => /404|Not Found/.test(x.evidence.message)));
      check("rules: NoOrgError's console lines are \"also seen\", not findings of their own", !a.findings.some((x) => x.kind === "console-error") && (a.findings.find((x) => x.signature.startsWith("root NoOrgError"))?.evidence.alsoSeen.length ?? 0) > 0);
    }
    if (name === "api-cascade") {
      const f = a.findings.find((x) => x.kind === "api-error");
      check("api-cascade: the console error of the same 500 is not a finding of its own", !a.findings.some((x) => x.kind === "console-error"));
      check("api-cascade: the finding names all twelve pages", (f?.evidence.routes.length ?? 0) === 12, String(f?.evidence.routes.length));
    }
  }
  // the comparison with an earlier run: analyse api-cascade twice in one history
  {
    const hist = path.join(runs, "history");
    const raw = JSON.parse(fs.readFileSync(path.join(FIX, "api-cascade", "raw.json"), "utf8"));
    for (const id of ["2026-10-14T20-20-00", "2026-10-14T21-20-00", "2026-10-14T22-20-00"]) {
      const dir = path.join(hist, id);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "raw.json"), JSON.stringify({ ...raw, run: { ...raw.run, id } }));
      const a = await analyzeRun(dir, { offline: true, runsDir: hist, known: [] });
      const f = a.findings.find((x) => x.kind === "api-error")!;
      if (id.startsWith("2026-10-14T20")) check("history: first run — the finding is new", f.history?.status === "new");
      if (id.startsWith("2026-10-14T21")) check("history: second run — it is still there, not stale", f.history?.status === "still" && !f.history.stale && a.summary.diff.still >= 1);
      if (id.startsWith("2026-10-14T22")) check("history: third run in a row — marked stale", !!f.history?.stale, JSON.stringify(f.history));
    }
    // known-issues.yaml hides a confirmed false positive and counts it
    const dir = path.join(hist, "2026-10-14T23-20-00");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "raw.json"), JSON.stringify({ ...raw, run: { ...raw.run, id: "2026-10-14T23-20-00" } }));
    const a = await analyzeRun(dir, { offline: true, runsDir: hist, known: [{ id: "contrast-ok", signature: "a11y color-contrast", why: "selftest" }] });
    check("known issues: the matching finding is hidden and counted", a.summary.known === 1 && !a.findings.some((x) => x.kind === "a11y"));
  }
  // a production build: the browser sees only a digest; next start's log names the error, and the
  // root's function comes from the throw site in src/ (the log's stack is minified)
  {
    const log = "⨯ Error [NoOrgError]: No active organization\n    at p (C:\\x\\.cache\\next-qa-build\\server\\chunks\\ssr\\a.js:1:5948) {\n  digest: '575467423'\n}\n";
    const digests = serverDigests(log);
    check("prod: the server log's digest maps to its error", digests.get("575467423")?.name === "NoOrgError", JSON.stringify([...digests]));
    const root = rootOf(['0:{"a":"$@1"}\n1:E{"digest":"575467423"}'], digests);
    check("prod: a digest-only answer has the dev run's root (NoOrgError @ resolveOrg)", root === "NoOrgError @ resolveOrg", String(root));
    check("prod: the route-error console line with the digest has the same root", rootOf(["[route-error] 575467423 Error: Minified React error #441"], digests) === root);
  }
  fs.rmSync(runs, { recursive: true, force: true });
  console.log(bad ? `\n${bad} check(s) failed` : "\nselftest: all checks passed");
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
