// An upgrade neither restarts the commission window nor re-issues the coupon —
// through the REAL handlers, no Stripe call.
//
//   npx tsx --tsconfig tsconfig.json qa/tests/billing/influencer-upgrade.check.ts
//
// The owner's rule (2026-09-22): the window is counted per client
// (organisation), not per Stripe subscription. The attribution — months already
// counted — moves to the new subscription; a 7th month is refused even though
// the subscription is new; commission after the upgrade is on the new invoice
// amount; the upgrade checkout does not pass the discount code again.
//
// H–J (review follow-ups): a pre-upgrade invoice delivered after the move is
// still the client's month; a signup subscription first synced before its
// organisation existed keeps its partner through an upgrade; a comped or
// never-referred organisation gets the right checkout.
//
// G: the billing mirror follows only forward as well — the reconcile replay of
// the cancelled predecessor must not take QA Co's mirror back to it (FREE limits
// while paying, and a next checkout that replaces nothing), nor overwrite a comp.
//
// Runs in **QA Co** (slug `qa-co`). syncSubscriptionFromStripe upserts QA Co's
// billing mirror, so the mirror (and its mirrorSubAt reference) is snapshotted
// first and put back at the end, pass or fail. Rows are prefixed `qa-upg-` and
// removed on the way out.

delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_SECRET_KEY_TEST;

import "../_lib/_server-only"; // `server-only` outside Next — see the file
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { accrueForInvoice, markSubscriptionCanceled, syncSubscriptionFromStripe } from "../../../src/lib/stripeSync";
import { checkoutDiscount } from "../../../src/lib/checkoutDiscount";

const db = new PrismaClient();
const QA_SLUG = "qa-co";
const P = "qa-upg-";

let passes = 0;
let failures = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) passes++;
  else failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};
const c = (n: number) => `$${(n / 100).toFixed(2)}`;
const head = (s: string) => console.log(`\n── ${s}`);
const t = (iso: string) => Math.floor(Date.parse(iso) / 1000);

function subscription(o: {
  id: string;
  customer: string;
  orgId: string | null;
  promotionCodeId: string | null;
  created: number;
  status?: string;
  price?: string;
}) {
  return {
    id: o.id,
    customer: o.customer,
    status: o.status ?? "active",
    created: o.created,
    metadata: o.orgId ? { organizationId: o.orgId } : {},
    items: { data: [{ price: { id: o.price ?? `price_${P}79` } }] },
    current_period_end: o.created + 30 * 86400,
    canceled_at: o.status === "canceled" ? o.created + 60 : null,
    discount: o.promotionCodeId ? { promotion_code: o.promotionCodeId, coupon: null } : null,
  } as never;
}
function invoice(o: { id: string; sub: string; customer: string; paid: number; created: number; reason?: string }) {
  return {
    id: o.id,
    subscription: o.sub,
    customer: o.customer,
    charge: `ch_${o.id}`,
    paid: true,
    amount_paid: o.paid,
    subtotal: o.paid,
    currency: "usd",
    created: o.created,
    billing_reason: o.reason ?? "subscription_cycle",
  } as never;
}

async function partnerWithPromo(suffix: string, over: Record<string, unknown> = {}) {
  const inf = await db.influencer.create({
    data: { email: `${P}${suffix}@jobflex.test`, displayName: `QA Upg ${suffix}`, status: "ACTIVE", holdDays: 30, minPayoutCents: 100 },
  });
  const promo = await db.promoCode.create({
    data: {
      influencerId: inf.id,
      code: `QAUPG${suffix.toUpperCase().replace(/[^A-Z0-9]/g, "")}`,
      stripeCouponId: `local_coupon_${P}${suffix}`,
      stripePromotionCodeId: `local_promo_${P}${suffix}`,
      commissionType: "PERCENT",
      commissionRateBps: 2000,
      commissionBasis: "NET",
      durationType: "REPEATING",
      durationMonths: 6,
      customerPercentOff: 20,
      ...over,
    },
  });
  return { inf, promo };
}

