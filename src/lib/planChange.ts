import "server-only";
// A PLAN OR TERM CHANGE ON THE SUBSCRIPTION A SHOP ALREADY HAS (owner, 2026-10-12).
//
// One place decides how a change is made and what it costs, so the dialog and
// the change itself can never disagree:
//
//   · "trial"    — during a trial: the price is swapped, the trial runs on,
//                  nothing is charged today.
//   · "schedule" — YEAR → MONTH (with or without another plan): the paid year
//                  is kept to its last day; the switch is booked on a Stripe
//                  subscription schedule for that day and can be cancelled
//                  until then ("Switches to monthly on <date>").
//   · "charge"   — MONTH → YEAR, or a dearer price on the same term: invoiced
//                  today with the unused part of the current period credited
//                  (`always_invoice`; a term change restarts the cycle today).
//                  ALL OR NOTHING on the card (`pending_if_incomplete`): a
//                  declined card leaves the plan, the subscription and the
//                  open invoice exactly as they were — the invoice is voided —
//                  and the owner is sent to update the card.
//   · "free"     — a cheaper price on the same term: switched now, nothing
//                  charged, nothing refunded (the rule since 2026-09-02).
//   · "checkout" — no live subscription, or an upgrade on the same term by
//                  tier: paid on Stripe's page (the owner's rule, 2026-09-02),
//                  which replaces the subscription (lib/checkoutReturn).
//
// What the dialog shows as "today" is Stripe's own preview of the invoice
// (invoices.createPreview with the same items, proration and proration date
// the change is then made with) — never a sum worked out here.
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { getStripeClient } from "@/lib/sdk/stripe";
import type { StripeMode } from "@/lib/stripeMode";
import { ensureRecurringPrice } from "@/lib/stripePriceCache";
import { getPlanBySlug, getPlanCatalog } from "@/lib/planCatalogServer";
import { SubscriptionStatus } from "@/lib/prismaEnums";
import { subscriptionPeriodEnd, subscriptionPeriodEndDate } from "@/lib/stripeCompat";
import { CUSTOM_PLAN_SLUG } from "@/lib/customPlan";
import { changeRoute, type BillingTermName, type ChangeRoute } from "@/lib/planChangeRoute";
import { priceInterval } from "@/lib/priceInterval";
import { ensureYearFirstMonthCoupon } from "@/lib/yearDiscount";
import { syncSubscriptionFromStripe } from "@/lib/stripeSync";
import { releaseAttachedSchedule } from "@/lib/scheduleRelease";

export { releaseAttachedSchedule };

export type Term = BillingTermName;
export type { ChangeRoute };

export type PlanChangePreview = {
  ok: true;
  route: ChangeRoute;
  planSlug: string;
  planName: string;
  interval: Term;
  /** The term the shop is on now; null without a live subscription. */
  fromInterval: Term | null;
  /** Stripe's preview of what is charged today (0 for trial / schedule / free;
   *  null for checkout — Stripe's page says it). */
  dueNowCents: number | null;
  /** The unused part of the current period taken off today's invoice. */
  creditCents: number;
  /** The new plan's price per term, and when it is first billed as such. */
  termCents: number;
  nextBillAt: string | null;
  /** "schedule": the day the switch happens (the paid year's end). */
  switchAt: string | null;
  /** Passed back to the change so it is made on the previewed proration. */
  prorationDate: number | null;
};
export type PlanChangeRefusal = { ok: false; error: string; code?: "card_declined" | "past_due" | "same_plan" };

export type PlanChangeDone =
  | { ok: true; mode: "switched"; route: "charge" | "free" | "trial"; planName: string; interval: Term; chargedCents: number }
  | { ok: true; mode: "scheduled"; planName: string; interval: Term; switchAt: string }
  | { ok: true; mode: "checkout" }
  | PlanChangeRefusal;

/** The booked YEAR → MONTH switch (SyncState `planSwitch:<orgId>`). */
export type ScheduledSwitch = {
  scheduleId: string;
  subId: string;
  planSlug: string;
  planName: string;
  interval: Term;
  at: string;
  /** The price the switch moves to (records from before 2026-10-12 have none: it is looked up). */
  priceId?: string;
};
const switchKey = (orgId: string) => `planSwitch:${orgId}`;

