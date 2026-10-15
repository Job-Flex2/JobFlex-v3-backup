// The admin task tracker (/admin/tasks, 2026-10-11) — data-level check.
//
//   npx tsx --tsconfig tsconfig.json qa/tests/logic/admin-tasks.check.ts
//
// No browser, no network. The pure rules (lib/adminTasks/model, filters) on
// made-up rows, then the service (lib/adminTasks/service) against dev.db with
// throwaway admins and a throwaway organisation for the support ticket — all
// removed at the end, pass or fail. Mail is never sent here: the service only
// decides who would hear of a change; the action layer sends.
//
// Covered:
//   1. progress (subtasks, else the status), overdue, links, days, names
//   2. who is emailed: the new assignee / the author on close — never the
//      actor, never the console's shared login
//   3. the address: parse ⇄ serialize, each filter, combinations, the sorts
//   4. the tiles: open, in progress, overdue, done in the last 7 days
//   5. writes: one field each, journal entries with the old and new words,
//      closedAt set on Done/Canceled and cleared on reopen, refusals
//   6. subtasks: add, check, rename, assign, reorder (a stale order refused),
//      remove; comments; every write moves the task's updatedAt
//   7. the live feed: only what changed after `since`, the open task in full
//   8. from a support ticket: Support task with a link back; twice at once → one
//   9. access: every action and the changes route ask requirePlatformAdmin
//  10. the production SQL only adds
//  11. without the task tables (production before the SQL, a dev server's old
//      client): the nav badge reads 0, /admin/support keeps its tickets and
//      hides "Create task", /admin/tasks says it is not set up — on a real copy
//      of dev.db with the four tables dropped, and on a stand-in old client
import "../_lib/_server-only";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

for (const k of ["SMTP_HOST", "SMTP_USER", "RESEND_API_KEY"]) process.env[k] = "";

import { db } from "../../../src/lib/db";
import * as svc from "../../../src/lib/adminTasks/service";
import {
  cleanLink,
  dayLabel,
  emailsAssignee,
  emailsAuthorOnClose,
  eventWords,
  isDay,
  isOverdue,
  personName,
  progressOf,
  rowFromDetail,
  taskPath,
  type TaskRowDTO,
} from "../../../src/lib/adminTasks/model";
import {
  activeFilterCount,
  addDays,
  applyFilters,
  countTasks,
  defaultFilters,
  parseFilters,
  serializeFilters,
  sortRows,
  utcDayOf,
} from "../../../src/lib/adminTasks/filters";

const ROOT = join(__dirname, "..", "..", "..");
const TAG = "qa-admin-tasks";
let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
async function refuses(p: Promise<unknown>, text: RegExp): Promise<boolean> {
  try {
    await p;
    return false;
  } catch (e) {
    return e instanceof svc.TaskError && text.test(e.message);
  }
}

