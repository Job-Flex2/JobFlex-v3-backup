// The whole QA set, one verdict line each:   node scripts/qa/run-all.js [--checks | --pages]
//  · checks — every *.check.ts (plus the three older data-level harnesses): no browser, no
//    network; the few that write to the dev database do it in throwaway organisations.
//    The two exceptions drive a browser over a production build on localhost (./_prod-server):
//    mobile-sweep.check.ts (a phone, WebKit), signup-flow.check.ts (landing → step 1 → 2 →
//    Stripe test Checkout for every industry) and sidebar-motion.check.ts (the desk sidebar's
//    plate and fold, frame by frame, WebKit and Chromium) — see their headers.
//  · pages  — the Playwright passes. They sign in as qa@acme.test, work ONLY in QA Co, make
//    the records they need there (./_world, seed-phone) and remove them. Needs the dev server
//    on localhost:$QA_PORT (default 3000; or QA_BASE_URL in full) and `playwright` resolvable
//    (npm i here, or NODE_PATH to a copy).
// Left out on purpose: *.live.ts and trade-detect-check.ts (real provider / OpenAI calls).
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const only = process.argv.includes("--checks") ? "checks" : process.argv.includes("--pages") ? "pages" : "all";

const CHECKS = fs.readdirSync(__dirname).filter((f) => f.endsWith(".check.ts")).sort()
  .concat(["fence-terrain-check.ts", "lead-reroute-test.ts", "pitch-audit.ts"]);
const GUARD_CHECK = "qa-guard.check.js"; // plain node: it drives this folder's own guard
const PAGES = [
  ["fin-test.js"], ["messages-test.js"], ["phone-test.js", "seed-phone.js"], ["reviews-test.js"], ["reviews-chips.js"],
  ["ref-test.js"], ["reports-test.js"], ["trade-test.js"], ["trade-tail.js"], ["fixpass-smoke.js"], ["fence-tiers-test.js"],
  ["ann-test.js"], ["sub-test.js"], ["fence-test.js"], ["roof-test.js", "seed-roof.js"],
];
const run = (cmd, args, cwd, timeout = 300000) => spawnSync(cmd, args, { cwd, encoding: "utf8", shell: process.platform === "win32", timeout, maxBuffer: 64 << 20 });
// The browser checks over a production build (rebuilt when src/ moved on): their own clock.
const SLOW = { "mobile-sweep.check.ts": 30 * 60_000, "signup-flow.check.ts": 20 * 60_000, "sidebar-motion.check.ts": 20 * 60_000 };
const rows = [];

// Before anything runs — a check, a seed, a browser: a local dev database, and qa@acme.test in
// QA Co with no seat anywhere people work (./_world assertSafe). Failing that, nothing runs.
{
  const guard = run("node", ["scripts/qa/_world.js", "guard"], ROOT);
  if (guard.status !== 0) {
    console.error(((guard.stderr || "") + (guard.stdout || "")).trim() || "QA guard failed");
    process.exit(1);
  }
}

if (only !== "pages") {
  for (const f of CHECKS) {
    const r = run("npx", ["--no-install", "tsx", "--tsconfig", "tsconfig.json", "scripts/qa/" + f], ROOT, SLOW[f]);
    rows.push({ kind: "check", name: f, verdict: r.status === 0 ? "PASS" : "FAIL", detail: (r.stdout || "").trim().split("\n").pop().slice(0, 70) });
    console.log(`${rows.at(-1).verdict}  ${f}  · ${rows.at(-1).detail}`);
  }
}
if (only !== "pages") {
  const r = run("node", ["scripts/qa/" + GUARD_CHECK], ROOT);
  rows.push({ kind: "check", name: GUARD_CHECK, verdict: r.status === 0 ? "PASS" : "FAIL", detail: (r.stdout || "").trim().split("\n").pop().slice(0, 70) });
  console.log(`${rows.at(-1).verdict}  ${GUARD_CHECK}  · ${rows.at(-1).detail}`);
}
if (only !== "checks") {
  for (const [f, seed] of PAGES) {
    if (seed) run("node", ["scripts/qa/" + seed, "up"], ROOT);
    const r = run("node", [f], __dirname);
    if (seed) run("node", ["scripts/qa/" + seed, "down"], ROOT);
    const out = (r.stdout || "") + (r.stderr || "");
    const pass = (out.match(/^PASS/gm) || []).length;
    const fail = (out.match(/^FAIL|HARNESS FAIL/gm) || []).length;
    const stale = /^STALE \|/m.test(out);
    const verdict = stale ? "STALE" : fail === 0 && pass > 0 && r.status === 0 ? "PASS" : "FAIL";
    rows.push({ kind: "page", name: f, verdict, detail: stale ? out.match(/^STALE \| (.*)$/m)[1].slice(0, 90) : `${pass} passed, ${fail} failed` });
    console.log(`${verdict}  ${f}  · ${rows.at(-1).detail}`);
  }
}
const count = (v) => rows.filter((r) => r.verdict === v).length;
console.log(`\n== ${count("PASS")} passed, ${count("FAIL")} failed, ${count("STALE")} stale — of ${rows.length}`);
process.exit(count("FAIL") ? 1 : 0);
