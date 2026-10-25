import "server-only";
// THE PITCH DECK'S OWN WORDS (owner, 2026-10-25: "a pitch deck for JobFlex — who we are and what we're doing" on the
// investor link). Every other slide is built from what the product and the figures already say; these three are the
// owner's to write — the team, the raise, what is next — and a slide whose box is empty does not show. One SyncState
// row, `investorPitch`, written from /admin/investors.
import { db } from "@/lib/db";

export const INVESTOR_PITCH_KEY = "investorPitch";
const MAX = 2000;

export interface InvestorPitch {
  /** One person per line: "Name — role — a line about them". */
  team: string;
  /** The raise: the first line is the headline ("Raising $750K seed"), the rest what it pays for, one per line. */
  ask: string;
  /** What is next, one item per line. */
  roadmap: string;
  updatedAt: string | null;
  updatedBy: string | null;
}

const clean = (v: unknown) => (typeof v === "string" ? v.replace(/\r\n?/g, "\n").trim().slice(0, MAX) : "");

export function cleanPitch(raw: unknown): InvestorPitch {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    team: clean(r.team),
    ask: clean(r.ask),
    roadmap: clean(r.roadmap),
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : null,
    updatedBy: typeof r.updatedBy === "string" ? r.updatedBy : null,
  };
}

export async function readInvestorPitch(): Promise<InvestorPitch> {
  try {
    const row = await db.syncState.findUnique({ where: { key: INVESTOR_PITCH_KEY }, select: { cursor: true } });
    return cleanPitch(row?.cursor ? JSON.parse(row.cursor) : null);
  } catch {
    return cleanPitch(null);
  }
}

export async function saveInvestorPitch(words: Partial<Pick<InvestorPitch, "team" | "ask" | "roadmap">>, by: string | null): Promise<InvestorPitch> {
  const next = cleanPitch({ ...(await readInvestorPitch()), ...words, updatedAt: new Date().toISOString(), updatedBy: by });
  const cursor = JSON.stringify(next);
  await db.syncState.upsert({ where: { key: INVESTOR_PITCH_KEY }, create: { key: INVESTOR_PITCH_KEY, cursor }, update: { cursor } });
  return next;
}

/** A box's lines, blank ones dropped. */
export const pitchLines = (text: string) => text.split("\n").map((l) => l.trim()).filter(Boolean);
