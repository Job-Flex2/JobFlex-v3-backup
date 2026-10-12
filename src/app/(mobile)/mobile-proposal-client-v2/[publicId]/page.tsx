// CLIENT PROPOSAL · HANDHELD — the direct-review entry point.
// Route: /mobile-proposal-client-v2/[publicId].
//
// The same component the LIVE /portal/q/[publicId] URL serves at ≤768px,
// mounted at a stable review URL so the handheld build can be opened without
// having to shrink a window. Both routes import
// src/components/v3/mobile-proposal-client/mobile-proposal-client.tsx — there
// is one implementation and nothing to keep in sync.
//
// This is a SERVER component and stays one. The Prisma read runs here, the
// formatting runs here, and the client component receives a plain object; the
// page never fetches its own proposal. Same query and same includes as the
// (portal) route — no data-layer change, no new endpoint, no schema change.
//
// ── ONE DELIBERATE DIFFERENCE FROM THE LIVE ROUTE ──────────────────────────
// It does NOT write the VIEWED side-effect. The live route increments
// `viewCount`, stamps `viewedAt` and promotes SENT → VIEWED, because there a
// load genuinely IS the homeowner opening the proposal. Here a load is a
// reviewer opening a screenshot target, and telling a contractor their client
// looked at the quote eleven times because someone was checking a layout at
// five widths would be worse than useless — it is data the contractor acts on.
// The read is otherwise identical, so every state renders exactly as it does
// on the live URL.
//
// Not auth-gated, deliberately: middleware matches /dashboard, /admin,
// /influencer and /v3, and this surface — like the portal it mirrors — is
// addressed by an unguessable publicId, which is the existing access model for
// this proposal. No new exposure: /portal/q/<publicId> already serves the same
// content to the same identifier.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { money, longDate } from "@/lib/format";
import { buildPortalView, type PortalRating } from "@/components/v3/mobile-proposal-client/portal-view";
import { buildPortalPayModel } from "@/lib/payments/portalModel";
import { formatAvg, orgPublicRating, publicReviewsPath } from "@/lib/reviews/publicSummary";
import { MobileProposalClient } from "@/components/v3/mobile-proposal-client/mobile-proposal-client";
import { BrandAccentStyle } from "@/components/portal/brand-accent-style";
import { proposalPictures } from "@/lib/proposalPictures";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ publicId: string }>;
}): Promise<Metadata> {
  const { publicId } = await params;
  const proposal = await db.proposal.findUnique({
    where: { publicId },
    select: { organization: { select: { name: true } } },
  });
  return { title: proposal ? `${proposal.organization.name} · Proposal` : "Proposal" };
}

export default async function MobileProposalClientPage({
  params,
}: {
  params: Promise<{ publicId: string }>;
}) {
  const { publicId } = await params;
  const proposal = await db.proposal.findUnique({
    where: { publicId },
    include: {
      lineItems: { orderBy: { position: "asc" } },
      installments: { orderBy: { position: "asc" } },
      changeOrders: { where: { status: "APPROVED" }, select: { status: true, total: true } },
      client: true,
      organization: {
        select: {
          name: true,
          slug: true,
          logoUrl: true,
          primaryColor: true,
          phone: true,
          address: true,
          deletedAt: true,
          paymentSettingsJson: true,
          paymentConnections: true,
        },
      },
    },
  });

  if (!proposal || proposal.organization.deletedAt) return notFound();
  const pay = await buildPortalPayModel(publicId, proposal, proposal.organization, { money, longDate });
  // Same badge the real portal shows: public (not-hidden) reviews, or nothing.
  const pub = await orgPublicRating(proposal.organizationId);
  const rating: PortalRating | null =
    pub.count > 0 && pub.avg != null
      ? { avg: formatAvg(pub.avg) as string, count: pub.count, href: publicReviewsPath(proposal.organization.slug) }
      : null;

  // The client's own job in pictures (lib/proposalPictures, 2026-09-23) —
  // the same set the desk page shows.
  const pictures = await proposalPictures({ id: proposal.id, publicId, trade: proposal.trade, beforePhotos: proposal.beforePhotos }).catch(() => []);

  return (
    <>
    <BrandAccentStyle color={proposal.organization.primaryColor} />
    <MobileProposalClient
      view={buildPortalView(publicId, proposal, { money, longDate }, { pay, terms: "", rating, pictures })}
    />
    </>
  );
}