export const CARD_DECLINED = "Card declined — update your card.";
const PAST_DUE = "Your last payment didn't go through. Update your card first, then change the plan.";

const termOf = (sub: Stripe.Subscription): Term =>
  sub.items.data.some((i) => i.price.recurring?.interval === "year") ? "YEAR" : "MONTH";
const totalOf = (sub: Stripe.Subscription) =>
  sub.items.data.reduce((n, i) => n + (i.price.unit_amount ?? 0) * (i.quantity ?? 1), 0);
const iso = (unix: number | null | undefined) => (unix ? new Date(unix * 1000).toISOString() : null);
const customerOf = (sub: Stripe.Subscription) => (typeof sub.customer === "string" ? sub.customer : sub.customer.id);
const DAY = 86_400;
const addTerm = (unix: number, term: Term) => {
  const d = new Date(unix * 1000);
  if (term === "YEAR") d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return Math.floor(d.getTime() / 1000);
};

/** Stripe as the change sees it: the admin's live/sandbox client, or one handed in by a check. */
export type PlanChangeDeps = {
  stripe: Stripe;
  mode: StripeMode;
  /** A check's seam: runs just before our row is written after Stripe applied a change. */
  onRowWrite?: () => void | Promise<void>;
};
const clientOf = async (deps?: PlanChangeDeps): Promise<PlanChangeDeps> => deps ?? (await getStripeClient());

/** The Stripe price for a catalog plan on a term, by mode (the checkout route's rule). */
async function priceFor(d: PlanChangeDeps, plan: { slug: string; name: string; priceCents: number; yearlyPriceCents: number | null }, interval: Term): Promise<string | null> {
  if (d.mode === "live") {
    const price = await db.planPrice.findFirst({ where: { planSlug: plan.slug, interval, active: true } });
    return price?.stripePriceId ?? null;
  }
  const cents = interval === "YEAR" ? (plan.yearlyPriceCents ?? 0) : plan.priceCents;
  return ensureRecurringPrice({ stripe: d.stripe, mode: d.mode, kind: plan.slug, name: `JobFlex ${plan.name}`, interval, cents });
}

type Already = { already: true; stripe: Stripe; sub: Stripe.Subscription; plan: { slug: string; name: string }; interval: Term; termCents: number };

type Resolved = {
  stripe: Stripe;
  mode: StripeMode;
  sub: Stripe.Subscription;
  priceId: string;
  plan: { slug: string; name: string; priceCents: number; yearlyPriceCents: number | null };
  interval: Term;
  fromInterval: Term;
  route: Exclude<ChangeRoute, "checkout">;
  anchorNow: boolean;
  termCents: number;
};

/** Where a change goes, or why it can't. "checkout" when Stripe's page has to take it. */
async function resolve(
  organizationId: string,
  planSlug: string,
  wanted: Term,
  deps?: PlanChangeDeps,
): Promise<Resolved | Already | { ok: true; route: "checkout"; plan: { slug: string; name: string }; interval: Term } | PlanChangeRefusal> {
  const plan = await getPlanBySlug(planSlug);
  if (!plan || !plan.active) return { ok: false, error: "That plan is not available." };
  if (plan.isFree) return { ok: false, error: "That plan can't be switched to here." };
  // A plan with no yearly price is bought monthly (lib/planDeal planTerm) — never refused.
  const interval: Term = wanted === "YEAR" && plan.yearlyPriceCents ? "YEAR" : "MONTH";
  const row = await db.subscription.findUnique({ where: { organizationId } });
  if (!row?.externalSubId) return { ok: true, route: "checkout", plan, interval };
  const { stripe, mode } = await clientOf(deps);
  let sub: Stripe.Subscription;
  try {
    sub = await stripe.subscriptions.retrieve(row.externalSubId);
  } catch {
    return { ok: true, route: "checkout", plan, interval };
  }
  if (sub.status === "canceled" || sub.status === "incomplete_expired" || !sub.items.data.length) {
    return { ok: true, route: "checkout", plan, interval };
  }
  if (sub.status !== "active" && sub.status !== "trialing") return { ok: false, error: PAST_DUE, code: "past_due" };

  const fromInterval = termOf(sub);
  const current = (row.plan ?? "").toLowerCase();

  const termCents = interval === "YEAR" ? (plan.yearlyPriceCents ?? 0) : plan.priceCents;
  const priceId = await priceFor({ stripe, mode }, plan, interval);
  if (!priceId) return { ok: false, error: "That plan isn't available for checkout yet." };
  /* ALREADY THERE (2026-10-12). Stripe holds the target price — an earlier
     press went through and only our row lags (its write failed, or the
     webhook has not landed). Nothing is charged again; the row is aligned. */
  if (sub.items.data.length === 1 && sub.items.data[0].price.id === priceId) {
    return { already: true, stripe, sub, plan, interval, termCents };
  }
  if (current === plan.slug && fromInterval === interval) return { ok: false, error: "That is already your plan.", code: "same_plan" };

  const catalog = await getPlanCatalog();
  const rank = (slug: string) => (slug === CUSTOM_PLAN_SLUG ? -1 : catalog.findIndex((p) => p.slug === slug));
  const route = changeRoute({
    trialing: sub.status === "trialing",
    from: fromInterval,
    to: interval,
    rankFrom: rank(current),
    rankTo: rank(plan.slug),
    currentCents: totalOf(sub),
    targetCents: termCents,
    lines: sub.items.data.length,
  });
  if (route === "checkout") return { ok: true, route: "checkout", plan, interval };
  return { stripe, mode, sub, priceId, plan, interval, fromInterval, termCents, route, anchorNow: route === "charge" && fromInterval !== interval };
}

