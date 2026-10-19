// Deck Lab (route: /dashboard/deck-lab, 2026-10-18) — the index of five
// competing designs of the deck estimator, built in parallel so the owner can
// open each and pick one. Same features, five bets on how the page is
// organised; each lives at its own top-level route (/dashboard/deck-v1 … v5)
// so the shell's pageKey() gives none of them the live studio's styles.
//
// Links only — it imports nothing from the variant folders, which are being
// built by parallel agents. Same gate as the deck estimator itself.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { canUseDeckEstimator } from "@/lib/deck/access";
import { isLimitedRole, NoOrgError, requireOrg, UnauthorizedError } from "@/lib/orgContext";
import { DeckComingSoon } from "@/components/v3/deck-estimator-blueprint/deck-coming-soon";
import { DeckLab } from "@/components/v3/deck-lab/deck-lab";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "JobFlex · Deck Lab",
  description: "Five designs of the deck estimator, side by side — open each one and pick.",
};

export default async function DeckLabPage() {
  let open = false;
  try {
    const ctx = await requireOrg();
    if (isLimitedRole(ctx.role)) redirect("/dashboard?error=forbidden");
    open = await canUseDeckEstimator(ctx.user, ctx.organizationId);
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login?next=%2Fdashboard%2Fdeck-lab");
    if (err instanceof NoOrgError) redirect("/dashboard?error=forbidden");
    throw err;
  }
  return open ? <DeckLab /> : <DeckComingSoon />;
}
