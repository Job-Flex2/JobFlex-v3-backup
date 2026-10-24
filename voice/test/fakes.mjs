// Stand-ins for the tests and the stand walk: OpenAI's realtime API, JobFlex's internal
// API, and Twilio's media-stream client. No network beyond localhost.
import http from "node:http";
import { WebSocketServer } from "ws";
import { mulawEncode } from "./audio.mjs";

const SILENCE = Buffer.alloc(160, 0xff).toString("base64"); // 20 ms of μ-law silence
/** 20 ms of a caller talking: a 200 Hz tone at speech level. */
export const SPEECH = Buffer.from(mulawEncode(new Int16Array(160).map((_, i) => Math.round(Math.sin((2 * Math.PI * 200 * i) / 8000) * 6000)))).toString("base64");

/**
 * A fake realtime server. Scenario (FAKE_SCENARIO or the option): "book" — greeting,
 * then open_times → book_visit → end_call; "transfer" — greeting then transfer_call;
 * "message" — greeting, take_message, end_call. Records every session.update.
 */
export function fakeRealtime({ port = 0, scenario = process.env.FAKE_SCENARIO || "book" } = {}) {
  const seen = { sessions: [], items: [], responses: 0, cancels: 0, truncates: [], deletes: [] };
  const wss = new WebSocketServer({ port });
  wss.on("connection", (ws) => {
    const session = { steps: 0, timesId: null };
    const send = (o) => ws.readyState === 1 && ws.send(JSON.stringify(o));
    const speak = (text) => {
      send({ type: "response.output_audio.delta", delta: SILENCE });
      send({ type: "response.output_audio.delta", delta: SILENCE });
      send({ type: "response.output_audio_transcript.done", transcript: text });
    };
    const call = (name, args) => send({ type: "response.function_call_arguments.done", name, call_id: `call_${name}_${Date.now()}`, arguments: JSON.stringify(args) });
    ws.on("message", (raw) => {
      const ev = JSON.parse(String(raw));
      if (session.dead) return;
      if (ev.type === "session.update") seen.sessions.push(ev.session);
      // "badkey": what OpenAI does with a key it refuses — the socket opens, an error event, silence, then it closes.
      if (ev.type === "session.update" && scenario === "badkey") {
        session.dead = true;
        send({ type: "error", event_id: "evt_bad", error: { type: "invalid_request_error", code: "invalid_api_key", message: "Incorrect API key provided: sk-fake-***-123. You can find your API key at https://platform.openai.com/account/api-keys." } });
        setTimeout(() => ws.close(), 50);
        return;
      }
      if (ev.type === "response.cancel") seen.cancels++;
      if (ev.type === "conversation.item.truncate") seen.truncates.push(ev);
      if (ev.type === "conversation.item.delete") seen.deletes.push(ev.item_id);
      // "talkover": the desk is mid-greeting when the caller makes a sound (a cough, or real words — the test's
      // Twilio client decides how long); the turn ends 25 frames later and is committed.
      if (scenario === "talkover" && ev.type === "input_audio_buffer.append") {
        session.audio = (session.audio || 0) + 1;
        if (session.audio === 30) send({ type: "input_audio_buffer.speech_started", audio_start_ms: 600, item_id: "item_caller" });
        if (session.audio === 55) {
          send({ type: "input_audio_buffer.speech_stopped", audio_end_ms: 1100, item_id: "item_caller" });
          send({ type: "input_audio_buffer.committed", item_id: "item_caller" });
        }
        return;
      }
      if (scenario === "talkover" && ev.type === "response.create") {
        seen.responses++;
        if (session.steps === 0) {
          session.steps = 1;
          send({ type: "response.created" });
          for (let i = 0; i < 100; i++) send({ type: "response.output_audio.delta", item_id: "item_greeting", delta: SILENCE }); // 2 s of greeting
          send({ type: "response.output_audio_transcript.done", transcript: "Thanks for calling. This is the virtual assistant, and this call is recorded. How can I help?" });
          send({ type: "response.done" });
        } else {
          send({ type: "response.created" });
          send({ type: "response.done" });
        }
        return;
      }
      if (ev.type === "input_audio_buffer.append") {
        // After the greeting and ~1 s of caller audio, the caller "speaks".
        session.audio = (session.audio || 0) + 1;
        if (session.audio === 50 && session.steps === 1) {
          send({ type: "input_audio_buffer.speech_started" });
          send({ type: "conversation.item.input_audio_transcription.completed", transcript: scenario === "transfer" ? "Can I talk to someone there?" : scenario === "message" ? "Please have someone call me back about my gutters." : scenario === "outreach" ? "Sure, email me the link — sam@example.com." : "Can someone come look at my roof this week?" });
          session.steps = 2;
          if (scenario === "transfer") call("transfer_call", { reason: "caller asked for a person" });
          else if (scenario === "outreach") call("email_trial_link", { email: "sam@example.com" });
          else if (scenario === "message") call("take_message", { name: "Dana Lee", phone: "+12065550123", about: "Gutters — call back" });
          else call("open_times", { service: "roof estimate", days: 7 });
        }
      }
      if (ev.type === "conversation.item.create" && ev.item?.type === "function_call_output") {
        seen.items.push(ev.item);
        const out = JSON.parse(ev.item.output || "{}");
        if (out.times && session.steps === 2) {
          session.steps = 3;
          session.timesId = out.times[0]?.id;
        }
      }
      if (ev.type === "response.create") {
        seen.responses++;
        if (session.steps === 0) {
          session.steps = 1;
          speak("Thanks for calling. This is the virtual assistant, and this call is recorded. How can I help?");
          send({ type: "response.done" });
          return;
        }
        if (session.steps === 3 && session.timesId) {
          session.steps = 4;
          speak(`I can do the first open time. May I have your name and number?`);
          send({ type: "conversation.item.input_audio_transcription.completed", transcript: "Sam Rivera, 206-555-0123, 123 Pine St Bellevue" });
          call("book_visit", { time_id: session.timesId, name: "Sam Rivera", phone: "2065550123", address: "123 Pine St, Bellevue", notes: "roof estimate" });
          return;
        }
        const last = seen.items[seen.items.length - 1];
        const out = last ? JSON.parse(last.output || "{}") : {};
        if (out.booked || out.taken || out.sent) {
          speak(out.booked ? `You're booked for ${out.when}. Anything else?` : out.sent ? "It's in your inbox. Thanks for your time." : "I've passed that on. Anything else?");
          call("end_call", {});
          return;
        }
        if (out.ending || out.transferring) {
          speak(out.ending ? "Thanks for calling — goodbye." : "Putting you through now.");
          send({ type: "response.done" });
          return;
        }
        if (out.error) {
          speak(`Sorry — ${out.error}`);
          call("end_call", {});
          return;
        }
        send({ type: "response.done" });
      }
    });
  });
  return { wss, seen, get port() { return wss.address().port; }, close: () => wss.close() };
}

