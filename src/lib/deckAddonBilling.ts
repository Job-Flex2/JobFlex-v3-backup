import "server-only";
// THE DECK STUDIO ADD-ON ON STRIPE (owner, 2026-10-19 — lib/deckAddon for the rules): one more line on the
// subscription the shop already has, $79 a month ($790 on a yearly plan; $49/$490 before 2026-10-26 — those lines keep
// their price, lib/deckAddon). The same ways as the custom plan's pages (lib/customBilling):
//
//   · ADD — proration_behavior "always_invoice": the rest of this period is invoiced and charged at once, under
//     payment_behavior "pending_if_incomplete", so a declined card adds NOTHING (the pending update's invoice is
//     voided). Never from the add-on button in a trial (owner, 2026-10-20): the trial holds the studio already, so the
//     add is refused with "Included in your trial" and no line is made — a line left from the trial would be billed
//     unnoticed.
//   · WITH A PLAN (owner, 2026-10-26): picked with the plan — "Add Deck Studio" ticked beside the plan cards, or
//     switched on on Stripe's own checkout page (optional_items) — the line goes on with the plan, in the trial too,
//     and is billed when the trial ends. That is the one way the add-on rides a trial: the person chose it, beside
//     the words "billed after it".
//   · REMOVE — Stripe's own proration (owner, 2026-10-20): proration_behavior "create_prorations", so the unused
//     rest of the period comes back as a credit on the next bill. The studio goes back to preview now.
//
// WHAT OPENS THE STUDIO is our record, SyncState `deckAddon:<orgId>` ({ subId, itemId }), written when the line is
// added and kept to Stripe by the webhook (mirrorDeckAddon): a line removed in Stripe, or a subscription replaced by
// a new Checkout, takes the record with it — and a record names its subscription, so a new one never inherits it.
//
// A LINE KEEPS THE PRICE IT WAS BOUGHT AT: the record carries the line's own price (`cents`), and every word that
// names what the shop pays is read from it, never from DECK_ADDON_CENTS.

import type Stripe from "stripe";
import { db } from "@/lib/db";
import { getStripeClient, isStripeEnabled } from "@/lib/sdk/stripe";
import type { StripeMode } from "@/lib/stripeMode";
import { ensureRecurringPrice } from "@/lib/stripePriceCache";
import { readScheduledSwitch } from "@/lib/planChange";
import { onFreePlan } from "@/lib/freePlan";
import { customDeckPageHeld } from "@/lib/customPageAccess";
import {
  DECK_ADDON_KIND,
  DECK_ADDON_NAME,
  addonHeld,
  deckAddonCents,
  deckAddonHeldWords,
  deckTrialWords,
  isDeckAddonLine,
  parseDeckAddonRecord,
  planLine,
  type AddonInterval,
  type DeckAddonPick,
  type DeckAddonRecord,
} from "@/lib/deckAddon";

export type { DeckAddonPick };

const keyOf = (organizationId: string) => `deckAddon:${organizationId}`;
const LIVE = new Set(["active", "trialing"]);

export async function readDeckAddonRecord(organizationId: string): Promise<DeckAddonRecord | null> {
  const row = await db.syncState.findUnique({ where: { key: keyOf(organizationId) } });
  return parseDeckAddonRecord(row?.cursor);
}

async function writeRecord(organizationId: string, record: DeckAddonRecord | null): Promise<void> {
  if (!record) {
    await db.syncState.deleteMany({ where: { key: keyOf(organizationId) } });
    return;
  }
  const cursor = JSON.stringify(record);
  await db.syncState.upsert({ where: { key: keyOf(organizationId) }, update: { cursor }, create: { key: keyOf(organizationId), cursor } });
}

/** The add-on is on this organization's subscription (the one the mirror holds now). */
export async function deckAddonHeld(organizationId: string, externalSubId?: string | null): Promise<boolean> {
  const subId =
    externalSubId !== undefined
      ? externalSubId
      : (await db.subscription.findUnique({ where: { organizationId }, select: { externalSubId: true } }))?.externalSubId ?? null;
  if (!subId) return false;
  return addonHeld(await readDeckAddonRecord(organizationId), subId);
}

export async function deckAddonPrice(stripe: Stripe, mode: StripeMode, interval: AddonInterval): Promise<string> {
  return ensureRecurringPrice({ stripe, mode, kind: DECK_ADDON_KIND, name: DECK_ADDON_NAME, interval, cents: deckAddonCents(interval) });
}

