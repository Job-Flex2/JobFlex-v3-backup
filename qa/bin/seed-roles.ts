// npm run qa:seed-roles — the QA Lab's role accounts on the LOCAL database (refuses any other).
//   manager  qa-manager@qa.jobflex.test  MANAGER seat in QA Co
//   worker   qa-worker@qa.jobflex.test   INSTALLER seat in QA Co
//   admin    qa-admin@qa.jobflex.test    platform admin (/admin), no seat anywhere
// Passwords are QA_PASS_<ROLE> from .env.local / .env (never printed). The owner is qa@acme.test,
// seeded with the database; this script does not touch it. Run again to reset the passwords.
// `--remove` deletes the three accounts (and their seats).
import bcrypt from "bcryptjs";
import { assertLocalDatabase, disconnect, prisma, QA_ORG_SLUG } from "../lib/db";
import { credentials, type RoleName } from "../lib/roles";

const SEATS: { role: RoleName; membership: string | null; platformAdmin: boolean; name: string }[] = [
  { role: "manager", membership: "MANAGER", platformAdmin: false, name: "QA Manager" },
  { role: "worker", membership: "INSTALLER", platformAdmin: false, name: "QA Worker" },
  { role: "admin", membership: null, platformAdmin: true, name: "QA Platform Admin" },
];

async function main() {
  assertLocalDatabase();
  const db = prisma();
  const org = await db.organization.findUnique({ where: { slug: QA_ORG_SLUG } });
  if (!org) throw new Error('organisation "QA Co" (slug qa-co) is missing — run the seed first');
  const remove = process.argv.includes("--remove");
  for (const seat of SEATS) {
    const creds = credentials(seat.role);
    if (!creds) {
      console.log(`${seat.role}: skipped — set QA_USER_${seat.role.toUpperCase()} / QA_PASS_${seat.role.toUpperCase()} in .env.local`);
      continue;
    }
    if (!/@qa\.jobflex\.test$/i.test(creds.email)) throw new Error(`${seat.role}: ${creds.email} is not a @qa.jobflex.test address — refusing to touch a real account`);
    if (remove) {
      const u = await db.user.findUnique({ where: { email: creds.email } });
      if (u) {
        await db.membership.deleteMany({ where: { userId: u.id } });
        await db.user.delete({ where: { id: u.id } });
      }
      console.log(`${seat.role}: removed ${creds.email}`);
      continue;
    }
    const hashedPassword = await bcrypt.hash(creds.password, 10);
    const user = await db.user.upsert({
      where: { email: creds.email },
      create: { email: creds.email, name: seat.name, hashedPassword, emailVerified: new Date(), isPlatformAdmin: seat.platformAdmin, activeOrgId: seat.membership ? org.id : null },
      update: { name: seat.name, hashedPassword, isPlatformAdmin: seat.platformAdmin, activeOrgId: seat.membership ? org.id : null },
    });
    // Exactly one seat, in QA Co (or none for the platform admin).
    await db.membership.deleteMany({ where: { userId: user.id, NOT: seat.membership ? { organizationId: org.id } : undefined } });
    if (seat.membership) {
      const m = await db.membership.findFirst({ where: { userId: user.id, organizationId: org.id } });
      if (m) await db.membership.update({ where: { id: m.id }, data: { role: seat.membership } });
      else await db.membership.create({ data: { userId: user.id, organizationId: org.id, role: seat.membership } });
    }
    console.log(`${seat.role}: ${creds.email} ready (${seat.membership ? seat.membership + " in QA Co" : "platform admin, no seat"})`);
  }
}

main().then(disconnect, async (e) => { console.error(e.message); await disconnect(); process.exit(1); });
