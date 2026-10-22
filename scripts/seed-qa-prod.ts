// THE QA ORGANISATION ON PRODUCTION (owner, 2026-10-22): QA Co and its people, for the QA Lab's runs —
// nothing else. Idempotent: upsert by slug / email, a second run only says "updated".
//
//   $env:QA_PASS_OWNER = "…"   # PowerShell; QA_PASS_MANAGER / QA_PASS_WORKER optional
//   npx tsx scripts/seed-qa-prod.ts
//
// What it writes, in ONE transaction:
//   · Organization "QA Co" (slug qa-co) — the Free plan: no Subscription row, no Stripe customer.
//   · qa@acme.test — OWNER of QA Co, password QA_PASS_OWNER (bcryptjs, cost 10, as the sign-up),
//     emailVerified now, active organisation QA Co.
//   · qa-manager@qa.jobflex.test (MANAGER) and qa-worker@qa.jobflex.test (INSTALLER), each only when
//     its QA_PASS_MANAGER / QA_PASS_WORKER is set; else skipped.
// No proposals, clients or any other record; no Stripe (live or test), no mail, no outside call.
//
// THE QA MARK (lib/qaOrg): an organisation is a QA one — left out of the statistics, PostHog and the
// API spend (ApiSpendDaily) — when its billing address or a member's address is @qa.jobflex.test.
// Locally QA Co carries it through its manager / worker seats (prisma/seed.ts billingEmail is
// qa@acme.test). Here those seats are optional, so the billing address is the QA one
// (qa-co@qa.jobflex.test): the mark holds with the owner alone. `.test` is a reserved domain — no
// mail can reach either address.
//
// Refuses: a database host that is not *.neon.tech; QA_PASS_OWNER missing (checked BEFORE the URL file
// is read — the file is deleted as it is read); qa-co owned by anyone but qa@acme.test, or holding a
// subscription; any of the three addresses seated in another organisation or a platform admin.
// The URL comes from C:\Users\ivana\Downloads\prod-db-url.txt, is deleted at once and never printed;
// passwords are never printed or stored. Output: one "created" / "updated" line per record.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import bcrypt from "bcryptjs";

const ROOT = path.resolve(__dirname, "..");
const URL_FILE = "C:/Users/ivana/Downloads/prod-db-url.txt";
const OUT = path.join(ROOT, ".cache", "seed-qa-prod");
const QA_DOMAIN = "@qa.jobflex.test";

const ORG = {
  slug: "qa-co",
  name: "QA Co",
  billingEmail: `qa-co${QA_DOMAIN}`,
  phone: "(555) 010-0199",
  address: "12618 NE 100th St, Kirkland, WA",
  defaultTaxRate: 0.06,
  primaryColor: "#111113",
};
const PEOPLE = [
  { email: "qa@acme.test", name: "QA Robot", role: "OWNER", pass: "QA_PASS_OWNER", required: true },
  { email: `qa-manager${QA_DOMAIN}`, name: "QA Manager", role: "MANAGER", pass: "QA_PASS_MANAGER", required: false },
  { email: `qa-worker${QA_DOMAIN}`, name: "QA Worker", role: "INSTALLER", pass: "QA_PASS_WORKER", required: false },
] as const;

function fail(why: string): never {
  console.log(`STOP: ${why}`);
  process.exit(2);
}

