// THE CLIENT'S ROOM — /room-design/<token>, the page a homeowner opens from the contractor's text or email (Home
// Design Studio, 2026-10-19; lib/design/clientLink). Public: the token is the key. The room in 3D, the finishes the
// contractor offers, what each choice adds or saves (when the contractor shows prices), and Approve. The shop's own
// line prices never leave the server — the page gets the design's total and each choice's difference.
import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { LINK_TOKEN_RE, linkKey, linkPrices, parseLink } from "@/lib/design/clientLink";
import { RoomClient } from "@/components/v3/design-studio/room-client";

export const dynamic = "force-dynamic";

const load = cache(async (token: string) => {
  if (!LINK_TOKEN_RE.test(token)) return null;
  const row = await db.syncState.findUnique({ where: { key: linkKey(token) }, select: { cursor: true } }).catch(() => null);
  const link = parseLink(row?.cursor);
  if (!link || link.token !== token) return null;
  const org = await db.organization.findUnique({ where: { id: link.orgId }, select: { name: true, logoUrl: true, phone: true, deletedAt: true } }).catch(() => null);
  if (!org || org.deletedAt) return null;
  return { link, org, expired: Date.parse(link.expiresAt) < Date.now() };
});

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const found = await load(token);
  return {
    title: found ? `${found.link.title} · ${found.org.name}` : "Your design · JobFlex",
    // Addressed to one client; never a search result.
    robots: { index: false, follow: false },
  };
}

export default async function RoomDesignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await load(token);
  if (!found) return notFound();
  const { link, org, expired } = found;
  // Opened: the first time someone not signed in to JobFlex opens it (the contractor checking their own link isn't).
  if (!link.openedAt) {
    const session = await auth().catch(() => null);
    if (!session?.user) await db.syncState.update({ where: { key: linkKey(token) }, data: { cursor: JSON.stringify({ ...link, openedAt: new Date().toISOString() }) } }).catch(() => {});
  }
  return (
    <RoomClient
      token={token}
      shop={{ name: org.name, logoUrl: org.logoUrl ?? null, phone: org.phone ?? null }}
      clientName={link.clientName}
      title={link.title}
      roomName={link.roomName}
      address={link.address}
      doc={link.doc}
      room={link.room}
      options={link.options}
      prices={link.showPrice ? linkPrices(link) : null}
      picks={link.picks}
      note={link.note}
      approved={link.status === "approved" ? { at: link.approvedAt ?? link.picksAt ?? link.createdAt, name: link.approvedName ?? link.clientName } : null}
      expired={expired}
    />
  );
}
