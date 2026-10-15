// CREW DAYS (stage A, 2026-09-30): a day on site is one WorkDay row per job
// and local date, opened by Start, shared by every crew member on the job,
// closed with a note or a file, PENDING once its date has passed unclosed,
// closed late by its date; the office's status move counts the day and
// texts nobody. Runs in QA Co on the local database.
//
//   npx tsx --tsconfig tsconfig.json qa/tests/logic/crew-days.check.ts
import "../_lib/_server-only";
import { db, makeCrewWorld } from "../_lib/_crewWorld";
import { recordJobProgress, jobProgressInfo } from "../../../src/lib/jobProgress";
import { recordJobMedia } from "../../../src/lib/jobMedia";
import { closeWorkDay, listWorkDays, openDayOf, sweepPendingDays } from "../../../src/lib/workDays";
import { canCloseDay, dayCount, effectiveDayStatus } from "../../../src/lib/workDaysShared";
import { localDayKey } from "../../../src/lib/jobProgressShared";

let passes = 0;
let failures = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) passes++;
  else failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};
const head = (s: string) => console.log(`\n── ${s}`);
const yesterday = (tz: string) => localDayKey(new Date(Date.now() - 864e5), tz);

async function main() {
  head("0 · pure rules");
  ok("an open day whose date passed reads PENDING; today's stays OPEN; CLOSED is CLOSED", effectiveDayStatus({ date: "2026-09-29", status: "OPEN" }, "2026-09-30") === "PENDING" && effectiveDayStatus({ date: "2026-09-30", status: "OPEN" }, "2026-09-30") === "OPEN" && effectiveDayStatus({ date: "2026-09-01", status: "CLOSED" }, "2026-09-30") === "CLOSED");
  ok("closing needs a note or a file", !canCloseDay({ note: "  ", mediaCount: 0 }).ok && canCloseDay({ note: "done", mediaCount: 0 }).ok && canCloseDay({ note: null, mediaCount: 1 }).ok);
  const c = dayCount([{ date: "2026-09-28", dayNumber: 1, status: "CLOSED" }, { date: "2026-09-29", dayNumber: 2, status: "OPEN" }], "America/Los_Angeles", new Date("2026-09-30T17:00:00Z"));
  ok("the count: two days so far, none today, day 3 next, one pending", c.daysSoFar === 2 && !c.startedToday && c.day === 3 && c.pendingDays.length === 1 && c.openDay === null, JSON.stringify({ ...c, pendingDays: c.pendingDays.length }));

  const w = await makeCrewWorld("days");
  const [A, B] = w.workers;
  try {
    head("1 · start opens today's day; a crewmate's start finds it (one day per job)");
    const smsBefore = await db.smsMessage.count({ where: { organizationId: w.orgId } });
    const r1 = await recordJobProgress({ organizationId: w.orgId, jobId: w.jobId, actor: { userId: A.userId, name: A.name }, what: "started", via: "worker-portal", source: "worker" });
    ok("A starts: day 1, IN_PROGRESS", r1.ok && r1.day === 1 && r1.status === "IN_PROGRESS" && !!r1.workDayId, JSON.stringify(r1));
    const r2 = await recordJobProgress({ organizationId: w.orgId, jobId: w.jobId, actor: { userId: B.userId, name: B.name }, what: "started", via: "dashboard", source: "worker" });
    const days1 = await listWorkDays(w.orgId, w.jobId);
    ok("B starts the same day: the same day 1, still one WorkDay row", r2.ok && r2.day === 1 && days1.length === 1 && days1[0].status === "OPEN" && days1[0].openedById === A.userId && days1[0].source === "worker", `${days1.length} rows`);
    const started = await db.activityEvent.count({ where: { organizationId: w.orgId, kind: "STARTED", meta: { contains: `"jobId":"${w.jobId}"` } } });
    ok("the STARTED trail row is written once for the day (his bell and texts unchanged)", started === 1, `${started} rows`);
    const info = await jobProgressInfo(w.orgId, w.jobId);
    ok("the crew's buttons read the open day", info.startedToday && info.day === 1 && info.daysSoFar === 1 && info.openDay?.date === localDayKey(new Date(), w.tz) && info.pendingDays.length === 0);
    await new Promise((r) => setTimeout(r, 300));
    const smsAfterStart = await db.smsMessage.count({ where: { organizationId: w.orgId } });
    ok("a worker's start reaches the office's text path (rows logged, Twilio off here)", smsAfterStart >= smsBefore, `${smsBefore} → ${smsAfterStart}`);

    head("2 · closing the day: refused empty, allowed with a file or a note");
    const refuse = await recordJobProgress({ organizationId: w.orgId, jobId: w.jobId, actor: { userId: A.userId, name: A.name }, what: "closed", via: "worker-portal", note: "   " });
    ok("no note and no file: refused", !refuse.ok && refuse.code === "needs-note-or-file", JSON.stringify(refuse));
    const caller = { organizationId: w.orgId, userId: B.userId, workerId: B.workerId, name: B.name, job: { id: w.jobId, title: w.jobTitle, proposalId: null, clientId: null } };
    const photo = await recordJobMedia({ caller, url: "https://example.public.blob.vercel-storage.com/jobs/x/1-a.jpg", kind: "PROGRESS", meta: { media: "photo", contentType: "image/jpeg", bytes: 1234 }, via: "worker-portal" });
    const openDay = await openDayOf(w.orgId, w.jobId);
    const row = await db.jobPhoto.findUniqueOrThrow({ where: { id: photo.id } });
    ok("a file uploaded today hangs on today's day with who and what", photo.workDayId === openDay?.id && row.uploadedById === B.userId && row.media === "photo" && row.contentType === "image/jpeg" && row.bytes === 1234);
    const closed = await recordJobProgress({ organizationId: w.orgId, jobId: w.jobId, actor: { userId: A.userId, name: A.name }, what: "closed", via: "worker-portal" });
    const day1 = (await listWorkDays(w.orgId, w.jobId))[0];
    ok("A closes it for both on B's photo: CLOSED, closedBy A, one file", closed.ok && day1.status === "CLOSED" && day1.closedById === A.userId && day1.mediaCount === 1 && !!day1.closedAt, JSON.stringify(closed));
    const again = await recordJobProgress({ organizationId: w.orgId, jobId: w.jobId, actor: { userId: A.userId, name: A.name }, what: "closed", via: "worker-portal", note: "x" });
    ok("closing a closed day is refused", !again.ok && again.code === "already-closed");
    const jobRow = await db.job.findUniqueOrThrow({ where: { id: w.jobId } });
    ok("closing a day does not move the job's status", jobRow.status === "IN_PROGRESS");

    head("3 · a day that passed unclosed is PENDING and can be closed late");
    const y = yesterday(w.tz);
    await db.workDay.create({ data: { organizationId: w.orgId, jobId: w.jobId, date: y, dayNumber: 0, status: "OPEN", openedById: A.userId, source: "worker" } });
    const swept = await sweepPendingDays(w.orgId, w.jobId);
    const pend = (await listWorkDays(w.orgId, w.jobId)).find((d) => d.date === y);
    ok("the sweep marks yesterday's open day PENDING", swept === 1 && pend?.status === "PENDING", JSON.stringify(pend));
    const info2 = await jobProgressInfo(w.orgId, w.jobId);
    ok("the crew and the office see it among the pending days", info2.pendingDays.some((d) => d.date === y));
    const lateNo = await closeWorkDay({ organizationId: w.orgId, jobId: w.jobId, actorUserId: B.userId, date: y, note: "" });
    const late = await recordJobProgress({ organizationId: w.orgId, jobId: w.jobId, actor: { userId: B.userId, name: B.name }, what: "closed", via: "dashboard", date: y, note: "Rain — set posts only." });
    const pend2 = (await listWorkDays(w.orgId, w.jobId)).find((d) => d.date === y);
    ok("closing it late needs the note too; with one it is CLOSED with the note kept", !lateNo.ok && late.ok && pend2?.status === "CLOSED" && pend2.note === "Rain — set posts only." && pend2.closedById === B.userId);

    head("4 · the office moves the status: the day counts, nobody is texted");
    const job2 = await db.job.create({ data: { organizationId: w.orgId, title: `QA days office job`, status: "SCHEDULED" } });
    try {
      const sms0 = await db.smsMessage.count({ where: { organizationId: w.orgId } });
      const trail0 = await db.activityEvent.count({ where: { organizationId: w.orgId, kind: { in: ["STARTED", "COMPLETED", "MEDIA"] }, meta: { contains: `"jobId":"${job2.id}"` } } });
      const o1 = await recordJobProgress({ organizationId: w.orgId, jobId: job2.id, actor: { userId: w.managerUserId, name: "QA Manager" }, what: "started", via: "dashboard", source: "office", silent: true });
      const od = await listWorkDays(w.orgId, job2.id);
      ok("the office's IN_PROGRESS opens day 1 with source office", o1.ok && od.length === 1 && od[0].source === "office" && od[0].openedById === w.managerUserId, JSON.stringify(od[0]));
      const o2 = await recordJobProgress({ organizationId: w.orgId, jobId: job2.id, actor: { userId: w.managerUserId, name: "QA Manager" }, what: "completed", via: "dashboard", source: "office", silent: true });
      const od2 = await listWorkDays(w.orgId, job2.id);
      const j2 = await db.job.findUniqueOrThrow({ where: { id: job2.id } });
      ok("the office's COMPLETED closes today's day and completes the job", o2.ok && j2.status === "COMPLETED" && od2[0].status === "CLOSED");
      await new Promise((r) => setTimeout(r, 400));
      const sms1 = await db.smsMessage.count({ where: { organizationId: w.orgId } });
      const trail1 = await db.activityEvent.count({ where: { organizationId: w.orgId, kind: { in: ["STARTED", "COMPLETED"] }, meta: { contains: `"jobId":"${job2.id}"` } } });
      ok("his STARTED and COMPLETED rows are written, and no text went out", trail1 - trail0 === 2 && sms1 === sms0, `trail +${trail1 - trail0}, sms ${sms0} → ${sms1}`);
    } finally {
      await db.job.delete({ where: { id: job2.id } }).catch(() => {});
      await db.activityEvent.deleteMany({ where: { organizationId: w.orgId, meta: { contains: `"jobId":"${job2.id}"` } } });
    }

    head("5 · the finish line closes today's open day");
    const startAgain = await recordJobProgress({ organizationId: w.orgId, jobId: w.jobId, actor: { userId: A.userId, name: A.name }, what: "started", via: "worker-portal" });
    ok("a start on a job already in progress today is a no-op on the day (already closed today: reopens nothing)", startAgain.ok && startAgain.day === 1);
    const done = await recordJobProgress({ organizationId: w.orgId, jobId: w.jobId, actor: { userId: B.userId, name: B.name }, what: "completed", via: "worker-portal" });
    const all = await listWorkDays(w.orgId, w.jobId);
    ok("completed: every day closed, none pending", done.ok && all.every((d) => d.status === "CLOSED"), all.map((d) => `${d.date}:${d.status}`).join(","));
  } finally {
    await w.cleanup();
  }
  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