/** The production URL into memory; the file is deleted as it is read. */
function readUrl(): string {
  if (!fs.existsSync(URL_FILE)) fail("no URL file");
  const raw = fs.readFileSync(URL_FILE, "utf8");
  fs.unlinkSync(URL_FILE);
  console.log(`url file read and deleted: ${!fs.existsSync(URL_FILE)}`);
  const url = raw.split(/\r?\n/).map((l) => l.trim()).find((l) => /^postgres(ql)?:\/\//i.test(l));
  if (!url) fail("no postgres url in the file");
  if (!/\.neon\.tech$/i.test(new URL(url).hostname)) fail("not a Neon host (*.neon.tech)");
  console.log("host is Neon (*.neon.tech): true");
  return url;
}

/** The app's schema with a Postgres datasource, generated into .cache — node_modules stays SQLite. */
function postgresClient(): string {
  const dir = path.join(OUT, "prisma-pg");
  fs.mkdirSync(dir, { recursive: true });
  const schema = fs
    .readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
    .replace(/datasource db \{[\s\S]*?\n\}/, `datasource db {\n  provider = "postgresql"\n  url      = env("QA_SEED_PG_URL")\n}`)
    .replace(/generator client \{[\s\S]*?\n\}/, `generator client {\n  provider = "prisma-client-js"\n  output   = "${path.join(dir, "client").replace(/\\/g, "/")}"\n}`);
  fs.writeFileSync(path.join(dir, "schema.prisma"), schema);
  const gen = spawnSync("npx", ["--no-install", "prisma", "generate", "--schema", path.join(dir, "schema.prisma")], { cwd: ROOT, encoding: "utf8", shell: process.platform === "win32" });
  if (gen.status !== 0) fail(`prisma generate failed: ${(gen.stderr || "").split("\n").slice(-3).join(" ")}`);
  return path.join(dir, "client", "index.js");
}

type Db = {
  organization: { findUnique: (a: unknown) => Promise<{ id: string; memberships: { role: string; user: { email: string } }[]; subscription: { id: string } | null } | null>; upsert: (a: unknown) => Promise<{ id: string }>; findFirst: (a: unknown) => Promise<{ id: string; name: string; billingEmail: string | null; subscription: { id: string } | null; memberships: { role: string; user: { email: string; emailVerified: Date | null; hashedPassword: string | null } }[] } | null> };
  user: { findUnique: (a: unknown) => Promise<{ id: string; isPlatformAdmin: boolean; memberships: { organization: { slug: string } }[] } | null>; upsert: (a: unknown) => Promise<{ id: string }> };
  membership: { findUnique: (a: unknown) => Promise<{ id: string } | null>; upsert: (a: unknown) => Promise<{ id: string }> };
  $transaction: <T>(fn: (tx: Db) => Promise<T>) => Promise<T>;
  $disconnect: () => Promise<void>;
};

async function main() {
  // The owner's password first: the URL file is spent the moment it is read.
  if (!process.env.QA_PASS_OWNER) fail("QA_PASS_OWNER is not set in this terminal");
  const people = PEOPLE.filter((p) => p.required || process.env[p.pass]);
  for (const p of PEOPLE) if (!people.includes(p)) console.log(`${p.email}: skipped (${p.pass} not set)`);

  process.env.QA_SEED_PG_URL = readUrl();
  const clientPath = postgresClient();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrismaClient } = require(clientPath) as { PrismaClient: new () => Db };
  const db = new PrismaClient();
  try {
    // Read first: nothing is written unless every check holds.
    const org = await db.organization.findUnique({ where: { slug: ORG.slug }, select: { id: true, subscription: { select: { id: true } }, memberships: { select: { role: true, user: { select: { email: true } } } } } });
    if (org) {
      const strangers = org.memberships.filter((m) => !PEOPLE.some((p) => p.email === m.user.email));
      if (strangers.length) fail(`${ORG.slug} has members who are not the QA accounts (${strangers.length}) — not touched`);
      if (org.subscription) fail(`${ORG.slug} has a subscription row — not touched (the QA organisation stays on Free)`);
    }
    for (const p of people) {
      const u = await db.user.findUnique({ where: { email: p.email }, select: { id: true, isPlatformAdmin: true, memberships: { select: { organization: { select: { slug: true } } } } } });
      if (!u) continue;
      if (u.isPlatformAdmin) fail(`${p.email} is a platform admin — not touched`);
      const elsewhere = u.memberships.filter((m) => m.organization.slug !== ORG.slug);
      if (elsewhere.length) fail(`${p.email} has a seat in ${elsewhere.length} other organisation(s) — not touched`);
    }

    const hashes = new Map<string, string>();
    for (const p of people) hashes.set(p.email, await bcrypt.hash(process.env[p.pass]!, 10));
    const now = new Date();

    const lines = await db.$transaction(async (tx) => {
      const out: string[] = [];
      const o = await tx.organization.upsert({
        where: { slug: ORG.slug },
        create: { ...ORG },
        update: { name: ORG.name, billingEmail: ORG.billingEmail },
      });
      out.push(`organization ${ORG.slug}: ${org ? "updated" : "created"}`);
      for (const p of people) {
        const existed = await tx.user.findUnique({ where: { email: p.email }, select: { id: true, isPlatformAdmin: true, memberships: { select: { organization: { select: { slug: true } } } } } });
        const u = await tx.user.upsert({
          where: { email: p.email },
          create: { email: p.email, name: p.name, hashedPassword: hashes.get(p.email), emailVerified: now, activeOrgId: o.id },
          update: { name: p.name, hashedPassword: hashes.get(p.email), emailVerified: now, activeOrgId: o.id },
        });
        out.push(`user ${p.email}: ${existed ? "updated" : "created"}`);
        const seat = await tx.membership.findUnique({ where: { userId_organizationId: { userId: u.id, organizationId: o.id } } });
        await tx.membership.upsert({
          where: { userId_organizationId: { userId: u.id, organizationId: o.id } },
          create: { userId: u.id, organizationId: o.id, role: p.role },
          update: { role: p.role },
        });
        out.push(`membership ${p.email} → ${ORG.slug} (${p.role}): ${seat ? "updated" : "created"}`);
      }
      return out;
    });
    for (const l of lines) console.log(l);

    // The check (read only): the organisation, its seats, and the QA mark exactly as lib/qaOrg asks it.
    const seen = await db.organization.findFirst({ where: { slug: ORG.slug }, select: { id: true, name: true, billingEmail: true, subscription: { select: { id: true } }, memberships: { select: { role: true, user: { select: { email: true, emailVerified: true, hashedPassword: true } } } } } });
    const qa = seen ? await db.organization.findFirst({ where: { id: seen.id, OR: [{ billingEmail: { endsWith: QA_DOMAIN } }, { memberships: { some: { user: { email: { endsWith: QA_DOMAIN } } } } }] }, select: { id: true } }) : null;
    console.log(`check: organization ${ORG.slug} "${seen?.name}" · billing ${seen?.billingEmail} · subscription ${seen?.subscription ? "PRESENT" : "none (Free)"} · QA mark (lib/qaOrg) ${qa ? "yes" : "NO"}`);
    for (const m of seen?.memberships ?? []) console.log(`check: ${m.user.email} · ${m.role} · verified ${m.user.emailVerified ? "yes" : "no"} · password ${m.user.hashedPassword ? "set" : "none"}`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.log(`FAILED: ${String((e as Error).message).replace(/postgres(ql)?:\/\/\S+/gi, "<url>").split("\n").slice(-3).join(" ")}`);
  process.exit(1);
});
