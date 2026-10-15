// The client portal: an acceptance is final for the client — through the REAL
// route handlers (accept / decline / revert), no browser, mail to the dev
// outbox only.
//
//   npx tsx --tsconfig tsconfig.json qa/tests/logic/portal-accept-final.check.ts
//
// The owner's rule (2026-09-23): after accepting, the client has no way to
// take it back from the portal. The accept route hands back no token; the
// revert route refuses an accept claim with 403 and changes nothing — a
// token minted the old way included. A decline can still be taken back from
// the same open page (unchanged). Undoing an acceptance stays with the
// contractor, in the dashboard.
//
// Runs in **QA Co** (slug `qa-co`): one client and two proposals are made
// here and removed at the end, pass or fail, with the jobs and activity the
// accept produced.

import "../_lib/_server-only"; // `server-only` outside Next — see the file
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const OUTBOX = path.join(os.tmpdir(), `jobflex-qa-outbox-${process.pid}`);
process.env.EMAIL_DEV_OUTBOX = OUTBOX;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_SECRET_KEY_TEST;
delete process.env.NEXT_PUBLIC_POSTHOG_KEY;

import { PrismaClient } from "@prisma/client";
import { POST as acceptRoute } from "../../../src/app/api/public-quote/[publicId]/accept/route";
import { POST as declineRoute } from "../../../src/app/api/public-quote/[publicId]/decline/route";
import { POST as revertRoute } from "../../../src/app/api/public-quote/[publicId]/revert/route";
import { signRevert } from "../../../src/lib/quoteRevert";

type Route = typeof acceptRoute;

const db = new PrismaClient();
const QA_SLUG = "qa-co";
const TAG = `qa-final-${process.pid}`;
// The respond routes are rate-limited per IP (20 an hour): a fresh address per run.
const IP = "10." + [1, 2, 3].map(() => Math.floor(Math.random() * 250)).join(".");

let passes = 0;
let failures = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) passes++;
  else failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};
const head = (s: string) => console.log(`\n── ${s}`);

function call(route: Route, publicId: string, body: unknown) {
  const req = new Request(`http://localhost/api/public-quote/${publicId}/x`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": IP },
    body: JSON.stringify(body),
  });
  return route(req, { params: Promise.resolve({ publicId }) }).then(async (r) => ({ status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> }));
}

let orgId = "";
let clientId = "";
const proposalIds: string[] = [];

async function proposal(suffix: string) {
  const p = await db.proposal.create({
    data: { organizationId: orgId, clientId, publicId: `${TAG}-${suffix}`, title: `QA accept-final ${suffix}`, status: "SENT", total: 1200 },
    select: { id: true, publicId: true },
  });
  proposalIds.push(p.id);
  return p;
}
const statusOf = async (id: string) => (await db.proposal.findUnique({ where: { id }, select: { status: true, acceptedAt: true } }))!;
const reverted = (id: string) => db.activityEvent.count({ where: { proposalId: id, kind: "REVERTED" } });

