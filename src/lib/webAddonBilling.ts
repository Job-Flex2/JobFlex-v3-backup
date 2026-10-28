import "server-only";
// THE WEBSITE ESTIMATOR ADD-ONS ON STRIPE (owner, 2026-10-27 — lib/webAddon for the rules): one more line per trade
// on the subscription the shop already has, the Deck Studio add-on's way (lib/deckAddonBilling):
//
//   · ADD on a live card plan — proration_behavior "always_invoice": the rest of this period is invoiced and charged
//     at once, under payment_behavior "pending_if_incomplete", so a declined card adds NOTHING (the pending update's
//     invoice is voided).
//   · ADD in a card trial — proration_behavior "none": the line rides the trial and is billed with the plan when the
//     trial ends. The shop chose it beside the words "free until your trial ends, then $… a month".
//   · REMOVE — "create_prorations": the unused rest of the period is a credit on the next bill (nothing in a trial).
//
// WHAT SERVES THE PUBLIC is our record, SyncState `webAddon:<orgId>` ({ subId, interval, lines: { roof: {itemId,
// cents, since} … } }), written when a line goes on and kept to Stripe by the webhook (mirrorWebAddons): a line
// removed in Stripe, or a subscription replaced by a new Checkout, takes it out of the record — and a record names
// its subscription, so a new one never inherits it until its own lines are seen.
//
// A LINE KEEPS THE PRICE IT WAS BOUGHT AT: the record carries each line's own price, and every word that names what
// the shop pays is read from it.

import type Stripe from "stripe";
import { db } from "@/lib/db";
import { getStripeClient, isStripeEnabled } from "@/lib/sdk/stripe";
import type { StripeMode } from "@/lib/stripeMode";
import { ensureRecurringPrice } from "@/lib/stripePriceCache";
import { onFreePlan } from "@/lib/freePlan";
import { planLine } from "@/lib/deckAddon";
import {
  parseWebAddonRecord,
  recordFromSubscription,
  webAddonCents,
  webAddonKind,
  webAddonName,
  webBillingMode,
  webLineHeld,
  webTradeOfLine,
  webTradeServes,
  type AddonInterval,
  type WebAddonLine,
  type WebAddonRecord,
  type WebBillingMode,
} from "@/lib/webAddon";
import { WEB_TRADE, WEB_TRADES, isHouse, type WebShop, type WebTrade } from "@/lib/webEstimator";
import { readWebSettings, webEstimatorOpen } from "@/lib/webEstimatorServer";

const keyOf = (organizationId: string) => `webAddon:${organizationId}`;
const LIVE = new Set(["active", "trialing"]);

export async function readWebAddonRecord(organizationId: string): Promise<WebAddonRecord | null> {
  const row = await db.syncState.findUnique({ where: { key: keyOf(organizationId) } });
  return parseWebAddonRecord(row?.cursor);
}

async function writeRecord(organizationId: string, record: WebAddonRecord | null): Promise<void> {
  if (!record) {
    await db.syncState.deleteMany({ where: { key: keyOf(organizationId) } });
    return;
  }
  const cursor = JSON.stringify(record);
  await db.syncState.upsert({ where: { key: keyOf(organizationId) }, update: { cursor }, create: { key: keyOf(organizationId), cursor } });
}

/** How this shop pays, and which lines it holds now — from our rows, no Stripe call. */
export interface WebBilling {
  mode: WebBillingMode;
  interval: AddonInterval;
  trialEndsAt: string | null;
  subId: string | null;
  held: Partial<Record<WebTrade, WebAddonLine>>;
}

export async function webBilling(organizationId: string, open?: boolean): Promise<WebBilling> {
  const [row, record, isOpen] = await Promise.all([
    db.subscription.findUnique({ where: { organizationId }, select: { status: true, provider: true, externalSubId: true, trialEndsAt: true } }),
    readWebAddonRecord(organizationId),
    open === undefined ? webEstimatorOpen() : Promise.resolve(open),
  ]);
  const mode = webBillingMode(row, { open: isOpen, onFree: onFreePlan(row), stripeEnabled: isStripeEnabled() });
  const held: WebBilling["held"] = {};
  for (const t of WEB_TRADES) {
    const l = webLineHeld(record, row?.externalSubId ?? null, t);
    if (l) held[t] = l;
  }
  return {
    mode,
    interval: record && record.subId === row?.externalSubId ? record.interval : "MONTH",
    trialEndsAt: row?.status === "TRIALING" && row.trialEndsAt ? row.trialEndsAt.toISOString() : null,
    subId: row?.externalSubId ?? null,
    held,
  };
}

