// THE ADMIN'S SUBSCRIPTION EDITOR — the logic behind actions/adminSubscription
// (one action, two modes; owner, 2026-09-22). Here, not in the action file, so
// the QA harness can drive it through the real code with an explicit actor.
//
//   A. "Change billed plan"   — the customer really pays a different amount.
//      The EXISTING Stripe subscription is updated (its price swapped, the
//      proration rule chosen, the trial kept or ended now); no subscription is
//      created. The mirror is written from Stripe's reply and marked
//      `syncing` until Stripe reports it back (lib/planGrant).
//   B. "Grant plan (no charge)" — a comp. Any live Stripe subscription is
//      cancelled FIRST (a trial at once, so nothing bills at its end; a paid
//      one at the period end by default, now by choice), then the row becomes
//      a MANUAL grant with a term, a reason and an author (lib/planGrant).
//
// STRIPE FIRST, THEN THE MIRROR. A Stripe refusal returns an error and
// changes nothing in the database. Both modes refuse while the previous
// change is still syncing, and both check the invariant — one live
// subscription per organization — on the Stripe side before touching it.
//
// The old sheet (updateAdminSubscription, removed) wrote the row's status by
// hand and let go of the Stripe subscription without cancelling it, which is
// how a "trial → active" edit left the trial billing beside a comp.

import { isDeckAddonLine, planLine } from "@/lib/deckAddon";
import type Stripe from "stripe";
import { releaseAttachedSchedule } from "@/lib/scheduleRelease";
import { z } from "zod";
import { db } from "@/lib/db";
import { getStripeClient, isStripeEnabled } from "@/lib/sdk/stripe";
import { ensureRecurringPrice } from "@/lib/stripePriceCache";
import { SubscriptionStatus } from "@/lib/prismaEnums";
import { mirrorStatusFor } from "@/lib/stripeStatus";
import { getPlanBySlug } from "@/lib/planCatalogServer";
import { planDisplayName, type PlanDTO } from "@/lib/planCatalog";
import { planSnapshot, reportPlanChange } from "@/lib/activation-events";
import { recordMirrorReference } from "@/lib/subscriptionRecord";
import { lineIsProration, subscriptionPeriodEnd, subscriptionPeriodEndDate } from "@/lib/stripeCompat";
import {
  clearPlanGrant,
  clearSyncingMark,
  confirmSyncingFromStripe,
  endPlanGrant,
  fallbackLabel,
  liveStripeSubscriptionsFor,
  mirrorInvariantViolations,
  readPlanGrant,
  readSyncingMark,
  recordPlanActivity,
  writePlanGrant,
  writeSyncingMark,
  type GrantFallback,
  type PlanGrant,
  type SyncingMark,
} from "@/lib/planGrant";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Who is making the change — the platform admin behind the action. */
export interface EditorActor {
  id: string;
  email: string;
}

const changeInput = z.object({
  organizationId: z.string().min(1),
  mode: z.enum(["billed", "grant"]),
  /** Catalog slug, any casing. */
  planSlug: z.string().min(1),
  reason: z.string().trim().max(500).default(""),
  /** A. Billing interval of the new price; defaults to the subscription's own. */
  interval: z.enum(["MONTH", "YEAR"]).optional(),
  /** A. The owner's default is create_prorations. */
  proration: z.enum(["create_prorations", "always_invoice", "none"]).default("create_prorations"),
  /** A. End a running trial today (first charge now) instead of at its end. */
  endTrialNow: z.boolean().default(false),
  /** B. When the comp ends (ISO string). Null only with openEnded: true. */
  endsAt: z.string().nullable().optional(),
  openEnded: z.boolean().default(false),
  fallback: z.enum(["free", "expired"]).default("free"),
  /** B. Cancel a PAID subscription now instead of at the period end. */
  cancelNow: z.boolean().default(false),
  /** Stripe subscription ids the admin list knows for this org (the row may name none). */
  knownSubIds: z.array(z.string()).default([]),
});

export type AdminSubscriptionChangeInput = z.input<typeof changeInput>;

