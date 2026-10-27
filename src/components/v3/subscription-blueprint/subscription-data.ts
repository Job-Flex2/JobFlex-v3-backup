// SUBSCRIPTION — BLUEPRINT · usage page mapping and legacy fixtures.
// Route: /dashboard/subscription (promoted 2026-08-12; ported at
// /dashboard/subscription-blueprint, which no longer exists).
//
// From the "ДАННЫЕ СТРАНИЦЫ" (page data) block of the approved mockup,
// jobflex-subscription-blueprint (8).html — with one owner-directed revision
// (2026-08-17): the Free tier is removed from the product, so the fixture org
// is on Professional. The plan list, the feature-matrix indexes, the usage
// caps and the invoice amounts were re-authored for that story; everything
// else ships as the mockup wrote it.
//
// The live loader uses USAGE_ACCESS_PAGES below to ask the existing page gate
// which quota resources are accessible. The historical fixtures that follow
// remain unused by the live subscription components.
//
// There is no data layer here: no server action, no API
// route, no Prisma query and — deliberately, on a billing surface — no Stripe
// call. Written while this layout was under review at the staging route; the
// rationale stands after promotion, because a mock that silently talked to the
// real billing system would be the worst possible way to find out it was still
// a mock. Live wiring is a separate, not-yet-assigned task.

import type { CustomPageId } from "@/lib/customPlan";
import type { LimitKey } from "@/lib/planLimits";
import type { TrialCapKey } from "@/lib/trialCaps";

/** Only add-on meters need a page entitlement. Base workspace and office
 * seats are always available; arrays follow requirePage's any-of rule. */
export const USAGE_ACCESS_PAGES: Partial<Record<LimitKey, readonly CustomPageId[]>> = {
  calendarCards: ["calendar"],
  calendarEvents: ["calendar"],
  workers: ["workers"],
  leads: ["leads"],
  aiPhoneCalls: ["phone"],
  deskMinutes: ["phone"],
  hvacEstimates: ["hvac-estimator"],
  roofMeasurements: ["roof-estimator"],
  manualJReports: ["hvac-estimator"],
  estimatorUses: ["smart-proposal", "roof-estimator", "fence-estimator", "hvac-estimator", "video-estimator", "deck-estimator"],
};

export const TRIAL_USAGE_ACCESS_PAGES: Partial<Record<TrialCapKey, readonly CustomPageId[]>> = {
  roofMeasurements: ["roof-estimator"],
  eagleViewOrders: ["roof-estimator"],
  fenceLookups: ["fence-estimator"],
  hvacLookups: ["hvac-estimator"],
  hvacReports: ["hvac-estimator"],
};

export type Plan = {
  slug: string;
  name: string;
  /** Monthly price in whole dollars; `null` renders as "Custom". */
  mo: number | null;
  /** The org's current plan — tints its column and swaps the CTA for a label. */
  cur: boolean;
  cta: string | null;
  /** Primary (filled) CTA rather than ghost. */
  hot?: boolean;
};

export const PLANS: Plan[] = [
  { slug: "professional", name: "Professional", mo: 79, cur: true, cta: null },
  { slug: "advanced", name: "Advanced", mo: 179, cur: false, cta: "Upgrade", hot: true },
  { slug: "custom", name: "Build your plan", mo: null, cur: false, cta: "Get started", hot: false },
  { slug: "enterprise", name: "Enterprise", mo: 199, cur: false, cta: "Contact sales", hot: false },
];

export type UsageRow = { label: string; used: number; limit: number };

// Professional-tier caps. Proposals are unlimited on Professional (see
// FEATURES), so the metered rows are the remaining quotas only.
export const USAGE: UsageRow[] = [
  { label: "Smart estimates", used: 18, limit: 50 },
  { label: "Leads captured", used: 112, limit: 500 },
  { label: "Jobs", used: 23, limit: 100 },
  { label: "Messages sent", used: 412, limit: 1000 },
  { label: "Review requests", used: 14, limit: 50 },
];

export type Invoice = { no: string; date: string; status: string; amt: string };

export const INVOICES: Invoice[] = [
  { no: "JF-2026-0043", date: "Jul 1, 2026", status: "Paid", amt: "$79.00" },
  { no: "JF-2026-0042", date: "Jun 1, 2026", status: "Paid", amt: "$79.00" },
  { no: "JF-2026-0041", date: "May 1, 2026", status: "Paid", amt: "$79.00" },
  { no: "JF-2026-0040", date: "Apr 1, 2026", status: "Paid", amt: "$79.00" },
];

/**
 * [feature, firstIncludedTierIndex] — the number is the index into PLANS at
 * which the feature turns on, so 0 = "Professional and up", 1 = "Advanced and
 * up", 3 = "Enterprise only". The "Build your plan" column (index 2) is drawn
 * as an optional dashed box regardless, by slug.
 */
export const FEATURES: Array<[string, number]> = [
  ["Unlimited proposals", 0],
  ["Smart Proposal drafts", 0],
  ["Smart estimating · roof & fence", 0],
  ["Proposal templates", 0],
  ["Branded PDF export", 0],
  ["Follow-up automation", 0],
  ["SMS notifications", 0],
  ["CSV report exports", 0],
  ["Multiple organizations", 1],
  ["Custom domain", 1],
  ["White-label client portal", 3],
];
