import "server-only";
// What the customer development page keeps (owner, 2026-10-22) — SyncState rows, no schema change (prod no longer
// pushes the schema): one row per logged interview (`custdev:interview:<id>`), the owner's edits and verdicts on the
// hypotheses (`custdev:hypotheses`), the AI's last reading of what customers wrote (`custdev:synthesis`) and the
// weekly scorecard (`custdev:weeks`, one entry per ISO week, kept two years).
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { withWeek, type HypothesisEdit, type Interview, type WeekScore } from "@/lib/custDev/model";

const INTERVIEW_PREFIX = "custdev:interview:";
const HYP_KEY = "custdev:hypotheses";
const SYNTH_KEY = "custdev:synthesis";
const WEEKS_KEY = "custdev:weeks";

const parse = <T>(text: string | null | undefined): T | null => {
  try {
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    return null;
  }
};
async function put(key: string, value: unknown): Promise<void> {
  const cursor = JSON.stringify(value);
  await db.syncState.upsert({ where: { key }, create: { key, cursor }, update: { cursor } });
}

/* ── interviews ── */

export async function listInterviews(): Promise<Interview[]> {
  const rows = await db.syncState.findMany({ where: { key: { startsWith: INTERVIEW_PREFIX } }, select: { cursor: true }, take: 5000 }).catch(() => []);
  return rows
    .map((r) => parse<Interview>(r.cursor))
    .filter((i): i is Interview => !!i && typeof i.id === "string")
    .sort((a, b) => b.at - a.at);
}

export async function saveInterview(value: Omit<Interview, "id" | "by" | "createdAt">, by: string | null, id?: string | null): Promise<Interview> {
  const existing = id ? parse<Interview>((await db.syncState.findUnique({ where: { key: INTERVIEW_PREFIX + id }, select: { cursor: true } }))?.cursor) : null;
  const row: Interview = { ...value, id: existing?.id ?? randomUUID(), by: existing?.by ?? by, createdAt: existing?.createdAt ?? Date.now() };
  await put(INTERVIEW_PREFIX + row.id, row);
  return row;
}

export async function deleteInterview(id: string): Promise<void> {
  await db.syncState.deleteMany({ where: { key: INTERVIEW_PREFIX + id } });
}

/* ── hypotheses ── */

export async function readHypothesisEdits(): Promise<HypothesisEdit[]> {
  const row = await db.syncState.findUnique({ where: { key: HYP_KEY }, select: { cursor: true } }).catch(() => null);
  const list = parse<HypothesisEdit[]>(row?.cursor);
  return Array.isArray(list) ? list.filter((e) => e && typeof e.id === "string") : [];
}

export async function writeHypothesisEdits(list: HypothesisEdit[]): Promise<void> {
  await put(HYP_KEY, list.slice(0, 200));
}

/* ── the AI's reading ── */

export interface Synthesis {
  at: number;
  /** How many messages it read. */
  read: number;
  headline: string;
  pains: Array<{ title: string; detail: string; companies: number; quote: string }>;
  requests: Array<{ title: string; detail: string; companies: number }>;
  objections: Array<{ title: string; detail: string }>;
  earlyAdopter: string;
  nextExperiments: Array<{ title: string; detail: string }>;
}

export async function readSynthesis(): Promise<Synthesis | null> {
  const row = await db.syncState.findUnique({ where: { key: SYNTH_KEY }, select: { cursor: true } }).catch(() => null);
  return parse<Synthesis>(row?.cursor);
}

export async function writeSynthesis(s: Synthesis): Promise<void> {
  await put(SYNTH_KEY, s);
}

/* ── the weekly scorecard ── */

export async function readWeeks(): Promise<WeekScore[]> {
  const row = await db.syncState.findUnique({ where: { key: WEEKS_KEY }, select: { cursor: true } }).catch(() => null);
  const list = parse<WeekScore[]>(row?.cursor);
  return Array.isArray(list) ? list : [];
}

/** This week's score, written in its place. */
export async function recordWeek(score: WeekScore): Promise<WeekScore[]> {
  const next = withWeek(await readWeeks(), score);
  await put(WEEKS_KEY, next);
  return next;
}