/** Does this trade answer the public for this shop right now (its setting, the switch, its billing)? */
export async function webTradeLive(organizationId: string, trade: WebTrade, on?: boolean): Promise<boolean> {
  const isOn = on === undefined ? (await readWebSettings(organizationId)).trades[trade].on : on;
  if (!isOn) return false;
  const open = await webEstimatorOpen();
  if (!open) return true;
  const b = await webBilling(organizationId, open);
  return webTradeServes({ open, on: true, mode: b.mode, held: !!b.held[trade] });
}

/** Does this shop serve this trade to the public — the house by its own settings (no add-on, nothing billed), a shop
 *  by its add-on (webTradeLive). The one gate every public action and page asks (2026-10-28). */
export async function webShopServes(shop: WebShop, trade: WebTrade): Promise<boolean> {
  return isHouse(shop) ? shop.settings.trades[trade].on : webTradeLive(shop.id, trade, shop.settings.trades[trade].on);
}

export async function webAddonPrice(stripe: Stripe, mode: StripeMode, trade: WebTrade, interval: AddonInterval): Promise<string> {
  return ensureRecurringPrice({ stripe, mode, kind: webAddonKind(trade), name: webAddonName(trade), interval, cents: webAddonCents(trade, interval) });
}

/** The term the plan is billed on — a website line must match it. */
function termOf(sub: Stripe.Subscription): AddonInterval {
  return planLine(sub.items.data)?.price?.recurring?.interval === "year" ? "YEAR" : "MONTH";
}

const customerOf = (sub: Stripe.Subscription) => (typeof sub.customer === "string" ? sub.customer : sub.customer.id);

export type WebAddonFailure = "no-subscription" | "unreachable" | "not-live" | "past-due" | "declined" | "failed";
type Ready = { ok: true; stripe: Stripe; mode: StripeMode; sub: Stripe.Subscription } | { ok: false; error: string; code: WebAddonFailure };

/** The organization's live Stripe subscription, or why a line cannot go on it. */
async function liveSubscription(organizationId: string): Promise<Ready> {
  const row = await db.subscription.findUnique({ where: { organizationId } });
  if (!row || onFreePlan(row)) return { ok: false, code: "not-live", error: "Website estimators go on a paid plan. Pick a plan on Subscription first." };
  if (!row.externalSubId || row.provider !== "STRIPE" || !isStripeEnabled()) {
    return { ok: false, code: "no-subscription", error: "Your plan isn't billed to a card on file, so the add-on can't go on it from here. Write to us from Help and we'll add it." };
  }
  const { stripe, mode } = await getStripeClient();
  let sub: Stripe.Subscription;
  try {
    sub = await stripe.subscriptions.retrieve(row.externalSubId);
  } catch {
    return { ok: false, code: "unreachable", error: "Couldn't reach your subscription. Try again in a minute." };
  }
  if (!LIVE.has(sub.status)) {
    return sub.status === "past_due" || sub.status === "unpaid"
      ? { ok: false, code: "past-due", error: "Your last payment didn't go through. Update the card on Subscription first." }
      : { ok: false, code: "not-live", error: "Your subscription isn't active, so nothing can be added to it." };
  }
  return { ok: true, stripe, mode, sub };
}

async function record(organizationId: string, sub: Stripe.Subscription): Promise<WebAddonRecord | null> {
  const next = recordFromSubscription({ id: sub.id, items: sub.items.data }, await readWebAddonRecord(organizationId));
  await writeRecord(organizationId, next);
  return next;
}

export type WebAddonChange =
  | {
      ok: true;
      /** Charged at once for the rest of this period; 0 in a trial. */
      chargedCents: number;
      /** The line's price per term, and the term. */
      termCents: number;
      interval: AddonInterval;
      trialing: boolean;
      /** It was on the subscription already: nothing was charged, the record caught up. */
      already: boolean;
    }
  | { ok: false; error: string; code: WebAddonFailure };

const name = (trade: WebTrade) => WEB_TRADE[trade].name.replace(" on your website", "");

/** PUT A TRADE'S LINE ON THE PLAN: prorated and charged now on a live plan, all or nothing on the card; rides a card
 *  trial unbilled until it ends. */
