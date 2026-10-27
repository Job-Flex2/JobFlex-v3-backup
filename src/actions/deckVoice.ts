"use server";
// TALKING TO DECK STUDIO — THE SERVER'S HALF (2026-10-21).
//
// The studio reads what is said with its own rules first (lib/deck/voice), in the browser, at once. What they cannot
// read comes here: the AI reads it into the same commands (checked against lib/deck/voice/schema before they go back —
// the browser runs them through the same engine as everything else), and the reading is kept as the shop's own phrase,
// so the next time it is understood at once, offline. The shop's memory — taught phrases, the prices of things the
// studio cannot draw, the wishes — is read and written here too. Behind the WHOLE studio only (2026-10-22): the AI
// reading is a paid OpenAI call, so a preview (no add-on) gets the browser-side rules alone, never the model.

import { NoOrgError, UnauthorizedError, requireEstimatorOrManager } from "@/lib/orgContext";
import { deckStudioAccess } from "@/lib/deck/access";
import { logServerError } from "@/lib/server-events";
import { rateLimitShared, HOUR } from "@/lib/rateLimit";
import { takeTrialCap } from "@/lib/trialMeter";
import { getOpenAI, isOpenAIEnabled, resolveOpenAIModel, samplingOptions } from "@/lib/sdk/openai";
import type { DeckCommand } from "@/lib/deck/voice/commands";
import { COMMAND_GUIDE, checkCommands } from "@/lib/deck/voice/schema";
import { forgetPhrase, noteWish, readVoiceMemory, readWishes, rememberItem, rememberPhrase, type VoiceItem, type VoiceWish } from "@/lib/deck/voice/memoryStore";
import { phraseKey } from "@/lib/deck/voice/words";
import { db } from "@/lib/db";
import { clientIp } from "@/lib/rateLimit";
import { CLIENT_TOKEN_RE, clientLinkKey, parseClientLink } from "@/lib/deck/clientDesign";
import { deckAddonShortWords } from "@/lib/deckAddon";

type Gate = { ok: true; organizationId: string } | { ok: false; error: string };

async function gate(): Promise<Gate> {
  try {
    const ctx = await requireEstimatorOrManager();
    const level = await deckStudioAccess(ctx.user, ctx.organizationId);
    if (level === "none") return { ok: false, error: "Deck Studio isn't open on this account." };
    if (level !== "full") return { ok: false, error: `Talking to Deck Studio is part of Deck Studio — add it to your plan (${deckAddonShortWords()}) from the Deck estimator.` };
    return { ok: true, organizationId: ctx.organizationId };
  } catch (err) {
    if (err instanceof UnauthorizedError) return { ok: false, error: "Only an estimator, a manager or the owner can do this." };
    if (err instanceof NoOrgError) return { ok: false, error: "Sign in to an organization first." };
    throw err;
  }
}

export interface VoiceMemoryView {
  phrases: Record<string, DeckCommand[]>;
  taught: string[];
  items: Record<string, VoiceItem>;
}

/** The shop's memory, for the browser's rules: the phrases it knows and the items it has priced. */
export async function deckVoiceMemory(): Promise<{ ok: true; memory: VoiceMemoryView } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const m = await readVoiceMemory(g.organizationId);
  return {
    ok: true,
    memory: {
      phrases: Object.fromEntries(Object.entries(m.phrases).map(([k, v]) => [k, v.cmds])),
      taught: Object.entries(m.phrases).filter(([, v]) => v.by === "taught").map(([k]) => k),
      items: Object.fromEntries(Object.entries(m.items).map(([k, v]) => [k, { name: v.name, unit: v.unit, price: v.price }])),
    },
  };
}

export type RememberInput =
  | { kind: "teach"; phrase: string; cmds: unknown }
  | { kind: "item"; name: string; unit?: VoiceItem["unit"]; price: number }
  | { kind: "forget"; phrase?: string | null }
  | { kind: "wish"; text: string; item?: string | null };

