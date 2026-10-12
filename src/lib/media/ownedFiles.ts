// A STORED FILE IS ONE COMPANY'S (security audit 1.1, 2026-10-12) — server only.
//
// The app names a stored file by its URL, and a URL is only text: a browser
// that once saw another company's /api/media/f link can decode the permanent
// address out of it. Two rules close that door:
//   · what a client hands an action as "my file" must sit in that company's
//     own folder in the store (lib/media/privateStore isPrivateFileUnder) —
//     the check lives with each kind of row (lib/jobMedia, lib/jobExpenses,
//     the deck and the home folder);
//   · a delete removes the bytes only when no row still names them. The row
//     being deleted is gone (or re-pointed) before this is asked, so any row
//     left is someone else's — another company's above all — and its file
//     stays where it is.

import { db } from "@/lib/db";
import { deleteStored, kindOfUrl, type StoredKind } from "@/lib/media/privateStore";

/** How many rows still name this stored file. */
export async function storedFileReferences(url: string): Promise<number> {
  const [photos, receipts, homeFiles] = await Promise.all([
    db.jobPhoto.count({ where: { url } }),
    db.jobExpense.count({ where: { receiptUrl: url } }),
    db.homeFile.count({ where: { url, deletedAt: null } }),
  ]);
  return photos + receipts + homeFiles;
}

/** Delete a stored file unless a row still names it. A data URL or an outside
 *  link has nothing to delete. Never throws, like deleteStored. */
export async function deleteStoredUnlessReferenced(url: string | null | undefined): Promise<{ deleted: boolean; kind: StoredKind; keptFor?: number }> {
  const kind = kindOfUrl(url);
  if (!url || kind === "data" || kind === "other") return { deleted: false, kind };
  try {
    const left = await storedFileReferences(url);
    if (left > 0) return { deleted: false, kind, keptFor: left };
  } catch (err) {
    // Unsure who else holds it: keep the file. An orphan costs cents; a
    // deleted file of another company is gone for good.
    console.warn("[ownedFiles] reference check failed, file kept:", err instanceof Error ? err.message : err);
    return { deleted: false, kind };
  }
  return deleteStored(url);
}
