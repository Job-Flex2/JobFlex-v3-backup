import { isStripeEnabled } from "@/lib/sdk/stripe";
import { getStripeMode } from "@/lib/stripeMode";
// The subscription surface's ONE data read.
//
// Extracted verbatim from this folder's page.tsx on 2026-08-12 so the handheld
// preview route (/mobile-subscription-v2) and the live URL (/dashboard/
// subscription) run exactly the same query set instead of two copies that can
// drift. NOTHING was added, removed or changed in the process: same calls, same
// arguments, same order, same derived values. No new query, no new server
// action, no new API route, no schema change.
//
// Server-only by construction — it imports Prisma and two server actions, so a
// client component importing it would fail the build rather than leak.
//
// The OWNER-ONLY GUARD is deliberately NOT here: it belongs at the route, where
// the redirect target is a route-level decision, and burying an authorisation
// check inside a loader is how one gets forgotten. Both callers perform it
// before calling this, and `listSubscriptionInvoices` / `getOrCreateMyReferralCode`
// re-assert it themselves through requireOwner().

import { db } from "@/lib/db";
import { customPriceCents, normalizeCustomPages } from "@/lib/customPlan";
import { customPlanOffered } from "@/lib/customPlanFlag";
import { REFERRAL_REWARD_PCT, settleReferralsForCode } from "@/lib/referralRewards";
import { getOrCreateMyReferralCode } from "@/actions/referrals";
import { listSubscriptionInvoices, type UpcomingInvoice } from "@/actions/billing";
import { getPlanCatalog, getOrgPlanContext } from "@/lib/planCatalogServer";
import { getOrgLimitOverview } from "@/lib/limitsEngine";
import { LIMIT_DEFS } from "@/lib/planLimits";
import { titleCaseSlug, type PlanDTO } from "@/lib/planCatalog";
import type { SubscriptionInvoice } from "@/actions/billing";
import { readPlanGrant } from "@/lib/planGrant";
import { readAccessSubscription } from "@/lib/subscriptionAccess";
import { planLapsed } from "@/lib/planStatus";
import { FREE_PLAN_NAME, freeSince, freeSwitchBooked, freeSwitchDate, onFreePlan } from "@/lib/freePlan";
import { trialCardLine, type TrialCardLine } from "@/lib/trialCardLine";
import { planTermState } from "@/lib/planChange";

// The result shape. These interfaces lived in ./subscription-view.tsx until
// 2026-08-13, when that desktop view was superseded by the blueprint page at
// src/app/dashboard/subscription (which renders SubscriptionContent and owns
// the /dashboard/subscription URL at every width). The loader survived the
// move because the /mobile-subscription-v2 preview page feeds from it, so the
// types it promises now live with it.
export interface UsageRow {
  resource: string;
  label: string;
  used: number;
  limit: number;
}

export interface SubscriptionViewProps {
  /** Display name of the current plan (catalog name, or title-cased orphan slug). */
  planName: string;
  /** The current plan's price for the term it is billed on (the year's for a
   *  yearly subscription — owner, 2026-10-12); null when the slug left the catalog. */
  priceCents: number | null;
  /** The term the subscription is billed on; null when it cannot be told. */
  interval?: "MONTH" | "YEAR" | null;
  /** A booked YEAR → MONTH switch (lib/planChange). */
  scheduledSwitch?: { at: string; planName: string; interval: "MONTH" | "YEAR" } | null;
  /** Lowercase slug used to mark "current" in the spectrum + matrix. */
  currentSlug: string;
  /** Active catalog plans, display-ordered. */
  plans: PlanDTO[];
  status: string;
  accessBlocked?: boolean;
  nextBill: string | null;
  trialEndsAt: string | null;
  /** A cancellation is booked for the end of this cycle (billing.ts's
   *  cancelSubscription mirrors Stripe's cancel_at_period_end here). */
  cancelAtPeriodEnd: boolean;
  /** A plan that ended without moving to Free — a grant that expired
   *  (EXPIRED): "Access ended <date>", no next bill. Null otherwise. */
  cancellation: { accessUntil: string | null; ended: boolean } | null;
  /** The switch to Free is booked (owner, 2026-10-13; lib/freePlan): the plan
   *  runs until `at`, then the company is on Free. "Keep <plan>" lifts it. */
  freeSwitch?: { at: string | null } | null;
  /** The company is on the Free plan (its subscription ended — CANCELED):
   *  since when, and the plan it had. planName then reads "Free". */
  freePlan?: { since: string | null; wasName: string } | null;
  /** The plan is a complimentary grant from JobFlex (lib/planGrant): nobody
   *  pays, nothing is billed, and it ends on `endsAt` (null = no end date). */
  complimentary: { endsAt: string | null; after: "free" | "expired" } | null;
  /** The limits engine's enforced caps for this org (unlimited keys omitted). */
  usage: UsageRow[];
  /** What the org has used on keys the plan does not cap — shown as counts. */
  usageUnlimited?: { resource: string; label: string; used: number }[];
  /** The caps do not apply to this user here — a platform admin in an
   *  organization they own (lib/limitsEngine). The card says so instead. */
  usageExempt?: boolean;
  invoices: { available: boolean; invoices: SubscriptionInvoice[]; upcoming?: UpcomingInvoice | null };
  /** The next charge and what the org's referrals take off it; null when
   *  nothing is going to be billed (no subscription, no priced plan). */
  nextCharge: NextCharge | null;
  /** A card-less trial's card (lib/trialCardLine): "None yet" with the way to
   *  add one, or the card on file. Null for every other organization. */
  trialCard?: TrialCardLine | null;
  /** Pages a CUSTOM-plan org owns (lib/customPlan ids); [] otherwise. */
  customPages?: string[];
  /** What the embedded plan cards need to offer checkout (owner-only page). */
  checkoutReady: boolean;
  /** CUSTOM_PLAN_ENABLED (lib/customPlanFlag): "Build your plan" on sale. */
  customOffered: boolean;
  sandbox: boolean;
  referral: {
    code: string;
    rewardSummary: string;
    uses: number;
    converted: number;
    pending: number;
  };
}