/** One side of the "now → becomes" panel. */
export interface SubscriptionFacts {
  plan: string;
  planName: string;
  /** ACTIVE / TRIALING / PAST_DUE / CANCELED / COMPLIMENTARY / NONE … */
  status: string;
  payer: "customer" | "nobody";
  /** The recurring price, per interval; null when nobody pays. */
  priceCents: number | null;
  interval: "MONTH" | "YEAR" | null;
  nextChargeAt: string | null;
  nextChargeCents: number | null;
  /** When the arrangement ends: a comp's end, or a booked cancellation. */
  endsAt: string | null;
  note: string | null;
}

export interface AdminSubscriptionPreview {
  ok: true;
  now: SubscriptionFacts;
  becomes: SubscriptionFacts;
  /** The one sentence about what Stripe will be asked to do. */
  stripeAction: string;
  /** Money that leaves the card today, when the change bills at once. */
  chargeNowCents: number | null;
  warnings: string[];
  /** The figures are worked out here, not previewed by Stripe. */
  estimated: boolean;
  /** Why Apply is refused, or null. */
  blocked: string | null;
  /** The Stripe subscription the change will touch, if any. */
  stripeSubId: string | null;
}

export type AdminSubscriptionPreviewResult = AdminSubscriptionPreview | { ok: false; error: string };

export type AdminSubscriptionApplyResult =
  | { ok: true; summary: string; syncing: boolean }
  | { ok: false; error: string };

/* ── reading the situation ────────────────────────────────────────────── */

type Mirror = NonNullable<Awaited<ReturnType<typeof db.subscription.findUnique>>>;

interface Situation {
  org: { id: string; name: string };
  mirror: Mirror | null;
  grant: PlanGrant | null;
  mark: SyncingMark | null;
  stripe: Stripe | null;
  mode: "live" | "test";
  liveSubs: Stripe.Subscription[];
  /** The subscription of record: the mirror's, else the single live one. */
  sub: Stripe.Subscription | null;
  slugByPrice: Map<string, string>;
  catalog: PlanDTO[];
}

function intervalOf(sub: Stripe.Subscription | null): "MONTH" | "YEAR" | null {
  const r = planLine(sub?.items.data ?? [])?.price?.recurring?.interval;
  return r === "year" ? "YEAR" : r === "month" ? "MONTH" : null;
}

/** The lines a change of plan takes off with it: the plan's other lines (a custom plan's page quantity), and the
 *  Deck Studio add-on (lib/deckAddon) only when the term changes — its price is the old term's. */
function droppedLines(sub: Stripe.Subscription, planItem: Stripe.SubscriptionItem, interval: string): Stripe.SubscriptionItem[] {
  const sameTerm = intervalOf(sub) === interval;
  return sub.items.data.filter((i) => i.id !== planItem.id && !(sameTerm && isDeckAddonLine(i)));
}

function priceCentsOf(sub: Stripe.Subscription | null): number | null {
  // Every line: a custom plan bills its base and its page quantity together.
  const items = sub?.items.data.filter((i) => i.price) ?? [];
  if (!items.length) return null;
  return items.reduce((sum, i) => sum + (i.price.unit_amount ?? 0) * (i.quantity ?? 1), 0);
}

function planSlugOf(sub: Stripe.Subscription, s: Situation): string | null {
  const own = planLine(sub.items.data);
  const priceId = own?.price?.id;
  const fromLedger = priceId ? s.slugByPrice.get(priceId) : undefined;
  if (fromLedger) return fromLedger;
  const cands = [sub.metadata?.planSlug, sub.metadata?.planTier, sub.metadata?.planName, own?.price?.metadata?.planSlug, own?.price?.nickname];
  for (const c of cands) {
    const slug = c?.trim().toLowerCase();
    if (slug && s.catalog.some((p) => p.slug === slug)) return slug;
  }
  return null;
}

