// AN OWNER WITH NO PLAN, SIGNING IN AGAIN, GOES STRAIGHT TO STRIPE (owner, 2026-10-19).
//
// While the sign-up's plan rule is "auto" with a card (lib/signupAutoPlan, lib/trialPolicyServer), a person who made a
// shop and never added a card is not shown the plan cards when they come back: the sign-in sends them here
// (lib/signupOtp nextForUser) and the answer is a 303 to Stripe's card page for the plan the rule picks — the same one
// step 1 opens (Professional, monthly). Stripe's back arrow is the ordinary checkout's cancel_url: the plan cards of
// /dashboard/upgrade. Anything that stops the card page — the switch turned off, a plan already held, Stripe slow or
// refusing — lands on those cards too.
//
// The session is the ordinary owner checkout's (../../../api/checkout/subscription), asked in-process with this
// request's own cookies, so its rules — owner only, one trial per company, codes, the live price mirror — are the
// ones that apply; nothing about money is decided here.
import { NextResponse, after } from "next/server";
import { cookies } from "next/headers";
import { requireOwner } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { readSignupPlan, signupTrialMode } from "@/lib/trialPolicyServer";
import { autoPlanOffer } from "@/lib/signupAutoPlanServer";
import { SIGNUP_CHECKOUT_DEADLINE_MS } from "@/lib/signupCheckoutSession";
import { captureTrafficEvent, identityFromCookie } from "@/lib/traffic-capture-server";
import { TRAFFIC_EVENTS } from "@/lib/traffic-contract";
import { isQaEmail } from "@/lib/qaEmail";
import { POST as subscriptionCheckout } from "@/app/api/checkout/subscription/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function go(to: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { Location: to, "Cache-Control": "no-store" } });
}

export async function GET(req: Request) {
  const owner = await requireOwner().catch(() => null);
  if (!owner) return go("/dashboard");
  const { organizationId, user } = owner;
  const [rule, trial, sub] = await Promise.all([
    readSignupPlan(),
    signupTrialMode(),
    db.subscription.findUnique({ where: { organizationId }, select: { id: true } }),
  ]);
  if (rule.mode !== "auto" || trial !== "card" || sub) return go("/dashboard/upgrade");
  const offer = await autoPlanOffer({});
  if (!offer) return go("/dashboard/upgrade");

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), SIGNUP_CHECKOUT_DEADLINE_MS);
  });
  const asked = subscriptionCheckout(
    new Request(new URL("/api/checkout/subscription", req.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planSlug: offer.slug, interval: "MONTH" }),
    }),
  )
    .then(async (res) => (res.ok ? ((await res.json().catch(() => null)) as { url?: string } | null) : null))
    .catch((err) => {
      console.warn("[upgrade/checkout] the card page did not open:", err);
      return null;
    });
  const answer = await Promise.race([asked, deadline]).finally(() => clearTimeout(timer));
  if (!answer?.url) return go("/dashboard/upgrade");

  if (!isQaEmail(user.email)) {
    const identity = identityFromCookie((await cookies()).get(`ph_${process.env.NEXT_PUBLIC_POSTHOG_KEY}_posthog`)?.value, new URL(req.url).hostname);
    after(() => captureTrafficEvent(identity, TRAFFIC_EVENTS.checkoutRedirect, { reason: "relogin", plan: offer.slug, interval: "MONTH", plan_mode: "auto" }));
  }
  return go(answer.url);
}
