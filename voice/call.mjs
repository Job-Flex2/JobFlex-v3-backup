// ONE CALL — Twilio's media stream on one side, OpenAI's realtime voice on the other,
// JobFlex's internal API for everything the desk does (lib/aiDesk/liveCall in the app).
//
// Twilio sends μ-law 8 kHz frames as base64 ("media"); OpenAI's realtime API takes and
// returns the same format (audio/pcmu), so audio passes straight through, no transcoding.
// The model speaks first (the greeting), listens with server-side turn detection, and
// calls tools: open_times, book_visit, take_message, transfer_call, end_call. Each tool
// is one POST to the app with the call's token. A brief may bring its own tools instead
// (2026-10-23: JobFlex's own outreach calls to contractors — lib/outreach in the app):
// the session offers those, and any of them but transfer_call / end_call goes to the
// app's /api/desk/tool as { token, name, args }. When the call ends — the caller hangs up,
// the desk says goodbye, a transfer, the time cap — the transcript and outcome go to the
// app (call-end), and the app's TwiML takes it from there (hang up, dial, voicemail).
//
// No Twilio credentials here, no database: the app owns both.

export const TOOLS = [
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
        notes: { type: "string", description: "Everything you learned for the team, as short labelled lines: Job, Details, Timeline, Budget, Decision, Email, Heard about us, Access — only the ones you learned" },
      },
      required: ["time_id", "name", "phone"],
    },
  },
  {
    type: "function",
    name: "take_message",
    description: "Take a message for the company: who called, their number, what it is about. Use when you cannot help or the caller asks for a call back.",
    parameters: { type: "object", properties: { name: { type: "string" }, phone: { type: "string" }, about: { type: "string", description: "What it is about, then everything you learned as short labelled lines: Job, Details, Timeline, Budget, Decision, Email, Heard about us, Access" } }, required: ["name", "phone", "about"] },
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
];

const now = () => Date.now();

/**
 * HOW THE DESK LISTENS (2026-10-14: the owner's first calls — "the voice breaks up and it interrupts real fast, so
 * sensitive"). Every speech_started used to wipe the desk's queued audio and cancel its reply, so a breath, a car,
 * a cough or the desk's own echo cut it off mid-word, and a 0.6 s pause counted as the caller being done. Now:
 *   · the line is cleaned (near-field noise reduction) and the turn detector is stricter and more patient;
 *   · talking over the desk interrupts it only after TURN.bargeMs of real speech energy on the caller's side
 *     (measured here, from Twilio's own frames) — a short sound leaves it talking;
 *   · what the caller said over the desk without interrupting (a cough, an "uh-huh") is dropped, not answered;
 *   · an interruption tells the model where its audio was cut (conversation.item.truncate), so it does not think
 *     the caller heard the rest.
 * Every number can be changed on the server (fly secrets) without a new build.
 */
const envNum = (v, d) => (v !== undefined && String(v).trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : d);
export const TURN = {
  threshold: envNum(process.env.VAD_THRESHOLD, 0.7),
  prefixMs: envNum(process.env.VAD_PREFIX_MS, 300),
  silenceMs: envNum(process.env.VAD_SILENCE_MS, 800),
  /** Speech over the desk that interrupts it. */
  bargeMs: envNum(process.env.BARGE_IN_MS, 320),
  /** Past this, a turn the detector still calls speech interrupts even if the level measure missed it (a quiet caller). */
  bargeFallbackMs: envNum(process.env.BARGE_FALLBACK_MS, 1000),
  noiseReduction: process.env.NOISE_REDUCTION === "off" ? null : process.env.NOISE_REDUCTION === "far_field" ? "far_field" : "near_field",
};
const FRAME_MS = 20;

/** μ-law byte → 16-bit sample (G.711). */
const MULAW = new Int16Array(256).map((_, i) => {
  const u = ~i & 0xff;
  const mag = ((((u & 0x0f) << 3) + 0x84) << ((u >> 4) & 7)) - 0x84;
  return u & 0x80 ? -mag : mag;
});
/** The loudness of one Twilio frame (base64 μ-law): its RMS on the 16-bit scale; 0 for silence. */
export function frameLevel(b64) {
  const buf = Buffer.from(String(b64 || ""), "base64");
  if (!buf.length) return 0;
  let sum = 0;
  for (const x of buf) sum += MULAW[x] * MULAW[x];
  return Math.sqrt(sum / buf.length);
}

