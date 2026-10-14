"use server";
// The office screen's refresh (2026-10-13): /admin/office asks every thirty seconds. Platform admins only.
import { requirePlatformAdmin } from "@/lib/orgContext";
import { readOfficeScreen } from "@/lib/officeScreenRead";
import type { OfficeScreenData } from "@/lib/officeScreen";

export async function loadOfficeScreen(): Promise<OfficeScreenData> {
  await requirePlatformAdmin();
  return readOfficeScreen();
}
