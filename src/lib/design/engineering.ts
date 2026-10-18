// THE ENGINEERING REQUEST (Home Design Studio, milestone 5 — 2026-10-17). Owner: "move some walls if it's not gonna
// destroy the structural, or request the engineering." The changes to the house that need an engineer (or may, once
// the site is checked) are frozen into one request the contractor sends to their engineer: the plan with every change
// numbered on it, what the plan says about each wall and why, what the contractor found on site, and the questions —
// beam, posts, footings, shoring, headers, bracing. The engineer opens it from the email's link (no account: the link's
// token is the key), answers each question there, and the answer comes back to the studio. Kept as a SyncState row
// `designeng:<token>` — a snapshot, so what the engineer answered is what they were asked. Pure.
import type { DesignDoc, Opening, RoomLabel, Wall } from "./model";
import { engineerQuestions, forEngineer, houseChanges, LEVEL_WORDS, readingWords, siteWords, type ChangeKind, type ChangeNeeds } from "./structure";

export const ENG_TOKEN_RE = /^[A-Za-z0-9_-]{20,40}$/;
export const engKey = (token: string) => `designeng:${token}`;

export type EngChange = {
  n: number;
  id: string;
  kind: ChangeKind;
  title: string;
  needs: ChangeNeeds;
  why: string;
  inches: number;
  exterior: boolean;
  wallId: string;
  openingId?: string;
  /** words: what it comes to (the site's word when checked); plan: what the plan alone read. */
  reading: { words: string; plan: string; reasons: string[]; checks: string[]; plumbing?: string; confirmed?: "bearing" | "not" };
  questions: string[];
};

export type EngAnswer = { by: string; license?: string; email?: string; note?: string; perChange: Record<string, string>; at: string };

export type EngRequest = {
  v: 1;
  token: string;
  orgId: string;
  designId: string | null;
  title: string;
  address: string | null;
  createdAt: string;
  to: string;
  note?: string;
  from: { company: string; person: string | null; email: string | null; phone: string | null };
  site: string[];
  /** The plan as designed, with the walls taken out kept apart to draw dashed. */
  plan: { walls: Wall[]; removed: Wall[]; openings: Opening[]; labels: RoomLabel[]; was: Record<string, Wall> };
  changes: EngChange[];
  seenAt?: string;
  answer?: EngAnswer;
};

/** The request, frozen from the design. Null when nothing in it is the engineer's. */
export function buildRequest(doc: DesignDoc, meta: { token: string; orgId: string; designId: string | null; to: string; note?: string; from: EngRequest["from"]; at: string }): EngRequest | null {
  const all = houseChanges(doc);
  const mine = forEngineer(all);
  if (!mine.length) return null;
  const now = new Set(doc.walls.map((w) => w.id));
  const removed = (doc.existing?.walls ?? []).filter((w) => !now.has(w.id));
  const was: Record<string, Wall> = {};
  for (const c of all) {
    const w = doc.existing?.walls.find((x) => x.id === c.wallId);
    if (w && c.kind === "move-wall") was[c.wallId] = w;
  }
  return {
    v: 1,
    token: meta.token,
    orgId: meta.orgId,
    designId: meta.designId,
    title: doc.estimate?.title || doc.title,
    address: doc.estimate?.address?.trim() || null,
    createdAt: meta.at,
    to: meta.to,
    ...(meta.note ? { note: meta.note } : {}),
    from: meta.from,
    site: siteWords(doc.engineering?.site),
    plan: { walls: doc.walls, removed, openings: doc.openings, labels: doc.labels, was },
    changes: mine.map((c, i) => ({
      n: i + 1,
      id: c.id,
      kind: c.kind,
      title: c.title,
      needs: c.needs,
      why: c.why,
      inches: c.inches,
      exterior: c.exterior,
      wallId: c.wallId,
      ...(c.openingId ? { openingId: c.openingId } : {}),
      reading: { words: readingWords(c.reading), plan: LEVEL_WORDS[c.reading.level], reasons: c.reading.reasons, checks: c.reading.checks, ...(c.reading.plumbing ? { plumbing: c.reading.plumbing } : {}), ...(c.reading.confirmed ? { confirmed: c.reading.confirmed } : {}) },
      questions: c.needs === "check" ? [`Is this wall bearing? (The plan's reading: ${readingWords(c.reading).toLowerCase()}.) If it is:`, ...engineerQuestions(c)] : engineerQuestions(c),
    })),
  };
}

export function parseRequest(cursor: string | null | undefined): EngRequest | null {
  if (!cursor) return null;
  try {
    const o = JSON.parse(cursor) as EngRequest;
    return o && o.v === 1 && typeof o.token === "string" && Array.isArray(o.changes) ? o : null;
  } catch {
    return null;
  }
}

export const NEEDS_WORDS: Record<ChangeNeeds, string> = {
  engineer: "Engineer",
  header: "Header (code tables)",
  check: "Check on site",
  none: "Framing only",
};
