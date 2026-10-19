// THE LAWN & LANDSCAPE ESTIMATOR (2026-10-18 — owner: "a plan for landscapers: the client's address → how much grass to
// service, bark, cut the grass … estimate, and keep them on a service plan … for all states"). Admin preview, like the
// Home Design Studio: the accounts lib/lawn/access opens, a plain not-found for everyone else.
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { isLimitedRole, NoOrgError, requireOrg, UnauthorizedError } from "@/lib/orgContext";
import { canUseLawnEstimator } from "@/lib/lawn/access";
import { LawnEstimator } from "@/components/v3/lawn-estimator/lawn-estimator";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "JobFlex · Lawn & landscape estimator", description: "Measure a yard from its address and price the season." };

export default async function LawnEstimatorPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  let open = false;
  try {
    const ctx = await requireOrg();
    if (isLimitedRole(ctx.role)) redirect("/dashboard?error=forbidden");
    open = await canUseLawnEstimator(ctx.user);
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login?next=%2Fdashboard%2Flawn-estimator");
    if (err instanceof NoOrgError) redirect("/dashboard?error=forbidden");
    throw err;
  }
  if (!open) notFound();
  const p = await searchParams;
  const draft = Array.isArray(p.draft) ? p.draft[0] : p.draft;
  return <LawnEstimator key={draft ?? "new"} initialDraftId={draft && /^[a-f0-9-]{8,40}$/i.test(draft) ? draft : null} />;
}