/** The term the plan is billed on — the add-on's line must match it. */
function termOf(sub: Stripe.Subscription): AddonInterval {
  return planLine(sub.items.data)?.price?.recurring?.interval === "year" ? "YEAR" : "MONTH";
}

const customerOf = (sub: Stripe.Subscription) => (typeof sub.customer === "string" ? sub.customer : sub.customer.id);

type Ready = { ok: true; stripe: Stripe; mode: StripeMode; sub: Stripe.Subscription } | { ok: false; error: string; code: DeckAddonFailure };
export type DeckAddonFailure = "no-subscription" | "unreachable" | "not-live" | "trial" | "included" | "past-due" | "booked-switch" | "declined" | "failed";

/** A Custom plan that bought the Deck estimator page holds the studio: never a second add-on line (owner, 2026-10-20). */
export const CUSTOM_INCLUDED_WORDS = "Included in your Custom plan.";

const NO_PAID_PLAN = "Deck Studio goes on a paid plan. Pick a plan on Subscription first, then add it here.";

/** The organization's live Stripe subscription, or why the add-on cannot be put on it. */
async function liveSubscription(organizationId: string, forChange: boolean, deps?: { stripe: Stripe; mode: StripeMode }): Promise<Ready> {
  const row = await db.subscription.findUnique({ where: { organizationId } });
  // The Free plan (an ended trial, a cancelled plan — lib/freePlan) has nothing to add a line to.
  if (!row || onFreePlan(row)) return { ok: false, code: "not-live", error: NO_PAID_PLAN };
  // A card-less trial: no subscription yet, and the trial holds the studio anyway.
  if (!row.externalSubId && row.status === "TRIALING") return { ok: false, code: "trial", error: deckTrialWords() };
  if (!row.externalSubId || row.provider !== "STRIPE" || !isStripeEnabled()) {
    return { ok: false, code: "no-subscription", error: "Your plan isn't billed to a card on file, so the add-on can't go on it from here. Write to us from Help and we'll add it." };
  }
  if (forChange) {
    // A booked YEAR → MONTH switch holds the subscription on a schedule (lib/planChange): lines wait until it is done.
    const booked = await readScheduledSwitch(organizationId).catch(() => null);
    if (booked) {
      return { ok: false, code: "booked-switch", error: `A switch to ${booked.planName} is booked for ${new Date(booked.at).toLocaleDateString("en-US")}. Cancel it on Subscription first, or add Deck Studio after it.` };
    }
  }
  const { stripe, mode } = deps ?? (await getStripeClient());
  let sub: Stripe.Subscription;
  try {
    sub = await stripe.subscriptions.retrieve(row.externalSubId);
  } catch {
    return { ok: false, code: "unreachable", error: "Couldn't reach your subscription. Try again in a minute." };
  }
  if (!LIVE.has(sub.status)) {
    return sub.status === "past_due" || sub.status === "unpaid"
      ? { ok: false, code: "past-due", error: "Your last payment didn't go through. Update the card on Subscription first, then add Deck Studio." }
      : { ok: false, code: "not-live", error: "Your subscription isn't active, so nothing can be added to it." };
  }
  return { ok: true, stripe, mode, sub };
}

export type DeckAddonChange =
  | {
      ok: true;
      /** Charged at once for the rest of this period (prorated); 0 in a trial. */
      chargedCents: number;
      /** The line's price per term, and the term. */
      termCents: number;
      interval: AddonInterval;
      trialing: boolean;
      /** It was on the subscription already: nothing was charged, the record caught up. */
      already: boolean;
    }
  | { ok: false; error: string; code: DeckAddonFailure };

function recordOf(sub: Stripe.Subscription, line: Stripe.SubscriptionItem, since?: string): DeckAddonRecord {
  const cents = line.price?.unit_amount ?? null;
  return { subId: sub.id, itemId: line.id, interval: termOf(sub), since: since ?? new Date().toISOString(), ...(cents ? { cents } : {}) };
}

/** The add-on this organization holds now, with the price its line bills — a record from before 2026-10-26 has no
 *  price, so it is read off the line once and kept. Null when it is not held. */
