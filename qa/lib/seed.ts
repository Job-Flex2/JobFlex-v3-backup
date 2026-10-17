// QA CO TO A KNOWN STATE before every run (bin/qa.ts), so a page looks the same from one run to the
// next and the access matrix sees the same records:
//   · what earlier runs left behind is removed — the forms suite's XSS / "QAAAA…" rows (follow-up
//     rules, calendar events, applicants), invitations, conversations, activity, a subscription a
//     billing check made, the throwaway teammates of the old page scripts (@qa.test);
//   · a fixed set is put back: one client and one completed job (fixed names, a fixed date in the
//     past), so /dashboard/clients/[id], /dashboard/jobs/[id] and /mobile-job-detail-v1/[id] always
//     open a real record (qa/lib/params.ts reads them) whatever order the tests run in.
// Only the LOCAL database (lib/db assertLocalDatabase), only QA Co (slug qa-co, whose OWNER must be
// qa@acme.test), never a row of another organisation. Proposals, leads and the catalogues stay:
// the old checks and the estimators keep their own rows there.
//   npm run qa:seed            the same, by hand
import { prisma, QA_ORG_SLUG } from "./db";
import { DEFAULT_USERS } from "./roles";

export const FIXTURE = {
  client: { name: "QA Fixture Client", phone: "(555) 010-0177", address: "12620 NE 100th St", city: "Kirkland", state: "WA", zip: "98033" },
  job: { title: "QA Fixture Job — fence repair", status: "COMPLETED", startsAt: new Date("2026-01-15T17:00:00Z"), endsAt: new Date("2026-01-15T21:00:00Z") },
};

type Delegate = { deleteMany: (a: unknown) => Promise<{ count: number }> };

export type SeedResult = { orgId: string; removed: Record<string, number>; clientId: string; jobId: string; notes: string[] };

export async function resetQaCo(): Promise<SeedResult> {
  const db = prisma();
  const org = await db.organization.findUnique({ where: { slug: QA_ORG_SLUG }, select: { id: true, slug: true } });
  if (!org) throw new Error('QA seed: no organisation "QA Co" (slug qa-co) in this database');
  const owner = await db.membership.findFirst({ where: { organizationId: org.id, role: "OWNER", user: { email: "qa@acme.test" } } });
  if (!owner) throw new Error("QA seed: qa@acme.test is not the OWNER of QA Co — refusing to touch this organisation");

  const d = db as unknown as Record<string, Delegate>;
  const removed: Record<string, number> = {};
  const notes: string[] = [];
  const del = async (model: string, where: Record<string, unknown>) => {
    try {
      const r = await d[model].deleteMany({ where });
      if (r.count) removed[model] = (removed[model] ?? 0) + r.count;
    } catch (e) {
      notes.push(`${model}: ${String((e as Error).message).replace(/\s+/g, " ").slice(0, 160)}`);
    }
  };
  const inOrg = { organizationId: org.id };
  const ofOrgJob = { job: inOrg };

  // the calendar, the forms suite's rows, team noise
  await del("followUpRule", inOrg);
  await del("appointmentAssignment", { appointment: inOrg });
  await del("appointment", inOrg);
  await del("jobEvent", inOrg);
  await del("applicant", inOrg);
  await del("invite", inOrg);
  await del("conversation", inOrg); // participants and messages cascade
  await del("activityEvent", inOrg);
  await del("subscription", inOrg);
  // jobs and clients: their children first (required relations do not cascade)
  for (const m of ["jobAssignment", "jobPhoto", "jobExpense", "workDay", "jobMessage", "changeOrder", "reviewRequest"]) await del(m, ofOrgJob);
  await del("reviewRequest", inOrg);
  await del("job", inOrg);
  await del("client", inOrg);
  // the old page scripts' throwaway teammates (qa/tests/_lib/_world.js TEAM, mobile-sweep): their seats in QA Co
  const keep = ["qa@acme.test", ...Object.values(DEFAULT_USERS).filter(Boolean)].map((e) => String(e).toLowerCase());
  const seats = await db.membership.findMany({ where: { organizationId: org.id, user: { email: { endsWith: "@qa.test" } } }, select: { id: true, user: { select: { email: true } } } });
  const drop = seats.filter((s) => !keep.includes(s.user.email.toLowerCase())).map((s) => s.id);
  if (drop.length) await del("membership", { id: { in: drop } });

  const client = await db.client.create({ data: { organizationId: org.id, ...FIXTURE.client } });
  const job = await db.job.create({ data: { organizationId: org.id, clientId: client.id, ...FIXTURE.job } });
  return { orgId: org.id, removed, clientId: client.id, jobId: job.id, notes };
}

/** One line for the console and the run's notes. */
export function seedLine(r: SeedResult): string {
  const gone = Object.entries(r.removed).map(([k, v]) => `${k} ${v}`).join(", ");
  return `QA Co reset: ${gone ? `removed ${gone}; ` : ""}fixture client + job in place${r.notes.length ? ` (not removed: ${r.notes.join("; ")})` : ""}`;
}
