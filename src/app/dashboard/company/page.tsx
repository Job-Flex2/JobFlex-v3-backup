// Company — Blueprint edition. Port of the canonical company donor
// (jobflex-company-blueprint_3.html).
//
// The sidebar, topbar and shared sprite come from the shell mounted in
// ../layout.tsx, so this page renders only the donor's `.content` children.
// Child routes (/activity, /landing, /subscription, /team) live under the
// (dashboard) route group and keep the classic layout.
//
// This page is NOT a fixture: the organization row and the team-activity feed
// are read here — the same query the classic pages use (old-design-pages'
// branding page and lib/teamActivity) — and every edit is written back through
// the company server actions (see company-behavior.ts).

import { redirect, notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { NoOrgError, UnauthorizedError, isOwnerOrManager, requireOrg } from "@/lib/orgContext";
import { loadTeamActivity } from "@/lib/teamActivity";
import { parseTradeTypes } from "@/lib/tradeTypes";
import { CompanyContent } from "@/components/v3/company-blueprint/company-content";
import { toActivityEntries } from "@/components/v3/company-blueprint/company-data";
import { customPageGate } from "@/components/v3/upgrade-gate/custom-page-gate";
import { isOrgNameUnset } from "@/lib/orgName";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "JobFlex · Company",
  description: "Company — branding, team, team activity and the landing builder on one sheet.",
};

/** WHO DID WHAT (2026-09-24): the sheet reads by window — Today · 7 · 30 ·
 *  90 days — and filters client-side, so the loader brings the whole 90 days
 *  (capped at a thousand rows) rather than the newest two hundred of all time. */
function activityWindowStart(): Date {
  return new Date(Date.now() - 90 * 86400000);
}

export default async function CompanyPage() {
  const gate = await customPageGate("company");
  if (gate) return gate;
  let organizationId: string;
  let role: string | null;
  try {
    const ctx = await requireOrg();
    organizationId = ctx.organizationId;
    role = ctx.role;
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login?next=%2Fdashboard%2Fcompany");
    if (err instanceof NoOrgError) redirect("/dashboard?error=forbidden");
    throw err;
  }

  const [org, activity, nameUnset] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId } }),
    loadTeamActivity(organizationId, { take: 1000, since: activityWindowStart() }),
    isOrgNameUnset(organizationId),
  ]);
  if (!org) notFound();

  return (
    <CompanyContent
      org={{
        name: org.name,
        billingEmail: org.billingEmail ?? "",
        phone: org.phone ?? "",
        website: org.website ?? "",
        address: org.address ?? "",
        primaryColor: org.primaryColor ?? "",
        logoUrl: org.logoUrl,
        tradeTypes: parseTradeTypes(org.tradeTypesJson),
        otherTrade: org.otherTrade ?? "",
        leadOffersEnabled: org.leadOffersEnabled,
        serviceRadiusMiles: org.serviceRadiusMiles,
        geocoded: org.lat != null && org.lng != null,
        publicProfileEnabled: org.publicProfileEnabled,
        landingHeroTitle: org.landingHeroTitle ?? "",
        landingHeroSubtitle: org.landingHeroSubtitle ?? "",
      }}
      activity={toActivityEntries(activity.activities)}
      members={activity.members}
      canEdit={isOwnerOrManager(role)}
      nameUnset={nameUnset}
    />
  );
}