export async function addWebAddon(organizationId: string, trade: WebTrade): Promise<WebAddonChange> {
  const ready = await liveSubscription(organizationId);
  if (!ready.ok) return ready;
  const { stripe, mode } = ready;
  let sub = ready.sub;
  const trialing = sub.status === "trialing";
  const interval = termOf(sub);

  // A line already there (put on in Stripe, or by a checkout that carried it): the record catches up.
  const there = sub.items.data.find((i) => webTradeOfLine(i) === trade);
  if (there) {
    await record(organizationId, sub);
    return { ok: true, chargedCents: 0, termCents: there.price?.unit_amount ?? webAddonCents(trade, interval), interval, trialing, already: true };
  }

  let price: string;
  try {
    price = await webAddonPrice(stripe, mode, trade, interval);
  } catch (err) {
    console.warn("[webAddon] the price could not be made:", err);
    return { ok: false, code: "failed", error: `Couldn't add the ${name(trade)}. Try again.` };
  }
  const startedAt = Math.floor(Date.now() / 1000) - 5;
  try {
    sub = await stripe.subscriptions.update(sub.id, {
      items: [{ price, quantity: 1 }],
      ...(trialing
        ? { proration_behavior: "none" }
        : { proration_behavior: "always_invoice", payment_behavior: "pending_if_incomplete", expand: ["latest_invoice"] }),
      metadata: { ...(sub.metadata ?? {}), organizationId, webAddons: "1" },
    });
  } catch (err) {
    console.warn("[webAddon] adding the line failed:", err);
    return { ok: false, code: "failed", error: `Couldn't add the ${name(trade)}. Try again.` };
  }
  if (sub.pending_update) {
    // The card did not pay for the rest of the period: nothing was added. Void the pending update's invoice so no
    // stray charge is retried.
    const inv = sub.latest_invoice;
    const invId = typeof inv === "string" ? inv : inv?.id;
    if (invId) await stripe.invoices.voidInvoice(invId).catch((err) => console.warn("[webAddon] void failed:", err));
    return { ok: false, code: "declined", error: `The card on file was declined. The ${name(trade)} wasn't added and nothing was charged.` };
  }
  const line = sub.items.data.find((i) => webTradeOfLine(i) === trade);
  if (!line) {
    console.warn(`[webAddon] ${sub.id}: updated, but no ${trade} line came back`);
    return { ok: false, code: "failed", error: `Couldn't add the ${name(trade)}. Try again.` };
  }
  let chargedCents = 0;
  if (!trialing) {
    // What the card paid: the update's invoice, expanded on the reply — or, when it did not come back expanded, the
    // newest invoice of this subscription since the update began.
    let inv = typeof sub.latest_invoice === "string" || !sub.latest_invoice ? null : sub.latest_invoice;
    if (!inv) {
      const list = await stripe.invoices.list({ subscription: sub.id, limit: 3 }).catch(() => null);
      inv = list?.data.find((i) => (i.created ?? 0) >= startedAt && i.billing_reason === "subscription_update") ?? null;
    }
    if (inv && (inv.created ?? 0) >= startedAt && inv.billing_reason === "subscription_update") chargedCents = inv.amount_paid ?? 0;
  }
  await record(organizationId, sub);
  return { ok: true, chargedCents, termCents: line.price?.unit_amount ?? webAddonCents(trade, interval), interval, trialing, already: false };
}

/** TAKE A TRADE'S LINE OFF: Stripe prorates — the unused rest of the period is a credit on the next bill. */
export async function removeWebAddon(organizationId: string, trade: WebTrade): Promise<{ ok: true } | { ok: false; error: string; code: WebAddonFailure }> {
  const ready = await liveSubscription(organizationId);
  if (!ready.ok) {
    // Nothing billable to take it off: the record's line goes, so nothing stays open on it.
    const nothing = ready.code === "no-subscription" || ready.code === "not-live";
    if (nothing) {
      const rec = await readWebAddonRecord(organizationId);
      if (rec?.lines[trade]) {
        const lines = { ...rec.lines };
        delete lines[trade];
        await writeRecord(organizationId, Object.keys(lines).length ? { ...rec, lines } : null);
      }
    }
    return nothing ? { ok: true } : ready;
  }
  const { stripe, sub } = ready;
  const lines = sub.items.data.filter((i) => webTradeOfLine(i) === trade);
  let after = sub;
  if (lines.length) {
    try {
      after = await stripe.subscriptions.update(sub.id, {
        items: lines.map((l) => ({ id: l.id, deleted: true as const })),
        proration_behavior: sub.status === "trialing" ? "none" : "create_prorations",
      });
    } catch (err) {
      console.warn("[webAddon] removing the line failed:", err);
      return { ok: false, code: "failed", error: `Couldn't remove the ${name(trade)}. Try again.` };
    }
  }
  await record(organizationId, after);
  return { ok: true };
}

