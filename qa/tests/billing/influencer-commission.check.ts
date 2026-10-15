// Synthetic check of the influencer commission guards — no network, no browser,
// NO STRIPE CALL of any kind. The webhook handlers take plain objects, so the
// money path can be exercised by hand-building the payloads Stripe would send.
//
//   npx tsx --tsconfig tsconfig.json qa/tests/billing/influencer-commission.check.ts
//
// ORGANISATION. Everything runs inside **QA Co** (slug `qa-co`, owner
// `qa@acme.test`) — limits are per organisation and nothing a check does may be
// charged to an organisation a person works in. The one test that must go
// through syncSubscriptionFromStripe snapshots QA Co's Subscription row and puts
// it back, because that function upserts the billing mirror.
//
// Rows it writes are prefixed `qa-inf-` and deleted on the way out, pass or fail.
import "../_lib/_server-only"; // `server-only` outside Next — see the file
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import {
  accrueForInvoice,
  isSelfReferral,
  reverseForCharge,
  syncSubscriptionFromStripe,
} from "../../../src/lib/stripeSync";
import { payoutRequestRefusal } from "../../../src/lib/payouts";
import { computeCommissionCents } from "../../../src/lib/commission";

const db = new PrismaClient();
const QA_SLUG = "qa-co";
const QA_OWNER = "qa@acme.test";
const P = "qa-inf-";

let passes = 0;
let failures = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) passes++;
  else failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};
const cents = (n: number) => `$${(n / 100).toFixed(2)}`;

// ── synthetic Stripe payloads: only the fields the handlers read ──
function invoice(id: string, subId: string, chargeId: string | null, amountPaid: number) {
  return {
    id,
    subscription: subId,
    charge: chargeId,
    paid: true,
    amount_paid: amountPaid,
    subtotal: amountPaid,
    currency: "usd",
  } as never;
}
// `invoice` decides whether an unmatched refund is parked for a later accrual or
// dropped: a charge with no invoice can never accrue commission.
function charge(id: string, amount: number, refunded: number, invoiceId: string | null) {
  return { id, amount, amount_refunded: refunded, invoice: invoiceId } as never;
}
function subscription(id: string, orgId: string, promotionCodeId: string | null) {
  return {
    id,
    customer: `cus_${P}${id}`,
    status: "active",
    metadata: { organizationId: orgId },
    items: { data: [{ price: { id: `price_${P}79` } }] },
    current_period_end: Math.floor(Date.parse("2026-12-01T00:00:00Z") / 1000),
    canceled_at: null,
    discount: promotionCodeId ? { promotion_code: promotionCodeId, coupon: null } : null,
  } as never;
}

async function makeInfluencer(suffix: string, over: Record<string, unknown> = {}) {
  return db.influencer.create({
    data: {
      email: `${P}${suffix}@jobflex.test`,
      displayName: `QA Inf ${suffix}`,
      status: "ACTIVE",
      holdDays: 30,
      minPayoutCents: 2500,
      ...over,
    },
  });
}
async function makePromo(influencerId: string, code: string) {
  return db.promoCode.create({
    data: {
      influencerId,
      code,
      stripeCouponId: `local_coupon_${code}`,
      stripePromotionCodeId: `local_promo_${code}`,
      commissionType: "PERCENT",
      commissionRateBps: 2000,
      commissionBasis: "NET",
      durationType: "FOREVER",
      customerPercentOff: 20,
    },
  });
}

async function cleanup() {
  const infs = await db.influencer.findMany({
    where: { OR: [{ email: { startsWith: P } }, { displayName: { startsWith: "QA Inf " } }] },
    select: { id: true },
  });
  const ids = infs.map((i) => i.id);
  if (ids.length) {
    const attrs = await db.attribution.findMany({ where: { influencerId: { in: ids } }, select: { id: true } });
    await db.syncState.deleteMany({ where: { key: { in: attrs.map((a) => `attributionSubAt:${a.id}`) } } });
    await db.commissionLedger.deleteMany({ where: { influencerId: { in: ids } } });
    await db.attribution.deleteMany({ where: { influencerId: { in: ids } } });
    await db.promoCode.deleteMany({ where: { influencerId: { in: ids } } });
    await db.influencer.deleteMany({ where: { id: { in: ids } } });
  }
  await db.attribution.deleteMany({ where: { stripeSubscriptionId: { startsWith: `sub_${P}` } } });
  await db.syncState.deleteMany({ where: { key: { startsWith: `refundPending:ch_${P}` } } });
  await db.user.deleteMany({ where: { email: { startsWith: P } } });
  return ids.length;
}

