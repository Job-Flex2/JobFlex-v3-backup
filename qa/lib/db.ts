// The project's Prisma client, for the checks that verify what a flow wrote (a new company,
// its trial, a subscription after a plan change) and for the QA Co records the matrix needs.
// Only ever a LOCAL development database: every source of DATABASE_URL is checked first (the
// same rule as qa/tests/_lib/_world.js) and values are never printed.
import fs from "node:fs";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { ROOT } from "./env";

function fromFile(name: string): string | null {
  try {
    const m = fs.readFileSync(path.join(ROOT, name), "utf8").match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]*)"?/m);
    return m ? m[1].trim() : null;
  } catch { return null; }
}

export function isLocalDatabase(url: string): boolean {
  if (/^file:/i.test(url)) return true;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch { return false; }
}

/** Throws unless the process, .env and .env.local all point at a local development database. */
export function assertLocalDatabase(): void {
  const seen: [string, string | null][] = [["the process environment", process.env.DATABASE_URL || null], [".env", fromFile(".env")], [".env.local", fromFile(".env.local")]];
  const found = seen.filter(([, u]) => u);
  if (!found.length) throw new Error("QA guard: no DATABASE_URL found — refusing to guess which database this is");
  for (const [where, url] of found) if (!isLocalDatabase(url!)) throw new Error(`QA guard: DATABASE_URL from ${where} is not a local development database`);
}

let client: PrismaClient | null = null;
export function prisma(): PrismaClient {
  assertLocalDatabase();
  if (!client) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaClient: P } = require(require.resolve("@prisma/client", { paths: [ROOT] })) as typeof import("@prisma/client");
    // .env.local is what the dev server reads; Prisma itself only loads .env.
    const url = fromFile(".env.local") || process.env.DATABASE_URL || fromFile(".env") || undefined;
    client = new P(url ? { datasources: { db: { url: absolutise(url) } } } : undefined);
  }
  return client;
}

/** `file:./dev.db` is relative to prisma/ for the app; this process may run elsewhere. */
function absolutise(url: string): string {
  const m = url.match(/^file:(\.{1,2}\/.*)$/);
  return m ? "file:" + path.join(ROOT, "prisma", m[1]).split(path.sep).join("/") : url;
}

export async function disconnect(): Promise<void> {
  if (client) await client.$disconnect().catch(() => {});
  client = null;
}

export const QA_ORG_SLUG = "qa-co";
