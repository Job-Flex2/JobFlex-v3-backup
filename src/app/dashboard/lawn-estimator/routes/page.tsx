// The lawn crews' route days (2026-10-18): a week of lawn-plan visits, day by day in driving order, the mowing days
// balanced by where the yards are, a rained-out day pushed to the next. Admin preview, as the estimator.
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { isLimitedRole, NoOrgError, requireOrg, UnauthorizedError } from "@/lib/orgContext";
import { canUseLawnEstimator } from "@/lib/lawn/access";
import { RouteWeek } from "@/components/v3/lawn-estimator/route-week";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "JobFlex · Lawn route days", description: "The week's lawn visits in driving order." };

export default async function LawnRoutesPage() {
  let open = false;
  try {
    const ctx = await requireOrg();
    if (isLimitedRole(ctx.role)) redirect("/dashboard?error=forbidden");
    open = await canUseLawnEstimator(ctx.user);
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login?next=%2Fdashboard%2Flawn-estimator%2Froutes");
    if (err instanceof NoOrgError) redirect("/dashboard?error=forbidden");
    throw err;
  }
  if (!open) notFound();
  return <RouteWeek />;
}
