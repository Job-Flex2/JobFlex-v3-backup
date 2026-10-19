// THE DECK ESTIMATOR (2026-10-04) — Blueprint edition. Owner: "draw the deck size,
// select what it is built with, it follows the code, it starts building in
// 3D, and it gives you the material package and the price."
//
// The engine is pure (src/lib/deck) and runs in the browser, so every change
// re-frames, re-counts and re-prices the deck at once; the server keeps only
// the shop's own deck prices and writes the proposal (actions/deckEstimator).
//
// Coming soon (owner, 2026-10-04): every account sees the sidebar row with its
// Coming soon mark and, here, a page that says what is coming; admins (the
// platform-admin flag, the admin console's sign-in, the owner's own account —
// lib/deck/access) get the working estimator to test.
//
// 2026-10-18: the owner chose Variant 1 of the Deck Lab ("One decision at a
// time", components/v3/deck-variant-1) and it is this page's studio now. The
// gates and the loaders below are unchanged; only the component was swapped.
// The old studio (deck-estimator-blueprint/deck-studio.tsx) is kept, unmounted.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { canUseDeckEstimator } from "@/lib/deck/access";
import { editionFacts } from "@/lib/editionAccess";
import { hasEdition } from "@/lib/editions";
import { isLimitedRole, NoOrgError, requireOrg, UnauthorizedError } from "@/lib/orgContext";
import { readDeckRateBook } from "@/lib/deck/rateBookStore";
import { parseStateZip } from "@/lib/fence/market";
import { DeckV1Studio } from "@/components/v3/deck-variant-1/deck-v1-studio";
import { DeckComingSoon } from "@/components/v3/deck-estimator-blueprint/deck-coming-soon";
import { loadDeckDraft, loadDeckFromProposal, type ReturnedClientDesign } from "@/actions/deckEstimator";
import type { DeckDesign } from "@/lib/deck/design";
import type { LinkedDeckProposal } from "@/lib/deck/proposalEdit";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "JobFlex · Deck Estimator",
  description: "Deck estimator — size the deck, frame it to the code tables, watch it build in 3D, and price the material package.",
};

export default async function DeckEstimatorPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  let organizationId: string;
  let open = false;
  let viaEdition = false;
  try {
    const ctx = await requireOrg();
    organizationId = ctx.organizationId;
    if (isLimitedRole(ctx.role)) redirect("/dashboard?error=forbidden");
    open = await canUseDeckEstimator(ctx.user, ctx.organizationId);
    // The Deck Studio edition (lib/editions): a subscriber works here as of right, with no admin notice.
    viaEdition = open && (await editionFacts(ctx.organizationId).then((f) => hasEdition(f, "deck")).catch(() => false));
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login?next=%2Fdashboard%2Fdeck-estimator");
    if (err instanceof NoOrgError) redirect("/dashboard?error=forbidden");
    throw err;
  }
  if (!open) return <DeckComingSoon />;
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  // Opened from a client's record (`?client=`): the client's address is in the field. Read from this org only.
  let initialAddress: string | undefined;
  let clientId: string | undefined;
  const asked = one(params.client);
  if (asked) {
    const client = await db.client.findFirst({ where: { id: asked, organizationId, deletedAt: null }, select: { id: true, address: true, city: true, state: true, zip: true } });
    if (client) {
      clientId = client.id;
      if (client.address) initialAddress = [client.address, client.city, [client.state, client.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    }
  }
  const [book, org] = await Promise.all([readDeckRateBook(organizationId), db.organization.findUnique({ where: { id: organizationId }, select: { address: true } })]);
  // The shop's own state picks the lumber a new deck starts with, until a job address says otherwise.
  const homeState = parseStateZip(org?.address).state;
  // Opened again (M3): a saved draft (`?draft=`) or the deck a proposal carries (`?proposal=`).
  // Either way the proposal it is on comes along: the studio updates that one in place (2026-10-12).
  let opened: { design: DeckDesign; address: string | null; title: string; draftId: string | null; from: "draft" | "proposal"; proposal: LinkedDeckProposal | null; client: ReturnedClientDesign | null } | null = null;
  const draftId = one(params.draft);
  const proposalId = one(params.proposal);
  if (draftId) {
    const res = await loadDeckDraft(draftId);
    if (res.ok) opened = { design: res.draft.design, address: res.draft.address, title: res.draft.title, draftId: res.draft.id, from: "draft", proposal: res.proposal, client: res.client };
  } else if (proposalId) {
    const res = await loadDeckFromProposal(proposalId);
    if (res.ok) opened = { design: res.design, address: res.address, title: res.title, draftId: null, from: "proposal", proposal: res.proposal, client: null };
  }
  // Keyed by what was opened: a client-side push to another draft or proposal (the studio's own Open links) mounts a
  // fresh studio on it, as the old studio's full page loads did.
  return <DeckV1Studio key={opened ? `${opened.from}:${opened.draftId ?? proposalId}` : `new:${clientId ?? ""}`} initialBook={book} homeState={homeState} initialAddress={opened?.address ?? initialAddress} clientId={clientId} adminPreview={!viaEdition} opened={opened} />;
}
