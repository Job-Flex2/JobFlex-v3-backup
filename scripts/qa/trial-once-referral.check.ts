// One free trial per company, and the referral credit only after a real payment
// (owner, 2026-10-12) — through the REAL helpers, no Stripe call (the keys are
// removed below, so nothing can reach Stripe).
//   npx --no-install tsx --tsconfig tsconfig.json scripts/qa/trial-once-referral.check.ts
//
// Writes only throwaway organisations named `qa-trial1-…` (and their referral
// code and conversions), removed on the way out, pass or fail.
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_SECRET_KEY_TEST;

import "./_server-only";
import type Stripe from "stripe";
import { PrismaClient } from "@prisma/client";
import { hadSubscription, trialDaysFor } from "../../src/lib/trialEligibility";
import { applyReferralReward, processReferralEffectsForInvoice, referredOrgPaid, settleReferralsForSignupOrg } from "../../src/lib/referralRewards";

const db = new PrismaClient();
const TAG = "qa-trial1";
let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const made: string[] = [];
let userId: string | null = null;

async function org(name: string) {
  const o = await db.organization.create({ data: { name: `${TAG} ${name}`, slug: `${TAG}-${name}-${Date.now()}` } });
  made.push(o.id);
  return o.id;
}
const paidInvoice = (subId: string, cents: number) =>
  ({ id: `in_${TAG}_${cents}`, object: "invoice", status: "paid", amount_paid: cents, subscription: subId, parent: { subscription_details: { subscription: subId } } }) as unknown as Stripe.Invoice;

(async () => {
  try {
    // ── one trial per company ──
    const fresh = await org("fresh");
    check("a company with no subscription row gets the plan's trial", (await trialDaysFor(fresh, 14)) === 14 && !(await hadSubscription(fresh)));
    const seeded = await org("seeded");
    await db.subscription.create({ data: { organizationId: seeded, plan: "FREE", status: "FREE", provider: "STRIPE" } });
    check("a FREE row that never billed still gets the trial", (await trialDaysFor(seeded, 14)) === 14);
    const cancelled = await org("cancelled");
    await db.subscription.create({ data: { organizationId: cancelled, plan: "PROFESSIONAL", status: "CANCELED", provider: "STRIPE", externalCustomerId: `cus_${TAG}`, externalSubId: `sub_${TAG}_c` } });
    check("a cancelled company pays at once (no trial)", (await trialDaysFor(cancelled, 14)) === 0);
    const unpaid = await org("unpaid");
    await db.subscription.create({ data: { organizationId: unpaid, plan: "ADVANCED", status: "UNPAID", provider: "STRIPE" } });
    check("a company ended for non-payment pays at once", (await trialDaysFor(unpaid, 14)) === 0);
    const comp = await org("comp");
    await db.subscription.create({ data: { organizationId: comp, plan: "ENTERPRISE", status: "FREE", provider: "MANUAL" } });
    check("a company that had a grant pays at once", (await trialDaysFor(comp, 14)) === 0);
    const cardless = await org("cardless");
    await db.syncState.create({ data: { key: `cardlessTrial:${cardless}`, cursor: "{}" } });
    check("a company that had a card-less trial pays at once", (await trialDaysFor(cardless, 14)) === 0);
    check("a plan with no trial stays at 0", (await trialDaysFor(fresh, 0)) === 0);

    // ── the referral credit waits for a paid invoice ──
    const referrer = await org("referrer");
    const referred = await org("referred");
    const user = await db.user.create({ data: { email: `${TAG}-${Date.now()}@example.test`, name: TAG } });
    userId = user.id;
    const code = await db.referralCode.create({ data: { organizationId: referrer, userId: user.id, code: `${TAG.toUpperCase()}-${Date.now()}` } });
    const conv = await db.referralConversion.create({ data: { codeId: code.id, signupEmail: `${TAG}@example.test`, signupOrgId: referred } });
    await db.subscription.create({ data: { organizationId: referred, plan: "PROFESSIONAL", status: "TRIALING", provider: "STRIPE", externalSubId: `sub_${TAG}_r`, externalCustomerId: `cus_${TAG}_r` } });
    await db.subscription.create({ data: { organizationId: referrer, plan: "PROFESSIONAL", status: "ACTIVE", provider: "STRIPE", externalSubId: `sub_${TAG}_ref`, externalCustomerId: `cus_${TAG}_ref` } });

    await settleReferralsForSignupOrg(referred);
    let row = await db.referralConversion.findUnique({ where: { id: conv.id } });
    check("subscription started, nothing paid: the referral stays PENDING", row?.status === "PENDING" && !row.rewardAppliedAt, row?.status);
    check("…and the reward is refused while unpaid", (await applyReferralReward(conv.id)).reason === "not-converted");
    await db.referralConversion.update({ where: { id: conv.id }, data: { status: "CONVERTED", convertedAt: new Date() } });
    check("a CONVERTED row from the old rule, never paid: no credit", (await applyReferralReward(conv.id)).reason === "referred-not-paid");
    await db.referralConversion.update({ where: { id: conv.id }, data: { status: "PENDING", convertedAt: null } });

    await processReferralEffectsForInvoice(paidInvoice(`sub_${TAG}_r`, 0));
    row = await db.referralConversion.findUnique({ where: { id: conv.id } });
    check("a $0 (trial) invoice changes nothing", row?.status === "PENDING");
    check("…and records no payment", !(await referredOrgPaid(referred)));

    await processReferralEffectsForInvoice(paidInvoice(`sub_${TAG}_r`, 9500));
    row = await db.referralConversion.findUnique({ where: { id: conv.id } });
    const marker = await db.syncState.findUnique({ where: { key: `referralPaid:${conv.id}` } });
    check("the first paid invoice converts the referral", row?.status === "CONVERTED", row?.status);
    check("…and records the payment", marker?.cursor === `in_${TAG}_9500` && (await referredOrgPaid(referred)));
    const res = await applyReferralReward(conv.id);
    check("…after which the credit goes ahead (here: stops only at Stripe, which is off)", res.reason === "stripe-disabled", String(res.reason));
    await processReferralEffectsForInvoice(paidInvoice(`sub_${TAG}_r`, 9500));
    check("a re-delivered invoice.paid writes nothing twice", (await db.syncState.count({ where: { key: `referralPaid:${conv.id}` } })) === 1);
  } catch (err) {
    bad++;
    console.error("FAIL harness", err);
  } finally {
    const convs = await db.referralConversion.findMany({ where: { code: { organizationId: { in: made } } }, select: { id: true } });
    await db.syncState.deleteMany({ where: { key: { in: [...convs.map((c) => `referralPaid:${c.id}`), ...made.map((m) => `cardlessTrial:${m}`)] } } });
    await db.subscription.deleteMany({ where: { organizationId: { in: made } } });
    await db.organization.deleteMany({ where: { id: { in: made } } });
    if (userId) await db.user.delete({ where: { id: userId } }).catch(() => {});
    await db.$disconnect();
    console.log(`      · cleaned up ${made.length} organisation(s)`);
    console.log(bad === 0 ? "\nAll trial-once and referral checks passed." : `\n${bad} check(s) FAILED.`);
    process.exit(bad === 0 ? 0 : 1);
  }
})();
