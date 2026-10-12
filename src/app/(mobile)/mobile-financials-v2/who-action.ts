"use server";

// WHO DID IT on the handheld Financials — the one read for the marks.
//
// The responsive shell mounts <MobileFinancials /> with no props, so the marks
// (who recorded each payment, logged each expense, drafted each change order)
// are asked for the same way the book is: one org-scoped action, fired beside
// `loadFinancials()` rather than after it, so the phone pays no second round
// trip. Same resolver the desk page reads
// (src/app/dashboard/financials/financials-who.ts); one trail, two editions.
//
// The organization comes from the SESSION and nowhere else — this file has one
// export and no arguments, for the same reason actions/financialsMobile.ts does.

import { requireRouteAccess } from "@/lib/orgContext";
import { getFinancialsWho, type FinancialsWho } from "@/app/dashboard/financials/financials-who";

export async function loadFinancialsWho(): Promise<FinancialsWho> {
  const { organizationId } = await requireRouteAccess("/dashboard/financials");
  return getFinancialsWho(organizationId);
}