// ── 1. pure rules ──────────────────────────────────────────────────
const P = (status: string, done: number, total: number) => progressOf({ status, subtasksDone: done, subtasksTotal: total });
check("progress from subtasks: 3 / 5, partial", P("TODO", 3, 5).label === "3 / 5" && P("TODO", 3, 5).band === "partial" && Math.abs(P("TODO", 3, 5).ratio - 0.6) < 1e-9);
check("progress from subtasks: none done / all done", P("IN_PROGRESS", 0, 4).band === "none" && P("TODO", 4, 4).band === "done" && P("TODO", 4, 4).ratio === 1);
check("progress without subtasks follows the status", P("TODO", 0, 0).band === "none" && P("IN_PROGRESS", 0, 0).band === "partial" && P("BLOCKED", 0, 0).band === "partial" && P("DONE", 0, 0).band === "done" && P("CANCELED", 0, 0).band === "none" && P("DONE", 0, 0).label === "Done");
check("overdue: open and due before today only", isOverdue({ status: "TODO", dueDate: "2026-10-10" }, "2026-10-11") && !isOverdue({ status: "TODO", dueDate: "2026-10-11" }, "2026-10-11") && !isOverdue({ status: "DONE", dueDate: "2026-10-01" }, "2026-10-11") && !isOverdue({ status: "BLOCKED", dueDate: null }, "2026-10-11"));
check("links: app paths and http(s) kept, the rest refused", cleanLink(" /admin/support?ticket=1 ") === "/admin/support?ticket=1" && cleanLink("https://x.com/a") === "https://x.com/a" && cleanLink("") === "" && cleanLink("javascript:alert(1)") === null && cleanLink("//evil.com") === null && cleanLink("ftp://x") === null);
check("days: real calendar days only", isDay("2026-02-28") && !isDay("2026-02-30") && !isDay("2026-13-01") && !isDay("26-01-01") && dayLabel("2026-10-14", 2026) === "Oct 14" && dayLabel("2027-01-02", 2026) === "Jan 2, 2027");
check("names: the console login reads as Console, a blank name as the address", personName({ email: "admin@platform.jobflex.local", name: "Platform admin" }) === "Console" && personName({ email: "a@b.c", name: "  " }) === "a@b.c" && personName(null) === "Someone");
check("every journal kind reads as words", ["CREATED", "TITLE", "STATUS", "PRIORITY", "ASSIGNEE", "DUE", "CATEGORY", "DESCRIPTION", "LINK", "SUBTASK_ADDED", "SUBTASK_DONE", "SUBTASK_REOPENED", "SUBTASK_RENAMED", "SUBTASK_REMOVED", "SUBTASK_ASSIGNED"].every((k) => !/undefined|null|changed the task/.test(eventWords({ kind: k, from: "A", to: "B" }))) && eventWords({ kind: "ASSIGNEE", from: "Ana", to: null }) === "unassigned Ana");
check("the deep link", taskPath("abc") === "/admin/tasks?task=abc");

// ── 2. who hears of it ─────────────────────────────────────────────
const ana = { id: "u_ana", email: "ana@x.test" };
const con = { id: "u_con", email: "admin@platform.jobflex.local" };
check("assignee emailed when someone else assigns them", emailsAssignee(null, ana, "u_ben") && emailsAssignee("u_ben", ana, "u_ben"));
check("assignee not emailed: themselves, unchanged, console, nobody", !emailsAssignee(null, ana, "u_ana") && !emailsAssignee("u_ana", ana, "u_ben") && !emailsAssignee(null, con, "u_ben") && !emailsAssignee("u_ana", null, "u_ben"));
check("author emailed when someone else closes their task", emailsAuthorOnClose("IN_PROGRESS", "DONE", ana, "u_ben") && emailsAuthorOnClose("TODO", "CANCELED", ana, "u_ben"));
check("author not emailed: closed it themselves, already closed, reopened, console", !emailsAuthorOnClose("TODO", "DONE", ana, "u_ana") && !emailsAuthorOnClose("DONE", "CANCELED", ana, "u_ben") && !emailsAuthorOnClose("DONE", "TODO", ana, "u_ben") && !emailsAuthorOnClose("TODO", "DONE", con, "u_ben"));

