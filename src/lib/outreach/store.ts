// WHERE THE OUTREACH LIST LIVES (2026-10-23) — server only. One SyncState row per contractor (`outreach:p:<id>`, no
// schema change), the whole list read by its prefix. The repo is public: nothing here but the shape — the list itself
// is only ever in the database.
import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import type { Prospect } from "./rules";

const PREFIX = "outreach:p:";
const key = (id: string) => `${PREFIX}${id}`;
export const PROSPECT_ID_RE = /^[a-z0-9]{12,24}$/;
/** The id the unsubscribe link carries for a contractor who is not an account (lib/adminMail/optout). */
export const optOutId = (id: string) => `prospect_${id}`;

export const newProspectId = () => randomBytes(9).toString("hex");

function parse(cursor: string): Prospect | null {
  try {
    const p = JSON.parse(cursor) as Prospect;
    return p && typeof p.id === "string" && Array.isArray(p.calls) ? p : null;
  } catch {
    return null;
  }
}

export async function readProspect(id: string): Promise<Prospect | null> {
  if (!PROSPECT_ID_RE.test(id)) return null;
  const row = await db.syncState.findUnique({ where: { key: key(id) }, select: { cursor: true } }).catch(() => null);
  return row ? parse(row.cursor) : null;
}

export async function writeProspect(p: Prospect): Promise<Prospect> {
  const next = { ...p, updatedAt: new Date().toISOString() };
  const cursor = JSON.stringify(next);
  await db.syncState.upsert({ where: { key: key(p.id) }, create: { key: key(p.id), cursor }, update: { cursor } });
  return next;
}

/** Read, change, write — one contractor. */
export async function updateProspect(id: string, change: (p: Prospect) => Prospect): Promise<Prospect | null> {
  const p = await readProspect(id);
  return p ? writeProspect(change(p)) : null;
}

/** The whole list, newest first. */
export async function listProspects(): Promise<Prospect[]> {
  const rows = await db.syncState.findMany({ where: { key: { startsWith: PREFIX } }, select: { cursor: true } });
  return rows
    .map((r) => parse(r.cursor))
    .filter((p): p is Prospect => !!p)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function deleteProspect(id: string): Promise<void> {
  if (PROSPECT_ID_RE.test(id)) await db.syncState.deleteMany({ where: { key: key(id) } });
}
