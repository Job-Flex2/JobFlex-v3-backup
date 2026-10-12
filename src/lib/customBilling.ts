// THE CUSTOM PLAN ON STRIPE — one subscription, two prices (owner, 2026-10-06).
//
//   base  "custom-base"  $20/mo ($200/yr)  quantity 1
//   page  "custom-page"  $10/mo ($100/yr)  quantity = number of pages
//
// Until this, every distinct total was its own price and adding a page meant
// a brand-new Checkout that cancelled the old subscription with no credit (a
// shop paid $60, then $70 a minute later) and threw away a running trial.
// Now a page change is a QUANTITY change on the same subscription:
//
//   · ADD — proration_behavior "always_invoice": the prorated difference for
//     the rest of the period is invoiced and charged at once, under
//     payment_behavior "pending_if_incomplete", so a declined card applies
//     NOTHING (the pending update's invoice is voided). During a trial there
//     is nothing to charge: the quantity changes and the trial runs on.
//   · REMOVE — the owner's no-refunds rule: proration_behavior "none". The
//     page closes now and the lower price starts on the next bill.
//
// THE SOURCE OF TRUTH for which pages an org holds is ours — SyncState
// `orgPages:<orgId>`, read by lib/customPageAccess. Stripe carries the
// matching quantity and, in metadata, organizationId + customPages, so a
// subscription can always be traced back; nothing here ever reads pages FROM
// Stripe to grant access (an old checkout return used to — see
// app/dashboard/upgrade verifyReturn).
//
// LEGACY SUBSCRIPTIONS (one "custom" price per total, before this file) are
// converted in place the first time their pages change, with no proration —
// the total does not move — and in bulk by scripts/billing/custom-plan-migrate.ts.

import type Stripe from "stripe";
import { db } from "@/lib/db";
import { getStripeClient, isStripeEnabled } from "@/lib/sdk/stripe";
import type { StripeMode } from "@/lib/stripeMode";
import { ensureRecurringPrice } from "@/lib/stripePriceCache";
import { priceInterval } from "@/lib/priceInterval";
import { readScheduledSwitch } from "@/lib/planChange";
import {
  CUSTOM_BASE_CENTS,
  CUSTOM_PAGE_CENTS,
  CUSTOM_PAGES,
  CUSTOM_YEAR_MULTIPLIER,
  customPriceCents,
  normalizeCustomPages,
} from "@/lib/customPlan";

export type CustomInterval = "MONTH" | "YEAR";

export const CUSTOM_BASE_KIND = "custom-base";
export const CUSTOM_PAGE_KIND = "custom-page";
/** The one-price-per-total kind every custom subscription used before. */
export const CUSTOM_LEGACY_KIND = "custom";

/** The reusable base and page prices on the account the client reaches. */
export async function customPrices(
  stripe: Stripe,
  mode: StripeMode,
  interval: CustomInterval,
): Promise<{ base: string; page: string }> {
  const m = interval === "YEAR" ? CUSTOM_YEAR_MULTIPLIER : 1;
  const [base, page] = await Promise.all([
    ensureRecurringPrice({ stripe, mode, kind: CUSTOM_BASE_KIND, name: "JobFlex Custom plan — base", interval, cents: CUSTOM_BASE_CENTS * m }),
    ensureRecurringPrice({ stripe, mode, kind: CUSTOM_PAGE_KIND, name: "JobFlex Custom plan — page", interval, cents: CUSTOM_PAGE_CENTS * m }),
  ]);
  return { base, page };
}

/** Checkout / subscription line items for a selection: the base, plus the
 *  page price × the number of pages (left out when there are none). */
export async function customLineItems(
  stripe: Stripe,
  mode: StripeMode,
  interval: CustomInterval,
  pages: readonly string[],
): Promise<{ price: string; quantity: number }[]> {
  const n = normalizeCustomPages(pages).length;
  const { base, page } = await customPrices(stripe, mode, interval);
  return [{ price: base, quantity: 1 }, ...(n > 0 ? [{ price: page, quantity: n }] : [])];
}

/** What Stripe carries for the selection (an empty value deletes the key). */
export function customMetadata(organizationId: string | null, pages: readonly string[]): Record<string, string> {
  return {
    ...(organizationId ? { organizationId } : {}),
    planSlug: "custom",
    customPages: normalizeCustomPages(pages).join(","),
  };
}