/** What putting a trade's line on charges today (Stripe's own preview), before it is put on. */
export async function quoteWebAddon(organizationId: string, trade: WebTrade): Promise<{ ok: true; dueNowCents: number | null; termCents: number; interval: AddonInterval; trialing: boolean } | { ok: false; error: string }> {
  const ready = await liveSubscription(organizationId);
  if (!ready.ok) return { ok: false, error: ready.error };
  const { stripe, mode, sub } = ready;
  const interval = termOf(sub);
  const termCents = webAddonCents(trade, interval);
  if (sub.status === "trialing") return { ok: true, dueNowCents: 0, termCents, interval, trialing: true };
  try {
    const price = await webAddonPrice(stripe, mode, trade, interval);
    const pre = await stripe.invoices.createPreview({
      customer: customerOf(sub),
      subscription: sub.id,
      subscription_details: { items: [{ price, quantity: 1 }], proration_behavior: "always_invoice" },
    });
    const proration = pre.lines.data
      .filter((l) => {
        // Both shapes (lib/stripeCompat): today's `parent.subscription_item_details.proration`, the older line's own `proration`.
        const line = l as unknown as { proration?: boolean; parent?: { subscription_item_details?: { proration?: boolean } } | null };
        return Boolean(line.parent?.subscription_item_details?.proration ?? line.proration);
      })
      .reduce((sum, l) => sum + l.amount, 0);
    return { ok: true, dueNowCents: Math.max(0, proration), termCents, interval, trialing: false };
  } catch (err) {
    console.warn("[webAddon] preview failed:", err);
    return { ok: true, dueNowCents: null, termCents, interval, trialing: false };
  }
}

/** The website lines' prices on a subscription, when they bill on `interval` — what a replacement checkout carries
 *  on, so a shop keeps its estimators (at their own prices) through a plan bought again through Checkout. */
export async function heldWebAddonPrices(stripe: Stripe, subId: string, interval: AddonInterval): Promise<string[]> {
  try {
    const sub = await stripe.subscriptions.retrieve(subId);
    if (termOf(sub) !== interval) return [];
    const seen = new Set<WebTrade>();
    const out: string[] = [];
    for (const i of sub.items.data) {
      const t = webTradeOfLine(i);
      if (t && !seen.has(t)) { seen.add(t); out.push(i.price.id); }
    }
    return out;
  } catch {
    return [];
  }
}

/** The lines a term change must put on again at the new term: one price per held trade. */
export async function webAddonPricesFor(stripe: Stripe, mode: StripeMode, sub: Stripe.Subscription, interval: AddonInterval): Promise<string[]> {
  const trades = new Set<WebTrade>();
  for (const i of sub.items.data) { const t = webTradeOfLine(i); if (t) trades.add(t); }
  const out: string[] = [];
  for (const t of trades) out.push(await webAddonPrice(stripe, mode, t, interval));
  return out;
}

/** THE WEBHOOK'S SIDE: keep the record to what Stripe holds. Lines on a live subscription write it (an add that
 *  returned before its write, a line an admin put on in Stripe, a checkout that carried them); lines gone — removed
 *  in Stripe, dropped by a plan switch — or the subscription ended take them away. */
export async function mirrorWebAddons(sub: Stripe.Subscription, ended = false, knownOrganizationId?: string | null): Promise<void> {
  const organizationId =
    knownOrganizationId ||
    sub.metadata?.organizationId ||
    (await db.subscription.findFirst({ where: { externalSubId: sub.id }, select: { organizationId: true } }))?.organizationId;
  if (!organizationId) return;
  const prev = await readWebAddonRecord(organizationId);
  const over = ended || sub.status === "canceled" || sub.status === "incomplete_expired";
  const next = over ? null : recordFromSubscription({ id: sub.id, items: sub.items?.data ?? [] }, prev);
  if (!next) {
    if (prev?.subId === sub.id) await writeRecord(organizationId, null);
    return;
  }
  // Only the subscription the organization is on carries them (a second, stray subscription never does).
  const current = await db.subscription.findUnique({ where: { organizationId }, select: { externalSubId: true } });
  if (current?.externalSubId && current.externalSubId !== sub.id) return;
  if (prev && JSON.stringify(prev) === JSON.stringify(next)) return;
  await writeRecord(organizationId, next);
}

/** For the Subscription page: the lines held now, in words. */
export async function webAddonLines(organizationId: string): Promise<Array<{ trade: WebTrade; name: string; cents: number; interval: AddonInterval; since: string }>> {
  const b = await webBilling(organizationId);
  return WEB_TRADES.flatMap((t) => (b.held[t] ? [{ trade: t, name: WEB_TRADE[t].name, cents: b.held[t]!.cents, interval: b.interval, since: b.held[t]!.since }] : []));
}