/** The tools an outreach brief brings (the app's lib/outreach has the real ones). */
export const OUTREACH_TOOLS = [
  { type: "function", name: "email_trial_link", description: "Email the free-trial link.", parameters: { type: "object", properties: { email: { type: "string" } }, required: ["email"] } },
  { type: "function", name: "end_call", description: "End the call after the goodbye.", parameters: { type: "object", properties: {}, required: [] } },
];

/** A fake JobFlex internal API: a brief for any token except "bad", and a log of every call. */
export function fakeApp({ port = 0 } = {}) {
  const log = [];
  const srv = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const json = body ? JSON.parse(body) : {};
      log.push({ path: req.url, secret: req.headers["x-desk-secret"], body: json });
      const reply = (o, status = 200) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(o));
      };
      if (req.headers["x-desk-secret"] !== "test-secret") return reply({ ok: false, error: "forbidden" }, 403);
      if (json.token === "bad") return reply({ ok: false, error: "bad token" }, 403);
      switch (req.url) {
        case "/api/desk/call-brief":
          // An outreach call (JobFlex calling a contractor) brings its own tools.
          if (json.token === "tok-outreach")
            return reply({ ok: true, instructions: "You are JobFlex's virtual assistant calling Sam at Test Roofing.", voice: "marin", maxSeconds: 300, callSid: "CAout", tools: OUTREACH_TOOLS });
          return reply({ ok: true, instructions: "You are the phone assistant for Test Roofing.", voice: "marin", maxSeconds: 120, callSid: "CAtest" });
        case "/api/desk/tool":
          return reply({ ok: true, outcome: "done", output: { sent: true, to: json.args?.email ?? null } });
        case "/api/desk/open-times":
          return reply({ ok: true, times: [{ id: "t1", label: "Tue, Oct 14 · 8:00 AM", startsAt: "2026-10-14T15:00:00.000Z" }, { id: "t2", label: "Tue, Oct 14 · 10:00 AM", startsAt: "2026-10-14T17:00:00.000Z" }], note: "Free estimate, 1 hour." });
        case "/api/desk/book":
          return reply({ ok: true, appointmentId: "appt1", when: "Tue, Oct 14 · 8:00 AM", serviceLabel: "Roof inspection and estimate" });
        case "/api/desk/message":
          return reply({ ok: true });
        case "/api/desk/call-end":
          return reply({ ok: true });
        default:
          return reply({ ok: false, error: "no such route" }, 404);
      }
    });
  });
  srv.listen(port);
  return { srv, log, get port() { return srv.address().port; }, close: () => srv.close() };
}