function kindOf(item: Stripe.SubscriptionItem): string {
  return item.price?.metadata?.jfKind ?? "";
}

/** The subscription's custom items by kind. */
export function customItemsOf(sub: Stripe.Subscription): {
  base: Stripe.SubscriptionItem | null;
  page: Stripe.SubscriptionItem | null;
  legacy: Stripe.SubscriptionItem[];
} {
  const items = sub.items.data;
  return {
    base: items.find((i) => kindOf(i) === CUSTOM_BASE_KIND) ?? null,
    page: items.find((i) => kindOf(i) === CUSTOM_PAGE_KIND) ?? null,
    legacy: items.filter((i) => kindOf(i) === CUSTOM_LEGACY_KIND),
  };
}

/** The page quantity a subscription bills (0 without a page item). */
export function billedPageCount(sub: Stripe.Subscription): number {
  return customItemsOf(sub).page?.quantity ?? 0;
}

export function intervalOf(sub: Stripe.Subscription): CustomInterval {
  return sub.items.data[0]?.price?.recurring?.interval === "year" ? "YEAR" : "MONTH";
}

/** The pages the org holds (SyncState orgPages), [] when none are recorded. */
export async function readOrgPages(organizationId: string): Promise<string[]> {
  const row = await db.syncState.findUnique({ where: { key: `orgPages:${organizationId}` } });
  if (!row) return [];
  try {
    return normalizeCustomPages(JSON.parse(row.cursor) as string[]);
  } catch {
    return [];
  }
}

export async function writeOrgPages(organizationId: string, pages: readonly string[]): Promise<void> {
  const cursor = JSON.stringify(normalizeCustomPages(pages));
  await db.syncState.upsert({
    where: { key: `orgPages:${organizationId}` },
    update: { cursor },
    create: { key: `orgPages:${organizationId}`, cursor },
  });
}

/**
 * Convert a one-price subscription to base + page × quantity with NO
 * proration (the total is unchanged when `pages` is what it bills). Returns
 * the refreshed subscription; a subscription already on the two prices is
 * returned as it is.
 */
export async function convertLegacyCustomSubscription(
  stripe: Stripe,
  mode: StripeMode,
  sub: Stripe.Subscription,
  organizationId: string | null,
  pages: readonly string[],
): Promise<Stripe.Subscription> {
  const { base, legacy } = customItemsOf(sub);
  if (base && legacy.length === 0) return sub;
  const n = normalizeCustomPages(pages).length;
  const prices = await customPrices(stripe, mode, intervalOf(sub));
  const items: Stripe.SubscriptionUpdateParams.Item[] = [
    ...legacy.map((i) => ({ id: i.id, deleted: true as const })),
    ...(base ? [] : [{ price: prices.base, quantity: 1 }]),
    ...(n > 0 && !customItemsOf(sub).page ? [{ price: prices.page, quantity: n }] : []),
  ];
  return stripe.subscriptions.update(sub.id, {
    items,
    proration_behavior: "none",
    metadata: { ...(sub.metadata ?? {}), ...customMetadata(organizationId, pages) },
  });
}

export type CustomPagesChange =
  | {
      ok: true;
      pages: string[];
      added: string[];
      removed: string[];
      /** Charged at once for the added pages (prorated); 0 in a trial. */
      chargedCents: number;
      /** The new price per month from the next bill. */
      monthlyCents: number;
      /** The new price for the term the plan is billed on — the year's on a
       *  yearly custom plan (2026-10-12: it read "$50/mo" for a $500 year). */
      termCents: number;
      interval: CustomInterval;
      trialing: boolean;
    }
  | { ok: false; error: string };

const LIVE_STATUSES = new Set(["active", "trialing"]);

function labels(ids: readonly string[]): string {
  return ids.map((id) => CUSTOM_PAGES.find((p) => p.id === id)?.label ?? id).join(", ");
}

/**
 * THE ONE WAY A CUSTOM PLAN'S PAGES CHANGE. Removals first (no proration,
 * no refund), then additions (prorated, charged now; nothing in a trial), on
 * the org's own subscription — never a new Checkout, never a cancellation.
 * `billing: "none"` is the admin's access-only change: our record moves,
 * Stripe is not touched.
 */
