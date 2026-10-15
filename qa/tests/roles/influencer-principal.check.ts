// A partner's session and a user's session each stay on their own surface —
// the middleware's table (lib/principalRoutes), walked without a request.
//
//   npx tsx --tsconfig tsconfig.json qa/tests/roles/influencer-principal.check.ts
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
  console.log("influencer-principal · real handlers · no Stripe calls · outbox " + OUTBOX);
  head("1 · who may stand where (lib/principalRoutes — the middleware's table)");
  const table: [string, string | null, string | null][] = [
    ["/dashboard", "INFLUENCER", "/influencer"],
    ["/dashboard/settings", "INFLUENCER", "/influencer"],
    ["/admin/payouts", "INFLUENCER", "/influencer"],
    ["/v3/dashboard-v2", "INFLUENCER", "/influencer"],
    ["/mobile-v2", "INFLUENCER", "/influencer"],
    ["/influencer", "INFLUENCER", null],
    ["/influencer/payouts", "INFLUENCER", null],
    ["/influencer", "USER", "/dashboard"],
    ["/influencer/earnings", "USER", "/dashboard"],
    ["/influencer/login", "USER", null],
    ["/influencer/forgot-password", "USER", null],
    ["/dashboard", "USER", null],
    ["/admin", "USER", null],
    ["/dashboard", null, null],
  ];
  const wrong = table.filter(([p, who, want]) => principalRedirect(p, who) !== want).map(([p, who]) => `${who ?? "none"} on ${p} → ${principalRedirect(p, who)}`);
  ok("a partner is sent home from every contractor and admin path; a user is sent to the dashboard from partner pages; the doors stay public",
    wrong.length === 0, wrong.join("; ") || `${table.length} rows`);
  ok("the public partner paths need no session", ["/influencer/login", "/influencer/set-password", "/influencer/forgot-password"].every(isPartnerPublic) && !isPartnerPublic("/influencer"));


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
