// Plan and term changes, first-month codes on a yearly bill, the checkout's
// discount — the pure rules behind the 2026-10-12 money fixes — and the changes
// that half-fail, run through lib/planChange on an in-memory Stripe (no network)
// and a throwaway organisation in the dev database, removed at the end.
//   npx --no-install tsx --tsconfig tsconfig.json scripts/qa/plan-change.check.ts
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_SECRET_KEY_TEST;
import "./_server-only";
import { PrismaClient } from "@prisma/client";
import { applyPlanChange, releaseScheduledSwitch, type PlanChangeDeps } from "../../src/lib/planChange";
import { changeRoute } from "../../src/lib/planChangeRoute";
import { firstBillCents, firstMonthOffCents } from "../../src/lib/firstMonthDiscount";
import { checkoutDiscount } from "../../src/lib/checkoutDiscount";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

// ── how a change is made (lib/planChangeRoute) ─────────────────────────────
// Ladder: Starter 0 · Professional 1 · Advanced 2 · Custom -1.
const base = { trialing: false, rankFrom: 1, rankTo: 1, currentCents: 9500, targetCents: 9500, lines: 1 } as const;
const r = (o: Partial<Parameters<typeof changeRoute>[0]> & { from: "MONTH" | "YEAR"; to: "MONTH" | "YEAR" }) => changeRoute({ ...base, ...o });
check("Pro monthly → Pro annual: charged today (the unused month credited)", r({ from: "MONTH", to: "YEAR", targetCents: 79000 }) === "charge");
check("Starter monthly → Pro annual (up + term): charged today", r({ from: "MONTH", to: "YEAR", rankFrom: 0, rankTo: 1, currentCents: 4500, targetCents: 79000 }) === "charge");
check("Advanced monthly → Pro annual (down + term): charged today, never free", r({ from: "MONTH", to: "YEAR", rankFrom: 2, rankTo: 1, currentCents: 19900, targetCents: 79000 }) === "charge");
check("Pro annual → Pro monthly: from the end of the paid year", r({ from: "YEAR", to: "MONTH" }) === "schedule");
check("Advanced annual → Pro monthly: from the end of the paid year", r({ from: "YEAR", to: "MONTH", rankFrom: 2, rankTo: 1, currentCents: 199000, targetCents: 9500 }) === "schedule");
check("Starter annual → Advanced monthly (up + year→month): still from the year's end", r({ from: "YEAR", to: "MONTH", rankFrom: 0, rankTo: 2, currentCents: 29000, targetCents: 19900 }) === "schedule");
check("Starter monthly → Pro monthly (up by tier): Stripe's page", r({ from: "MONTH", to: "MONTH", rankFrom: 0, rankTo: 1, currentCents: 4500 }) === "checkout");
check("Advanced annual → Pro annual (down, same term): free now", r({ from: "YEAR", to: "YEAR", rankFrom: 2, rankTo: 1, currentCents: 199000, targetCents: 79000 }) === "free");
check("Pro monthly → Starter monthly: free now", r({ from: "MONTH", to: "MONTH", rankFrom: 1, rankTo: 0, targetCents: 4500 }) === "free");
check("dearer price on the same term but not up by tier: charged today", r({ from: "MONTH", to: "MONTH", rankFrom: 1, rankTo: 1, currentCents: 4000, targetCents: 9500 }) === "charge");
check("in a trial, any change: swapped, the trial runs on", r({ trialing: true, from: "YEAR", to: "MONTH" }) === "trial" && r({ trialing: true, from: "MONTH", to: "YEAR" }) === "trial");
check("Custom (two lines) monthly → annual catalog plan: Stripe's page", r({ from: "MONTH", to: "YEAR", rankFrom: -1, rankTo: 1, lines: 2, currentCents: 4000, targetCents: 79000 }) === "checkout");
check("Custom (two lines) annual → monthly catalog plan: booked for the year's end", r({ from: "YEAR", to: "MONTH", rankFrom: -1, rankTo: 1, lines: 2, currentCents: 40000 }) === "schedule");
check("Custom (two lines) → cheaper catalog plan, same term: free now", r({ from: "MONTH", to: "MONTH", rankFrom: -1, rankTo: -1, lines: 2, currentCents: 6000, targetCents: 4500 }) === "free");

