// THE MATERIAL LIST (Deck Studio, 2026-10-11; owner: "a list of all materials
// for the contractor to send to the lumber yard to get a price, or give to the
// installer to purchase") — a printable page with the takeoff in the lengths a
// yard sells, opened from the studio in a new tab with the design in the
// address (`?d=`), or from a saved draft (`?draft=`) or proposal
// (`?proposal=`); `?for=yard` (no prices, a request for a delivered quote) or
// `?for=installer` (to buy, with the studio's estimated prices). Behind the same
// gate as the studio. Never shown to the client.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { canUseDeckEstimator } from "@/lib/deck/access";
import { NoOrgError, requireOrg, UnauthorizedError } from "@/lib/orgContext";
import { normalizeDeckDesign, type DeckDesign } from "@/lib/deck/design";
import { readDeckRateBook } from "@/lib/deck/rateBookStore";
import { parseStateZip } from "@/lib/fence/market";
import { loadDeckDraft, loadDeckFromProposal } from "@/actions/deckEstimator";
import { DeckMaterialSheet } from "@/components/v3/deck-permit/deck-materials";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "JobFlex · Deck material list", description: "The deck's materials, to send to the lumber yard for a quote or to the installer to buy." };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function DeckMaterialsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  let organizationId: string;
  try {
    const ctx = await requireOrg();
    organizationId = ctx.organizationId;
    if (!(await canUseDeckEstimator(ctx.user, ctx.organizationId))) redirect("/dashboard/deck-estimator");
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login?next=%2Fdashboard%2Fdeck-estimator");
    if (err instanceof NoOrgError) redirect("/dashboard?error=forbidden");
    throw err;
  }
  const params = await searchParams;
  let design: DeckDesign | null = null;
  let address: string | null = null;
  let title = "Deck";
  const packed = one(params.d);
  const draftId = one(params.draft);
  const proposalId = one(params.proposal);
  if (packed) {
    try {
      const raw = JSON.parse(decodeURIComponent(escape(Buffer.from(packed, "base64").toString("binary")))) as { design?: unknown; address?: unknown; title?: unknown };
      design = normalizeDeckDesign(raw.design);
      address = typeof raw.address === "string" && raw.address.trim() ? raw.address.slice(0, 300) : null;
      if (typeof raw.title === "string" && raw.title.trim()) title = raw.title.slice(0, 120);
    } catch {
      design = null;
    }
  } else if (draftId) {
    const res = await loadDeckDraft(draftId);
    if (res.ok) {
      design = res.draft.design;
      address = res.draft.address;
      title = res.draft.title;
    }
  } else if (proposalId) {
    const res = await loadDeckFromProposal(proposalId);
    if (res.ok) {
      design = res.design;
      address = res.address;
      title = res.title;
    }
  }
  const [book, org] = await Promise.all([
    readDeckRateBook(organizationId),
    db.organization.findUnique({ where: { id: organizationId }, select: { name: true, address: true, phone: true } }).catch(() => null),
  ]);
  const forWhom = one(params.for) === "installer" ? "installer" : "yard";
  return (
    <DeckMaterialSheet
      design={design}
      address={address}
      title={title}
      shop={{ name: org?.name ?? "", address: org?.address ?? null, phone: org?.phone ?? null }}
      book={book}
      homeState={parseStateZip(org?.address ?? null).state ?? null}
      initialFor={forWhom}
    />
  );
}
