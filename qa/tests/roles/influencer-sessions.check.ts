// A password change ends every other partner session (Influencer.sessionVersion,
// bumped by set-password; the JWT carries the stamp it was issued with) —
// through the REAL handlers, no Stripe call, mail into a throw-away outbox.
//
//   npx tsx --tsconfig tsconfig.json qa/tests/roles/influencer-sessions.check.ts
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
  console.log("influencer-sessions · real handlers · no Stripe calls · outbox " + OUTBOX);
  head("2 · a password change ends the other sessions (sessionVersion)");
  const inf = await db.influencer.create({ data: { email: EMAIL, displayName: "QA Session", hashedPassword: null, status: "PENDING" } });
  ok("a new partner starts at sessionVersion 0", inf.sessionVersion === 0);
  ok("the rule: a token stamped with the row's version is current; an older stamp is not",
    influencerSessionCurrent(0, 0) && influencerSessionCurrent(2, 2) && !influencerSessionCurrent(1, 0) && influencerSessionCurrent(0, undefined) && !influencerSessionCurrent(1, null));
  const invite = await mintInfluencerInvite(EMAIL);
  const first = await completeInfluencerSetPassword({ token: tokenOf(invite.inviteUrl), password: "first-pass-2026" });
  const row = await db.influencer.findUnique({ where: { id: inf.id } });
  ok("set-password bumps the version: a session issued before it (stamp 0) is refused, one issued after (stamp 1) is not",
    first.ok && row?.sessionVersion === 1 && !influencerSessionCurrent(row.sessionVersion, 0) && influencerSessionCurrent(row.sessionVersion, 1), `version ${row?.sessionVersion}`);


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
