// A small crew world in QA Co for the stage-A checks (2026-09-30): two
// installers with profiles, one job they are both on. Made first, removed
// last — pass or fail — so nothing a check does outlives it.
import { PrismaClient } from "@prisma/client";

export const db = new PrismaClient();

export interface CrewWorld {
  orgId: string;
  tz: string;
  ownerUserId: string;
  managerUserId: string;
  jobId: string;
  jobTitle: string;
  workers: Array<{ userId: string; workerId: string; token: string; name: string }>;
  outsider: { userId: string; workerId: string; token: string };
  startedAt: Date;
  cleanup: () => Promise<void>;
}

export async function makeCrewWorld(tag: string): Promise<CrewWorld> {
  const org = await db.organization.findUnique({ where: { slug: "qa-co" }, select: { id: true, timezone: true } });
  if (!org) throw new Error("QA Co (qa-co) is not seeded");
  const owner = await db.membership.findFirst({ where: { organizationId: org.id, role: "OWNER" }, select: { userId: true } });
  if (!owner) throw new Error("QA Co has no owner");
  const startedAt = new Date();
  const made: { users: string[]; jobs: string[]; memberships: string[] } = { users: [], jobs: [], memberships: [] };

  async function installer(slug: string, name: string) {
    const email = `qa-${tag}-${slug}@acme.test`;
    let user = await db.user.findUnique({ where: { email } });
    if (!user) {
      user = await db.user.create({ data: { email, name, activeOrgId: org!.id } });
      made.users.push(user.id);
    }
    const m = await db.membership.upsert({ where: { userId_organizationId: { userId: user.id, organizationId: org!.id } }, update: { role: "INSTALLER" }, create: { userId: user.id, organizationId: org!.id, role: "INSTALLER" } });
    made.memberships.push(m.id);
    const wp = await db.workerProfile.upsert({ where: { userId: user.id }, update: { organizationId: org!.id }, create: { userId: user.id, organizationId: org!.id, displayName: name, inviteStatus: "ACCEPTED" } });
    return { userId: user.id, workerId: wp.id, token: wp.token, name };
  }
  const a = await installer("a", `QA Crew A ${tag}`);
  const b = await installer("b", `QA Crew B ${tag}`);
  const outsider = await installer("x", `QA Outsider ${tag}`);
  // A manager to review with (the owner's seat reviews too; a MANAGER row proves the role name).
  const managerEmail = `qa-${tag}-mgr@acme.test`;
  let mgr = await db.user.findUnique({ where: { email: managerEmail } });
  if (!mgr) { mgr = await db.user.create({ data: { email: managerEmail, name: `QA Manager ${tag}`, activeOrgId: org.id } }); made.users.push(mgr.id); }
  const mm = await db.membership.upsert({ where: { userId_organizationId: { userId: mgr.id, organizationId: org.id } }, update: { role: "MANAGER" }, create: { userId: mgr.id, organizationId: org.id, role: "MANAGER" } });
  made.memberships.push(mm.id);

  const job = await db.job.create({ data: { organizationId: org.id, title: `QA ${tag} fence job`, status: "SCHEDULED" } });
  made.jobs.push(job.id);
  for (const w of [a, b]) await db.jobAssignment.create({ data: { jobId: job.id, workerId: w.workerId, status: "ACCEPTED" } });

  return {
    orgId: org.id,
    tz: org.timezone || "America/New_York",
    ownerUserId: owner.userId,
    managerUserId: mgr.id,
    jobId: job.id,
    jobTitle: job.title,
    workers: [a, b],
    outsider,
    startedAt,
    cleanup: async () => {
      // Give the detached after-response work (the office's text) a moment to land before the sweep.
      await new Promise((r) => setTimeout(r, 400));
      for (const id of made.jobs) await db.job.delete({ where: { id } }).catch(() => {});
      await db.activityEvent.deleteMany({ where: { organizationId: org.id, createdAt: { gte: startedAt }, OR: made.jobs.map((id) => ({ meta: { contains: `"jobId":"${id}"` } })) } });
      await db.smsMessage.deleteMany({ where: { organizationId: org.id, createdAt: { gte: startedAt } } });
      for (const id of made.memberships) await db.membership.delete({ where: { id } }).catch(() => {});
      for (const id of made.users) await db.user.delete({ where: { id } }).catch(() => {});
      await db.$disconnect();
    },
  };
}