/** Twilio's event names and OpenAI's, in one place. */
const AUDIO_DELTA = new Set(["response.output_audio.delta", "response.audio.delta"]);
const ASSISTANT_TEXT = new Set(["response.output_audio_transcript.done", "response.audio_transcript.done"]);
const USER_TEXT = new Set(["conversation.item.input_audio_transcription.completed"]);

export class Call {
  /**
   * @param {object} o
   * @param {import("ws").WebSocket} o.twilio   the Twilio media-stream socket
   * @param {(brief:object) => Promise<WebSocket>} o.openAI  opens the realtime socket for a brief
   * @param {{ post: (path:string, body:object) => Promise<object> }} o.app  JobFlex's internal API
   * @param {(line:string) => void} [o.log]
   */
  constructor({ twilio, openAI, app, log = () => {} }) {
    this.twilio = twilio;
    this.openOpenAI = openAI;
    this.app = app;
    this.log = log;
    this.ai = null;
    this.streamSid = null;
    this.token = null;
    this.brief = null;
    this.transcript = [];
    this.outcome = "voicemail";
    /** The last thing that went wrong — OpenAI's error event, or why the session never opened — for the app to show. */
    this.lastError = null;
    this.booked = null;
    this.messageTaken = false;
    this.startedAt = now();
    this.closing = false;
    this.ended = false;
    this.pendingClose = null;
    this.timers = [];
    // what the desk is saying: audio marks Twilio has not played yet (by generation — a clear starts a new one)
    this.audioGen = 0;
    this.unplayed = 0;
    /** The desk's audio item now playing: its id, when it started, how much audio it has. */
    this.item = null;
    this.responding = false;
    this.wantResponse = false;
    /** The caller's turn the detector opened: whether the desk was talking, how much was loud, interrupted or not. */
    this.turn = null;
    this.noiseFloor = 200;
    this.stats = { interruptions: 0, ignored: 0 };
    this.twilio.on("message", (data) => this.onTwilio(data));
    this.twilio.on("close", () => void this.finish("twilio-closed"));
    this.twilio.on("error", (e) => this.log(`twilio socket error: ${e.message}`));
  }

