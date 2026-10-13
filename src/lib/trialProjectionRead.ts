import "server-only";
// The rows behind the trial projection (2026-10-05) — what each account in the
// signups list is worth per month and, for a trial, how likely it is to pay.
// The rules are in lib/trialProjection (pure); this only reads:
//
//   · the price: the plan a card-less trial is on now (lib/trialPlan — the
//     subscription's plan and interval, a custom plan's pages), else the
//     Stripe price the subscription carries (PlanPrice), else a custom plan's
//     pages (`orgPages:<orgId>`), else the catalog's list price for the plan;
//   · the card: the card-less record's cardAt, or a Stripe subscription with
//     no card-less record (a trial started under the card-first signup);
//   · the work: proposals, clients, jobs and leads made, and the screens and
//     days of the trial watch's page views;
//   · the shop's record: every card-less trial that has finished.
//
// Every read stands alone and fails quietly: a missing table (PageView is
// pushed to Neon by hand) costs that signal, never the list.
import { db } from "@/lib/db";
import { CUSTOM_PLAN_SLUG, customPriceCents, normalizeCustomPages } from "@/lib/customPlan";
import { cardlessKey, type CardlessRecord } from "@/lib/trialState";
import { currentTrialPlan, type TrialPlanChoice } from "@/lib/trialPlan";
import { calibrate, monthlyCents, projectTrials, trialTier, valueTrial, type TrialProjection, type TrialValue } from "@/lib/trialProjection";

export interface ValueInput {
  orgId: string;
  createdAt: Date;
  state: "trial" | "paying" | "lapsed" | "free" | "unknown";
  sub: { plan: string; status: string; trialEndsAt: Date | null; stripePriceId: string | null; externalSubId: string | null; provider: string; canceledAt?: Date | null } | null;
}

export type SignupValue = { monthlyCents: number | null; tier?: TrialValue["tier"]; chance?: number; expectedCents?: number };

const safe = async <T>(p: Promise<T>, fallback: T): Promise<T> => {
  try {
    return await p;
  } catch {
    return fallback;
  }
};
const parse = <T>(text: string | null | undefined): T | null => {
  try {
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    return null;
  }
};
const DAY_MS = 86_400_000;

