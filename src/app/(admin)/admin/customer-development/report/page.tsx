// Admin · Customer development · the report (owner, 2026-10-22: "we're going to show it to investors as well — but
// don't add anything to the investors link"). Admin only, drawn without the console's chrome (the admin layout renders
// this path bare, still behind the guard), made to be printed or saved as a PDF and handed over. Customers appear by
// trade and state only. Reading it does not write this week's scorecard — only the page does.
import type { Metadata } from "next";
import { requirePlatformAdmin } from "@/lib/orgContext";
import { readCustDev } from "@/lib/custDev/read";
import { CustDevReport } from "@/components/v3/admin-custdev/custdev-report";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "JobFlex · Customer development",
  robots: { index: false, follow: false },
};

export default async function CustomerDevelopmentReportPage() {
  await requirePlatformAdmin();
  const view = await readCustDev();
  return <CustDevReport view={view} />;
}
