"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePlatformAdmin } from "@/lib/orgContext";
import { startCascade } from "@/lib/leadCenter/cascade";
import { offerPlatformLeadToOrg } from "@/lib/leadCenter/route";
import { buildRanking } from "@/lib/leadCenter/matching";
import { getRoutingMode, setRoutingMode, type RoutingMode } from "@/lib/leadCenter/routingMode";
import { isPricedTrade, setAutoPrice, setExclusive, type PricedTrade } from "@/lib/leadCenter/autoPrice";
import { setHouseOrgId } from "@/lib/publicEstimate/store";
import { adminRefund, dollars, MAX_LEAD_PRICE_CENTS, MIN_LEAD_PRICE_CENTS } from "@/lib/leadCenter/purchase";
import { rotateTestKey } from "@/lib/leadCenter/testLeads";
import { createHomeownerLead } from "@/lib/leadCenter/intake";
import { appBaseUrl } from "@/lib/appUrl";
import { z } from "zod";

// Platform-admin Lead Center controls. Manual assignment is the escape hatch
// for MANUAL_QUEUE leads (and can override a pending offer: cancelling it
// inside the transaction makes the contractor's later accept fail its
// conditional update with "no longer available").
//
// Since 2026-10-02 a hand-picked shop gets an OFFER — city and scope, Accept /
// Pass, 24 hours — not the lead itself: the homeowner's contacts open, and the
// homeowner hears "you're matched", only when the shop accepts. See
// lib/leadCenter/route.ts.

export async function manualAssignPlatformLead(
  platformLeadId: string,
  organizationId: string,
): Promise<{ ok: true; offerId: string }> {
  const admin = await requirePlatformAdmin();
  // The write itself lives in lib/leadCenter/route so manual mode's re-route
  // after a match falls through does exactly the same thing.
  const { offerId } = await offerPlatformLeadToOrg(platformLeadId, organizationId, admin.id);
  revalidatePath("/admin/lead-center");
  return { ok: true, offerId };
}

// Send a MANUAL_QUEUE lead back through the cascade — useful once new shops
// sign up or an existing one completes its profile. Attempts reset, but orgs
// that already received an offer are never offered the same lead twice
// (LeadOffer's unique constraint / the cascade's already-offered skip).
export async function requeuePlatformLead(platformLeadId: string): Promise<{ ok: true }> {
  await requirePlatformAdmin();
  const pl = await db.platformLead.findUnique({ where: { id: platformLeadId }, select: { isTest: true } });
  if (pl?.isTest) throw new Error("A test lead never goes to the cascade — send it to an internal organization.");
  if ((await getRoutingMode()) === "MANUAL") throw new Error("Manual mode — the cascade is off. Send the lead by hand.");

  const res = await db.platformLead.updateMany({
    where: { id: platformLeadId, status: "MANUAL_QUEUE" },
    // assignedByAdminId cleared: the admin handed this lead to the cascade, so
    // a pass now moves it on instead of returning it (cascade.ts RETURNED).
    data: { status: "MATCHING", queueReason: null, attemptCount: 0, assignedByAdminId: null },
  });
  if (res.count === 0) throw new Error("Only leads in the manual queue can be requeued.");

  try {
    await startCascade(platformLeadId);
  } catch (err) {
    console.warn("[admin-lead-center] requeue cascade failed — cron will re-drive:", err);
  }

  revalidatePath("/admin/lead-center");
  return { ok: true };
}

// ── Routing mode ───────────────────────────────────────────────────────────
// AUTO (the cascade offers each new request to the best shop) or MANUAL (every
// request waits in the queue for an admin). See lib/leadCenter/routingMode.

export async function readLeadRoutingMode(): Promise<RoutingMode> {
  await requirePlatformAdmin();
  return getRoutingMode();
}

/** "Charge the suggested price on automatic routing", per trade (lib/leadCenter/autoPrice). */
export async function setLeadAutoPrice(trade: PricedTrade, on: boolean): Promise<{ ok: true }> {
  await requirePlatformAdmin();
  if (!isPricedTrade(trade)) throw new Error("Unknown trade");
  await setAutoPrice(trade, on === true);
  revalidatePath("/admin/lead-center");
  return { ok: true };
}

/** THE HOUSE ORG (2026-10-28): the internal organization the house estimators run as (the homeowner portal's
 *  /homeowner/price/<trade>, lib/webEstimator houseShop) — its price books, its spend, its counters. One of JobFlex's
 *  own only; null closes the house pages and the portal prices the roof alone. */
export async function setHouseOrg(organizationId: string | null): Promise<{ ok: true }> {
  await requirePlatformAdmin();
  if (organizationId === null || organizationId === "") {
    await setHouseOrgId(null);
  } else {
    if (typeof organizationId !== "string" || organizationId.length > 64) throw new Error("Bad organization");
    const org = await db.organization.findUnique({ where: { id: organizationId }, select: { id: true, deletedAt: true, isInternal: true } });
    if (!org || org.deletedAt || !org.isInternal) throw new Error("Pick one of JobFlex's own organizations");
    await setHouseOrgId(org.id);
  }
  revalidatePath("/admin/lead-center");
  revalidatePath("/homeowner");
  return { ok: true };
}

/** "Exclusive — nobody else gets this lead": doubles the suggestion, said on the offer card. */
export async function setLeadExclusive(platformLeadId: string, on: boolean): Promise<{ ok: true }> {
  await requirePlatformAdmin();
  if (typeof platformLeadId !== "string" || !platformLeadId || platformLeadId.length > 64) throw new Error("Bad lead");
  await setExclusive(platformLeadId, on === true);
  revalidatePath("/admin/lead-center");
  return { ok: true };
}