// ── a first-month code on a yearly bill (lib/firstMonthDiscount) ───────────
check("20% of one Advanced month = $39.80", firstMonthOffCents(19900, 20) === 3980);
check("Advanced annual with a 20% code: $1,990 − $39.80 = $1,950.20", firstBillCents("YEAR", 199000, 19900, 20) === 195020, String(firstBillCents("YEAR", 199000, 19900, 20)));
check("Professional annual with the 10% referral: $790 − $9.50 = $780.50", firstBillCents("YEAR", 79000, 9500, 10) === 78050);
check("Professional monthly with 20%: $76 (unchanged rule)", firstBillCents("MONTH", 9500, 9500, 20) === 7600);
check("Starter monthly with 10%: $40.50 (unchanged rule)", firstBillCents("MONTH", 4500, 4500, 10) === 4050);
check("no code: the price itself", firstBillCents("YEAR", 79000, 9500, 0) === 79000);
check("a yearly bill never goes below $0", firstBillCents("YEAR", 100, 9500, 100) === 0);

// ── the plan checkout's discount (lib/checkoutDiscount) ───────────────────
const monthPromo = checkoutDiscount({ everSubscribed: false, promotionCode: "promo_1", referralCoupon: null });
check("monthly: the partner's promotion code as before", JSON.stringify(monthPromo.params) === JSON.stringify({ discounts: [{ promotion_code: "promo_1" }] }));
const yearPromo = checkoutDiscount({ everSubscribed: false, promotionCode: "promo_1", referralCoupon: null, year: true, yearCoupon: "coupon_month" });
check("yearly: the one-month coupon instead of the percent code", yearPromo.kind === "promo" && JSON.stringify(yearPromo.params) === JSON.stringify({ discounts: [{ coupon: "coupon_month" }] }));
const yearRef = checkoutDiscount({ everSubscribed: false, promotionCode: null, referralCoupon: "ref10", year: true, yearCoupon: "ref_month" });
check("yearly referral: the one-month coupon", yearRef.kind === "referral" && JSON.stringify(yearRef.params) === JSON.stringify({ discounts: [{ coupon: "ref_month" }] }));
const yearOpen = checkoutDiscount({ everSubscribed: false, promotionCode: null, referralCoupon: null, year: true });
check("yearly with no code: no Stripe code field", yearOpen.kind === "none" && !("allow_promotion_codes" in yearOpen.params));
const monthOpen = checkoutDiscount({ everSubscribed: false, promotionCode: null, referralCoupon: null });
check("monthly with no code: Stripe's code field as before", monthOpen.kind === "open");
check("a company that subscribed before: no discount on either term", checkoutDiscount({ everSubscribed: true, promotionCode: "p", referralCoupon: null, year: true, yearCoupon: "c" }).kind === "none");

