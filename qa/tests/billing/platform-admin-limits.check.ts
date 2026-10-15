// A platform admin has no plan caps in an organization they OWN, and the
// ordinary caps everywhere else — through the REAL engine, no browser.
//
//   npx tsx --tsconfig tsconfig.json qa/tests/billing/platform-admin-limits.check.ts
//
// The owner's rule (2026-09-22): isPlatformAdmin AND an OWNER seat in the
// organization being checked → every key unlimited, enforcePlanLimit passes,
// the surfaces say "Unlimited · platform admin"; a member's seat (or none)
// in another organization → the plan's caps as for anyone; the flag off →
// the caps are back. One rule, in lib/limitsEngine (resolvePlan).
//
// Made here and removed at the end, pass or fail: one user with the flag
// (`qa-platform-admin-<pid>@jobflex.test`), one organisation they own
// ("QA Admin Co", on no subscription = the free plan), and a member seat (role USER) for
// them in **QA Co**. The real platform admin (owner@acme.test, OWNER of Acme)
// is only READ — nothing is created or counted in Acme.

import { PrismaClient } from "@prisma/client";
import { checkPlanLimit, enforcePlanLimit, getOrgLimitUsage, getOrgLimitOverview, isPlanLimitExempt } from "../../../src/lib/limitsEngine";
import { getNavLimitState } from "../../../src/lib/navLimits";
import { LIMIT_DEFS, PLAN_LIMIT_MESSAGE } from "../../../src/lib/planLimits";

const db = new PrismaClient();
const QA_SLUG = "qa-co";
const TAG = `qa-platform-admin-${process.pid}`;
const EMAIL = `${TAG}@jobflex.test`;
const TITLE = "QA platform-admin-limits";

let passes = 0;
let failures = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) passes++;
  else failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};
const head = (s: string) => console.log(`\n── ${s}`);

async function rejects(fn: () => Promise<unknown>): Promise<Error | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e as Error;
  }
}

let userId = "";
let ownOrgId = "";
let qaOrgId = "";
const made: string[] = [];

async function makeProposal(organizationId: string, n: number) {
  const p = await db.proposal.create({
    data: { organizationId, publicId: `${TAG}-${n}-${Date.now()}`, title: TITLE },
    select: { id: true },
  });
  made.push(p.id);
}

