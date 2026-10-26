import "server-only";
// WHERE A PERSON IS IN THE FIRST-ESTIMATE TOUR (2026-10-26). One read for the
// dashboard layout: which path (the estimator the landing sold, lib/firstEstimate),
// the step reached, and whether the tour offers itself. It offers itself only
// to a company created on or after TOUR_SINCE (the deploy) that has made no
// estimate yet; everyone else starts it from "Show me how" on the Overview's
// first-run card. A failed read (no OnboardingProgress table yet) is no tour.

import { db } from "@/lib/db";
import { firstEstimateTarget } from "@/lib/firstEstimate";
import { readCustomPages } from "@/lib/customPageAccess";
import { parseTradeTypes } from "@/lib/tradeTypes";
import { canUseDeckEstimator } from "@/lib/deck/access";
import { roleMayOpen } from "@/lib/orgContext";
import { TOUR_PATHS, isTourPathId, type TourPathId } from "@/lib/onboarding/tour-paths";

/** The deploy: companies created before it are not offered the tour on their own. */
export const TOUR_SINCE = new Date(process.env.ONBOARDING_TOUR_SINCE || "2026-10-26T00:00:00Z");

export type TourStatus = "offer" | "none" | "active" | "paused" | "completed" | "skipped";

export type TourView = {
  path: TourPathId;
  status: TourStatus;
  step: number;
  /** After the first estimate: the three next steps (only the first is live). */
  next: { status: "active" | "skipped"; sent: boolean; draftId: string | null } | null;
};

/** Everything an "estimate" can be here — the Overview's first-run rule. */
export async function estimatesSoFar(organizationId: string): Promise<number> {
  const c = await Promise.all([
    db.proposal.count({ where: { organizationId } }),
    db.aiEstimate.count({ where: { organizationId } }),
    db.roofMeasurement.count({ where: { organizationId } }),
    db.hvacEstimate.count({ where: { organizationId } }),
  ]);
  return c[0] + c[1] + c[2] + c[3];
}

/** The estimator this company came to price. A deck shop gets the Deck Studio
 *  only with the whole studio (trial, add-on, grant, admin); otherwise Smart Proposal. */
export async function tourPathFor(user: { id: string; email?: string | null }, organizationId: string): Promise<TourPathId> {
  const [org, pages] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId }, select: { landingIndustry: true, tradeTypesJson: true } }),
    readCustomPages(organizationId).catch(() => null),
  ]);
  const trades = parseTradeTypes(org?.tradeTypesJson);
  const landing = org?.landingIndustry ?? null;
  const target = firstEstimateTarget(trades, landing, pages);
  if (target.trade === "roofing") return "roof";
  if (target.trade === "fencing") return "fence";
  if (target.trade === "hvac") return "hvac";
  const deckShop = landing === "Decking" || (landing == null && trades.includes("Decking"));
  if (deckShop && (await canUseDeckEstimator(user, organizationId).catch(() => false))) return "deck";
  return target.href === "/dashboard/manual-blueprint" ? "manual" : "smart";
}

export async function tourView(ctx: {
  user: { id: string; email?: string | null };
  organizationId: string;
  role: string;
}): Promise<TourView | null> {
  const { user, organizationId, role } = ctx;
  // Field crews and sales reps never open an estimator.
  if (!roleMayOpen(role, "/dashboard/advanced-ai") && !roleMayOpen(role, "/dashboard/roof-estimator")) return null;
  try {
    const rows = await db.onboardingProgress.findMany({ where: { userId: user.id, organizationId } });
    const first = rows.find((r) => r.tour === "first_estimate");
    const nextRow = rows.find((r) => r.tour === "next_steps");
    const path: TourPathId = first && isTourPathId(first.path) ? first.path : await tourPathFor(user, organizationId);
    const last = TOUR_PATHS[path].steps.length - 1;

    let status: TourStatus;
    if (first && ["active", "paused", "completed", "skipped"].includes(first.status)) {
      status = first.status as TourStatus;
    } else {
      const org = await db.organization.findUnique({ where: { id: organizationId }, select: { createdAt: true } });
      status = org && org.createdAt >= TOUR_SINCE && (await estimatesSoFar(organizationId)) === 0 ? "offer" : "none";
    }

    let next: TourView["next"] = null;
    if (status === "completed" && nextRow?.status !== "skipped") {
      const [sent, draft] = await Promise.all([
        db.proposal.findFirst({ where: { organizationId, sentAt: { not: null } }, select: { id: true } }),
        db.proposal.findFirst({ where: { organizationId, status: "DRAFT" }, orderBy: { createdAt: "desc" }, select: { id: true } }),
      ]);
      next = { status: "active", sent: !!sent, draftId: draft?.id ?? null };
    }
    return { path, status, step: Math.min(Math.max(first?.step ?? 0, 0), last), next };
  } catch {
    return null;
  }
}