/** The next bill as the Billing history card draws it (owner, 2026-09-14):
 *  when it is charged, what it comes to, and how much of it the people who
 *  used the org's referral code are paying for. */
export interface NextCharge {
  /** ISO date of the charge; null when Stripe has not scheduled one. */
  dueAt: string | null;
  /** The plan before anything comes off. */
  subtotalCents: number;
  /** Coupons on the subscription ("Referral coupon −$2.50"). */
  discountNotes: string[];
  discountCents: number;
  /** Referral credit taken off THIS bill. */
  referralCreditCents: number;
  /** How many referrals that credit comes from. */
  referralCount: number;
  /** Credit left over after this bill, carried to the next one. */
  creditLeftCents: number;
  /** What one more paid referral would take off (50% of a month). */
  perReferralCents: number;
  /** Signed up with the code, not subscribed yet. */
  pendingReferrals: number;
  /** What will actually be charged. */
  amountDueCents: number;
  /** True when Stripe could not preview the bill and it was worked out here. */
  estimated: boolean;
}

/** Stripe keeps one credit balance, not one credit per referral, so the
 *  referrals behind a credit are counted oldest-first: the newest rewards are
 *  the ones still unspent, and a bill spends the oldest of those first. */
function referralsBehind(rewardsNewestFirst: number[], balanceCents: number, spentCents: number): number {
  const unspent: number[] = [];
  let sum = 0;
  for (const cents of rewardsNewestFirst) {
    if (sum >= balanceCents) break;
    unspent.push(cents);
    sum += cents;
  }
  let count = 0;
  let used = 0;
  for (const cents of unspent.reverse()) {
    if (used >= spentCents) break;
    count += 1;
    used += cents;
  }
  return count;
}

