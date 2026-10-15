// The admin's usage reset, through the REAL engine and the real reset code —
// no browser, no Stripe, no mail.
//
//   npx tsx --tsconfig tsconfig.json qa/tests/billing/usage-reset.check.ts
//
// The owner's rules (2026-09-22): a reset deletes nothing and moves no cap;
// it writes a mark (`usageResetAt:<orgId>:<key>`, SyncState) with the time,
// the author and a reason, and the engine counts only the rows after it,
// inside the current cycle; the mark is over at the next cycle; a second
// reset is a newer mark; every reset is a USAGE_RESET activity event; seats
// are never reset; the action refuses anyone but a platform admin.
//
// Runs in **QA Co** (slug `qa-co`), on the free plan (5 proposals a cycle).
// The proposals it makes carry the title "QA usage-reset" and are removed at
// the end, pass or fail; QA Co's reset marks are snapshotted and put back.
// One throwaway organisation ("QA Reset Other") proves a reset stays inside
// its organisation; it is deleted at the end.

import { PrismaClient } from "@prisma/client";
import { checkPlanLimit, enforcePlanLimit, getOrgLimitUsage, getOrgCycleStart, readUsageResetMarks, usageResetInForce, usageResetKey, usageResetPrefix } from "../../../src/lib/limitsEngine";
import { orgUsageForAdmin, resetOrgUsage, RESETTABLE_KEYS } from "../../../src/lib/usageReset";
import { PLAN_LIMIT_MESSAGE, LIMIT_DEFS } from "../../../src/lib/planLimits";

const db = new PrismaClient();
const QA_SLUG = "qa-co";
const OTHER_SLUG = `qa-reset-other-${process.pid}`;
const TITLE = "QA usage-reset";
const ADMIN = { id: "qa-admin", email: "qa-admin@jobflex.test" };
const DAY_MS = 24 * 60 * 60 * 1000;

let passes = 0;
let failures = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) passes++;
  else failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};
const head = (s: string) => console.log(`\n── ${s}`);

let orgId = "";
let otherId = "";
const made: string[] = [];

async function makeProposal(organizationId: string, n: number) {
  const p = await db.proposal.create({
    data: { organizationId, publicId: `qa-ur-${process.pid}-${organizationId.slice(-4)}-${n}-${Date.now()}`, title: TITLE },
    select: { id: true },
  });
  made.push(p.id);
  return p.id;
}

async function usage(organizationId: string, key: (typeof LIMIT_DEFS)[number]["key"]) {
  return checkPlanLimit(organizationId, key);
}

async function rejects(fn: () => Promise<unknown>): Promise<Error | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e as Error;
  }
}

