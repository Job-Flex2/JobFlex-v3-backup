// A PRODUCTION build of the app on localhost, for the checks that drive a browser over it
// (mobile-sweep.check.ts, signup-flow.check.ts). One dist dir — .cache/next-sweep — so another
// session's `next build` cannot swap the files under a run, and the two checks share one build.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";

export const ROOT = path.resolve(__dirname, "..", "..", "..");
export const DIST = ".cache/next-sweep";
const req = createRequire(__filename);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Playwright: here, in the root, on NODE_PATH, or in an npx cache — and made resolvable by
 *  name for ./_qa, which requires it itself. */
export function playwright() {
  let dir: string | null = null;
  for (const from of [__dirname, ROOT]) { try { dir = path.dirname(req.resolve("playwright/package.json", { paths: [from] })); break; } catch { /* next */ } }
  const cache = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "npm-cache", "_npx");
  if (!dir && fs.existsSync(cache)) for (const d of fs.readdirSync(cache)) { const p = path.join(cache, d, "node_modules", "playwright"); if (fs.existsSync(path.join(p, "package.json"))) { dir = p; break; } }
  if (!dir) throw new Error("playwright is not installed — `npm install` in scripts/qa (README)");
  process.env.NODE_PATH = [path.dirname(dir), process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
  req("module").Module._initPaths();
  return req(dir);
}

/** The newest source file, to know whether the build is current. */
function newest(dir: string): number {
  let t = 0;
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    t = Math.max(t, f.isDirectory() ? newest(p) : fs.statSync(p).mtimeMs);
  }
  return t;
}
/** The environment for next build / next start. Prisma, once imported, has loaded .env into
 *  this process — and .env's NEXTAUTH_SECRET is not .env.local's, so a server started with it
 *  rejects the session every other server on this machine accepts (the dev server answered the
 *  compare with its sign-in page). Next reads the env files itself, in its own order. */
export function serverEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  try {
    for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
      if (m) delete env[m[1]];
    }
  } catch { /* no .env */ }
  return env;
}
/** Builds DIST when src/ (or next.config.ts) is newer than it. `note` says which. */
export function ensureBuild(note: (name: string, extra?: string) => void) {
  const id = path.join(ROOT, DIST, "BUILD_ID");
  const src = Math.max(newest(path.join(ROOT, "src")), fs.statSync(path.join(ROOT, "next.config.ts")).mtimeMs);
  if (fs.existsSync(id) && fs.statSync(id).mtimeMs > src) return note("production build", `${DIST} is current`);
  note("production build", `${DIST} is older than src/ — building (next build, a few minutes)`);
  // `next build` adds its dist dir's types to tsconfig.json; that is not a change anyone made.
  const tsconfig = fs.readFileSync(path.join(ROOT, "tsconfig.json"));
  try {
    const r = spawnSync(process.execPath, ["node_modules/next/dist/bin/next", "build"], { cwd: ROOT, env: { ...serverEnv(), JOBFLEX_DIST_DIR: DIST }, encoding: "utf8", maxBuffer: 64 << 20 });
    if (r.status !== 0) throw new Error("next build failed:\n" + (r.stdout + r.stderr).split("\n").slice(-25).join("\n"));
  } finally { fs.writeFileSync(path.join(ROOT, "tsconfig.json"), tsconfig); }
}
export const listening = (port: number) => new Promise<boolean>((res) => { const s = net.connect(port, "127.0.0.1"); s.once("connect", () => { s.destroy(); res(true); }); s.once("error", () => res(false)); });
/** `next start` on DIST; `env` overrides the server's own (blank a key to keep it from a run). */
export async function startServer(port: number, env: NodeJS.ProcessEnv = {}, portVar = "a free port"): Promise<ChildProcess> {
  if (await listening(port)) throw new Error(`port ${port} is taken — set ${portVar}`);
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], { cwd: ROOT, env: { ...serverEnv(), JOBFLEX_DIST_DIR: DIST, AUTH_TRUST_HOST: "true", ...env }, stdio: "ignore" });
  for (let i = 0; i < 120; i++) { if (await listening(port)) { await sleep(800); return child; } await sleep(500); }
  throw new Error("next start did not come up");
}
export function stopServer(child: ChildProcess | null) {
  if (!child || child.pid === undefined) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else child.kill("SIGTERM");
}
