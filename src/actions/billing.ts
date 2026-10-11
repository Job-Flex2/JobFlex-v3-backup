"use server";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/orgContext";
import { db } from "@/lib/db";
import { isStripeEnabled, getStripeClient } from "@/lib/sdk/stripe";
import { getPlanBySlug, getOrgPlanContext, revalidatePlanSurfaces } from "@/lib/planCatalogServer";
import { ensureRecurringPrice } from "@/lib/stripePriceCache";
import { SubscriptionStatus } from "@/lib/prismaEnums";
import { subscriptionPeriodEndDate } from "@/lib/stripeCompat";
import { trialOnlyInvoiceIds } from "@/lib/trialInvoices";
import { normalizeCustomPages } from "@/lib/customPlan";
import {
  changeCustomPages,
  previewCustomPages,
  readOrgPages,
  type CustomPagesChange,
} from "@/lib/customBilling";
import { planSnapshot, reportPlanChange } from "@/lib/activation-events";
import { logServerError } from "@/lib/server-events";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";

const billingSaved = (organizationId: string, actorId: string, summary: string, meta?: Record<string, unknown>) =>
  logActivity({ organizationId, actorId, kind: TRAIL_KINDS.SETTINGS, summary, meta: { area: "billing", ...meta } });

/**
 * Directly assign the org a plan from the catalog. One legitimate use since
 * the Free tier was removed (2026-08-17): the Stripe-disabled dev/demo
 * fallback. Paid plans with Stripe configured MUST go through checkout —
 * without this guard any owner could self-grant a paid tier without paying.
 * (The isFree branches below stay: they keep any admin-created $0 plan and
 * legacy FREE-status rows behaving sanely.)
 */
export async function setOrgPlan(planSlug: string) {
  const { organizationId, user } = await requireOwner();
  const plan = await getPlanBySlug(planSlug); // active plans only
  if (!plan) throw new Error("Invalid plan");
  if (!plan.isFree && isStripeEnabled()) {
    throw new Error("Paid plans go through checkout.");
  }

  const now = new Date();
  const periodEnd = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 30);
  const stored = plan.slug.toUpperCase();

  const planWas = await planSnapshot(organizationId);
  await db.subscription.upsert({
    where: { organizationId },
    update: {
      plan: stored,
      status: plan.isFree ? "FREE" : "ACTIVE",
      currentPeriodEnd: plan.isFree ? null : periodEnd,
    },
    create: {
      organizationId,
      plan: stored,
      status: plan.isFree ? "FREE" : "ACTIVE",
      provider: "STRIPE",
      currentPeriodEnd: plan.isFree ? null : periodEnd,
    },
  });
  reportPlanChange(organizationId, "self_serve", planWas);
  revalidatePath("/dashboard/settings/account");
  revalidatePath("/dashboard/subscription");
  // The responsive staging build still serves this surface too; both refresh.
  revalidatePath("/dashboard/subscription-blueprint");
  revalidatePath("/dashboard");
  await billingSaved(organizationId, user.id, `Updated billing settings — plan set to ${plan.name}`, { plan: plan.slug });
  return { ok: true };
}

export interface SubscriptionInvoice {
  id: string;
  number: string | null;
  amountPaidCents: number;
  currency: string;
  status: string | null;
  created: number; // epoch seconds
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
}

/**
 * Real subscription billing history, pulled read-only from Stripe (the org's
 * subscription invoices — what the contractor paid JobFlex). This is distinct
 * from the `Payment` table, which records the contractor's *customers'* payments.
 *
 * Read-only (`invoices.list`) — no live-write guard / env flag needed. Returns
 * `{ available: false }` when Stripe isn't configured or the org has no Stripe
 * customer yet, so the UI can show a clear empty state instead of fake rows.
 */
/** The next bill, previewed by Stripe with every discount and credit that
 *  will apply — so a referral reward or coupon shows up BEFORE it is charged. */
