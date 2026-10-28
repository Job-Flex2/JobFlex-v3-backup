// Smart Proposal · Estimate — Blueprint edition. Pixel-identical port of the
// canonical donor `jobflex-smartproposal-estimate-blueprint (8).html`.
//
// The route segment is `advanced-ai` (the app's existing URL for this screen);
// the donor file is named "smartproposal-estimate" and its visible title and
// heading text are kept exactly as authored. "AI" must never appear in the
// interface — the feature is called Smart Proposal.
//
// The sidebar, topbar and sprite come from the shared shell mounted in
// ../layout.tsx, so this page renders only the donor's `.content` children.
// The child routes (/roof, /fence, /fence/studio) live under the (dashboard)
// route group and keep the classic layout.
//
// ── THIS REPLACED A WIRED CONSOLE ──────────────────────────────────
// The previous build at this URL was a port of an EARLIER donor
// (jobflex-smart-proposal-blueprint_4.html) wired to real data: it read the
// org's hidden material/labour markup so the Totals card could state the price
// `convertEstimateToProposal` would write, resolved `?client=<id>` against the
// org, and gated intake behind a clarifying-questions dialog.
//
// None of that survives here. Shipping the donor's demo estimate verbatim was
// the explicit call for this port, so the page takes no props, reads no rows
// and writes nothing; `advanced-ai-behavior.ts` and `advanced-ai-clarify.ts`
// were removed with the console they served. Git history has them if any of it
// needs to come back.
//
// `?client=<id>` is therefore no longer read. The estimator picker still
// appends it when the studio is opened from a client's record — the parameter
// is simply inert, which is why the auth gate below is all that remains of the
// old server component.

import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { requireOrg, NoOrgError, UnauthorizedError } from "@/lib/orgContext";
import { AdvancedAiContent } from "@/components/v3/advanced-ai-blueprint/advanced-ai-content";
import { readEstimateSeed } from "@/lib/estimateSeed";
import { readWebLeadFor } from "@/lib/webEstimatorServer";
import { smartSeedFromWebLead } from "@/lib/webHandoff";
import { EstimateSeedStrip } from "@/components/v3/estimate-seed-strip";
import { customPageGate } from "@/components/v3/upgrade-gate/custom-page-gate";

/** The hand-off seed for this company's Smart Proposal, or null — never an error. With it, the estimate a website
 *  or house lead was priced on (lib/webHandoff, 2026-10-28), when the lead carries one. */
async function readSmartSeed() {
  try {
    const { organizationId } = await requireOrg();
    const seed = await readEstimateSeed(organizationId, "smart");
    const rec = seed ? await readWebLeadFor(seed.leadId, organizationId, "smart") : null;
    return { seed, web: rec ? smartSeedFromWebLead(rec) : null };
  } catch {
    return { seed: null, web: null };
  }
}

export const dynamic = "force-dynamic";
// A server action runs under the segment config of the page that calls it,
// so the ceiling is set here: a reasoning model (gpt-5) thinks for a minute
// or more, and the estimate can be asked again after a validation pass
// (2026-09-19, set up so OPENAI_MODEL can move to gpt-5).
export const maxDuration = 300;

export const metadata: Metadata = {
  title: "JobFlex · Smart Proposal estimate",
  description:
    "Smart Proposal — the estimate that prices materials, labor and scope on one sheet, and rewrites itself from a sentence.",
};

export default async function AdvancedAiPage() {
  const gate = await customPageGate("smart-proposal");
  if (gate) return gate;
  try {
    await requireOrg();
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login?next=%2Fdashboard%2Fadvanced-ai");
    if (err instanceof NoOrgError) redirect("/dashboard?error=forbidden");
    throw err;
  }

  // A lead handed over from its page (lib/estimateSeed): the scope is the
  // brief, the address is the location, before the contractor types a word.
  const { seed, web } = await readSmartSeed();
  return (
    <>
      <EstimateSeedStrip seed={seed} />
      <AdvancedAiContent seed={seed ? { brief: seed.brief, address: seed.address ?? "", state: seed.state ?? "" } : undefined} web={web} />
    </>
  );
}
