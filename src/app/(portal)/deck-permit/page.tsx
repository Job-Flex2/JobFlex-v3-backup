// THE PERMIT SHEET (Deck Studio M3, 2026-10-10) — a printable set for the
// building office: the plan, the framing plan, the front elevation, the
// schedules (joists, beams, posts, footings, ledger, stairs, rails, roof) with
// the table each number was read from, and the notes. Opened from the studio
// in a new tab with the design in the address (`?d=`), or from a saved draft
// (`?draft=`) or proposal (`?proposal=`). Behind the same gate as the studio.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { canUseDeckEstimator } from "@/lib/deck/access";
import { NoOrgError, requireOrg, UnauthorizedError } from "@/lib/orgContext";
import { normalizeDeckDesign, type DeckDesign } from "@/lib/deck/design";
import { loadDeckDraft, loadDeckFromProposal } from "@/actions/deckEstimator";
import { DeckPermitSheet } from "@/components/v3/deck-permit/deck-permit";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "JobFlex · Deck permit sheet", description: "The plan, the framing and the schedules for the building office." };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function DeckPermitPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  let organizationId: string;
  try {
    const ctx = await requireOrg();
    organizationId = ctx.organizationId;
    if (!(await canUseDeckEstimator(ctx.user))) redirect("/dashboard/deck-estimator");
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
      const raw = JSON.parse(decodeURIComponent(escape(Buffer.from(packed, "base64").toString("binary")))) as { design?: unknown; address?: unknown };
      design = normalizeDeckDesign(raw.design);
      address = typeof raw.address === "string" ? raw.address.slice(0, 300) : null;
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
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { name: true, address: true, phone: true } }).catch(() => null);
  return <DeckPermitSheet design={design} address={address} title={title} shop={{ name: org?.name ?? "", address: org?.address ?? null, phone: org?.phone ?? null, email: null }} />;
}
