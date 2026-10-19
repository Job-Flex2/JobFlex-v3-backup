import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isLimitedRole, NoOrgError, requireOrg, UnauthorizedError } from "@/lib/orgContext";
import { loadServiceDesk } from "@/lib/serviceDeskBook";
import { ServiceDeskContent, type DeskTab } from "@/components/v3/service-desk-blueprint/service-desk-content";

// HVAC SERVICES (2026-10-18) — the service desk under the HVAC estimator:
// what needs the contractor today, the visits schedule, the clients on a plan
// (with the proposal or project each belongs to), the plans they sell and the
// reminders JobFlex sends them. Session-scoped, never static. The office only,
// like the Service plans page it replaces; open to every company since
// 2026-10-18 (owner: "for everybody") — no longer early access.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "JobFlex · HVAC services", description: "Service plans, visits, clients and reminders for the HVAC side." };

const TABS: readonly DeskTab[] = ["today", "schedule", "clients", "plans", "reminders"];

export default async function HvacServiceDeskPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  let organizationId: string;
  try {
    const ctx = await requireOrg();
    organizationId = ctx.organizationId;
    if (isLimitedRole(ctx.role)) redirect("/dashboard?error=forbidden");
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login?next=%2Fdashboard%2Fhvac-estimator%2Fservice-desk");
    if (err instanceof NoOrgError) redirect("/dashboard?error=forbidden");
    throw err;
  }
  const params = await searchParams;
  const asked = typeof params.tab === "string" ? (params.tab as DeskTab) : null;
  const data = await loadServiceDesk(organizationId);
  return <ServiceDeskContent data={data} initialTab={asked && TABS.includes(asked) ? asked : "today"} />;
}
