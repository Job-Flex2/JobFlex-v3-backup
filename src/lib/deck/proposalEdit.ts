// EDITING THE DECK A SAVED PROPOSAL CARRIES (2026-10-12, owner: "when a decking design proposal is saved, make an
// option to open and edit the design"). The proposal's drawing card opens the studio on it (`?proposal=<id>`), and
// the studio UPDATES that proposal rather than making a second one. These are the pure rules the update action
// (actions/deckEstimator updateDeckProposal) and the studio share; scripts/qa/deck-proposal-edit.check.ts holds them.
//
//  · A proposal the client signed, paid on, or whose job is done is never re-priced from here: the new design goes
//    on a new proposal (a change order is the way to change signed work).
//  · The studio's own lines are the names it last wrote, kept with the DECK_PLAN (`written`). They are replaced by
//    the new design's; a line added in the proposal builder stays, after them. A plan saved before the studio kept
//    the names has none: every line is the studio's.
//  · The title and the scope follow the design while they are still what the studio wrote. Edited by hand, they stay.

/** What the studio last wrote on the proposal, kept with its DECK_PLAN. */
export interface DeckWritten {
  title: string;
  scope: string;
  lines: string[];
}

/** Why a proposal cannot be re-priced from the studio ("theirs": an estimator or a salesperson works on their own only). */
export type DeckProposalLock = "signed" | "paid" | "done" | "theirs";

/** The proposal the studio is working on, as the studio shows it. */
export interface LinkedDeckProposal {
  id: string;
  /** "PRO-4C1B". */
  ref: string;
  title: string;
  status: string;
  /** Set when it may not be re-priced. */
  lock: DeckProposalLock | null;
  /** The client already has the link (sent or opened): an update changes what they see. */
  seen: boolean;
}

export function deckProposalLock(status: string, stages: readonly { status?: string | null; paidAmount?: number | null }[] = []): DeckProposalLock | null {
  if (status === "PAID") return "paid";
  if (status === "COMPLETED") return "done";
  if (status === "ACCEPTED") return "signed";
  if (stages.some((s) => s.status === "PAID" || s.status === "WAIVED" || (s.paidAmount ?? 0) > 0)) return "paid";
  return null;
}

export const deckProposalSeen = (status: string) => status === "SENT" || status === "VIEWED";

/** Said after "This proposal is …". */
export const DECK_LOCK_WORDS: Readonly<Record<DeckProposalLock, string>> = {
  signed: "signed by the client",
  paid: "already paid on",
  done: "a finished job",
  theirs: "another estimator's — only its owner or a manager can change it",
};

export const PROPOSAL_STATUS_WORDS: Readonly<Record<string, string>> = {
  DRAFT: "Draft",
  SENT: "Sent",
  VIEWED: "Opened by the client",
  ACCEPTED: "Signed",
  DECLINED: "Declined",
  COMPLETED: "Job done",
  PAID: "Paid",
  EXPIRED: "Expired",
  ARCHIVED: "Archived",
};

/** The stored `written` block, read defensively; null for a plan saved before it existed. */
export function readDeckWritten(raw: unknown): DeckWritten | null {
  const r = (raw && typeof raw === "object" ? raw : null) as Record<string, unknown> | null;
  if (!r || !Array.isArray(r.lines)) return null;
  return {
    title: typeof r.title === "string" ? r.title : "",
    scope: typeof r.scope === "string" ? r.scope : "",
    lines: r.lines.filter((n): n is string => typeof n === "string").map((n) => n.trim()),
  };
}

/** The lines the proposal keeps: those added in the builder. Without a record, none (every line is the studio's). */
export function keptDeckLines<T extends { name: string }>(lines: readonly T[], written: DeckWritten | null): T[] {
  if (!written) return [];
  const studio = new Set(written.lines);
  return lines.filter((l) => !studio.has(l.name.trim()));
}

const same = (a: string, b: string) => a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();

/**
 * The title and the scope after an update. A plan without a record: the title follows when it still starts with the
 * old design's words (every studio title does), the scope always does (nothing could have told it apart).
 */
export function deckTextAfter(
  current: { title: string; scope: string | null },
  written: DeckWritten | null,
  next: { title: string; scope: string },
  oldWords: string | null,
): { title: string; scope: string; titleKept: boolean; scopeKept: boolean } {
  const scopeNow = current.scope ?? "";
  const titleFollows = written ? same(current.title, written.title) : !!oldWords && current.title.trim().startsWith(oldWords);
  const scopeFollows = written ? same(scopeNow, written.scope) || !scopeNow.trim() : true;
  return {
    title: titleFollows ? next.title : current.title,
    scope: scopeFollows ? next.scope : scopeNow,
    titleKept: !titleFollows && !same(current.title, next.title),
    scopeKept: !scopeFollows && !same(scopeNow, next.scope),
  };
}
