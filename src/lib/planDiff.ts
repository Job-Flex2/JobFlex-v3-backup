// WHAT CHANGES BETWEEN TWO PLANS — one answer for every surface that has to
// say it: the confirmation dialog lists what opens on an upgrade and what
// closes on a downgrade. Computed from the catalog
// rows themselves — the features an admin typed on /admin/plans — never from
// copy written into a component, so a plan edited in the console changes what
// the dialog promises the same day.
//
// "Everything in <plan>" rolls up the way lib/planCatalog.expandPlanFeatures
// rolls it up, so Enterprise reads as including Starter's basics and the diff
// against Starter is only what Enterprise actually adds.
//
// NOTHING OPENS OR CLOSES BETWEEN TWO CATALOG PLANS (owner, 2026-10-26 —
// audit §7). The feature lines are display; access is the gates', and every
// catalog plan opens every page and estimator (lib/customPageAccess). Only
// Deck Studio (an add-on, lib/editions hasEdition — untouched by a plan
// change) and a Custom plan's unbought pages are ever "Not in this plan", so
// a change between catalog plans lists no lock and no new line. From no plan
// (or the Custom plan, which has no catalog row) the target's lines open.

import { expandPlanFeatures } from "@/lib/planCatalog";

/** The slice of a plan the diff needs; UpgradePlan and SignupPlan both fit. */
export interface PlanLike {
  slug: string;
  name: string;
  priceCents: number;
  features: string[];
}

export interface PlanDiff {
  /** Feature lines the target has and the source does not, catalog order. */
  opens: string[];
  /** Feature lines the source has and the target does not. */
  closes: string[];
}

const has = (set: Set<string> | undefined, label: string) => Boolean(set?.has(label.toLowerCase()));

/**
 * The difference between `fromSlug` and `toSlug` across the ordered catalog.
 * A null `fromSlug` (no plan yet, or the Custom plan, which has no catalog
 * row) reads as "nothing yet": every feature of the target opens.
 */
export function planDiff(plans: PlanLike[], fromSlug: string | null, toSlug: string): PlanDiff {
  const from = fromSlug ? (plans.find((p) => p.slug === fromSlug) ?? null) : null;
  const to = plans.find((p) => p.slug === toSlug) ?? null;
  if (from && to) return { opens: [], closes: [] };
  const { rows, included } = expandPlanFeatures(plans);
  const toSet = to ? included.get(to.slug) : undefined;
  return { opens: rows.filter((r) => has(toSet, r)), closes: [] };
}

/** "$79" — whole dollars, the way every plan surface prints a price. */
export const dollars = (cents: number) => `$${Math.round(cents / 100)}`;
