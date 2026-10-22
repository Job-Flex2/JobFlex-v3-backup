// One-time, IDEMPOTENT backfill: the starter follow-up rules
// (src/lib/followUps/defaults.ts) for every company that has no rules at all.
//
//   npx tsx --tsconfig tsconfig.json scripts/backfill-follow-up-defaults.ts            # dry run, local dev.db
//   npx tsx --tsconfig tsconfig.json scripts/backfill-follow-up-defaults.ts --write    # write, local dev.db
//   … --prod [--write]   the production database (scripts/billing/_prod: the URL from prod-db-url.txt)
//   … --disabled         write the four rules switched OFF (enabled = false) — how existing companies get them
//                        (owner, 2026-10-22); a new company's rules are written on, at signup
//
// Dry run by default: how many companies have no rules, how many rows would be
// written. Writes go through ensureDefaultFollowUpRules — the function signup
// and /dashboard/follow-ups call — so a second run writes nothing. Companies
// with rules of their own are left alone (counted, not touched), and QA
// companies (lib/qaTestMode qaOrgIds) and deleted ones (deletedAt set) are
// skipped.
//
// ⚠️ Run --write only AFTER the FollowUpRule.isDefault/defaultKey columns exist
// on the target database (prisma/sql/prod-2026-10-21-follow-up-defaults.sql).

import path from "node:path";
import Module from "node:module";
import { ROOT, openEnvironment } from "./billing/_prod";

{
  const M = Module as unknown as { _resolveFilename: (req: string, ...rest: unknown[]) => string };
  const orig = M._resolveFilename;
  const noop = path.join(ROOT, "node_modules/next/dist/compiled/server-only/empty.js");
  M._resolveFilename = function (req: string, ...rest: unknown[]) {
    if (req === "server-only") return noop;
    return orig.call(this, req, ...rest);
  };
}

const argv = process.argv.slice(2);
const PROD = argv.includes("--prod");
const WRITE = argv.includes("--write");
const DISABLED = argv.includes("--disabled");

async function main() {
  // A database-only run: no Stripe key is needed, and a live one must not
  // trip the "live key against a local database" refusal.
  process.env.STRIPE_SECRET_KEY = "";
  const { where } = openEnvironment({ prod: PROD, out: path.join(ROOT, ".cache/backfill-follow-up-defaults"), allowLiveWrites: false, stripe: false });

  const { db } = await import("../src/lib/db");
  const { qaOrgIds } = await import("../src/lib/qaTestMode");
  const { DEFAULT_RULES, ensureDefaultFollowUpRules } = await import("../src/lib/followUps/defaults");

  const qa = new Set(await qaOrgIds());
  const orgs = await db.organization.findMany({ select: { id: true, name: true, deletedAt: true, _count: { select: { followUpRules: true } } } });

  const deleted = orgs.filter((o) => o.deletedAt !== null);
  const live = orgs.filter((o) => o.deletedAt === null);
  const skippedQa = live.filter((o) => qa.has(o.id));
  const own = live.filter((o) => !qa.has(o.id) && o._count.followUpRules > 0);
  const none = live.filter((o) => !qa.has(o.id) && o._count.followUpRules === 0);

  console.log(`[backfill-follow-up-defaults] ${where} — ${WRITE ? "WRITE" : "dry run"}, rules ${DISABLED ? "OFF (enabled = false)" : "ON"}`);
  console.log(`  companies:                ${orgs.length}`);
  console.log(`  deleted, skipped:         ${deleted.length}`);
  console.log(`  QA, skipped:              ${skippedQa.length}`);
  console.log(`  with rules, left alone:   ${own.length}`);
  console.log(`  with no rules:            ${none.length}`);
  console.log(`  rows to write:            ${none.length * DEFAULT_RULES.length} (${DEFAULT_RULES.length} each: ${DEFAULT_RULES.map((d) => d.name).join(", ")})`);

  if (!WRITE) {
    console.log("  nothing written — pass --write to write.");
    return;
  }

  let written = 0;
  for (const o of none) {
    const { created } = await ensureDefaultFollowUpRules(o.id, { enabled: !DISABLED });
    written += created;
  }
  console.log(`  written:                  ${written} row(s) on ${none.length} compan${none.length === 1 ? "y" : "ies"}.`);
}

main()
  .catch((err) => {
    console.error("[backfill-follow-up-defaults] failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    const { db } = await import("../src/lib/db");
    await db.$disconnect();
  });
