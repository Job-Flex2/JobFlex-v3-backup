// MOBILE LAWN ESTIMATOR — /mobile-lawn-estimator-v1 (2026-10-20)
//
// The handheld build of /dashboard/lawn-estimator, always the phone design at any width so it can be reviewed on a
// desk browser. The desktop route is untouched. Same gate as the desktop page: signed in, in an org, not a limited
// role, and an account lib/lawn/access opens — a plain not-found for everyone else.
import type { Metadata, Viewport } from "next";
import { notFound, redirect } from "next/navigation";
import { isLimitedRole, NoOrgError, requireOrg, UnauthorizedError } from "@/lib/orgContext";
import { canUseLawnEstimator } from "@/lib/lawn/access";
import { MobileLawnEstimator } from "@/components/v3/mobile-lawn-estimator/mobile-lawn-estimator";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Lawn estimator · JobFlex Mobile", description: "Measure a yard from its address and price the season." };

// Handheld build: lock the scale so the layout is read at true device width, and pay out the notch insets.
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1, viewportFit: "cover", themeColor: "#0a0a0a" };

export default async function MobileLawnEstimatorPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  let open = false;
  try {
    const ctx = await requireOrg();
    if (isLimitedRole(ctx.role)) redirect("/dashboard?error=forbidden");
    open = await canUseLawnEstimator(ctx.user);
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect(`/auth/login?next=${encodeURIComponent("/mobile-lawn-estimator-v1")}`);
    if (err instanceof NoOrgError) redirect("/dashboard?error=forbidden");
    throw err;
  }
  if (!open) notFound();
  const p = await searchParams;
  const draft = Array.isArray(p.draft) ? p.draft[0] : p.draft;
  return <MobileLawnEstimator key={draft ?? "new"} initialDraftId={draft && /^[a-f0-9-]{8,40}$/i.test(draft) ? draft : null} />;
}