/* A FIRST-MONTH CODE ON A TERM CHANGE (2026-10-12, lib/firstMonthDiscount).
   A partner's or a referral's percent coupon runs "repeating" for a month or
   two. Moved from a monthly to a yearly price while it still runs, Stripe
   would take the percent off the whole year — 20% of $855 instead of 20% of
   $95. So on a MONTH → YEAR change such a coupon is:
     · in a trial (nothing paid yet): swapped for the one-month amount on the
       yearly plan (lib/yearDiscount) — the discount promised, no more;
     · on an active subscription (the first month is paid, discount used):
       taken off before the yearly invoice.
   Any other discount (a fixed amount, a coupon "forever") stays. */
type HeldDiscount = { id: string; coupon: Stripe.Coupon | null };
async function heldDiscounts(stripe: Stripe, sub: Stripe.Subscription): Promise<HeldDiscount[]> {
  const full = await stripe.subscriptions.retrieve(sub.id, { expand: ["discounts"] });
  const out: HeldDiscount[] = [];
  for (const d of full.discounts ?? []) {
    if (!d || typeof d === "string") continue;
    const raw = (d as unknown as { coupon?: string | Stripe.Coupon | null; source?: { coupon?: string | Stripe.Coupon | null } }).source?.coupon ??
      (d as unknown as { coupon?: string | Stripe.Coupon | null }).coupon ??
      null;
    const coupon = typeof raw === "string" ? await stripe.coupons.retrieve(raw).catch(() => null) : raw;
    out.push({ id: d.id, coupon });
  }
  return out;
}
const isFirstMonth = (c: Stripe.Coupon | null) =>
  Boolean(c && (c.percent_off ?? 0) > 0 && c.duration === "repeating" && (c.duration_in_months ?? 0) <= 2);

/** The discounts a MONTH → YEAR change keeps, and (in a trial) the one-month coupon that replaces a percent one. */
async function discountsForYear(r: Resolved): Promise<{ changed: boolean; discounts: Stripe.SubscriptionUpdateParams.Discount[] }> {
  if (!(r.fromInterval === "MONTH" && r.interval === "YEAR")) return { changed: false, discounts: [] };
  const held = await heldDiscounts(r.stripe, r.sub);
  const first = held.filter((h) => isFirstMonth(h.coupon));
  if (!first.length) return { changed: false, discounts: [] };
  const kept: Stripe.SubscriptionUpdateParams.Discount[] = held.filter((h) => !isFirstMonth(h.coupon)).map((h) => ({ discount: h.id }));
  if (r.route === "trial") {
    const c = first[0].coupon!;
    const promo = c.metadata?.jfPromoCodeId
      ? await db.promoCode.findUnique({ where: { id: c.metadata.jfPromoCodeId } })
      : await db.promoCode.findFirst({ where: { stripeCouponId: c.id } });
    const coupon = await ensureYearFirstMonthCoupon(r.stripe, r.mode, {
      kind: c.metadata?.jfKind === "referral" || !promo ? "referral" : "promo",
      pct: c.percent_off ?? 0,
      monthlyCents: r.plan.priceCents,
      months: c.duration_in_months ?? 1,
      ...(promo ? { promoCodeId: promo.id, code: promo.code } : {}),
    }).catch(() => null);
    if (coupon) kept.push({ coupon });
  }
  return { changed: true, discounts: kept };
}

