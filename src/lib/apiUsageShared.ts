// /admin/usage — the client-safe half (2026-10-22): the periods, the row
// shapes the server hands the page, and the one rule that colours a company.
// The server half is lib/apiUsageReport; the record is lib/apiSpend.
import type { PaidService } from "@/lib/paidApiCosts";

export const USAGE_PERIODS = ["7", "30", "month", "last"] as const;
export type UsagePeriod = (typeof USAGE_PERIODS)[number];

export const USAGE_PERIOD_LABEL: Record<UsagePeriod, string> = {
  "7": "7 days",
  "30": "30 days",
  month: "This month",
  last: "Last month",
};

export function readUsagePeriod(raw: string | null | undefined): UsagePeriod {
  return (USAGE_PERIODS as readonly string[]).includes(raw ?? "") ? (raw as UsagePeriod) : "30";
}

/** trial / paying / free, and a grant (MANUAL) — paid by nobody, on a plan. */
export type UsageStatus = "trial" | "paying" | "free" | "grant";

export type UsageOpDTO = { service: PaidService; op: string; calls: number; cents: number };

export type UsageOrgDTO = {
  id: string;
  name: string;
  /** false when the company has been deleted since. */
  exists: boolean;
  planName: string;
  status: UsageStatus;
  /** The plan's monthly price (custom: base + pages); 0 on Free; null when unknown. */
  planCents: number | null;
  periodCents: number;
  periodCalls: number;
  /** Every row kept (13 months). */
  allCents: number;
  ops: UsageOpDTO[];
};

export type UsageServiceDTO = { service: PaidService; calls: number; cents: number; ops: Array<{ op: string; calls: number; cents: number }> };

export type UsageReport = {
  period: UsagePeriod;
  /** UTC days, inclusive: "2026-10-16". */
  from: string;
  to: string;
  totalCents: number;
  totalCalls: number;
  orgsWithSpend: number;
  payingOrgs: number;
  payingCents: number;
  orgs: UsageOrgDTO[];
  services: UsageServiceDTO[];
};

/**
 * THE SIGNAL: the period's spend against the plan's monthly price — over it
 * is red ("we pay more for this company than it pays us"), over half amber.
 * A Free company pays nothing, so any spend is over. Unknown price: none.
 */
export function spendFlag(periodCents: number, planCents: number | null): "over" | "half" | null {
  if (planCents === null || periodCents <= 0) return null;
  if (periodCents > planCents) return "over";
  if (periodCents > planCents / 2) return "half";
  return null;
}