  // ── Twilio → here
  async onTwilio(data) {
    let msg;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }
    switch (msg.event) {
      case "start":
        this.streamSid = msg.start?.streamSid ?? null;
        this.callSid = msg.start?.callSid ?? null;
        this.token = msg.start?.customParameters?.token ?? null;
        await this.begin();
        return;
      case "media":
        if (this.ai && this.ai.readyState === 1 && msg.media?.payload) {
          this.ai.send(JSON.stringify({ type: "input_audio_buffer.append", audio: msg.media.payload }));
          this.hear(msg.media.payload);
        }
        return;
      case "stop":
        await this.finish("caller-hung-up");
        return;
      case "mark":
        // Twilio echoes a mark once the audio before it has played (or was cleared).
        if (msg.mark?.name === `a${this.audioGen}`) {
          this.unplayed = Math.max(0, this.unplayed - 1);
          if (!this.unplayed) this.item = null;
          return;
        }
        // …the goodbye is done.
        if (msg.mark?.name === "bye" && this.pendingClose) {
          const why = this.pendingClose;
          this.pendingClose = null;
          void this.finish(why);
        }
        return;
      default:
        return;
    }
  }

  /** The brief from the app, then the realtime session. Any failure → close, and the app's TwiML takes a message instead. */
  async begin() {
    if (!this.token) return this.fail("no token on the stream");
    try {
      this.brief = await this.app.post("/api/desk/call-brief", { token: this.token });
    } catch (e) {
      return this.fail(`no brief: ${e.message}`);
    }
    if (!this.brief || this.brief.ok === false) {
      // The app never accepted the call: nothing to report back for it.
      const why = this.brief?.error ?? "?";
      this.brief = null;
      return this.fail(`brief refused: ${why}`);
    }
    try {
      this.ai = await this.openOpenAI(this.brief);
    } catch (e) {
      return this.fail(`openai: ${e.message}`);
    }
    this.ai.addEventListener("message", (ev) => this.onOpenAI(ev.data));
    this.ai.addEventListener("close", () => {
      if (!this.ended) void this.finish("openai-closed");
    });
    this.ai.addEventListener("error", () => {
      if (!this.ended) void this.finish("openai-error");
    });
    // The desk speaks first: its greeting.
    this.aiSend({ type: "response.create", response: { instructions: "Start the call by saying your GREETING exactly as written in your instructions — every word of it, including that it is an AI and that the call is recorded, in the greeting's own words — then wait for the caller." } });
    const max = Math.max(60, Number(this.brief.maxSeconds) || 600) * 1000;
    this.timers.push(setTimeout(() => this.aiSend({ type: "response.create", response: { instructions: "You have about thirty seconds left on this call. Wrap up: confirm anything booked or any message taken, say goodbye, and call end_call." } }), max - 30_000));
    this.timers.push(setTimeout(() => void this.finish("time-cap"), max));
  }

  /** The desk's audio is still playing to the caller. */
  deskSpeaking() {
    return this.unplayed > 0;
  }

  /** One frame of the caller's audio: the noise floor between turns; inside a turn over the desk, whether it is a real interruption. */
  hear(payload) {
    const level = frameLevel(payload);
    const t = this.turn;
    if (!t) {
      this.noiseFloor = Math.min(3000, Math.max(50, this.noiseFloor * 0.97 + level * 0.03));
      return;
    }
    t.frames += 1;
    if (level > Math.max(400, this.noiseFloor * 2.5)) t.loud += 1;
    if (t.overDesk && !t.interrupted && this.deskSpeaking() && (t.loud * FRAME_MS >= TURN.bargeMs || t.frames * FRAME_MS >= TURN.bargeFallbackMs)) this.interrupt();
  }

  /** The caller really talks over the desk: stop it where it is, and tell the model how much was heard. */
  interrupt() {
    if (this.turn) this.turn.interrupted = true;
    this.stats.interruptions += 1;
    if (this.item?.id) {
      const heard = Math.max(0, Math.min(this.item.ms, now() - this.item.startedAt));
      this.aiSend({ type: "conversation.item.truncate", item_id: this.item.id, content_index: 0, audio_end_ms: Math.round(heard) });
    }
    this.twilioSend({ event: "clear", streamSid: this.streamSid });
    this.audioGen += 1;
    this.unplayed = 0;
    this.item = null;
    if (this.responding) this.aiSend({ type: "response.cancel" });
  }

  /** The caller's turn is in: answer it — unless it was a sound over the desk that did not interrupt it. */
  turnDone(itemId) {
    const t = this.turn;
    this.turn = null;
    if (t && t.overDesk && !t.interrupted && this.deskSpeaking()) {
      this.stats.ignored += 1;
      if (itemId) this.aiSend({ type: "conversation.item.delete", item_id: itemId });
      return;
    }
    if (this.responding) {
      this.wantResponse = true;
      return;
    }
    this.aiSend({ type: "response.create" });
  }

  aiSend(obj) {
    if (this.ai && this.ai.readyState === 1) this.ai.send(JSON.stringify(obj));
  }

  // ── OpenAI → here
  async onOpenAI(raw) {
    let ev;
    try {
      ev = JSON.parse(String(raw));
    } catch {
      return;
    }
    const t = ev.type;
    if (AUDIO_DELTA.has(t) && ev.delta) {
      if (!this.item || (ev.item_id && this.item.id !== ev.item_id)) this.item = { id: ev.item_id ?? null, startedAt: now(), ms: 0 };
      this.item.ms += (String(ev.delta).length * 3) / 4 / 8; // base64 → μ-law bytes → ms at 8 kHz
      this.twilioSend({ event: "media", streamSid: this.streamSid, media: { payload: ev.delta } });
      this.twilioSend({ event: "mark", streamSid: this.streamSid, mark: { name: `a${this.audioGen}` } });
      this.unplayed += 1;
      return;
    }
    if (t === "response.created") {
      this.responding = true;
      return;
    }
    if (t === "input_audio_buffer.speech_started") {
      // A turn opens. Whether it interrupts the desk is decided frame by frame (hear) — not on the first sound.
      this.turn = { overDesk: this.deskSpeaking(), loud: 0, frames: 0, interrupted: false };
      return;
    }
    if (t === "input_audio_buffer.committed") {
      this.turnDone(ev.item_id ?? null);
      return;
    }
    if (USER_TEXT.has(t) && ev.transcript) {
      this.transcript.push({ role: "caller", text: String(ev.transcript).trim() });
      return;
    }
    if (ASSISTANT_TEXT.has(t) && ev.transcript) {
      this.transcript.push({ role: "desk", text: String(ev.transcript).trim() });
      return;
    }
    if (t === "response.function_call_arguments.done") {
      await this.tool(ev.name, ev.call_id, ev.arguments);
      return;
    }
    if (t === "response.done") {
      this.responding = false;
      if (this.wantResponse && !this.pendingClose) {
        this.wantResponse = false;
        this.aiSend({ type: "response.create" });
      }
    }
    if (t === "response.done" && this.pendingClose) {
      // The goodbye (or the "transferring you now") has been generated: a mark after it, so
      // Twilio tells us when it has PLAYED; three seconds as the fallback.
      const why = this.pendingClose;
      this.twilioSend({ event: "mark", streamSid: this.streamSid, mark: { name: "bye" } });
      this.timers.push(
        setTimeout(() => {
          if (this.pendingClose === why) this.pendingClose = null;
          void this.finish(why);
        }, 3000),
      );
      return;
    }
    if (t === "error") {
      const msg = (ev.error && typeof ev.error.message === "string" ? ev.error.message : JSON.stringify(ev.error ?? ev)).slice(0, 300);
      // A cancel sent while nothing was playing is nothing wrong (the caller spoke in a gap); not a failure to report.
      // Nor is a cut that came after the audio ended, or a dropped sound already gone.
      if (/cancellation failed|no active response|audio_end_ms|truncat|item.*not found|does not exist/i.test(msg)) return;
      this.lastError = msg;
      this.log(`openai error: ${msg}`);
    }
  }

  async tool(name, callId, argsJson) {
    let args = {};
    try {
      args = argsJson ? JSON.parse(argsJson) : {};
    } catch {
      args = {};
    }
    let output;
    try {
      switch (name) {
        case "open_times": {
          const r = await this.app.post("/api/desk/open-times", { token: this.token, service: args.service ?? null, days: args.days ?? 7 });
          output = r.ok === false ? { error: r.error } : { times: r.times, note: r.note };
          break;
        }
        case "book_visit": {
          const r = await this.app.post("/api/desk/book", { token: this.token, timeId: args.time_id, name: args.name, phone: args.phone, address: args.address ?? null, notes: args.notes ?? null });
          if (r.ok) {
            this.booked = { appointmentId: r.appointmentId, when: r.when };
            this.outcome = "done";
          }
          output = r.ok ? { booked: true, when: r.when, service: r.serviceLabel } : { error: r.error };
          break;
        }
        case "take_message": {
          const r = await this.app.post("/api/desk/message", { token: this.token, name: args.name, phone: args.phone, about: args.about });
          if (r.ok) {
            this.messageTaken = true;
            this.outcome = "done";
          }
          output = r.ok ? { taken: true } : { error: r.error };
          break;
        }
        case "transfer_call":
          this.outcome = "transfer";
          this.pendingClose = "transfer";
          output = { transferring: true, say: "Tell the caller you are putting them through now, briefly." };
          break;
        case "end_call":
          if (this.outcome === "voicemail") this.outcome = "done";
          this.pendingClose = "ended";
          output = { ending: true, say: "Say goodbye briefly." };
          break;
        default: {
          // A tool the brief brought (an outreach call's): the app runs it.
          if (!this.briefTools().some((t) => t.name === name)) {
            output = { error: `unknown tool ${name}` };
            break;
          }
          const r = await this.app.post("/api/desk/tool", { token: this.token, name, args });
          if (r.ok !== false && r.outcome === "done" && this.outcome === "voicemail") this.outcome = "done";
          output = r.ok === false ? { error: r.error } : (r.output ?? { done: true });
        }
      }
    } catch (e) {
      output = { error: `JobFlex could not do that right now: ${e.message}` };
    }
    this.aiSend({ type: "conversation.item.create", item: { type: "function_call_output", call_id: callId, output: JSON.stringify(output) } });
    this.aiSend({ type: "response.create" });
  }

  /** The tools this call's brief brought, if any (else the desk's own, TOOLS). */
  briefTools() {
    return Array.isArray(this.brief?.tools) ? this.brief.tools : [];
  }

  twilioSend(obj) {
    if (this.twilio.readyState === 1) this.twilio.send(JSON.stringify(obj));
  }

  fail(why) {
    this.log(`call failed before the desk spoke: ${why}`);
    this.lastError = this.lastError ?? why;
    this.outcome = "failed";
    return this.finish("failed");
  }

  /** Once: tell the app how the call went, then close both sockets. */
  async finish(why) {
    if (this.ended) return;
    this.ended = true;
    for (const t of this.timers) clearTimeout(t);
    const seconds = Math.round((now() - this.startedAt) / 1000);
    // The desk never said a word and something went wrong: that is a failed call, not a voicemail.
    if (this.outcome === "voicemail" && !this.transcript.some((l) => l.role === "desk") && (this.lastError || /^openai/.test(why))) {
      this.outcome = "failed";
      this.lastError = this.lastError ?? `the realtime session ended (${why}) before the desk spoke`;
    }
    this.log(`call ${this.callSid ?? "?"} ended (${why}) · ${this.outcome} · ${seconds}s · ${this.transcript.length} lines · ${this.stats.interruptions} interrupted · ${this.stats.ignored} sounds ignored${this.lastError ? ` · ${this.lastError}` : ""}`);
    if (this.token && this.brief) {
      try {
        await this.app.post("/api/desk/call-end", { token: this.token, outcome: this.outcome, transcript: this.transcript, seconds, booked: this.booked, messageTaken: this.messageTaken, why, error: this.lastError });
      } catch (e) {
        this.log(`call-end not delivered: ${e.message}`);
      }
    }
    try {
      this.ai?.close();
    } catch {
      /* already closed */
    }
    try {
      this.twilio.close();
    } catch {
      /* already closed */
    }
  }
}