/** Keep what was taught, priced or wished for; forget a phrase. */
export async function deckVoiceRemember(input: RememberInput): Promise<{ ok: true; forgot?: string | null } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  const limit = await rateLimitShared(`deckvoice-mem:${g.organizationId}`, 240, HOUR);
  if (!limit.ok) return { ok: false, error: "Too many changes to the voice memory — try again later." };
  try {
    switch (input.kind) {
      case "teach": {
        const { cmds } = checkCommands(input.cmds);
        if (!cmds.length || !phraseKey(input.phrase ?? "")) return { ok: false, error: "There was nothing to remember." };
        await rememberPhrase(g.organizationId, input.phrase, cmds, "taught");
        return { ok: true };
      }
      case "item": {
        const price = Number(input.price);
        if (!input.name?.trim() || !Number.isFinite(price) || price < 0) return { ok: false, error: "An item needs a name and a price." };
        await rememberItem(g.organizationId, { name: input.name, unit: input.unit ?? "ea", price });
        return { ok: true };
      }
      case "forget":
        return { ok: true, forgot: await forgetPhrase(g.organizationId, input.phrase ?? null) };
      case "wish":
        if (!input.text?.trim()) return { ok: true };
        await noteWish(g.organizationId, input.text, input.item ?? null);
        return { ok: true };
    }
  } catch (err) {
    logServerError("deck-voice-memory", err, { kind: "action", organizationId: g.organizationId });
    return { ok: false, error: "The voice memory could not be saved." };
  }
}

/** What people asked the studio for that it cannot do — newest first. */
export async function deckVoiceWishes(): Promise<{ ok: true; wishes: VoiceWish[] } | { ok: false; error: string }> {
  const g = await gate();
  if (!g.ok) return g;
  return { ok: true, wishes: (await readWishes(g.organizationId)).slice(0, 100) };
}

const SYSTEM = `You turn what a deck contractor or a homeowner says to a deck design studio into JSON commands.
Reply with JSON only: {"cmds": [...], "say": "one short sentence back, plain words", "unsupported": "what was asked that no command can do, or empty"}.
Use only the commands below, with only the values listed. Lengths are feet for sizes and inches for heights unless said otherwise.
"Bigger"/"smaller" without a number is 2 ft; "a little" is 1 ft; "higher"/"lower" is 12 in. For colors of the deck boards use decking.set.color.
If the person asks a question, use "ask" (or "show" to point at a part). If they ask for something the studio cannot draw (a fire pit, a pool, a bench, a grill),
use {"do":"item","op":"add","name":..., "price": only if they said one} — or {"do":"wish"} when it is not a thing that can be priced.
Never invent a product id. Never answer with prose outside the JSON.
${COMMAND_GUIDE}`;

/**
 * A sentence the rules could not read, read by the AI into the studio's commands. The reading is kept as the shop's
 * phrase (`learn`), so the same words are understood offline next time.
 */
type Interpreted = { ok: true; cmds: DeckCommand[]; say: string | null; unsupported: string | null; learned: boolean } | { ok: false; error: string; disabled?: boolean };

export async function deckVoiceInterpret(input: { text: string; summary: string; learn?: boolean }): Promise<Interpreted> {
  const g = await gate();
  if (!g.ok) return g;
  const limit = await rateLimitShared(`deckvoice-ai:${g.organizationId}`, 120, HOUR);
  if (!limit.ok) return { ok: false, error: "That's a lot of talking for one hour — the AI rests a moment. The built-in commands still work." };
  return interpret(g.organizationId, input, input.learn !== false);
}

/* ── the client's side (2026-10-21): the homeowner's deck link talks too ──────────────────────────────────────────
   Owner: "if we send that to the designer, don't say and don't repeat any numbers, just listen to what the client
   wants to add … understand different wording for clients." The token in the link is the key: the shop's phrases
   (never its priced items) for the rules in the browser, and the AI for what they cannot read — nothing learned from a
   client, every call held to the link and the caller. What the client may run is decided in the browser
   (lib/deck/voice/speak clientGate) and again when the design is sent back (mergeClientDesign keeps the structure). */

