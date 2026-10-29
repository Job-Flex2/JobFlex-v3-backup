// Admin · Financing (owner, 2026-10-28: Wisetack financing for JobFlex's contractors — "make it super smart where
// they can set it up and get the approval"). JobFlex's switch (off / pilot / everyone) and the board — lib/financing.
import type { Metadata } from "next";
import { requirePlatformAdmin } from "@/lib/orgContext";
import { financingBoard } from "@/lib/financing/admin";
import { AdminFinancingContent } from "@/components/v3/admin-financing/admin-financing";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "JobFlex Admin · Financing",
  description: "Wisetack financing for contractors — who sees it, who applied, the clients' loans, what was paid out.",
};

export default async function AdminFinancingPage() {
  await requirePlatformAdmin();
  return <AdminFinancingContent board={await financingBoard()} />;
}
