import { redirect } from "next/navigation";
import type { Route } from "next";
import { isLimitedRole, NoOrgError, requireOrg, UnauthorizedError } from "@/lib/orgContext";

// SERVICE PLANS (2026-09-22) → HVAC SERVICES (2026-10-18). The memberships
// page moved under the HVAC estimator as one service desk (owner: "make the
// service a sub-row under the inventory … make it more understandable").
// This address stays alive for the bell notices, bookmarks and links that
// still carry it. The office only; everyone else lands where they always did.
export const dynamic = "force-dynamic";

export default async function ServicePlansPage() {
  try {
    const ctx = await requireOrg();
    if (isLimitedRole(ctx.role)) redirect("/dashboard?error=forbidden");
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login?next=%2Fdashboard%2Fhvac-estimator%2Fservice-desk");
    if (err instanceof NoOrgError) redirect("/dashboard?error=forbidden");
    throw err;
  }
  redirect("/dashboard/hvac-estimator/service-desk" as Route);
}