export interface UpcomingInvoice {
  /** Epoch seconds the invoice will be attempted (period end). */
  dueAt: number | null;
  amountDueCents: number;
  subtotalCents: number;
  /** Coupons / promotion codes on the subscription, summed. */
  discountCents: number;
  /** Customer balance (referral rewards) applied against this invoice. */
  creditCents: number;
  /** Credit sitting on the customer balance BEFORE this invoice takes its
   *  share — what is left afterwards is this minus `creditCents`. */
  balanceCreditCents: number;
  /** Coupon lines only: "Referral coupon −$2.50". The balance credit is
   *  itemised by the page, which knows how many referrals funded it. */
  notes: string[];
}

export async function listSubscriptionInvoices(): Promise<{
  available: boolean;
  invoices: SubscriptionInvoice[];
  upcoming?: UpcomingInvoice | null;
}> {
  const { organizationId } = await requireOwner();
  const sub = await db.subscription.findUnique({ where: { organizationId } });

  if (!isStripeEnabled() || !sub?.externalCustomerId) {
    return { available: false, invoices: [] };
  }

  try {
    // Mode-aware: a subscription started on the sandbox has its invoices on
    // the sandbox. The live-only client returned nothing for it.
    const { stripe } = await getStripeClient();
    const res = await stripe.invoices.list({
      customer: sub.externalCustomerId,
      limit: 12,
    });
    const trialOnly = await trialOnlyInvoiceIds(stripe, res.data);
    const invoices: SubscriptionInvoice[] = res.data.filter((inv) => !trialOnly.has(inv.id)).map((inv) => ({
      id: inv.id,
      number: inv.number ?? null,
      amountPaidCents: inv.amount_paid ?? 0,
      currency: (inv.currency ?? "usd").toUpperCase(),
      status: inv.status ?? null,
      created: inv.created,
      hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
      invoicePdf: inv.invoice_pdf ?? null,
    }));

    /* THE NEXT BILL (owner, 2026-09-02): Stripe's own preview of the upcoming
       invoice for this subscription, which already nets out every coupon on
       the subscription and the customer's credit balance — the referral
       reward lands as a negative balance, so "$50 off" is visible here weeks
       before the charge. Best-effort: a preview failure leaves the history. */
    let upcoming: UpcomingInvoice | null = null;
    if (sub.externalSubId) {
      try {
        const pre = await stripe.invoices.createPreview({
          customer: sub.externalCustomerId,
          subscription: sub.externalSubId,
          // Clover keeps a discount's coupon under source and sends it as an id.
          expand: ["total_discount_amounts.discount.source.coupon"],
        });
        const subtotal = pre.subtotal ?? 0;
        const total = pre.total ?? 0;
        const due = pre.amount_due ?? 0;
        const discountCents = (pre.total_discount_amounts ?? []).reduce((n, d) => n + (d.amount ?? 0), 0);
        // Credit applied = what the total was brought down by from the balance.
        const creditCents = Math.max(0, total - due);
        const notes: string[] = [];
        for (const d of pre.total_discount_amounts ?? []) {
          const disc = d.discount as unknown as
            | { coupon?: { name?: string | null }; source?: { coupon?: { name?: string | null } | string | null } }
            | string;
          const coupon = typeof disc === "object" ? (disc?.source?.coupon ?? disc?.coupon) : null;
          const name = typeof coupon === "object" && coupon?.name ? coupon.name : "Discount";
          if (d.amount) notes.push(`${name} −$${(d.amount / 100).toFixed(2)}`);
        }
        const firstLine = pre.lines?.data?.[0];
        upcoming = {
          dueAt: pre.next_payment_attempt ?? firstLine?.period?.end ?? pre.period_end ?? null,
          amountDueCents: due,
          subtotalCents: subtotal,
          discountCents,
          creditCents,
          // Stripe balances are negative when they are credit.
          balanceCreditCents: Math.max(creditCents, -(pre.starting_balance ?? 0)),
          notes,
        };
      } catch (err) {
        console.warn("[billing] upcoming invoice preview failed:", err);
      }
    }
    return { available: true, invoices, upcoming };
  } catch {
    // Stripe reachable-but-erroring shouldn't blow up the page.
    return { available: false, invoices: [] };
  }
}

