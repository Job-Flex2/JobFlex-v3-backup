// npm run qa:build-run [-- <the same arguments as npm run qa>]
// A full run against a PRODUCTION build instead of `next dev` (which on Windows exits now and then
// under a long run, and whose speed means nothing for perf): next build into .cache/next-qa-build,
// next start on a free port (never 3000 / 3001 / 3005 / 3008 — other sessions' servers), wait for
// the sign-in page, npm run qa against it, stop the server. tsconfig.json is put back after the
// build (next adds its dist dir's types to it).
//
// The server it starts sends nothing out: live Stripe, Resend / SMTP mail, Twilio and Meta's
// Conversions API keys are blanked for it (a production build ignores EMAIL_DEV_OUTBOX). The
// Stripe TEST key and dev.db's stripe:mode=test stay, so the signup and billing suites run.
// If `next build` fails — say, on someone's unfinished edits in src/ — it stops and says so.
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { ROOT, RUNS_DIR, stamp } from "../lib/env";

const DIST = ".cache/next-qa-build";
const AVOID = new Set([3000, 3001, 3005, 3008]);
const BLANK = ["STRIPE_SECRET_KEY", "RESEND_API_KEY", "SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER", "TWILIO_VERIFY_SERVICE_SID", "META_CAPI_ACCESS_TOKEN"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const listening = (port: number) => new Promise<boolean>((res) => { const s = net.connect(port, "127.0.0.1"); s.once("connect", () => { s.destroy(); res(true); }); s.once("error", () => res(false)); });

async function freePort(): Promise<number> {
  for (let p = 3420; p < 3500; p++) if (!AVOID.has(p) && !(await listening(p))) return p;
  throw new Error("no free port between 3420 and 3499");
}

/** The env for next build / start: .env's values left for Next to read in its own order. */
function serverEnv(extra: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...process.env };
  try {
    for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
      if (m && !m[1].startsWith("QA_")) delete env[m[1]];
    }
  } catch { /* no .env */ }
  return { ...env, JOBFLEX_DIST_DIR: DIST, ...extra };
}

function stop(child: ChildProcess | null) {
  if (!child?.pid) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else child.kill("SIGTERM");
}

async function main(): Promise<number> {
  const next = path.join("node_modules", "next", "dist", "bin", "next");
  // 1. build
  console.log(`qa:build-run · next build → ${DIST} (a few minutes)`);
  const tsconfig = fs.readFileSync(path.join(ROOT, "tsconfig.json"));
  let built;
  try {
    built = spawnSync(process.execPath, ["--max-old-space-size=8192", next, "build"], { cwd: ROOT, env: serverEnv({ NODE_ENV: "production" }), encoding: "utf8", maxBuffer: 256 << 20 });
  } finally {
    fs.writeFileSync(path.join(ROOT, "tsconfig.json"), tsconfig);
  }
  if (built.status !== 0) {
    const tail = `${built.stdout ?? ""}${built.stderr ?? ""}`.trim().split(/\r?\n/).slice(-30).join("\n");
    console.error(`\nnext build FAILED — nothing was run, and nothing in src/ was changed.\nIf the errors are in files someone is editing right now, wait for their commit and run again.\n\n${tail}`);
    return 3;
  }
  // 2. start — the server's output goes straight to a file. (Piped into this process it hung the
  // server: while the run blocked this process, the pipe filled and next start's writes stopped it.)
  const port = await freePort();
  const url = `http://localhost:${port}`;
  if (!process.env.QA_RUN_ID) process.env.QA_RUN_ID = stamp(new Date());
  const runDir = path.join(RUNS_DIR, process.env.QA_RUN_ID);
  fs.mkdirSync(runDir, { recursive: true });
  const logFile = path.join(runDir, "server.log");
  const blanks = Object.fromEntries(BLANK.map((k) => [k, ""]));
  const startServer = () => {
    const fd = fs.openSync(logFile, "a");
    const child = spawn(process.execPath, ["--max-old-space-size=8192", next, "start", "-p", String(port)], {
      cwd: ROOT,
      env: serverEnv({ ...blanks, NODE_ENV: "production", AUTH_TRUST_HOST: "true", NEXTAUTH_URL: url, AUTH_URL: url }),
      stdio: ["ignore", fd, fd],
    });
    fs.closeSync(fd);
    return child;
  };
  const answers = async (ms: number) => {
    try {
      const r = await fetch(`${url}/auth/login`, { signal: AbortSignal.timeout(ms) });
      return r.ok && /jobflex/i.test(await r.text());
    } catch { return false; }
  };
  let server: ChildProcess | null = startServer();
  let watchdog: NodeJS.Timeout | null = null;
  try {
    let up = false;
    for (let i = 0; i < 90 && !up; i++) { await sleep(2000); up = await answers(10_000); }
    if (!up) {
      console.error(`next start on :${port} did not answer within 3 minutes — see ${path.relative(ROOT, logFile)}`);
      return 4;
    }
    console.log(`qa:build-run · production build up on ${url} — running npm run qa ${process.argv.slice(2).join(" ")}`);
    // A server that stops answering for a minute is restarted on the same port, and the run's
    // report says so (notes.json) — its tests in that minute fail as "the server went away".
    let misses = 0;
    let busy = false;
    watchdog = setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        if (await answers(20_000)) { misses = 0; return; }
        if (++misses < 3) return;
        misses = 0;
        const at = new Date().toISOString().slice(11, 19);
        console.error(`qa:build-run · the server on :${port} stopped answering — restarting it (${at})`);
        stop(server);
        await sleep(2000);
        server = startServer();
        addNote(runDir, `Прод-сервер на :${port} перестал отвечать и был перезапущен в ${at} UTC (журнал — server.log); тесты той минуты — «сервер пропадал».`);
      } finally { busy = false; }
    }, 20_000);
    // 3. the run — asynchronous, so the watchdog keeps running
    const tsx = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
    const code = await new Promise<number>((resolve) => {
      const run = spawn(process.execPath, [tsx, path.join("qa", "bin", "qa.ts"), ...process.argv.slice(2)], {
        cwd: ROOT,
        stdio: "inherit",
        env: { ...process.env, QA_BASE_URL: url, QA_SERVER_KIND: "prod" },
      });
      run.on("close", (c) => resolve(c ?? 1));
      run.on("error", () => resolve(1));
    });
    return code;
  } finally {
    // 4. down
    if (watchdog) clearInterval(watchdog);
    stop(server);
    console.log(`qa:build-run · server on :${port} stopped (its log: ${path.relative(ROOT, logFile)})`);
  }
}

/** One more line for the run's notes.json (the reporter reads it when the run ends). */
function addNote(runDir: string, line: string) {
  const file = path.join(runDir, "notes.json");
  let notes: string[] = [];
  try { notes = JSON.parse(fs.readFileSync(file, "utf8")); } catch { /* none yet */ }
  notes.push(line);
  fs.writeFileSync(file, JSON.stringify(notes));
}

main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(1); });
