// A platform admin sees everything in their organization — through the REAL
// gates, as the session's user, no browser (owner, 2026-10-17).
//
//   npx tsx --tsconfig tsconfig.json qa/tests/billing/platform-admin-access.check.ts
//
// The owner's rule: a user with isPlatformAdmin and a seat (any role) in an
// organization has the whole dashboard there, whatever the subscription says
// and whatever the seat's role. One function decides (lib/fullAccess
// hasFullAccess); every door asks it: the add-on pages, the feature tier, the
// plan's limits, the paid services, the role route gates. Anyone else is
// unchanged: an ordinary owner of the same organization stays closed.
//
// Made here and removed at the end, pass or fail (all isInternal, local dev.db):
//   · "Free Co"      — Subscription FREE/FREE (a grant run out onto Free);
//                      its ordinary OWNER, and the platform admin as MANAGER;
//   · "Canceled Co"  — Subscription CANCELED, period over; an ordinary SALES
//                      seat, and the platform admin as SALES.
import { actAs, check, outcome, summary } from "../_lib/_actionHarness";
import { db } from "../../../src/lib/db";
import { hasFullAccess, accessRole, fullAccessFor } from "../../../src/lib/fullAccess";
import { getBlockedCustomPages, isPageLocked, requirePage } from "../../../src/lib/customPageAccess";
import { getOrgPlanById } from "../../../src/lib/orgPlan";
import { getOrgPlanContext } from "../../../src/lib/planCatalogServer";
import { editionFacts } from "../../../src/lib/editionAccess";
import { getOrgLimitUsage, enforcePlanLimit } from "../../../src/lib/limitsEngine";
import { planEnded, planEndedRefusal, planOpen } from "../../../src/lib/paidCaps";
import { requireOrg, requireManager, requireRouteAccess, requireOwner } from "../../../src/lib/orgContext";
import { startPhoneVerification } from "../../../src/actions/sms";
import { PLAN_ENDED_MARK } from "../../../src/lib/customPlan";

const tag = `qa-admin-access-${Date.now()}`;
const made: { orgs: string[]; users: string[] } = { orgs: [], users: [] };
const day = 864e5;

async function org(name: string, status: "FREE" | "CANCELED") {
  const o = await db.organization.create({ data: { name: `${tag} ${name}`, slug: `${tag}-${name.toLowerCase().replace(/\W+/g, "-")}`, isInternal: true } });
  made.orgs.push(o.id);
  await db.subscription.create({
    data: status === "FREE"
      ? { organizationId: o.id, plan: "FREE", status: "FREE", provider: "MANUAL", currentPeriodEnd: new Date(Date.now() - 2 * day) }
      : { organizationId: o.id, plan: "PROFESSIONAL", status: "CANCELED", provider: "STRIPE", canceledAt: new Date(Date.now() - 20 * day), currentPeriodEnd: new Date(Date.now() - 10 * day) },
  });
  return o;
}
async function person(key: string, orgId: string, role: string, isPlatformAdmin = false) {
  const u = await db.user.create({ data: { email: `${tag}-${key}@qa.test`, name: key, isPlatformAdmin, activeOrgId: orgId } });
  made.users.push(u.id);
  await db.membership.create({ data: { userId: u.id, organizationId: orgId, role } });
  return u;
}
const throws = async (fn: () => Promise<unknown>) => { try { await fn(); return false; } catch { return true; } };

/** Every door, asked as whoever actAs() set: true = open. */
async function doors(orgId: string) {
  const blocked = await getBlockedCustomPages(orgId);
  const usage = await getOrgLimitUsage(orgId);
  const ctx = await getOrgPlanContext(orgId);
  return {
    pages: blocked === null || blocked.length === 0,
    planEndedMark: !!blocked?.includes(PLAN_ENDED_MARK),
    roofPage: !(await isPageLocked(orgId, "roof-estimator")),
    requirePage: !(await throws(() => requirePage(orgId, ["roof-estimator", "hvac-estimator"]))),
    tier: await getOrgPlanById(orgId),
    ctxTier: ctx.tier,
    edition: !(await editionFacts(orgId)).lapsed,
    limits: usage.every((u) => u.limit === null && u.exempt === true),
    enforce: !(await throws(() => enforcePlanLimit(orgId, "proposalsCreated", 10_000))),
    planOpen: await planOpen(orgId),
    planNotEnded: !(await planEnded(orgId)),
    paidService: (await planEndedRefusal(orgId, "photo analysis")) === null,
  };
}
const ALL_OPEN = (d: Awaited<ReturnType<typeof doors>>) =>
  d.pages && !d.planEndedMark && d.roofPage && d.requirePage && d.tier === "ENTERPRISE" && d.ctxTier === "ENTERPRISE" && d.edition && d.limits && d.enforce && d.planOpen && d.planNotEnded && d.paidService;
const ALL_CLOSED = (d: Awaited<ReturnType<typeof doors>>) =>
  !d.pages && d.planEndedMark && !d.roofPage && !d.requirePage && d.tier === "FREE" && d.ctxTier === "FREE" && !d.edition && !d.limits && !d.enforce && !d.planOpen && !d.planNotEnded && !d.paidService;

