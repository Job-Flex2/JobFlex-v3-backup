// THE CLIENT DESIGNS THE DECK — /deck-design/<token>, the page a homeowner
// opens from the contractor's text or email (lib/deck/clientDesign). Public:
// the token is the key. A server component: it reads the link and the shop's
// name and hands the designer its props. No price is read or sent here.
import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { CLIENT_TOKEN_RE, clientLinkKey, parseClientLink } from "@/lib/deck/clientDesign";
import { DeckClientDesigner } from "@/components/v3/deck-client-design/deck-client-designer";

export const dynamic = "force-dynamic";

// One read serves both the metadata and the page.
const load = cache(async (token: string) => {
  if (!CLIENT_TOKEN_RE.test(token)) return null;
  const row = await db.syncState.findUnique({ where: { key: clientLinkKey(token) }, select: { cursor: true } }).catch(() => null);
  const link = row ? parseClientLink(row.cursor) : null;
  if (!link || link.token !== token) return null;
  const org = await db.organization.findUnique({ where: { id: link.orgId }, select: { name: true, logoUrl: true, phone: true, deletedAt: true } }).catch(() => null);
  if (!org || org.deletedAt) return null;
  // The proposal this design became (2026-10-13): the client sees it here once the contractor has SENT it — a
  // draft stays the contractor's until then. The same page the "Client view" button opens.
  const p = link.proposalId ? await db.proposal.findFirst({ where: { id: link.proposalId, organizationId: link.orgId }, select: { publicId: true, status: true, total: true, sentAt: true, acceptedAt: true } }).catch(() => null) : null;
  const proposal = p && p.status !== "DRAFT" && p.status !== "ARCHIVED" ? { url: `/portal/q/${p.publicId}`, status: p.status, sentAt: p.sentAt?.toISOString() ?? null, acceptedAt: p.acceptedAt?.toISOString() ?? null } : null;
  return { link, org, expired: Date.parse(link.expiresAt) < Date.now(), proposal };
});

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const found = await load(token);
  return {
    title: found ? `Design your deck · ${found.org.name}` : "Design your deck · JobFlex",
    // A tokened page addressed to one person; never a search result.
    robots: { index: false, follow: false },
  };
}

export default async function DeckDesignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await load(token);
  if (!found) return notFound();
  const { link, org, expired, proposal } = found;
  return (
    <DeckClientDesigner
      proposal={proposal}
      token={token}
      shop={{ name: org.name, logoUrl: org.logoUrl ?? null, phone: org.phone ?? null }}
      clientName={link.clientName}
      clientPhone={link.clientPhone}
      address={link.address}
      start={link.start}
      base={link.base}
      work={link.work}
      note={link.note}
      unsure={link.unsure}
      sentAt={link.sentAt}
      seenAt={link.seenAt}
      pricedAt={link.pricedAt}
      expired={expired}
    />
  );
}
