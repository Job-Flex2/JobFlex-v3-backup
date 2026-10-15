// "Forgot password" for a partner: one answer for every address, a one-hour
// link in the mail, the same brake as the door — through the REAL handlers,
// no Stripe call, mail into a throw-away outbox.
//
//   npx tsx --tsconfig tsconfig.json qa/tests/roles/influencer-reset.check.ts
//
// Rows are prefixed `qa-ses-` and deleted on the way out, pass or fail.

import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_SECRET_KEY_TEST;
const OUTBOX = mkdtempSync(join(tmpdir(), "jf-outbox-"));
process.env.EMAIL_DEV_OUTBOX = OUTBOX;

import { PrismaClient } from "@prisma/client";
import { principalRedirect, isPartnerPublic } from "../../../src/lib/principalRoutes";
import { influencerSessionCurrent } from "../../../src/lib/orgContext";
import { mintInfluencerInvite, INFLUENCER_TOKEN_PREFIX, RESET_TTL_MS } from "../../../src/lib/influencerInvite";
import { completeInfluencerSetPassword, requestInfluencerPasswordReset } from "../../../src/actions/influencer-auth";

const db = new PrismaClient();
const P = "qa-ses-";
const EMAIL = `${P}partner@jobflex.test`;
const HOUR = 60 * 60 * 1000;

let passes = 0;
let failures = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) passes++;
  else failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};
const head = (s: string) => console.log(`\n── ${s}`);
const tokenOf = (url: string) => new URL(url).searchParams.get("token") ?? "";
const mails = () => readdirSync(OUTBOX).filter((f) => f.endsWith(".html")).map((f) => readFileSync(join(OUTBOX, f), "utf8"));
const brakeKeys = { startsWith: "rl:influencer-" };

async function cleanup() {
  const inf = await db.influencer.findUnique({ where: { email: EMAIL }, select: { id: true } });
  if (inf) await db.influencer.delete({ where: { id: inf.id } });
  await db.verificationToken.deleteMany({ where: { identifier: `${INFLUENCER_TOKEN_PREFIX}${EMAIL}` } });
  await db.syncState.deleteMany({ where: { key: brakeKeys } });
  return inf ? 1 : 0;
}

async function main() {
  await cleanup();
  console.log("influencer-reset · real handlers · no Stripe calls · outbox " + OUTBOX);
  const inf = await db.influencer.create({ data: { email: EMAIL, displayName: "QA Session", hashedPassword: null, status: "PENDING" } });
  head("3 · forgot password: one answer for every address, a one-hour link, the same brake as the door");
  const before = mails().length;
  const unknown = await requestInfluencerPasswordReset("nobody-at-all@jobflex.test");
  const known = await requestInfluencerPasswordReset(EMAIL.toUpperCase());
  ok("a stranger's address and a partner's get the same sentence", unknown.ok && known.ok && unknown.message === known.message, unknown.ok ? unknown.message : "");
  ok("…and only the partner's produced a mail", mails().length === before + 1);
  const resetMail = mails().at(-1) ?? "";
  const link = (resetMail.match(/href="(http[^"]*\/influencer\/set-password\?token=[a-f0-9]+)"/) || [])[1];
  ok("the mail is addressed to the partner, says 'Reset your JobFlex partner password' and carries the set-password link",
    resetMail.includes(`to: ${EMAIL}`) && /Reset your JobFlex partner password/.test(resetMail) && Boolean(link), link ?? "no link");
  const tok = await db.verificationToken.findFirst({ where: { identifier: `${INFLUENCER_TOKEN_PREFIX}${EMAIL}` } });
  const ttl = (tok?.expires.getTime() ?? 0) - Date.now();
  ok("the link lives one hour, not seven days", ttl > HOUR - 10_000 && ttl <= RESET_TTL_MS, `${Math.round(ttl / 60000)} min`);
  const bad = await requestInfluencerPasswordReset("not an address");
  ok("a malformed address gets the same sentence too", bad.ok && bad.message === known.message);
  const reset = await completeInfluencerSetPassword({ token: tokenOf(link ?? ""), password: "second-pass-2026" });
  const row = await db.influencer.findUnique({ where: { id: inf.id } });
  ok("the reset link sets the password and bumps the version — a session from before it is out", reset.ok && row?.sessionVersion === 1 && !influencerSessionCurrent(row.sessionVersion, 0));
  ok("the link is burnt", (await db.verificationToken.count({ where: { identifier: `${INFLUENCER_TOKEN_PREFIX}${EMAIL}` } })) === 0);
  await db.syncState.deleteMany({ where: { key: brakeKeys } });
  const answers: string[] = [];
  for (let i = 0; i < 9; i++) {
    const r = await requestInfluencerPasswordReset(EMAIL);
    answers.push(r.ok ? "ok" : r.error);
  }
  const counter = await db.syncState.findUnique({ where: { key: `rl:influencer-reset:email:${EMAIL}` } });
  ok("9 requests for one address: 8 answered, the 9th refused by the brake ('Too many…'), the counter stops at 8",
    answers.slice(0, 8).every((a) => a === "ok") && /Too many/.test(answers[8]) && Number((counter?.cursor ?? "0").split(":")[0]) === 8, `${answers[8]} · counter ${counter?.cursor}`);
  await db.influencer.update({ where: { id: inf.id }, data: { status: "SUSPENDED" } });
  await db.syncState.deleteMany({ where: { key: brakeKeys } });
  const mailsBefore = mails().length;
  const susp = await requestInfluencerPasswordReset(EMAIL);
  ok("a suspended partner gets the same sentence and no mail", susp.ok && susp.message === known.message && mails().length === mailsBefore);
  await db.influencer.update({ where: { id: inf.id }, data: { status: "ACTIVE" } });


  console.log(`\n${passes} passed, ${failures} failed`);
  const removed = await cleanup();
  rmSync(OUTBOX, { recursive: true, force: true });
  console.log(`      · cleaned up ${removed} partner(s), the brake counters and the outbox`);
  await db.$disconnect();
  process.exit(failures ? 1 : 0);
}

main().catch(async (err) => {
  console.error("\ncheck crashed:", err);
  try {
    await cleanup();
    rmSync(OUTBOX, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
  await db.$disconnect();
  process.exit(2);
});
