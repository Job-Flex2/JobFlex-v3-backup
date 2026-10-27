// THE WEBSITE ESTIMATOR ADD-ONS — THE MONEY (owner, 2026-10-27: "each add-on for their websites: Deck Studio $150 a
// month, roofing $179 a month, HVAC $79, and fence estimator" — fence's price not named; $99 stands in). Pure: the
// four lines' kinds, names and prices, how a Stripe line is told to be one of them, the record we keep of the lines a
// shop holds, and the one rule that says whether a trade serves the public.
//
// LIKE THE DECK STUDIO ADD-ON (lib/deckAddon): each trade is ONE MORE LINE on the subscription the shop already has —
// never a plan of its own, never a second subscription: one bill, one card, one cancel. A yearly plan carries the
// yearly line, ten months' price for twelve (lib/customPlan CUSTOM_YEAR_MULTIPLIER). The line is told by its price's
// `jfKind` ("web-roof"…), never by its amount, and keeps the price it was bought at: what the shop pays is read off
// its own line (WebAddonLine.cents), never from the table.
//
// WHO PAYS WHEN (webBillingMode):
//   · preview — the owner's switch (lib/webEstimator WEB_OPEN_KEY) is off: platform admins rehearse, nothing is billed;
//   · trial-cardless — a trial with no subscription on Stripe: free until the trial ends, nothing to put a line on;
//   · trial-card — a trial on a card: the line goes on now, billed with the plan when the trial ends (the shop chose
//     it beside those words);
//   · card — a live card plan: the line goes on now, the rest of this period charged at once;
//   · grant — a complimentary plan: included, no line;
//   · free — the Free plan: a trade can't be turned on until a plan is picked;
//   · offline — a plan not billed to a card here: "write to us".
// A trade SERVES THE PUBLIC (webTradeServes) when it is on and, with the feature open, its line is held — or the
// shop is in a trial or on a complimentary plan.

import { CUSTOM_YEAR_MULTIPLIER } from "@/lib/customPlan";
import { WEB_TRADE, WEB_TRADES, isWebTrade, type WebTrade } from "@/lib/webEstimator";

export type AddonInterval = "MONTH" | "YEAR";

/** Every website line's `jfKind` starts with this; the rest is the trade. */
export const WEB_ADDON_KIND_PREFIX = "web-";

export function webAddonKind(trade: WebTrade): string {
  return WEB_TRADE[trade].kind;
}

/** The Stripe product's name — what the shop reads on its invoice. */
export function webAddonName(trade: WebTrade): string {
  return `JobFlex ${WEB_TRADE[trade].name}`;
}

/** What the line costs per term: the monthly price, or ten months' price for a year. */
export function webAddonCents(trade: WebTrade, interval: AddonInterval = "MONTH"): number {
  const m = WEB_TRADE[trade].cents;
  return interval === "YEAR" ? m * CUSTOM_YEAR_MULTIPLIER : m;
}

