// DECK ESTIMATOR — VARIANT 5 (route: /dashboard/deck-v5, 2026-10-18): "start from the deck people ask for". One of five
// competing designs of the deck estimator (the Deck Lab); same features as /dashboard/deck-estimator, a gallery of the
// decks people ask for first, then a two-pane editor. The gates and the loaders are the live page's, copied exactly:
// requireOrg, the limited-role redirect, canUseDeckEstimator → DeckComingSoon, the rate book, the shop's home state,
// and `?client=` / `?draft=` / `?proposal=`. Top-level under /dashboard on purpose: the shell's pageKey() reads the first
// segment, so a child of deck-estimator would inherit its page key and styles.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { canUseDeckEstimator } from "@/lib/deck/access";
import { editionFacts } from "@/lib/editionAccess";
import { hasEdition } from "@/lib/editions";
import { isLimitedRole, NoOrgError, requireOrg, UnauthorizedError } from "@/lib/orgContext";
import { readDeckRateBook } from "@/lib/deck/rateBookStore";
import { parseStateZip } from "@/lib/fence/market";
import { DeckV5Studio } from "@/components/v3/deck-variant-5/deck-v5-studio";
import { DeckComingSoon } from "@/components/v3/deck-estimator-blueprint/deck-coming-soon";
import { loadDeckDraft, loadDeckFromProposal, type ReturnedClientDesign } from "@/actions/deckEstimator";
import type { DeckDesign } from "@/lib/deck/design";
import type { LinkedDeckProposal } from "@/lib/deck/proposalEdit";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "JobFlex · Deck Estimator — Variant 5",
  description: "Deck estimator, variant 5 — start from the deck people ask for: pick it from pictures, change the few things that usually change.",
};

export default async function DeckVariant5Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
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
    if (err instanceof UnauthorizedError) redirect("/auth/login?next=%2Fdashboard%2Fdeck-v5");
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
  // Opened again: a saved draft (`?draft=`) or the deck a proposal carries (`?proposal=`) — the gallery is skipped.
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
  // A client-side move to another draft (router.push) mounts a fresh studio: its state starts from what was opened.
  const key = `${draftId ?? ""}|${proposalId ?? ""}|${clientId ?? ""}`;
  return <DeckV5Studio key={key} initialBook={book} homeState={homeState} initialAddress={opened?.address ?? initialAddress} clientId={clientId} adminPreview={!viaEdition} opened={opened} />;
}