async function loadSituation(organizationId: string, knownSubIds: string[]): Promise<Situation | { error: string }> {
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { id: true, name: true } });
  if (!org) return { error: "Organization not found." };
  const [mirror, grant, mark, ledger, catalogRows] = await Promise.all([
    db.subscription.findUnique({ where: { organizationId } }),
    readPlanGrant(organizationId),
    readSyncingMark(organizationId),
    db.planPrice.findMany({ select: { stripePriceId: true, planSlug: true } }),
    db.pricingPlan.findMany({ orderBy: { order: "asc" } }),
  ]);
  const catalog: PlanDTO[] = [];
  for (const p of catalogRows) {
    const dto = await getPlanBySlug(p.slug, { includeInactive: true });
    if (dto) catalog.push(dto);
  }
  const slugByPrice = new Map(ledger.map((p) => [p.stripePriceId, p.planSlug.toLowerCase()]));

  let stripe: Stripe | null = null;
  let mode: "live" | "test" = "live";
  let liveSubs: Stripe.Subscription[] = [];
  if (isStripeEnabled()) {
    try {
      ({ stripe, mode } = await getStripeClient());
      liveSubs = await liveStripeSubscriptionsFor(stripe, mirror, knownSubIds);
    } catch (err) {
      return { error: `Stripe could not be read: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
  const sub = liveSubs.find((s) => s.id === mirror?.externalSubId) ?? (liveSubs.length === 1 ? liveSubs[0] : null);
  return { org, mirror, grant, mark, stripe, mode, liveSubs, sub, slugByPrice, catalog };
}

const iso = (sec: number | null | undefined) => (sec ? new Date(sec * 1000).toISOString() : null);

/** The facts as they stand. */
function nowFacts(s: Situation): SubscriptionFacts {
  const { sub, mirror, grant } = s;
  if (sub) {
    const slug = planSlugOf(sub, s) ?? (mirror?.plan ?? "").toLowerCase();
    const plan = s.catalog.find((p) => p.slug === slug);
    const status = mirrorStatusFor(sub);
    const cancelBooked = sub.cancel_at_period_end;
    const nextAt = cancelBooked ? null : sub.status === "trialing" ? sub.trial_end : subscriptionPeriodEnd(sub);
    return {
      plan: slug || "—",
      planName: plan?.name ?? planDisplayName(slug || null, s.catalog),
      status,
      payer: "customer",
      priceCents: priceCentsOf(sub),
      interval: intervalOf(sub),
      nextChargeAt: iso(nextAt),
      nextChargeCents: cancelBooked ? null : priceCentsOf(sub),
      endsAt: cancelBooked ? iso(subscriptionPeriodEnd(sub)) : null,
      note: cancelBooked
        ? "Cancellation booked — no further charges."
        : sub.status === "trialing"
          ? "On trial — the first charge is at its end."
          : sub.status === "past_due" || sub.status === "unpaid"
            ? "The last payment failed; Stripe is retrying."
            : null,
    };
  }
  if (mirror && mirror.provider === "MANUAL" && mirror.status === SubscriptionStatus.ACTIVE) {
    const slug = mirror.plan.toLowerCase();
    const plan = s.catalog.find((p) => p.slug === slug);
    const endsAt = grant?.endsAt ?? mirror.currentPeriodEnd?.toISOString() ?? null;
    return {
      plan: slug,
      planName: plan?.name ?? planDisplayName(slug, s.catalog),
      status: "COMPLIMENTARY",
      payer: "nobody",
      priceCents: null,
      interval: null,
      nextChargeAt: null,
      nextChargeCents: null,
      endsAt,
      note: grant
        ? `Complimentary (${grant.actorEmail}: ${grant.reason}) · after: ${fallbackLabel(grant.fallback)}`
        : "Hand grant without a term (written before the editor existed).",
    };
  }
  const slug = (mirror?.plan ?? "").toLowerCase();
  const plan = slug ? s.catalog.find((p) => p.slug === slug) : undefined;
  return {
    plan: slug || "—",
    planName: plan?.name ?? (slug ? planDisplayName(slug, s.catalog) : "No plan"),
    status: mirror?.status ?? "NONE",
    payer: "nobody",
    priceCents: null,
    interval: null,
    nextChargeAt: null,
    nextChargeCents: null,
    endsAt: mirror?.currentPeriodEnd?.toISOString() ?? null,
    note: mirror ? "No live Stripe subscription." : "No subscription row.",
  };
}

/** The Stripe price of record for a plan + interval, by mode (the checkout's rule). */
async function targetPriceId(s: Situation, plan: PlanDTO, interval: "MONTH" | "YEAR", create: boolean): Promise<string | null> {
  if (s.mode === "live" || !create) {
    const row = await db.planPrice.findFirst({ where: { planSlug: plan.slug, interval, active: true } });
    return row?.stripePriceId ?? null;
  }
  const cents = interval === "YEAR" ? (plan.yearlyPriceCents ?? 0) : plan.priceCents;
  return ensureRecurringPrice({ stripe: s.stripe!, mode: s.mode, kind: plan.slug, name: `JobFlex ${plan.name}`, interval, cents });
}

interface Plan {
  s: Situation;
  data: z.output<typeof changeInput>;
  plan: PlanDTO;
  now: SubscriptionFacts;
  becomes: SubscriptionFacts;
  stripeAction: string;
  chargeNowCents: number | null;
  warnings: string[];
  estimated: boolean;
  blocked: string | null;
  /** A. */
  priceId: string | null;
  interval: "MONTH" | "YEAR";
  /** B. */
  endsAt: Date | null;
}

async function planChange(raw: unknown, forApply: boolean): Promise<Plan | { error: string }> {
  const parsed = changeInput.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const data = parsed.data;
  const s = await loadSituation(data.organizationId, data.knownSubIds);
  if ("error" in s) return s;

  const plan = s.catalog.find((p) => p.slug === data.planSlug.trim().toLowerCase());
  if (!plan) return { error: "Unknown pricing plan." };

  const now = nowFacts(s);
  const warnings: string[] = [];
  let blocked: string | null = null;
  const block = (why: string) => {
    if (!blocked) blocked = why;
  };

  if (s.mark) {
    block(`The previous change is still syncing (since ${new Date(s.mark.since).toLocaleString("en-US")}: ${s.mark.note}). Verify it with Stripe first.`);
  }
  if (s.liveSubs.length > 1) {
    block(`Stripe holds ${s.liveSubs.length} live subscriptions for this organization (${s.liveSubs.map((x) => x.id).join(", ")}). One organization, one subscription — settle that in Stripe first.`);
  }
  if (forApply && data.reason.length < 3) block("Give a reason (it goes on the organization's activity).");

  const nowMs = Date.now();
  let becomes: SubscriptionFacts;
  let stripeAction = "";
  let chargeNowCents: number | null = null;
  let estimated = false;
  let priceId: string | null = null;
  let interval: "MONTH" | "YEAR" = data.interval ?? intervalOf(s.sub) ?? "MONTH";
  let endsAt: Date | null = null;

  if (data.mode === "billed") {
    const sub = s.sub;
    if (!s.stripe) block("Stripe is not configured on this deployment — a billed plan needs it.");
    if (!sub) block("There is no live Stripe subscription to bill. The customer checks out for a paid plan; use Grant for a comp.");
    if (plan.isFree) block("A free plan is not billed — use Grant, or end the subscription.");
    if (interval === "YEAR" && !plan.yearlyPriceCents) {
      interval = "MONTH";
      warnings.push(`${plan.name} has no yearly price; monthly is used.`);
    }
    if (s.stripe && sub) priceId = await targetPriceId(s, plan, interval, forApply);
    if (s.stripe && sub && !priceId) {
      block(s.mode === "live" ? `No Stripe price for ${plan.name} (${interval.toLowerCase()}) — sync the plan in Admin → Plans first.` : `The sandbox price for ${plan.name} is created on apply.`);
    }
    const curPriceId = planLine(sub?.items.data ?? [])?.price?.id ?? null;
    const trialing = sub?.status === "trialing";
    const endsTrial = trialing && data.endTrialNow;
    if (sub && priceId && curPriceId === priceId && !endsTrial) block(`Already on ${plan.name} (${interval.toLowerCase()}) — nothing to change.`);
    if (sub?.cancel_at_period_end) warnings.push(`A cancellation is booked for ${new Date((subscriptionPeriodEnd(sub) ?? 0) * 1000).toLocaleDateString("en-US")} and stays booked; resume it from the customer's page if the plan should continue.`);

    const targetCents = interval === "YEAR" ? (plan.yearlyPriceCents ?? plan.priceCents * 12) : plan.priceCents;
    let nextChargeAt: string | null = null;
    let nextChargeCents: number | null = targetCents;
    if (sub && s.stripe && priceId && !blocked) {
      try {
        const item = planLine(sub.items.data)!;
        const pre = await s.stripe.invoices.createPreview({
          customer: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
          subscription: sub.id,
          subscription_details: {
            // Any other line (a custom plan's page quantity) goes with the change.
            items: [{ id: item.id, price: priceId }, ...droppedLines(sub, item, interval).map((i) => ({ id: i.id, deleted: true as const }))],
            proration_behavior: data.proration,
            ...(endsTrial ? { trial_end: "now" as const } : {}),
          },
        });
        const due = pre.next_payment_attempt ?? pre.period_end ?? null;
        nextChargeAt = iso(due);
        nextChargeCents = pre.amount_due ?? targetCents;
        if (due && due * 1000 <= nowMs + 60 * 60 * 1000) {
          // The preview IS the invoice about to be charged (a trial ended now).
          chargeNowCents = pre.amount_due ?? null;
        } else if (data.proration === "always_invoice") {
          // Stripe invoices the proration lines at once and the plan itself at
          // the period end: the preview carries both, split here.
          const prorated = (pre.lines?.data ?? []).filter(lineIsProration).reduce((n, l) => n + (l.amount ?? 0), 0);
          if (prorated !== 0) {
            chargeNowCents = Math.max(0, prorated);
            nextChargeCents = Math.max(0, (pre.amount_due ?? targetCents) - prorated);
          }
        }
      } catch (err) {
        estimated = true;
        console.warn("[adminSubscription] preview failed:", err);
      }
    } else {
      estimated = true;
    }
    if (estimated && sub) {
      nextChargeAt = endsTrial ? new Date(nowMs).toISOString() : iso(trialing ? sub.trial_end : subscriptionPeriodEnd(sub));
      if (endsTrial || data.proration === "always_invoice") chargeNowCents = targetCents;
    }
    // An invoice today moves the next regular charge one period out only when
    // the period itself restarts (a trial ended now); a prorated difference
    // charged today leaves the period end where it is.
    const restarts = endsTrial;
    const nextAfterNow = restarts && sub ? new Date(nowMs + (interval === "YEAR" ? 365 : 30) * DAY_MS).toISOString() : nextChargeAt;
    becomes = {
      plan: plan.slug,
      planName: plan.name,
      status: sub ? (endsTrial ? SubscriptionStatus.ACTIVE : mirrorStatusFor(sub)) : "—",
      payer: "customer",
      priceCents: targetCents,
      interval,
      nextChargeAt: restarts ? nextAfterNow : nextChargeAt,
      nextChargeCents: restarts ? targetCents : nextChargeCents,
      endsAt: sub?.cancel_at_period_end ? iso(subscriptionPeriodEnd(sub)) : null,
      note: endsTrial
        ? "The trial ends today; the customer starts paying today."
        : trialing
          ? `The trial continues to ${sub?.trial_end ? new Date(sub.trial_end * 1000).toLocaleDateString("en-US") : "its end"} on the new plan; the first charge is then at the new price.`
          : data.proration === "create_prorations"
            ? "The difference for the rest of this period is added to the next invoice."
            : data.proration === "always_invoice"
              ? "The difference for the rest of this period is charged now."
              : "Nothing for this period; the new price starts on the next invoice.",
    };
    stripeAction = sub
      ? `Update ${sub.id}: price → ${plan.name} (${interval.toLowerCase()}), proration ${data.proration.replace("_", " ")}${endsTrial ? ", trial ends now" : ""}. No new subscription.`
      : "Nothing (no subscription).";
  } else {
    // ── B. grant ──
    const parsedEnd = data.endsAt ? new Date(data.endsAt) : null;
    if (data.openEnded) endsAt = null;
    else if (parsedEnd && !Number.isNaN(parsedEnd.getTime())) endsAt = parsedEnd;
    else block("Pick an end date for the complimentary plan, or choose “no end date” explicitly.");
    if (endsAt && endsAt.getTime() <= nowMs) block("The end date is in the past.");
    const sub = s.sub;
    const trialing = sub?.status === "trialing";
    if (sub) {
      if (!s.stripe) block("Stripe is not configured — the live subscription cannot be cancelled from here.");
      const cancelsNow = trialing || data.cancelNow;
      const periodEnd = new Date((subscriptionPeriodEnd(sub) ?? Math.floor(nowMs / 1000)) * 1000);
      stripeAction = cancelsNow
        ? `Cancel ${sub.id} now (${trialing ? "a trial — nothing bills at its end" : "no refund, no further charges"}).`
        : `Book ${sub.id} to cancel on ${periodEnd.toLocaleDateString("en-US")}; no further charges after that.`;
      if (!cancelsNow) warnings.push(`The customer keeps the paid ${now.planName} until ${periodEnd.toLocaleDateString("en-US")} on Stripe's side; in the product the complimentary ${plan.name} starts now.`);
      if (sub.status === "past_due" || sub.status === "unpaid") warnings.push("Stripe's retries for the failed payment stop with the cancellation; whatever is unpaid stays unpaid.");
    } else {
      stripeAction = s.grant || (s.mirror?.provider === "MANUAL" && s.mirror.status === SubscriptionStatus.ACTIVE)
        ? "Nothing on Stripe — this edits the standing grant."
        : "Nothing on Stripe — no live subscription.";
    }
    becomes = {
      plan: plan.slug,
      planName: plan.name,
      status: "COMPLIMENTARY",
      payer: "nobody",
      priceCents: null,
      interval: null,
      nextChargeAt: null,
      nextChargeCents: null,
      endsAt: endsAt ? endsAt.toISOString() : null,
      note: endsAt
        ? `Complimentary until ${endsAt.toLocaleDateString("en-US")}; then ${fallbackLabel(data.fallback)}. The owner is emailed 7 days before.`
        : `Complimentary with no end date; then ${fallbackLabel(data.fallback)} when ended by hand.`,
    };
    if (plan.isFree) warnings.push("Granting the free plan is the same as ending the subscription.");
  }

  return { s, data, plan, now, becomes, stripeAction, chargeNowCents, warnings, estimated, blocked, priceId, interval, endsAt };
}

/* ── the actions ──────────────────────────────────────────────────────── */

export async function previewSubscriptionChange(raw: unknown): Promise<AdminSubscriptionPreviewResult> {
  const p = await planChange(raw, false);
  if ("error" in p) return { ok: false, error: p.error };
  return {
    ok: true,
    now: p.now,
    becomes: p.becomes,
    stripeAction: p.stripeAction,
    chargeNowCents: p.chargeNowCents,
    warnings: p.warnings,
    estimated: p.estimated,
    blocked: p.blocked,
    stripeSubId: p.s.sub?.id ?? null,
  };
}

function stripeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return `Stripe refused: ${msg.slice(0, 200)}. Nothing was changed.`;
}