export async function changeCustomPages(opts: {
  organizationId: string;
  next: readonly string[];
  billing?: "customer" | "none";
}): Promise<CustomPagesChange> {
  const { organizationId } = opts;
  const billing = opts.billing ?? "customer";
  const row = await db.subscription.findUnique({ where: { organizationId } });
  if ((row?.plan ?? "").toUpperCase() !== "CUSTOM") {
    return { ok: false, error: "Pages can only be changed on the Custom plan." };
  }
  const owned = await readOrgPages(organizationId);
  const next = normalizeCustomPages(opts.next as string[]);
  const added = next.filter((id) => !owned.includes(id));
  const removed = owned.filter((id) => !next.includes(id));
  if (added.length === 0 && removed.length === 0) return { ok: false, error: "Nothing changed." };

  // A booked switch to a monthly catalog plan holds the subscription on a
  // schedule (lib/planChange); the pages wait until it is cancelled or done.
  if (billing === "customer") {
    const booked = await readScheduledSwitch(organizationId).catch(() => null);
    if (booked) return { ok: false, error: `A switch to ${booked.planName} is booked for ${new Date(booked.at).toLocaleDateString("en-US")}. Cancel it first to change pages.` };
  }

  if (billing === "none") {
    await writeOrgPages(organizationId, next);
    const interval: CustomInterval = row?.stripePriceId ? ((await priceInterval(row.stripePriceId)) ?? "MONTH") : "MONTH";
    return { ok: true, pages: next, added, removed, chargedCents: 0, monthlyCents: customPriceCents(next), termCents: customPriceCents(next, interval), interval, trialing: row?.status === "TRIALING" };
  }

  if (!row?.externalSubId || !isStripeEnabled()) {
    return { ok: false, error: "There is no subscription on file to change. Contact support." };
  }
  const { stripe, mode } = await getStripeClient();
  let sub: Stripe.Subscription;
  try {
    sub = await stripe.subscriptions.retrieve(row.externalSubId);
  } catch {
    return { ok: false, error: "Couldn't reach your subscription. Try again." };
  }
  if (!LIVE_STATUSES.has(sub.status)) {
    return {
      ok: false,
      error:
        sub.status === "past_due" || sub.status === "unpaid"
          ? "Your last payment didn't go through. Update the card first, then change pages."
          : "Your subscription isn't active, so its pages can't change.",
    };
  }
  const trialing = sub.status === "trialing";

  try {
    sub = await convertLegacyCustomSubscription(stripe, mode, sub, organizationId, owned);
  } catch (err) {
    console.warn("[customBilling] legacy conversion failed:", err);
    return { ok: false, error: "Couldn't update your plan. Try again." };
  }
  const prices = await customPrices(stripe, mode, intervalOf(sub));

  // ── 1. REMOVE: no proration, the lower price starts next bill. ─────────
  let kept = owned;
  if (removed.length > 0) {
    kept = owned.filter((id) => !removed.includes(id));
    const page = customItemsOf(sub).page;
    try {
      sub = await stripe.subscriptions.update(sub.id, {
        items: page ? [kept.length > 0 ? { id: page.id, quantity: kept.length } : { id: page.id, deleted: true }] : [],
        proration_behavior: "none",
        metadata: { ...(sub.metadata ?? {}), ...customMetadata(organizationId, kept) },
      });
    } catch (err) {
      console.warn("[customBilling] removing pages failed:", err);
      return { ok: false, error: "Couldn't update your plan. Try again." };
    }
    await writeOrgPages(organizationId, kept);
  }

  // ── 2. ADD: prorated and charged now; all-or-nothing on the card. ──────
  let chargedCents = 0;
  if (added.length > 0) {
    const page = customItemsOf(sub).page;
    const item = page ? { id: page.id, quantity: next.length } : { price: prices.page, quantity: next.length };
    const startedAt = Math.floor(Date.now() / 1000) - 5;
    let updated: Stripe.Subscription;
    try {
      updated = await stripe.subscriptions.update(sub.id, {
        items: [item],
        ...(trialing
          ? { proration_behavior: "none" as const }
          : { proration_behavior: "always_invoice" as const, payment_behavior: "pending_if_incomplete" as const }),
        metadata: { ...(sub.metadata ?? {}), ...customMetadata(organizationId, next) },
        expand: ["latest_invoice"],
      });
    } catch (err) {
      console.warn("[customBilling] adding pages failed:", err);
      return {
        ok: false,
        error: removed.length
          ? `${labels(removed)} ${removed.length === 1 ? "was" : "were"} removed, but the new pages couldn't be added. Try again.`
          : "Couldn't add the pages. Try again.",
      };
    }
    if (updated.pending_update) {
      // The card did not pay for the prorated difference: nothing applied.
      // Void the pending update's invoice so no stray charge is retried.
      const inv = updated.latest_invoice;
      const invId = typeof inv === "string" ? inv : inv?.id;
      if (invId) await stripe.invoices.voidInvoice(invId).catch((err) => console.warn("[customBilling] void failed:", err));
      return {
        ok: false,
        error: removed.length
          ? `${labels(removed)} ${removed.length === 1 ? "was" : "were"} removed. The card on file was declined for ${labels(added)} — nothing was charged for ${added.length === 1 ? "it" : "them"}.`
          : `The card on file was declined for ${labels(added)}. Nothing was added or charged.`,
      };
    }
    const inv = updated.latest_invoice;
    if (inv && typeof inv !== "string" && (inv.created ?? 0) >= startedAt && inv.billing_reason === "subscription_update") {
      chargedCents = inv.amount_paid ?? 0;
    }
    sub = updated;
    await writeOrgPages(organizationId, next);
  }

  await db.subscription
    .update({ where: { organizationId }, data: { stripePriceId: customItemsOf(sub).base?.price.id ?? prices.base } })
    .catch(() => {});
  const interval = intervalOf(sub);
  return { ok: true, pages: next, added, removed, chargedCents, monthlyCents: customPriceCents(next), termCents: customPriceCents(next, interval), interval, trialing };
}