async function attributionsFor(orgId: string) {
  return db.attribution.findMany({
    where: { organizationId: orgId, influencer: { email: { startsWith: P } } },
    select: { id: true, stripeSubscriptionId: true, status: true, qualifyingMonths: true },
  });
}

async function cleanup() {
  const infs = await db.influencer.findMany({ where: { email: { startsWith: P } }, select: { id: true } });
  const ids = infs.map((i) => i.id);
  const attrs = await db.attribution.findMany({ where: { influencerId: { in: ids } }, select: { id: true } });
  await db.syncState.deleteMany({ where: { key: { in: attrs.map((a) => `attributionSubAt:${a.id}`) } } });
  await db.syncState.deleteMany({ where: { key: { startsWith: `attributionFrom:sub_${P}` } } });
  if (ids.length) {
    await db.commissionLedger.deleteMany({ where: { influencerId: { in: ids } } });
    await db.attribution.deleteMany({ where: { influencerId: { in: ids } } });
    await db.promoCode.deleteMany({ where: { influencerId: { in: ids } } });
    await db.influencer.deleteMany({ where: { id: { in: ids } } });
  }
  return ids.length;
}

async function main() {
  await cleanup();
  const qaOrg = await db.organization.findUnique({ where: { slug: QA_SLUG }, select: { id: true, name: true } });
  if (!qaOrg) {
    console.error(`FAIL  QA Co (slug ${QA_SLUG}) is not seeded in this database — run the seed first.`);
    process.exit(1);
  }
  const org = qaOrg.id;
  console.log(`upgrades · ${qaOrg.name} (${QA_SLUG}) · real handlers · no Stripe calls`);
  const mirrorBefore = await db.subscription.findUnique({ where: { organizationId: org } });
  const refKey = `mirrorSubAt:${org}`;
  const refBefore = await db.syncState.findUnique({ where: { key: refKey } });
  const mirror = () => db.subscription.findUnique({ where: { organizationId: org }, select: { externalSubId: true, status: true, plan: true, provider: true } });
  // The route's own predicate for the subscription a checkout replaces.
  const replaces = (m: { externalSubId: string | null; status: string } | null) =>
    m?.externalSubId && (m.status === "ACTIVE" || m.status === "TRIALING") ? m.externalSubId : null;

  try {
    // ═══ A. Three months, then an upgrade to a new subscription ═══
    head("A · three months on Starter, upgrade to Pro in month 4 — the window carries");
    const { promo } = await partnerWithPromo("main");
    const CUS = `cus_${P}main`;
    const OLD = `sub_${P}old`;
    const NEW = `sub_${P}new`;
    await syncSubscriptionFromStripe(subscription({ id: OLD, customer: CUS, orgId: org, promotionCodeId: promo.stripePromotionCodeId, created: t("2026-06-01T00:00:00Z") }));
    const m = [
      await accrueForInvoice(invoice({ id: `in_${P}m1`, sub: OLD, customer: CUS, paid: 6320, created: t("2026-06-01T00:00:10Z"), reason: "subscription_create" })),
      await accrueForInvoice(invoice({ id: `in_${P}m2`, sub: OLD, customer: CUS, paid: 7900, created: t("2026-07-01T00:00:00Z") })),
      await accrueForInvoice(invoice({ id: `in_${P}m3`, sub: OLD, customer: CUS, paid: 7900, created: t("2026-08-01T00:00:00Z") })),
    ] as { accruedCents?: number }[];
    ok("months 1–3 accrue 1264 / 1580 / 1580", m.map((x) => x.accruedCents).join(",") === "1264,1580,1580");

    // The upgrade: a NEW subscription, created later, arriving WITHOUT the
    // discount (our Checkout no longer passes the code on a replacement).
    await syncSubscriptionFromStripe(subscription({ id: NEW, customer: CUS, orgId: org, promotionCodeId: null, created: t("2026-08-15T00:00:00Z"), price: `price_${P}149` }));
    let attrs = await attributionsFor(org);
    ok("still ONE attribution for the client, now on the new subscription",
      attrs.length === 1 && attrs[0].stripeSubscriptionId === NEW, JSON.stringify(attrs));
    ok("with its three counted months and ACTIVE", attrs[0]?.qualifyingMonths === 3 && attrs[0]?.status === "ACTIVE",
      `months ${attrs[0]?.qualifyingMonths} · ${attrs[0]?.status}`);

    await markSubscriptionCanceled(subscription({ id: OLD, customer: CUS, orgId: org, promotionCodeId: null, created: t("2026-06-01T00:00:00Z"), status: "canceled" }));
    attrs = await attributionsFor(org);
    ok("cancelling the OLD subscription does not end it", attrs[0]?.status === "ACTIVE" && attrs[0]?.stripeSubscriptionId === NEW);

    const after: (number | string)[] = [];
    for (const [i, month] of ["2026-08-15", "2026-09-15", "2026-10-15", "2026-11-15"].entries()) {
      const r = (await accrueForInvoice(invoice({
        id: `in_${P}n${i + 4}`,
        sub: NEW,
        customer: CUS,
        paid: 14900,
        created: t(`${month}T00:00:05Z`),
        reason: i === 0 ? "subscription_create" : "subscription_cycle",
      }))) as { accruedCents?: number; skipped?: string };
      after.push(r.accruedCents ?? r.skipped ?? "?");
    }
    ok("months 4–6 accrue on the NEW amount: 20% of $149 = 2980¢", after.slice(0, 3).join(",") === "2980,2980,2980", after.join(", "));
    ok("the 7th month is refused, though the subscription is new", after[3] === "outside-window", String(after[3]));
    const ledger = await db.commissionLedger.findMany({ where: { stripeInvoiceId: { startsWith: `in_${P}` } }, select: { amountCents: true } });
    const total = ledger.reduce((n, r) => n + r.amountCents, 0);
    ok("six months in total: 1264 + 2 × 1580 + 3 × 2980 = 13364¢", total === 13364, c(total));

    // ═══ B. The reconcile cron replays the OLD subscription and its invoices ═══
    head("B · the reconcile replay (old subscription and its invoices) cannot pull it back");
    await syncSubscriptionFromStripe(subscription({ id: OLD, customer: CUS, orgId: org, promotionCodeId: null, created: t("2026-06-01T00:00:00Z"), status: "canceled" }));
    await accrueForInvoice(invoice({ id: `in_${P}m2`, sub: OLD, customer: CUS, paid: 7900, created: t("2026-07-01T00:00:00Z") }));
    attrs = await attributionsFor(org);
    ok("still on the new subscription, still ACTIVE, months unchanged",
      attrs.length === 1 && attrs[0].stripeSubscriptionId === NEW && attrs[0].status === "ACTIVE" && attrs[0].qualifyingMonths === 6,
      JSON.stringify(attrs[0]));
    let mNow = await mirror();
    ok("QA Co's billing mirror stays on the live Pro subscription — not the cancelled Starter one",
      mNow?.externalSubId === NEW && mNow?.status === "ACTIVE", JSON.stringify(mNow));
    ok("so the next checkout replaces the live subscription instead of billing beside it",
      replaces(mNow) === NEW, String(replaces(mNow)));
    const routeSrc = readFileSync("src/app/api/checkout/subscription/route.ts", "utf8");
    ok("(the route computes replacesSubId from the mirror exactly so)",
      /const replacesSubId =\s*sub\?\.externalSubId && \(sub\.status === "ACTIVE" \|\| sub\.status === "TRIALING"\)/.test(routeSrc));
    await syncSubscriptionFromStripe(subscription({ id: NEW, customer: CUS, orgId: org, promotionCodeId: null, created: t("2026-08-15T00:00:00Z"), price: `price_${P}149` }));
    ok("…and re-syncing the new one changes nothing", (await attributionsFor(org))[0]?.stripeSubscriptionId === NEW);
    // An upgrade inside month 1: the OLD subscription is replayed still carrying
    // the partner's discount. It must not become a second client with a fresh window.
    await syncSubscriptionFromStripe(subscription({ id: OLD, customer: CUS, orgId: org, promotionCodeId: promo.stripePromotionCodeId, created: t("2026-06-01T00:00:00Z") }));
    attrs = await attributionsFor(org);
    ok("the old subscription replayed WITH its discount creates no second attribution",
      attrs.length === 1 && attrs[0].stripeSubscriptionId === NEW && attrs[0].qualifyingMonths === 6, JSON.stringify(attrs));
    await cleanup();

    // ═══ G. A comp is not overwritten by the subscription it replaced ═══
    head("G · an operator's comp: neither the cancelled nor the still-live old subscription takes the mirror back");
    await db.subscription.update({
      where: { organizationId: org },
      data: { plan: "PROFESSIONAL", status: "ACTIVE", provider: "MANUAL", externalSubId: null, stripePriceId: null },
    });
    await syncSubscriptionFromStripe(subscription({ id: NEW, customer: CUS, orgId: org, promotionCodeId: null, created: t("2026-08-15T00:00:00Z"), status: "canceled" }));
    mNow = await mirror();
    ok("the cancelled predecessor leaves the comp alone", mNow?.provider === "MANUAL" && mNow?.status === "ACTIVE" && mNow?.externalSubId === null, JSON.stringify(mNow));
    await syncSubscriptionFromStripe(subscription({ id: NEW, customer: CUS, orgId: org, promotionCodeId: null, created: t("2026-08-15T00:00:00Z"), price: `price_${P}149` }));
    mNow = await mirror();
    ok("…and so does a late event of it while still live", mNow?.provider === "MANUAL" && mNow?.externalSubId === null, JSON.stringify(mNow));
    const LATER = `sub_${P}later`;
    await syncSubscriptionFromStripe(subscription({ id: LATER, customer: CUS, orgId: org, promotionCodeId: null, created: Math.floor(Date.now() / 1000) }));
    mNow = await mirror();
    ok("a subscription bought after the comp does take it over", mNow?.externalSubId === LATER && mNow?.provider === "STRIPE", JSON.stringify(mNow));
    await cleanup();

    // ═══ C. The new subscription's first invoice arrives before its created event ═══
    head("C · the replacement's first invoice lands before customer.subscription.created");
    const c1 = await partnerWithPromo("early");
    const CUS2 = `cus_${P}early`;
    await syncSubscriptionFromStripe(subscription({ id: `sub_${P}early-old`, customer: CUS2, orgId: org, promotionCodeId: c1.promo.stripePromotionCodeId, created: t("2026-06-01T00:00:00Z") }));
    await accrueForInvoice(invoice({ id: `in_${P}e1`, sub: `sub_${P}early-old`, customer: CUS2, paid: 6320, created: t("2026-06-01T00:00:10Z") }));
    const early = (await accrueForInvoice(invoice({ id: `in_${P}e2`, sub: `sub_${P}early-new`, customer: CUS2, paid: 14900, created: t("2026-07-10T00:00:00Z"), reason: "subscription_create" }))) as { accruedCents?: number; skipped?: string };
    attrs = await attributionsFor(org);
    ok("the invoice carries the attribution and is paid as month 2 — not skipped",
      early.accruedCents === 2980 && attrs.length === 1 && attrs[0].stripeSubscriptionId === `sub_${P}early-new` && attrs[0].qualifyingMonths === 2,
      `${JSON.stringify(early)} · ${JSON.stringify(attrs[0])}`);
    await cleanup();

    // ═══ D. Cancel, come back months later ═══
    head("D · cancel and come back later: the window continues, it does not restart");
    const d1 = await partnerWithPromo("back", { durationMonths: 3 });
    const CUS3 = `cus_${P}back`;
    await syncSubscriptionFromStripe(subscription({ id: `sub_${P}back1`, customer: CUS3, orgId: org, promotionCodeId: d1.promo.stripePromotionCodeId, created: t("2026-01-01T00:00:00Z") }));
    await accrueForInvoice(invoice({ id: `in_${P}b1`, sub: `sub_${P}back1`, customer: CUS3, paid: 7900, created: t("2026-01-01T00:00:10Z") }));
    await accrueForInvoice(invoice({ id: `in_${P}b2`, sub: `sub_${P}back1`, customer: CUS3, paid: 7900, created: t("2026-02-01T00:00:00Z") }));
    await markSubscriptionCanceled(subscription({ id: `sub_${P}back1`, customer: CUS3, orgId: org, promotionCodeId: null, created: t("2026-01-01T00:00:00Z"), status: "canceled" }));
    ok("ended with the cancellation", (await attributionsFor(org))[0]?.status === "ENDED");
    await syncSubscriptionFromStripe(subscription({ id: `sub_${P}back2`, customer: CUS3, orgId: org, promotionCodeId: null, created: t("2026-06-01T00:00:00Z") }));
    const back = [
      await accrueForInvoice(invoice({ id: `in_${P}b3`, sub: `sub_${P}back2`, customer: CUS3, paid: 7900, created: t("2026-06-01T00:00:10Z") })),
      await accrueForInvoice(invoice({ id: `in_${P}b4`, sub: `sub_${P}back2`, customer: CUS3, paid: 7900, created: t("2026-07-01T00:00:00Z") })),
    ] as { accruedCents?: number; skipped?: string }[];
    ok("the 3rd month of a 3-month code is paid, the 4th refused — counted per client",
      back[0].accruedCents === 1580 && back[1].skipped === "outside-window", JSON.stringify(back));
    await cleanup();

    // ═══ E. A self-referral stays VOID across the move ═══
    head("E · a VOID (self-referral) attribution moves but stays VOID");
    const e1 = await partnerWithPromo("void");
    await syncSubscriptionFromStripe(subscription({ id: `sub_${P}void1`, customer: `cus_${P}void`, orgId: org, promotionCodeId: e1.promo.stripePromotionCodeId, created: t("2026-05-01T00:00:00Z") }));
    await db.attribution.updateMany({ where: { stripeSubscriptionId: `sub_${P}void1` }, data: { status: "VOID" } });
    await syncSubscriptionFromStripe(subscription({ id: `sub_${P}void2`, customer: `cus_${P}void`, orgId: org, promotionCodeId: null, created: t("2026-06-01T00:00:00Z") }));
    const ev = await attributionsFor(org);
    ok("moved to the new subscription and still VOID", ev[0]?.stripeSubscriptionId === `sub_${P}void2` && ev[0]?.status === "VOID", JSON.stringify(ev[0]));
    await cleanup();

    // ═══ H. The month before the upgrade, delivered after it ═══
    head("H · month 3's invoice lands after the upgrade moved the client: still paid, still counted");
    const h1 = await partnerWithPromo("late3");
    const CUSH = `cus_${P}late3`;
    const H_OLD = `sub_${P}late3-old`;
    const H_NEW = `sub_${P}late3-new`;
    await syncSubscriptionFromStripe(subscription({ id: H_OLD, customer: CUSH, orgId: org, promotionCodeId: h1.promo.stripePromotionCodeId, created: t("2026-06-01T00:00:00Z") }));
    await accrueForInvoice(invoice({ id: `in_${P}h1`, sub: H_OLD, customer: CUSH, paid: 6320, created: t("2026-06-01T00:00:10Z") }));
    await accrueForInvoice(invoice({ id: `in_${P}h2`, sub: H_OLD, customer: CUSH, paid: 7900, created: t("2026-07-01T00:00:00Z") }));
    await syncSubscriptionFromStripe(subscription({ id: H_NEW, customer: CUSH, orgId: org, promotionCodeId: null, created: t("2026-08-15T00:00:00Z"), price: `price_${P}149` }));
    const h3 = (await accrueForInvoice(invoice({ id: `in_${P}h3`, sub: H_OLD, customer: CUSH, paid: 7900, created: t("2026-08-01T00:00:00Z") }))) as { accruedCents?: number; skipped?: string };
    attrs = await attributionsFor(org);
    ok("the old subscription's month 3 accrues 1580¢ to the same client — the row stays on the new subscription",
      h3.accruedCents === 1580 && attrs.length === 1 && attrs[0].stripeSubscriptionId === H_NEW && attrs[0].qualifyingMonths === 3,
      `${JSON.stringify(h3)} · ${JSON.stringify(attrs[0])}`);
    const hNew: (number | string)[] = [];
    for (const [i, month] of ["2026-08-15", "2026-09-15", "2026-10-15", "2026-11-15"].entries()) {
      const r = (await accrueForInvoice(invoice({ id: `in_${P}hn${i}`, sub: H_NEW, customer: CUSH, paid: 14900, created: t(`${month}T00:00:05Z`) }))) as { accruedCents?: number; skipped?: string };
      hNew.push(r.accruedCents ?? r.skipped ?? "?");
    }
    ok("the new subscription pays months 4–6 and refuses a 7th", hNew.join(",") === "2980,2980,2980,outside-window", hNew.join(", "));
    const hAgain = (await accrueForInvoice(invoice({ id: `in_${P}h3`, sub: H_OLD, customer: CUSH, paid: 7900, created: t("2026-08-01T00:00:00Z") }))) as { skipped?: string };
    const hRows = await db.commissionLedger.count({ where: { stripeInvoiceId: `in_${P}h3` } });
    ok("replaying it writes nothing and counts nothing", Boolean(hAgain.skipped) && hRows === 1 && (await attributionsFor(org))[0]?.qualifyingMonths === 6, `${hAgain.skipped} · ${hRows} row(s)`);
    await cleanup();

    // ═══ I. A signup subscription synced before its organisation existed ═══
    head("I · signup: the first sync cannot map the subscription; an upgrade follows; the partner is not lost");
    const i1 = await partnerWithPromo("signup");
    const CUSI = `cus_${P}signup`;
    const I_OLD = `sub_${P}signup-old`;
    const I_NEW = `sub_${P}signup-new`;
    // customer.subscription.created, before the completion page made the org: no metadata, no mirror.
    await syncSubscriptionFromStripe(subscription({ id: I_OLD, customer: CUSI, orgId: null, promotionCodeId: i1.promo.stripePromotionCodeId, created: t("2026-06-01T00:00:00Z") }));
    ok("set-up: nothing could be written yet", (await attributionsFor(org)).length === 0);
    // The completion page writes the mirror (its own upsert, no sync — the old behaviour).
    // A brand-new organisation has no mirror reference yet.
    await db.syncState.deleteMany({ where: { key: refKey } });
    await db.subscription.upsert({
      where: { organizationId: org },
      update: { status: "ACTIVE", provider: "STRIPE", externalCustomerId: CUSI, externalSubId: I_OLD },
      create: { organizationId: org, plan: "STARTER", status: "ACTIVE", provider: "STRIPE", externalCustomerId: CUSI, externalSubId: I_OLD },
    });
    // The upgrade, before any other event for the old subscription.
    await syncSubscriptionFromStripe(subscription({ id: I_NEW, customer: CUSI, orgId: org, promotionCodeId: null, created: t("2026-07-10T00:00:00Z"), price: `price_${P}149` }));
    // The reconcile cron: newest first — the new subscription, then the old one (now cancelled).
    await syncSubscriptionFromStripe(subscription({ id: I_NEW, customer: CUSI, orgId: org, promotionCodeId: null, created: t("2026-07-10T00:00:00Z"), price: `price_${P}149` }));
    await syncSubscriptionFromStripe(subscription({ id: I_OLD, customer: CUSI, orgId: null, promotionCodeId: i1.promo.stripePromotionCodeId, created: t("2026-06-01T00:00:00Z"), status: "canceled" }));
    const iNew = (await accrueForInvoice(invoice({ id: `in_${P}i2`, sub: I_NEW, customer: CUSI, paid: 14900, created: t("2026-07-10T00:00:05Z") }))) as { accruedCents?: number };
    const iOld = (await accrueForInvoice(invoice({ id: `in_${P}i1`, sub: I_OLD, customer: CUSI, paid: 6320, created: t("2026-06-01T00:00:10Z") }))) as { accruedCents?: number };
    attrs = await attributionsFor(org);
    ok("the old subscription is mapped through its customer: one attribution, on the new subscription, both months paid",
      attrs.length === 1 && attrs[0].stripeSubscriptionId === I_NEW && attrs[0].qualifyingMonths === 2 && iNew.accruedCents === 2980 && iOld.accruedCents === 1264,
      `${JSON.stringify(attrs)} · new ${JSON.stringify(iNew)} · old ${JSON.stringify(iOld)}`);
    const mI = await mirror();
    ok("…and the mirror stays on the new subscription", mI?.externalSubId === I_NEW && mI?.status === "ACTIVE", JSON.stringify(mI));
    const signupSrc = readFileSync("src/actions/signupCheckout.ts", "utf8");
    ok("the completion page now syncs the expanded subscription itself, after writing the mirror",
      signupSrc.indexOf("syncSubscriptionFromStripe(stripeSubscription,") > signupSrc.indexOf("where: { organizationId: orgId }"));
    await cleanup();

    // ═══ F. The coupon is not issued a second time ═══
    head("F · the upgrade checkout passes no code and opens no promo field");
    const upg = checkoutDiscount({ everSubscribed: true, promotionCode: "promo_live_x", referralCoupon: "coupon_ref" });
    ok("a replacement checkout carries no discount and no promo field — for a referred client",
      upg.kind === "none" && !("discounts" in upg.params) && !("allow_promotion_codes" in upg.params), JSON.stringify(upg));
    const plain = checkoutDiscount({ everSubscribed: true, promotionCode: null, referralCoupon: null });
    ok("…and for a customer that never had a partner: a code is accepted at signup, nowhere else (owner, 2026-09-22)",
      plain.kind === "none" && !("allow_promotion_codes" in plain.params), JSON.stringify(plain));
    ok("the first subscription still gets the partner's code",
      checkoutDiscount({ everSubscribed: false, promotionCode: "promo_live_x", referralCoupon: null }).kind === "promo");
    ok("…or the referral coupon, or an open field when there is neither",
      checkoutDiscount({ everSubscribed: false, promotionCode: null, referralCoupon: "c" }).kind === "referral" &&
        checkoutDiscount({ everSubscribed: false, promotionCode: null, referralCoupon: null }).kind === "open");
    const route = readFileSync("src/app/api/checkout/subscription/route.ts", "utf8");
    ok("the route decides everSubscribed before resolving any promo, and asks checkoutDiscount",
      route.indexOf("const everSubscribed") > -1 &&
        route.indexOf("const everSubscribed") < route.indexOf("let promoForCheckout") &&
        /org\?\.signupPromoCodeId && !everSubscribed/.test(route) &&
        /checkoutDiscount\(\{\s*everSubscribed,\s*promotionCode/.test(route));
    ok("a comp does not make a client new again: everSubscribed also reads the customer and any attribution",
      /const everSubscribed = Boolean\(sub\?\.externalSubId \|\| sub\?\.externalCustomerId \|\| priorAttribution\)/.test(route));
    ok("nothing in the code sets a customer-level discount a new subscription could inherit",
      !/customers\.(create|update)\([\s\S]{0,300}(coupon|promotion_code)/.test(readFileSync("src/lib/referralRewards.ts", "utf8")));
  } finally {
    // Put QA Co's billing mirror back exactly as it was.
    if (mirrorBefore) {
      await db.subscription.update({
        where: { organizationId: org },
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
      await db.subscription.deleteMany({ where: { organizationId: org } });
    }
    if (refBefore) {
      await db.syncState.update({ where: { key: refKey }, data: { cursor: refBefore.cursor } });
    } else {
      await db.syncState.deleteMany({ where: { key: refKey } });
    }
    const now = await db.subscription.findUnique({ where: { organizationId: org } });
    ok("QA Co's billing mirror was restored",
      (mirrorBefore?.externalSubId ?? null) === (now?.externalSubId ?? null) && (mirrorBefore?.plan ?? null) === (now?.plan ?? null));
  }

  console.log(`\n${passes} passed, ${failures} failed`);
  const removed = await cleanup();
  console.log(`      · cleaned up ${removed} partner(s)`);
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
