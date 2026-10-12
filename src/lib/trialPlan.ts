import "server-only";
// THE PLAN A CARD-LESS TRIAL IS ON — read off the subscription (owner,
// 2026-10-07; lib/cardlessTrial).
//
// The trial's record (lib/trialState, `cardlessTrial:<orgId>`) keeps the plan,
// interval and pages picked at SIGNUP. During the trial the subscription
// moves on: the owner switches plan (actions/billing changePlan), support
// changes the billed plan (lib/subscriptionEditor), a custom plan's pages
// change (lib/customBilling), or someone edits it in Stripe (the webhook and
// the reconcile cron mirror that). Every one of those writes the Subscription
// row; none of them wrote the record, so the ribbon, /dashboard/trial, the
// reminder emails and the checkout after the trial's end kept naming and
// selling the signup plan.
//
// So the plan is READ, not copied: the row's plan, the interval of the price
// the row carries, and for the custom plan the pages the organization holds
// now (orgPages:<orgId>, which access already reads). The record supplies
// only what the subscription does not carry — and the signup pick as the
// fallback while the row cannot name its plan (before the first webhook has
// written the price, or once the row has moved to another subscription).
import { db } from "@/lib/db";
import { CUSTOM_PLAN_SLUG } from "@/lib/customPlan";
import { readOrgPages } from "@/lib/customBilling";
import type { CardlessRecord } from "@/lib/trialState";
import { priceInterval } from "@/lib/priceInterval";

export type TrialPlanChoice = {
  /** A catalog slug (lowercase) or "custom". */
  planSlug: string;
  interval: "MONTH" | "YEAR";
  /** The custom plan's pages now; empty on a catalog plan. */
  customPages: string[];
};

/** Monthly or yearly, for a price this app knows (lib/priceInterval). */
export { priceInterval };

export async function currentTrialPlan(orgId: string, rec: CardlessRecord): Promise<TrialPlanChoice> {
  const row = await db.subscription
    .findUnique({ where: { organizationId: orgId }, select: { plan: true, stripePriceId: true, externalSubId: true } })
    .catch(() => null);
  const own = row && row.externalSubId === rec.subId ? row : null;
  const stored = (own?.plan ?? "").trim().toUpperCase();
  const planSlug = !stored || stored === "FREE" ? rec.planSlug : stored === "CUSTOM" ? CUSTOM_PLAN_SLUG : stored.toLowerCase();
  const interval = (own?.stripePriceId ? await priceInterval(own.stripePriceId) : null) ?? rec.interval;
  const customPages = planSlug === CUSTOM_PLAN_SLUG ? await readOrgPages(orgId).catch(() => rec.customPages) : [];
  return { planSlug, interval, customPages };
}
