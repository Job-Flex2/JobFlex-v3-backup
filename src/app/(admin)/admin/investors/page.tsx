// INVESTORS — /admin/investors (2026-10-06). Owner: "statistics for
// investors: how much we spend on ads, how many users we get on free trial,
// what is projected if all pay and what is realistic, and the main thing —
// how soon we cover the ad spend. A separate page, with a live link or a
// PDF to send them." The figures are lib/investorModel on the rows
// lib/investors gathers; this page adds the owner's controls.
import type { Metadata } from "next";
import { headers } from "next/headers";
import { requirePlatformAdmin } from "@/lib/orgContext";
import { investorReport } from "@/lib/investors";
import { AdminInvestorsContent } from "@/components/v3/admin-investors/admin-investors-content";
import { InvestorAudience } from "@/components/v3/admin-investors/investor-audience";
import { readInvestorOffers, readInvestorVisitors } from "@/lib/investorVisitors";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "JobFlex Admin · Investors" };

export default async function AdminInvestorsPage() {
  await requirePlatformAdmin();
  const report = await investorReport({ refreshMeta: true });
  // The shared link is printed with this deployment's own host.
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "www.jobflex.app";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  // Who opened the shared link and the offers sent from it (2026-10-13).
  const [visitors, offers] = await Promise.all([readInvestorVisitors(), readInvestorOffers()]);
  return (
    <AdminInvestorsContent
      initial={report}
      origin={`${proto}://${host}`}
      audience={<InvestorAudience visitors={visitors} offers={offers} linkMadeAt={report.settings.linkMadeAt} />}
    />
  );
}
