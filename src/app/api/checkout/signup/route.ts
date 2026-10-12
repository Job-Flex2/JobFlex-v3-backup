// CHECKOUT FOR A SIGNUP THAT HAS NO ACCOUNT YET.
//
// The ordinary subscription checkout (../subscription) is owner-scoped: it
// prices for an organization that already exists. This one runs BEFORE the
// organization exists — the visitor is a pending intent parked by
// actions/signupCheckout.ts, identified by an unguessable token, and the
// account is created only when this session comes back complete.
//
// It is deliberately narrow:
//   · the token must resolve to a live pending intent (2h TTL) — no token, no
//     session, so this cannot be used as an anonymous Stripe session factory;
//   · the customer email is taken from the INTENT, never from the request body;
//   · `client_reference_id` carries the token, which is what
//     `completePendingSignup` checks the returned session against.
import { after, NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripeClient, isStripeEnabled } from "@/lib/sdk/stripe";
import { readPendingSignup, sendSignupInitiateCheckout } from "@/actions/signupCheckout";
import { resolveSignupDiscount, resolveSignupPrice } from "@/lib/signupPricing";
import { customMetadata } from "@/lib/customBilling";
import { signupTrialMode } from "@/lib/trialPolicyServer";
import { CUSTOM_PLAN_OFF_SALE, customPlanOffered } from "@/lib/customPlanFlag";
import { trialOfferMetadata } from "@/lib/trialOffer";
import { CUSTOM_PLAN_SLUG } from "@/lib/customPlan";

export const runtime = "nodejs";

export async function POST(req: Request) {
  // The card checkout is the plan step's "card" path (signupTrialMode,
  // lib/trialPolicyServer). It is ALWAYS honoured (owner, 2026-10-07): a page
  // loaded while the trial took a card may press after the switch went to
  // "no card" — the visitor chose the card, so Checkout opens rather than a
  // dead end. The answer is read only to note that case.
  if ((await signupTrialMode()) === "no-card") {
    console.info("[signup] card checkout while the trial is card-less: the page was loaded on the card path");
  }
  if (!isStripeEnabled()) {
    return NextResponse.json({ error: "Stripe is not configured." }, { status: 503 });
  }

  // `customPages` arrives in the body for symmetry with the client, but it is
  // NOT read: the selection that gets priced is the one stored with the intent.
  const { token, planSlug, interval } = await req.json().catch(() => ({}));
  if (!token || !planSlug || !interval) {
    return NextResponse.json(
      { error: "token, planSlug and interval are required." },
      { status: 400 },
    );
  }
  if (interval !== "MONTH" && interval !== "YEAR") {
    return NextResponse.json({ error: "interval must be MONTH or YEAR." }, { status: 400 });
  }

  // Off sale (CUSTOM_PLAN_ENABLED unset): a new shop cannot start on it.
  if (String(planSlug) === CUSTOM_PLAN_SLUG && !customPlanOffered()) {
    return NextResponse.json({ error: CUSTOM_PLAN_OFF_SALE }, { status: 410 });
  }

  const pending = await readPendingSignup(String(token));
  if (!pending) {
    return NextResponse.json({ error: "That signup expired. Start again." }, { status: 410 });
  }

  // Mode-aware from the top: the admin's live/sandbox switch (lib/stripeMode)
  // decides which account this session is created on. The price and the
  // discount are lib/signupPricing's — the card-less trial reads the same.
  const { stripe, mode } = await getStripeClient();
  const priced = await resolveSignupPrice({
    stripe,
    mode,
    planSlug: String(planSlug),
    interval,
    customPages: pending.customPages,
    trialOffer: pending.trialOffer,
  });
  if (!priced.ok) return NextResponse.json({ error: priced.error }, { status: priced.status });
  // The saved offer determines the duration; then Stripe charges the selected price.
  const { trialDays, planLabel, isCustom, cents } = priced;
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = priced.lineItems;
  const discount = await resolveSignupDiscount({
    stripe,
    mode,
    attribution: pending.attribution,
    trialDays,
    where: "checkout/signup",
    interval: priced.interval,
    monthlyCents: priced.monthlyCents,
  });
  // `discounts` and `allow_promotion_codes` are mutually exclusive at Stripe,
  // so a session with a discount attached has no promo field.
  const discounts: Stripe.Checkout.SessionCreateParams.Discount[] | null = discount ? [discount] : null;

  const origin = new URL(req.url).origin;
  try {
    // REHEARSALS ONLY: STRIPE_TEST_CLOCKS=1 opens the checkout for a customer
    // made on a Stripe test clock of its own, so a harness can walk the trial
    // to day 8 and see the first charge (the card-less trial's rule, in
    // lib/cardlessTrial). Never in production, never on the live account.
    let customer: string | null = null;
    if (mode === "test" && process.env.NODE_ENV !== "production" && process.env.STRIPE_TEST_CLOCKS === "1") {
      const clock = await stripe.testHelpers.testClocks.create({ frozen_time: Math.floor(Date.now() / 1000), name: `signup ${pending.email}`.slice(0, 300) });
      customer = (await stripe.customers.create({ email: pending.email, name: pending.businessName, test_clock: clock.id, metadata: { signupToken: String(token) } })).id;
    }
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      ...(customer ? { customer } : { customer_email: pending.email }),
      client_reference_id: String(token),
      line_items: lineItems,
      // The custom plan's pages ride the subscription too (lib/customBilling);
      // the organization is named on it once the account exists.
      subscription_data:
        trialDays > 0 || isCustom
          ? {
              ...(trialDays > 0 ? { trial_period_days: trialDays } : {}),
              metadata: { ...(isCustom ? customMetadata(null, pending.customPages) : {}), ...trialOfferMetadata(pending.trialOffer) },
            }
          : undefined,
      // A yearly bill takes no code typed at Stripe: a percent "first month"
      // code there would come off the whole year (lib/firstMonthDiscount) —
      // codes are applied on our plan step, as one month's worth.
      ...(discounts ? { discounts } : priced.interval === "MONTH" ? { allow_promotion_codes: true } : {}),
      metadata: {
        ...trialOfferMetadata(pending.trialOffer),
        signupToken: String(token),
        planSlug: planLabel,
        interval: priced.interval,
        ...(isCustom ? { customPages: pending.customPages.join(",") } : {}),
      },
      success_url: `${origin}/auth/register?signup=${encodeURIComponent(String(token))}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/auth/register?signup=${encodeURIComponent(String(token))}&checkout=cancelled`,
    });
    // Meta InitiateCheckout, the server copy of the browser's (same event_id).
    after(() =>
      sendSignupInitiateCheckout(String(token), { planSlug: planLabel, cents }).catch((err) =>
        console.warn("[meta:capi] InitiateCheckout failed", err),
      ),
    );
    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("[checkout/signup] failed:", err);
    return NextResponse.json({ error: "Couldn't open checkout." }, { status: 502 });
  }
}
