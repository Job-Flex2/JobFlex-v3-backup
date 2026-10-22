// /admin/usage — the server half (2026-10-22): one period of ApiSpendDaily
// (lib/apiSpend), cut by company and by service, with each company's plan,
// status and monthly plan price beside it so the page can colour the
// companies we pay more for than they pay us (lib/apiUsageShared spendFlag).
// Grouped in the database: the page receives a few numbers per company, not
// the rows. Null while the table is not in this database.
import "server-only";
import { db } from "@/lib/db";
import { utcDay, utcMonthStart } from "@/lib/apiSpend";
import { customPriceCents, normalizeCustomPages } from "@/lib/customPlan";
import { onFreePlan } from "@/lib/freePlan";
import { getMonthlyCentsBySlugUpper, getPlanNamesBySlug } from "@/lib/planCatalogServer";
import { planDisplayName } from "@/lib/planCatalog";
import { PLAN_MONTHLY_USD } from "@/lib/planPricing";
import type { PaidService } from "@/lib/paidApiCosts";
import type { UsageOrgDTO, UsagePeriod, UsageReport, UsageServiceDTO, UsageStatus } from "@/lib/apiUsageShared";

const DAY = 86_400_000;

/** The period's UTC days: [from, until). */
export function usageRange(period: UsagePeriod, now: Date = new Date()): { from: Date; until: Date } {
  const tomorrow = new Date(utcDay(now).getTime() + DAY);
  if (period === "7") return { from: new Date(tomorrow.getTime() - 7 * DAY), until: tomorrow };
  if (period === "30") return { from: new Date(tomorrow.getTime() - 30 * DAY), until: tomorrow };
  if (period === "month") return { from: utcMonthStart(now), until: tomorrow };
  return { from: utcMonthStart(now, -1), until: utcMonthStart(now) };
}

type Sub = { plan: string; status: string; provider: string } | null;

function statusOf(sub: Sub): UsageStatus {
  if (!sub || onFreePlan(sub)) return "free";
  const status = sub.status.toUpperCase();
  if (sub.provider === "MANUAL") return "grant";
  if (status === "TRIALING") return "trial";
  if (status === "ACTIVE" || status === "PAST_DUE") return "paying";
  return "free";
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export async function readUsageReport(period: UsagePeriod, focusOrgId: string | null = null): Promise<UsageReport | null> {
  const { from, until } = usageRange(period);
  const inPeriod = { day: { gte: from, lt: until } };
  const rows = await db.apiSpendDaily
    .groupBy({ by: ["organizationId", "service", "op"], where: inPeriod, _sum: { calls: true, cents: true } })
    .catch(() => null);
  if (!rows) return null; // the table is not in this database yet (prisma/sql/prod-2026-10-22-api-spend.sql)

  const byOrg = new Map<string, UsageOrgDTO["ops"]>();
  for (const r of rows) {
    const ops = byOrg.get(r.organizationId) ?? [];
    ops.push({ service: r.service as PaidService, op: r.op, calls: r._sum.calls ?? 0, cents: r._sum.cents ?? 0 });
    byOrg.set(r.organizationId, ops);
  }
  const ids = [...new Set([...byOrg.keys(), ...(focusOrgId ? [focusOrgId] : [])])];

  const [orgs, allTime, catalogCents, planNames, pageRows, payingSubs] = await Promise.all([
    db.organization.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, subscription: { select: { plan: true, status: true, provider: true } } },
    }),
    db.apiSpendDaily.groupBy({ by: ["organizationId"], where: { organizationId: { in: ids } }, _sum: { cents: true } }),
    getMonthlyCentsBySlugUpper(),
    getPlanNamesBySlug(),
    db.syncState.findMany({ where: { key: { in: ids.map((id) => `orgPages:${id}`) } }, select: { key: true, cursor: true } }),
    db.subscription.findMany({
      where: { status: { in: ["ACTIVE", "PAST_DUE"] }, provider: { not: "MANUAL" } },
      select: { organizationId: true },
    }),
  ]);
  const orgById = new Map(orgs.map((o) => [o.id, o]));
  const allById = new Map(allTime.map((a) => [a.organizationId, a._sum.cents ?? 0]));
  const pagesById = new Map(
    pageRows.map((p) => {
      let pages: string[] = [];
      try {
        pages = normalizeCustomPages(JSON.parse(p.cursor) as string[]);
      } catch {
        /* unreadable: the base price alone */
      }
      return [p.key.slice("orgPages:".length), pages];
    }),
  );

  const planCentsOf = (sub: Sub, orgId: string, status: UsageStatus): number | null => {
    if (status === "free") return 0;
    const key = (sub?.plan ?? "").toUpperCase();
    if (key === "CUSTOM") return customPriceCents(pagesById.get(orgId) ?? []);
    if (Object.prototype.hasOwnProperty.call(catalogCents, key)) return catalogCents[key];
    return key in PLAN_MONTHLY_USD ? PLAN_MONTHLY_USD[key] * 100 : null;
  };

  const list: UsageOrgDTO[] = ids.map((id) => {
    const org = orgById.get(id);
    const sub: Sub = org?.subscription ?? null;
    const status = statusOf(sub);
    const ops = (byOrg.get(id) ?? []).sort((a, b) => b.cents - a.cents);
    return {
      id,
      name: org?.name ?? "Deleted company",
      exists: !!org,
      planName: status === "free" ? "Free" : planDisplayName(sub?.plan, planNames),
      status,
      planCents: org ? planCentsOf(sub, id, status) : null,
      periodCents: ops.reduce((n, o) => n + o.cents, 0),
      periodCalls: ops.reduce((n, o) => n + o.calls, 0),
      allCents: allById.get(id) ?? 0,
      ops,
    };
  });
  list.sort((a, b) => b.periodCents - a.periodCents || b.allCents - a.allCents || a.name.localeCompare(b.name));

  const services = new Map<PaidService, UsageServiceDTO>();
  for (const r of rows) {
    const service = r.service as PaidService;
    const s = services.get(service) ?? { service, calls: 0, cents: 0, ops: [] };
    const calls = r._sum.calls ?? 0;
    const cents = r._sum.cents ?? 0;
    s.calls += calls;
    s.cents += cents;
    const op = s.ops.find((o) => o.op === r.op);
    if (op) {
      op.calls += calls;
      op.cents += cents;
    } else s.ops.push({ op: r.op, calls, cents });
    services.set(service, s);
  }
  for (const s of services.values()) s.ops.sort((a, b) => b.cents - a.cents);

  const paying = new Set(payingSubs.map((s) => s.organizationId));
  const withSpend = list.filter((o) => o.periodCents > 0);
  return {
    period,
    from: isoDay(from),
    to: isoDay(new Date(until.getTime() - DAY)),
    totalCents: withSpend.reduce((n, o) => n + o.periodCents, 0),
    totalCalls: withSpend.reduce((n, o) => n + o.periodCalls, 0),
    orgsWithSpend: withSpend.length,
    payingOrgs: paying.size,
    payingCents: list.filter((o) => paying.has(o.id)).reduce((n, o) => n + o.periodCents, 0),
    orgs: list.filter((o) => o.periodCents > 0 || o.id === focusOrgId),
    services: [...services.values()].sort((a, b) => b.cents - a.cents),
  };
}