// ── changes that half-fail (2026-10-12): lib/planChange with an in-memory Stripe ──
// A throwaway organisation `qa-pchg-…` with a Subscription row, and PlanPrice rows
// `price_qa_pchg_*` (so the change runs on the "live" lookup, never touching the
// sandbox price cache). Everything is removed on the way out, pass or fail.
/* eslint-disable @typescript-eslint/no-explicit-any -- an in-memory Stripe: only the shapes lib/planChange reads */
type Fault = "metadata" | "items" | "phases" | null;
function fakeStripe(o: { prices: Record<string, { amount: number; interval: "month" | "year" }> }) {
  const subs = new Map<string, any>();
  const schedules = new Map<string, any>();
  const st = { charges: [] as number[], fault: null as Fault, released: [] as string[], n: 0 };
  const now = () => Math.floor(Date.now() / 1000);
  const price = (id: string) => ({ id, unit_amount: o.prices[id].amount, recurring: { interval: o.prices[id].interval, interval_count: 1 }, metadata: {} });
  const copy = (x: any) => JSON.parse(JSON.stringify(x));
  const stripe: any = {
    subscriptions: {
      retrieve: async (id: string) => copy(subs.get(id)),
      update: async (id: string, p: any) => {
        const s = subs.get(id);
        if (p.cancel_at_period_end !== undefined && s.schedule) throw Object.assign(new Error("The subscription is managed by a subscription schedule"), { type: "StripeInvalidRequestError" });
        if (st.fault === "metadata" && p.metadata && !p.items) throw new Error("injected: metadata write failed");
        if (st.fault === "items" && p.items) throw Object.assign(new Error("injected: price change refused"), { type: "StripeInvalidRequestError" });
        if (p.items) {
          if (s.schedule) throw Object.assign(new Error("The subscription is managed by a subscription schedule"), { type: "StripeInvalidRequestError" });
          const target = p.items[0].price;
          const from = s.items.data[0].price;
          s.items.data = [{ ...s.items.data[0], price: price(target), quantity: 1 }];
          if (p.proration_behavior === "always_invoice") {
            const amount = price(target).unit_amount - Math.round(from.unit_amount / 3);
            st.charges.push(amount);
            s.latest_invoice = { id: `in_qa_${++st.n}`, created: now(), amount_paid: amount, status: "paid", billing_reason: "subscription_update" };
          }
          if (p.billing_cycle_anchor === "now") s.items.data[0].current_period_end = now() + (price(target).recurring.interval === "year" ? 365 : 30) * 86400;
        }
        if (p.metadata) s.metadata = { ...p.metadata };
        if (p.cancel_at_period_end !== undefined) s.cancel_at_period_end = p.cancel_at_period_end;
        const out = copy(s);
        out.pending_update = null;
        return out;
      },
    },
    invoices: {
      createPreview: async () => ({ amount_due: 1000, lines: { data: [{ amount: -100, period: { end: now() } }, { amount: 1100, period: { end: now() + 365 * 86400 } }] } }),
      voidInvoice: async () => ({}),
    },
    subscriptionSchedules: {
      create: async (p: any) => {
        const id = `sub_sched_qa_${++st.n}`;
        schedules.set(id, { id, status: "active", subscription: p.from_subscription, phases: [{ start_date: now() - 86400 }] });
        subs.get(p.from_subscription).schedule = id;
        return copy(schedules.get(id));
      },
      retrieve: async (id: string) => copy(schedules.get(id)),
      update: async (id: string, p: any) => {
        if (st.fault === "phases") throw new Error("injected: phases refused");
        schedules.get(id).phases = p.phases;
        return copy(schedules.get(id));
      },
      release: async (id: string) => {
        const sc = schedules.get(id);
        sc.status = "released";
        const s = subs.get(sc.subscription);
        if (s?.schedule === id) s.schedule = null;
        st.released.push(id);
        return copy(sc);
      },
    },
    coupons: { retrieve: async () => null },
  };
  const addSub = (id: string, orgId: string, priceId: string) => {
    subs.set(id, {
      id, object: "subscription", status: "active", customer: `cus_${id}`, created: now() - 100 * 86400, metadata: { organizationId: orgId },
      items: { data: [{ id: `si_${id}`, price: price(priceId), quantity: 1, current_period_start: now() - 10 * 86400, current_period_end: now() + 300 * 86400 }] },
      schedule: null, discounts: [], trial_end: null, cancel_at_period_end: false, canceled_at: null,
    });
  };
  return { stripe, st, subs, schedules, addSub };
}

/* eslint-enable @typescript-eslint/no-explicit-any */

