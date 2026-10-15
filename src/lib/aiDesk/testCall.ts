// "TEST IT HERE" — the owner calls the desk from the browser. Pure, browser-safe.
//
// The browser talks to OpenAI's realtime API directly over WebRTC with a key the app
// mints for one session (actions/aiDesk startDeskTest → OpenAI `client_secrets`); the
// desk's instructions, voice and tools ride on that key, so the browser never sees the
// company key. Events arrive on the "oai-events" data channel with the same names the
// voice server reads (voice/call.mjs) — `readRealtimeEvent` turns one into what the test
// panel does with it. Tools run through `deskTestTool`: open times are the calendar's
// real ones, booking and messages only say what would happen.

/** The tools the desk has on a call. Kept identical to TOOLS in voice/call.mjs (a QA check compares them). */
export const DESK_TOOLS = [
  {
    type: "function",
    name: "open_times",
    description: "The next open appointment times on the company's calendar. Call it before offering any time. Returns up to 6 options with an id each.",
    parameters: { type: "object", properties: { service: { type: "string", description: "What the visit is for, in the caller's words (estimate, repair, leak…)" }, days: { type: "integer", description: "How many days ahead to look (default 7)" } }, required: [] },
  },
  {
    type: "function",
    name: "book_visit",
    description: "Book one of the open times for the caller. Only after the caller chose a time from open_times and gave their name and phone number.",
    parameters: {
      type: "object",
      properties: {
        time_id: { type: "string", description: "The id of the chosen time from open_times" },
        name: { type: "string" },
        phone: { type: "string", description: "The caller's phone number; the number they are calling from if they say so" },
        address: { type: "string", description: "The job address, if given" },
        notes: { type: "string", description: "What the visit is for, in a few words" },
      },
      required: ["time_id", "name", "phone"],
    },
  },
  {
    type: "function",
    name: "take_message",
    description: "Take a message for the company: who called, their number, what it is about. Use when you cannot help or the caller asks for a call back.",
    parameters: { type: "object", properties: { name: { type: "string" }, phone: { type: "string" }, about: { type: "string" } }, required: ["name", "phone", "about"] },
  },
  {
    type: "function",
    name: "transfer_call",
    description: "Hand the call to a person at the company (their phone rings). Use when the caller asks for a person or the matter is urgent and the instructions allow it. Say you are transferring first.",
    parameters: { type: "object", properties: { reason: { type: "string" } }, required: [] },
  },
  {
    type: "function",
    name: "end_call",
    description: "End the call after the goodbye, once the caller has what they need.",
    parameters: { type: "object", properties: {}, required: [] },
  },
] as const;

export const TEST_TOOL_NAMES = ["open_times", "book_visit", "take_message", "transfer_call", "end_call"] as const;
export type TestToolName = (typeof TEST_TOOL_NAMES)[number];

/** Added to the desk's instructions for a test call. */
export const TEST_NOTE = [
  "THIS CALL IS A TEST: the company's owner is calling from their browser to hear how you handle a call. Treat them exactly as a caller.",
  "Booking, messages and transfers are simulated on this call — nothing is saved and no phone rings — and the owner knows it; do not mention it unless they ask.",
  "There is no caller ID: ask for their number if you need it.",
].join(" ");

/** The default realtime model; the voice server reads the same variable on Fly. */
export const DEFAULT_VOICE_MODEL = "gpt-realtime-mini";

export type RealtimeApi = "ga" | "beta";

/** How the test listens — the phone desk's stricter, more patient detector (voice/call.mjs TURN, 2026-10-14: "it
 *  interrupts real fast, so sensitive"), with the laptop's far-field noise reduction. The browser's WebRTC cuts its own
 *  playback on an interruption, so here the server still interrupts and answers by itself. */
export const TEST_TURN = { type: "server_vad", threshold: 0.7, prefix_padding_ms: 300, silence_duration_ms: 800 } as const;