export async function applySubscriptionChange(raw: unknown, admin: EditorActor): Promise<AdminSubscriptionApplyResult> {
  const p = await planChange(raw, true);
  if ("error" in p) return { ok: false, error: p.error };
  if (p.blocked) return { ok: false, error: p.blocked };
  const { s, data, plan } = p;
  const organizationId = s.org.id;
  const planWas = await planSnapshot(organizationId);
  const stored = plan.slug.toUpperCase();

  if (data.mode === "billed") {
    const sub = s.sub!;
    const item = planLine(sub.items.data)!;
    const endsTrial = sub.status === "trialing" && data.endTrialNow;
    let updated: Stripe.Subscription;
    try {
      updated = await s.stripe!.subscriptions.update(sub.id, {
        // A custom plan's page line must not keep billing under a catalog plan.
        items: [{ id: item.id, price: p.priceId! }, ...droppedLines(sub, item, p.interval).map((i) => ({ id: i.id, deleted: true as const }))],
        proration_behavior: data.proration,
        ...(endsTrial ? { trial_end: "now" } : {}),
        metadata: { ...(sub.metadata ?? {}), organizationId, planSlug: plan.slug, interval: p.interval, customPages: "" },
      });
    } catch (err) {
      return { ok: false, error: stripeError(err) };
    }
    // ── Stripe agreed; now the mirror, from its reply ──
    const status = mirrorStatusFor(updated);
    const next = {
      plan: stored,
      status,
      provider: "STRIPE",
      externalCustomerId: typeof updated.customer === "string" ? updated.customer : updated.customer.id,
      externalSubId: updated.id,
      stripePriceId: planLine(updated.items.data)?.price?.id ?? p.priceId,
      trialEndsAt: updated.trial_end ? new Date(updated.trial_end * 1000) : null,
      currentPeriodEnd: subscriptionPeriodEndDate(updated),
      canceledAt: updated.cancel_at_period_end && updated.canceled_at ? new Date(updated.canceled_at * 1000) : null,
    };
    await db.subscription.upsert({ where: { organizationId }, update: next, create: { organizationId, ...next } });
    await clearPlanGrant(organizationId);
    await recordMirrorReference(organizationId, (updated.created ?? Math.floor(Date.now() / 1000)) * 1000);
    const note = `${p.now.planName} → ${plan.name} (${p.interval.toLowerCase()}) on ${updated.id}`;
    await writeSyncingMark(organizationId, {
      since: new Date().toISOString(),
      subId: updated.id,
      priceId: next.stripePriceId,
      status,
      by: admin.email,
      note,
    });
    await recordPlanActivity({
      organizationId,
      actorId: admin.id,
      summary: `Plan changed to ${plan.name} (billed, ${p.interval.toLowerCase()}) by JobFlex support`,
      meta: {
        mode: "billed",
        from: p.now,
        to: p.becomes,
        reason: data.reason,
        actorEmail: admin.email,
        stripe: { subId: updated.id, priceId: next.stripePriceId, proration: data.proration, endTrialNow: endsTrial, chargeNowCents: p.chargeNowCents },
      },
    });
    reportPlanChange(organizationId, "admin", planWas);
    return { ok: true, summary: `${note} — mirror written from Stripe's reply, syncing until Stripe confirms.`, syncing: true };
  }

  // ── B. grant ──
  const sub = s.sub;
  let replaced: PlanGrant["replaced"] = null;
  if (sub) {
    const cancelsNow = sub.status === "trialing" || data.cancelNow;
    try {
      // A booked plan switch (lib/planChange) or any other schedule is let go first.
      await releaseAttachedSchedule(s.stripe!, sub.id);
      if (cancelsNow) {
        await s.stripe!.subscriptions.cancel(sub.id, { prorate: false, invoice_now: false });
        replaced = { subId: sub.id, status: sub.status, action: "canceled_now", endsAt: null };
      } else {
        const booked = await s.stripe!.subscriptions.update(sub.id, { cancel_at_period_end: true });
        replaced = { subId: sub.id, status: sub.status, action: "cancel_at_period_end", endsAt: iso(subscriptionPeriodEnd(booked)) };
      }
    } catch (err) {
      return { ok: false, error: stripeError(err) };
    }
  } else if (s.grant?.replaced) {
    replaced = s.grant.replaced; // editing a standing grant keeps its history
  }
  const grant: PlanGrant = {
    plan: stored,
    grantedAt: s.grant?.grantedAt ?? new Date().toISOString(),
    endsAt: p.endsAt ? p.endsAt.toISOString() : null,
    fallback: data.fallback as GrantFallback,
    reason: data.reason,
    actorId: admin.id,
    actorEmail: admin.email,
    replaced,
    // A new end date gets its own notice.
    noticeSentAt: s.grant && s.grant.endsAt === (p.endsAt ? p.endsAt.toISOString() : null) ? s.grant.noticeSentAt : null,
  };
  const next = {
    plan: stored,
    status: SubscriptionStatus.ACTIVE,
    provider: "MANUAL",
    externalSubId: null,
    stripePriceId: null,
    currentPeriodEnd: p.endsAt,
    trialEndsAt: null,
    canceledAt: null,
    ...(sub ? { externalCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id } : {}),
  };
  await db.subscription.upsert({ where: { organizationId }, update: next, create: { organizationId, ...next } });
  await writePlanGrant(organizationId, grant);
  await clearSyncingMark(organizationId);
  // Nothing created before this moment may write the mirror (lib/stripeSync mirrorAccepts).
  await recordMirrorReference(organizationId, Date.now());
  const until = p.endsAt ? ` until ${p.endsAt.toLocaleDateString("en-US")}` : " (no end date)";
  await recordPlanActivity({
    organizationId,
    actorId: admin.id,
    summary: `Complimentary ${plan.name}${until} — granted by JobFlex support`,
    meta: { mode: "grant", from: p.now, to: p.becomes, reason: data.reason, actorEmail: admin.email, grant },
  });
  reportPlanChange(organizationId, "admin", planWas);
  const violations = mirrorInvariantViolations({ ...next, externalCustomerId: next.externalCustomerId ?? s.mirror?.externalCustomerId ?? null }, grant);
  if (violations.length) console.error("[adminSubscription] invariant after grant:", violations);
  return {
    ok: true,
    summary: `Complimentary ${plan.name}${until}${replaced ? ` · ${replaced.subId} ${replaced.action === "canceled_now" ? "cancelled" : "cancels at the period end"}` : ""}.`,
    syncing: false,
  };
}


