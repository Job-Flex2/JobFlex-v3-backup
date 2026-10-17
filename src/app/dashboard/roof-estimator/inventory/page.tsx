// Roofing inventory — the roofing price book and stock, under the roof estimator
// (owner, 2026-10-10). The page itself is TradeInventoryPage.

import type { Metadata } from "next";
import { TradeInventoryPage } from "@/components/v3/inventory-blueprint/inventory-page";
import { BackToEstimate } from "@/components/v3/roof-estimator-blueprint/back-to-estimate";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "JobFlex · Roofing inventory", description: "Your roofing price book and stock." };

export default async function RoofingInventoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // Opened from the estimate's "Manage roof types": the way back floats over the page (2026-10-16).
  const fromEstimate = (await searchParams).from === "estimate";
  return (
    <>
      <TradeInventoryPage trade="roof" searchParams={searchParams} />
      {fromEstimate ? <BackToEstimate /> : null}
    </>
  );
}
