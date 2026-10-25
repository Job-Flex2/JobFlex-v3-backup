import "server-only";
// THE HOMEOWNER SIDE ON THE PITCH DECK (owner, 2026-10-25: "the homeowners' portal — homeowners submit the projects and
// we charge for the leads"). Counted from the Lead Center's own rows with the test leads left out, the way the Lead
// Center and the office screen count them; the money is the paid-lead records (lib/leadCenter/purchase) — live Stripe
// only, completed, refunds taken off, accounts hidden from the stats left out. null = the rows could not be read.
import { db } from "@/lib/db";
import { statsHiddenIds } from "@/lib/statsHidden";
import type { LeadPurchase } from "@/lib/leadCenter/purchase";

export interface LeadMarket {
  /** Homeowner requests ever, the day of the first, and the last 30 days. */
  requests: number;
  since: string | null;
  last30: number;
  /** Offers sent to shops, offers a shop accepted, requests that reached a shop. */
  offered: number;
  accepted: number;
  matched: number;
  /** Leads a shop paid for on Accept, and what came in. */
  paid: { count: number; cents: number };
  /** The trades asked for most, most first. */
  trades: Array<{ trade: string; count: number }>;
}

const DAY_MS = 86_400_000;

export async function readLeadMarket(): Promise<LeadMarket | null> {
  try {
    const real = { isTest: false };
    const [requests, first, last30, offered, accepted, matched, purchaseRows, byTrade, hidden] = await Promise.all([
      db.platformLead.count({ where: real }),
      db.platformLead.findFirst({ where: real, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
      db.platformLead.count({ where: { ...real, createdAt: { gte: new Date(Date.now() - 30 * DAY_MS) } } }),
      db.leadOffer.count({ where: { platformLead: real } }),
      db.leadOffer.count({ where: { status: "ACCEPTED", platformLead: real } }),
      db.platformLead.count({ where: { ...real, status: "MATCHED" } }),
      db.syncState.findMany({ where: { key: { startsWith: "leadPurchase:" } }, select: { cursor: true } }),
      db.platformLead.groupBy({ by: ["detectedTrade"], where: real, _count: { _all: true } }),
      statsHiddenIds(),
    ]);

    const hiddenOrgs = new Set(hidden);
    const purchases: LeadPurchase[] = [];
    for (const r of purchaseRows) {
      try {
        const p = JSON.parse(r.cursor ?? "") as LeadPurchase;
        if (p && p.mode === "live" && p.leadId && typeof p.amountCents === "number" && !hiddenOrgs.has(p.organizationId)) purchases.push(p);
      } catch {
        // a record that does not parse is not a payment
      }
    }
    const testLeads = purchases.length
      ? new Set((await db.platformLead.findMany({ where: { id: { in: purchases.map((p) => p.platformLeadId) }, isTest: true }, select: { id: true } })).map((x) => x.id))
      : new Set<string>();
    const kept = purchases.filter((p) => !testLeads.has(p.platformLeadId));
    const cents = kept.reduce((sum, p) => sum + p.amountCents - (p.refund?.amountCents ?? 0), 0);

    return {
      requests,
      since: first ? first.createdAt.toISOString().slice(0, 10) : null,
      last30,
      offered,
      accepted,
      matched,
      paid: { count: kept.filter((p) => !p.refund || p.refund.amountCents < p.amountCents).length, cents },
      trades: byTrade
        .filter((t) => t.detectedTrade && t.detectedTrade !== "Other")
        .map((t) => ({ trade: t.detectedTrade as string, count: t._count._all }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 6),
    };
  } catch (err) {
    console.warn("[investorLeads] not read:", err instanceof Error ? err.message : err);
    return null;
  }
}
