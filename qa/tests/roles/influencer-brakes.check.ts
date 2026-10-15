// set-password is braked like the sign-in door: 8 tries in 15 minutes, then
// the link's own sentence — through the REAL handlers, no Stripe call.
//
//   npx tsx --tsconfig tsconfig.json qa/tests/roles/influencer-brakes.check.ts
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
  console.log("influencer-brakes · real handlers · no Stripe calls · outbox " + OUTBOX);
  const inf = await db.influencer.create({ data: { email: EMAIL, displayName: "QA Session", hashedPassword: null, status: "PENDING" } });
  head("4 · set-password is braked: 8 tries in 15 minutes, then the link's own sentence");
  await db.syncState.deleteMany({ where: { key: brakeKeys } });
  const live = await mintInfluencerInvite(EMAIL);
  const replies: string[] = [];
  for (let i = 0; i < 9; i++) {
    const r = await completeInfluencerSetPassword({ token: "0".repeat(64), password: "guess-pass-2026" });
    replies.push(r.ok ? "ok" : r.error);
  }
  const setCounter = await db.syncState.findFirst({ where: { key: { startsWith: "rl:influencer-setpw:ip:" } } });
  ok("9 bad tokens: every answer is the same sentence, the counter stops at 8",
    replies.every((r) => /invalid or has expired/.test(r)) && Number((setCounter?.cursor ?? "0").split(":")[0]) === 8, `counter ${setCounter?.cursor}`);
  const braked = await completeInfluencerSetPassword({ token: tokenOf(live.inviteUrl), password: "real-pass-2026" });
  ok("…and while braked, even the real link is refused with that sentence (nothing written)",
    !braked.ok && /invalid or has expired/.test(braked.error) && (await db.influencer.findUnique({ where: { id: inf.id } }))?.sessionVersion === 0);
  await db.syncState.deleteMany({ where: { key: brakeKeys } });
  const after = await completeInfluencerSetPassword({ token: tokenOf(live.inviteUrl), password: "real-pass-2026" });
  ok("with the brake cleared the same link works", after.ok);

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