export async function readHeldDeckAddon(organizationId: string, externalSubId?: string | null): Promise<DeckAddonRecord | null> {
  const subId =
    externalSubId !== undefined
      ? externalSubId
      : (await db.subscription.findUnique({ where: { organizationId }, select: { externalSubId: true } }))?.externalSubId ?? null;
  const record = await readDeckAddonRecord(organizationId);
  if (!record || !addonHeld(record, subId)) return null;
  if (record.cents || !isStripeEnabled()) return record;
  try {
    const { stripe } = await getStripeClient();
    const cents = (await stripe.subscriptionItems.retrieve(record.itemId)).price?.unit_amount ?? null;
    if (!cents) return record;
    const next = { ...record, cents };
    await writeRecord(organizationId, next);
    return next;
  } catch (err) {
    console.warn("[deckAddon] the held line's price could not be read:", err);
    return record;
  }
}

/** PUT THE ADD-ON ON THE PLAN: prorated and charged now, all or nothing on the card. Never in a trial: the trial
 *  holds the studio, and nothing is put on the subscription for after it. */
export async function addDeckAddon(organizationId: string, deps?: { stripe: Stripe; mode: StripeMode }): Promise<DeckAddonChange> {
  if (await customDeckPageHeld(organizationId)) return { ok: false, code: "included", error: CUSTOM_INCLUDED_WORDS };
  const ready = await liveSubscription(organizationId, true, deps);
  if (!ready.ok) return ready;
  const { stripe, mode } = ready;
  let sub = ready.sub;
  const trialing = sub.status === "trialing";
  const interval = termOf(sub);

  // A line already there (one put on in Stripe, or in a trial before 2026-10-20): the record catches up.
  const there = sub.items.data.find(isDeckAddonLine);
  if (there) {
    await writeRecord(organizationId, recordOf(sub, there, (await readDeckAddonRecord(organizationId))?.since));
    return { ok: true, chargedCents: 0, termCents: deckAddonCents(interval), interval, trialing, already: true };
  }
  if (trialing) return { ok: false, code: "trial", error: deckTrialWords(interval) };

  let price: string;
  try {
    price = await deckAddonPrice(stripe, mode, interval);
  } catch (err) {
    console.warn("[deckAddon] the price could not be made:", err);
    return { ok: false, code: "failed", error: "Couldn't add Deck Studio. Try again." };
  }
  const startedAt = Math.floor(Date.now() / 1000) - 5;
  try {
    sub = await stripe.subscriptions.update(sub.id, {
      items: [{ price, quantity: 1 }],
      proration_behavior: "always_invoice",
      payment_behavior: "pending_if_incomplete",
      metadata: { ...(sub.metadata ?? {}), organizationId, deckAddon: "1" },
      expand: ["latest_invoice"],
    });
  } catch (err) {
    console.warn("[deckAddon] adding the line failed:", err);
    return { ok: false, code: "failed", error: "Couldn't add Deck Studio. Try again." };
  }
  if (sub.pending_update) {
    // The card did not pay for the rest of the period: nothing was added. Void the pending update's invoice so no
    // stray charge is retried.
    const inv = sub.latest_invoice;
    const invId = typeof inv === "string" ? inv : inv?.id;
    if (invId) await stripe.invoices.voidInvoice(invId).catch((err) => console.warn("[deckAddon] void failed:", err));
    return { ok: false, code: "declined", error: "The card on file was declined. Deck Studio wasn't added and nothing was charged." };
  }
  const line = sub.items.data.find(isDeckAddonLine);
  if (!line) {
    console.warn(`[deckAddon] ${sub.id}: updated, but no add-on line came back`);
    return { ok: false, code: "failed", error: "Couldn't add Deck Studio. Try again." };
  }
  let chargedCents = 0;
  const inv = sub.latest_invoice;
  if (inv && typeof inv !== "string" && (inv.created ?? 0) >= startedAt && inv.billing_reason === "subscription_update") {
    chargedCents = inv.amount_paid ?? 0;
  }
  await writeRecord(organizationId, recordOf(sub, line));
  return { ok: true, chargedCents, termCents: deckAddonCents(interval), interval, trialing, already: false };
}

/** TAKE IT OFF: Stripe prorates — the unused rest of the period is a credit on the next bill; the studio is a
 *  preview again now. */
export async function removeDeckAddon(organizationId: string): Promise<{ ok: true } | { ok: false; error: string; code: DeckAddonFailure }> {
  const ready = await liveSubscription(organizationId, false);
  if (!ready.ok) {
    // Nothing billable to take it off: the record goes, so nothing stays open on it.
    const nothing = ready.code === "no-subscription" || ready.code === "not-live" || ready.code === "trial";
    if (nothing) await writeRecord(organizationId, null);
    return nothing ? { ok: true } : ready;
  }
  const { stripe, sub } = ready;
  const lines = sub.items.data.filter(isDeckAddonLine);
  if (lines.length) {
    try {
      await stripe.subscriptions.update(sub.id, {
        items: lines.map((l) => ({ id: l.id, deleted: true as const })),
        proration_behavior: "create_prorations",
        metadata: { ...(sub.metadata ?? {}), deckAddon: "" },
      });
    } catch (err) {
      console.warn("[deckAddon] removing the line failed:", err);
      return { ok: false, code: "failed", error: "Couldn't remove Deck Studio. Try again." };
    }
  }
  await writeRecord(organizationId, null);
  return { ok: true };
}