export async function loadSubscriptionData(
  organizationId: string,
): Promise<SubscriptionViewProps> {
  const [sub, planContext, plans, limitOverview, code, trialCard, term] = await Promise.all([
    readAccessSubscription(organizationId),
    getOrgPlanContext(organizationId),
    getPlanCatalog(),
    getOrgLimitOverview(organizationId),
    getOrCreateMyReferralCode(),
    trialCardLine(organizationId).catch(() => null),
    planTermState(organizationId).catch(() => ({ currentInterval: null, scheduledSwitch: null })),
  ]);
  // No meters for a platform admin in their own organization: the card says
  // "Unlimited · platform admin" instead of counting what is not capped.
  const limitUsage = limitOverview.exempt ? [] : limitOverview.usage;

  // Referral catch-up: a referred shop that has since started its
  // subscription flips the referrer's PENDING row and lands the credit.
  // BEFORE the invoice read, so the next-bill preview already nets it out.
  await settleReferralsForCode(code.id).catch(() => {});
  const invoiceResult = await listSubscriptionInvoices();

  // The custom plan's pages, for the matrix ticks and the hero price.
  let customPages: string[] = [];
  if ((sub?.plan ?? "").toUpperCase() === "CUSTOM") {
    const row = await db.syncState
      .findUnique({ where: { key: `orgPages:${organizationId}` } })
      .catch(() => null);
    try {
      customPages = normalizeCustomPages(row ? (JSON.parse(row.cursor) as string[]) : []);
    } catch {
      customPages = [];
    }
  }

  const [refUses, refConverted, refPending, earned] = await Promise.all([
    db.referralConversion.count({ where: { codeId: code.id } }),
    db.referralConversion.count({
      where: { codeId: code.id, status: { in: ["CONVERTED", "PAID"] } },
    }),
    db.referralConversion.count({ where: { codeId: code.id, status: "PENDING" } }),
    // Every referral that has earned (or is owed) a credit, newest first.
    db.referralConversion.findMany({
      where: { codeId: code.id, status: { in: ["CONVERTED", "PAID"] }, signupOrgId: { not: null } },
      select: { status: true, rewardCents: true, rewardAppliedAt: true },
      orderBy: [{ rewardAppliedAt: "desc" }, { createdAt: "desc" }],
    }),
  ]);

  // No subscription row → the stamp reads "inactive" (the Free tier is gone,
  // so absence of a subscription is no longer presented as a free plan).
  const status = sub?.status ?? "INACTIVE";
  /* A COMPLIMENTARY PLAN (owner, 2026-09-22). A MANUAL row that is ACTIVE is a
     grant from JobFlex: the page says so, shows when it ends, and previews no
     bill — there is no Stripe subscription to bill, and the "estimate" the
     page used to work out from the list price read as a charge that was
     coming. The grant's own record has the end date; an older grant written
     before the record existed falls back to the row's period end. */
  const grant = sub?.provider === "MANUAL" && sub.status === "ACTIVE" ? await readPlanGrant(organizationId) : null;
  const complimentary =
    sub?.provider === "MANUAL" && sub.status === "ACTIVE"
      ? { endsAt: grant ? grant.endsAt : sub.currentPeriodEnd?.toISOString() ?? null, after: grant?.fallback ?? ("free" as const) }
      : null;
  const { plan: planDto, rawPlan } = planContext;

  // Only finite caps render as usage bars; unlimited keys are omitted.
  const usage: UsageRow[] = limitUsage
    .filter((u) => u.limit !== null)
    .map((u) => ({
      resource: u.resource,
      label: LIMIT_DEFS.find((d) => d.key === u.resource)?.label ?? u.resource,
      used: u.used,
      limit: u.limit as number,
    }));
  // The rest of the meters, so a plan with no caps still shows what it has
  // used this cycle instead of "nothing metered" (owner, 2026-09-02).
  const usageUnlimited = limitUsage
    .filter((u) => u.limit === null && u.used > 0)
    .map((u) => ({
      resource: u.resource,
      label: LIMIT_DEFS.find((d) => d.key === u.resource)?.label ?? u.resource,
      used: u.used,
    }));

  const stripeMode = await getStripeMode();
  const rewardSummary =
    "Each contractor who signs up with it and goes paid takes 50% off one month of your subscription";

  /* ONE MONTH of the plan — what a referral's 50% is worked from, whatever
     the term — and the price for the term the subscription bills on, which
     is what the page shows (a yearly plan read "$95/mo" before 2026-10-12). */
  const yearly = term.currentInterval === "YEAR";
  const monthlyCents = planDto
    ? planDto.priceCents
    : (sub?.plan ?? "").toUpperCase() === "CUSTOM"
      ? customPriceCents(customPages)
      : null;
  const priceCents = planDto
    ? yearly
      ? (planDto.yearlyPriceCents ?? planDto.priceCents)
      : planDto.priceCents
    : (sub?.plan ?? "").toUpperCase() === "CUSTOM"
      ? customPriceCents(customPages, yearly ? "YEAR" : "MONTH")
      : null;

  /* THE NEXT CHARGE (owner, 2026-09-14). Stripe's preview is the truth when
     there is one: it already nets out coupons and the credit balance, and the
     page only has to say which referrals that credit came from. Without one
     (no Stripe subscription yet, or the preview failed) the bill is worked
     out from the plan price and the credits not yet spent — marked estimated. */
  const perReferralCents = Math.round((monthlyCents ?? 0) * (REFERRAL_REWARD_PCT / 100));
  const paidRewards = earned
    .filter((r) => r.status === "PAID" && r.rewardAppliedAt)
    .map((r) => r.rewardCents ?? perReferralCents);
  const upcoming = invoiceResult.upcoming ?? null;
  const billable = ["ACTIVE", "TRIALING", "PAST_DUE"].includes(status.toUpperCase()) && !complimentary;
  /* THE FREE PLAN (owner, 2026-10-13; lib/freePlan). Booked: the plan runs
     to the end of the cycle and nothing more is billed — no next bill, the
     date it switches instead. Ended (CANCELED): the company is on Free. A
     grant that expired (EXPIRED) still reads "Access ended". */
  const freeSwitch = !complimentary && freeSwitchBooked(sub) ? { at: freeSwitchDate(sub)?.toISOString() ?? null } : null;
  const wasName = planDto?.name ?? titleCaseSlug(rawPlan);
  // A grant that ran out onto "free" kept no plan of its own to name: no "Was".
  const freePlan = !complimentary && onFreePlan(sub)
    ? { since: freeSince(sub)?.toISOString() ?? null, wasName: wasName.toLowerCase() === "free" ? "" : wasName }
    : null;
  const endedStatus = status.toUpperCase() === "EXPIRED";
  const cancellation = !complimentary && endedStatus
    ? { accessUntil: (sub?.currentPeriodEnd ?? sub?.trialEndsAt)?.toISOString() ?? null, ended: true }
    : null;
  let nextCharge: NextCharge | null = null;
  if (complimentary || cancellation || freeSwitch || freePlan) {
    nextCharge = null;
  } else if (upcoming) {
    nextCharge = {
      dueAt: upcoming.dueAt ? new Date(upcoming.dueAt * 1000).toISOString() : null,
      subtotalCents: upcoming.subtotalCents,
      discountNotes: upcoming.notes,
      discountCents: upcoming.discountCents,
      referralCreditCents: upcoming.creditCents,
      referralCount: referralsBehind(paidRewards, upcoming.balanceCreditCents, upcoming.creditCents),
      creditLeftCents: Math.max(0, upcoming.balanceCreditCents - upcoming.creditCents),
      perReferralCents,
      pendingReferrals: refPending,
      amountDueCents: upcoming.amountDueCents,
      estimated: false,
    };
  } else if (billable && priceCents !== null && priceCents > 0) {
    // Unspent = owed (not on Stripe yet) + landed since the last invoice.
    const lastInvoiceAt = invoiceResult.invoices.reduce((t, v) => Math.max(t, v.created), 0) * 1000;
    const unspent = earned
      .filter((r) =>
        r.status === "CONVERTED"
          ? !r.rewardAppliedAt
          : !!r.rewardAppliedAt && r.rewardAppliedAt.getTime() > lastInvoiceAt,
      )
      .map((r) => r.rewardCents ?? perReferralCents);
    const balance = unspent.reduce((n, c) => n + c, 0);
    const credit = Math.min(priceCents, balance);
    nextCharge = {
      dueAt: sub?.currentPeriodEnd?.toISOString() ?? sub?.trialEndsAt?.toISOString() ?? null,
      subtotalCents: priceCents,
      discountNotes: [],
      discountCents: 0,
      referralCreditCents: credit,
      referralCount: referralsBehind(unspent, balance, credit),
      creditLeftCents: balance - credit,
      perReferralCents,
      pendingReferrals: refPending,
      amountDueCents: priceCents - credit,
      estimated: true,
    };
  }

  return {
    planName: freePlan ? FREE_PLAN_NAME : wasName,
    priceCents: freePlan ? 0 : priceCents,
    interval: freePlan ? null : term.currentInterval,
    scheduledSwitch: freePlan ? null : term.scheduledSwitch,
    // On Free no plan card is "current": every one is an upgrade, paid at once.
    currentSlug: freePlan ? "free" : (planDto?.slug ?? rawPlan.toLowerCase()),
    plans,
    status,
    accessBlocked: planLapsed(sub),
    nextBill: !complimentary && !freePlan && sub?.currentPeriodEnd ? sub.currentPeriodEnd.toISOString() : null,
    trialEndsAt: sub?.trialEndsAt ? sub.trialEndsAt.toISOString() : null,
    cancelAtPeriodEnd: Boolean(sub?.canceledAt),
    cancellation,
    freeSwitch,
    freePlan,
    complimentary,
    usage,
    usageUnlimited,
    usageExempt: limitOverview.exempt,
    invoices: invoiceResult,
    nextCharge,
    customPages,
    // The card line belongs to a running card-less trial, never to the Free plan.
    trialCard: freePlan ? null : trialCard,
    checkoutReady: isStripeEnabled(),
    customOffered: customPlanOffered(),
    sandbox: stripeMode === "test",
    referral: {
      code: code.code,
      rewardSummary,
      uses: refUses,
      converted: refConverted,
      pending: refPending,
    },
  };
}
