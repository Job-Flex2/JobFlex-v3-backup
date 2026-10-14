// THE SHOP'S CLIENT DESIGN LINKS, READ FOR OTHER SURFACES (2026-10-13, owner: "show that it came back in the
// studio while you're designing somebody else; in the Deck Studio folder the client's name and the design; on the
// proposal's line that you can open the client's design"). Server only (db). The links live in SyncState under
// `deckclient:<token>` with the shop's index under `deckclients:<orgId>` (lib/deck/clientDesign); this module
// reads them for the proposals book, the proposal builder, the sidebar badge and the studio's inbox, and writes
// the two small facts other surfaces set: the proposal a link belongs to, and when the contractor looked.
import { db } from "@/lib/db";
import { CLIENT_TOKEN_RE, clientIndexKey, clientLinkKey, clientLinkRow, isUnseenReturn, parseClientLink, type ClientDesignLink, type ClientLinkRow } from "./clientDesign";
import { proposalRef } from "@/components/v3/manual-card-lab/manual-blueprint/manual-blueprint-bridge";

/** The rows with their proposals named (ref, title, status, address) — one read for the lot. */
export async function withProposals(rows: ClientLinkRow[], organizationId: string): Promise<ClientLinkRow[]> {
  const ids = [...new Set(rows.map((r) => r.proposalId).filter((id): id is string => !!id))];
  if (!ids.length) return rows;
  const found = await db.proposal.findMany({ where: { id: { in: ids }, organizationId }, select: { id: true, publicId: true, title: true, status: true, address: true } }).catch(() => []);
  const by = new Map(found.map((p) => [p.id, { ref: proposalRef(p.publicId), title: p.title, status: p.status, address: p.address }]));
  return rows.map((r) => (r.proposalId && by.has(r.proposalId) ? { ...r, proposal: by.get(r.proposalId) ?? null } : r));
}

export async function readClientIndex(organizationId: string): Promise<string[]> {
  const row = await db.syncState.findUnique({ where: { key: clientIndexKey(organizationId) }, select: { cursor: true } }).catch(() => null);
  try {
    const list = row ? (JSON.parse(row.cursor) as unknown) : [];
    return Array.isArray(list) ? list.filter((t): t is string => typeof t === "string" && CLIENT_TOKEN_RE.test(t)) : [];
  } catch {
    return [];
  }
}

/** Every live link of the shop, newest first. One index read; nothing more when the shop has none. */
export async function readOrgClientLinks(organizationId: string): Promise<ClientDesignLink[]> {
  const tokens = await readClientIndex(organizationId);
  if (!tokens.length) return [];
  const rows = await db.syncState.findMany({ where: { key: { in: tokens.map(clientLinkKey) } }, select: { cursor: true } }).catch(() => []);
  const byToken = new Map<string, ClientDesignLink>();
  for (const r of rows) {
    const l = parseClientLink(r.cursor);
    if (l && l.orgId === organizationId) byToken.set(l.token, l);
  }
  return tokens.map((t) => byToken.get(t)).filter((l): l is ClientDesignLink => !!l);
}

/** The newest link of each proposal — what its row and its builder show. */
export async function clientLinksByProposal(organizationId: string): Promise<Map<string, ClientLinkRow>> {
  const out = new Map<string, ClientLinkRow>();
  const now = Date.now();
  for (const l of await readOrgClientLinks(organizationId)) {
    if (l.proposalId && !out.has(l.proposalId)) out.set(l.proposalId, clientLinkRow(l, now));
  }
  return out;
}

/** Designs sent back that nobody has opened yet — the badge and the studio's inbox. */
export async function unseenClientReturns(organizationId: string): Promise<ClientLinkRow[]> {
  const now = Date.now();
  return (await readOrgClientLinks(organizationId)).filter(isUnseenReturn).map((l) => clientLinkRow(l, now));
}

async function readOwnLink(token: string, organizationId: string): Promise<ClientDesignLink | null> {
  if (!CLIENT_TOKEN_RE.test(token)) return null;
  const row = await db.syncState.findUnique({ where: { key: clientLinkKey(token) }, select: { cursor: true } }).catch(() => null);
  const link = row ? parseClientLink(row.cursor) : null;
  return link && link.token === token && link.orgId === organizationId ? link : null;
}

const writeLink = (link: ClientDesignLink) =>
  db.syncState.upsert({ where: { key: clientLinkKey(link.token) }, create: { key: clientLinkKey(link.token), cursor: JSON.stringify(link) }, update: { cursor: JSON.stringify(link) } });

/** The returned design was priced onto this proposal: the link follows it, and the stage moves to "priced". Quiet on any failure (it is a pointer, never the price). */
export async function tieClientLinkToProposal(token: string | null | undefined, organizationId: string, proposalId: string): Promise<void> {
  if (!token) return;
  try {
    const link = await readOwnLink(token, organizationId);
    if (!link) return;
    const now = new Date().toISOString();
    await writeLink({ ...link, proposalId, pricedAt: now, seenAt: link.seenAt ?? now });
  } catch {
    /* the proposal stands either way */
  }
}

/** A draft that came back before the link's token was written on it (before 2026-10-13): its link, by the draft id. */
export async function clientLinkOfDraft(draftId: string, organizationId: string): Promise<ClientDesignLink | null> {
  if (!/^[a-f0-9-]{8,40}$/i.test(draftId)) return null;
  return (await readOrgClientLinks(organizationId)).find((l) => l.draftId === draftId) ?? null;
}

/** The contractor opened what came back: it stops blooming. Returns the link as it stands. */
export async function markClientLinkSeen(token: string | null | undefined, organizationId: string): Promise<ClientDesignLink | null> {
  if (!token) return null;
  try {
    const link = await readOwnLink(token, organizationId);
    if (!link) return null;
    if (!isUnseenReturn(link)) return link;
    const seen = { ...link, seenAt: new Date().toISOString() };
    await writeLink(seen);
    return seen;
  } catch {
    return null;
  }
}
