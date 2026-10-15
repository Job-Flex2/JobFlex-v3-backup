// Where things are, and the few environment values the QA Lab reads.
//
// The app's own secrets stay with the app: only QA_* names, ANTHROPIC_API_KEY and VERCEL_ENV
// are taken from .env.local / .env (the process environment wins, then .env.local, then .env —
// Next's order). Values are never printed; lib/redact masks the ones that are secrets.
import fs from "node:fs";
import path from "node:path";

export const QA_DIR = path.resolve(__dirname, "..");
export const ROOT = path.resolve(QA_DIR, "..");
export const RUNS_DIR = path.join(QA_DIR, "runs");
export const CONFIG_DIR = path.join(QA_DIR, "config");
export const AUTH_DIR = path.join(QA_DIR, "auth");
export const BASELINES_DIR = path.join(QA_DIR, "baselines");

const WANTED = /^(QA_[A-Z0-9_]+|ANTHROPIC_API_KEY|VERCEL_ENV)$/;

function parseEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  let text = "";
  try { text = fs.readFileSync(file, "utf8"); } catch { return out; }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, "");
    out[m[1]] = v;
  }
  return out;
}

let loaded = false;
/** QA_* / ANTHROPIC_API_KEY / VERCEL_ENV from the env files, without overriding the process. */
export function loadQaEnv(): void {
  if (loaded) return;
  loaded = true;
  for (const name of [".env.local", ".env"]) {
    const vars = parseEnvFile(path.join(ROOT, name));
    for (const [k, v] of Object.entries(vars)) {
      if (WANTED.test(k) && process.env[k] === undefined && v !== "") process.env[k] = v;
    }
  }
}
loadQaEnv();

/** The server under test. The CLI resolves it once (bin/qa.ts) and hands it down as QA_BASE_URL. */
export function baseUrl(): string {
  const raw = process.env.QA_BASE_URL || `http://localhost:${process.env.QA_PORT || 3005}`;
  return raw.replace(/\/+$/, "");
}

/** The run folder: QA_RUN_DIR from the CLI, or a fresh one for a bare `npx playwright test`. */
export function runId(): string {
  if (!process.env.QA_RUN_ID) process.env.QA_RUN_ID = stamp(new Date());
  return process.env.QA_RUN_ID;
}
export function runDir(): string {
  if (!process.env.QA_RUN_DIR) process.env.QA_RUN_DIR = path.join(RUNS_DIR, runId());
  return process.env.QA_RUN_DIR;
}

/** 2026-10-14T21-05-09 — sortable, safe in a Windows path. */
export function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

/** The newest finished run (it has raw.json), or null. */
export function latestRunDir(): string | null {
  if (!fs.existsSync(RUNS_DIR)) return null;
  const dirs = fs.readdirSync(RUNS_DIR).filter((d) => fs.existsSync(path.join(RUNS_DIR, d, "raw.json"))).sort();
  return dirs.length ? path.join(RUNS_DIR, dirs[dirs.length - 1]) : null;
}
