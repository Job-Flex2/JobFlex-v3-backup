// ADMIN · OFFICE SCREEN — /admin/office (owner, 2026-10-13: "make office screen for admin — what is going on today with
// users, stats, what's new … API health, statuses … we will put it on TV"). A wall board, no admin chrome (the admin
// layout renders this path bare, still behind the admin guard): today against yesterday at this clock time, who is
// in the app, today's feed, what needs a person, trials and money, the systems. It refreshes itself every thirty
// seconds and keeps the screen awake.
import type { Metadata } from "next";
import { requirePlatformAdmin } from "@/lib/orgContext";
import { readOfficeScreen } from "@/lib/officeScreenRead";
import { OfficeScreen } from "@/components/v3/admin-office/office-screen";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "JobFlex · Office" };

export default async function AdminOfficePage() {
  await requirePlatformAdmin();
  const data = await readOfficeScreen();
  return <OfficeScreen initial={data} />;
}
