// Admin · API usage (owner, 2026-10-22) — what each company's use of the paid
// APIs (OpenAI, ReportAll, Regrid, SerpAPI, Twilio, EagleView, Google Maps,
// Cool Calc) costs us, every company and not only the trials: ApiSpendDaily
// rows (lib/apiSpend, written by lib/trialMeter notePaidCall) cut by period
// in the database (lib/apiUsageReport). A company whose period spend is over
// its plan's monthly price is red, over half amber. `?org=` opens one company
// (the /admin/users account sheet links here). Read-only.

import type { Metadata } from "next";
import { requirePlatformAdmin } from "@/lib/orgContext";
import { readUsageReport } from "@/lib/apiUsageReport";
import { readUsagePeriod } from "@/lib/apiUsageShared";
import { AdminUsageContent } from "@/components/v3/admin-usage/admin-usage-content";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "JobFlex Admin · API usage",
  description: "What each company's use of the paid APIs costs us.",
};

export default async function AdminUsagePage({ searchParams }: { searchParams: Promise<{ period?: string; org?: string }> }) {
  await requirePlatformAdmin();
  const sp = await searchParams;
  const period = readUsagePeriod(sp.period);
  const org = typeof sp.org === "string" && sp.org.trim() ? sp.org.trim() : null;
  const report = await readUsageReport(period, org);
  return <AdminUsageContent key={`${period}:${org ?? ""}`} report={report} period={period} focusOrgId={org} />;
}
