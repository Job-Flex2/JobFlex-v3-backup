// Admin · Customer development (owner, 2026-10-22: "build customer development in admin … start tracking customer
// development statistics … based on what we have in JobFlex and the emails … we're going to show it to investors as
// well — but don't add anything to the investors link"). Steve Blank's four steps read off JobFlex's own records, the
// support inbox, cancellation reasons and trial notes (lib/custDev/read), with the hypotheses, the segments, the
// voice of the customer and the interview log. Each visit keeps this week's scorecard (lib/custDev/store), so the
// figures are tracked week by week from the first visit on. The investor report is ./report — admin only, no link.
import type { Metadata } from "next";
import { requirePlatformAdmin } from "@/lib/orgContext";
import { readCustDev } from "@/lib/custDev/read";
import { CustDevContent, type Tab } from "@/components/v3/admin-custdev/custdev-content";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "JobFlex Admin · Customer development",
  description: "Who our customer is, what they tell us, and what we have proven.",
};

const TABS: Tab[] = ["overview", "hypotheses", "segments", "voice", "interviews"];

export default async function AdminCustomerDevelopmentPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requirePlatformAdmin();
  const [view, sp] = await Promise.all([readCustDev({ recordScore: true }), searchParams]);
  const tab = TABS.find((t) => t === sp.tab) ?? "overview";
  return <CustDevContent view={view} tab={tab} />;
}
