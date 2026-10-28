"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireSalesOrManager } from "@/lib/orgContext";
import { advanceCascade } from "@/lib/leadCenter/cascade";
import { unmatchAndAdvance } from "@/lib/leadCenter/unmatch";
import { acceptOfferTx, afterOfferAccepted } from "@/lib/leadCenter/accept";
import { isPageLocked, requirePage } from "@/lib/customPageAccess";
import { estimateShort } from "@/lib/leadCenter/estimate";
import { readLeadEstimates } from "@/lib/leadCenter/estimateStore";
import { exclusivesOf } from "@/lib/leadCenter/autoPrice";

// Contractor responses to Lead Center offers. Guard parity with claimLead
// (sales + managers). Every terminal transition is a CONDITIONAL updateMany on
// status "OFFERED" so a concurrent accept / expiry sweep / admin manual-assign
// loses cleanly instead of double-materializing the lead.

// Live offers for the active org — powers the app-wide "elite lead routed to
// you" pop-up (polled). Same role gate as accept/decline so only people who can
// act on a lead ever see the prompt.
export async function pendingLeadOffers(): Promise<
  {
    id: string;
    name: string;
    projectType: string | null;
    detectedTrade: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    description: string | null;
    attempt: number;
    expiresAt: string;
    /** The lead's price in cents; null = free. Contacts open on payment. */
    priceCents: number | null;
    /** The range the homeowner priced on /price (2026-10-27): "$14,200–$19,800 · architectural shingle · 21 sq · aerial read"; null when they described instead. */
    estimateShort: string | null;
    /** "Exclusive — nobody else gets this lead" (the Lead Center's box). */
    exclusive: boolean;
  }[]
> {
  const ctx = await requireSalesOrManager();
  // The pop-up asks on every page; a shop that did not buy Leads is simply
  // offered nothing (lib/customPageAccess) rather than answered with an error.
  if (await isPageLocked(ctx.organizationId, "leads")) return [];
  const offers = await db.leadOffer.findMany({
    where: { organizationId: ctx.organizationId, status: "OFFERED", expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    include: {
      platformLead: {
        select: {
          name: true,
          projectType: true,
          detectedTrade: true,
          city: true,
          state: true,
          zip: true,
          description: true,
          scope: true,
        },
      },
    },
  });
  const ids = offers.map((o) => o.platformLeadId);
  const [estimates, exclusives] = await Promise.all([readLeadEstimates(ids), exclusivesOf(ids)]);
  return offers.map((o) => ({
    id: o.id,
    name: o.platformLead.name,
    projectType: o.platformLead.projectType,
    detectedTrade: o.platformLead.detectedTrade,
    city: o.platformLead.city,
    state: o.platformLead.state,
    zip: o.platformLead.zip,
    // The scope written for a contractor when the request carried one — the
    // same text the Leads page shows. No contacts: those open on Accept.
    description: o.platformLead.scope ?? o.platformLead.description,
    attempt: o.attempt,
    expiresAt: o.expiresAt.toISOString(),
    priceCents: o.priceCents && o.priceCents > 0 ? o.priceCents : null,
    estimateShort: (() => {
      const e = estimates.get(o.platformLeadId);
      return e ? estimateShort(e) : null;
    })(),
    exclusive: exclusives.has(o.platformLeadId),
  }));
}

async function loadOwnOffer(offerId: string) {
  const ctx = await requireSalesOrManager();
  await requirePage(ctx.organizationId, "leads");
  const offer = await db.leadOffer.findUnique({
    where: { id: offerId },
    include: { platformLead: true },
  });
  // Cross-org probing gets the same answer as a bad id.
  if (!offer || offer.organizationId !== ctx.organizationId) {
    throw new Error("Offer not found");
  }
  return { ctx, offer };
}

export async function acceptLeadOffer(offerId: string): Promise<{ ok: true; leadId: string }> {
  const { ctx, offer } = await loadOwnOffer(offerId);
  // A priced lead opens only by payment (lib/leadCenter/purchase): the free
  // accept refuses it, whatever a stale card or a hand-made call sends.
  if (offer.priceCents && offer.priceCents > 0 && !offer.unlockedAt) {
    throw new Error("This lead has a price — unlock it to accept.");
  }
  const now = new Date();

  const { leadId, platformLeadId } = await db.$transaction((tx) =>
    acceptOfferTx(tx, { offerId, organizationId: ctx.organizationId, userId: ctx.user.id, now, unlock: false }),
  );
  await afterOfferAccepted({ organizationId: ctx.organizationId, userId: ctx.user.id, leadId, platformLeadId });

  revalidatePath("/dashboard/leads");
  return { ok: true, leadId };
}

export async function declineLeadOffer(offerId: string): Promise<{ ok: true }> {
  const { ctx, offer } = await loadOwnOffer(offerId);

  const res = await db.leadOffer.updateMany({
    where: { id: offerId, status: "OFFERED" },
    data: { status: "DECLINED", respondedAt: new Date(), respondedById: ctx.user.id },
  });
  if (res.count === 0) {
    throw new Error("This offer is no longer available.");
  }

  try {
    await advanceCascade(offer.platformLeadId);
  } catch (err) {
    // The decline stood; the cron sweep's stuck-lead re-drive won't help an
    // OFFERED→(declined) lead, so log loudly for the admin queue to catch.
    console.warn("[lead-offers] cascade advance after decline failed:", err);
  }

  try {
    await db.activityEvent.create({
      data: {
        organizationId: ctx.organizationId,
        actorId: ctx.user.id,
        kind: "DECLINED",
        summary: `Declined platform lead offer: ${offer.platformLead.name}`,
      },
    });
  } catch {
    /* non-fatal */
  }

  revalidatePath("/dashboard/leads");
  return { ok: true };
}

// ── Manually routed leads (legacy) ─────────────────────────────────────────
// Until 2026-10-02 a lead an admin routed by hand never became a LeadOffer: it
// was written straight into the org's Incoming tab as a Lead with status
// ROUTED. Hand-sent leads are offers now (lib/leadCenter/route.ts); these two
// actions remain for the ROUTED rows made before that, so a shop can still
// take or pass on them. The pop-up polls this alongside the live offers.
export async function pendingRoutedLeads(): Promise<
  {
    id: string;
    name: string;
    projectType: string | null;
    detectedTrade: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    description: string | null;
    createdAt: string;
  }[]
> {
  const ctx = await requireSalesOrManager();
  if (await isPageLocked(ctx.organizationId, "leads")) return [];
  const rows = await db.lead.findMany({
    where: { organizationId: ctx.organizationId, source: "LEAD_CENTER", status: "ROUTED" },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      id: true,
      name: true,
      projectType: true,
      aiCategory: true,
      city: true,
      state: true,
      zip: true,
      description: true,
      createdAt: true,
    },
  });
  return rows.map((l) => ({
    id: l.id,
    name: l.name,
    projectType: l.projectType,
    detectedTrade: l.aiCategory,
    city: l.city,
    state: l.state,
    zip: l.zip,
    description: l.description,
    createdAt: l.createdAt.toISOString(),
  }));
}

