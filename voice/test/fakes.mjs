// Stand-ins for the tests and the stand walk: OpenAI's realtime API, JobFlex's internal
// API, and Twilio's media-stream client. No network beyond localhost.
import http from "node:http";
import { WebSocketServer } from "ws";

const SILENCE = Buffer.alloc(160, 0xff).toString("base64"); // 20 ms of μ-law silence

/**
 * A fake realtime server. Scenario (FAKE_SCENARIO or the option): "book" — greeting,
 * then open_times → book_visit → end_call; "transfer" — greeting then transfer_call;
 * "message" — greeting, take_message, end_call. Records every session.update.
 */
export function fakeRealtime({ port = 0, scenario = process.env.FAKE_SCENARIO || "book" } = {}) {
  const seen = { sessions: [], items: [], responses: 0 };
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
      if (ev.type === "session.update") seen.sessions.push(ev.session);
      if (ev.type === "input_audio_buffer.append") {
        // After the greeting and ~1 s of caller audio, the caller "speaks".
        session.audio = (session.audio || 0) + 1;
        if (session.audio === 50 && session.steps === 1) {
          send({ type: "input_audio_buffer.speech_started" });
          send({ type: "conversation.item.input_audio_transcription.completed", transcript: scenario === "transfer" ? "Can I talk to someone there?" : scenario === "message" ? "Please have someone call me back about my gutters." : "Can someone come look at my roof this week?" });
          session.steps = 2;
          if (scenario === "transfer") call("transfer_call", { reason: "caller asked for a person" });
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
        if (out.booked || out.taken) {
          speak(out.booked ? `You're booked for ${out.when}. Anything else?` : "I've passed that on. Anything else?");
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
          return reply({ ok: true, instructions: "You are the phone assistant for Test Roofing.", voice: "marin", maxSeconds: 120, callSid: "CAtest" });
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
export function twilioClient({ url, token, callSid = "CAtest", frames = 120, WS }) {
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
        ws.send(JSON.stringify({ event: "media", media: { track: "inbound", payload: SILENCE } }));
        if (++n >= frames) clearInterval(timer);
      }, 20);
    });
    ws.on("message", (raw) => {
      const m = JSON.parse(String(raw));
      if (m.event === "media") got.media++;
      if (m.event === "clear") got.clears++;
      // Twilio echoes a mark once the audio before it has played.
      if (m.event === "mark") setTimeout(() => ws.readyState === 1 && ws.send(JSON.stringify({ event: "mark", streamSid: "MZtest", mark: { name: m.mark?.name } })), 100);
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
