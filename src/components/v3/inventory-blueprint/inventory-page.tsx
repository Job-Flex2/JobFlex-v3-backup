// One trade's inventory page — the server half, shared by the three routes
// under the estimators (/dashboard/<trade>-estimator/inventory, 2026-10-10).
// The trade comes from the address, never from a switch: a roofer's page
// shows the roof book and the roof stock and nothing else.

import { redirect } from "next/navigation";
import { isLimitedRole, NoOrgError, requireOrg, UnauthorizedError } from "@/lib/orgContext";
import { loadInventoryPage, parseTab } from "@/lib/inventoryPage";
import { canEditBook } from "@/lib/priceBook";
import { INVENTORY_PATH, type TradeId } from "@/lib/inventory";
import { canUseDeckEstimator } from "@/lib/deck/access";
import { DeckComingSoon } from "@/components/v3/deck-estimator-blueprint/deck-coming-soon";
import { InventoryContent } from "./inventory-content";

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export async function TradeInventoryPage({ trade, searchParams }: { trade: TradeId; searchParams: Promise<Search> }) {
  const sp = await searchParams;
  let organizationId: string;
  let role: string;
  let user: { id: string; email?: string | null };
  try {
    const ctx = await requireOrg();
    organizationId = ctx.organizationId;
    role = ctx.role;
    user = ctx.user;
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect(`/auth/login?next=${encodeURIComponent(INVENTORY_PATH[trade])}`);
    if (err instanceof NoOrgError) redirect("/dashboard?error=forbidden");
    throw err;
  }
  // The deck estimator is Coming soon for customers (lib/deck/access): its inventory keeps the same door.
  if (trade === "deck" && !(await canUseDeckEstimator(user))) return <DeckComingSoon />;
  const tab = parseTab(one(sp.tab), trade);
  const data = await loadInventoryPage(organizationId, trade, tab);
  return <InventoryContent key={`${trade}-${tab}`} data={data} canEditBook={canEditBook(role)} canWriteStock={!isLimitedRole(role)} />;
}
