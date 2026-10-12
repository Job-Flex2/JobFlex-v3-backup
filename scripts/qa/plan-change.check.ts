// Plan and term changes, first-month codes on a yearly bill, the checkout's
// discount — the pure rules behind the 2026-10-12 money fixes. No network, no
// database.
//   npx --no-install tsx --tsconfig tsconfig.json scripts/qa/plan-change.check.ts
import "./_server-only";
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

console.log(bad === 0 ? "\nAll plan change checks passed." : `\n${bad} plan change check(s) FAILED.`);
process.exit(bad === 0 ? 0 : 1);
