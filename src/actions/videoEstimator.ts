"use server";
import { enforceRateLimit, HOUR } from "@/lib/rateLimit";

// VIDEO ESTIMATOR — the walkthrough READER.
//
// One action: take the frames the browser pulled from the clip plus the
// transcript of its audio track, and return a structured reading of the job
// (lib/estimate/video-schema WalkthroughAnalysis). Pricing is NOT done here:
// the reading becomes a brief (briefFromAnalysis) and goes through the same
// generateAdvancedEstimate / refineAdvancedEstimate / saveEstimate /
// convertEstimateToProposal pipeline the Smart Proposal uses, so there is one
// pricing engine and one set of plan limits for every intake.
//
// WHY FRAMES + TRANSCRIPT, NOT THE VIDEO
// OpenAI is the one model vendor configured for this app (OPENAI_API_KEY), and
// its chat models take images and text, not video. The browser already has a
// decoder for the clip it just picked, so it samples ~14 stills and renders the
// audio track to 16kHz PCM itself (components/v3/video-estimator-blueprint/
// video-ingest.ts); Whisper transcribes the audio in chunks through
// app/api/estimator/video/transcribe. Net effect: a 200MB walkthrough never
// uploads — about 2MB of JPEG and a few MB of speech do — and there is no
// storage bucket, no ffmpeg and no background worker to run. Swapping in a
// native-video model later (Gemini) is a change to THIS file's model call and
// the ingest module; nothing downstream would notice.
//
// Same gates as the Smart Proposal actions, in the same order: role, plan
// feature, monthly run quota. Same result union too, so the page's failure
// funnel is shared.

import { z } from "zod";
import { requireEstimatorOrManager } from "@/lib/orgContext";
import { getOpenAI, getVisionModel, isOpenAIEnabled, isReasoningModelName, resolveOpenAIModel } from "@/lib/sdk/openai";
import { HVAC_READING_ADDENDUM, isHvacBrief } from "@/lib/estimate/hvac-prompt";
import { WALKTHROUGH_READER_PROMPT } from "@/lib/estimate/video-prompt";
import { checkPlanLimit } from "@/lib/limitsEngine";
import { PLAN_LIMIT_MESSAGE, type LimitKey } from "@/lib/planLimits";
import {
  VIDEO_PROJECT_TYPES,
  clock,
  walkthroughAnalysisSchema,
  walkthroughInputSchema,
  type WalkthroughAnalysis,
} from "@/lib/estimate/video-schema";
import { trackActivation } from "@/lib/activation-events";
import { logServerError } from "@/lib/server-events";
import { takeTrialCap } from "@/lib/trialMeter";
import { requirePage } from "@/lib/customPageAccess";

/** The reader reads with the model the rest of JobFlex runs on (gpt-4.1 on
 *  jobflex.app since 2026-09-19), through the pictures' rule in lib/sdk/openai
 *  getVisionModel: OPENAI_VISION_MODEL when one is set, else OPENAI_MODEL, never
 *  a mini or nano tier — reading a fence run off a frame against a door for
 *  scale is spatial reasoning, exactly where those fall over.
 *  The reader's own knob, OPENAI_VIDEO_MODEL, is gone (owner, 2026-10-15:
 *  "JobFlex already uses 4.1 — add it to video as well"): a value left in an
 *  environment (the example file set it to gpt-4o) could hold the video a model
 *  behind everything else. The availability check runs first, so a main model
 *  the key's project cannot use falls back to gpt-4o here exactly as it does
 *  for the planner. Read at call time. */
async function videoModel(): Promise<string> {
  await resolveOpenAIModel();
  return getVisionModel();
}

type Fail = { ok: false; error: string; code?: "PLAN_LIMIT_REACHED"; resource?: LimitKey };

/** Mirrors advancedEstimator's private `estimatorRunBlocked` — the run quota is
 *  the same "estimatorUses" budget saveEstimate consumes. */
async function runBlocked(organizationId: string): Promise<Fail | null> {
  const quota = await checkPlanLimit(organizationId, "estimatorUses");
  if (quota.allowed) return null;
  return {
    ok: false,
    error: PLAN_LIMIT_MESSAGE,
    code: "PLAN_LIMIT_REACHED",
    resource: quota.cappedBy ?? "estimatorUses",
  };
}

const INLINE_JPEG = /^data:image\/(jpe?g|png|webp);base64,[A-Za-z0-9+/=]+$/i;