/**
 * What a change would cost before it is made: the prorated amount charged
 * now (Stripe's own preview; 0 in a trial or for removals) and the price per
 * month from the next bill. Null `dueNowCents` = Stripe could not preview
 * (legacy subscription, or no subscription) — the dialog says "prorated".
 */
export async function previewCustomPages(
  organizationId: string,
  nextRaw: readonly string[],
): Promise<{ dueNowCents: number | null; monthlyCents: number; trialing: boolean }> {
  const next = normalizeCustomPages(nextRaw as string[]);
  const owned = await readOrgPages(organizationId);
  const added = next.filter((id) => !owned.includes(id));
  const out = { dueNowCents: 0 as number | null, monthlyCents: customPriceCents(next), trialing: false };
  const row = await db.subscription.findUnique({ where: { organizationId } });
  out.trialing = row?.status === "TRIALING";
  if (added.length === 0 || out.trialing) return out;
  if (!row?.externalSubId || !isStripeEnabled()) return { ...out, dueNowCents: null };
  try {
    const { stripe } = await getStripeClient();
    const sub = await stripe.subscriptions.retrieve(row.externalSubId);
    if (sub.status === "trialing") return { ...out, trialing: true };
    const { page, base, legacy } = customItemsOf(sub);
    if (!base || legacy.length) return { ...out, dueNowCents: null };
    const { mode } = await getStripeClient();
    const { page: pagePrice } = await customPrices(stripe, mode, intervalOf(sub));
    // Proration is linear in the quantity, so the charge for the ADDED pages
    // is previewed on its own: today's quantity + the added count. (Removals
    // carry no proration — they change nothing due now.)
    const pre = await stripe.invoices.createPreview({
      customer: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
      subscription: sub.id,
      subscription_details: {
        items: [page ? { id: page.id, quantity: page.quantity! + added.length } : { price: pagePrice, quantity: added.length }],
        proration_behavior: "always_invoice",
      },
    });
    const proration = pre.lines.data
      .filter((l) => {
        const parent = l.parent as { subscription_item_details?: { proration?: boolean } } | null | undefined;
        return Boolean(parent?.subscription_item_details?.proration);
      })
      .reduce((sum, l) => sum + l.amount, 0);
    return { ...out, dueNowCents: Math.max(0, proration) };
  } catch (err) {
    console.warn("[customBilling] preview failed:", err);
    return { ...out, dueNowCents: null };
  }
}

/** Name the org on a custom subscription made before the org existed
 *  (signup): organizationId + the pages, in metadata. Best-effort. */
export async function stampCustomSubscription(subId: string, organizationId: string, pages: readonly string[]): Promise<void> {
  try {
    const { stripe } = await getStripeClient();
    const sub = await stripe.subscriptions.retrieve(subId);
    await stripe.subscriptions.update(subId, { metadata: { ...(sub.metadata ?? {}), ...customMetadata(organizationId, pages) } });
  } catch (err) {
    console.warn("[customBilling] could not stamp the subscription:", err);
  }
}