function itemsFor(r: Resolved): Stripe.SubscriptionUpdateParams.Item[] {
  const [first, ...rest] = r.sub.items.data;
  return [{ id: first.id, price: r.priceId, quantity: 1 }, ...rest.map((i) => ({ id: i.id, deleted: true as const }))];
}

function metadataFor(r: Resolved, organizationId: string): Record<string, string> {
  return { ...(r.sub.metadata ?? {}), organizationId, planSlug: r.plan.slug, interval: r.interval, customPages: "" };
}

/** What the change would do, from Stripe's own preview. */
export async function previewPlanChange(organizationId: string, planSlug: string, wanted: Term, deps?: PlanChangeDeps): Promise<PlanChangePreview | PlanChangeRefusal> {
  const r = await resolve(organizationId, planSlug, wanted, deps);
  if ("already" in r) {
    return {
      ok: true, route: "free", planSlug: r.plan.slug, planName: r.plan.name, interval: r.interval, fromInterval: r.interval,
      dueNowCents: 0, creditCents: 0, termCents: r.termCents, nextBillAt: iso(subscriptionPeriodEnd(r.sub)), switchAt: null, prorationDate: null,
    };
  }
  if ("ok" in r) {
    if (!r.ok) return r;
    return {
      ok: true, route: "checkout", planSlug: r.plan.slug, planName: r.plan.name, interval: r.interval, fromInterval: null,
      dueNowCents: null, creditCents: 0, termCents: 0, nextBillAt: null, switchAt: null, prorationDate: null,
    };
  }
  const out: PlanChangePreview = {
    ok: true, route: r.route, planSlug: r.plan.slug, planName: r.plan.name, interval: r.interval, fromInterval: r.fromInterval,
    dueNowCents: 0, creditCents: 0, termCents: r.termCents, nextBillAt: null, switchAt: null, prorationDate: null,
  };
  const periodEnd = subscriptionPeriodEnd(r.sub);
  if (r.route === "trial") out.nextBillAt = iso(r.sub.trial_end);
  else if (r.route === "schedule") out.switchAt = out.nextBillAt = iso(periodEnd);
  else if (r.route === "free") out.nextBillAt = iso(periodEnd);
  else {
    const prorationDate = Math.floor(Date.now() / 1000);
    const year = await discountsForYear(r);
    const pre = await r.stripe.invoices.createPreview({
      customer: customerOf(r.sub),
      subscription: r.sub.id,
      ...(year.changed ? { discounts: year.discounts.length ? (year.discounts as Stripe.InvoiceCreatePreviewParams.Discount[]) : "" } : {}),
      subscription_details: {
        items: itemsFor(r),
        proration_behavior: "always_invoice",
        // Stripe takes no proration date with a cycle restarted "now": it
        // prorates to the second it applies the change (a term change).
        ...(r.anchorNow ? { billing_cycle_anchor: "now" as const } : { proration_date: prorationDate }),
      },
    });
    out.dueNowCents = Math.max(0, pre.amount_due ?? 0);
    out.creditCents = Math.max(0, -pre.lines.data.filter((l) => (l.amount ?? 0) < 0).reduce((n, l) => n + l.amount, 0));
    out.prorationDate = r.anchorNow ? null : prorationDate;
    // The new period's end as Stripe drew it (a test clock's "now" is not ours).
    const newEnd = Math.max(0, ...pre.lines.data.map((l) => l.period?.end ?? 0));
    out.nextBillAt = iso(r.anchorNow ? newEnd || addTerm(prorationDate, r.interval) : periodEnd);
  }
  return out;
}

