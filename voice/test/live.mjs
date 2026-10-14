// THE REHEARSAL — the real OpenAI realtime API, the real voice server, a scripted caller.
//
//   cd voice && OPENAI_API_KEY=sk-… node test/live.mjs
//
// No Twilio and no JobFlex: a fake app answers the server's internal API (test/fakes.mjs —
// a sample company, open times, a booking), and this script plays Twilio's side of the
// media stream: it listens for the desk's μ-law audio and, each time the desk goes quiet,
// says the caller's next line (spoken by OpenAI's speech model, resampled to a phone line).
// What it proves: the GA session shape is accepted, audio flows both ways, the caller is
// heard, the tools fire, the desk hangs up after its goodbye. The desk's voice is kept at
// test/out/desk-<time>.wav so you can listen.
//
// Costs a few cents (one or two minutes on the mini model, a few seconds of speech).
//   VOICE_MODEL / REALTIME_API are honoured as on the server; LIVE_INSTRUCTIONS_FILE points
//   at a file with a company's real instructions instead of the sample ones.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fakeApp } from "./fakes.mjs";
import { mulawDecode, rms, SILENCE_FRAME, wavToFrames, writeWav } from "./audio.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const KEY = process.env.OPENAI_API_KEY || "";
if (!KEY) {
  console.error("OPENAI_API_KEY is needed — run this from your own terminal, never paste the key anywhere else.");
  process.exit(2);
}
const MODEL = process.env.VOICE_MODEL || "gpt-realtime-mini";
const PORT = 8097;
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const INSTRUCTIONS = process.env.LIVE_INSTRUCTIONS_FILE
  ? readFileSync(process.env.LIVE_INSTRUCTIONS_FILE, "utf8")
  : [
      "You are the phone assistant for Ridgeline Roofing, a roofing and gutter company on Seattle's Eastside. Speak naturally and briefly, like a good receptionist. Every call is recorded.",
      "GREETING: Thanks for calling Ridgeline Roofing. This is the company's virtual assistant, and this call is recorded. How can I help?",
      "SERVICES: roof repair, roof replacement, gutters. Free estimates; a leak diagnosis is $149. Hours Mon–Fri 7 AM–5 PM. Licensed and insured, 10-year workmanship warranty.",
      "BOOKING: when a caller wants a visit, call open_times, offer two of the times it returns, then ask for their name and phone number, then call book_visit with the time's id. Confirm the time back to them.",
      "NEVER quote a price for a job sight unseen, never promise a specific crew. Say goodbye and call end_call once the caller is done.",
    ].join("\n");

const CALLER_LINES = [
  "Hi there. I'd like someone to come take a look at my roof this week — it's been leaking a little when it rains.",
  "The first one works for me. My name is Sam Rivera, and my phone number is two zero six, five five five, zero one two three.",
  "That's everything, thank you. Goodbye.",
];