/* ── CANCEL AT THE END OF THE CYCLE ──────────────────────────────────────
   (owner, 2026-09-20) The subscription page's last row. Cancelling is booked,
   not immediate: Stripe keeps `cancel_at_period_end`, the shop keeps every
   paid day it already has, and nothing is refunded — the same money rule the
   plan dialog states for a downgrade. The booking is mirrored locally on
   `Subscription.canceledAt` (an existing column; no schema change), which is
   what the page reads to show "cancelling on <date>" and offer the undo.

   Resuming clears the booking on both sides while the cycle is still running.
   Once the period has actually ended Stripe has cancelled for real and there
   is nothing here to resume — that shop checks out again. */
export type CancelSubscriptionResult =
  | { ok: true; endsAt: string | null }
  | { ok: false; error: string };

export async function cancelSubscription(): Promise<CancelSubscriptionResult> {
  const { organizationId, user } = await requireOwner();
  const sub = await db.subscription.findUnique({ where: { organizationId } });
  if (!sub) return { ok: false, error: "There's no subscription to cancel." };
  if (sub.canceledAt) return { ok: false, error: "This subscription is already set to cancel." };

  let endsAt: Date | null = sub.currentPeriodEnd ?? sub.trialEndsAt ?? null;
  if (sub.externalSubId && isStripeEnabled()) {
    const { stripe } = await getStripeClient();
    try {
      const updated = await stripe.subscriptions.update(sub.externalSubId, {
        cancel_at_period_end: true,
      });
      endsAt = subscriptionPeriodEndDate(updated) ?? endsAt;
    } catch (err) {
      console.warn("[billing] cancelSubscription failed:", err);
      return { ok: false, error: "Couldn't cancel the subscription. Try again." };
    }
  }

  await db.subscription.update({
    where: { organizationId },
    data: { canceledAt: new Date(), ...(endsAt ? { currentPeriodEnd: endsAt } : {}) },
  });
  revalidatePlanSurfaces();
  revalidatePath("/dashboard/subscription");
  await billingSaved(organizationId, user.id, `Updated billing settings — subscription set to cancel${endsAt ? ` on ${endsAt.toLocaleDateString("en-US")}` : ""}`, { canceled: true, endsAt: endsAt?.toISOString() });
  return { ok: true, endsAt: endsAt ? endsAt.toISOString() : null };
}

export async function resumeSubscription(): Promise<CancelSubscriptionResult> {
  const { organizationId, user } = await requireOwner();
  const sub = await db.subscription.findUnique({ where: { organizationId } });
  if (!sub) return { ok: false, error: "There's no subscription to resume." };
  if (!sub.canceledAt) return { ok: false, error: "This subscription isn't cancelling." };

  let endsAt: Date | null = sub.currentPeriodEnd ?? null;
  if (sub.externalSubId && isStripeEnabled()) {
    const { stripe } = await getStripeClient();
    try {
      const current = await stripe.subscriptions.retrieve(sub.externalSubId);
      // Already over: Stripe cancelled for real and nothing can be resumed.
      if (current.status === "canceled" || current.status === "incomplete_expired") {
        return { ok: false, error: "This subscription has already ended. Choose a plan to start again." };
      }
      const updated = await stripe.subscriptions.update(sub.externalSubId, {
        cancel_at_period_end: false,
      });
      endsAt = subscriptionPeriodEndDate(updated) ?? endsAt;
    } catch (err) {
      console.warn("[billing] resumeSubscription failed:", err);
      return { ok: false, error: "Couldn't resume the subscription. Try again." };
    }
  }

  await db.subscription.update({
    where: { organizationId },
    data: { canceledAt: null, ...(endsAt ? { currentPeriodEnd: endsAt } : {}) },
  });
  revalidatePlanSurfaces();
  revalidatePath("/dashboard/subscription");
  await billingSaved(organizationId, user.id, "Updated billing settings — subscription resumed", { canceled: false });
  return { ok: true, endsAt: endsAt ? endsAt.toISOString() : null };
}