/** Make the change. `prorationDate` from the preview keeps today's amount the one shown. */
export async function applyPlanChange(
  organizationId: string,
  planSlug: string,
  wanted: Term,
  prorationDate?: number | null,
  deps?: PlanChangeDeps,
): Promise<PlanChangeDone> {
  /* ONE CHANGE AT A TIME per company: a double click must not run two
     charges side by side. The lock is a row that lives two minutes at most. */
  if (!(await takeLock(organizationId))) return { ok: false, error: "A plan change is already under way. Wait a moment and look again." };
  try {
    return await applyLocked(organizationId, planSlug, wanted, prorationDate ?? null, deps);
  } finally {
    await db.syncState.deleteMany({ where: { key: lockKey(organizationId) } }).catch(() => {});
  }
}

const lockKey = (orgId: string) => `planChangeLock:${orgId}`;
async function takeLock(orgId: string): Promise<boolean> {
  try {
    await db.syncState.create({ data: { key: lockKey(orgId), cursor: String(Date.now()) } });
    return true;
  } catch {
    const row = await db.syncState.findUnique({ where: { key: lockKey(orgId) } }).catch(() => null);
    if (row && Date.now() - Number(row.cursor) > 120_000) {
      const taken = await db.syncState.updateMany({ where: { key: lockKey(orgId), cursor: row.cursor }, data: { cursor: String(Date.now()) } });
      return taken.count === 1;
    }
    return false;
  }
}

async function applyLocked(
  organizationId: string,
  planSlug: string,
  wanted: Term,
  prorationDate: number | null,
  deps?: PlanChangeDeps,
): Promise<PlanChangeDone> {
  const r = await resolve(organizationId, planSlug, wanted, deps);
  if ("already" in r) {
    // An earlier press went through at Stripe: no second charge, the row is aligned.
    await alignRow(r.stripe, r.sub.id, organizationId, "already at the target price");
    return { ok: true, mode: "switched", route: "free", planName: r.plan.name, interval: r.interval, chargedCents: 0 };
  }
  if ("ok" in r) return r.ok ? { ok: true, mode: "checkout" } : r;
  const { stripe, sub } = r;

  if (r.route === "schedule") return bookSwitch(organizationId, r);

  /* A BOOKED YEAR → MONTH SWITCH AND ANOTHER CHANGE (2026-10-12). A
     subscription held by a schedule takes no direct change of its price, so
     the schedule is released first — but the booking is put back, as it was,
     if the new change does not go through: the shop keeps "Switches to
     monthly on <date>". Only a change that succeeds ends the booking. */
  const booked = await readSwitchRecord(organizationId);
  const held = await releaseAttachedSchedule(stripe, sub.id);
  const restore = async (why: string) => {
    if (!booked && !held) return;
    try {
      await restoreBooking(organizationId, r, booked);
    } catch (err) {
      console.error(`[planChange] ${sub.id} (org ${organizationId}): the booked switch could not be put back after ${why}:`, err);
    }
  };

  let done: PlanChangeDone;
  try {
    done = await changeNow(organizationId, r, prorationDate, deps);
  } catch (err) {
    console.warn(`[planChange] ${sub.id} (org ${organizationId}): change failed:`, err);
    await restore("an error");
    return { ok: false, error: "Couldn't switch the plan. Try again." };
  }
  if (!done.ok) {
    await restore(done.code ?? "a refusal");
    return done;
  }
  await db.syncState.deleteMany({ where: { key: switchKey(organizationId) } }).catch(() => {});
  return done;
}

