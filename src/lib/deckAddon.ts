// THE DECK STUDIO ADD-ON (owner, 2026-10-19: "if existing users didn't purchase Deck Studio, they can't use it. Only
// preview it. And option to add it to the plan." — then: preview = design without saving, $49/month added to the
// plan, the whole studio during the free trial; owner-locked 2026-10-20 in CLAUDE.md: no plan carries it, the trial
// adds nothing to Stripe). Pure: the price, the Stripe line's kind, what a stored record says.
//
// The add-on is a SECOND LINE on the subscription the shop already has (lib/deckAddonBilling), never a plan of its
// own and never a second subscription: one bill, one card, one cancel. A yearly plan carries the yearly line — ten
// months' price for twelve, the custom plan's rule (lib/customPlan CUSTOM_YEAR_MULTIPLIER).

import { CUSTOM_YEAR_MULTIPLIER } from "@/lib/customPlan";

/** $49 a month. */
export const DECK_ADDON_CENTS = 4900;
/** The Stripe price's `jfKind` (lib/stripePriceCache) — how the line is told from the plan's own. */
export const DECK_ADDON_KIND = "deck-addon";
export const DECK_ADDON_NAME = "JobFlex Deck Studio add-on";

export type AddonInterval = "MONTH" | "YEAR";

/** What the line costs per term. */
export function deckAddonCents(interval: AddonInterval = "MONTH"): number {
  return interval === "YEAR" ? DECK_ADDON_CENTS * CUSTOM_YEAR_MULTIPLIER : DECK_ADDON_CENTS;
}

/** "$49/month" · "$490/year". */
export function deckAddonPriceWords(interval: AddonInterval = "MONTH"): string {
  return `$${Math.round(deckAddonCents(interval) / 100)}/${interval === "YEAR" ? "year" : "month"}`;
}

/** "$49/mo" · "$490/yr" — on a button. */
export function deckAddonShortWords(interval: AddonInterval = "MONTH"): string {
  return `$${Math.round(deckAddonCents(interval) / 100)}/${interval === "YEAR" ? "yr" : "mo"}`;
}

/** What the trial says wherever the add-on is offered (owner, 2026-10-20): the trial holds the studio, and adding
 *  the add-on during it puts nothing on the subscription. */
export function deckTrialWords(interval: AddonInterval = "MONTH"): string {
  return `Included in your trial. After the trial, Deck Studio is a ${deckAddonShortWords(interval)} add-on.`;
}

/** A Stripe line (or anything with its price's metadata) that is the add-on. */
export function isDeckAddonLine(item: { price?: { metadata?: Record<string, string> | null } | null } | null | undefined): boolean {
  return item?.price?.metadata?.jfKind === DECK_ADDON_KIND;
}

/** The plan's own lines — every line but the add-on. A subscription's plan is read off these, never the add-on. */
export function planLines<T extends { price?: { metadata?: Record<string, string> | null } | null }>(items: readonly T[]): T[] {
  return items.filter((i) => !isDeckAddonLine(i));
}

/** The plan's line: the first that is not the add-on (the first line as it was, when the add-on is all there is). */
export function planLine<T extends { price?: { metadata?: Record<string, string> | null } | null }>(items: readonly T[]): T | undefined {
  return planLines(items)[0] ?? items[0];
}

/** What we keep per organization (SyncState `deckAddon:<orgId>`): the subscription and the line that carry it. */
export interface DeckAddonRecord {
  subId: string;
  itemId: string;
  interval: AddonInterval;
  /** When it was added (ISO). */
  since: string;
}

export function parseDeckAddonRecord(raw: string | null | undefined): DeckAddonRecord | null {
  if (!raw) return null;
  try {
    const r = JSON.parse(raw) as Partial<DeckAddonRecord>;
    if (typeof r.subId !== "string" || !r.subId || typeof r.itemId !== "string" || !r.itemId) return null;
    return { subId: r.subId, itemId: r.itemId, interval: r.interval === "YEAR" ? "YEAR" : "MONTH", since: typeof r.since === "string" ? r.since : "" };
  } catch {
    return null;
  }
}

/** The record opens the studio only on the subscription it was bought on: a plan bought again through a new
 *  Checkout (a new subscription) does not carry the old line, so it does not carry the add-on either. */
export function addonHeld(record: DeckAddonRecord | null, externalSubId: string | null | undefined): boolean {
  return !!record && !!externalSubId && record.subId === externalSubId;
}
