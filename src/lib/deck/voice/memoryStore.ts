import "server-only";
// WHAT DECK STUDIO LEARNS FROM A SHOP (2026-10-21).
//
// Owner: "if it's something missing, it would remember … self-learned." Three things are kept per organization, in
// SyncState (no schema change), apart from the drafts so the studio's auto-save can never touch them:
//   · phrases — a sentence the rules could not read, as the AI read it (or as the contractor taught it: "when I say
//     'my usual', make it 16 by 12 with Trex"), so the next time it is understood at once, offline, the same way;
//   · items — the things the studio cannot draw (a fire pit, a bench) with the price the shop gave them, so "add a
//     fire pit" next time goes on the price without asking;
//   · wishes — what people asked for that the studio cannot do, for the team to see what to build next.
// Every list is capped; the oldest goes first.

import { db } from "@/lib/db";
import type { DeckCommand } from "./commands";
import { checkCommands } from "./schema";
import { phraseKey } from "./words";

export interface VoiceItem {
  name: string;
  unit: "ea" | "pcs" | "ft" | "sq ft" | "bags";
  price: number;
}
export interface VoiceMemory {
  v: 1;
  phrases: Record<string, { cmds: DeckCommand[]; at: string; by: "ai" | "taught" }>;
  items: Record<string, VoiceItem & { at: string }>;
}
export interface VoiceWish {
  text: string;
  item: string | null;
  at: string;
}

const MAX_PHRASES = 300;
const MAX_ITEMS = 120;
const MAX_WISHES = 300;
const memoryKey = (org: string) => `deckvoice:${org}`;
const wishKey = (org: string) => `deckvoice-wish:${org}`;

const empty = (): VoiceMemory => ({ v: 1, phrases: {}, items: {} });


function readMemoryRaw(raw: string | null | undefined): VoiceMemory {
  if (!raw) return empty();
  try {
    const o = JSON.parse(raw) as Partial<VoiceMemory>;
    const out = empty();
    for (const [k, v] of Object.entries(o.phrases ?? {})) {
      const { cmds } = checkCommands((v as { cmds?: unknown })?.cmds);
      if (cmds.length) out.phrases[phraseKey(k)] = { cmds, at: String((v as { at?: unknown }).at ?? ""), by: (v as { by?: unknown }).by === "taught" ? "taught" : "ai" };
    }
    for (const [k, v] of Object.entries(o.items ?? {})) {
      const it = v as Partial<VoiceItem & { at: string }>;
      const price = Number(it.price);
      if (typeof it.name === "string" && it.name.trim() && Number.isFinite(price) && price >= 0) out.items[k.toLowerCase().slice(0, 80)] = { name: it.name.slice(0, 80), unit: (["ea", "pcs", "ft", "sq ft", "bags"] as const).includes(it.unit as VoiceItem["unit"]) ? (it.unit as VoiceItem["unit"]) : "ea", price: Math.min(100000, Math.round(price * 100) / 100), at: String(it.at ?? "") };
    }
    return out;
  } catch {
    return empty();
  }
}

export async function readVoiceMemory(organizationId: string): Promise<VoiceMemory> {
  const row = await db.syncState.findUnique({ where: { key: memoryKey(organizationId) }, select: { cursor: true } }).catch(() => null);
  return readMemoryRaw(row?.cursor);
}

async function writeVoiceMemory(organizationId: string, m: VoiceMemory): Promise<void> {
  const trim = <T extends { at: string }>(rec: Record<string, T>, max: number) => Object.fromEntries(Object.entries(rec).sort((a, b) => b[1].at.localeCompare(a[1].at)).slice(0, max));
  const cursor = JSON.stringify({ v: 1, phrases: trim(m.phrases, MAX_PHRASES), items: trim(m.items, MAX_ITEMS) });
  const key = memoryKey(organizationId);
  await db.syncState.upsert({ where: { key }, create: { key, cursor }, update: { cursor } });
}

/** Keep a phrase and what it does. */
export async function rememberPhrase(organizationId: string, phrase: string, cmds: DeckCommand[], by: "ai" | "taught"): Promise<void> {
  const key = phraseKey(phrase);
  if (!key || !cmds.length) return;
  const m = await readVoiceMemory(organizationId);
  // A phrase the contractor taught is not overwritten by the AI's reading of it.
  if (by === "ai" && m.phrases[key]?.by === "taught") return;
  m.phrases[key] = { cmds, at: new Date().toISOString(), by };
  await writeVoiceMemory(organizationId, m);
}

/** Forget a phrase (or, with none, the one kept last). Returns the phrase forgotten. */
export async function forgetPhrase(organizationId: string, phrase?: string | null): Promise<string | null> {
  const m = await readVoiceMemory(organizationId);
  const key = phrase ? phraseKey(phrase) : Object.entries(m.phrases).sort((a, b) => b[1].at.localeCompare(a[1].at))[0]?.[0];
  if (!key || !m.phrases[key]) return null;
  delete m.phrases[key];
  await writeVoiceMemory(organizationId, m);
  return key;
}

/** Keep an item's price. */
export async function rememberItem(organizationId: string, item: VoiceItem): Promise<void> {
  const name = item.name.trim().slice(0, 80);
  if (!name) return;
  const m = await readVoiceMemory(organizationId);
  m.items[name.toLowerCase()] = { name, unit: item.unit, price: Math.min(100000, Math.max(0, Math.round(item.price * 100) / 100)), at: new Date().toISOString() };
  await writeVoiceMemory(organizationId, m);
}

/** Note a wish: what was asked for that the studio cannot do. */
export async function noteWish(organizationId: string, text: string, item: string | null): Promise<void> {
  const key = wishKey(organizationId);
  const row = await db.syncState.findUnique({ where: { key }, select: { cursor: true } }).catch(() => null);
  let list: VoiceWish[] = [];
  try {
    const o = row?.cursor ? (JSON.parse(row.cursor) as { list?: VoiceWish[] }) : null;
    list = Array.isArray(o?.list) ? o.list.filter((w) => w && typeof w.text === "string") : [];
  } catch {
    list = [];
  }
  list.unshift({ text: text.slice(0, 300), item: item ? item.slice(0, 80) : null, at: new Date().toISOString() });
  const cursor = JSON.stringify({ v: 1, list: list.slice(0, MAX_WISHES) });
  await db.syncState.upsert({ where: { key }, create: { key, cursor }, update: { cursor } });
}

/** The wishes, newest first. */
export async function readWishes(organizationId: string): Promise<VoiceWish[]> {
  const row = await db.syncState.findUnique({ where: { key: wishKey(organizationId) }, select: { cursor: true } }).catch(() => null);
  try {
    const o = row?.cursor ? (JSON.parse(row.cursor) as { list?: VoiceWish[] }) : null;
    return Array.isArray(o?.list) ? o.list : [];
  } catch {
    return [];
  }
}