/** The price is changed on the subscription now (charge, free, trial). */
async function changeNow(organizationId: string, r: Resolved, prorationDate: number | null, deps?: PlanChangeDeps): Promise<PlanChangeDone> {
  const { stripe, sub } = r;
  let updated: Stripe.Subscription;
  let chargedCents = 0;
  if (r.route === "charge") {
    const when = prorationDate && Math.abs(Date.now() / 1000 - prorationDate) < 3600 ? prorationDate : Math.floor(Date.now() / 1000);
    const startedAt = Math.floor(Date.now() / 1000) - 5;
    const year = await discountsForYear(r);
    // An empty list is not "none" to Stripe — the empty string clears them.
    if (year.changed) await stripe.subscriptions.update(sub.id, { discounts: year.discounts.length ? year.discounts : "" });
    try {
      updated = await stripe.subscriptions.update(sub.id, {
        items: itemsFor(r),
        proration_behavior: "always_invoice",
        payment_behavior: "pending_if_incomplete",
        ...(r.anchorNow ? { billing_cycle_anchor: "now" as const } : { proration_date: when }),
        expand: ["latest_invoice"],
      });
    } catch (err) {
      const code = (err as { code?: string; type?: string })?.type;
      console.warn("[planChange] charge failed:", err);
      return code === "StripeCardError" ? { ok: false, error: CARD_DECLINED, code: "card_declined" } : { ok: false, error: "Couldn't switch the plan. Try again." };
    }
    const inv = updated.latest_invoice && typeof updated.latest_invoice !== "string" ? updated.latest_invoice : null;
    if (updated.pending_update) {
      // Not paid: nothing applied. The invoice for the attempt is voided so no
      // open invoice is left behind and nothing is retried on the card.
      if (inv?.id && inv.status === "open") await stripe.invoices.voidInvoice(inv.id).catch((err) => console.warn("[planChange] void failed:", err));
      return { ok: false, error: CARD_DECLINED, code: "card_declined" };
    }
    if (inv && (inv.created ?? 0) >= startedAt) chargedCents = inv.amount_paid ?? 0;
    /* FROM HERE THE CHANGE IS MADE AND PAID (2026-10-12). Nothing below may
       turn it into an error for the customer: a failed write is logged and
       our row is brought to Stripe's state (alignRow). */
    try {
      updated = await stripe.subscriptions.update(sub.id, { metadata: metadataFor(r, organizationId) });
    } catch (err) {
      console.error(`[planChange] ${sub.id} (org ${organizationId}): paid ${chargedCents}¢, but the metadata write failed:`, err);
    }
  } else {
    const year = await discountsForYear(r);
    try {
      updated = await stripe.subscriptions.update(sub.id, {
        items: itemsFor(r),
        ...(year.changed ? { discounts: year.discounts.length ? year.discounts : "" } : {}),
        proration_behavior: "none",
        ...(r.route === "trial" ? { trial_end: sub.trial_end ?? undefined } : {}),
        metadata: metadataFor(r, organizationId),
      });
    } catch (err) {
      console.warn("[planChange] switch failed:", err);
      return { ok: false, error: "Couldn't switch the plan. Try again." };
    }
  }

  try {
    await deps?.onRowWrite?.();
    await db.subscription.update({
      where: { organizationId },
      data: {
        plan: r.plan.slug.toUpperCase(),
        status: updated.status === "trialing" ? SubscriptionStatus.TRIALING : SubscriptionStatus.ACTIVE,
        stripePriceId: r.priceId,
        trialEndsAt: updated.trial_end ? new Date(updated.trial_end * 1000) : null,
        currentPeriodEnd: subscriptionPeriodEndDate(updated),
      },
    });
  } catch (err) {
    console.error(`[planChange] ${sub.id} (org ${organizationId}): changed at Stripe (${chargedCents}¢ charged), but our row write failed:`, err);
    await alignRow(stripe, sub.id, organizationId, "the row write failed");
  }
  return { ok: true, mode: "switched", route: r.route as "charge" | "free" | "trial", planName: r.plan.name, interval: r.interval, chargedCents };
}

/**
 * Our row brought to Stripe's state by the webhook's own function
 * (stripeSync.syncSubscriptionFromStripe), with one more try. Logged either
 * way; the reconcile cron is the last backstop.
 */
async function alignRow(stripe: Stripe, subId: string, organizationId: string, why: string): Promise<boolean> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const fresh = await stripe.subscriptions.retrieve(subId);
      const res = await syncSubscriptionFromStripe(fresh, stripe);
      if (res.synced) return true;
      console.error(`[planChange] ${subId} (org ${organizationId}): align after ${why}, try ${attempt}: not synced (${res.reason})`);
    } catch (err) {
      console.error(`[planChange] ${subId} (org ${organizationId}): align after ${why}, try ${attempt} failed:`, err);
    }
  }
  return false;
}

/* ── THE BOOKED SWITCH (YEAR → MONTH) ──────────────────────────────────── */

