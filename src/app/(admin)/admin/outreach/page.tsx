// Admin · Outreach (owner, 2026-10-23: "make the AI desk call contractors and present JobFlex … per the list given").
// The list, the line checks, the calls and the one email to the contractors the AI may not call — lib/outreach.
import type { Metadata } from "next";
import { requirePlatformAdmin } from "@/lib/orgContext";
import { outreachBoard } from "@/actions/outreach";
import { AdminOutreachContent } from "@/components/v3/admin-outreach/outreach-content";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "JobFlex Admin · Outreach",
  description: "JobFlex's AI desk calling contractors about JobFlex — within the phone law.",
};

export default async function AdminOutreachPage() {
  await requirePlatformAdmin();
  const board = await outreachBoard();
  if (!board.ok) return null;
  return <AdminOutreachContent rows={board.rows} readiness={board.readiness} funnel={board.funnel} />;
}
