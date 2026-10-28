// THE SUGGESTED PRICE ON AUTOMATIC ROUTING (owner, 2026-10-27: "a switch per trade, off until you turn it on").
// A lead the homeowner priced on /price carries an estimate (lib/leadCenter/estimate) and so a suggested lead price.
// By hand the admin sees the suggestion beside "Lead price, $" and types what they like; on automatic routing the
// cascade charges the suggestion only where this trade's switch is on — off, an unpriced lead goes out free, as it
// always did. "Exclusive" (a box on the lead) doubles the suggestion and is said on the offer card.
// Pure parts first; the SyncState readers and writers after.
import { db } from "@/lib/db";
import { suggestedLeadPriceCents, type LeadEstimate } from "./estimate";

export type PricedTrade = "roof";
export const AUTO_PRICE_KEY = (trade: PricedTrade) => `leadCenter:autoPrice:${trade}`;
export const EXCLUSIVE_KEY = (leadId: string) => `leadexclusive:${leadId}`;

/** The price an offer goes out at: the admin's own always; else the suggestion when the switch is on; else none. */
export function offerPriceFor(a: { priceCents: number | null; estimate: LeadEstimate | null; exclusive: boolean; autoOn: boolean }): number | null {
  if (a.priceCents && a.priceCents > 0) return a.priceCents;
  if (!a.estimate || !a.autoOn) return null;
  return suggestedLeadPriceCents(a.estimate, a.exclusive);
}

export async function autoPriceOn(trade: PricedTrade): Promise<boolean> {
  try {
    const row = await db.syncState.findUnique({ where: { key: AUTO_PRICE_KEY(trade) } });
    return row?.cursor === "on";
  } catch {
    return false;
  }
}

export async function setAutoPrice(trade: PricedTrade, on: boolean): Promise<void> {
  const key = AUTO_PRICE_KEY(trade);
  const cursor = on ? "on" : "off";
  await db.syncState.upsert({ where: { key }, update: { cursor }, create: { key, cursor } });
}

export async function exclusiveOf(leadId: string): Promise<boolean> {
  try {
    const row = await db.syncState.findUnique({ where: { key: EXCLUSIVE_KEY(leadId) } });
    return row?.cursor === "1";
  } catch {
    return false;
  }
}

/** Which of these leads are exclusive — one query. */
export async function exclusivesOf(leadIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (!leadIds.length) return out;
  try {
    const rows = await db.syncState.findMany({ where: { key: { in: leadIds.map(EXCLUSIVE_KEY) }, cursor: "1" } });
    for (const r of rows) out.add(r.key.slice("leadexclusive:".length));
  } catch {
    /* none known */
  }
  return out;
}

export async function setExclusive(leadId: string, on: boolean): Promise<void> {
  const key = EXCLUSIVE_KEY(leadId);
  await db.syncState.upsert({ where: { key }, update: { cursor: on ? "1" : "0" }, create: { key, cursor: on ? "1" : "0" } });
}