// ── 3–4. filters, sorts, tiles ─────────────────────────────────────
const row = (p: Partial<TaskRowDTO>): TaskRowDTO => ({
  id: p.id ?? Math.random().toString(36).slice(2),
  title: "t", description: "", priority: "NORMAL", status: "TODO", category: "OTHER",
  assigneeId: null, assigneeName: null, authorId: null, authorName: "x", dueDate: null, linkUrl: null, supportTicketId: null,
  createdAt: "2026-10-05T12:00:00.000Z", updatedAt: "2026-10-05T12:00:00.000Z", closedAt: null,
  subtasksDone: 0, subtasksTotal: 0, comments: 0, ...p,
});
const ROWS = [
  row({ id: "a", title: "Stripe retries", priority: "URGENT", status: "IN_PROGRESS", category: "BUG", assigneeId: "me", dueDate: "2026-10-09", subtasksDone: 1, subtasksTotal: 3, createdAt: "2026-10-01T12:00:00.000Z", updatedAt: "2026-10-11T09:00:00.000Z" }),
  row({ id: "b", title: "Investor update", description: "numbers for October", priority: "HIGH", assigneeId: "me", dueDate: "2026-10-15", subtasksDone: 5, subtasksTotal: 5, createdAt: "2026-10-03T12:00:00.000Z" }),
  row({ id: "c", title: "Logo limit", priority: "NORMAL", status: "BLOCKED", category: "SUPPORT", dueDate: "2026-10-12", createdAt: "2026-10-10T12:00:00.000Z" }),
  row({ id: "d", title: "CSV export", priority: "LOW", category: "FEATURE", assigneeId: "ben", createdAt: "2026-10-11T12:00:00.000Z", updatedAt: "2026-10-11T12:00:00.000Z" }),
  row({ id: "e", title: "Rotate token", status: "DONE", closedAt: "2026-10-10T12:00:00.000Z", createdAt: "2026-09-01T12:00:00.000Z" }),
  row({ id: "f", title: "Old test", status: "CANCELED", closedAt: "2026-09-20T12:00:00.000Z" }),
  row({ id: "g", title: "Shipped long ago", status: "DONE", closedAt: "2026-09-01T12:00:00.000Z" }),
];
const ids = (qs: string) => {
  const f = parseFilters(new URLSearchParams(qs));
  return sortRows(applyFilters(ROWS, f, { meId: "me", dayOf: utcDayOf }), f.sort, f.dir).map((r) => r.id).join("");
};
check("default: Active, priority first", ids("") === "abcd");
// e, f, g share one updatedAt: the tie falls to the newest created (f, g), then the id.
check("Archive: Done and Canceled only, in a stable order", ids("tab=archive") === "fge", ids("tab=archive"));
check("priority, status, category filters", ids("pri=HIGH") === "b" && ids("st=BLOCKED") === "c" && ids("cat=SUPPORT") === "c" && ids("tab=archive&st=CANCELED") === "f");
check("assignee: me, unassigned, a person", ids("who=me") === "ab" && ids("who=none") === "c" && ids("who=ben") === "d");
// c is Blocked with no subtasks: under way, by its status.
check("progress bands", ids("prog=none") === "d" && ids("prog=partial") === "ac" && ids("prog=done") === "b", [ids("prog=none"), ids("prog=partial"), ids("prog=done")].join(" "));
check("created from–to, inclusive", ids("from=2026-10-03&to=2026-10-10") === "bc" && ids("from=2026-10-11") === "d" && ids("to=2026-10-01") === "a");
check("search: title and description, any case", ids("q=STRIPE") === "a" && ids("q=october") === "b" && ids("q=zzz") === "");
check("combinations", ids("who=me&prog=done") === "b" && ids("pri=URGENT&cat=BUG&st=IN_PROGRESS") === "a" && ids("pri=URGENT&cat=FEATURE") === "");
check("sort by due: soonest first, no due day last either way", ids("sort=due&dir=asc") === "acbd" && ids("sort=due&dir=desc") === "bcad");
check("sort by created and by last change", ids("sort=created&dir=asc") === "abcd" && ids("sort=created&dir=desc") === "dcba" && ids("sort=updated&dir=desc").startsWith("da"));
check("a status from the other tab is dropped", parseFilters(new URLSearchParams("st=DONE")).st === "" && parseFilters(new URLSearchParams("tab=archive&st=TODO")).st === "");
check("junk in the address is ignored", JSON.stringify(parseFilters(new URLSearchParams("pri=NOPE&prog=x&from=2026-99-99&sort=evil&dir=up&who=a b"))) === JSON.stringify(defaultFilters()));
const full = parseFilters(new URLSearchParams("tab=archive&q=x&pri=LOW&who=none&st=DONE&prog=done&cat=BUG&from=2026-10-01&to=2026-10-02&sort=due&dir=desc"));
check("parse ⇄ serialize round trip", JSON.stringify(parseFilters(new URLSearchParams(serializeFilters(full)))) === JSON.stringify(full) && serializeFilters(defaultFilters()) === "" && serializeFilters(defaultFilters("archive")) === "tab=archive");
check("the open task rides in the address", serializeFilters(defaultFilters(), { task: "t1" }) === "task=t1");
check("filter count leaves out search, tab and sort", activeFilterCount(full) === 6 && activeFilterCount(parseFilters(new URLSearchParams("q=a&sort=due"))) === 0);
const c = countTasks(ROWS, "2026-10-11", utcDayOf);
check("tiles: open 4, in progress 1, overdue 1, done in 7 days 1", c.open === 4 && c.inProgress === 1 && c.overdue === 1 && c.doneWeek === 1 && c.archive === 3, JSON.stringify(c));
check("days move across months", addDays("2026-10-01", -1) === "2026-09-30" && addDays("2026-12-31", 1) === "2027-01-01");

