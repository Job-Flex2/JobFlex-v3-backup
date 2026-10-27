import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { isSalesRole, isWorkerRole, NoOrgError, requireOrg, UnauthorizedError } from "@/lib/orgContext";
import { longDate } from "@/lib/format";
import { contactsLocked } from "@/lib/leadCenter/contacts";
import { LeadDetailContent } from "@/components/v3/lead-detail-blueprint/lead-detail-content";
import { contractorFolder, listFolder } from "@/lib/home/files";
import { findClientForLead } from "@/lib/leadClient";
import { customPageGate } from "@/components/v3/upgrade-gate/custom-page-gate";
import { HANDOFF_WORDS, WEB_LEAD_SOURCE, WEB_TRADE, bandWords } from "@/lib/webEstimator";
import { readWebLead } from "@/lib/webEstimatorServer";

// ONE LEAD (2026-09-22) — under the blueprint shell, the same design as the
// Leads list it opens from. Session-scoped, never static.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "JobFlex · Lead",
  description: "One lead — the scope of work, the homeowner's words, and the estimators.",
};

export default async function LeadDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const gate = await customPageGate("leads");
  if (gate) return gate;
  const { id } = await params;
  const scopeFailed = (await searchParams)?.scope === "failed";
  let organizationId: string;
  let role: string;
  let userId: string;
  try {
    const ctx = await requireOrg();
    organizationId = ctx.organizationId;
    role = ctx.role;
    userId = ctx.user.id;
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect(`/auth/login?next=${encodeURIComponent(`/dashboard/leads/${id}`)}`);
    }
    if (err instanceof NoOrgError) redirect("/dashboard?error=forbidden");
    throw err;
  }
  const lead = await db.lead.findUnique({ where: { id }, include: { assignedTo: { select: { name: true, email: true } } } });
  if (!lead || lead.organizationId !== organizationId) notFound();
  // Sales reps can only open leads that are theirs (assigned/claimed) or NEW.
  if (isSalesRole(role) && lead.assignedToId !== userId && lead.claimedById !== userId && lead.status !== "NEW") {
    notFound();
  }
  // A legacy hand-routed lead the shop has not claimed: city and scope only,
  // and nothing to price yet — the estimators would carry the street with them.
  const locked = contactsLocked(lead);
  // A lead this shop paid to open: the amount, the date, and the support line.
  const paidOffer =
    lead.source === "LEAD_CENTER"
      ? await db.leadOffer.findFirst({
          where: { organizationId, unlockedAt: { not: null }, priceCents: { gt: 0 }, platformLead: { matchedLeadId: lead.id } },
          select: { priceCents: true, unlockedAt: true },
        })
      : null;
  // THE JOB FOLDER (2026-10-03, lib/home/files): a Lead Center lead carries the
  // homeowner's folder — their pictures, videos and PDFs — and the proposals
  // of this client a picture could go on.
  let folder: { leadId: string; homeownerFirstName: string; files: Awaited<ReturnType<typeof listFolder>>["files"]; requests: Awaited<ReturnType<typeof listFolder>>["requests"]; proposals: Array<{ id: string; title: string; status: string }> } | null = null;
  if (!locked) {
    const door = await contractorFolder(organizationId, lead.id).catch(() => null);
    if (door) {
      const [{ files, requests }, client] = await Promise.all([listFolder(door.pl.id, null), findClientForLead(organizationId, { email: lead.email, phone: lead.phone })]);
      const proposals = client ? await db.proposal.findMany({ where: { organizationId, clientId: client.id }, orderBy: { createdAt: "desc" }, take: 12, select: { id: true, title: true, status: true } }) : [];
      folder = { leadId: lead.id, homeownerFirstName: door.home.name.trim().split(/\s+/)[0] || "the homeowner", files, requests, proposals };
    }
  }
  // A lead from the shop's website estimator (lib/webEstimator): what the homeowner saw, for the card and the hand-off.
  const web = lead.source === WEB_LEAD_SOURCE ? await readWebLead(lead.id).catch(() => null) : null;
  const website = web
    ? { trade: web.trade, estimator: WEB_TRADE[web.trade].name.replace(" on your website", ""), summary: web.estimate.summary, choice: web.estimate.choice, price: bandWords(web.estimate.band), show: web.estimate.show, note: web.contact.note, handoff: HANDOFF_WORDS[web.trade] }
    : null;
  return (
    <LeadDetailContent
      website={website}
      folder={folder}
      lead={{
        id: lead.id,
        name: lead.name,
        email: locked ? null : lead.email,
        phone: locked ? null : lead.phone,
        address: locked ? null : lead.address,
        city: lead.city,
        state: lead.state,
        zip: lead.zip,
        projectType: lead.projectType,
        description: lead.description,
        scope: lead.scope,
        status: lead.status,
        source: lead.source,
        aiCategory: lead.aiCategory,
        aiConfidence: lead.aiConfidence,
        assignee: lead.assignedTo?.name ?? lead.assignedTo?.email ?? null,
        created: longDate(lead.createdAt),
      }}
      canEstimate={!locked && !isSalesRole(role) && !isWorkerRole(role)}
      contactsLocked={locked}
      paid={
        paidOffer?.priceCents && paidOffer.unlockedAt
          ? { amount: `$${(paidOffer.priceCents / 100).toFixed(2)}`, when: longDate(paidOffer.unlockedAt) }
          : null
      }
      scopeFailed={scopeFailed}
    />
  );
}