async function main() {
  const org = await db.organization.findUnique({ where: { slug: QA_SLUG }, select: { id: true } });
  if (!org) throw new Error("QA Co (qa-co) is not seeded");
  orgId = org.id;
  const qaUser = await db.user.findUnique({ where: { email: "qa@acme.test" }, select: { id: true } });
  if (qaUser) ADMIN.id = qaUser.id; // actorId is a User FK on ActivityEvent

  // ── snapshot QA Co ──
  const savedMarks = await db.syncState.findMany({ where: { key: { startsWith: usageResetPrefix(orgId) } } });
  const savedEvents = new Set((await db.activityEvent.findMany({ where: { organizationId: orgId, kind: "USAGE_RESET" }, select: { id: true } })).map((a) => a.id));
  await db.syncState.deleteMany({ where: { key: { startsWith: usageResetPrefix(orgId) } } });

  const other = await db.organization.create({ data: { slug: OTHER_SLUG, name: "QA Reset Other" }, select: { id: true } });
  otherId = other.id;

  try {
    /* ── A. exhaust the cap ─────────────────────────────────────────── */
    head("A · an exhausted limit blocks");
    let st = await usage(orgId, "proposalsCreated");
    ok("A proposalsCreated has a cap on QA Co", st.limit !== null, `limit ${st.limit}`);
    const limit = st.limit ?? 0;
    for (let i = 0; i < limit + 1 && (await usage(orgId, "proposalsCreated")).allowed; i++) await makeProposal(orgId, i);
    st = await usage(orgId, "proposalsCreated");
    ok("A used ≥ limit, not allowed", st.used >= limit && !st.allowed, `${st.used}/${st.limit}`);
    const blocked = await rejects(() => enforcePlanLimit(orgId, "proposalsCreated"));
    ok("A enforcePlanLimit throws PLAN_LIMIT_REACHED", !!blocked && blocked.message === PLAN_LIMIT_MESSAGE && (blocked as { code?: string }).code === "PLAN_LIMIT_REACHED", blocked?.message);
    const est0 = await usage(orgId, "estimatorUses");
    ok("A estimatorUses is capped by the exhausted proposals", est0.cappedBy === "proposalsCreated" && !est0.allowed);
    await makeProposal(otherId, 0);
    const otherBefore = await usage(otherId, "proposalsCreated");
    ok("A the other organisation counts its own row", otherBefore.used === 1, `${otherBefore.used}`);
    const jobsBefore = await usage(orgId, "jobs");
    const estUsedBefore = (await getOrgLimitUsage(orgId)).find((u) => u.resource === "estimatorUses")?.used ?? -1;

    /* ── B. refusals ────────────────────────────────────────────────── */
    head("B · what a reset refuses");
    const b1 = await resetOrgUsage({ organizationId: orgId, keys: ["proposalsCreated"], reason: "" }, ADMIN);
    ok("B no reason", !b1.ok && /reason/i.test(b1.ok ? "" : b1.error));
    const b2 = await resetOrgUsage({ organizationId: orgId, keys: ["workers"], reason: "seat reset" }, ADMIN);
    ok("B a seat count cannot be reset", !b2.ok && /seat/i.test(b2.ok ? "" : b2.error), b2.ok ? "" : b2.error);
    const b3 = await resetOrgUsage({ organizationId: orgId, keys: ["nope"], reason: "unknown key" }, ADMIN);
    ok("B an unknown key", !b3.ok && /Unknown/.test(b3.ok ? "" : b3.error));
    const b4 = await resetOrgUsage({ organizationId: "no-such-org", keys: "all", reason: "ghost" }, ADMIN);
    ok("B an unknown organisation", !b4.ok && /organization/i.test(b4.ok ? "" : b4.error));
    const b5 = await resetOrgUsage({ organizationId: orgId, keys: [], reason: "nothing" }, ADMIN);
    ok("B no keys", !b5.ok);
    ok("B nothing was written by a refusal", Object.keys(await readUsageResetMarks(orgId)).length === 0);

    /* ── C. the reset ───────────────────────────────────────────────── */
    head("C · reset proposalsCreated");
    const c = await resetOrgUsage({ organizationId: orgId, keys: ["proposalsCreated"], reason: "QA: start the month over" }, ADMIN);
    ok("C applied", c.ok, c.ok ? c.summary : c.error);
    if (!c.ok) throw new Error("reset failed");
    ok("C records what the meter read", c.done.length === 1 && c.done[0].key === "proposalsCreated" && c.done[0].before.used >= limit && c.done[0].before.limit === limit);
    const marks = await readUsageResetMarks(orgId);
    const m = marks.proposalsCreated;
    ok("C one mark, with time, author, reason, before", !!m && m.at === c.at && m.actorEmail === ADMIN.email && m.actorId === ADMIN.id && m.reason === "QA: start the month over" && m.before.used >= limit && Object.keys(marks).length === 1);
    const raw = await db.syncState.findUnique({ where: { key: usageResetKey(orgId, "proposalsCreated") } });
    ok("C the mark is a SyncState row usageResetAt:<orgId>:<key>", !!raw);
    st = await usage(orgId, "proposalsCreated");
    ok("C the engine counts from the mark: 0 used, allowed, resetAt set", st.used === 0 && st.allowed && st.remaining === limit && st.resetAt === c.at, `${st.used}/${st.limit} resetAt=${st.resetAt}`);
    ok("C enforcePlanLimit passes", (await rejects(() => enforcePlanLimit(orgId, "proposalsCreated"))) === null);
    const est1 = await usage(orgId, "estimatorUses");
    ok("C estimatorUses is no longer capped by proposals", est1.allowed && est1.cappedBy === undefined, JSON.stringify({ allowed: est1.allowed, cappedBy: est1.cappedBy }));
    ok("C nothing was deleted", (await db.proposal.count({ where: { organizationId: orgId, title: TITLE } })) === made.filter((_, i) => i < made.length - 1).length);
    const ev = await db.activityEvent.findFirst({ where: { organizationId: orgId, kind: "USAGE_RESET" }, orderBy: { createdAt: "desc" } });
    const meta = ev?.meta ? JSON.parse(ev.meta) : null;
    ok("C USAGE_RESET activity with the reason, the author, the meter", !!ev && ev.actorId === ADMIN.id && /Proposals created \(\d+ → 0 of \d+\)/.test(ev.summary) && meta?.reason === "QA: start the month over" && meta?.actorEmail === ADMIN.email && meta?.keys?.[0]?.key === "proposalsCreated", ev?.summary);

    /* ── D. a new row counts ────────────────────────────────────────── */
    head("D · the next row counts from the mark");
    await makeProposal(orgId, 100);
    st = await usage(orgId, "proposalsCreated");
    ok("D used 1, remaining limit-1", st.used === 1 && st.remaining === limit - 1 && st.allowed, `${st.used}/${st.limit}`);

    /* ── E. isolation ───────────────────────────────────────────────── */
    head("E · other keys and other organisations are untouched");
    const jobsAfter = await usage(orgId, "jobs");
    ok("E jobs on QA Co unchanged, no mark", jobsAfter.used === jobsBefore.used && jobsAfter.resetAt === undefined);
    const estUsedAfter = (await getOrgLimitUsage(orgId)).find((u) => u.resource === "estimatorUses")?.used ?? -2;
    ok("E estimatorUses on QA Co unchanged", estUsedAfter === estUsedBefore, `${estUsedBefore} → ${estUsedAfter}`);
    const otherAfter = await usage(otherId, "proposalsCreated");
    ok("E the other organisation still counts its row", otherAfter.used === 1 && otherAfter.resetAt === undefined);
    ok("E no mark on the other organisation", (await db.syncState.count({ where: { key: { startsWith: usageResetPrefix(otherId) } } })) === 0);

    /* ── F. a second reset is a newer mark ──────────────────────────── */
    head("F · reset again");
    await new Promise((r) => setTimeout(r, 5));
    const f = await resetOrgUsage({ organizationId: orgId, keys: ["proposalsCreated"], reason: "QA: once more" }, ADMIN);
    const m2 = (await readUsageResetMarks(orgId)).proposalsCreated;
    ok("F a newer mark replaces the first", f.ok && !!m2 && new Date(m2.at).getTime() > new Date(m!.at).getTime() && m2.before.used === 1 && m2.reason === "QA: once more");
    st = await usage(orgId, "proposalsCreated");
    ok("F counts from the newer mark: 0 used", st.used === 0 && st.resetAt === m2?.at);

    /* ── G. the cycle ───────────────────────────────────────────────── */
    head("G · the mark ends with the cycle");
    const cycleStart = await getOrgCycleStart(orgId);
    ok("G in force inside the cycle", usageResetInForce(m2, cycleStart)?.toISOString() === m2?.at);
    ok("G not in force once the next cycle has begun", usageResetInForce(m2, new Date(Date.now() + 40 * DAY_MS)) === null);
    // a mark from the previous cycle, written straight in: ignored
    const stale = { at: new Date(cycleStart.getTime() - DAY_MS).toISOString(), cycleStart: cycleStart.toISOString(), actorId: ADMIN.id, actorEmail: ADMIN.email, reason: "last cycle", before: { used: 9, limit: 10 } };
    await db.syncState.create({ data: { key: usageResetKey(orgId, "jobs"), cursor: JSON.stringify(stale) } });
    const jobsStale = await usage(orgId, "jobs");
    const jobsSince = await db.job.count({ where: { organizationId: orgId, createdAt: { gte: cycleStart } } });
    ok("G a mark before the cycle start is ignored: jobs count from the cycle start", jobsStale.resetAt === undefined && (jobsStale.limit === null || jobsStale.used === jobsSince), `${jobsStale.used} vs ${jobsSince}`);
    const admin1 = await orgUsageForAdmin(orgId);
    const jobsRow = admin1.rows.find((r) => r.key === "jobs");
    ok("G the admin table shows no reset on it either", !!jobsRow && jobsRow.reset === null);
    await db.syncState.delete({ where: { key: usageResetKey(orgId, "jobs") } });

    /* ── H. reset all ───────────────────────────────────────────────── */
    head("H · Reset all");
    const h = await resetOrgUsage({ organizationId: orgId, keys: "all", reason: "QA: everything" }, ADMIN);
    const all = await readUsageResetMarks(orgId);
    ok("H every monthly key has a mark, no seat key does", h.ok && RESETTABLE_KEYS.every((k) => !!all[k]) && LIMIT_DEFS.filter((d) => d.scope === "absolute").every((d) => !all[d.key]), Object.keys(all).join(","));
    const admin2 = await orgUsageForAdmin(orgId);
    ok("H the admin table: monthly rows carry the reset, seats are not resettable", admin2.rows.filter((r) => r.scope === "monthly").every((r) => r.resettable && r.reset?.reason === "QA: everything") && admin2.rows.filter((r) => r.scope === "absolute").every((r) => !r.resettable && r.reset === null));
    const evAll = await db.activityEvent.findFirst({ where: { organizationId: orgId, kind: "USAGE_RESET" }, orderBy: { createdAt: "desc" } });
    ok("H activity says every limit", /every limit this cycle/.test(evAll?.summary ?? ""), evAll?.summary);
    const seats = await usage(orgId, "workers");
    const seatsDb = await db.workerProfile.count({ where: { organizationId: orgId, inviteStatus: { not: "DECLINED" } } });
    ok("H seats still count in full", seats.limit === null || seats.used === seatsDb);

    /* ── I. the action refuses a non-admin ──────────────────────────── */
    head("I · only a platform admin");
    const before = (await readUsageResetMarks(orgId)).proposalsCreated?.at;
    let refused: Error | null = null;
    try {
      const actions = await import("../../../src/actions/adminUsage");
      refused = await rejects(() => actions.resetAdminOrgUsage({ organizationId: orgId, keys: ["proposalsCreated"], reason: "owner tries" }));
    } catch (e) {
      refused = e as Error;
    }
    ok("I the action throws without a platform-admin principal", !!refused, refused?.message?.slice(0, 80));
    ok("I and wrote nothing", (await readUsageResetMarks(orgId)).proposalsCreated?.at === before);
  } finally {
    // ── put QA Co back ──
    if (made.length) await db.proposal.deleteMany({ where: { id: { in: made } } });
    await db.syncState.deleteMany({ where: { key: { startsWith: usageResetPrefix(orgId) } } });
    for (const r of savedMarks) await db.syncState.create({ data: { key: r.key, cursor: r.cursor } });
    await db.activityEvent.deleteMany({ where: { organizationId: orgId, kind: "USAGE_RESET", id: { notIn: [...savedEvents] } } });
    if (otherId) {
      await db.proposal.deleteMany({ where: { organizationId: otherId } });
      await db.activityEvent.deleteMany({ where: { organizationId: otherId } });
      await db.organization.delete({ where: { id: otherId } }).catch((e) => console.warn("could not delete the throwaway organisation:", e));
    }
    await db.$disconnect();
  }
  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
