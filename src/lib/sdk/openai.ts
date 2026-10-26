import OpenAI from "openai";
import { IntegrationDisabledError } from "./base";

/** What every call runs on when OPENAI_MODEL says nothing — and what an
 *  unavailable OPENAI_MODEL falls back to.
 *
 *  It was gpt-4o-mini until 2026-09-18, which no longer matched the account:
 *  the project this deployment's key belongs to is not entitled to that model
 *  and answers every request with 403 model_not_found. A default the account
 *  cannot use is not a default, it is an outage waiting for someone to unset
 *  one environment variable. */
const DEFAULT_MODEL = "gpt-4o";

let client: OpenAI | null = null;
/** Set only when the availability check below has ruled the env model out. */
let modelOverride: string | null = null;
let modelCheck: Promise<string> | null = null;

export function isOpenAIEnabled() {
  return Boolean(process.env.OPENAI_API_KEY);
}

export function getOpenAI() {
  if (!process.env.OPENAI_API_KEY) {
    throw new IntegrationDisabledError("OpenAI", "OPENAI_API_KEY");
  }
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, fetch: meteredFetch });
  }
  return client;
}

/* THE SPEND (2026-10-02). Every request the client makes passes here: a chat
   completion is priced from its own usage block, a transcription by the
   audio's length (whisper-1 bills by the minute; the upload's size stands in
   — 16-bit mono WAV at 16 kHz is 32,000 bytes a second), and the trial meter
   records it against the request's organization (lib/trialMeter). The model
   list (`models.retrieve`) is free and is not recorded. */
const meteredFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init);
  if (!res.ok) return res;
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  try {
    if (/\/chat\/completions(\?|$)/.test(url)) {
      void res
        .clone()
        .json()
        .then(async (body: { model?: string; usage?: { prompt_tokens?: number; completion_tokens?: number } }) => {
          const { notePaidCall } = await import("@/lib/trialMeter");
          const { openAiChatCents } = await import("@/lib/paidApiCosts");
          const u = body.usage;
          await notePaidCall("openai", "chat", u ? { cents: openAiChatCents(body.model ?? getOpenAIModel(), u.prompt_tokens ?? 0, u.completion_tokens ?? 0) } : {});
        })
        .catch(() => {});
    } else if (/\/responses(\?|$)/.test(url) && (init?.method ?? "GET").toUpperCase() === "POST") {
      // The Responses API (the house photo's structured read, 2026-10-26): its usage block names input and output
      // tokens — the reasoning tokens are counted in the output. A GET of /responses/{id} is free and is not matched.
      void res
        .clone()
        .json()
        .then(async (body: { model?: string; usage?: { input_tokens?: number; output_tokens?: number } }) => {
          const { notePaidCall } = await import("@/lib/trialMeter");
          const { openAiChatCents } = await import("@/lib/paidApiCosts");
          const u = body.usage;
          await notePaidCall("openai", "chat", u ? { cents: openAiChatCents(body.model ?? getOpenAIModel(), u.input_tokens ?? 0, u.output_tokens ?? 0) } : {});
        })
        .catch(() => {});
    } else if (/\/audio\/transcriptions(\?|$)/.test(url)) {
      let bytes = 0;
      if (init?.body instanceof FormData) {
        for (const [, v] of init.body.entries()) if (typeof v !== "string") bytes += v.size;
      }
      const minutes = bytes > 0 ? bytes / 32_000 / 60 : 1;
      void import("@/lib/trialMeter").then((t) => t.notePaidCall("openai", "transcribe-minute", { units: minutes })).catch(() => {});
    }
  } catch {
    /* recording never breaks the call */
  }
  return res;
};

/** Model name read at CALL time. Module-level consts are captured when the
 *  module first evaluates — under a tsx harness whose .env loader runs after
 *  imports hoist, that silently pins the default model even though
 *  OPENAI_MODEL is set. Vision paths (chimneyVision, outlineVision) must use
 *  this getter so harness and server agree on the model.
 *
 *  Once resolveOpenAIModel() has found the env model unusable, this returns
 *  what the calls are actually running on instead. */
export function getOpenAIModel(): string {
  return modelOverride ?? process.env.OPENAI_MODEL ?? DEFAULT_MODEL;
}

/**
 * THE MODEL THIS PROCESS CAN ACTUALLY USE — checked once, then remembered.
 *
 * An entitlement is not something the environment can promise. OPENAI_MODEL is
 * a string somebody typed; whether the key's project may call it is the API's
 * answer, and until 2026-09-18 nobody asked: a model the project had no access
 * to failed every estimate with a raw 403 and the contractor read it as "the
 * AI is broken". One `models.retrieve` at startup costs no tokens and turns
 * that into one log line and a working default.
 *
 * Only model_not_found demotes the model. An auth failure, a network blip or a
 * rate limit says nothing about entitlement, and pretending otherwise would
 * swap a diagnosable outage for a silent model change.
 */
