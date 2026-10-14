// JobFlex's AI desk — the voice server. One small always-on process (Fly.io):
//   GET  /health                 → {ok:true}
//   WS   /twilio/stream          Twilio's media stream for one call (call.mjs)
//
// Env: OPENAI_API_KEY, VOICE_SERVER_SECRET (shared with the app), APP_URL
// (https://www.jobflex.app), PORT (8080), VOICE_MODEL (gpt-realtime-mini),
// REALTIME_API (ga | beta), OPENAI_REALTIME_URL (the test harness points it at a fake).
import http from "node:http";
import { createHmac } from "node:crypto";
import { WebSocketServer } from "ws";
import { Call, sessionUpdate } from "./call.mjs";

const PORT = Number(process.env.PORT) || 8080;
const APP_URL = (process.env.APP_URL || "").replace(/\/$/, "");
const SECRET = process.env.VOICE_SERVER_SECRET || "";
const MODEL = process.env.VOICE_MODEL || "gpt-realtime-mini";
const API = process.env.REALTIME_API === "beta" ? "beta" : "ga";
const REALTIME_URL = process.env.OPENAI_REALTIME_URL || `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(MODEL)}`;

const log = (line) => console.log(`${new Date().toISOString()} ${line}`);

if (!APP_URL || !SECRET) {
  log("APP_URL and VOICE_SERVER_SECRET are required");
  process.exit(1);
}

/** JobFlex's internal API: one POST, the shared secret in a header, JSON back. */
export const app = {
  async post(path, body) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 15_000);
    try {
      const r = await fetch(`${APP_URL}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-desk-secret": SECRET }, body: JSON.stringify(body), signal: ctl.signal });
      const text = await r.text();
      let json = {};
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        json = { ok: false, error: `bad reply ${r.status}` };
      }
      if (!r.ok && json.ok !== false) json = { ok: false, error: `${r.status} ${json.error ?? ""}`.trim() };
      return json;
    } finally {
      clearTimeout(t);
    }
  },
};

/** The realtime socket for a call, with its session set up before any audio flows. */
export function openOpenAI(brief) {
  return new Promise((resolve, reject) => {
    const headers = { Authorization: `Bearer ${process.env.OPENAI_API_KEY || ""}` };
    if (API === "beta") headers["OpenAI-Beta"] = "realtime=v1";
    let ws;
    try {
      ws = new WebSocket(REALTIME_URL, { headers });
    } catch (e) {
      reject(e);
      return;
    }
    const t = setTimeout(() => {
      try {
        ws.close();
      } catch {
        /* */
      }
      reject(new Error("realtime did not open in 8 s"));
    }, 8000);
    ws.addEventListener("open", () => {
      clearTimeout(t);
      ws.send(JSON.stringify(sessionUpdate(brief, API)));
      resolve(ws);
    });
    ws.addEventListener("error", (e) => {
      clearTimeout(t);
      reject(new Error(e?.message || "realtime socket error"));
    });
  });
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url?.startsWith("/health")) {
    const body = { ok: true, model: MODEL, api: API };
    // The app proves the shared secret matches without either side sending it: an HMAC of its challenge.
    const challenge = new URL(req.url, "http://x").searchParams.get("challenge");
    if (challenge && /^[a-f0-9]{8,64}$/.test(challenge)) body.proof = createHmac("sha256", SECRET).update(challenge).digest("hex");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  if (!req.url?.startsWith("/twilio/stream")) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    new Call({ twilio: ws, openAI: openOpenAI, app, log });
  });
});

server.listen(PORT, () => log(`voice server on :${PORT} → ${APP_URL} · model ${MODEL} (${API})`));
