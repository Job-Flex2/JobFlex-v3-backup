// DECK ESTIMATOR — VARIANT 1 (2026-10-18). The owner chose this variant the same day it was built, and it became the
// deck estimator itself: /dashboard/deck-estimator renders it (components/v3/deck-variant-1, gates and loaders there).
// This old lab address only sends a visitor on, the query string kept (?draft= / ?proposal= / ?client=).

import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function DeckVariantOneRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) for (const x of v) qs.append(k, x);
    else if (v !== undefined) qs.append(k, v);
  }
  const q = qs.toString();
  redirect(q ? `/dashboard/deck-estimator?${q}` : "/dashboard/deck-estimator");
}
