import { requirePlatformAdmin } from "@/lib/orgContext";
import { getRevenueReport } from "@/lib/revenue-server";
import { RevenueContent } from "@/components/v3/admin-revenue/revenue-content";

export const maxDuration = 300;
export default async function RevenuePage() {
  await requirePlatformAdmin();
  let data;
  try { data = await getRevenueReport(); }
  catch (error) {
    console.error("[revenue] report unavailable", error instanceof Error ? error.name : "UnknownError");
    return <main style={{ padding: 32 }}><h1>Revenue unavailable</h1><p>We couldn’t complete the Stripe read. No estimated totals are shown.</p><a href="/admin/revenue">Try again</a></main>;
  }
  return <RevenueContent data={data} />;
}
