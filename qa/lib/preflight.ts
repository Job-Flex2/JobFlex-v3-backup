// BEFORE A RUN: the things without which a run silently tests nothing.
//
// The Prisma client. The old checks (qa/tests/<suite>/*.check.ts, run by legacy.spec) and the QA
// guard (_world.js guard) build `new PrismaClient()` in a child process that has no DATABASE_URL
// of its own — the client finds it through the .env path written into it by `prisma generate`.
// A client generated before .env existed (a fresh clone: `npm ci` first, `.env` copied after) has
// no such path: every old check was skipped by the guard, 175 tests, and the report said nothing
// (2026-10-16 evaluation). So: ask the client exactly the way those children do; if it cannot
// answer, generate once and ask again; still not → stop the run, loudly, with the reason.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT } from "./env";

export class PreflightError extends Error {}

const PROBE = `
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
p.organization.count({ where: { slug: "qa-co" } })
  .then((n) => { console.log("QA_PRISMA_OK " + n); return p.$disconnect(); })
  .catch((e) => { console.error(String(e && e.message || e).replace(/\\s+/g, " ").slice(0, 600)); process.exit(1); });
`;

/** The client as the old checks see it: from the project root, with no DATABASE_URL in the environment. */
function probe(): { ok: boolean; qaCo: boolean; why: string } {
  const env = { ...process.env };
  delete env.DATABASE_URL;
  const r = spawnSync(process.execPath, ["-e", PROBE], { cwd: ROOT, env, encoding: "utf8", timeout: 60_000 });
  const out = `${r.stdout ?? ""}`;
  const m = out.match(/QA_PRISMA_OK (\d+)/);
  if (r.status === 0 && m) return { ok: true, qaCo: Number(m[1]) > 0, why: "" };
  return { ok: false, qaCo: false, why: (r.stderr || out || r.error?.message || `exit ${r.status}`).trim().split(/\r?\n/).filter(Boolean).slice(-3).join(" ").slice(0, 600) };
}

function generate(): { ok: boolean; out: string } {
  const cli = path.join(ROOT, "node_modules", "prisma", "build", "index.js");
  if (!fs.existsSync(cli)) return { ok: false, out: "node_modules/prisma is missing — run npm install" };
  const r = spawnSync(process.execPath, [cli, "generate"], { cwd: ROOT, env: process.env, encoding: "utf8", timeout: 300_000 });
  return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim().split(/\r?\n/).slice(-6).join("\n") };
}

/**
 * Throws PreflightError (the run must not start) when the Prisma client cannot read the local
 * database the way the old checks do, even after one `prisma generate`. Returns what it did.
 */
export function prismaPreflight(log: (s: string) => void = console.log): string {
  if (!fs.existsSync(path.join(ROOT, ".env"))) {
    throw new PreflightError([
      "QA preflight FAILED: there is no .env in the project root.",
      "The Prisma CLI and the old checks read DATABASE_URL from .env only (never .env.local).",
      "Copy the DATABASE_URL line of .env.local into .env (a local file:… database), then run `npx prisma generate`.",
    ].join("\n"));
  }
  const first = probe();
  if (first.ok) {
    if (!first.qaCo) throw new PreflightError('QA preflight FAILED: the database has no organisation "QA Co" (slug qa-co) — run the seed (npm run prisma:seed, with approval) and npm run qa:seed-roles.');
    return "Prisma client: ok";
  }
  log(`QA preflight: the Prisma client cannot read the database as the old checks do (${first.why}) — running prisma generate`);
  const g = generate();
  const second = g.ok ? probe() : null;
  if (!second?.ok) {
    throw new PreflightError([
      "QA preflight FAILED: the Prisma client is not usable, and `prisma generate` did not fix it.",
      `  before generate: ${first.why}`,
      g.ok ? `  after generate:  ${second?.why}` : `  prisma generate failed:\n${g.out.split("\n").map((l) => "    " + l).join("\n")}`,
      "Nothing was run: without the client every old check (logic, billing, part of pages and roles) would be skipped.",
      "Fix: npm install && npx prisma generate (with .env present); on Windows stop the dev servers that hold the query engine first.",
    ].join("\n"));
  }
  if (!second.qaCo) throw new PreflightError('QA preflight FAILED: the database has no organisation "QA Co" (slug qa-co).');
  return "Prisma client: was not usable — regenerated (prisma generate), now ok";
}
