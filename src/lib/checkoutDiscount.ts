// WHICH DISCOUNT A SUBSCRIPTION CHECKOUT CARRIES — decided in one place.
//
// THE OWNER'S RULE (2026-09-22): an upgrade must not hand the customer the
// partner's coupon a second time. The coupon is "first month only" (owner,
// 2026-09-02); a replacement subscription is not a first month. Until now the
// owner-side checkout (api/checkout/subscription) re-read the organisation's
// permanent signup stamp on EVERY checkout and attached the promotion code
// again, so each upgrade bought another 20%-off month — and, because the
// attribution used to be keyed on the new subscription, restarted the partner's
// commission window with it.
//
// So a checkout for an organisation that has EVER had a Stripe subscription
// carries no discount at all, and no promo field either (owner, 2026-09-22:
// a code is accepted at signup and nowhere else — with the field open a
// customer could type the partner's code again, or any other code). That is
// the same predicate the referral coupon already used ("ONCE, on the first
// bill only", owner 2026-09-04). The partner keeps earning across the
// upgrade: the attribution lives on the organisation and moves to the new
// subscription by itself (lib/stripeSync, carryAttributionToSubscription).
//
// What Stripe does on its own: a discount attached through Checkout is a
// SUBSCRIPTION-level discount. A new subscription does not inherit it; only a
// CUSTOMER-level discount would carry over, and nothing in this codebase ever
// sets one (the only customers.* call is a balance transaction for referral
// credit, lib/referralRewards).

export type CheckoutDiscount =
  | { kind: "promo"; params: { discounts: ({ promotion_code: string } | { coupon: string })[] } }
  | { kind: "referral"; params: { discounts: { coupon: string }[] } }
  | { kind: "open"; params: { allow_promotion_codes: true } }
  | { kind: "none"; params: Record<string, never> };

export function checkoutDiscount(opts: {
  /** The organisation has had a Stripe subscription before (an upgrade or a return). */
  everSubscribed: boolean;
  /** The partner's promotion code, already resolved for this Stripe mode. */
  promotionCode: string | null;
  /** The member-referral coupon, when this is a referred shop's first bill. */
  referralCoupon: string | null;
  /** A yearly checkout (owner, 2026-10-12): the code is one month's worth
   *  (lib/yearDiscount, `yearCoupon`) and Stripe's code field stays closed —
   *  a typed percent code would come off the whole year. */
  year?: boolean;
  yearCoupon?: string | null;
}): CheckoutDiscount {
  if (opts.everSubscribed) return { kind: "none", params: {} };
  if (opts.year) {
    if (!opts.yearCoupon) return { kind: "none", params: {} };
    return opts.promotionCode
      ? { kind: "promo", params: { discounts: [{ coupon: opts.yearCoupon }] } }
      : { kind: "referral", params: { discounts: [{ coupon: opts.yearCoupon }] } };
  }
  if (opts.promotionCode) return { kind: "promo", params: { discounts: [{ promotion_code: opts.promotionCode }] } };
  if (opts.referralCoupon) return { kind: "referral", params: { discounts: [{ coupon: opts.referralCoupon }] } };
  return { kind: "open", params: { allow_promotion_codes: true } };
}