/** The caller's lines, spoken by OpenAI's speech model, as Twilio frames. */
async function speak(text) {
  const r = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o-mini-tts", voice: "ash", input: text, response_format: "wav", instructions: "A homeowner on the phone, relaxed, natural pace." }),
  });
  if (!r.ok) throw new Error(`speech ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return wavToFrames(Buffer.from(await r.arrayBuffer()));
}

(async () => {
  console.log(`model ${MODEL} · api ${process.env.REALTIME_API === "beta" ? "beta" : "ga"}`);
  const app = fakeApp({ port: 0 });
  await wait(100);
  // The sample brief: the fake app's own is one line; ours carries the company.
  app.srv.removeAllListeners("request");
  app.srv.on("request", (req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const json = body ? JSON.parse(body) : {};
      app.log.push({ path: req.url, body: json });
      const reply = (o) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(o));
      };
      switch (req.url) {
        case "/api/desk/call-brief":
          return reply({ ok: true, instructions: INSTRUCTIONS, voice: process.env.LIVE_VOICE || "marin", maxSeconds: 150, callSid: "CAlive" });
        case "/api/desk/open-times":
          return reply({ ok: true, times: [{ id: "estimate|2026-10-15T15:00:00.000Z", label: "Thursday, October 15 · 8:00 AM", startsAt: "2026-10-15T15:00:00.000Z" }, { id: "estimate|2026-10-15T17:00:00.000Z", label: "Thursday, October 15 · 10:00 AM", startsAt: "2026-10-15T17:00:00.000Z" }], note: "Roof inspection and estimate — free, a 2-hour arrival window." });
        case "/api/desk/book":
          return reply({ ok: true, appointmentId: "appt-live", when: "Thursday, October 15 · 8:00 AM", serviceLabel: "Roof inspection and estimate" });
        case "/api/desk/message":
          return reply({ ok: true });
        case "/api/desk/call-end":
          return reply({ ok: true });
        default:
          return reply({ ok: false, error: "no such route" });
      }
    });
  });

  console.log("speaking the caller's lines…");
  const lines = [];
  for (const l of CALLER_LINES) lines.push(await speak(l));
  check("the caller's lines were spoken by the speech model and fit a phone line", lines.every((f) => f.length > 20), lines.map((f) => `${(f.length * 20) / 1000}s`).join(", "));

  const server = spawn("node", ["server.mjs"], { cwd: path.join(here, ".."), env: { ...process.env, PORT: String(PORT), APP_URL: `http://127.0.0.1:${app.port}`, VOICE_SERVER_SECRET: "test-secret", OPENAI_API_KEY: KEY, VOICE_MODEL: MODEL }, stdio: ["ignore", "pipe", "pipe"] });
  let serverLog = "";
  server.stdout.on("data", (d) => (serverLog += d));
  server.stderr.on("data", (d) => (serverLog += d));
  await wait(700);
  const health = await fetch(`http://127.0.0.1:${PORT}/health`).then((r) => r.json()).catch(() => null);
  check("the voice server is up", !!health?.ok, JSON.stringify(health));

  // ── Twilio's side of the stream
  const { WebSocket: WS } = await import("ws");
  const ws = new WS(`ws://127.0.0.1:${PORT}/twilio/stream`);
  const got = { media: 0, clears: 0, marks: [], closed: false, bytes: [] };
  const startedAt = Date.now();
  let lastDeskAudioAt = 0;
  let deskFramesThisTurn = 0;
  let closedAt = 0;
  ws.on("message", (raw) => {
    const m = JSON.parse(String(raw));
    if (m.event === "media" && m.media?.payload) {
      got.media++;
      deskFramesThisTurn++;
      lastDeskAudioAt = Date.now();
      got.bytes.push(Buffer.from(m.media.payload, "base64"));
    } else if (m.event === "clear") got.clears++;
    else if (m.event === "mark") {
      got.marks.push(m.mark?.name);
      // Twilio echoes a mark once the audio before it has played — here, at once.
      setTimeout(() => ws.readyState === 1 && ws.send(JSON.stringify({ event: "mark", streamSid: "MZlive", mark: { name: m.mark?.name } })), 300);
    }
  });
  ws.on("close", () => {
    got.closed = true;
    closedAt = Date.now();
  });
  await new Promise((resolve, reject) => {
    ws.on("open", resolve);
    ws.on("error", reject);
  });
  ws.send(JSON.stringify({ event: "connected", protocol: "Call", version: "1.0.0" }));
  ws.send(JSON.stringify({ event: "start", sequenceNumber: "1", start: { streamSid: "MZlive", callSid: "CAlive", tracks: ["inbound"], customParameters: { token: "live-token" }, mediaFormat: { encoding: "audio/x-mulaw", sampleRate: 8000, channels: 1 } }, streamSid: "MZlive" }));

  // The caller's audio, 20 ms a frame: silence until it is the caller's turn, then a line.
  let queue = [];
  let lineIdx = 0;
  let turnOpen = false; // the desk has spoken since the caller last did
  let spokeAt = 0;
  const said = [];
  const tick = setInterval(() => {
    if (ws.readyState !== 1) return;
    const payload = queue.length ? queue.shift() : SILENCE_FRAME;
    ws.send(JSON.stringify({ event: "media", media: { track: "inbound", payload } }));
  }, 20);
  const turn = setInterval(() => {
    if (ws.readyState !== 1 || queue.length) return;
    const now = Date.now();
    if (deskFramesThisTurn > 25 && now - lastDeskAudioAt > 1100) turnOpen = true; // the desk spoke, then went quiet
    if (turnOpen && lineIdx < lines.length && now - spokeAt > 1500) {
      queue = lines[lineIdx].slice();
      said.push({ at: now - startedAt, line: CALLER_LINES[lineIdx] });
      lineIdx++;
      turnOpen = false;
      deskFramesThisTurn = 0;
      spokeAt = now + queue.length * 20;
    }
  }, 100);

  const deadline = Date.now() + 150_000;
  while (!got.closed && Date.now() < deadline) await wait(200);
  clearInterval(tick);
  clearInterval(turn);
  if (!got.closed) {
    ws.send(JSON.stringify({ event: "stop", stop: { callSid: "CAlive" }, streamSid: "MZlive" }));
    await wait(1500);
    try {
      ws.close();
    } catch {
      /* */
    }
  }
  await wait(500);
  server.kill();
  app.close();

  // ── what happened
  const end = app.log.find((l) => l.path === "/api/desk/call-end")?.body ?? null;
  const transcript = end?.transcript ?? [];
  const tools = app.log.map((l) => l.path).filter((p) => p !== "/api/desk/call-brief" && p !== "/api/desk/call-end");
  const pcm = mulawDecode(Buffer.concat(got.bytes));
  mkdirSync(path.join(here, "out"), { recursive: true });
  const outFile = path.join(here, "out", `desk-${new Date().toISOString().replace(/[:.]/g, "-")}.wav`);
  writeFileSync(outFile, writeWav(pcm, 8000));

  check("the realtime session opened and the desk spoke first (audio came back before the caller said a word)", got.media > 25 && (said[0]?.at ?? 0) > 500 && transcript[0]?.role === "desk", `${got.media} frames, first line at ${said[0]?.at ?? "-"} ms`);
  check("…the greeting named the company and said it is a recorded virtual assistant", /virtual assistant/i.test(transcript[0]?.text ?? "") && /recorded/i.test(transcript[0]?.text ?? ""), transcript[0]?.text ?? "-");
  check("the desk's audio is real speech, not silence", rms(pcm) > 0.01, `rms ${rms(pcm).toFixed(3)} · ${(pcm.length / 8000).toFixed(1)} s → ${path.relative(process.cwd(), outFile)}`);
  check("the caller was heard: the roof and the leak reached the transcript", transcript.some((l) => l.role === "caller" && /roof/i.test(l.text)), transcript.filter((l) => l.role === "caller").map((l) => l.text).join(" | ").slice(0, 200));
  check("the desk looked up open times, then booked the visit for Sam Rivera", tools.includes("/api/desk/open-times") && tools.includes("/api/desk/book") && /rivera/i.test(JSON.stringify(app.log.find((l) => l.path === "/api/desk/book")?.body ?? {})), tools.join(" → "));
  check("…and said the time back to the caller", transcript.some((l) => l.role === "desk" && /thursday|8:00|eight/i.test(l.text)), transcript.filter((l) => l.role === "desk").map((l) => l.text).join(" | ").slice(0, 300));
  check("the desk said goodbye and ended the call; the stream closed after it", end?.outcome === "done" && got.closed && !!end?.booked, `outcome ${end?.outcome ?? "-"} · closed after ${closedAt ? Math.round((closedAt - startedAt) / 1000) : "-"} s · why ${end?.why ?? "-"}`);
  check("the server logged no realtime errors", !/openai error/.test(serverLog), serverLog.split("\n").filter((l) => /openai error|failed/.test(l)).join(" | ").slice(0, 300));
  console.log("\n— the call —");
  for (const l of transcript) console.log(`${l.role === "desk" ? "Desk  " : "Caller"}: ${l.text}`);
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed · the desk's voice: ${outFile}`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})().catch((e) => {
  console.error("REHEARSAL CRASH", e.stack || e.message);
  process.exit(2);
});
