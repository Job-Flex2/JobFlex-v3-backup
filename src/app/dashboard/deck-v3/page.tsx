// DECK ESTIMATOR — VARIANT 3, "A builder's spec sheet" (2026-10-18). One of five designs of the deck estimator laid
// side by side for the owner to choose from; the live page is /dashboard/deck-estimator. Same gates, same loaders,
// same engine and actions — only the page is organised as one construction sheet (components/v3/deck-variant-3).
//
// Top-level under /dashboard on purpose: the shell's pageKey() reads the first segment, so a child of deck-estimator
// would inherit its page key and styles.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { canUseDeckEstimator } from "@/lib/deck/access";
import { editionFacts } from "@/lib/editionAccess";
import { hasEdition } from "@/lib/editions";
import { isLimitedRole, NoOrgError, requireOrg, UnauthorizedError } from "@/lib/orgContext";
import { readDeckRateBook } from "@/lib/deck/rateBookStore";
import { parseStateZip } from "@/lib/fence/market";
import { DeckSheet } from "@/components/v3/deck-variant-3/deck-sheet";
import { DeckComingSoon } from "@/components/v3/deck-estimator-blueprint/deck-coming-soon";
import { loadDeckDraft, loadDeckFromProposal, type ReturnedClientDesign } from "@/actions/deckEstimator";
import type { DeckDesign } from "@/lib/deck/design";
import type { LinkedDeckProposal } from "@/lib/deck/proposalEdit";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "JobFlex · Deck Estimator — Variant 3",
  description: "Deck estimator as a builder's spec sheet — the whole job on one sheet, the drawing, the price and the checks beside it.",
};

export default async function DeckVariant3Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
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
    if (err instanceof UnauthorizedError) redirect("/auth/login?next=%2Fdashboard%2Fdeck-v3");
    if (err instanceof NoOrgError) redirect("/dashboard?error=forbidden");
    throw err;
  }
  if (!open) return <DeckComingSoon />;
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  // Opened from a client's record (`?client=`): the client's address is in the field, the name in the title block. Read from this org only.
  let initialAddress: string | undefined;
  let clientId: string | undefined;
  let clientName: string | null = null;
  const asked = one(params.client);
  if (asked) {
    const client = await db.client.findFirst({ where: { id: asked, organizationId, deletedAt: null }, select: { id: true, name: true, address: true, city: true, state: true, zip: true } });
    if (client) {
      clientId = client.id;
      clientName = client.name || null;
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
  const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  // Keyed by what was opened: a client-side jump to another draft (the router, not a hard load) starts a fresh sheet.
  return <DeckSheet key={draftId ?? (proposalId ? `p:${proposalId}` : asked ? `c:${asked}` : "new")} initialBook={book} homeState={homeState} initialAddress={opened?.address ?? initialAddress} clientId={clientId} clientName={clientName} today={today} adminPreview={!viaEdition} opened={opened} />;
}