/** The turn detector: strict and patient; the server neither answers nor interrupts by itself — the Call decides. */
export function turnDetection() {
  return { type: "server_vad", threshold: TURN.threshold, prefix_padding_ms: TURN.prefixMs, silence_duration_ms: TURN.silenceMs, create_response: false, interrupt_response: false };
}

/** The tools a session offers: the brief's own when it brings them (each a function with a name), else the desk's. */
export function toolsFor(brief) {
  const own = Array.isArray(brief?.tools) ? brief.tools.filter((t) => t && t.type === "function" && typeof t.name === "string") : [];
  return own.length ? own : TOOLS;
}

/** The realtime session for a brief — GA shape, or the beta shape when REALTIME_API=beta. */
export function sessionUpdate(brief, api = "ga") {
  const voice = brief.voice || "marin";
  if (api === "beta") {
    return {
      type: "session.update",
      session: {
        modalities: ["audio", "text"],
        instructions: brief.instructions,
        voice,
        input_audio_format: "g711_ulaw",
        output_audio_format: "g711_ulaw",
        input_audio_transcription: { model: "gpt-4o-mini-transcribe" },
        ...(TURN.noiseReduction ? { input_audio_noise_reduction: { type: TURN.noiseReduction } } : {}),
        turn_detection: turnDetection(),
        tools: toolsFor(brief),
        tool_choice: "auto",
      },
    };
  }
  return {
    type: "session.update",
    session: {
      type: "realtime",
      instructions: brief.instructions,
      output_modalities: ["audio"],
      audio: {
        input: {
          format: { type: "audio/pcmu" },
          transcription: { model: "gpt-4o-mini-transcribe" },
          ...(TURN.noiseReduction ? { noise_reduction: { type: TURN.noiseReduction } } : {}),
          turn_detection: turnDetection(),
        },
        output: { format: { type: "audio/pcmu" }, voice },
      },
      tools: toolsFor(brief),
      tool_choice: "auto",
    },
  };
}