/** The session the ephemeral key is minted for — GA shape, or the beta shape when REALTIME_API=beta (as voice/call.mjs). */
export function testSession(input: { instructions: string; voice: string; model: string; api: RealtimeApi }): Record<string, unknown> {
  if (input.api === "beta") {
    return {
      model: input.model,
      modalities: ["audio", "text"],
      instructions: input.instructions,
      voice: input.voice,
      input_audio_transcription: { model: "gpt-4o-mini-transcribe" },
      input_audio_noise_reduction: { type: "far_field" },
      turn_detection: TEST_TURN,
      tools: DESK_TOOLS,
      tool_choice: "auto",
    };
  }
  return {
    type: "realtime",
    model: input.model,
    instructions: input.instructions,
    output_modalities: ["audio"],
    audio: {
      input: { transcription: { model: "gpt-4o-mini-transcribe" }, noise_reduction: { type: "far_field" }, turn_detection: TEST_TURN },
      output: { voice: input.voice },
    },
    tools: DESK_TOOLS,
    tool_choice: "auto",
  };
}

/** Where the browser posts its SDP offer — OpenAI's public endpoint, never a proxy base. */
export const realtimeCallsUrl = (api: RealtimeApi, model: string): string => (api === "beta" ? `https://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}` : "https://api.openai.com/v1/realtime/calls");

/** What the test panel does with one event from the data channel. */
export type TestEvent =
  | { kind: "desk"; text: string }
  | { kind: "caller"; text: string }
  | { kind: "tool"; name: string; callId: string; args: Record<string, unknown> }
  | { kind: "turn-done" }
  | { kind: "caller-speaking" }
  | { kind: "error"; message: string }
  | null;

const AUDIO_TEXT = new Set(["response.output_audio_transcript.done", "response.audio_transcript.done"]);

export function readRealtimeEvent(raw: unknown): TestEvent {
  let ev: { type?: unknown; transcript?: unknown; name?: unknown; call_id?: unknown; arguments?: unknown; error?: unknown };
  if (typeof raw === "string") {
    try {
      ev = JSON.parse(raw) as typeof ev;
    } catch {
      return null;
    }
  } else if (raw && typeof raw === "object") ev = raw as typeof ev;
  else return null;
  const t = typeof ev.type === "string" ? ev.type : "";
  if (AUDIO_TEXT.has(t) && typeof ev.transcript === "string" && ev.transcript.trim()) return { kind: "desk", text: ev.transcript.trim() };
  if (t === "conversation.item.input_audio_transcription.completed" && typeof ev.transcript === "string" && ev.transcript.trim()) return { kind: "caller", text: ev.transcript.trim() };
  if (t === "response.function_call_arguments.done" && typeof ev.name === "string") {
    let args: Record<string, unknown> = {};
    if (typeof ev.arguments === "string" && ev.arguments) {
      try {
        const parsed = JSON.parse(ev.arguments) as unknown;
        if (parsed && typeof parsed === "object") args = parsed as Record<string, unknown>;
      } catch {
        args = {};
      }
    }
    return { kind: "tool", name: ev.name, callId: typeof ev.call_id === "string" ? ev.call_id : "", args };
  }
  if (t === "response.done") return { kind: "turn-done" };
  if (t === "input_audio_buffer.speech_started") return { kind: "caller-speaking" };
  if (t === "error") {
    const e = ev.error as { message?: unknown } | undefined;
    return { kind: "error", message: typeof e?.message === "string" ? e.message : "The desk hit an error." };
  }
  return null;
}

/** The first client event on the channel: the desk speaks first, as on a real call. */
export const GREET_FIRST = { type: "response.create", response: { instructions: "Start the call by saying your GREETING exactly as written in your instructions — every word of it, including that this is a virtual assistant and the call is recorded — then wait for the caller." } } as const;

/** A tool's result back to the model, then the model's next turn. */
export const toolOutputEvents = (callId: string, output: unknown): Array<Record<string, unknown>> => [
  { type: "conversation.item.create", item: { type: "function_call_output", call_id: callId, output: JSON.stringify(output) } },
  { type: "response.create" },
];

/** A time id from open_times (`serviceKey|ISO`) in words, for a simulated booking. */
export function timeIdWords(timeId: string, timeZone: string): string | null {
  const iso = timeId.split("|")[1];
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return d.toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZone });
  } catch {
    return d.toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
  }
}
