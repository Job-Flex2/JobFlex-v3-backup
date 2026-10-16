// npm run qa [-- --suite signup[,billing…]] [--project chromium|webkit] [--grep text] [--workers N]
//            [--update-matrix] [--list] [--headed]
// npm run qa:smoke  ≡  npm run qa -- --suite smoke
//
// Picks the server (QA_BASE_URL, else the first local dev port that answers as JobFlex), applies
// the production guard BEFORE Playwright starts, names the run folder qa/runs/<date-time>/ and
// runs Playwright with the QA Lab config. The analysis is separate: npm run qa:analyze.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { QA_DIR, ROOT, runDir, runId } from "../lib/env";
import { qaConfig } from "../lib/config";
import { assertSuiteAllowed, targetKind } from "../lib/target";
import { SUITES } from "../lib/raw";
import { MATRIX_FILE, writeMatrixFromObserved } from "../lib/matrix";

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const values = (name: string): string[] => {
  const out: string[] = [];
  argv.forEach((a, i) => {
    if (a === `--${name}` && argv[i + 1]) out.push(...argv[i + 1].split(","));
    else if (a.startsWith(`--${name}=`)) out.push(...a.slice(name.length + 3).split(","));
  });
  return out.map((s) => s.trim()).filter(Boolean);
};

async function answersAsJobFlex(url: string): Promise<boolean> {
  try {
    const r = await fetch(url + "/auth/login", { signal: AbortSignal.timeout(8000) });
    return r.ok && /jobflex/i.test(await r.text());
  } catch {
    return false;
  }
}

/** `next dev` serves its hot-reload client in every page; a production build does not. */
async function isDevServer(url: string): Promise<boolean> {
  try {
    const r = await fetch(url + "/auth/login", { signal: AbortSignal.timeout(60_000) });
    return /hmr-client|webpack-hmr|__nextDevClientId|react-refresh/.test(await r.text());
  } catch {
    return false;
  }
}

async function pickServer(): Promise<string | null> {
  if (process.env.QA_BASE_URL) return process.env.QA_BASE_URL.replace(/\/+$/, "");
  for (const port of qaConfig().devPorts) {
    const url = `http://localhost:${port}`;
    if (await answersAsJobFlex(url)) return url;
  }
  return null;
}

async function main(): Promise<number> {
  const suites = values("suite");
  for (const s of suites) if (!(SUITES as readonly string[]).includes(s)) {
    console.error(`unknown suite "${s}" — one of: ${SUITES.join(", ")}`);
    return 2;
  }
  const onlyLogic = (suites.length > 0 && suites.every((s) => s === "logic")) || flag("list");
  const base = (await pickServer()) ?? (onlyLogic ? `http://localhost:${qaConfig().devPorts[0]}` : null);
  if (!base) {
    console.error([
      "No JobFlex server found (QA_BASE_URL is not set and no local dev port answered as JobFlex).",
      "Start the dev server in another terminal, with the QA test mode on:",
      "    npm run dev                       (reads QA_TEST_MODE / QA_SECRET from .env.local)",
      "or point the run at a server:  QA_BASE_URL=http://localhost:3005 npm run qa",
    ].join("\n"));
    return 2;
  }
  process.env.QA_BASE_URL = base;

  // The production guard — refused here, and again in every test (lib/fixtures.ts).
  const kind = targetKind(base);
  let selected = suites.length ? suites : [...SUITES];
  if (kind !== "local") {
    if (suites.length) {
      try { for (const s of suites) assertSuiteAllowed(s, base); } catch (e) { console.error((e as Error).message); return 1; }
    } else {
      selected = selected.filter((s) => { try { assertSuiteAllowed(s, base); return true; } catch { return false; } });
      console.log(`Target is ${kind} (${new URL(base).host}): only ${selected.join(", ")} run there.`);
    }
  }

  process.env.QA_RUN_ID = process.env.QA_RUN_ID || runId();
  process.env.QA_RUN_DIR = runDir();
  process.env.QA_SUITES = suites.length || kind !== "local" ? selected.join(",") : "all";
  const extra = values("grep");
  const parts = [];
  if (suites.length || kind !== "local") parts.push(`(?:${selected.map((s) => `@${s}\\b`).join("|")})`);
  const grep = parts.length ? `^(?=.*${parts[0]})${extra.length ? `(?=.*(?:${extra.map((e) => e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")}))` : ""}` : extra.length ? extra.map((e) => e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") : "";
  if (grep) process.env.QA_GREP = grep;
  if (flag("update-matrix")) process.env.QA_UPDATE_MATRIX = "1";
  const workers = values("workers")[0];
  if (workers) process.env.QA_WORKERS = workers;
  fs.mkdirSync(process.env.QA_RUN_DIR, { recursive: true });

  // A `next dev` server: Lighthouse and the old dev ↔ prod compare (mobile-sweep) measure the dev
  // server itself there — they are skipped, and the report says so in one line.
  if (!process.env.QA_SERVER_KIND) process.env.QA_SERVER_KIND = (await isDevServer(base)) ? "dev" : "prod";
  if (process.env.QA_SERVER_KIND === "dev" && (!suites.length || suites.includes("perf") || suites.includes("visual"))) {
    fs.writeFileSync(path.join(process.env.QA_RUN_DIR, "notes.json"), JSON.stringify([
      "Сервер — next dev: perf (Lighthouse) и mobile-sweep (сравнение dev ↔ prod) пропущены — на dev-сервере их цифры ничего не значат. Полный прогон на прод-сборке: npm run qa:build-run.",
    ]));
  }

  console.log(`QA Lab · run ${process.env.QA_RUN_ID} · ${base} (${kind}) · suites: ${process.env.QA_SUITES}`);
  const cli = require.resolve("@playwright/test/cli", { paths: [QA_DIR] });
  const args = [cli, "test", "-c", path.join(QA_DIR, "playwright.config.ts")];
  for (const p of values("project")) args.push("--project", p);
  if (flag("list")) args.push("--list");
  if (flag("headed")) args.push("--headed");
  const r = spawnSync(process.execPath, args, { cwd: ROOT, stdio: "inherit", env: process.env });
  if (process.env.QA_UPDATE_MATRIX === "1") {
    const n = writeMatrixFromObserved(process.env.QA_RUN_DIR);
    console.log(`access matrix: ${n} pages written to ${path.relative(ROOT, MATRIX_FILE)} — review the cells listed under \`review\``);
  }
  const raw = path.join(process.env.QA_RUN_DIR, "raw.json");
  if (fs.existsSync(raw)) console.log(`\nRun folder: ${path.relative(ROOT, process.env.QA_RUN_DIR)}  ·  next: npm run qa:analyze`);
  return r.status ?? 1;
}

main().then((code) => process.exit(code), (e) => { console.error(e); process.exit(1); });