export interface DeckAddonOffer {
  /** On the plan now. */
  held: boolean;
  /** What the held line bills per term — its own price, which a line bought before 2026-10-26 keeps ($49). */
  heldCents: number | null;
  /** It can be added from here (a live card subscription with nothing booked). */
  canAdd: boolean;
  /** Why it can't, in the shop's words. */
  reason: string | null;
  interval: AddonInterval;
  termCents: number;
  /** What adding it charges today (Stripe's own preview); null when Stripe could not say. */
  dueNowCents: number | null;
  trialing: boolean;
  /** When the trial ends (ISO), while it runs. */
  trialEndsAt: string | null;
  /** The studio is open without the add-on: the free trial, a complimentary plan, or the Custom plan's deck page
   *  (lib/editions). */
  included: "trial" | "grant" | "custom" | null;
}

/** What adding it would cost, before it is added. */
export async function deckAddonOffer(organizationId: string): Promise<DeckAddonOffer> {
  const row = await db.subscription.findUnique({ where: { organizationId } });
  const record = await readHeldDeckAddon(organizationId, row?.externalSubId ?? null);
  const held = !!record;
  const base: DeckAddonOffer = {
    held,
    heldCents: record?.cents ?? null,
    canAdd: false,
    reason: null,
    interval: "MONTH",
    termCents: deckAddonCents("MONTH"),
    dueNowCents: null,
    trialing: row?.status === "TRIALING",
    trialEndsAt: row?.status === "TRIALING" && row.trialEndsAt ? row.trialEndsAt.toISOString() : null,
    included: null,
  };
  if (record) return { ...base, interval: record.interval, termCents: record.cents ?? deckAddonCents(record.interval) };
  // A complimentary plan holds the studio (lib/editions): nothing to add.
  if (row?.provider === "MANUAL" && !onFreePlan(row)) return { ...base, included: "grant", reason: "Deck Studio is included in your complimentary plan." };
  // The Custom plan's deck page, bought: the add-on as a page — it outlasts the trial, so it is said before it.
  if (row && !onFreePlan(row) && (await customDeckPageHeld(organizationId, row.plan))) return { ...base, included: "custom", reason: CUSTOM_INCLUDED_WORDS };
  const ready = await liveSubscription(organizationId, true).catch(() => null);
  if (!ready) return { ...base, reason: "Couldn't reach your subscription. Try again in a minute." };
  if (!ready.ok) return { ...base, reason: ready.error, included: ready.code === "trial" ? "trial" : null };
  const { stripe, mode, sub } = ready;
  const interval = termOf(sub);
  // The trial holds the studio: nothing to add, nothing put on the subscription for after it (owner, 2026-10-20).
  if (sub.status === "trialing") {
    return { ...base, interval, termCents: deckAddonCents(interval), trialing: true, included: "trial", reason: deckTrialWords(interval), trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : base.trialEndsAt };
  }
  const out: DeckAddonOffer = { ...base, canAdd: true, interval, termCents: deckAddonCents(interval), trialing: false };
  try {
    return { ...out, dueNowCents: await deckAddonDueNow(stripe, sub, await deckAddonPrice(stripe, mode, interval)) };
  } catch (err) {
    console.warn("[deckAddon] preview failed:", err);
    return out;
  }
}

/** What putting the add-on on `sub` charges today: the rest of the period, prorated — Stripe's own preview. */
export async function deckAddonDueNow(stripe: Stripe, sub: Stripe.Subscription, price: string): Promise<number> {
  const pre = await stripe.invoices.createPreview({
    customer: customerOf(sub),
    subscription: sub.id,
    subscription_details: { items: [{ price, quantity: 1 }], proration_behavior: "always_invoice" },
  });
  const proration = pre.lines.data
    .filter((l) => {
      // Both shapes (lib/stripeCompat): today's `parent.subscription_item_details.proration`, the 2024-06-20 line's
      // own `proration`. Read loosely: `parent` is newer than some Stripe type versions in use.
      const line = l as unknown as { proration?: boolean; parent?: { subscription_item_details?: { proration?: boolean } } | null };
      return Boolean(line.parent?.subscription_item_details?.proration ?? line.proration);
    })
    .reduce((sum, l) => sum + l.amount, 0);
  return Math.max(0, proration);
}