/** Book (or re-book) the switch on the subscription's schedule. A schedule
 *  made here and left without its phases is released at once: nothing stays
 *  attached to the subscription if the booking fails. */
async function bookSwitch(organizationId: string, r: Resolved): Promise<PlanChangeDone> {
  const { stripe, sub } = r;
  const end = subscriptionPeriodEnd(sub);
  if (!end) return { ok: false, error: "Couldn't read the end of your paid year. Try again." };
  const booked = await writeSchedule(stripe, sub, end, r.priceId, metadataFor(r, organizationId));
  if (!booked.ok) return { ok: false, error: "Couldn't book the switch. Try again." };
  const record: ScheduledSwitch = { scheduleId: booked.scheduleId, subId: sub.id, planSlug: r.plan.slug, planName: r.plan.name, interval: r.interval, at: new Date(end * 1000).toISOString(), priceId: r.priceId };
  await db.syncState.upsert({ where: { key: switchKey(organizationId) }, update: { cursor: JSON.stringify(record) }, create: { key: switchKey(organizationId), cursor: JSON.stringify(record) } });
  return { ok: true, mode: "scheduled", planName: r.plan.name, interval: r.interval, switchAt: record.at };
}

async function writeSchedule(
  stripe: Stripe,
  sub: Stripe.Subscription,
  end: number,
  priceId: string,
  metadata: Record<string, string>,
): Promise<{ ok: true; scheduleId: string } | { ok: false }> {
  const fresh = await stripe.subscriptions.retrieve(sub.id);
  const existing = typeof fresh.schedule === "string" ? fresh.schedule : fresh.schedule?.id;
  let schedule: Stripe.SubscriptionSchedule;
  let made = false;
  try {
    schedule = existing ? await stripe.subscriptionSchedules.retrieve(existing) : await stripe.subscriptionSchedules.create({ from_subscription: sub.id });
    made = !existing;
  } catch (err) {
    console.warn(`[planChange] ${sub.id}: no schedule could be made:`, err);
    return { ok: false };
  }
  try {
    const now = schedule.phases[0];
    await stripe.subscriptionSchedules.update(schedule.id, {
      end_behavior: "release",
      phases: [
        {
          items: fresh.items.data.map((i) => ({ price: i.price.id, quantity: i.quantity ?? 1 })),
          start_date: now?.start_date ?? end - 365 * DAY,
          end_date: end,
          proration_behavior: "none",
        },
        { items: [{ price: priceId, quantity: 1 }], proration_behavior: "none", metadata },
      ],
    });
    return { ok: true, scheduleId: schedule.id };
  } catch (err) {
    console.warn(`[planChange] ${sub.id}: the schedule's phases were refused${made ? " — the new schedule is released" : ""}:`, err);
    if (made) await stripe.subscriptionSchedules.release(schedule.id).catch((e) => console.error(`[planChange] ${sub.id}: could not release ${schedule.id}:`, e));
    return { ok: false };
  }
}

/** Put a booking back as it was (after another change did not go through). */
async function restoreBooking(organizationId: string, r: Resolved, booked: ScheduledSwitch | null): Promise<void> {
  if (!booked) return;
  const { stripe } = r;
  const plan = await getPlanBySlug(booked.planSlug, { includeInactive: true });
  const priceId = booked.priceId ?? (plan ? await priceFor({ stripe, mode: r.mode }, plan, booked.interval) : null);
  if (!priceId) throw new Error(`no price for ${booked.planSlug}/${booked.interval}`);
  const end = Math.floor(Date.parse(booked.at) / 1000);
  const metadata = { ...(r.sub.metadata ?? {}), organizationId, planSlug: booked.planSlug, interval: booked.interval, customPages: "" };
  const done = await writeSchedule(stripe, r.sub, end, priceId, metadata);
  if (!done.ok) throw new Error("the schedule could not be written again");
  const record: ScheduledSwitch = { ...booked, scheduleId: done.scheduleId, priceId };
  await db.syncState.upsert({ where: { key: switchKey(organizationId) }, update: { cursor: JSON.stringify(record) }, create: { key: switchKey(organizationId), cursor: JSON.stringify(record) } });
}

/** Book again a switch that the move to Free let go of (lib/freePlan): the
 *  owner pressed "Keep", so the plan goes on exactly as it was — the same
 *  price from the same day — while that day is still ahead. False when it
 *  cannot be put back; the plan then simply goes on as it is. */
