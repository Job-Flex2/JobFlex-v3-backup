// Fence estimator ("Fence studio") — Blueprint edition. Pixel-identical port of
// the canonical fence-estimator donor (jobflex-fence-estimator-blueprint_7.html).
//
// The sidebar, topbar and shared sprite come from the shell mounted in
// ../layout.tsx, so this page renders only the donor's `.content` children.
// A brand-new route: nothing was archived, and the separate AI fence flow under
// (dashboard)/dashboard/advanced-ai/fence stays untouched.

import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { FenceEstimatorContent } from "@/components/v3/fence-estimator-blueprint/fence-estimator-content";
import { readEstimateSeed } from "@/lib/estimateSeed";
import { readWebLeadFor } from "@/lib/webEstimatorServer";
import { fenceSeedFromWebLead } from "@/lib/webHandoff";
import { EstimateSeedStrip } from "@/components/v3/estimate-seed-strip";
import { looksLikeStreetAddress } from "@/lib/leadRules";
import { requireOrg } from "@/lib/orgContext";
import { customPageGate } from "@/components/v3/upgrade-gate/custom-page-gate";

/** The hand-off seed for this company's fence estimator, or null — never an error. With it, the fence a website
 *  or house lead was priced on (lib/webHandoff, 2026-10-28), when the lead carries one. */
async function readFenceSeed() {
  try {
    const { organizationId } = await requireOrg();
    const seed = await readEstimateSeed(organizationId, "fence");
    const rec = seed ? await readWebLeadFor(seed.leadId, organizationId, "fence") : null;
    return { seed, webFence: rec ? fenceSeedFromWebLead(rec) : null };
  } catch {
    return { seed: null, webFence: null };
  }
}

export const dynamic = "force-dynamic";
// A server action runs under the segment config of the page that calls it,
// so the ceiling is set here: a reasoning model (gpt-5) thinks for a minute
// or more, and the estimate can be asked again after a validation pass
// (2026-09-19, set up so OPENAI_MODEL can move to gpt-5).
export const maxDuration = 300;

export const metadata: Metadata = {
  title: "JobFlex · Fence Estimator",
  description:
    "Fence studio — trace the run on the map, swap material, height and gates, and watch the estimate update live.",
};

export default async function FenceEstimatorPage() {
  const gate = await customPageGate("fence-estimator");
  if (gate) return gate;
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/auth/login?next=%2Fdashboard%2Ffence-estimator");
  }

  // A fence lead handed over from its page (lib/estimateSeed): the address
  // is typed into the search bar and Find is pressed for the contractor.
  // Only a street address, though (2026-09-26): a lead with just a town or a
  // ZIP opens here too now, and Find on "Everett, WA" would put a whole city
  // on the map as if it were the site. The strip still shows what the lead gave.
  const { seed, webFence } = await readFenceSeed();
  return (
    <>
      <EstimateSeedStrip seed={seed} />
      <FenceEstimatorContent initialAddress={seed?.address && looksLikeStreetAddress(seed.address) ? seed.address : undefined} webFence={webFence} />
    </>
  );
}
