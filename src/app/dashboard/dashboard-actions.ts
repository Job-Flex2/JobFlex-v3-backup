"use server";

// Overview — the handheld build's door to the page's own read.
//
// The desktop edition is a server component and awaits `buildDashboardData`
// directly. The handheld edition cannot: `ResponsiveDashboardShell` mounts it
// PROPS-LESS (and `ssr: false`) once the viewport crosses 768px, so there is no
// server render in its path to hand it rows. This is that render, exposed as a
// read-only action.
//
// No new data layer: it awaits exactly the function ./page.tsx awaits, which is
// exactly the queries the classic overview ran. `requireOrg()` inside it means
// the org scope and the sales-rep lead slice are enforced on this path too —
// the action takes no arguments, so there is nothing a caller could widen.

import { NoOrgError, UnauthorizedError, requireOrg, roleMayOpen } from "@/lib/orgContext";
import { buildDashboardData } from "./dashboard-data";
import type { DashboardData } from "@/components/v3/dashboard-blueprint/blueprint-data";

/** Either the rows, or WHY there are none. The two "no rows" cases are ordinary
 *  states of a signed-in browser, not faults, so they are returned rather than
 *  thrown: an action that throws crosses the boundary as an HTTP 500, which is
 *  what filled the console with red while the handheld overview sat on its hold
 *  screen. A genuine failure still throws. */
export type DashboardRead =
  | { ok: true; data: DashboardData }
  | { ok: false; reason: "no-org" | "signed-out" | "no-access" };

export async function getDashboardData(): Promise<DashboardRead> {
  try {
    // The Overview's KPIs and pipeline money: for whoever may open the
    // Overview (lib/roleRoutes). A limited role is sent to its own home by
    // the page gate; a crafted call gets the same answer (2026-10-12).
    const { role } = await requireOrg();
    if (!roleMayOpen(role, "/dashboard")) return { ok: false, reason: "no-access" };
    return { ok: true, data: await buildDashboardData() };
  } catch (err) {
    if (err instanceof NoOrgError) return { ok: false, reason: "no-org" };
    if (err instanceof UnauthorizedError) return { ok: false, reason: "signed-out" };
    throw err;
  }
}