export async function valueSignups(rows: readonly ValueInput[], now = Date.now()): Promise<{ values: Map<string, SignupValue>; projection: TrialProjection }> {
  const trials = rows.filter((r) => r.state === "trial");
  const priced = rows.filter((r) => r.state === "trial" || r.state === "paying");
  const ids = priced.map((r) => r.orgId);
  const trialIds = trials.map((r) => r.orgId);
  const priceIds = [...new Set(priced.map((r) => r.sub?.stripePriceId).filter((x): x is string => !!x))];
  const customIds = priced.filter((r) => (r.sub?.plan ?? "").toUpperCase() === "CUSTOM").map((r) => r.orgId);
  const inTrials = { organizationId: { in: trialIds } };

  const [cardlessRows, historyRows, planPrices, catalog, pageRows, proposals, clients, jobs, leads, views] = await Promise.all([
    ids.length ? safe(db.syncState.findMany({ where: { key: { in: ids.map(cardlessKey) } }, select: { key: true, cursor: true } }), []) : [],
    safe(db.syncState.findMany({ where: { key: { startsWith: "cardlessTrial:" } }, select: { cursor: true } }), []),
    priceIds.length ? safe(db.planPrice.findMany({ where: { stripePriceId: { in: priceIds } }, select: { stripePriceId: true, unitAmountCents: true, interval: true } }), []) : [],
    safe(db.pricingPlan.findMany({ select: { slug: true, priceCents: true, yearlyPriceCents: true } }), []),
    customIds.length ? safe(db.syncState.findMany({ where: { key: { in: customIds.map((id) => `orgPages:${id}`) } }, select: { key: true, cursor: true } }), []) : [],
    trialIds.length ? safe(db.proposal.groupBy({ by: ["organizationId"], where: inTrials, _count: { _all: true } }), []) : [],
    trialIds.length ? safe(db.client.groupBy({ by: ["organizationId"], where: { ...inTrials, deletedAt: null }, _count: { _all: true } }), []) : [],
    trialIds.length ? safe(db.job.groupBy({ by: ["organizationId"], where: inTrials, _count: { _all: true } }), []) : [],
    trialIds.length ? safe(db.lead.groupBy({ by: ["organizationId"], where: inTrials, _count: { _all: true } }), []) : [],
    trialIds.length ? safe(db.pageView.findMany({ where: inTrials, select: { organizationId: true, at: true }, take: 50_000 }), []) : [],
  ]);

  const cardless = new Map<string, CardlessRecord>();
  for (const row of cardlessRows) {
    const rec = parse<CardlessRecord>(row.cursor);
    if (rec?.subId) cardless.set(row.key.slice("cardlessTrial:".length), rec);
  }
  // The plan each card-less trial is on now — the subscription's, not the
  // signup pick the record keeps (lib/trialPlan).
  const trialPlans = new Map<string, TrialPlanChoice>(
    await Promise.all([...cardless].map(async ([orgId, rec]) => [orgId, await safe(currentTrialPlan(orgId, rec), { planSlug: rec.planSlug, interval: rec.interval, customPages: rec.customPages })] as const)),
  );
  // The shop's record: live-mode card-less trials that finished one way or the other.
  let converted = 0;
  let lapsed = 0;
  for (const row of historyRows) {
    const rec = parse<CardlessRecord>(row.cursor);
    if (!rec?.subId || rec.mode === "test") continue;
    if (rec.cardAt || rec.restartedAt) converted += 1;
    else if (rec.endedAt) lapsed += 1;
  }
  const calibration = calibrate({ converted, lapsed });

  const priceById = new Map(planPrices.map((p) => [p.stripePriceId, p]));
  const catalogBySlug = new Map(catalog.map((c) => [c.slug.toUpperCase(), c]));
  const pagesByOrg = new Map(pageRows.map((r) => [r.key.slice("orgPages:".length), normalizeCustomPages(parse<string[]>(r.cursor) ?? [])]));
  const count = (rows: ReadonlyArray<{ organizationId: string; _count: { _all: number } }>) => new Map(rows.map((r) => [r.organizationId, r._count._all]));
  const proposalsBy = count(proposals);
  const clientsBy = count(clients);
  const jobsBy = count(jobs);
  const leadsBy = count(leads);
  const viewsBy = new Map<string, { views: number; days: Set<number> }>();
  for (const v of views) {
    const e = viewsBy.get(v.organizationId) ?? { views: 0, days: new Set<number>() };
    e.views += 1;
    e.days.add(Math.floor(v.at.getTime() / DAY_MS));
    viewsBy.set(v.organizationId, e);
  }

  /** The account's plan, per month, at list price; null when nothing prices it. */
  const priceOf = (r: ValueInput): number | null => {
    const sub = r.sub;
    if (!sub) return null;
    if (sub.provider.toUpperCase() === "MANUAL") return 0; // a comp bills nothing
    // Only while the row still follows the trial's subscription: once a card
    // restarted the plan on a new one, that one's own price below applies.
    const trialPlan = sub.externalSubId === cardless.get(r.orgId)?.subId ? trialPlans.get(r.orgId) : undefined;
    if (trialPlan) {
      const { planSlug, interval, customPages } = trialPlan;
      if (planSlug === CUSTOM_PLAN_SLUG) return monthlyCents(customPriceCents(customPages, interval), interval);
      const row = catalogBySlug.get(planSlug.toUpperCase());
      if (row) return interval === "YEAR" && row.yearlyPriceCents ? monthlyCents(row.yearlyPriceCents, "YEAR") : row.priceCents;
    }
    const price = sub.stripePriceId ? priceById.get(sub.stripePriceId) : undefined;
    if (price) return monthlyCents(price.unitAmountCents, price.interval);
    const plan = sub.plan.toUpperCase();
    if (plan === "CUSTOM") return customPriceCents(pagesByOrg.get(r.orgId) ?? []);
    const row = catalogBySlug.get(plan);
    return row && row.priceCents > 0 ? row.priceCents : null;
  };

  const values = new Map<string, SignupValue>();
  const trialValues: TrialValue[] = [];
  const paying: Array<number | null> = [];
  for (const r of priced) {
    const monthly = priceOf(r);
    if (r.state === "paying") {
      values.set(r.orgId, { monthlyCents: monthly });
      paying.push(monthly);
      continue;
    }
    const rec = cardless.get(r.orgId);
    // No card-less record but a Stripe subscription: a trial from the card-first signup — the card is on file.
    const hasCard = rec ? !!rec.cardAt : !!r.sub?.externalSubId;
    const ends = r.sub?.trialEndsAt?.getTime() ?? (rec ? Date.parse(rec.endsAt) : NaN);
    const v = viewsBy.get(r.orgId);
    const over = !hasCard && ((Number.isFinite(ends) && ends <= now) || !!rec?.endedAt);
    const tier = trialTier({
      hasCard,
      over,
      // Cancel pressed during the trial (billing.cancelSubscription stamps canceledAt; Resume clears it).
      canceling: !!r.sub?.canceledAt,
      ageHours: Math.max(0, (now - r.createdAt.getTime()) / 3_600_000),
      proposals: proposalsBy.get(r.orgId) ?? 0,
      records: (clientsBy.get(r.orgId) ?? 0) + (jobsBy.get(r.orgId) ?? 0) + (leadsBy.get(r.orgId) ?? 0),
      activeDays: v?.days.size ?? 0,
      views: v?.views ?? 0,
    });
    const value = valueTrial(monthly, tier, calibration.factor);
    trialValues.push(value);
    values.set(r.orgId, { monthlyCents: value.monthlyCents, tier: value.tier, chance: value.chance, expectedCents: value.expectedCents });
  }
  return { values, projection: projectTrials(trialValues, calibration, paying) };
}