async function main() {
  const qa = await db.organization.findUnique({ where: { slug: QA_SLUG }, select: { id: true } });
  if (!qa) throw new Error("QA Co (qa-co) is not seeded");
  qaOrgId = qa.id;

  const user = await db.user.create({ data: { email: EMAIL, name: "QA Platform Admin", isPlatformAdmin: true }, select: { id: true } });
  userId = user.id;
  const own = await db.organization.create({ data: { slug: TAG, name: "QA Admin Co" }, select: { id: true } });
  ownOrgId = own.id;
  await db.membership.create({ data: { userId, organizationId: ownOrgId, role: "OWNER" } });
  await db.membership.create({ data: { userId, organizationId: qaOrgId, role: "USER" } });

  const me = { actorId: userId };
  const nobody = { actorId: null };

  try {
    /* ── A. the rule ────────────────────────────────────────────────── */
    head("A · the rule, as a question");
    ok("A admin + OWNER of the org → exempt", await isPlanLimitExempt(ownOrgId, userId));
    ok("A admin + member (USER) of QA Co → not exempt", !(await isPlanLimitExempt(qaOrgId, userId)));
    ok("A nobody → not exempt", !(await isPlanLimitExempt(ownOrgId, null)));
    const stranger = await db.user.findUnique({ where: { email: "qa@acme.test" }, select: { id: true } });
    ok("A the QA robot (no flag) in its own org → not exempt", !!stranger && !(await isPlanLimitExempt(qaOrgId, stranger.id)));

    /* ── B. in their own organisation: no caps ──────────────────────── */
    head("B · own organisation: every key unlimited");
    const free = await getOrgLimitUsage(ownOrgId, nobody);
    ok("B as nobody, the free plan caps proposals", free.find((u) => u.resource === "proposalsCreated")?.limit !== null, `limit ${free.find((u) => u.resource === "proposalsCreated")?.limit}`);
    const mine = await getOrgLimitUsage(ownOrgId, me);
    ok("B as the admin, every key is unlimited and marked exempt", mine.every((u) => u.limit === null && u.remaining === null && u.allowed && u.exempt === true), mine.filter((u) => u.limit !== null).map((u) => u.resource).join(","));
    ok("B every key, not a subset", mine.length === LIMIT_DEFS.length);
    const limit = free.find((u) => u.resource === "proposalsCreated")?.limit ?? 0;
    for (let i = 0; i <= limit; i++) await makeProposal(ownOrgId, i);
    const over = await checkPlanLimit(ownOrgId, "proposalsCreated", 1, nobody);
    ok("B past the cap as nobody: blocked", over.used > limit && !over.allowed, `${over.used}/${over.limit}`);
    ok("B past the cap as the admin: enforcePlanLimit passes", (await rejects(() => enforcePlanLimit(ownOrgId, "proposalsCreated", 1, me))) === null);
    ok("B estimators, phone calls, leads too", ["estimatorUses", "aiPhoneCalls", "leads"].every((k) => mine.find((u) => u.resource === k)?.exempt === true));
    ok("B seats too (workers, team seats)", ["workers", "teamSeats", "managers"].every((k) => mine.find((u) => u.resource === k)?.limit === null));
    const ov = await getOrgLimitOverview(ownOrgId, me);
    ok("B the overview says exempt", ov.exempt === true);
    const nav = await getNavLimitState(ownOrgId);
    ok("B the sidebar state outside a request (nobody): counters, not exempt", nav.exempt === false && Object.keys(nav.counters).length > 0);

    /* ── C. in QA Co as a member: the plan's caps ───────────────────── */
    head("C · QA Co, as a member: the caps as for anyone");
    const asMember = await getOrgLimitUsage(qaOrgId, me);
    const asNobody = await getOrgLimitUsage(qaOrgId, nobody);
    ok("C not exempt", asMember.every((u) => u.exempt === undefined));
    ok("C the same numbers as for nobody", JSON.stringify(asMember) === JSON.stringify(asNobody));
    ok("C proposals are capped", asMember.find((u) => u.resource === "proposalsCreated")?.limit !== null);
    const blockedQa = await checkPlanLimit(qaOrgId, "proposalsCreated", 1, me);
    const blockedNobody = await checkPlanLimit(qaOrgId, "proposalsCreated", 1, nobody);
    ok("C enforcement is the same as for nobody", blockedQa.allowed === blockedNobody.allowed && blockedQa.used === blockedNobody.used);
    if (!blockedNobody.allowed) {
      const err = await rejects(() => enforcePlanLimit(qaOrgId, "proposalsCreated", 1, me));
      ok("C an exhausted QA Co blocks the admin-member too", !!err && err.message === PLAN_LIMIT_MESSAGE);
    }

    /* ── D. the flag off: the caps are back ─────────────────────────── */
    head("D · the flag removed");
    await db.user.update({ where: { id: userId }, data: { isPlatformAdmin: false } });
    ok("D not exempt any more", !(await isPlanLimitExempt(ownOrgId, userId)));
    const back = await checkPlanLimit(ownOrgId, "proposalsCreated", 1, me);
    ok("D own organisation counts and blocks again", back.limit === limit && back.used > limit && !back.allowed && back.exempt === undefined, `${back.used}/${back.limit}`);
    const backErr = await rejects(() => enforcePlanLimit(ownOrgId, "proposalsCreated", 1, me));
    ok("D enforcePlanLimit throws again", !!backErr && backErr.message === PLAN_LIMIT_MESSAGE);
    await db.user.update({ where: { id: userId }, data: { isPlatformAdmin: true } });
    ok("D the flag back on: exempt again", await isPlanLimitExempt(ownOrgId, userId));

    /* ── E. an OWNER seat given up ──────────────────────────────────── */
    head("E · the seat, not just the flag");
    await db.membership.updateMany({ where: { userId, organizationId: ownOrgId }, data: { role: "ADMIN" } });
    ok("E an org ADMIN seat (not OWNER) with the flag → not exempt", !(await isPlanLimitExempt(ownOrgId, userId)));
    await db.membership.updateMany({ where: { userId, organizationId: ownOrgId }, data: { role: "OWNER" } });

    /* ── F. the real one, read only ─────────────────────────────────── */
    head("F · the platform admin of record (read only)");
    const owner = await db.user.findUnique({ where: { email: "owner@acme.test" }, select: { id: true, isPlatformAdmin: true, memberships: { select: { organizationId: true, role: true, organization: { select: { slug: true } } } } } });
    const acme = owner?.memberships.find((m) => m.role === "OWNER");
    if (owner?.isPlatformAdmin && acme) {
      ok(`F owner@acme.test is exempt in ${acme.organization.slug}`, await isPlanLimitExempt(acme.organizationId, owner.id));
      ok("F and not in QA Co", !(await isPlanLimitExempt(qaOrgId, owner.id)));
      const sales = await db.user.findUnique({ where: { email: "sales@acme.test" }, select: { id: true } });
      if (sales) ok("F sales@acme.test (no flag) is not exempt in Acme", !(await isPlanLimitExempt(acme.organizationId, sales.id)));
    } else {
      console.log("F  skipped — owner@acme.test is not a platform admin owning an organisation in this database");
    }
  } finally {
    if (made.length) await db.proposal.deleteMany({ where: { id: { in: made } } });
    await db.membership.deleteMany({ where: { userId } });
    if (ownOrgId) await db.organization.delete({ where: { id: ownOrgId } }).catch((e) => console.warn("could not delete QA Admin Co:", e));
    if (userId) await db.user.delete({ where: { id: userId } }).catch((e) => console.warn("could not delete the throwaway user:", e));
    await db.$disconnect();
  }
  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