export async function rebookScheduledSwitch(organizationId: string, held: ScheduledSwitch, deps?: PlanChangeDeps): Promise<boolean> {
  const end = Math.floor(Date.parse(held.at) / 1000);
  if (!Number.isFinite(end) || end * 1000 <= Date.now()) return false;
  const d = await clientOf(deps);
  const sub = await d.stripe.subscriptions.retrieve(held.subId);
  if (sub.status === "canceled" || sub.status === "incomplete_expired" || sub.cancel_at_period_end) return false;
  const plan = held.priceId ? null : await getPlanBySlug(held.planSlug, { includeInactive: true });
  const priceId = held.priceId ?? (plan ? await priceFor(d, plan, held.interval) : null);
  if (!priceId) return false;
  const metadata = { ...(sub.metadata ?? {}), organizationId, planSlug: held.planSlug, interval: held.interval, customPages: "" };
  const done = await writeSchedule(d.stripe, sub, end, priceId, metadata);
  if (!done.ok) return false;
  const record: ScheduledSwitch = { ...held, scheduleId: done.scheduleId, priceId };
  await db.syncState.upsert({ where: { key: switchKey(organizationId) }, update: { cursor: JSON.stringify(record) }, create: { key: switchKey(organizationId), cursor: JSON.stringify(record) } });
  return true;
}

async function readSwitchRecord(organizationId: string): Promise<ScheduledSwitch | null> {
  const row = await db.syncState.findUnique({ where: { key: switchKey(organizationId) } }).catch(() => null);
  if (!row) return null;
  try {
    return JSON.parse(row.cursor) as ScheduledSwitch;
  } catch {
    return null;
  }
}


/** The booked switch, while it is still ahead. */
export async function readScheduledSwitch(organizationId: string): Promise<ScheduledSwitch | null> {
  const row = await db.syncState.findUnique({ where: { key: switchKey(organizationId) } }).catch(() => null);
  if (!row) return null;
  try {
    const s = JSON.parse(row.cursor) as ScheduledSwitch;
    if (Date.parse(s.at) <= Date.now()) {
      await db.syncState.deleteMany({ where: { key: switchKey(organizationId) } }).catch(() => {});
      return null;
    }
    const sub = await db.subscription.findUnique({ where: { organizationId }, select: { externalSubId: true } });
    return sub?.externalSubId === s.subId ? s : null;
  } catch {
    return null;
  }
}

/** Cancel a booked switch: the schedule is released, the subscription goes on as it is.
 *  Releases the record's schedule and any other Stripe holds on the subscription. */
export async function releaseScheduledSwitch(organizationId: string, stripe?: Stripe): Promise<boolean> {
  const client = stripe ?? (await getStripeClient()).stripe;
  const s = await readSwitchRecord(organizationId);
  let released = false;
  if (s) {
    const schedule = await client.subscriptionSchedules.retrieve(s.scheduleId).catch(() => null);
    if (schedule && (schedule.status === "active" || schedule.status === "not_started")) {
      await client.subscriptionSchedules.release(s.scheduleId);
    }
    released = true;
  }
  const row = await db.subscription.findUnique({ where: { organizationId }, select: { externalSubId: true } }).catch(() => null);
  if (row?.externalSubId && (await releaseAttachedSchedule(client, row.externalSubId).catch(() => null))) released = true;
  await db.syncState.deleteMany({ where: { key: switchKey(organizationId) } }).catch(() => {});
  return released;
}

/** What the plan pages need: the term the shop pays on now, and a booked switch. */
export async function planTermState(organizationId: string): Promise<{
  currentInterval: Term | null;
  scheduledSwitch: { at: string; planName: string; interval: Term } | null;
}> {
  const row = await db.subscription
    .findUnique({ where: { organizationId }, select: { stripePriceId: true } })
    .catch(() => null);
  const [currentInterval, booked] = await Promise.all([
    row?.stripePriceId ? priceInterval(row.stripePriceId) : Promise.resolve(null),
    readScheduledSwitch(organizationId),
  ]);
  return { currentInterval, scheduledSwitch: booked ? { at: booked.at, planName: booked.planName, interval: booked.interval } : null };
}