async function halfFailures() {
  const db = new PrismaClient();
  const TAG = "qa-pchg";
  const made: string[] = [];
  const createdPrices: string[] = [];
  try {
    const plans = await db.pricingPlan.findMany({ where: { slug: { in: ["professional", "enterprise"] } } });
    const pro = plans.find((p) => p.slug === "professional")!;
    const ent = plans.find((p) => p.slug === "enterprise")!;
    // The live lookup (PlanPrice) is what the change reads: an active row the
    // dev database already holds is used as it is; a missing one is made here
    // (price_qa_pchg_*) and removed at the end — the sandbox price cache is never touched.
    const priceOf = async (planSlug: string, interval: "MONTH" | "YEAR", cents: number) => {
      const have = await db.planPrice.findFirst({ where: { planSlug, interval, active: true } });
      if (have) return have.stripePriceId;
      const id = `price_qa_pchg_${planSlug}_${interval}`;
      await db.planPrice.create({ data: { planSlug, interval, stripeProductId: "prod_qa_pchg", stripePriceId: id, unitAmountCents: cents } });
      createdPrices.push(id);
      return id;
    };
    const pp = [
      await priceOf("professional", "MONTH", pro.priceCents),
      await priceOf("professional", "YEAR", pro.yearlyPriceCents ?? 0),
      await priceOf("enterprise", "YEAR", ent.yearlyPriceCents ?? 0),
    ];
    const F = fakeStripe({ prices: { [pp[0]]: { amount: pro.priceCents, interval: "month" }, [pp[1]]: { amount: pro.yearlyPriceCents ?? 0, interval: "year" }, [pp[2]]: { amount: ent.yearlyPriceCents ?? 0, interval: "year" } } });
    const org = async (name: string, subId: string, priceId: string, plan: string) => {
      const o = await db.organization.create({ data: { name: `${TAG} ${name}`, slug: `${TAG}-${name}-${Date.now()}` } });
      made.push(o.id);
      await db.subscription.create({ data: { organizationId: o.id, plan, status: "ACTIVE", provider: "STRIPE", externalSubId: subId, externalCustomerId: `cus_${subId}`, stripePriceId: priceId } });
      F.addSub(subId, o.id, priceId);
      return o.id;
    };
    const deps = (extra: Partial<PlanChangeDeps> = {}): PlanChangeDeps => ({ stripe: F.stripe, mode: "live", ...extra });

    // A — paid, then the metadata and our row writes fail: success, one charge, row aligned.
    const a = await org("paid", "sub_qa_pchg_a", pp[0], "PROFESSIONAL");
    F.st.fault = "metadata";
    const resA = await applyPlanChange(a, "professional", "YEAR", null, deps({ onRowWrite: () => { throw new Error("injected: row write failed"); } }));
    F.st.fault = null;
    const rowA = await db.subscription.findUnique({ where: { organizationId: a } });
    check("paid, then metadata + row writes fail: the customer sees success with the charged amount", resA.ok && resA.mode === "switched" && resA.chargedCents === F.st.charges[0], JSON.stringify(resA));
    check("…exactly one charge", F.st.charges.length === 1, String(F.st.charges));
    check("…our row aligned to Stripe by the webhook's sync (yearly price)", rowA?.stripePriceId === pp[1] && rowA?.plan === "PROFESSIONAL", `${rowA?.plan} ${rowA?.stripePriceId}`);

    // B — the second press: Stripe already on the target → nothing charged, success.
    await db.subscription.update({ where: { organizationId: a }, data: { stripePriceId: pp[0] } }); // our row lags again
    const resB = await applyPlanChange(a, "professional", "YEAR", null, deps());
    const rowB = await db.subscription.findUnique({ where: { organizationId: a } });
    check("second press: success, $0", resB.ok && resB.mode === "switched" && resB.chargedCents === 0, JSON.stringify(resB));
    check("…two presses, one charge", F.st.charges.length === 1, String(F.st.charges));
    check("…and the lagging row is aligned", rowB?.stripePriceId === pp[1]);

    // C — booking year → month, the phases are refused: the new schedule is released, cancel goes through.
    const c = await org("phases", "sub_qa_pchg_c", pp[2], "ENTERPRISE");
    F.st.fault = "phases";
    const resC = await applyPlanChange(c, "professional", "MONTH", null, deps());
    F.st.fault = null;
    const subC = F.subs.get("sub_qa_pchg_c");
    check("phases refused: the customer sees an error", !resC.ok, JSON.stringify(resC));
    check("…no schedule left on the subscription", subC.schedule === null && F.st.released.length === 1, `schedule=${subC.schedule} released=${F.st.released}`);
    check("…no booking recorded", (await db.syncState.count({ where: { key: `planSwitch:${c}` } })) === 0);
    await releaseScheduledSwitch(c, F.stripe);
    const cancelC = await F.stripe.subscriptions.update("sub_qa_pchg_c", { cancel_at_period_end: true }).then(() => true, () => false);
    check("…and a cancel at the period end goes through", cancelC);

    // C2 — a schedule made elsewhere (not in our record): released by the cancel's own step.
    const c2 = await org("foreign", "sub_qa_pchg_c2", pp[2], "ENTERPRISE");
    await F.stripe.subscriptionSchedules.create({ from_subscription: "sub_qa_pchg_c2" });
    const refused = await F.stripe.subscriptions.update("sub_qa_pchg_c2", { cancel_at_period_end: true }).then(() => false, () => true);
    await releaseScheduledSwitch(c2, F.stripe);
    const cancelC2 = await F.stripe.subscriptions.update("sub_qa_pchg_c2", { cancel_at_period_end: true }).then(() => true, () => false);
    check("a schedule we never recorded: refused before, the cancel goes through after the release", refused && cancelC2);

    // D — a booked switch stays when a new change fails.
    const d = await org("booked", "sub_qa_pchg_d", pp[2], "ENTERPRISE");
    const booked = await applyPlanChange(d, "professional", "MONTH", null, deps());
    const before = await db.syncState.findUnique({ where: { key: `planSwitch:${d}` } });
    F.st.fault = "items";
    const resD = await applyPlanChange(d, "professional", "YEAR", null, deps());
    F.st.fault = null;
    const after = await db.syncState.findUnique({ where: { key: `planSwitch:${d}` } });
    const subD = F.subs.get("sub_qa_pchg_d");
    const phase2 = subD.schedule ? F.schedules.get(subD.schedule)?.phases?.[1]?.items?.[0]?.price : null;
    const was = before ? JSON.parse(before.cursor) : null;
    const now = after ? JSON.parse(after.cursor) : null;
    check("booking made", booked.ok && booked.mode === "scheduled", JSON.stringify(booked));
    check("a new change fails: the customer sees an error", !resD.ok, JSON.stringify(resD));
    check("…the booking is still there, same day and plan", !!now && now.at === was?.at && now.planSlug === was?.planSlug && now.interval === "MONTH", `${was?.at} → ${now?.at}`);
    check("…and Stripe holds a schedule to that same price", !!subD.schedule && phase2 === was?.priceId, `schedule=${subD.schedule} phase2=${phase2}`);
    check("…the subscription itself unchanged", subD.items.data[0].price.id === pp[2]);
  } catch (err) {
    check("half-failure scenarios ran", false, String((err as Error)?.stack || err).split("\n").slice(0, 3).join(" "));
  } finally {
    await db.syncState.deleteMany({ where: { key: { in: made.flatMap((m) => [`planSwitch:${m}`, `planChangeLock:${m}`, `mirrorSubAt:${m}`]) } } });
    await db.subscription.deleteMany({ where: { organizationId: { in: made } } });
    await db.organization.deleteMany({ where: { id: { in: made } } });
    await db.planPrice.deleteMany({ where: { stripePriceId: { in: createdPrices } } });
    await db.$disconnect();
  }
}

halfFailures().then(() => {
  console.log(bad === 0 ? "\nAll plan change checks passed." : `\n${bad} plan change check(s) FAILED.`);
  process.exit(bad === 0 ? 0 : 1);
});
