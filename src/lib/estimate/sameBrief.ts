// SAME BRIEF, SAME ESTIMATE (owner, 2026-10-21: "check the smart estimator — why it gives a different price for the
// same prompt"). The model is not deterministic even at temperature 0 with a seed — the audit of 2026-09-17 had one
// brief come back 4% to 98% apart — and every re-ask (thin answer, a range, a broken rule) branches from wherever the
// first answer landed. So the answer to a question already asked is the answer it got: an estimate is kept under the
// fingerprint of the exact question the model was sent — the built prompt (which carries the brief, the place and its
// price index, the price book, the procedures, /admin/prompts edits and the tier), the photos, the model, the
// company's pricing and markup, the lines priced without the model — and the same question within SAME_DAYS gets it
// back, at no AI cost. Anything that changes the question (a new price book, another city, an answer to an intake
// question, a photo) is a new fingerprint. "Ask for a fresh estimate" asks the model again and keeps the new answer.
// No schema: one SyncState row an estimate, `smartsame:<orgId>:<fingerprint>`, and an index per shop that holds the
// newest SAME_MAX.
import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { SAME_BRIEF_NOTE, type GeneratedEstimate } from "@/lib/estimatorSchema";

export const SAME_DAYS = 30;
const SAME_MAX = 300;
const rowKey = (orgId: string, fp: string) => `smartsame:${orgId}:${fp}`;
const indexKey = (orgId: string) => `smartsame:${orgId}`;

/** What the contractor reads under the ledger when the estimate is the one this brief got before. */
export const SAME_NOTE = SAME_BRIEF_NOTE;

/** The fingerprint of one question to the model: everything that decides the answer, nothing that doesn't. */
export function briefFingerprint(parts: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 40);
}

export const photoPrint = (url: string) => createHash("sha256").update(url).digest("hex").slice(0, 16);

/** The estimate this question got within SAME_DAYS, and when. */
export async function sameEstimate(orgId: string, fp: string): Promise<{ estimate: GeneratedEstimate; at: string } | null> {
  const row = await db.syncState.findUnique({ where: { key: rowKey(orgId, fp) }, select: { cursor: true } }).catch(() => null);
  if (!row) return null;
  try {
    const kept = JSON.parse(row.cursor) as { at?: string; estimate?: GeneratedEstimate };
    if (!kept.at || !kept.estimate || !Array.isArray(kept.estimate.materials)) return null;
    if (Date.now() - Date.parse(kept.at) > SAME_DAYS * 24 * 3600 * 1000) return null;
    return { estimate: kept.estimate, at: kept.at };
  } catch {
    return null;
  }
}

/** Keep an estimate as this question's answer (a fresh one replaces the old); the shop keeps its newest SAME_MAX. */
export async function keepEstimate(orgId: string, fp: string, estimate: GeneratedEstimate): Promise<void> {
  try {
    const key = rowKey(orgId, fp);
    const cursor = JSON.stringify({ at: new Date().toISOString(), estimate });
    await db.syncState.upsert({ where: { key }, create: { key, cursor }, update: { cursor } });
    const ix = await db.syncState.findUnique({ where: { key: indexKey(orgId) }, select: { cursor: true } }).catch(() => null);
    let list: string[] = [];
    try {
      const v = JSON.parse(ix?.cursor ?? "[]") as unknown;
      list = Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    } catch {
      list = [];
    }
    const next = [fp, ...list.filter((x) => x !== fp)];
    const drop = next.slice(SAME_MAX);
    const keep = JSON.stringify(next.slice(0, SAME_MAX));
    await db.syncState.upsert({ where: { key: indexKey(orgId) }, create: { key: indexKey(orgId), cursor: keep }, update: { cursor: keep } });
    if (drop.length) await db.syncState.deleteMany({ where: { key: { in: drop.map((d) => rowKey(orgId, d)) } } });
  } catch (err) {
    // Remembering is a courtesy: the estimate in hand still goes to the contractor.
    console.warn(`[sameBrief] not kept: ${err instanceof Error ? err.message : String(err)}`);
  }
}