/* ── CHANGE PLAN IN PLACE ────────────────────────────────────────────────
   Until 2026-09-02 every plan button led to /dashboard/upgrade, whose only
   move was a NEW Checkout session — a second subscription beside the first,
   and no way down at all. A shop that already has a Stripe subscription now
   has its price swapped on that subscription:
     · UPGRADE  — `always_invoice`: the prorated difference is charged now.
     · DOWNGRADE — `none`: the lower price starts at once, nothing is charged.
   A shop with no subscription yet (or a cancelled one) is sent through
   checkout as before — the caller handles `mode: "checkout"`. */
export type ChangePlanResult =
  | { ok: true; mode: "switched"; direction: "up" | "down"; planName: string }
  | { ok: true; mode: "checkout" }
  | { ok: false; error: string };

export async function changePlan(
  planSlug: string,
  interval: "MONTH" | "YEAR" = "MONTH",
): Promise<ChangePlanResult> {
  const { organizationId, user } = await requireOwner();
  const plan = await getPlanBySlug(planSlug);
  if (!plan || !plan.active) return { ok: false, error: "That plan is not available." };
  if (plan.isFree) return { ok: false, error: "That plan can't be switched to here." };
  if (interval === "YEAR" && !plan.yearlyPriceCents) {
    return { ok: false, error: "This plan has no yearly option." };
  }
  if (!isStripeEnabled()) return { ok: false, error: "Checkout is not configured." };

  const [sub, ctx] = await Promise.all([
    db.subscription.findUnique({ where: { organizationId } }),
    getOrgPlanContext(organizationId),
  ]);
  if (!sub?.externalSubId) return { ok: true, mode: "checkout" };
  if (ctx.plan?.slug === plan.slug) return { ok: false, error: "That is already your plan." };

  const { stripe, mode } = await getStripeClient();
  let current;
  try {
    current = await stripe.subscriptions.retrieve(sub.externalSubId);
  } catch {
    return { ok: true, mode: "checkout" };
  }
  if (current.status === "canceled" || current.status === "incomplete_expired") {
    return { ok: true, mode: "checkout" };
  }
  const item = current.items.data[0];
  if (!item) return { ok: true, mode: "checkout" };

  // The price of record for the target plan, by Stripe mode (same rule as
  // the checkout route).
  let priceId: string | null = null;
  if (mode === "live") {
    const price = await db.planPrice.findFirst({
      where: { planSlug: plan.slug, interval, active: true },
    });
    if (!price) return { ok: false, error: "That plan isn't available for checkout yet." };
    priceId = price.stripePriceId;
  } else {
    const cents = interval === "YEAR" ? (plan.yearlyPriceCents ?? 0) : plan.priceCents;
    priceId = await ensureRecurringPrice({
      stripe,
      mode,
      kind: plan.slug,
      name: `JobFlex ${plan.name}`,
      interval,
      cents,
    });
  }

  const currentCents = ctx.plan?.priceCents ?? 0;
  const direction: "up" | "down" = plan.priceCents > currentCents ? "up" : "down";

  try {
    const updated = await stripe.subscriptions.update(current.id, {
      // Any other line goes: a custom plan's page quantity (lib/customBilling)
      // must not keep billing under a catalog plan.
      items: [{ id: item.id, price: priceId }, ...current.items.data.slice(1).map((i) => ({ id: i.id, deleted: true as const }))],
      proration_behavior: direction === "up" ? "always_invoice" : "none",
      // A trial in progress keeps its end date either way.
      ...(current.status === "trialing" ? { trial_end: current.trial_end ?? undefined } : {}),
      metadata: { ...(current.metadata ?? {}), organizationId, planSlug: plan.slug, interval, customPages: "" },
    });
    const trialEnd = updated.trial_end ? new Date(updated.trial_end * 1000) : null;
    const periodEnd = subscriptionPeriodEndDate(updated);
    const planWas = await planSnapshot(organizationId);
    await db.subscription.update({
      where: { organizationId },
      data: {
        plan: plan.slug.toUpperCase(),
        status: updated.status === "trialing" ? SubscriptionStatus.TRIALING : SubscriptionStatus.ACTIVE,
        stripePriceId: priceId,
        trialEndsAt: trialEnd,
        currentPeriodEnd: periodEnd,
      },
    });
    reportPlanChange(organizationId, "self_serve", planWas);
  } catch (err) {
    logServerError("billing.changePlan", err, { kind: "action", organizationId });
    const msg = err instanceof Error ? err.message : "";
    return {
      ok: false,
      error: /payment|card|declined/i.test(msg)
        ? "The card on file was declined for the difference. Update it in Stripe and try again."
        : "Couldn't switch the plan. Try again.",
    };
  }
  revalidatePlanSurfaces();
  revalidatePath("/dashboard/subscription");
  await billingSaved(organizationId, user.id, `Updated billing settings — plan ${direction === "up" ? "upgraded" : "downgraded"} to ${plan.name}`, { plan: plan.slug, interval, direction });
  return { ok: true, mode: "switched", direction, planName: plan.name };
}