/**
 * A fake Twilio media-stream client: connects with a token, sends silence as the caller,
 * collects what the desk sends back, and resolves when the server closes the stream.
 */
export function twilioClient({ url, token, callSid = "CAtest", frames = 120, WS, speech = null, markDelay = 100, hangUpAfter = 0 }) {
  return new Promise((resolve, reject) => {
    const ws = new WS(url);
    const got = { media: 0, clears: 0, closed: false };
    let timer = null;
    ws.on("open", () => {
      ws.send(JSON.stringify({ event: "connected", protocol: "Call" }));
      ws.send(JSON.stringify({ event: "start", start: { streamSid: "MZtest", callSid, customParameters: { token }, mediaFormat: { encoding: "audio/x-mulaw", sampleRate: 8000, channels: 1 } } }));
      let n = 0;
      timer = setInterval(() => {
        if (ws.readyState !== 1) return clearInterval(timer);
        // `speech` [from, to): frames where the caller talks; silence elsewhere.
        const talking = speech && n >= speech[0] && n < speech[1];
        ws.send(JSON.stringify({ event: "media", media: { track: "inbound", payload: talking ? SPEECH : SILENCE } }));
        if (++n >= frames) {
          clearInterval(timer);
          if (hangUpAfter) setTimeout(() => ws.readyState === 1 && ws.close(), hangUpAfter);
        }
      }, 20);
    });
    ws.on("message", (raw) => {
      const m = JSON.parse(String(raw));
      if (m.event === "media") got.media++;
      if (m.event === "clear") got.clears++;
      // Twilio echoes a mark once the audio before it has played.
      if (m.event === "mark") setTimeout(() => ws.readyState === 1 && ws.send(JSON.stringify({ event: "mark", streamSid: "MZtest", mark: { name: m.mark?.name } })), markDelay);
    });
    ws.on("close", () => {
      clearInterval(timer);
      got.closed = true;
      resolve(got);
    });
    ws.on("error", (e) => reject(e));
    setTimeout(() => {
      if (!got.closed) {
        ws.close();
      }
    }, 20_000);
  });
}
