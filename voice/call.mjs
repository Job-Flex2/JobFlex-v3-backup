// ONE CALL — Twilio's media stream on one side, OpenAI's realtime voice on the other,
// JobFlex's internal API for everything the desk does (lib/aiDesk/liveCall in the app).
//
// Twilio sends μ-law 8 kHz frames as base64 ("media"); OpenAI's realtime API takes and
// returns the same format (audio/pcmu), so audio passes straight through, no transcoding.
// The model speaks first (the greeting), listens with server-side turn detection, and
// calls tools: open_times, book_visit, take_message, transfer_call, end_call. Each tool
// is one POST to the app with the call's token. When the call ends — the caller hangs up,
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
];

const now = () => Date.now();

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
        }
        return;
      case "stop":
        await this.finish("caller-hung-up");
        return;
      case "mark":
        // Twilio echoes our mark once the audio before it has played: the goodbye is done.
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
    this.aiSend({ type: "response.create", response: { instructions: "Start the call by saying your GREETING exactly as written in your instructions — every word of it, including that this is a virtual assistant and the call is recorded — then wait for the caller." } });
    const max = Math.max(60, Number(this.brief.maxSeconds) || 600) * 1000;
    this.timers.push(setTimeout(() => this.aiSend({ type: "response.create", response: { instructions: "You have about thirty seconds left on this call. Wrap up: confirm anything booked or any message taken, say goodbye, and call end_call." } }), max - 30_000));
    this.timers.push(setTimeout(() => void this.finish("time-cap"), max));
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
      this.twilioSend({ event: "media", streamSid: this.streamSid, media: { payload: ev.delta } });
      return;
    }
    if (t === "input_audio_buffer.speech_started") {
      // The caller talks over the desk: drop what is queued at Twilio and stop the reply.
      this.twilioSend({ event: "clear", streamSid: this.streamSid });
      this.aiSend({ type: "response.cancel" });
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
      if (/cancellation failed|no active response/i.test(msg)) return;
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
        default:
          output = { error: `unknown tool ${name}` };
      }
    } catch (e) {
      output = { error: `JobFlex could not do that right now: ${e.message}` };
    }
    this.aiSend({ type: "conversation.item.create", item: { type: "function_call_output", call_id: callId, output: JSON.stringify(output) } });
    this.aiSend({ type: "response.create" });
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
    this.log(`call ${this.callSid ?? "?"} ended (${why}) · ${this.outcome} · ${seconds}s · ${this.transcript.length} lines${this.lastError ? ` · ${this.lastError}` : ""}`);
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
        turn_detection: { type: "server_vad", silence_duration_ms: 600 },
        tools: TOOLS,
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
        input: { format: { type: "audio/pcmu" }, transcription: { model: "gpt-4o-mini-transcribe" }, turn_detection: { type: "server_vad", silence_duration_ms: 600 } },
        output: { format: { type: "audio/pcmu" }, voice },
      },
      tools: TOOLS,
      tool_choice: "auto",
    },
  };
}
