"use server";
// THE ADMIN'S USAGE RESET — the actions the account sheet calls. The logic is
// lib/usageReset (marks in SyncState, the engine counts from the mark); this
// file adds the platform-admin gate and the cache revalidation. An
// organization's own owner never reaches these: requirePlatformAdmin refuses
// anyone without the platform flag, and the only surface that calls them is
// /admin/users.

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/orgContext";
import { revalidatePlanSurfaces } from "@/lib/planCatalogServer";
import { orgUsageForAdmin, resetOrgUsage, type AdminUsage, type UsageResetResult } from "@/lib/usageReset";
import { orgApiSpendCents } from "@/lib/apiSpend";

export type { AdminUsage, AdminUsageRow, UsageResetResult, UsageResetDone } from "@/lib/usageReset";

/** The organization's meters this cycle, with any reset marks in force, and
 *  what its paid API calls cost us this month (lib/apiSpend; null while the
 *  table is not in this database). */
export async function getAdminOrgUsage(organizationId: string): Promise<AdminUsage & { apiSpendMonthCents: number | null }> {
  await requirePlatformAdmin();
  const [usage, apiSpendMonthCents] = await Promise.all([orgUsageForAdmin(organizationId), orgApiSpendCents(organizationId)]);
  return { ...usage, apiSpendMonthCents };
}

/** Reset one or more monthly meters for the organization. */
export async function resetAdminOrgUsage(raw: unknown): Promise<UsageResetResult> {
  const admin = await requirePlatformAdmin();
  const r = await resetOrgUsage(raw, { id: admin.id, email: admin.email });
  if (r.ok) {
    revalidatePath("/admin/users");
    // Every surface that draws what is left: the sidebar counters come off
    // the dashboard layout, the usage card off the subscription page.
    revalidatePath("/dashboard", "layout");
    revalidatePlanSurfaces();
  }
  return r;
}
