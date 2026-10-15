/* eslint-disable @typescript-eslint/no-require-imports -- a plain CommonJS node script, like the rest of _lib */
// Runs one of the old QA scripts (qa/config/legacy.yaml) the way scripts/qa/run-all.js always
// did, and reads its verdict. Shared by qa/tests/legacy.spec.ts (the QA Lab) and run-all.js.
//
// Every child gets the external senders blanked — Twilio, Resend, SMTP, Meta CAPI — so no script
// can text, mail or report a real person (crew-days could have texted through Twilio before).
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const QA = path.join(ROOT, "qa");
const SUITE_DIR = (suite) => (suite === "tools" ? path.join(QA, "tools", "legacy") : path.join(QA, "tests", suite));

function manifest() {
  const YAML = require(require.resolve("yaml", { paths: [QA] }));
  const doc = YAML.parse(fs.readFileSync(path.join(QA, "config", "legacy.yaml"), "utf8"));
  const minutes = doc.defaults?.minutes ?? 5;
  return doc.scripts.map((e) => ({ minutes, ...e, path: path.join(SUITE_DIR(e.suite), e.file) }));
}

/** The entries a run executes: live checks, node scripts, page passes and prod-build checks. */
function runnable() {
  return manifest().filter((e) => e.status === "live" && ["check", "node", "page", "prod"].includes(e.kind));
}

const BLANK = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER", "RESEND_API_KEY", "SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "META_CAPI_ACCESS_TOKEN"];

function childEnv(baseUrl) {
  const env = { ...process.env, MSYS_NO_PATHCONV: "1" };
  for (const k of BLANK) env[k] = ""; // an empty value wins over .env (Next and dotenv never override a set variable)
  if (baseUrl) {
    env.QA_BASE_URL = baseUrl;
    env.QA_DEV_URL = env.QA_DEV_URL || baseUrl; // mobile-sweep's dev ↔ prod compare
  }
  return env;
}

function exec(cmd, args, cwd, env, timeoutMs) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(cmd, args, { cwd, env, windowsHide: true });
    let out = "";
    const add = (b) => { out += b.toString(); if (out.length > 4_000_000) out = out.slice(-2_000_000); };
    child.stdout.on("data", add);
    child.stderr.on("data", add);
    const timer = setTimeout(() => { out += `\n[legacy runner] killed after ${Math.round(timeoutMs / 60000)} min`; child.kill(); }, timeoutMs);
    child.on("close", (code) => { clearTimeout(timer); resolve({ code: code ?? 1, out, ms: Date.now() - t0 }); });
    child.on("error", (e) => { clearTimeout(timer); resolve({ code: 1, out: out + "\n" + e.message, ms: Date.now() - t0 }); });
  });
}

const TSX = () => path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");

/** → { verdict: PASS | FAIL | STALE, code, out, ms, detail } */
async function runEntry(e, { baseUrl } = {}) {
  const env = childEnv(baseUrl);
  const timeoutMs = (e.minutes || 5) * 60_000;
  const seedPath = e.seed ? path.join(path.dirname(e.path), e.seed) : null;
  if (seedPath) await exec(process.execPath, [seedPath, "up"], ROOT, env, 120_000);
  let r;
  try {
    if (e.kind === "page") r = await exec(process.execPath, [e.path], path.dirname(e.path), env, timeoutMs);
    else if (e.kind === "node") r = await exec(process.execPath, [e.path], ROOT, env, timeoutMs);
    else r = await exec(process.execPath, [TSX(), "--tsconfig", "tsconfig.json", e.path], ROOT, env, timeoutMs);
  } finally {
    if (seedPath) await exec(process.execPath, [seedPath, "down"], ROOT, env, 120_000);
  }
  const lines = r.out.trim().split(/\r?\n/);
  if (e.kind === "page") {
    const pass = (r.out.match(/^PASS/gm) || []).length;
    const fail = (r.out.match(/^FAIL|HARNESS FAIL/gm) || []).length;
    const stale = r.out.match(/^STALE \| (.*)$/m);
    const verdict = stale ? "STALE" : fail === 0 && pass > 0 && r.code === 0 ? "PASS" : "FAIL";
    return { verdict, ...r, detail: stale ? stale[1] : `${pass} passed, ${fail} failed`, failures: lines.filter((l) => /^(FAIL|HARNESS FAIL)/.test(l)).slice(0, 20) };
  }
  const failures = lines.filter((l) => /^\s*(FAIL|✗|✘|not ok|AssertionError|Error:)/.test(l)).slice(0, 20);
  return { verdict: r.code === 0 ? "PASS" : "FAIL", ...r, detail: (lines[lines.length - 1] || "").slice(0, 120), failures };
}

/** Before anything runs: a local dev database, and qa@acme.test in QA Co with no seat anywhere people work. */
async function guard() {
  const r = await exec(process.execPath, [path.join(__dirname, "_world.js"), "guard"], ROOT, childEnv(), 120_000);
  return r.code === 0 ? null : (r.out.trim() || "QA guard failed");
}

module.exports = { manifest, runnable, runEntry, guard, childEnv, ROOT };