/** "$179" · "$61.30" · "$1,790". */
export function dollars(cents: number): string {
  const d = cents / 100;
  const whole = Number.isInteger(d);
  return `$${d.toLocaleString("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
}

/** "$179/mo" · "$1,790/yr" — or, long, "$179 a month" · "$1,790 a year". */
export function webAddonPriceWords(cents: number, interval: AddonInterval = "MONTH", long = false): string {
  const per = interval === "YEAR" ? (long ? " a year" : "/yr") : long ? " a month" : "/mo";
  return `${dollars(cents)}${per}`;
}

type LineLike = { price?: { metadata?: Record<string, string> | null } | null } | null | undefined;

/** Which trade a Stripe line bills, by its price's `jfKind`; null for the plan's own line and the Deck add-on. */
export function webTradeOfLine(item: LineLike): WebTrade | null {
  const kind = item?.price?.metadata?.jfKind;
  if (!kind || !kind.startsWith(WEB_ADDON_KIND_PREFIX)) return null;
  const t = kind.slice(WEB_ADDON_KIND_PREFIX.length);
  return isWebTrade(t) ? t : null;
}

export function isWebAddonLine(item: LineLike): boolean {
  return webTradeOfLine(item) !== null;
}

/** One held line: Stripe's item, what it bills per term (its own price), and when it went on. */
export interface WebAddonLine {
  itemId: string;
  cents: number;
  since: string;
}

/** What we keep per organization (SyncState `webAddon:<orgId>`): the subscription the lines are on, its term, and a
 *  line per trade. A record names its subscription: a plan bought again through a new Checkout (a new subscription)
 *  does not carry the old lines, so it does not carry the add-ons either — until the webhook sees them on the new one. */
export interface WebAddonRecord {
  subId: string;
  interval: AddonInterval;
  lines: Partial<Record<WebTrade, WebAddonLine>>;
}

export function parseWebAddonRecord(raw: string | null | undefined): WebAddonRecord | null {
  if (!raw) return null;
  try {
    const r = JSON.parse(raw) as Partial<WebAddonRecord>;
    if (typeof r.subId !== "string" || !r.subId || !r.lines || typeof r.lines !== "object") return null;
    const lines: WebAddonRecord["lines"] = {};
    for (const t of WEB_TRADES) {
      const l = (r.lines as Record<string, Partial<WebAddonLine> | undefined>)[t];
      if (l && typeof l.itemId === "string" && l.itemId && typeof l.cents === "number" && l.cents > 0) {
        lines[t] = { itemId: l.itemId, cents: l.cents, since: typeof l.since === "string" ? l.since : "" };
      }
    }
    return { subId: r.subId, interval: r.interval === "YEAR" ? "YEAR" : "MONTH", lines };
  } catch {
    return null;
  }
}

/** The line a shop holds for `trade` on its CURRENT subscription, or null. */
export function webLineHeld(record: WebAddonRecord | null, externalSubId: string | null | undefined, trade: WebTrade): WebAddonLine | null {
  if (!record || !externalSubId || record.subId !== externalSubId) return null;
  return record.lines[trade] ?? null;
}

/** What Stripe's copy of a subscription says the record should be (the webhook's mirror and the add's own write):
 *  one line per trade, each keeping its `since` when it was there before; null when no website line is on it. */
export function recordFromSubscription(
  sub: { id: string; items: ReadonlyArray<{ id: string; price?: { unit_amount?: number | null; recurring?: { interval?: string | null } | null; metadata?: Record<string, string> | null } | null }> },
  prev: WebAddonRecord | null,
  now: string = new Date().toISOString(),
): WebAddonRecord | null {
  const lines: WebAddonRecord["lines"] = {};
  let interval: AddonInterval = prev?.subId === sub.id ? prev.interval : "MONTH";
  for (const item of sub.items) {
    const t = webTradeOfLine(item);
    if (!t) {
      // the plan's own line sets the term
      if (!item.price?.metadata?.jfKind && item.price?.recurring?.interval) interval = item.price.recurring.interval === "year" ? "YEAR" : "MONTH";
      continue;
    }
    if (lines[t]) continue; // two lines for one trade: the first is the record's; the billing side removes the other
    const before = prev?.subId === sub.id ? prev.lines[t] : undefined;
    lines[t] = { itemId: item.id, cents: item.price?.unit_amount ?? webAddonCents(t, interval), since: before?.itemId === item.id && before.since ? before.since : now };
  }
  if (!Object.keys(lines).length) return null;
  return { subId: sub.id, interval, lines };
}

export type WebBillingMode = "preview" | "trial-cardless" | "trial-card" | "card" | "grant" | "free" | "offline";

/** How this shop pays for a website line — from its subscription row, no Stripe call. `onFree` is lib/freePlan's
 *  onFreePlan(row) (an ended trial, a cancelled plan, no row). */
export function webBillingMode(
  row: { status: string; provider: string; externalSubId: string | null } | null,
  opts: { open: boolean; onFree: boolean; stripeEnabled: boolean },
): WebBillingMode {
  if (!opts.open) return "preview";
  if (!row || opts.onFree) return "free";
  if (row.provider === "MANUAL") return "grant";
  const trialing = row.status.toUpperCase() === "TRIALING";
  if (trialing && !row.externalSubId) return "trial-cardless";
  if (!row.externalSubId || row.provider !== "STRIPE" || !opts.stripeEnabled) return "offline";
  return trialing ? "trial-card" : "card";
}

/** A line is put on the subscription in these modes; in the others a trade is on without one, or can't be on. */
export function webModeBills(mode: WebBillingMode): boolean {
  return mode === "card" || mode === "trial-card";
}

/** THE ONE RULE: does this trade answer the public right now? */
export function webTradeServes(opts: { open: boolean; on: boolean; mode: WebBillingMode; held: boolean }): boolean {
  if (!opts.on) return false;
  if (!opts.open) return true; // preview: the admins' rehearsal, nothing billed
  switch (opts.mode) {
    case "grant":
    case "trial-cardless":
      return true;
    case "card":
    case "trial-card":
      return opts.held;
    default:
      return false;
  }
}

const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric" }) : null);

/** What the settings card says under a trade's name about the money, in the shop's words. */
export function webBillingWords(opts: { mode: WebBillingMode; trade: WebTrade; interval: AddonInterval; held: WebAddonLine | null; on: boolean; trialEndsAt: string | null }): string {
  const list = webAddonPriceWords(webAddonCents(opts.trade, opts.interval), opts.interval, true);
  const ends = day(opts.trialEndsAt);
  switch (opts.mode) {
    case "preview":
      return `${list} · preview, not billed`;
    case "grant":
      return "Included in your complimentary plan";
    case "free":
      return `${list} on a paid plan — pick a plan on Subscription first`;
    case "offline":
      return `${list} — your plan isn't billed to a card here; write to us from Help and we'll add it`;
    case "trial-cardless":
      return `Free during your trial${ends ? ` (ends ${ends})` : ""} · ${list} after it, on a paid plan`;
    case "trial-card":
      if (opts.held) return `On your plan · free until your trial ends${ends ? ` ${ends}` : ""}, then ${webAddonPriceWords(opts.held.cents, opts.interval, true)}`;
      return `Free until your trial ends${ends ? ` ${ends}` : ""}, then ${list} on your plan`;
    case "card":
      if (opts.held) return `On your plan · ${webAddonPriceWords(opts.held.cents, opts.interval, true)}${opts.held.since ? ` since ${day(opts.held.since)}` : ""}`;
      return `${list}, added to your plan — the rest of this period is charged today`;
  }
}