export async function setLeadRoutingMode(mode: RoutingMode): Promise<{ ok: true }> {
  await requirePlatformAdmin();
  if (mode !== "AUTO" && mode !== "MANUAL") throw new Error("Unknown routing mode");
  await setRoutingMode(mode);
  revalidatePath("/admin/lead-center");
  return { ok: true };
}

/**
 * Route every waiting lead to its best-scoring shop, in one pass.
 *
 * The manual-mode counterpart of the cascade: same ranking, same write as
 * `manualAssignPlatformLead`, but the admin approves the whole batch instead of
 * clicking through it. Leads with no eligible shop are left where they are and
 * counted — routing one of those would mean inventing a match.
 */
export async function routeAllWaitingLeads(): Promise<{
  ok: true;
  routed: number;
  skipped: number;
}> {
  await requirePlatformAdmin();
  if ((await getRoutingMode()) === "MANUAL") throw new Error("Manual mode — send each lead by hand.");

  const waiting = await db.platformLead.findMany({
    // Test leads are placed by hand, with internal organizations only.
    where: { status: { in: ["MANUAL_QUEUE", "MATCHING"] }, isTest: false },
    orderBy: { createdAt: "asc" },
    take: 100,
  });

  let routed = 0;
  let skipped = 0;
  for (const pl of waiting) {
    const ranking = await buildRanking(pl).catch(() => []);
    const top = ranking[0];
    if (!top) {
      skipped += 1;
      continue;
    }
    try {
      await manualAssignPlatformLead(pl.id, top.orgId);
      routed += 1;
    } catch {
      // Someone accepted it mid-pass, or the shop vanished — either way it is
      // not this batch's lead any more.
      skipped += 1;
    }
  }

  revalidatePath("/admin/lead-center");
  return { ok: true, routed, skipped };
}

// ── Lead price (2026-10-02) ────────────────────────────────────────────────
// Optional: a lead with no price is free exactly as before. A price is the
// lead's — every offer of it carries the same one, the open offer included —
// and it can change until a shop has accepted (paid for) the lead.

export async function setPlatformLeadPrice(
  platformLeadId: string,
  priceCents: number | null,
): Promise<{ ok: true; priceCents: number | null }> {
  await requirePlatformAdmin();
  if (priceCents != null) {
    if (!Number.isInteger(priceCents) || priceCents < MIN_LEAD_PRICE_CENTS || priceCents > MAX_LEAD_PRICE_CENTS) {
      throw new Error(`A lead price is ${dollars(MIN_LEAD_PRICE_CENTS)} to ${dollars(MAX_LEAD_PRICE_CENTS)}, or empty for a free lead.`);
    }
  }
  const price = priceCents && priceCents > 0 ? priceCents : null;
  await db.$transaction(async (tx) => {
    const pl = await tx.platformLead.findUnique({ where: { id: platformLeadId }, select: { status: true } });
    if (!pl) throw new Error("Lead not found");
    if (pl.status === "MATCHED") throw new Error("A shop has already accepted this lead — its price can no longer change.");
    await tx.platformLead.update({ where: { id: platformLeadId }, data: { priceCents: price } });
    // The open offer (not yet paid) takes the new price; the shop's card shows
    // it on its next read, and an Accept already under way pays what it was shown.
    await tx.leadOffer.updateMany({
      where: { platformLeadId, status: "OFFERED", unlockedAt: null },
      data: { priceCents: price },
    });
  });
  revalidatePath("/admin/lead-center");
  return { ok: true, priceCents: price };
}

/** Refund a paid lead — platform admin only, with a reason (lib/leadCenter/purchase). */
export async function refundLeadPurchase(offerId: string, reason: string): Promise<{ ok: true }> {
  const admin = await requirePlatformAdmin();
  const why = reason.trim();
  if (why.length < 3) throw new Error("Write the reason for the refund.");
  await adminRefund(offerId, why.slice(0, 400), { id: admin.id, email: admin.email });
  revalidatePath("/admin/lead-center");
  return { ok: true };
}

// ── Test leads (2026-10-03) ────────────────────────────────────────────────
// lib/leadCenter/testLeads has the rule. Everything here is platform-admin only.

/** "Internal organization" on a shop: the only kind a test lead can be sent to. */
export async function setOrganizationInternal(organizationId: string, isInternal: boolean): Promise<{ ok: true }> {
  await requirePlatformAdmin();
  await db.organization.update({ where: { id: organizationId }, data: { isInternal } });
  revalidatePath("/admin/lead-center");
  return { ok: true };
}

/** Create the test link, or replace its key — the old link stops working at once. */
export async function rotateLeadTestKey(): Promise<{ ok: true; createdAt: string; link: string }> {
  await requirePlatformAdmin();
  const next = await rotateTestKey();
  revalidatePath("/admin/lead-center");
  return { ok: true, createdAt: next.createdAt, link: `${await appBaseUrl()}/homeowner?test=${next.key}` };
}

const testLeadInput = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(200),
  zip: z.string().trim().regex(/^\d{5}$/, "A 5-digit ZIP"),
  description: z.string().trim().min(10).max(4000),
});

/** "Create test lead" — the homeowner intake itself, marked test, no wizard. */
export async function createTestLead(raw: unknown): Promise<{ ok: true; platformLeadId: string; statusPath: string }> {
  await requirePlatformAdmin();
  const data = testLeadInput.parse(raw);
  const res = await createHomeownerLead(data, { isTest: true });
  revalidatePath("/admin/lead-center");
  return { ok: true, platformLeadId: res.platformLeadId, statusPath: res.statusPath };
}