/* ── CHANGE A CUSTOM PLAN'S PAGES (owner, 2026-10-06) ─────────────────
   One subscription, base + page × quantity (lib/customBilling). Adding a
   page charges the prorated difference now on the subscription the shop
   already has — no new Checkout, no cancelled subscription, a running trial
   keeps running (nothing is charged in it). Removing a page closes it now and
   lowers the price from the next bill, with no refund (the owner's rule).
   Our page record is the truth; Stripe's quantity and metadata follow. */
export type CustomPagesResult = CustomPagesChange;

async function applyPages(next: string[], verb: string): Promise<CustomPagesResult> {
  const { organizationId, user } = await requireOwner();
  const res = await changeCustomPages({ organizationId, next });
  if (!res.ok) return res;
  revalidatePlanSurfaces();
  revalidatePath("/dashboard/upgrade");
  revalidatePath("/dashboard/subscription");
  revalidatePath("/dashboard", "layout");
  const parts = [
    res.added.length ? `added ${res.added.length} page${res.added.length === 1 ? "" : "s"}` : "",
    res.removed.length ? `removed ${res.removed.length} page${res.removed.length === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  await billingSaved(organizationId, user.id, `Updated billing settings — ${parts.join(" and ") || verb} on the custom plan`, {
    pages: res.pages,
    added: res.added,
    removed: res.removed,
    chargedCents: res.chargedCents,
  });
  return res;
}

async function ownedPages(): Promise<string[]> {
  const { organizationId } = await requireOwner();
  return readOrgPages(organizationId);
}

/** The picker's "done": the whole selection the owner wants. */
export async function updateCustomPages(rawIds: unknown): Promise<CustomPagesResult> {
  const next = normalizeCustomPages(Array.isArray(rawIds) ? rawIds.map(String) : []);
  return applyPages(next, "changed pages");
}

/** Add pages (the upgrade gate's one-click "Add Calendar for $10/mo"). */
export async function addCustomPages(rawIds: unknown): Promise<CustomPagesResult> {
  const adding = normalizeCustomPages(Array.isArray(rawIds) ? rawIds.map(String) : []);
  const owned = await ownedPages();
  if (adding.every((id) => owned.includes(id))) return { ok: false, error: "Pick a page you don't have yet." };
  return applyPages([...owned, ...adding.filter((id) => !owned.includes(id))], "added pages");
}

/** Remove pages: closed now, cheaper from the next bill, nothing refunded. */
export async function removeCustomPages(rawIds: unknown): Promise<CustomPagesResult> {
  const dropping = normalizeCustomPages(Array.isArray(rawIds) ? rawIds.map(String) : []);
  const owned = await ownedPages();
  if (!dropping.some((id) => owned.includes(id))) return { ok: false, error: "Pick a page you have." };
  return applyPages(owned.filter((id) => !dropping.includes(id)), "removed pages");
}

/** What a selection would charge now (prorated) and per month after. */
export async function previewCustomPagesChange(
  rawIds: unknown,
): Promise<{ dueNowCents: number | null; monthlyCents: number; trialing: boolean }> {
  const { organizationId } = await requireOwner();
  const next = normalizeCustomPages(Array.isArray(rawIds) ? rawIds.map(String) : []);
  return previewCustomPages(organizationId, next);
}
