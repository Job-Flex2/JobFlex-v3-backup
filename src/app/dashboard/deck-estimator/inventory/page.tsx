// Deck inventory — the deck estimator's price book and stock, under the deck
// estimator like the roof's and the fence's (2026-10-10). The page itself is
// TradeInventoryPage; the trade comes from this address.

import type { Metadata } from "next";
import { TradeInventoryPage } from "@/components/v3/inventory-blueprint/inventory-page";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "JobFlex · Deck inventory", description: "Your deck price book and stock." };

export default function DeckInventoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <TradeInventoryPage trade="deck" searchParams={searchParams} />;
}
