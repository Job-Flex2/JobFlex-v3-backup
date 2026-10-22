// TALKING TO DECK STUDIO — the studio's answer in a natural voice (2026-10-21).
//
// Owner: "the voice to be better … we already have it in our AI desk, so we need a natural professional voice talking
// back to the client." The browser's own voice sounded like a machine. The studio's short spoken answer (already cut
// to words — no prices, no measurements: lib/deck/voice/speak) is read here by OpenAI's speech model in the voice the
// shop picked for its AI desk (Settings → AI desk; "marin" until one is picked) and played back on the page. The AI
// desk's phone calls run through the voice server on Fly.io; a page needs no phone bridge, so this is the same voice,
// straight from the app. The contractor's studio (signed in, the WHOLE Deck Studio — a preview gets the browser's
// voice: this is paid OpenAI speech, 2026-10-22) or a client's deck link (its token).
// Any failure answers an error and the page falls back to the browser's voice.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireEstimatorOrManager } from "@/lib/orgContext";
import { deckStudioAccess } from "@/lib/deck/access";
import { CLIENT_TOKEN_RE, clientLinkKey, parseClientLink } from "@/lib/deck/clientDesign";
import { readDeskSettings } from "@/lib/aiDesk/numbers";
import { VOICES } from "@/lib/aiDesk/shared";
import { getOpenAI, isOpenAIEnabled } from "@/lib/sdk/openai";
import { clientIp, rateLimitShared, HOUR } from "@/lib/rateLimit";
import { notePaidCall } from "@/lib/trialMeter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** A spoken answer is two short sentences; anything longer is cut, never read for a minute. */
const MAX_CHARS = 320;

const HOW: Record<"contractor" | "client", string> = {
  contractor: "A seasoned deck designer working alongside the contractor. Natural, quick and professional — short, confident sentences, no filler, a friendly pace.",
  client: "A friendly, professional deck designer helping a homeowner design their deck. Warm and natural, upbeat but calm, unhurried — like a good designer in a showroom.",
};

async function who(token: string | null): Promise<{ org: string; audience: "contractor" | "client"; key: string } | null> {
  if (token) {
    if (!CLIENT_TOKEN_RE.test(token)) return null;
    const row = await db.syncState.findUnique({ where: { key: clientLinkKey(token) }, select: { cursor: true } }).catch(() => null);
    const link = row ? parseClientLink(row.cursor) : null;
    if (!link || link.token !== token || Date.parse(link.expiresAt) < Date.now()) return null;
    return { org: link.orgId, audience: "client", key: `deckclient-speak:${token}` };
  }
  try {
    const ctx = await requireEstimatorOrManager();
    if ((await deckStudioAccess(ctx.user, ctx.organizationId)) !== "full") return null;
    return { org: ctx.organizationId, audience: "contractor", key: `deckvoice-speak:${ctx.organizationId}` };
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  let body: { text?: unknown; token?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Nothing to say." }, { status: 400 });
  }
  const text = typeof body.text === "string" ? body.text.replace(/\s+/g, " ").trim().slice(0, MAX_CHARS) : "";
  if (!text) return NextResponse.json({ error: "Nothing to say." }, { status: 400 });
  const caller = await who(typeof body.token === "string" ? body.token : null);
  if (!caller) return NextResponse.json({ error: "Not open here." }, { status: 403 });
  if (!isOpenAIEnabled()) return NextResponse.json({ error: "The voice needs the AI set up on this server." }, { status: 503 });
  const [mine, theirs] = await Promise.all([
    rateLimitShared(caller.key, caller.audience === "client" ? 150 : 600, HOUR),
    caller.audience === "client" ? rateLimitShared(`deckclient-speak-ip:${await clientIp()}`, 300, HOUR) : Promise.resolve({ ok: true }),
  ]);
  if (!mine.ok || !theirs.ok) return NextResponse.json({ error: "Too much talking for one hour." }, { status: 429 });
  const desk = await readDeskSettings(caller.org).catch(() => null);
  const voice = desk?.voice && (VOICES as readonly string[]).includes(desk.voice) ? desk.voice : "marin";
  try {
    const res = await getOpenAI().audio.speech.create({ model: "gpt-4o-mini-tts", voice, input: text, response_format: "mp3", instructions: HOW[caller.audience] });
    const audio = Buffer.from(await res.arrayBuffer());
    if (!audio.length) return NextResponse.json({ error: "No audio came back." }, { status: 502 });
    void notePaidCall("openai", "tts-deck-voice", { orgId: caller.org }).catch(() => null);
    return new NextResponse(new Uint8Array(audio), { status: 200, headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "The voice couldn't be made — the page reads it instead." }, { status: 502 });
  }
}
