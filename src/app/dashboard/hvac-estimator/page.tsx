// HVAC estimator — Blueprint edition. Replacement-first: site facts from the
// records, a video walk and nameplate photos for what is there, a block load
// at the county's design day, the unit the shop's catalog fits, the checks,
// and a priced ledger from the shop's rate card. The engine itself is pure
// (src/lib/hvac) and runs in the browser; the server does the lookups, the
// plate reading, the catalog, the rate card and the proposal.
//
// The sidebar and topbar come from the shared shell mounted in ../layout.tsx,
// so this page renders only the `.content` children.

import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { isOpenAIEnabled } from "@/lib/sdk/openai";
import { HvacEstimatorContent } from "@/components/v3/hvac-estimator-blueprint/hvac-estimator-content";
import { readEstimateSeed } from "@/lib/estimateSeed";
import { readWebLeadFor } from "@/lib/webEstimatorServer";
import { hvacSeedFromWebLead } from "@/lib/webHandoff";
import { EstimateSeedStrip } from "@/components/v3/estimate-seed-strip";
import { leadsWaitingFor } from "@/lib/leadQueue";
import { customPageGate } from "@/components/v3/upgrade-gate/custom-page-gate";

/** The hand-off seed for the signed-in company's HVAC estimator, or null — never an error. */
async function readHvacSeed(userId: string) {
  try {
    const orgId = (await db.user.findUnique({ where: { id: userId }, select: { activeOrgId: true } }))?.activeOrgId;
    const seed = orgId ? await readEstimateSeed(orgId, "hvac") : null;
    // A website or house lead's house and the tier they picked (lib/webHandoff, 2026-10-28), when the lead carries them.
    const rec = seed && orgId ? await readWebLeadFor(seed.leadId, orgId, "hvac") : null;
    return { seed, webHvac: rec ? hvacSeedFromWebLead(rec) : null };
  } catch {
    return { seed: null, webHvac: null };
  }
}

export const dynamic = "force-dynamic";
// A server action runs under the segment config of the page that calls it,
// so the ceiling is set here: a reasoning model (gpt-5) thinks for a minute
// or more, and the estimate can be asked again after a validation pass
// (2026-09-19, set up so OPENAI_MODEL can move to gpt-5).
export const maxDuration = 300;

export const metadata: Metadata = {
  title: "JobFlex · HVAC Estimator",
  description: "HVAC estimator — walk the house on video, read the plates, size the system and price the replacement.",
};

export default async function HvacEstimatorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const gate = await customPageGate("hvac-estimator");
  if (gate) return gate;
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/auth/login?next=%2Fdashboard%2Fhvac-estimator");
  }
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  // Opened from a client's record (the estimator picker adds `?client=`): the
  // client's address is already in the field. Read from this org only.
  let initialAddress: string | undefined;
  const clientId = one(params.client);
  if (clientId) {
    const orgId = (await db.user.findUnique({ where: { id: session.user.id }, select: { activeOrgId: true } }))?.activeOrgId;
    const client = orgId ? await db.client.findFirst({ where: { id: clientId, organizationId: orgId, deletedAt: null }, select: { address: true, city: true, state: true, zip: true } }) : null;
    if (client?.address) initialAddress = [client.address, client.city, [client.state, client.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  }
  // A lead handed over from its page (lib/estimateSeed) fills the address too.
  const { seed, webHvac } = initialAddress ? { seed: null, webHvac: null } : await readHvacSeed(session.user.id);
  if (seed?.address) initialAddress = seed.address;
  // The shop's leads still waiting for an HVAC estimate (lib/leadQueue) —
  // the work this page is for, listed under the stepper. Never an error.
  const orgId = (await db.user.findUnique({ where: { id: session.user.id }, select: { activeOrgId: true } }))?.activeOrgId;
  const leads = orgId ? await leadsWaitingFor(orgId, "hvac").catch(() => []) : [];
  return (
    <>
      <EstimateSeedStrip seed={seed} />
      <HvacEstimatorContent aiEnabled={isOpenAIEnabled()} initialAddress={initialAddress} leads={leads} webHvac={webHvac} />
    </>
  );
}
