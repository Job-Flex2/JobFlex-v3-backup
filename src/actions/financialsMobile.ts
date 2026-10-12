"use server";

// The handheld Financials surface's ONE read.
//
// The responsive shell mounts <MobileFinancials /> with no props (it is a
// props-less entry in HANDHELD_SURFACES), so the page cannot be handed the
// server data the desktop sheet is given. It asks for it instead, through this
// action, which reads exactly what src/app/dashboard/financials/page.tsx reads
// — the same lib/financialsSnapshot module — so the two editions of
// /dashboard/financials can never describe different books.
//
// The organization comes from the SESSION and nowhere else. Every export of a
// "use server" file is a callable endpoint, so a read taking an organizationId
// would be an org-picker for anyone with a cookie; that is why this file has
// exactly one export and no arguments.

import { requireRouteAccess } from "@/lib/orgContext";
import { getFinancialsSnapshot, type FinancialsSnapshot } from "@/lib/financialsSnapshot";

export async function loadFinancials(): Promise<FinancialsSnapshot> {
  // The company's money: for whoever may open Financials (lib/roleRoutes).
  const { organizationId } = await requireRouteAccess("/dashboard/financials");
  return getFinancialsSnapshot(organizationId);
}
