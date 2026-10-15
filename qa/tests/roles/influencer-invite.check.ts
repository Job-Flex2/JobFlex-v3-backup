// A partner is PENDING until they set their password, and their code is live
// from the start — through the REAL handlers, no Stripe call, no mail.
//
//   npx tsx --tsconfig tsconfig.json qa/tests/roles/influencer-invite.check.ts
//
// The admin's createInfluencer needs a platform-admin session, so the row is
// written here the way that action writes it (no password → PENDING); everything
// after that is the real code: mintInfluencerInvite, validateAttribution,
// completeInfluencerSetPassword, and the accrual's own status gate.
//
// Rows are prefixed `qa-inv-` and deleted on the way out, pass or fail.

delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_SECRET_KEY_TEST;

import "../_lib/_server-only"; // `server-only` outside Next — see the file
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { mintInfluencerInvite, INFLUENCER_TOKEN_PREFIX } from "../../../src/lib/influencerInvite";
import { validateAttribution } from "../../../src/lib/attribution";
import { completeInfluencerSetPassword } from "../../../src/actions/influencer-auth";
import { accrueForInvoice } from "../../../src/lib/stripeSync";

const db = new PrismaClient();
const P = "qa-inv-";
const EMAIL = `${P}partner@jobflex.test`;
const CODE = "QAINVITE20";

let passes = 0;
let failures = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) passes++;
  else failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};
const head = (s: string) => console.log(`\n── ${s}`);
const tokenOf = (url: string) => new URL(url).searchParams.get("token") ?? "";
/** The action's refusal sentence, or null when it succeeded. */
const attempt = async (token: string, password: string) => {
  const res = await completeInfluencerSetPassword({ token, password });
  return res.ok ? null : res.error;
};

async function cleanup() {
  const inf = await db.influencer.findUnique({ where: { email: EMAIL }, select: { id: true } });
  if (inf) {
    await db.commissionLedger.deleteMany({ where: { influencerId: inf.id } });
    await db.attribution.deleteMany({ where: { influencerId: inf.id } });
    await db.promoCode.deleteMany({ where: { influencerId: inf.id } });
    await db.influencer.delete({ where: { id: inf.id } });
  }
  await db.verificationToken.deleteMany({ where: { identifier: `${INFLUENCER_TOKEN_PREFIX}${EMAIL}` } });
  // The set-password brake this check spends (8 tries in 15 minutes per caller).
  await db.syncState.deleteMany({ where: { key: { startsWith: "rl:influencer-setpw:" } } });
  return inf ? 1 : 0;
}