async function main() {
  await cleanup();

  const qaOrg = await db.organization.findUnique({ where: { slug: QA_SLUG }, select: { id: true, name: true } });
  if (!qaOrg) {
    console.error(`FAIL  QA Co (slug ${QA_SLUG}) is not seeded in this database — run the seed first.`);
    process.exit(1);
  }
  const owner = await db.user.findUnique({ where: { email: QA_OWNER }, select: { id: true } });
  if (!owner) {
    console.error(`FAIL  ${QA_OWNER} is not seeded in this database — run the seed first.`);
    process.exit(1);
  }
  console.log(`influencer commission guards · ${qaOrg.name} (${QA_SLUG}) · no Stripe calls\n`);

  // ── SELF-REFERRAL, leg 1: the influencer's linked app account owns the org ──
  const linked = await makeInfluencer("linked", { userId: owner.id });
  const linkedPromo = await makePromo(linked.id, "QAINFLINKED");
  ok("isSelfReferral: an influencer whose linked account owns the org",
    await isSelfReferral(linked.id, qaOrg.id));

  const attrLinked = await db.attribution.create({
    data: {
      influencerId: linked.id,
      promoCodeId: linkedPromo.id,
      organizationId: qaOrg.id,
      stripeCustomerId: `cus_${P}linked`,
      stripeSubscriptionId: `sub_${P}linked`,
      status: "ACTIVE",
    },
  });
  const rLinked = (await accrueForInvoice(invoice(`in_${P}linked`, attrLinked.stripeSubscriptionId, `ch_${P}linked`, 6320))) as {
    accruedCents?: number;
    skipped?: string;
  };
  ok("an ACTIVE self-referral attribution accrues nothing",
    rLinked.skipped === "self-referral",
    rLinked.accruedCents ? `ACCRUED ${cents(rLinked.accruedCents)}` : `skipped: ${rLinked.skipped}`);
  ok("no ledger row was written for it",
    (await db.commissionLedger.count({ where: { influencerId: linked.id } })) === 0);

  // ── SELF-REFERRAL, leg 2: same email, accounts never linked ──
  const byEmail = await db.influencer.create({
    data: { email: QA_OWNER, displayName: "QA Inf byEmail", status: "ACTIVE", holdDays: 30, minPayoutCents: 2500 },
  });
  ok("isSelfReferral: an unlinked influencer whose email is the org owner's",
    await isSelfReferral(byEmail.id, qaOrg.id));

  // ── CONTROL: an unrelated influencer earns normally on the same org ──
  const outsider = await makeInfluencer("outsider");
  const outsiderPromo = await makePromo(outsider.id, "QAINFOUTSIDE");
  ok("isSelfReferral: an unrelated influencer is NOT self-referral",
    (await isSelfReferral(outsider.id, qaOrg.id)) === false);
  const attrOut = await db.attribution.create({
    data: {
      influencerId: outsider.id,
      promoCodeId: outsiderPromo.id,
      organizationId: qaOrg.id,
      stripeCustomerId: `cus_${P}out`,
      stripeSubscriptionId: `sub_${P}out`,
      status: "ACTIVE",
    },
  });
  const rOut = (await accrueForInvoice(invoice(`in_${P}out`, attrOut.stripeSubscriptionId, `ch_${P}out`, 6320))) as {
    accruedCents?: number;
    skipped?: string;
  };
  ok("the control still accrues 20% NET of 6320¢ = 1264¢",
    rOut.accruedCents === 1264,
    JSON.stringify(rOut));

  // ── isSelfReferral with no organization: unknowable, so not blocked ──
  ok("an attribution with no resolved organization is not treated as self-referral",
    (await isSelfReferral(outsider.id, null)) === false);

  // ── PARTNER STATUS. A suspended or terminated partner stops earning; a
  //    PENDING one (invite out, no password yet) keeps earning. ──
  for (const [status, shouldAccrue] of [
    ["ACTIVE", true],
    ["PENDING", true],
    ["SUSPENDED", false],
    ["TERMINATED", false],
  ] as const) {
    await db.influencer.update({ where: { id: outsider.id }, data: { status } });
    const res = (await accrueForInvoice(
      invoice(`in_${P}st-${status}`, attrOut.stripeSubscriptionId, `ch_${P}st-${status}`, 6320),
    )) as { accruedCents?: number; skipped?: string };
    ok(
      shouldAccrue ? `${status} keeps accruing` : `${status} stops accruing`,
      shouldAccrue ? res.accruedCents === 1264 : res.skipped === "influencer-inactive",
      res.accruedCents !== undefined ? `accrued ${cents(res.accruedCents)}` : `skipped: ${res.skipped}`,
    );
  }
  await db.influencer.update({ where: { id: outsider.id }, data: { status: "ACTIVE" } });

  // An inactive code is deliberately NOT the same lever: it closes the code to
  // new signups and leaves existing subscribers earning. Pinned so a later
  // change to that split is a deliberate one.
  await db.promoCode.update({ where: { id: outsiderPromo.id }, data: { active: false } });
  const rInactiveCode = (await accrueForInvoice(
    invoice(`in_${P}codeoff`, attrOut.stripeSubscriptionId, `ch_${P}codeoff`, 6320),
  )) as { accruedCents?: number; skipped?: string };
  ok("an inactive promo code still accrues for subscribers already on it",
    rInactiveCode.accruedCents === 1264,
    rInactiveCode.accruedCents !== undefined ? `accrued ${cents(rInactiveCode.accruedCents)}` : `skipped: ${rInactiveCode.skipped}`);
  await db.promoCode.update({ where: { id: outsiderPromo.id }, data: { active: true } });

  // ── A REFUND THAT OUTRAN ITS INVOICE. Stripe does not order deliveries, so
  //    charge.refunded can land before the invoice.paid it refunds. ──
  const attrOoo = await db.attribution.create({
    data: {
      influencerId: outsider.id,
      promoCodeId: outsiderPromo.id,
      organizationId: qaOrg.id,
      stripeCustomerId: `cus_${P}ooo`,
      stripeSubscriptionId: `sub_${P}ooo`,
      status: "ACTIVE",
    },
  });
  const OOO_CH = `ch_${P}ooo`;
  const OOO_INV = `in_${P}ooo`;
  const early = (await reverseForCharge(charge(OOO_CH, 6320, 6320, OOO_INV))) as { skipped?: string };
  ok("a refund with nothing to reverse yet is parked", early.skipped === "parked-until-accrual", String(early.skipped));
  ok("the parked row holds the charge's amounts",
    (await db.syncState.findUnique({ where: { key: `refundPending:${OOO_CH}` } }))?.cursor === "6320:6320");

  const late = (await accrueForInvoice(invoice(OOO_INV, attrOoo.stripeSubscriptionId, OOO_CH, 6320))) as {
    accruedCents?: number;
    reversedCents?: number;
  };
  ok("the accrual settles the parked refund on arrival",
    late.accruedCents === 1264 && late.reversedCents === 1264,
    `accrued ${cents(late.accruedCents ?? 0)}, reversed ${cents(late.reversedCents ?? 0)}`);
  const oooRows = await db.commissionLedger.findMany({
    where: { stripeChargeId: OOO_CH },
    select: { amountCents: true },
  });
  ok("nothing is owed on a fully refunded charge",
    oooRows.reduce((n, r) => n + r.amountCents, 0) === 0,
    `${oooRows.length} entries netting ${cents(oooRows.reduce((n, r) => n + r.amountCents, 0))}`);
  ok("the parked row was consumed, not left behind",
    (await db.syncState.findUnique({ where: { key: `refundPending:${OOO_CH}` } })) === null);
  const again = (await accrueForInvoice(invoice(OOO_INV, attrOoo.stripeSubscriptionId, OOO_CH, 6320))) as {
    skipped?: string;
  };
  ok("redelivering the invoice cannot reverse a second time",
    again.skipped === "already-accrued" &&
      (await db.commissionLedger.count({ where: { stripeChargeId: OOO_CH } })) === 2,
    String(again.skipped));

  // A charge with no invoice can never accrue commission, so an unmatched refund
  // on one is dropped — the one-off proposal payments share this webhook.
  const noInvoice = (await reverseForCharge(charge(`ch_${P}noinv`, 5000, 5000, null))) as { skipped?: string };
  ok("an unmatched refund on a charge with no invoice is dropped, not parked",
    noInvoice.skipped === "no-accrual" &&
      (await db.syncState.findUnique({ where: { key: `refundPending:ch_${P}noinv` } })) === null,
    String(noInvoice.skipped));

  // ── THE WRITE-TIME STAMP. syncSubscriptionFromStripe upserts QA Co's billing
  //    mirror, so snapshot it and put it back afterwards. ──
  const mirrorBefore = await db.subscription.findUnique({ where: { organizationId: qaOrg.id } });
  // …and the reference of which subscription the mirror may follow next.
  const mirrorRefKey = `mirrorSubAt:${qaOrg.id}`;
  const mirrorRefBefore = await db.syncState.findUnique({ where: { key: mirrorRefKey } });
  // ONE ORGANISATION IS ONE CLIENT (owner, 2026-09-22): syncSubscriptionFromStripe
  // carries an organisation's attribution onto its newest subscription. The rows
  // this check created directly above are all "in" QA Co, so while the
  // subscription-sync scenarios below run they are parked (organisation detached)
  // and each scenario starts as a fresh client; the finally block restores them.
  const parked = await db.attribution.findMany({
    where: { organizationId: qaOrg.id, influencerId: { in: [linked.id, byEmail.id, outsider.id] } },
    select: { id: true },
  });
  await db.attribution.updateMany({ where: { id: { in: parked.map((a) => a.id) } }, data: { organizationId: null } });
  const SYNC_SUBS = [`sub_${P}stamp`, `sub_${P}stamp2`, `sub_${P}window`];
  const freshClient = async () => {
    const rows = await db.attribution.findMany({ where: { stripeSubscriptionId: { in: SYNC_SUBS } }, select: { id: true } });
    await db.syncState.deleteMany({ where: { key: { in: rows.map((r) => `attributionSubAt:${r.id}`) } } });
    await db.attribution.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
  };
  try {
    await freshClient();
    await syncSubscriptionFromStripe(
      subscription(`sub_${P}stamp`, qaOrg.id, linkedPromo.stripePromotionCodeId),
    );
    const stamped = await db.attribution.findUnique({ where: { stripeSubscriptionId: `sub_${P}stamp` } });
    ok("a self-referral attribution is written VOID, not ACTIVE",
      stamped?.status === "VOID",
      `status ${stamped?.status} — the row is kept so the admin sees the code was used`);
    const rStamp = (await accrueForInvoice(invoice(`in_${P}stamp`, `sub_${P}stamp`, `ch_${P}stamp`, 6320))) as {
      skipped?: string;
    };
    ok("a VOID attribution never reaches the accrual", rStamp.skipped === "no-active-attribution", String(rStamp.skipped));
    // …and the discount leaving it (the coupon expiring) never revives a VOID.
    await syncSubscriptionFromStripe(subscription(`sub_${P}stamp`, qaOrg.id, null));
    ok("a VOID self-referral attribution is never revived",
      (await db.attribution.findUnique({ where: { stripeSubscriptionId: `sub_${P}stamp` } }))?.status === "VOID");

    await freshClient();
    await syncSubscriptionFromStripe(
      subscription(`sub_${P}stamp2`, qaOrg.id, outsiderPromo.stripePromotionCodeId),
    );
    const stamped2 = await db.attribution.findUnique({ where: { stripeSubscriptionId: `sub_${P}stamp2` } });
    ok("an unrelated influencer's attribution is still written ACTIVE",
      stamped2?.status === "ACTIVE",
      String(stamped2?.status));

    // ── THE CUSTOMER COUPON EXPIRING IS NOT THE COMMISSION ENDING. The coupon is
    //    minted for ONE month, so from cycle two Stripe sends the subscription
    //    with no discount. The old rule ENDED the attribution there and a
    //    "20% for 6 months" code paid one month. ──
    const winPromo = await db.promoCode.create({
      data: {
        influencerId: outsider.id,
        code: "QAINFWINDOW",
        stripeCouponId: "local_coupon_QAINFWINDOW",
        stripePromotionCodeId: "local_promo_QAINFWINDOW",
        commissionType: "PERCENT",
        commissionRateBps: 2000,
        commissionBasis: "NET",
        durationType: "REPEATING",
        durationMonths: 6,
        customerPercentOff: 20,
      },
    });
    const WIN = `sub_${P}window`;
    await freshClient();
    await syncSubscriptionFromStripe(subscription(WIN, qaOrg.id, winPromo.stripePromotionCodeId));
    const m1 = (await accrueForInvoice(invoice(`in_${P}w1`, WIN, `ch_${P}w1`, 6320))) as { accruedCents?: number };
    // Stripe drops the spent one-month coupon:
    await syncSubscriptionFromStripe(subscription(WIN, qaOrg.id, null));
    const afterExpiry = await db.attribution.findUnique({ where: { stripeSubscriptionId: WIN } });
    ok("the attribution survives the customer coupon expiring",
      afterExpiry?.status === "ACTIVE", `status ${afterExpiry?.status}`);
    const later: (number | string)[] = [];
    for (let m = 2; m <= 7; m++) {
      const r = (await accrueForInvoice(invoice(`in_${P}w${m}`, WIN, `ch_${P}w${m}`, 7900))) as {
        accruedCents?: number;
        skipped?: string;
      };
      later.push(r.accruedCents ?? r.skipped ?? "?");
    }
    const winRows = await db.commissionLedger.findMany({
      where: { stripeInvoiceId: { startsWith: `in_${P}w` } },
      select: { amountCents: true },
    });
    const winTotal = winRows.reduce((n, r) => n + r.amountCents, 0);
    ok("a 6-month window pays all six months: 1264 + 5 × 1580 = 9164¢",
      winTotal === 9164 && m1.accruedCents === 1264,
      `${cents(winTotal)} — months 2..7: ${later.join(", ")}`);
    ok("…and not a seventh", later[5] === "outside-window", String(later[5]));

    // A canceled subscription still ends it.
    await syncSubscriptionFromStripe({ ...(subscription(WIN, qaOrg.id, null) as object), status: "canceled" } as never);
    ok("a canceled subscription still ends the attribution",
      (await db.attribution.findUnique({ where: { stripeSubscriptionId: WIN } }))?.status === "ENDED");

    // THE REPAIR: a row the old rule already killed comes back on the next sync.
    // The old rule ended it while the subscription was LIVE: the mirror is put
    // back to that. (A subscription Stripe has ended never comes back — since
    // 2026-10-13 a live payload for it is not written, lib/stripeSync.)
    await db.subscription.updateMany({ where: { externalSubId: WIN }, data: { status: "ACTIVE" } });
    await db.attribution.update({ where: { stripeSubscriptionId: WIN }, data: { status: "ENDED" } });
    await syncSubscriptionFromStripe(subscription(WIN, qaOrg.id, null));
    ok("an attribution ENDED by the old rule is revived on the next sync",
      (await db.attribution.findUnique({ where: { stripeSubscriptionId: WIN } }))?.status === "ACTIVE");
  } finally {
    // The directly-created rows go back into QA Co for the checks that follow.
    await db.attribution.updateMany({ where: { id: { in: parked.map((a) => a.id) } }, data: { organizationId: qaOrg.id } });
    // Put QA Co's subscription mirror back exactly as it was.
    if (mirrorBefore) {
      await db.subscription.update({
        where: { organizationId: qaOrg.id },
        data: {
          plan: mirrorBefore.plan,
          status: mirrorBefore.status,
          provider: mirrorBefore.provider,
          externalCustomerId: mirrorBefore.externalCustomerId,
          externalSubId: mirrorBefore.externalSubId,
          stripePriceId: mirrorBefore.stripePriceId,
          currentPeriodEnd: mirrorBefore.currentPeriodEnd,
          canceledAt: mirrorBefore.canceledAt,
          appliedPromotionCodeId: mirrorBefore.appliedPromotionCodeId,
          appliedCouponId: mirrorBefore.appliedCouponId,
          attributionId: mirrorBefore.attributionId,
        },
      });
    } else {
      await db.subscription.deleteMany({ where: { organizationId: qaOrg.id } });
    }
    if (mirrorRefBefore) {
      await db.syncState.update({ where: { key: mirrorRefKey }, data: { cursor: mirrorRefBefore.cursor } });
    } else {
      await db.syncState.deleteMany({ where: { key: mirrorRefKey } });
    }
    const mirrorAfter = await db.subscription.findUnique({ where: { organizationId: qaOrg.id } });
    ok("QA Co's subscription mirror was restored",
      (mirrorBefore?.plan ?? null) === (mirrorAfter?.plan ?? null) &&
        (mirrorBefore?.externalSubId ?? null) === (mirrorAfter?.externalSubId ?? null) &&
        (mirrorBefore?.attributionId ?? null) === (mirrorAfter?.attributionId ?? null),
      `plan ${mirrorAfter?.plan ?? "(none)"} · sub ${mirrorAfter?.externalSubId ?? "(none)"}`);
  }

  // ── COMMISSION NEVER EXCEEDS THE MONEY COLLECTED, AND A PRORATION IS NOT A
  //    MONTH. ──
  ok("FLAT is capped at its basis: $10 flat on a $4 invoice owes $4",
    computeCommissionCents({ commissionType: "FLAT", commissionFlatCents: 1000, durationType: "FOREVER" }, 400) === 400);
  ok("PERCENT can never exceed its basis either (a 200% rate owes 100%)",
    computeCommissionCents({ commissionType: "PERCENT", commissionRateBps: 20000, durationType: "FOREVER" }, 7900) === 7900);

  const flatPromo = await db.promoCode.create({
    data: {
      influencerId: outsider.id,
      code: "QAINFFLAT",
      stripeCouponId: "local_coupon_QAINFFLAT",
      stripePromotionCodeId: "local_promo_QAINFFLAT",
      commissionType: "FLAT",
      commissionFlatCents: 1000,
      commissionBasis: "GROSS",
      durationType: "REPEATING",
      durationMonths: 3,
    },
  });
  const attrFlat = await db.attribution.create({
    data: {
      influencerId: outsider.id,
      promoCodeId: flatPromo.id,
      organizationId: qaOrg.id,
      stripeCustomerId: `cus_${P}flat`,
      stripeSubscriptionId: `sub_${P}flat`,
      status: "ACTIVE",
    },
  });
  // GROSS basis: subtotal 7900 but only 400 actually collected.
  const tiny = (await accrueForInvoice({
    id: `in_${P}flat-tiny`,
    subscription: attrFlat.stripeSubscriptionId,
    charge: `ch_${P}flat-tiny`,
    paid: true,
    amount_paid: 400,
    subtotal: 7900,
    currency: "usd",
    billing_reason: "subscription_cycle",
  } as never)) as { accruedCents?: number };
  ok("on a GROSS code the cash collected is the cap, not the pre-discount subtotal",
    tiny.accruedCents === 400, `accrued ${cents(tiny.accruedCents ?? 0)} on $4.00 collected (subtotal $79.00)`);

  const monthsBefore = (await db.attribution.findUnique({ where: { id: attrFlat.id } }))?.qualifyingMonths ?? 0;
  const flatPro = (await accrueForInvoice({
    id: `in_${P}flat-pro`,
    subscription: attrFlat.stripeSubscriptionId,
    charge: `ch_${P}flat-pro`,
    paid: true,
    amount_paid: 4300,
    subtotal: 4300,
    currency: "usd",
    billing_reason: "subscription_update",
  } as never)) as { accruedCents?: number; skipped?: string };
  ok("FLAT pays nothing on a proration — it is per billing period",
    flatPro.skipped === "flat-on-proration", String(flatPro.skipped ?? flatPro.accruedCents));
  ok("…and the proration spends no month of the window",
    (await db.attribution.findUnique({ where: { id: attrFlat.id } }))?.qualifyingMonths === monthsBefore);

  const pctPro = (await accrueForInvoice({
    id: `in_${P}pct-pro`,
    subscription: attrOut.stripeSubscriptionId,
    charge: `ch_${P}pct-pro`,
    paid: true,
    amount_paid: 4300,
    subtotal: 4300,
    currency: "usd",
    billing_reason: "subscription_update",
  } as never)) as { accruedCents?: number };
  const outMonths = (await db.attribution.findUnique({ where: { id: attrOut.id } }))?.qualifyingMonths;
  ok("PERCENT still accrues on a proration — 20% of the 4300¢ actually collected",
    pctPro.accruedCents === 860, `accrued ${cents(pctPro.accruedCents ?? 0)}`);
  const outMonthsAfter = (await db.attribution.findUnique({ where: { id: attrOut.id } }))?.qualifyingMonths;
  ok("…without spending a month", outMonths === outMonthsAfter);

  // The rate bound is on the server, at all three writers.
  const infSrc = readFileSync("src/actions/influencers.ts", "utf8");

  // rejectPayoutRequest may only touch a request no money has moved for. The
  // action needs an admin session, so the guard is pinned in its source; the
  // predicate itself is exercised by the conditional write it compiles to.
  const rejectStart = infSrc.indexOf("export async function rejectPayoutRequest");
  const rejectBody = infSrc.slice(rejectStart, infSrc.indexOf("\nexport ", rejectStart + 1));
  ok("reject is a conditional write limited to PENDING and APPROVED",
    /updateMany\(\{\s*where: \{ id, status: \{ in: \[PayoutRequestStatus\.PENDING, PayoutRequestStatus\.APPROVED\] \} \}/.test(rejectBody),
    rejectStart === -1 ? "function not found" : "");
  const guarded = await db.payoutRequest.create({
    data: { influencerId: outsider.id, amountCents: 1000, currency: "usd", status: "PAID" },
  });
  const flipped = await db.payoutRequest.updateMany({
    where: { id: guarded.id, status: { in: ["PENDING", "APPROVED"] } },
    data: { status: "REJECTED" },
  });
  ok("…and that predicate leaves a PAID request alone",
    flipped.count === 0 && (await db.payoutRequest.findUnique({ where: { id: guarded.id } }))?.status === "PAID");
  await db.payoutRequest.delete({ where: { id: guarded.id } });
  ok("the percent bound is applied at all three writers (create, add code, edit)",
    (infSrc.match(/\.superRefine\(boundRate\)/g) ?? []).length === 3 && /commissionValue > 100/.test(infSrc));

  // ── PAYOUT REFUSALS ARE WORDS. One wording, shared by the server action and
  //    the button's hint, so the two cannot contradict each other. ──
  const base = { payoutsEnabled: true, connectStatus: "ENABLED", minPayoutCents: 2500, clearedCents: 9000, openRequestStatus: null };
  const words = (s: string | null) => typeof s === "string" && s.length > 20 && /[a-z]/.test(s);

  ok("a payable request is allowed", payoutRequestRefusal(base) === null, String(payoutRequestRefusal(base)));

  const belowMin = payoutRequestRefusal({ ...base, clearedCents: 1200 });
  ok("below the minimum is refused in words", words(belowMin), String(belowMin));
  ok("the refusal names BOTH numbers, not just the threshold",
    (belowMin ?? "").includes("$25.00") && (belowMin ?? "").includes("$12.00"),
    String(belowMin));

  const noConnect = payoutRequestRefusal({ ...base, payoutsEnabled: false, connectStatus: "NONE" });
  ok("payoutsEnabled=false is refused in words", words(noConnect), String(noConnect));
  const halfConnect = payoutRequestRefusal({ ...base, payoutsEnabled: false, connectStatus: "RESTRICTED" });
  ok("a half-finished Stripe setup says so, not 'connect an account'",
    words(halfConnect) && halfConnect !== noConnect,
    String(halfConnect));
  ok("payoutsEnabled=true but connectStatus not ENABLED is still refused",
    words(payoutRequestRefusal({ ...base, payoutsEnabled: true, connectStatus: "RESTRICTED" })));

  for (const st of ["PENDING", "APPROVED", "PROCESSING"]) {
    const stacked = payoutRequestRefusal({ ...base, openRequestStatus: st });
    ok(`a second request while one is ${st} is refused in words`, words(stacked), String(stacked));
  }
  ok("a FAILED or REJECTED request does not block the next one",
    payoutRequestRefusal({ ...base, openRequestStatus: null }) === null);

  // The action must RETURN the refusal, not throw it: production redacts thrown
  // Server Action messages, so a throw would reach the partner as Next's
  // generic fault paragraph.
  const src = readFileSync("src/actions/influencers.ts", "utf8");
  const start = src.indexOf("export async function requestPayout");
  const rest = src.slice(start + 1);
  const next = rest.indexOf("\nexport ");
  const body = next === -1 ? rest : rest.slice(0, next);
  ok("requestPayout is the function this check is pinning", start !== -1 && body.includes("payoutRequestRefusal("));
  ok("requestPayout RETURNS the refusal rather than throwing it",
    body.includes("return { ok: false, error: refusal }") && !body.includes("throw new Error"),
    body.includes("throw new Error") ? "it still throws — production would redact the message" : "returns an envelope");

  console.log(`\n${passes} passed, ${failures} failed`);
  const removed = await cleanup();
  console.log(`      · cleaned up ${removed} influencer(s) and everything hanging off them`);
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