export async function resolveOpenAIModel(): Promise<string> {
  if (modelCheck) return modelCheck;
  modelCheck = (async () => {
    const wanted = process.env.OPENAI_MODEL ?? DEFAULT_MODEL;
    if (!isOpenAIEnabled() || wanted === DEFAULT_MODEL) return wanted;
    try {
      await getOpenAI().models.retrieve(wanted);
      console.info(`[openai] model "${wanted}" is available to this project`);
      return wanted;
    } catch (err) {
      const status = (err as { status?: number })?.status;
      const code = (err as { code?: string })?.code;
      const isMissingModel = code === "model_not_found" || status === 404 || status === 403;
      if (!isMissingModel) {
        console.warn(
          `[openai] could not verify model "${wanted}" (${status ?? "no status"}): ${
            err instanceof Error ? err.message : String(err)
          } — keeping it`,
        );
        return wanted;
      }
      console.error(
        `[openai] model "${wanted}" is not available to this project (${status ?? "?"} ${code ?? "model_not_found"}) — ` +
          `falling back to "${DEFAULT_MODEL}". Set OPENAI_MODEL to a model the key's project is entitled to.`,
      );
      modelOverride = DEFAULT_MODEL;
      return DEFAULT_MODEL;
    }
  })();
  return modelCheck;
}

/** A reasoning model (gpt-5, gpt-6, the o-series) thinks before it answers and rejects a temperature. */
export const isReasoningModelName = (model: string) => /^(gpt-5|gpt-6|o[1-9])/.test(model);

const modelChecks = new Map<string, Promise<boolean>>();

/**
 * WHETHER THIS KEY'S PROJECT MAY CALL `model` — asked once per model, then remembered (the same question
 * resolveOpenAIModel asks of OPENAI_MODEL, for a feature that names a model of its own: the house photo's read,
 * 2026-10-26). One free `models.retrieve`. Only model_not_found says no; an auth failure, a network blip or a rate
 * limit says nothing about entitlement and the model is kept.
 */
export function ensureModel(model: string): Promise<boolean> {
  const cached = modelChecks.get(model);
  if (cached) return cached;
  const check = (async () => {
    if (!isOpenAIEnabled()) return false;
    try {
      await getOpenAI().models.retrieve(model);
      return true;
    } catch (err) {
      const status = (err as { status?: number })?.status;
      const code = (err as { code?: string })?.code;
      if (code === "model_not_found" || status === 404 || status === 403) {
        console.error(`[openai] model "${model}" is not available to this project (${status ?? "?"} ${code ?? "model_not_found"})`);
        return false;
      }
      console.warn(`[openai] could not verify model "${model}" (${status ?? "no status"}): ${err instanceof Error ? err.message : String(err)} — keeping it`);
      return true;
    }
  })();
  modelChecks.set(model, check);
  return check;
}

/**
 * The sampling options a call may send: none to a reasoning model (gpt-5,
 * the o-series), which rejects a temperature and a seed and sets its own.
 * Every chat call passes its temperature through here, so moving
 * OPENAI_MODEL to gpt-5 never breaks a feature (2026-09-19).
 */
export async function samplingOptions(temperature: number, seed?: number): Promise<{ temperature?: number; seed?: number }> {
  const model = await resolveOpenAIModel();
  if (isReasoningModelName(model)) return {};
  return seed === undefined ? { temperature } : { temperature, seed };
}

/**
 * The model that reads photos and video frames: its own setting when one is
 * given (OPENAI_VISION_MODEL), else the model the estimators run on — the
 * owner moved them to gpt-4.1 and wanted pictures read by it too
 * (2026-09-19). A mini or nano tier reads a frame poorly (scale off a door, a
 * nameplate's small print), so pictures then keep gpt-4o.
 */
export function getVisionModel(override?: string | null): string {
  const own = override?.trim() || process.env.OPENAI_VISION_MODEL?.trim();
  if (own) return own;
  const main = getOpenAIModel();
  return /-(mini|nano)\b/.test(main) ? "gpt-4o" : main;
}

/** Import-time snapshot, kept for existing call sites that run only on the
 *  server (where the env is loaded before any import). New code — and anything
 *  a tsx harness can reach — should call getOpenAIModel() instead, which also
 *  reflects the availability check above. */
export const OPENAI_MODEL = getOpenAIModel();

/**
 * WHAT THE CONTRACTOR IS TOLD WHEN A MODEL CALL FAILS.
 *
 * One helper for every user-facing AI path, because the provider's own text is
 * not a message to a customer: a rate-limit error names the model, the billing
 * organization and the per-minute limit, and it used to reach the estimate
 * screen verbatim. Those details belong in the server log, next to the request
 * id that lets somebody look the call up — and nowhere else.
 *
 * The status is the whole classification: anything the shop can fix by waiting
 * reads as busy, anything only an owner can fix reads as not configured.
 */
export function friendlyAIError(err: unknown, scope: string): string {
  const status = (err as { status?: number })?.status;
  const requestId = (err as { requestID?: string | null })?.requestID;
  const raw = err instanceof Error ? err.message : String(err);
  console.error(
    `[openai] ${scope} failed${status ? ` (${status})` : ""}${requestId ? ` request=${requestId}` : ""}: ${raw}`,
  );
  if (status === 429 || (typeof status === "number" && status >= 500)) {
    return "The AI service is busy. Try again in a moment.";
  }
  if (status === 401 || status === 403) {
    return "AI is not configured for this workspace.";
  }
  return "Couldn't finish that. Try again.";
}

/** True for the statuses worth one more attempt: the service is busy or it
 *  broke on its own side. Everything else is an answer, not a hiccup. */
export function isTransientAIError(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  return status === 429 || (typeof status === "number" && status >= 500);
}
