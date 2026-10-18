// Server-only plan-catalog fetchers (imports Prisma — never import from client
// components; the client-safe DTO + helpers live in planCatalog.ts).
//
// PricingPlan rows are the single source of truth for every plan surface.
// Matching against Subscription.plan is case-insensitive in JS because stored
// plan values are uppercase ("STARTER") while slugs are lowercase, and SQLite
// has no case-insensitive query mode (same rationale as limitsEngine.ts).

import { planLapsed } from "@/lib/planStatus";
import { readAccessSubscription } from "@/lib/subscriptionAccess";
import { hasFullAccess } from "@/lib/fullAccess";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { PLAN_TIERS, type Plan } from "@/lib/entitlements";
import { parsePlanLimits } from "@/lib/planLimits";
import { planDisplayName, type PlanDTO } from "@/lib/planCatalog";
import { CUSTOM_PLAN_TIER } from "@/lib/customPlan";
import { featureLineForSale, planComingSoon } from "@/lib/editions";

/** Canonical parser for the PricingPlan.features JSON column. */
export function parseFeatures(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

type PricingPlanRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  priceCents: number;
  yearlyPriceCents: number | null;
  trialDays: number;
  order: number;
  features: string;
  limitsJson: string | null;
  active: boolean;
  highlight: boolean;
};

function toPlanDTO(row: PricingPlanRow): PlanDTO {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    priceCents: row.priceCents,
    yearlyPriceCents: row.yearlyPriceCents,
    trialDays: row.trialDays,
    order: row.order,
    features: parseFeatures(row.features),
    limits: parsePlanLimits(row.limitsJson),
    active: row.active,
    highlight: row.highlight,
    isFree: row.priceCents === 0,
  };
}

/** All plans, display-ordered. Inactive plans are hidden unless asked for. */
export async function getPlanCatalog(opts?: { includeInactive?: boolean }): Promise<PlanDTO[]> {
  const rows = await db.pricingPlan.findMany({
    where: opts?.includeInactive ? {} : { active: true },
    orderBy: { order: "asc" },
  });
  const plans = rows.map(toPlanDTO);
  if (opts?.includeInactive) return plans;
  // ON SALE ONLY: a coming-soon edition's own plan is not sold, and a feature
  // line naming it says so (lib/editions EDITION_OPEN, owner 2026-10-11). The
  // landing, /pricing, the sign-up, the upgrade and subscription pages and the
  // sign-up's checkout all read this list.
  return plans.filter((p) => !planComingSoon(p.slug)).map((p) => ({ ...p, features: p.features.map((f) => featureLineForSale(f)) }));
}

/** Case-insensitive slug lookup (accepts "starter", "STARTER", …). */
export async function getPlanBySlug(
  slug: string,
  opts?: { includeInactive?: boolean },
): Promise<PlanDTO | null> {
  const s = slug.trim();
  if (!s) return null;
  const row = await db.pricingPlan.findFirst({
    where: {
      slug: { in: [s, s.toLowerCase(), s.toUpperCase()] },
      ...(opts?.includeInactive ? {} : { active: true }),
    },
  });
  // A coming-soon edition's plan is not on sale (lib/editions); the
  // includeInactive lookups — an account's own plan, the admin — still find it.
  if (row && !opts?.includeInactive && planComingSoon(row.slug)) return null;
  return row ? toPlanDTO(row) : null;
}

/**
 * { FREE: 0, STARTER: 2900, ... } built from ALL rows (including inactive —
 * grandfathered subscribers still count toward MRR at their plan's list price).
 */
export async function getMonthlyCentsBySlugUpper(): Promise<Record<string, number>> {
  const rows = await db.pricingPlan.findMany({ select: { slug: true, priceCents: true } });
  return Object.fromEntries(rows.map((r) => [r.slug.toUpperCase(), r.priceCents]));
}

/** Lowercase slug → catalog name, every plan (archived ones included: an org
 *  on a retired plan is still shown by its name). */
export async function getPlanNamesBySlug(): Promise<Record<string, string>> {
  const rows = await db.pricingPlan.findMany({ select: { slug: true, name: true } });
  return Object.fromEntries(rows.map((r) => [r.slug.toLowerCase(), r.name]));
}

/** The name people see for a stored plan slug (any casing). */
export async function getPlanDisplayName(slug: string | null | undefined): Promise<string> {
  return planDisplayName(slug, await getPlanNamesBySlug());
}

/**
 * Purge every surface that renders plan data. Lives here (not in a "use server"
 * file) because action modules may only export async functions — and every such
 * export becomes a public RPC endpoint. Called by the plan admin actions.
 */
export function revalidatePlanSurfaces(): void {
  for (const p of [
    "/admin/plans",
    "/pricing",
    "/dashboard/subscription",
    "/dashboard/subscription-blueprint",
    "/dashboard/settings/account",
    "/v3/company/subscription",
  ]) {
    revalidatePath(p);
  }
}

/**
 * Resolve an org's plan for display + gating in one call.
 * - `tier`: boolean-feature tier — built-in slug → itself; custom slug that still
 *   exists in the catalog → ENTERPRISE (full features; quotas come from the plan's
 *   own limits); anything else → FREE. A lapsed plan (lib/planStatus) is FREE
 *   whatever its slug. Mirrors orgPlan.getOrgPlanById.
 * - `plan`: the catalog DTO, matched INCLUDING inactive plans on purpose —
 *   grandfathered subscribers keep seeing (and using) a deactivated plan.
 * - `rawPlan`: Subscription.plan exactly as stored (e.g. "STARTER").
 */
export async function getOrgPlanContext(organizationId: string): Promise<{
  tier: Plan;
  plan: PlanDTO | null;
  rawPlan: string;
}> {
  const [sub, full] = await Promise.all([readAccessSubscription(organizationId), hasFullAccess(organizationId)]);
  // No subscription row → nothing to display as a plan (the Free tier is no
  // longer presented; the limits engine still enforces the internal cap-floor
  // row on its own). Tier stays FREE — the boolean-feature floor is unchanged.
  // A platform admin in the org has the top tier whatever the row says
  // (lib/fullAccess, owner 2026-10-17).
  if (!sub?.plan) return { tier: full ? "ENTERPRISE" : "FREE", plan: null, rawPlan: "NONE" };
  const rawPlan = sub.plan;
  const plan = await getPlanBySlug(rawPlan, { includeInactive: true });
  const upper = rawPlan.toUpperCase();
  const tier: Plan = full
    ? "ENTERPRISE"
    : planLapsed(sub)
    ? "FREE"
    : (PLAN_TIERS as readonly string[]).includes(upper)
    ? (upper as Plan)
    : upper === "CUSTOM"
      ? CUSTOM_PLAN_TIER
      : plan
      ? "ENTERPRISE"
      : "FREE";
  return { tier, plan, rawPlan };
}
