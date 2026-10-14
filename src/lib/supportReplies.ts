import "server-only";
// THE THREAD UNDER A SUPPORT TICKET (2026-10-14): the admins' answers, kept
// as a SyncState JSON list per ticket (no schema change), oldest first; and
// who a ticket's answer goes to. The letter and the checks are the pure
// lib/supportReply; the send is actions/admin replyToSupportTicket.
import { db } from "@/lib/db";
import type { SupportReply } from "@/lib/supportReply";

const KEY = (ticketId: string) => `supportReplies:${ticketId}`;
const CAP = 50;

function parse(cursor: string | null | undefined): SupportReply[] {
  if (!cursor) return [];
  try {
    const v = JSON.parse(cursor) as unknown;
    return Array.isArray(v) ? v.filter((r): r is SupportReply => !!r && typeof r === "object" && typeof (r as SupportReply).body === "string" && typeof (r as SupportReply).at === "string") : [];
  } catch {
    return [];
  }
}

export async function readSupportReplies(ticketId: string): Promise<SupportReply[]> {
  const row = await db.syncState.findUnique({ where: { key: KEY(ticketId) } }).catch(() => null);
  return parse(row?.cursor);
}

/** The threads of many tickets in one read, keyed by ticket id (a ticket with none is absent). */
export async function repliesForTickets(ticketIds: string[]): Promise<Record<string, SupportReply[]>> {
  if (!ticketIds.length) return {};
  const rows = await db.syncState.findMany({ where: { key: { in: ticketIds.map(KEY) } } }).catch(() => []);
  const out: Record<string, SupportReply[]> = {};
  for (const r of rows) {
    const id = r.key.slice("supportReplies:".length);
    const list = parse(r.cursor);
    if (list.length) out[id] = list;
  }
  return out;
}

/** The answer kept under its ticket; the thread back. */
export async function addSupportReply(ticketId: string, reply: SupportReply): Promise<SupportReply[]> {
  const list = [...(await readSupportReplies(ticketId)), reply].slice(-CAP);
  const cursor = JSON.stringify(list);
  await db.syncState.upsert({ where: { key: KEY(ticketId) }, create: { key: KEY(ticketId), cursor }, update: { cursor } });
  return list;
}

/** Where a ticket's answer goes: whoever filed it; else the account's owner; else its billing address. */
export async function recipientForTicket(ticket: { organizationId: string; user?: { email: string | null } | null; organization?: { billingEmail: string | null } | null }): Promise<string | null> {
  if (ticket.user?.email) return ticket.user.email;
  const owner = await db.membership.findFirst({ where: { organizationId: ticket.organizationId, role: "OWNER" }, orderBy: { createdAt: "asc" }, select: { user: { select: { email: true } } } }).catch(() => null);
  return owner?.user.email ?? ticket.organization?.billingEmail ?? null;
}

/** The same, for a page listing many tickets: one read for the owners. */
export async function recipientsForTickets(tickets: Array<{ id: string; organizationId: string; user?: { email: string | null } | null; organization?: { billingEmail: string | null } | null }>): Promise<Record<string, string | null>> {
  const orgIds = [...new Set(tickets.filter((t) => !t.user?.email).map((t) => t.organizationId))];
  const owners = new Map<string, string>();
  if (orgIds.length) {
    const rows = await db.membership.findMany({ where: { organizationId: { in: orgIds }, role: "OWNER" }, orderBy: { createdAt: "asc" }, select: { organizationId: true, user: { select: { email: true } } } }).catch(() => []);
    for (const r of rows) if (r.user.email && !owners.has(r.organizationId)) owners.set(r.organizationId, r.user.email);
  }
  const out: Record<string, string | null> = {};
  for (const t of tickets) out[t.id] = t.user?.email ?? owners.get(t.organizationId) ?? t.organization?.billingEmail ?? null;
  return out;
}