/** Read the subscription back from Stripe and clear the mark when it agrees. */
export type VerifySyncResult =
  | { ok: true; confirmed: boolean; stripe: { status: string; priceId: string | null; periodEnd: string | null } | null; mark: SyncingMark | null }
  | { ok: false; error: string };

export async function verifySubscriptionSync(organizationId: string): Promise<VerifySyncResult> {
  const mark = await readSyncingMark(organizationId);
  if (!mark) return { ok: true, confirmed: true, stripe: null, mark: null };
  if (!isStripeEnabled()) return { ok: false, error: "Stripe is not configured." };
  try {
    const { stripe } = await getStripeClient();
    const sub = await stripe.subscriptions.retrieve(mark.subId);
    const confirmed = await confirmSyncingFromStripe(sub, organizationId);
    return {
      ok: true,
      confirmed,
      stripe: { status: sub.status, priceId: planLine(sub.items.data)?.price?.id ?? null, periodEnd: iso(subscriptionPeriodEnd(sub)) },
      mark: confirmed ? null : mark,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** End a standing grant now; the row goes to the fallback the operator picks. */
export async function endGrantNow(
  organizationId: string,
  fallback: GrantFallback,
  reason: string,
  admin: EditorActor,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const mirror = await db.subscription.findUnique({ where: { organizationId } });
  const grant = await readPlanGrant(organizationId);
  if (!mirror || mirror.provider !== "MANUAL" || mirror.status !== SubscriptionStatus.ACTIVE) {
    return { ok: false, error: "There is no standing grant on this organization." };
  }
  if (reason.trim().length < 3) return { ok: false, error: "Give a reason." };
  const g: PlanGrant = grant ?? {
    plan: mirror.plan,
    grantedAt: mirror.updatedAt.toISOString(),
    endsAt: mirror.currentPeriodEnd?.toISOString() ?? null,
    fallback,
    reason: "(grant written before the editor existed)",
    actorId: "",
    actorEmail: "",
    replaced: null,
    noticeSentAt: null,
  };
  await endPlanGrant(organizationId, { ...g, fallback, reason: `${g.reason} · ended: ${reason.trim()}` }, mirror.plan, "ended-by-admin", { id: admin.id, email: admin.email });
  return { ok: true };
}