/**
 * Pass on a lead an admin routed by hand.
 *
 * Marking the org's Lead row LOST is not enough: the PlatformLead still reads
 * MATCHED to that shop, so the Lead Center showed a declined lead as accepted
 * and the homeowner's request quietly stopped moving. A decline has to undo the
 * match AND send the lead onward:
 *
 *   1. the shop's Lead row goes LOST (out of their Incoming tab),
 *   2. the pass is recorded as a DECLINED LeadOffer so no path ever offers the
 *      same shop this lead again (the cascade skips orgs it has already asked),
 *   3. the PlatformLead is un-matched and re-driven — the cascade offers it to
 *      the next-best shop, or, when the platform is routing by hand, it is
 *      offered straight to the next-best shop.
 */
export async function declineRoutedLead(leadId: string): Promise<{ ok: true; rerouted: boolean }> {
  const ctx = await requireSalesOrManager();
  await requirePage(ctx.organizationId, "leads");
  const lead = await db.lead.findUnique({ where: { id: leadId } });
  if (!lead || lead.organizationId !== ctx.organizationId) throw new Error("Lead not found");

  const pl = await db.platformLead.findFirst({ where: { matchedLeadId: leadId } });

  let rerouted = false;
  if (pl) {
    // The shared un-match core (lib/leadCenter/unmatch.ts): records the pass as
    // a DECLINED offer, deletes the shop's Lead row (they never accepted — a
    // row would be a record of nothing), un-matches and re-drives.
    const res = await unmatchAndAdvance(pl.id, {
      offerStatus: "DECLINED",
      respondedById: ctx.user.id,
      leadDisposition: "delete",
      expectedOrgId: ctx.organizationId,
    });
    rerouted = res.rerouted;
  } else {
    // Legacy row with no platform lead behind it — nothing to re-drive; the
    // pass still clears it from the shop's Incoming tab.
    await db.$transaction(async (tx) => {
      await tx.activityEvent.deleteMany({ where: { leadId } });
      await tx.lead.deleteMany({ where: { id: leadId, organizationId: ctx.organizationId } });
    });
  }

  try {
    await db.activityEvent.create({
      data: {
        organizationId: ctx.organizationId,
        actorId: ctx.user.id,
        kind: "DECLINED",
        summary: `Passed on platform lead: ${lead.name}`,
      },
    });
  } catch {
    /* non-fatal */
  }

  revalidatePath("/dashboard/leads");
  revalidatePath("/admin/lead-center");
  return { ok: true, rerouted };
}