// ── 5–9. the service on dev.db ─────────────────────────────────────
async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/^file:|localhost|127\.0\.0\.1/.test(url)) throw new Error("Refusing: DATABASE_URL is not a local dev database.");
  const stamp = Date.now();
  const mk = (n: string, admin = true) => db.user.create({ data: { email: `${TAG}-${n}-${stamp}@admin-tasks.test`, name: `QA ${n}`, isPlatformAdmin: admin } });
  const A = await mk("ana");
  const B = await mk("ben");
  const N = await mk("notadmin", false);
  const C = await db.user.create({ data: { email: `${TAG}-${stamp}@platform.jobflex.local`, name: "Platform admin", isPlatformAdmin: true } });
  const org = await db.organization.create({ data: { name: `${TAG} org`, slug: `${TAG}-${stamp}` } });
  const users = [A.id, B.id, N.id, C.id];
  try {
    const t0 = new Date(Date.now() - 1);
    const made = await svc.createTask(A, { title: "  Fix   the  webhook ", assigneeId: B.id, priority: "HIGH", dueDate: "2026-10-20", linkUrl: "/admin/support" });
    const id = made.task.id;
    check("create: title tidied, fields kept, author set", made.task.title === "Fix the webhook" && made.task.priority === "HIGH" && made.task.assigneeId === B.id && made.task.dueDate === "2026-10-20" && made.task.authorId === A.id && made.task.status === "TODO");
    check("create: journal says created + assigned; assignee notified", made.task.feed.map((f) => (f.type === "event" ? f.kind : "c")).join() === "CREATED,ASSIGNEE" && made.notices.length === 1 && made.notices[0].kind === "assigned" && made.notices[0].to.email === B.email);
    check("create: an empty title is refused", await refuses(svc.createTask(A, { title: "   " }), /can't be empty/));
    check("create: a closed status is refused", await refuses(svc.createTask(A, { title: "x", status: "DONE" }), /starts open/));

    const u1 = await svc.updateTaskField(B, id, "priority", "URGENT");
    const pe = u1.task.feed.at(-1);
    check("one field: priority, journal from → to in words", u1.task.priority === "URGENT" && pe?.type === "event" && pe.kind === "PRIORITY" && pe.from === "High" && pe.to === "Urgent" && pe.actorId === B.id);
    const same = await svc.updateTaskField(B, id, "priority", "URGENT");
    check("the same value again writes nothing", same.task.feed.length === u1.task.feed.length && same.task.updatedAt === u1.task.updatedAt);
    // Different fields by two admins: neither undoes the other.
    await Promise.all([svc.updateTaskField(A, id, "category", "BUG"), svc.updateTaskField(B, id, "dueDate", "2026-11-01")]);
    const both = (await svc.getTaskDetail(id))!;
    check("two fields at once both stick", both.category === "BUG" && both.dueDate === "2026-11-01" && both.priority === "URGENT");
    check("refusals: bad priority, status, day, link, a non-admin or the console as assignee", (await refuses(svc.updateTaskField(A, id, "priority", "MAX"), /priority/)) && (await refuses(svc.updateTaskField(A, id, "status", "OPEN"), /status/)) && (await refuses(svc.updateTaskField(A, id, "dueDate", "2026-02-30"), /real day/)) && (await refuses(svc.updateTaskField(A, id, "linkUrl", "javascript:x"), /link/)) && (await refuses(svc.updateTaskField(A, id, "assigneeId", N.id), /can't be given tasks/)) && (await refuses(svc.updateTaskField(A, id, "assigneeId", C.id), /can't be given tasks/)));
    const self = await svc.updateTaskField(A, id, "assigneeId", A.id);
    check("assigning yourself: journal yes, email no", self.notices.length === 0 && self.task.feed.at(-1)?.type === "event" && (self.task.feed.at(-1) as { to: string }).to === "QA ana");
    const un = await svc.updateTaskField(A, id, "assigneeId", null);
    check("unassign", un.task.assigneeId === null && un.task.assigneeName === null);

    // Subtasks
    let w = await svc.addSubtask(A, id, "One");
    w = await svc.addSubtask(B, id, "Two");
    w = await svc.addSubtask(A, id, "Three");
    const [s1, s2, s3] = w.task.subtasks;
    check("subtasks added in order", w.task.subtasks.map((s) => s.title).join() === "One,Two,Three");
    const before = w.task.updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    w = await svc.updateSubtask(B, s1.id, { done: true });
    check("checking a subtask moves the task's updatedAt and the progress", w.task.updatedAt > before && rowFromDetail(w.task).subtasksDone === 1 && rowFromDetail(w.task).subtasksTotal === 3);
    w = await svc.updateSubtask(A, s2.id, { title: "Two, renamed" });
    w = await svc.updateSubtask(A, s3.id, { assigneeId: B.id });
    check("rename and assign a subtask", w.task.subtasks[1].title === "Two, renamed" && w.task.subtasks[2].assigneeId === B.id);
    check("a subtask can't go to the console", await refuses(svc.updateSubtask(A, s3.id, { assigneeId: C.id }), /can't be given tasks/));
    w = await svc.reorderSubtasks(A, id, [s3.id, s1.id, s2.id]);
    check("reorder", w.task.subtasks.map((s) => s.id).join() === [s3.id, s1.id, s2.id].join());
    check("a stale order is refused", await refuses(svc.reorderSubtasks(A, id, [s1.id, s2.id]), /changed meanwhile/));
    w = await svc.removeSubtask(B, s2.id);
    check("remove", w.task.subtasks.length === 2 && (await refuses(svc.updateSubtask(A, s2.id, { done: true }), /removed/)));
    w = await svc.addComment(B, id, "  Looks good — https://example.com  ");
    check("comment trimmed, in the feed, counted", w.task.feed.some((f) => f.type === "comment" && f.body === "Looks good — https://example.com" && f.actorId === B.id) && rowFromDetail(w.task).comments === 1);
    check("an empty comment is refused", await refuses(svc.addComment(B, id, "  "), /Write something/));
    const kinds = w.task.feed.filter((f) => f.type === "event").map((f) => (f as { kind: string }).kind);
    check("journal holds every change", ["SUBTASK_ADDED", "SUBTASK_DONE", "SUBTASK_RENAMED", "SUBTASK_ASSIGNED", "SUBTASK_REMOVED", "CATEGORY", "DUE"].every((k) => kinds.includes(k)), kinds.join());

    // Close, archive, reopen
    const closedByB = await svc.updateTaskField(B, id, "status", "DONE");
    check("done by someone else: closedAt set, author notified", !!closedByB.task.closedAt && closedByB.notices.length === 1 && closedByB.notices[0].kind === "closed" && closedByB.notices[0].to.email === A.email);
    const cancel = await svc.updateTaskField(B, id, "status", "CANCELED");
    check("done → canceled keeps the closed date, no second email", cancel.task.closedAt === closedByB.task.closedAt && cancel.notices.length === 0);
    const reopened = await svc.updateTaskField(A, id, "status", "TODO");
    check("reopen clears the closed date", reopened.task.closedAt === null && reopened.task.status === "TODO");

    // Live feed
    const other = await svc.createTask(B, { title: "Another" });
    const ch = await svc.changesSince(t0, id);
    check("changes since: both tasks, the open one in full", ch.rows.some((r) => r.id === id) && ch.rows.some((r) => r.id === other.task.id) && ch.detail?.id === id && ch.detail.subtasks.length === 2);
    const later = await svc.changesSince(new Date(ch.now), id);
    check("nothing changed since → nothing returned", later.rows.length === 0 && later.detail === null);
    await svc.addComment(A, other.task.id, "ping");
    const after = await svc.changesSince(new Date(later.now), id);
    check("a comment on another task returns that row only, no detail", after.rows.length === 1 && after.rows[0].id === other.task.id && after.rows[0].comments === 1 && after.detail === null);
    check("the console's task is authored by Console", (await svc.createTask(C, { title: "From the console" })).task.authorName === "Console");
    check("assignable admins: no console, no non-admin", (await svc.assignableAdmins()).every((p) => !p.email.endsWith("@platform.jobflex.local")) && !(await svc.assignableAdmins()).some((p) => p.id === N.id));
    check("my open tasks count", (await svc.myOpenTaskCount(B.id)) === 0 && (await svc.updateTaskField(A, other.task.id, "assigneeId", B.id)) && (await svc.myOpenTaskCount(B.id)) === 1);

    // From a support ticket
    const ticket = await db.supportTicket.create({ data: { organizationId: org.id, subject: "Logo too large", body: "20 MB PNG", priority: "high" } });
    const [t1, t2] = await Promise.all([svc.createTaskFromTicket(A, ticket.id), svc.createTaskFromTicket(B, ticket.id)]);
    const count = await db.adminTask.count({ where: { supportTicketId: ticket.id } });
    check("ticket → one task even when pressed twice at once", count === 1 && t1.task.id === t2.task.id && [t1.existed, t2.existed].filter(Boolean).length === 1);
    check("ticket task: Support, High, subject, message, link back", t1.task.category === "SUPPORT" && t1.task.priority === "HIGH" && t1.task.title === "Logo too large" && t1.task.description.startsWith("20 MB PNG") && t1.task.linkUrl === `/admin/support?ticket=${ticket.id}`);
    check("tasks for tickets", (await svc.tasksForTickets([ticket.id]))[ticket.id]?.id === t1.task.id);
  } finally {
    await db.adminTask.deleteMany({ where: { authorId: { in: users } } });
    await db.supportTicket.deleteMany({ where: { organizationId: org.id } });
    await db.organization.delete({ where: { id: org.id } });
    await db.user.deleteMany({ where: { id: { in: users } } });
  }

  // ── 9. access ──
  const actions = readFileSync(join(ROOT, "src/actions/adminTasks.ts"), "utf8");
  const exported = [...actions.matchAll(/export async function (\w+)\(([^)]*)\)[^{]*\{([\s\S]*?)\n\}/g)];
  check("every action asks for a platform admin first", exported.length === 9 && exported.every(([, , , body]) => /asAdmin\(\)|run\(/.test(body)) && /requirePlatformAdmin\(\)/.test(actions), exported.map((m) => m[1]).join());
  const route = readFileSync(join(ROOT, "src/app/api/admin/tasks/changes/route.ts"), "utf8");
  check("the changes route asks before reading", route.indexOf("requirePlatformAdmin()") > -1 && route.indexOf("requirePlatformAdmin()") < route.indexOf("changesSince(") && /status: forbidden \? 403 : 401/.test(route));
  const page = readFileSync(join(ROOT, "src/app/(admin)/admin/tasks/page.tsx"), "utf8");
  check("the page asks too", page.indexOf("requirePlatformAdmin()") > -1 && page.indexOf("requirePlatformAdmin()") < page.indexOf("loadTasksPage("));

  // ── 11. no task tables: the console keeps working ──
  await withoutTaskTables(page);

  // ── 10. the production SQL only adds ──
  const sql = readFileSync(join(ROOT, "prisma/sql/prod-2026-10-11-admin-tasks.sql"), "utf8").replace(/--.*$/gm, "");
  check("prod SQL: no DROP, no RENAME, no ALTER COLUMN, no UPDATE/DELETE, only AdminTask* tables touched", !/\bDROP\b|\bRENAME\b|ALTER\s+COLUMN|\bUPDATE\s+"|DELETE\s+FROM|TRUNCATE/i.test(sql) && [...sql.matchAll(/(?:TABLE(?: IF NOT EXISTS)?|ON|ALTER TABLE)\s+"(\w+)"/g)].every((m) => m[1].startsWith("AdminTask")));
}

async function withoutTaskTables(tasksPage: string) {
  const err = (code: string | undefined, message: string, meta?: unknown) => Object.assign(new Error(message), { code, meta });
  check("missing-table errors are recognised: Prisma P2021, SQLite, Postgres, an old client", svc.trackerMissing(err("P2021", "The table `main.AdminTask` does not exist in the current database.", { table: "main.AdminTask" })) && svc.trackerMissing(new Error("no such table: main.AdminTaskEvent")) && svc.trackerMissing(new Error('relation "AdminTask" does not exist')) && svc.trackerMissing(new TypeError("Cannot read properties of undefined (reading 'count')")));
  check("other errors are not mistaken for it", !svc.trackerMissing(err("P2021", "The table `main.User` does not exist", { table: "main.User" })) && !svc.trackerMissing(new Error("Can't reach database server")) && !svc.trackerMissing(new TypeError("x is not a function")));

  // A real database without the tables: a copy of dev.db, the four dropped.
  const dir = mkdtempSync(join(tmpdir(), "jf-admin-tasks-"));
  const copy = join(dir, "no-tasks.db").replace(/\\/g, "/");
  await db.$executeRawUnsafe(`VACUUM INTO '${copy}'`);
  const bare = new PrismaClient({ datasources: { db: { url: `file:${copy}` } } });
  try {
    for (const t of ["AdminTaskEvent", "AdminTaskComment", "AdminTaskSubtask", "AdminTask"]) await bare.$executeRawUnsafe(`DROP TABLE IF EXISTS "${t}"`);
    const client = bare as unknown as typeof db;
    const anyAdmin = await bare.user.findFirst({ where: { isPlatformAdmin: true }, select: { id: true } });
    const quiet = console.error;
    console.error = () => {};
    try {
      check("no tables: the nav badge reads 0", (await svc.myOpenTaskCountSafe(anyAdmin?.id ?? "x", client)) === 0);
      const sup = await svc.tasksForTicketsSafe(["t1"], client);
      check("no tables: support gets no task links and hides Create task", sup.available === false && Object.keys(sup.tasks).length === 0);
      check("no tables: /admin/tasks reads 'missing', not an error", (await svc.loadTasksPage(null, client)).status === "missing" && (await svc.loadTasksPage("some-id", client)).status === "missing");
      // An old generated client: no `adminTask` on it at all.
      const old = { user: bare.user } as unknown as typeof db;
      check("old client: badge 0, support unavailable, page missing", (await svc.myOpenTaskCountSafe("x", old)) === 0 && (await svc.tasksForTicketsSafe([], old)).available === false && (await svc.loadTasksPage(null, old)).status === "missing");
      // Anything else still surfaces.
      const down = { adminTask: { findMany: () => Promise.reject(new Error("Can't reach database server")), findUnique: () => Promise.resolve(null) }, user: bare.user } as unknown as typeof db;
      let threw = false;
      try {
        await svc.loadTasksPage(null, down);
      } catch {
        threw = true;
      }
      check("a database that is down is not dressed up as 'not set up'", threw);
    } finally {
      console.error = quiet;
    }
    check("with the tables: ready, badge counts, support available", (await svc.loadTasksPage(null)).status === "ready" && (await svc.tasksForTicketsSafe([])).available === true);
  } finally {
    await bare.$disconnect();
    rmSync(dir, { recursive: true, force: true });
  }

  // The three places use the safe readers.
  const layout = readFileSync(join(ROOT, "src/app/(admin)/layout.tsx"), "utf8");
  const support = readFileSync(join(ROOT, "src/app/(admin)/admin/support/page.tsx"), "utf8");
  const supportUi = readFileSync(join(ROOT, "src/components/v3/admin-support/admin-support-content.tsx"), "utf8");
  check("the admin layout counts with myOpenTaskCountSafe", /myOpenTaskCountSafe\(admin\.id\)/.test(layout) && !/myOpenTaskCount\(/.test(layout));
  check("/admin/support reads with tasksForTicketsSafe and gates Create task on it", /tasksForTicketsSafe\(/.test(support) && /tasksAvailable=\{tasksAvailable\}/.test(support) && /\{tasksAvailable \? \(/.test(supportUi));
  check("/admin/tasks shows TasksUnavailable when missing", /status === "missing"\) return <TasksUnavailable \/>/.test(tasksPage));
}

main()
  .catch((e) => {
    bad++;
    console.error(e);
  })
  .finally(async () => {
    await db.$disconnect();
    console.log(bad ? `${bad} FAILED` : "admin tasks: all checks passed");
    process.exit(bad ? 1 : 0);
  });
