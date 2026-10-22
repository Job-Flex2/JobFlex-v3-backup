// TALKING TO DECK STUDIO — what was said, written down, where the browser cannot (2026-10-21).
//
// Chrome, Edge and Safari hear speech themselves (the Web Speech API); Firefox and some in-app browsers do not. There
// the studio records a few seconds of the contractor's voice and posts it here; Whisper writes it down, biased toward
// the trade's words, and the studio reads it with its own rules like anything typed. A route handler, not a server
// action, because the audio is a file upload. It carries its own auth — the middleware does not match /api.

import { NextResponse } from "next/server";
import { toFile } from "openai";
import { requireEstimatorOrManager } from "@/lib/orgContext";
import { deckStudioAccess } from "@/lib/deck/access";
import { getOpenAI, isOpenAIEnabled } from "@/lib/sdk/openai";
import { rateLimitShared, HOUR } from "@/lib/rateLimit";
import { takeTrialCap } from "@/lib/trialMeter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** A sentence or two of speech is far below this; anything larger is not a voice command. */
const MAX_BYTES = 2 * 1024 * 1024;

/** Biases the decoder toward the words it will hear. Not a transcript — Whisper takes it as style. */
const PROMPT = "Deck words: joists, ledger, fascia, balusters, stringers, Trex, TimberTech, Azek, Fiberon, Deckorators, ipe, cedar, pressure treated, composite, pergola, gazebo, gable, hip, 2x10, 6x6, 16 inches on center, 6/12 pitch.";

export async function POST(req: Request) {
  let organizationId: string;
  try {
    const ctx = await requireEstimatorOrManager();
    organizationId = ctx.organizationId;
    // The whole studio only (2026-10-22): Whisper is paid — a preview (no add-on) hears through the browser alone.
    const level = await deckStudioAccess(ctx.user, organizationId);
    if (level === "none") return NextResponse.json({ error: "Deck Studio isn't open on this account." }, { status: 403 });
    if (level !== "full") return NextResponse.json({ error: "Talking to Deck Studio is part of Deck Studio — add it to your plan ($49/mo) from the Deck estimator." }, { status: 403 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unauthorized" }, { status: 403 });
  }
  if (!isOpenAIEnabled()) return NextResponse.json({ error: "Speech needs the AI set up on this server." }, { status: 503 });
  const limit = await rateLimitShared(`deckvoice-hear:${organizationId}`, 200, HOUR);
  if (!limit.ok) return NextResponse.json({ error: "Too much talking for one hour — try again later." }, { status: 429 });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected the recording." }, { status: 400 });
  }
  const audio = form.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) return NextResponse.json({ error: "Nothing was recorded." }, { status: 400 });
  if (audio.size > MAX_BYTES) return NextResponse.json({ error: "That recording is too long — say one thing at a time." }, { status: 413 });
  const trial = await takeTrialCap(organizationId, "aiCalls");
  if (!trial.ok) return NextResponse.json({ error: "The trial's AI allowance is used up — type it instead." }, { status: 402 });
  try {
    const type = audio.type || "audio/webm";
    const ext = /ogg/.test(type) ? "ogg" : /mp4|m4a|aac/.test(type) ? "m4a" : /wav/.test(type) ? "wav" : "webm";
    const file = await toFile(Buffer.from(await audio.arrayBuffer()), `voice.${ext}`, { type });
    const res = await getOpenAI().audio.transcriptions.create({ file, model: "whisper-1", prompt: PROMPT, language: "en" });
    const text = (res.text ?? "").trim();
    // On silence Whisper says its prompt back. A command a person gives is short; an echo repeats a long run of the
    // prompt — six words in a row of it is the prompt, not speech ("add stairs on the left" alone is speech).
    const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9/\s]/g, " ").split(/\s+/).filter(Boolean);
    const p = words(PROMPT).join(" ");
    const w = words(text);
    const echo = w.length >= 6 && w.some((_, i) => i + 6 <= w.length && p.includes(w.slice(i, i + 6).join(" ")));
    if (!text || echo) return NextResponse.json({ text: "" });
    return NextResponse.json({ text: text.slice(0, 400) });
  } catch (err) {
    if (typeof (err as { status?: unknown })?.status === "number") await trial.refund();
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not write that down." }, { status: 502 });
  }
}