async function main() {
  try {
    const free = await org("Free Co", "FREE");
    const canceled = await org("Canceled Co", "CANCELED");
    const owner = await person("owner", free.id, "OWNER");
    const admin = await person("admin", free.id, "MANAGER", true);
    const sales = await person("sales", canceled.id, "SALES");
    await db.membership.create({ data: { userId: admin.id, organizationId: canceled.id, role: "SALES" } });
    const stranger = await person("stranger-admin", canceled.id, "OWNER", true);
    await db.membership.deleteMany({ where: { userId: stranger.id } }); // a platform admin with no seat in either

    console.log("── the rule");
    check("pure: flag + a seat → full", fullAccessFor({ isPlatformAdmin: true }, { id: "m" }));
    check("pure: flag, no seat → not full", !fullAccessFor({ isPlatformAdmin: true }, null));
    check("pure: a seat, no flag → not full", !fullAccessFor({ isPlatformAdmin: false }, { id: "m" }));
    check("pure: a limited seat reads as a manager only with full access", accessRole("SALES", true) === "MANAGER" && accessRole("SALES", false) === "SALES" && accessRole("OWNER", true) === "OWNER" && accessRole("MANAGER", true) === "MANAGER");
    check("admin (MANAGER seat) in Free Co → full", await hasFullAccess(free.id, admin.id));
    check("admin (SALES seat) in Canceled Co → full", await hasFullAccess(canceled.id, admin.id));
    check("ordinary owner of Free Co → not full", !(await hasFullAccess(free.id, owner.id)));
    check("a platform admin with no seat → not full", !(await hasFullAccess(free.id, stranger.id)));
    check("nobody → not full", !(await hasFullAccess(free.id, null)));

    console.log("── Free Co (FREE): the admin as MANAGER — everything open");
    actAs({ id: admin.id, activeOrgId: free.id });
    const a = await doors(free.id);
    check("every door is open to the admin", ALL_OPEN(a), a);
    const phone = await outcome(() => startPhoneVerification("(206) 555-0142"));
    check("the phone code (an action) is not refused for the plan", !/active plan/.test(phone.text), phone.text);
    const ctx = await requireOrg();
    check("requireOrg: role MANAGER, full access", ctx.role === "MANAGER" && ctx.fullAccess === true && ctx.seatRole === "MANAGER", ctx);

    console.log("── Free Co (FREE): its ordinary owner — closed, as before");
    actAs({ id: owner.id, activeOrgId: free.id });
    const o = await doors(free.id);
    check("every door is closed to the ordinary owner", ALL_CLOSED(o), o);
    const phone2 = await outcome(() => startPhoneVerification("(206) 555-0143"));
    check("the phone code is refused for the plan", phone2.refused && /active plan/.test(phone2.text), phone2.text);
    check("requireOrg: OWNER, no full access", (await requireOrg()).fullAccess === false);

    console.log("── no session (a cron) — the organization decides");
    actAs(null);
    const n = await doors(free.id);
    check("every door is closed with no session", ALL_CLOSED(n), n);

    console.log("── Canceled Co: the role gates");
    actAs({ id: admin.id, activeOrgId: canceled.id });
    const as = await requireOrg();
    check("admin with a SALES seat: role reads MANAGER, seatRole SALES", as.role === "MANAGER" && as.seatRole === "SALES" && as.fullAccess, as);
    check("admin with a SALES seat: requireManager passes", !(await throws(() => requireManager())));
    check("admin with a SALES seat: a manager page passes requireRouteAccess", !(await throws(() => requireRouteAccess("/dashboard/settings"))));
    check("admin with a SALES seat: every door open on a CANCELED plan", ALL_OPEN(await doors(canceled.id)));
    check("admin with a SALES seat: requireOwner stays owner-only", await throws(() => requireOwner()));
    actAs({ id: sales.id, activeOrgId: canceled.id });
    const ss = await requireOrg();
    check("ordinary SALES: role SALES", ss.role === "SALES" && !ss.fullAccess);
    check("ordinary SALES: requireManager refuses", await throws(() => requireManager()));
    check("ordinary SALES: a manager page is refused", await throws(() => requireRouteAccess("/dashboard/settings")));
    check("ordinary SALES: every door closed on a CANCELED plan", ALL_CLOSED(await doors(canceled.id)));

    console.log("── the flag removed");
    await db.user.update({ where: { id: admin.id }, data: { isPlatformAdmin: false } });
    actAs({ id: admin.id, activeOrgId: free.id });
    const off = await doors(free.id);
    check("the same user without the flag: closed like the owner", ALL_CLOSED(off), off);
  } finally {
    actAs(null);
    await db.membership.deleteMany({ where: { OR: [{ userId: { in: made.users } }, { organizationId: { in: made.orgs } }] } }).catch(() => {});
    await db.subscription.deleteMany({ where: { organizationId: { in: made.orgs } } }).catch(() => {});
    await db.organization.deleteMany({ where: { id: { in: made.orgs } } }).catch((e) => console.warn("cleanup orgs:", e));
    await db.user.deleteMany({ where: { id: { in: made.users } } }).catch((e) => console.warn("cleanup users:", e));
    await db.$disconnect();
  }
  if (summary()) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
