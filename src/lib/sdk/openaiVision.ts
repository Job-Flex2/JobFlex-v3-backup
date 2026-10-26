import type { ZodType } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { getOpenAI, getVisionModel, isOpenAIEnabled, isReasoningModelName } from "./openai";

interface VisionInput {
  systemPrompt: string;
  userPrompt: string;
  imageUrl: string; // https or data: URL
  model?: string;
  /** How closely the model looks: "high" tiles the image at full resolution
   *  (a tall receipt's small print survives), "low" one 512px glance, "auto"
   *  lets the model choose. Default "auto", the way every caller ran before. */
  detail?: "auto" | "high" | "low";
}

// Returns the parsed JSON a vision model reads off one image (getVisionModel: the
// estimators' model, gpt-4o under a mini tier). The system prompt describes the exact JSON schema expected.
export async function runVisionJson<T>(input: VisionInput): Promise<T | null> {
  if (!isOpenAIEnabled()) return null;
  const client = getOpenAI();
  const model = getVisionModel(input.model);
  const completion = await client.chat.completions.create({
    model,
    // A reasoning model rejects a temperature.
    ...(isReasoningModelName(model) ? {} : { temperature: 0.2 }),
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: input.systemPrompt },
      {
        role: "user",
        content: [
          { type: "text" as const, text: input.userPrompt },
          { type: "image_url" as const, image_url: { url: input.imageUrl, ...(input.detail ? { detail: input.detail } : {}) } },
        ],
      },
    ],
  });
  const text = completion.choices[0]?.message?.content ?? "{}";
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** How long a reasoning model thinks before it answers (gpt-5, gpt-6, the o-series). */
export type VisionEffort = "low" | "medium" | "high";
/** How much of the picture the model gets: "original" keeps its own pixels — what OpenAI advises for anything that
 *  answers with coordinates; "high" fits it in 2048² and 2,500 patches; "low" one 512-px glance. */
export type VisionDetail = "low" | "high" | "original" | "auto";

export interface StructuredVisionInput<T> {
  /** The answer's shape. The model is held to it (Structured Outputs), so what comes back is the typed object or null. */
  schema: ZodType<T>;
  /** The schema's name for the API: letters, digits and underscores. */
  name: string;
  systemPrompt: string;
  userPrompt: string;
  imageUrl: string; // https or data: URL
  /** The model, named by the caller — a feature with a model of its own checks it with ensureModel first. */
  model: string;
  effort?: VisionEffort;
  detail?: VisionDetail;
  /** Room for the answer AND the thinking before it (a reasoning model counts both here). */
  maxOutputTokens?: number;
}

/**
 * ONE PICTURE READ INTO A SCHEMA (2026-10-26), through the Responses API. The house photo's read used to ask for "a
 * JSON object" and check it field by field; held to a schema, the model answers in the shape asked for, every field
 * present, every enum one of its values — and a GPT-6 model reads positions in the picture's own pixels, so the grid
 * of tenths the studio used to draw over the picture is not needed. Null when the model gave no parseable answer
 * (its output ran past the room given, or the key is missing).
 */
export async function runVisionStructured<T>(input: StructuredVisionInput<T>): Promise<T | null> {
  if (!isOpenAIEnabled()) return null;
  const client = getOpenAI();
  const model = input.model;
  const ask = async (detail: VisionDetail) => {
    const res = await client.responses.parse({
      model,
      ...(isReasoningModelName(model) ? { reasoning: { effort: input.effort ?? "medium" } } : {}),
      max_output_tokens: input.maxOutputTokens ?? 16_000,
      input: [
        { role: "system", content: input.systemPrompt },
        {
          role: "user",
          content: [
            { type: "input_text", text: input.userPrompt },
            // "original" is newer than this SDK's type for the field; the API takes it (developers.openai.com, images & vision).
            { type: "input_image", image_url: input.imageUrl, detail: detail as "high" },
          ],
        },
      ],
      text: { format: zodTextFormat(input.schema, input.name) },
    });
    return res.output_parsed ?? null;
  };
  const detail = input.detail ?? "original";
  try {
    return await ask(detail);
  } catch (err) {
    // A model (or an API host) that does not know "original" refuses it with a 400 that names the field: the same read at "high".
    const status = (err as { status?: number })?.status;
    const text = err instanceof Error ? err.message : String(err);
    if (detail === "original" && status === 400 && /detail/i.test(text)) return ask("high");
    throw err;
  }
}
