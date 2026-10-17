// The environment the billing scripts run the app's own modules in.
//
// --prod: the production database. The URL is read from
// C:\Users\ivana\Downloads\prod-db-url.txt into memory and the file is deleted
// at once (each run needs the file again); a Postgres Prisma client is
// generated into .cache/<script>/prisma-pg and `@prisma/client` resolves to it,
// so the shared node_modules client stays SQLite. The LIVE key from .env.local
// is required. Without --prod: a local SQLite database and the test key only.
//
// Call openEnvironment() BEFORE importing anything from src/lib — the client
// and the variables must be in place when lib/db loads.

import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import { spawnSync } from "node:child_process";

export const ROOT = path.resolve(__dirname, "../..");
const URL_FILE = "C:/Users/ivana/Downloads/prod-db-url.txt";

function openProductionDatabase(out: string): string {
  const raw = fs.readFileSync(URL_FILE, "utf8");
  fs.unlinkSync(URL_FILE);
  const url = raw.split(/\r?\n/).map((l) => l.trim()).find((l) => /^postgres(ql)?:\/\//i.test(l));
  if (!url) throw new Error("no postgres url in the file (file deleted)");
  const host = new URL(url).hostname;
  if (!/neon\.tech$/.test(host)) throw new Error(`not a Neon host: ${host}`);
  process.env.POSTGRES_URL = url;
  process.env.POSTGRES_URL_NON_POOLING = url;
  process.env.DATABASE_URL = url;

  // The app's schema with the production datasource (scripts/prisma-production-schema.js).
  const dir = path.join(out, "prisma-pg");
  fs.mkdirSync(dir, { recursive: true });
  const schema = fs
    .readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
    .replace(/datasource db \{[\s\S]*?\n\}/, `datasource db {\n  provider  = "postgresql"\n  url       = env("POSTGRES_URL")\n  directUrl = env("POSTGRES_URL_NON_POOLING")\n}`)
    .replace(/generator client \{[\s\S]*?\n\}/, `generator client {\n  provider = "prisma-client-js"\n  output   = "${path.join(dir, "client").replace(/\\/g, "/")}"\n}`);
  fs.writeFileSync(path.join(dir, "schema.prisma"), schema);
  const gen = spawnSync("npx", ["--no-install", "prisma", "generate", "--schema", path.join(dir, "schema.prisma")], { cwd: ROOT, encoding: "utf8", shell: process.platform === "win32" });
  if (gen.status !== 0) throw new Error(`prisma generate failed:\n${gen.stderr}`);
  const client = path.join(dir, "client", "index.js");
  const M = Module as unknown as { _resolveFilename: (req: string, ...rest: unknown[]) => string };
  const orig = M._resolveFilename;
  M._resolveFilename = function (req: string, ...rest: unknown[]) {
    if (req === "@prisma/client" || req === ".prisma/client" || req === ".prisma/client/default") return client;
    return orig.call(this, req, ...rest);
  };
  return host;
}

/**
 * Load .env.local/.env, silence mail and analytics, open the database.
 * Returns where the run points and whether the Stripe key is live.
 */
export function openEnvironment(opts: {
  prod: boolean;
  out: string;
  allowLiveWrites: boolean;
  /** False for a database-only run: --prod then needs no live key. */
  stripe?: boolean;
}): { where: string; live: boolean } {
  fs.mkdirSync(opts.out, { recursive: true });
  // Next's own loader: .env.local, then .env; a variable already set wins.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { loadEnvConfig } = require("@next/env") as typeof import("@next/env");
  loadEnvConfig(ROOT, true, { info: () => {}, error: console.error });
  process.env.EMAIL_DEV_OUTBOX = path.join(opts.out, "outbox");
  process.env.NEXT_PUBLIC_POSTHOG_KEY = "";
  delete process.env.STRIPE_MOCK_FILE;
  process.env.STRIPE_ALLOW_LIVE_WRITES = opts.allowLiveWrites ? "true" : "";

  // The key is checked BEFORE the production URL is read: the file is
  // deleted as it is read, and a refusal after that cost the owner a new one.
  const live = (process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_live_");
  if (opts.prod && !live && opts.stripe !== false) throw new Error("--prod needs the LIVE key (STRIPE_SECRET_KEY=sk_live_…)");
  if (!opts.prod && live) throw new Error("a live key against a local database — refusing; blank STRIPE_SECRET_KEY for the sandbox");
  let where: string;
  if (opts.prod) {
    where = `production (${openProductionDatabase(opts.out)})`;
  } else {
    const url = process.env.DATABASE_URL ?? "";
    if (!/^file:/.test(url)) throw new Error("without --prod only a local SQLite database is allowed");
    where = `local (${url.replace(/^file:/, "")})`;
  }
  return { where, live };
}