async function clientOrg(token: string): Promise<string | null> {
  if (!CLIENT_TOKEN_RE.test(String(token))) return null;
  const row = await db.syncState.findUnique({ where: { key: clientLinkKey(token) }, select: { cursor: true } }).catch(() => null);
  const link = row ? parseClientLink(row.cursor) : null;
  if (!link || link.token !== token || Date.parse(link.expiresAt) < Date.now()) return null;
  return link.orgId;
}

/** The shop's phrases for the client's page (its priced items stay with the shop). */
export async function deckClientVoiceMemory(token: string): Promise<{ ok: true; memory: VoiceMemoryView } | { ok: false; error: string }> {
  const org = await clientOrg(token);
  if (!org) return { ok: false, error: "This link isn't open." };
  const m = await readVoiceMemory(org);
  return { ok: true, memory: { phrases: Object.fromEntries(Object.entries(m.phrases).map(([k, v]) => [k, v.cmds])), taught: [], items: {} } };
}

/** What the client said that the rules could not read, read by the AI — nothing kept from it. */
export async function deckClientVoiceInterpret(token: string, input: { text: string; summary: string }): Promise<Interpreted> {
  const org = await clientOrg(token);
  if (!org) return { ok: false, error: "This link isn't open." };
  const [perLink, perCaller] = await Promise.all([rateLimitShared(`deckclient-voice:${token}`, 60, HOUR), rateLimitShared(`deckclient-voice-ip:${await clientIp()}`, 120, HOUR)]);
  if (!perLink.ok || !perCaller.ok) return { ok: false, error: "Let's slow down a moment — the buttons and the built-in words still work." };
  return interpret(org, input, false);
}

async function interpret(organizationId: string, input: { text: string; summary: string }, learn: boolean): Promise<Interpreted> {
  const g = { organizationId };
  const text = (input.text ?? "").trim().slice(0, 400);
  if (!text) return { ok: false, error: "Say something first." };
  if (!isOpenAIEnabled()) return { ok: false, error: "The AI isn't set up on this server.", disabled: true };
  // The card-less trial's AI ceiling (lib/trialMeter): one reading, one use.
  const trial = await takeTrialCap(g.organizationId, "aiCalls");
  if (!trial.ok) return { ok: false, error: "The trial's AI allowance is used up — the built-in commands still work." };
  try {
    const model = await resolveOpenAIModel();
    const completion = await getOpenAI().chat.completions.create({
      model,
      ...(await samplingOptions(0.1)),
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `The design now:\n${(input.summary ?? "").slice(0, 1500)}\n\nThey said: "${text}"` },
      ],
    });
    const raw = completion.choices[0]?.message?.content ?? "{}";
    let parsed: { cmds?: unknown; say?: unknown; unsupported?: unknown } = {};
    try {
      parsed = JSON.parse(raw) as typeof parsed;
    } catch {
      parsed = {};
    }
    const { cmds } = checkCommands(parsed.cmds);
    const say = typeof parsed.say === "string" && parsed.say.trim() ? parsed.say.trim().slice(0, 300) : null;
    const unsupported = typeof parsed.unsupported === "string" && parsed.unsupported.trim() ? parsed.unsupported.trim().slice(0, 200) : null;
    let learned = false;
    // Kept only when every command is a real change, view or question — never a wish, never an empty reading.
    if (learn && cmds.length && cmds.every((c) => c.do !== "wish" && c.do !== "item" && c.do !== "undo" && c.do !== "redo")) {
      await rememberPhrase(g.organizationId, text, cmds, "ai").catch(() => undefined);
      learned = true;
    }
    if (unsupported) await noteWish(g.organizationId, text, unsupported).catch(() => undefined);
    return { ok: true, cmds, say, unsupported, learned };
  } catch (err) {
    if (typeof (err as { status?: unknown })?.status === "number") await trial.refund();
    logServerError("deck-voice-ai", err, { kind: "action", organizationId: g.organizationId });
    return { ok: false, error: "The AI couldn't read that one — try saying it another way." };
  }
}