export async function analyzeWalkthrough(
  raw: unknown,
): Promise<{ ok: true; data: WalkthroughAnalysis } | Fail> {
  let input: z.infer<typeof walkthroughInputSchema>;
  try {
    input = walkthroughInputSchema.parse(raw);
  } catch {
    return { ok: false, error: "Invalid walkthrough payload" };
  }

  let organizationId: string;
  try {
    ({ organizationId } = await requireEstimatorOrManager());
    await requirePage(organizationId, ["video-estimator", "hvac-estimator"]);
    await enforceRateLimit(`ai-video:${organizationId}`, 20, HOUR, "video analyses");
    const { requireFeatureOrThrow } = await import("@/lib/entitlements");
    const { getOrgPlanById } = await import("@/lib/orgPlan");
    const plan = await getOrgPlanById(organizationId);
    requireFeatureOrThrow(plan, "advanced_estimator");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Upgrade required" };
  }
  const blocked = await runBlocked(organizationId);
  if (blocked) return blocked;

  // No demo reading. The Smart Proposal actions fall back to a fixture without
  // a key; this surface exists to read a REAL clip, and a made-up reading of it
  // would be worse than none.
  if (!isOpenAIEnabled()) {
    return { ok: false, error: "Video analysis needs OPENAI_API_KEY — add it to enable this estimator." };
  }

  // Only inline JPEG/PNG/WebP the browser rendered reaches the model.
  const frames = input.frames.filter((f) => INLINE_JPEG.test(f.dataUrl));
  if (frames.length === 0) return { ok: false, error: "No readable frames in the walkthrough." };
  // The card-less trial's AI ceiling (lib/trialMeter): one reading, one use.
  const trial = await takeTrialCap(organizationId, "aiCalls");
  if (!trial.ok) return trial.failure;

  const ticket = [
    input.project.trim() ? `Project (as typed on the ticket): ${input.project.trim()}` : "",
    input.address.trim() ? `Address (as typed on the ticket): ${input.address.trim()}` : "",
    input.notes.trim() ? `Contractor notes: ${input.notes.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const audioLine =
    input.audioState === "ok" && input.transcript.trim()
      ? `Transcript of the audio track (timestamps are mm:ss into the clip):\n${input.transcript.trim()}`
      : input.audioState === "failed"
        ? "The audio track could not be transcribed — read the frames only, and ask for anything you cannot see."
        : "The clip has no usable audio — read the frames only, and ask for anything you cannot see.";

  const frameIntro = `${frames.length} frames follow, in chronological order, each labelled with its index and timestamp.`;
  // The HVAC reader's checklist rides along when the ticket or the audio
  // says HVAC — the pricing call downstream picks up the HVAC prompt on the
  // same signal (lib/estimate/hvac-prompt).
  const hvac = isHvacBrief([input.project, input.notes, input.transcript].join(" "));

  const content: Array<
    { type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail: "auto" } }
  > = [
    {
      type: "text",
      text: `Clip length: ${clock(input.duration)}.\n${ticket ? ticket + "\n" : ""}\n${audioLine}\n\n${frameIntro}`,
    },
  ];
  frames.forEach((f, i) => {
    content.push({ type: "text", text: `Frame ${i} · ${clock(f.t)}` });
    content.push({ type: "image_url", image_url: { url: f.dataUrl, detail: "auto" } });
  });

  try {
    const client = getOpenAI();
    const model = await videoModel();
    console.info(
      `[videoEstimator] reading walkthrough · model=${model} · ${frames.length} frames · audio=${input.audioState} · hvac=${hvac} · ${clock(input.duration)}`,
    );
    const completion = await client.chat.completions.create({
      model,
      // A reasoning model rejects a temperature.
      ...(isReasoningModelName(model) ? {} : { temperature: 0.2 }),
      messages: [
        {
          role: "system",
          // The reader's instructions live in lib/estimate/video-prompt.ts, next
          // to the schema they must match.
          content: WALKTHROUGH_READER_PROMPT + (hvac ? `\n\n${HVAC_READING_ADDENDUM}` : ""),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { role: "user", content: content as any },
      ],
      response_format: { type: "json_object" },
    });
    const text = completion.choices[0]?.message?.content ?? "{}";
    const parsed = walkthroughAnalysisSchema.parse(JSON.parse(text));

    // Belt and braces on the model's output, as the Smart Proposal gate does:
    // frame indexes must point at frames that were actually sent (and each one
    // once), a select without options is unanswerable, and "not enough detail"
    // with no questions is not a gate anyone can pass.
    const seen = new Set<number>();
    const framesOut = parsed.frames
      .filter((f) => f.index < frames.length && !seen.has(f.index) && seen.add(f.index))
      .slice(0, 6);
    const questions = parsed.questions
      .slice(0, 8)
      .map((q) =>
        q.kind === "select" && (!q.options || q.options.length === 0)
          ? { ...q, kind: "text" as const }
          : q,
      );
    const projectType = VIDEO_PROJECT_TYPES.includes(parsed.projectType)
      ? parsed.projectType
      : "other";
    const data: WalkthroughAnalysis = {
      ...parsed,
      projectType,
      frames: framesOut,
      questions,
      enoughDetail: parsed.enoughDetail || questions.length === 0,
      confidence: Math.round(parsed.confidence),
      location: parsed.location?.trim() || null,
    };
    console.info(
      `[videoEstimator] read "${data.title}" · type=${data.projectType} · ${data.work.length} work · ${data.behind.length} behind · ${data.steps.length} steps · ${data.measurements.length} measurements · ${data.questions.length} questions · confidence ${data.confidence}`,
    );
    trackActivation("estimator_used", organizationId, { estimator: "video" });
    return { ok: true, data };
  } catch (err) {
    logServerError("videoEstimator.analyzeWalkthrough", err, { kind: "action", organizationId });
    const msg = err instanceof Error ? err.message : "Could not read the walkthrough";
    console.error(`[videoEstimator] reading failed: ${msg}`);
    if (typeof (err as { status?: unknown })?.status === "number") await trial.refund();
    return { ok: false, error: msg };
  }
}
