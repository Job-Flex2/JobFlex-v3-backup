"use server";

// Calendar — the handheld build's door to the page's own read.
//
// The desktop edition is a server component and awaits `buildCalendarSeed`
// directly. The handheld edition cannot: `ResponsiveDashboardShell` mounts
// `MobileCalendar` PROPS-LESS (and `ssr: false`) once the viewport drops below
// 768px on /dashboard/calendar, so there is no server render in its path to
// hand it a seed. This is that read, exposed as a read-only action — the same
// shape ../dashboard-actions.ts gives the handheld overview.
//
// READ ONLY. It writes nothing, it takes no arguments, and it awaits exactly
// the function ./page.tsx awaits — which is exactly the queries the archived
// classic page ran. `requireOrg()` inside `buildCalendarSeed` means the org
// scope and the worker / sales role slices are enforced on this path too, and
// with no parameters there is nothing a caller could widen. Every WRITE the
// calendar performs still goes through the pre-existing, individually guarded
// appointment / blocked-time / job / worker actions.

import { buildCalendarSeed } from "./calendar-query";
import type { CalendarSeed } from "@/components/v3/calendar-blueprint/calendar-data";
import { requirePage } from "@/lib/customPageAccess";
import { requireRouteAccess } from "@/lib/orgContext";

export async function getCalendarSeed(): Promise<CalendarSeed> {
  const { organizationId } = await requireRouteAccess("/dashboard/calendar");
  await requirePage(organizationId, "calendar");
  return buildCalendarSeed();
}