export async function deckAddonPick(organizationId: string): Promise<DeckAddonPick> {
  const row = await db.subscription.findUnique({ where: { organizationId } });
  const free = !row || onFreePlan(row);
  const trialing = !free && row?.status === "TRIALING";
  const record = free ? null : await readHeldDeckAddon(organizationId, row?.externalSubId ?? null);
  if (record) return { offer: false, held: { words: deckAddonHeldWords(record.cents, record.interval), interval: record.interval }, included: null, trialing };
  if (row && !free && row.provider === "MANUAL") return { offer: false, held: null, included: "grant", trialing };
  if (row && !free && (await customDeckPageHeld(organizationId, row.plan))) return { offer: false, held: null, included: "custom", trialing };
  return { offer: true, held: null, included: null, trialing };
}

/**
 * THE ADD-ON ON A PLAN CHECKOUT (owner, 2026-10-26). Every subscription Checkout carries it:
 *   · ticked beside the plan cards ("Add Deck Studio") — a line of the order, like the plan's;
 *   · not ticked — an OPTIONAL item: Stripe's page shows a Deck Studio row the person can switch on;
 *   · the subscription this checkout replaces holds it on the same term — that line's OWN price goes on as a line of
 *     the order, so a shop that bought it at $49 keeps $49 on the plan it moves to.
 * The trial (trial_period_days) covers every line of the subscription.
 */
export async function deckAddonCheckoutItems(opts: {
  stripe: Stripe;
  mode: StripeMode;
  interval: AddonInterval;
  chosen: boolean;
  /** The held line's price on the subscription this checkout replaces (same term only). */
  keepPriceId?: string | null;
}): Promise<{ lineItems: Stripe.Checkout.SessionCreateParams.LineItem[]; optionalItems: Stripe.Checkout.SessionCreateParams.OptionalItem[] }> {
  if (opts.keepPriceId) return { lineItems: [{ price: opts.keepPriceId, quantity: 1 }], optionalItems: [] };
  const price = await deckAddonPrice(opts.stripe, opts.mode, opts.interval);
  return opts.chosen ? { lineItems: [{ price, quantity: 1 }], optionalItems: [] } : { lineItems: [], optionalItems: [{ price, quantity: 1 }] };
}

/** The add-on line's price on a subscription, when it bills on `interval` — what a replacement checkout carries on. */
export async function heldDeckAddonPrice(stripe: Stripe, subId: string, interval: AddonInterval): Promise<string | null> {
  try {
    const sub = await stripe.subscriptions.retrieve(subId);
    const line = sub.items.data.find(isDeckAddonLine);
    return line && termOf(sub) === interval ? line.price.id : null;
  } catch {
    return null;
  }
}

/**
 * THE WEBHOOK'S SIDE: keep the record to what Stripe holds. The line on a live subscription writes it (the add
 * that returned before its write, a line an admin put on in Stripe); a line gone — removed in Stripe, dropped by a
 * plan switch — or the subscription ended takes it away. `sub` is Stripe's current copy (the webhook reads it).
 */
export async function mirrorDeckAddon(sub: Stripe.Subscription, ended = false, knownOrganizationId?: string | null): Promise<void> {
  const organizationId =
    knownOrganizationId ||
    sub.metadata?.organizationId ||
    (await db.subscription.findFirst({ where: { externalSubId: sub.id }, select: { organizationId: true } }))?.organizationId;
  if (!organizationId) return;
  const record = await readDeckAddonRecord(organizationId);
  const line = sub.items?.data?.find(isDeckAddonLine);
  const over = ended || sub.status === "canceled" || sub.status === "incomplete_expired";
  if (over || !line) {
    if (record?.subId === sub.id) await writeRecord(organizationId, null);
    return;
  }
  // Only the subscription the organization is on carries it (a second, stray subscription never does).
  const current = await db.subscription.findUnique({ where: { organizationId }, select: { externalSubId: true } });
  if (current?.externalSubId && current.externalSubId !== sub.id) return;
  if (record?.subId === sub.id && record.itemId === line.id && record.cents === (line.price?.unit_amount ?? undefined)) return;
  await writeRecord(organizationId, recordOf(sub, line, record?.subId === sub.id ? record.since : undefined));
}