async function main() {
  const org = await db.organization.findUnique({ where: { slug: QA_SLUG }, select: { id: true } });
  if (!org) throw new Error("QA Co (qa-co) is not seeded");
  orgId = org.id;
  fs.mkdirSync(OUTBOX, { recursive: true });
  const client = await db.client.create({ data: { organizationId: orgId, name: "QA Portal Client" }, select: { id: true } });
  clientId = client.id;

  try {
    /* ── A. accept: no way back ─────────────────────────────────────── */
    head("A · accept hands back no token");
    const a = await proposal("a");
    const acc = await call(acceptRoute, a.publicId, { name: "QA Client" });
    ok("A accepted", acc.status === 200 && acc.body.ok === true, `${acc.status} ${JSON.stringify(acc.body).slice(0, 80)}`);
    ok("A no revertToken in the answer", !("revertToken" in acc.body), Object.keys(acc.body).join(","));
    ok("A row is ACCEPTED with acceptedAt", (await statusOf(a.id)).status === "ACCEPTED" && !!(await statusOf(a.id)).acceptedAt);
    const jobId = typeof acc.body.jobId === "string" ? acc.body.jobId : null;
    ok("A the accept made a job", !!jobId);
    const again = await call(acceptRoute, a.publicId, { name: "QA Client" });
    ok("A accepting again is idempotent and still hands back no token", again.status === 200 && again.body.alreadyAccepted === true && !("revertToken" in again.body));

    /* ── B. revert refuses an acceptance ───────────────────────────── */
    head("B · the revert route refuses an accept claim");
    const forged = signRevert({ p: a.id, a: "accept", prev: "SENT", j: jobId });
    const rv = await call(revertRoute, a.publicId, { token: forged });
    ok("B a token minted the old way: 403", rv.status === 403, `${rv.status} ${rv.body.error}`);
    ok("B the answer says an acceptance can't be taken back", /acceptance/i.test(String(rv.body.error)));
    ok("B row still ACCEPTED", (await statusOf(a.id)).status === "ACCEPTED");
    ok("B the job is still there", !jobId || (await db.job.count({ where: { id: jobId } })) === 1);
    ok("B no REVERTED activity", (await reverted(a.id)) === 0);
    const noTok = await call(revertRoute, a.publicId, {});
    ok("B no token: 403", noTok.status === 403);
    const junk = await call(revertRoute, a.publicId, { token: "not.a.token" });
    ok("B a malformed token: 403", junk.status === 403);
    // a DECLINE claim aimed at an accepted proposal cannot regress it either
    const wrongKind = signRevert({ p: a.id, a: "decline", prev: "SENT", j: null });
    const wk = await call(revertRoute, a.publicId, { token: wrongKind });
    ok("B a decline claim on an accepted row: refused, row unchanged", wk.status === 409 && (await statusOf(a.id)).status === "ACCEPTED", `${wk.status}`);

    /* ── C. a decline can still be taken back (unchanged) ──────────── */
    head("C · decline keeps its way back");
    const b = await proposal("b");
    const dec = await call(declineRoute, b.publicId, { note: "QA: wrong button" });
    ok("C declined, with a token", dec.status === 200 && typeof dec.body.revertToken === "string", `${dec.status}`);
    ok("C row is DECLINED", (await statusOf(b.id)).status === "DECLINED");
    const back = await call(revertRoute, b.publicId, { token: dec.body.revertToken });
    ok("C the decline is taken back: 200, row open again", back.status === 200 && (await statusOf(b.id)).status === "SENT", `${back.status} ${JSON.stringify(back.body)}`);
    ok("C REVERTED activity says decline", (await db.activityEvent.count({ where: { proposalId: b.id, kind: "REVERTED", summary: { contains: "decline" } } })) === 1);
    ok("C an accepted proposal never got one", (await reverted(a.id)) === 0);
  } finally {
    // ── put QA Co back ──
    if (proposalIds.length) {
      const jobs = await db.job.findMany({ where: { proposalId: { in: proposalIds } }, select: { id: true } });
      const jobIds = jobs.map((j) => j.id);
      if (jobIds.length) {
        await db.jobEvent.deleteMany({ where: { jobId: { in: jobIds } } });
        await db.job.deleteMany({ where: { id: { in: jobIds } } });
      }
      await db.activityEvent.deleteMany({ where: { proposalId: { in: proposalIds } } });
      await db.proposal.deleteMany({ where: { id: { in: proposalIds } } });
    }
    if (clientId) {
      await db.activityEvent.deleteMany({ where: { clientId } });
      await db.client.delete({ where: { id: clientId } }).catch((e) => console.warn("could not delete the QA client:", e));
    }
    fs.rmSync(OUTBOX, { recursive: true, force: true });
    await db.$disconnect();
  }
  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