async function main() {
  await cleanup();
  const qaOrg = await db.organization.findUnique({ where: { slug: "qa-co" }, select: { id: true, name: true } });
  if (!qaOrg) {
    console.error("FAIL  QA Co (slug qa-co) is not seeded in this database — run the seed first.");
    process.exit(1);
  }
  console.log(`invite → set-password · ${qaOrg.name} · real handlers · no Stripe calls`);

  head("A · created without a password: PENDING, code live");
  const inf = await db.influencer.create({
    data: {
      email: EMAIL,
      displayName: "QA Invite",
      hashedPassword: null,
      status: "PENDING",
      promoCodes: {
        create: {
          code: CODE,
          stripeCouponId: `local_coupon_${P}`,
          stripePromotionCodeId: `local_promo_${P}`,
          customerPercentOff: 10,
          commissionType: "PERCENT",
          commissionRateBps: 2000,
          commissionBasis: "NET",
          durationType: "REPEATING",
          durationMonths: 6,
        },
      },
    },
    include: { promoCodes: true },
  });
  const v = await validateAttribution("promo", CODE.toLowerCase());
  ok("a PENDING partner's code attracts signups (validateAttribution resolves it, case-insensitively)",
    v?.kind === "promo" && v.code === CODE && v.displayName === "QA Invite" && v.percentOff === 10, JSON.stringify(v));
  await db.attribution.create({
    data: { influencerId: inf.id, promoCodeId: inf.promoCodes[0].id, organizationId: qaOrg.id, stripeCustomerId: `cus_${P}`, stripeSubscriptionId: `sub_${P}`, status: "ACTIVE" },
  });
  const acc = (await accrueForInvoice({ id: `in_${P}1`, subscription: `sub_${P}`, customer: `cus_${P}`, charge: `ch_${P}1`, paid: true, amount_paid: 7900, subtotal: 7900, currency: "usd", created: Math.floor(Date.now() / 1000), billing_reason: "subscription_cycle" } as never)) as { accruedCents?: number };
  ok("…and a referral's first payment is already theirs (20% of $79)", acc.accruedCents === 1580, JSON.stringify(acc));

  head("B · the invite link: single-use, expiring, one sentence for every refusal");
  const { inviteUrl } = await mintInfluencerInvite(EMAIL);
  ok("the link carries a 64-hex token and the stored copy is its hash, not the token",
    /^[a-f0-9]{64}$/.test(tokenOf(inviteUrl)) &&
      (await db.verificationToken.count({ where: { identifier: `${INFLUENCER_TOKEN_PREFIX}${EMAIL}`, token: tokenOf(inviteUrl) } })) === 0 &&
      (await db.verificationToken.count({ where: { identifier: `${INFLUENCER_TOKEN_PREFIX}${EMAIL}` } })) === 1);
  const second = await mintInfluencerInvite(EMAIL);
  ok("a fresh invite invalidates the earlier one — one live link per partner",
    (await db.verificationToken.count({ where: { identifier: `${INFLUENCER_TOKEN_PREFIX}${EMAIL}` } })) === 1 && second.inviteUrl !== inviteUrl);
  const stale = await attempt(tokenOf(inviteUrl), "stale-pass-2026");
  ok("the superseded link is refused with the generic sentence", /invalid or has expired/.test(stale ?? ""), stale ?? "accepted!");
  const short = await attempt(tokenOf(second.inviteUrl), "short");
  ok("a password under 8 characters is refused, as a sentence, before anything is written", /at least 8 characters/.test(short ?? "") && (await db.influencer.findUnique({ where: { id: inf.id } }))?.hashedPassword === null, short ?? "accepted!");
  ok("the live link is accepted", (await attempt(tokenOf(second.inviteUrl), "proper-pass-2026")) === null);
  const after = await db.influencer.findUnique({ where: { id: inf.id } });
  ok("the live link sets the password and flips PENDING → ACTIVE", after?.status === "ACTIVE" && Boolean(after.hashedPassword) && (await bcrypt.compare("proper-pass-2026", after!.hashedPassword!)));
  ok("the token is burnt", (await db.verificationToken.count({ where: { identifier: `${INFLUENCER_TOKEN_PREFIX}${EMAIL}` } })) === 0);
  const reuse = await attempt(tokenOf(second.inviteUrl), "again-pass-2026");
  ok("using it again is refused, and the password stays", /invalid or has expired/.test(reuse ?? "") && (await db.influencer.findUnique({ where: { id: inf.id } }))?.hashedPassword === after?.hashedPassword);
  const third = await mintInfluencerInvite(EMAIL);
  await db.verificationToken.updateMany({ where: { identifier: `${INFLUENCER_TOKEN_PREFIX}${EMAIL}` }, data: { expires: new Date(Date.now() - 1000) } });
  const expired = await attempt(tokenOf(third.inviteUrl), "late-pass-2026");
  ok("an expired link is refused with the same sentence", /invalid or has expired/.test(expired ?? ""), expired ?? "accepted!");

  head("C · suspended: the code stops attracting signups, the link stops working");
  await db.influencer.update({ where: { id: inf.id }, data: { status: "SUSPENDED" } });
  ok("validateAttribution refuses a suspended partner's code", (await validateAttribution("promo", CODE)) === null);
  const fourth = await mintInfluencerInvite(EMAIL);
  const susp = await attempt(tokenOf(fourth.inviteUrl), "susp-pass-2026");
  ok("a suspended partner cannot set a password through a link", /invalid or has expired/.test(susp ?? ""));

  console.log(`\n${passes} passed, ${failures} failed`);
  const removed = await cleanup();
  console.log(`      · cleaned up ${removed} partner(s) and their rows`);
  await db.$disconnect();
  process.exit(failures ? 1 : 0);
}

main().catch(async (err) => {
  console.error("\ncheck crashed:", err);
  try {
    await cleanup();
  } catch {
    /* best effort */
  }
  await db.$disconnect();
  process.exit(2);
});
