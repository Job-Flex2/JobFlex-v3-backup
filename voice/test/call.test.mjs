// The voice server, end to end against the fakes: Twilio's stream in, the fake realtime
// API's scripted call, the tools hitting the fake app, the wrap-up.
//   cd voice && node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { WebSocket as WS, WebSocketServer } from "ws";
import { Call, sessionUpdate, TOOLS } from "../call.mjs";
import { fakeApp, fakeRealtime, twilioClient } from "./fakes.mjs";

function serve({ app, realtime, api = "ga" }) {
  const wss = new WebSocketServer({ port: 0 });
  const openAI = (brief) =>
    new Promise((resolve, reject) => {
      const ws = new WS(`ws://127.0.0.1:${realtime.port}`);
      ws.on("open", () => {
        ws.send(JSON.stringify(sessionUpdate(brief, api)));
        // node's ws → the EventTarget shape call.mjs uses
        resolve({ send: (d) => ws.send(d), close: () => ws.close(), get readyState() { return ws.readyState; }, addEventListener: (ev, fn) => ws.on(ev, (a) => fn(ev === "message" ? { data: a } : a)) });
      });
      ws.on("error", reject);
    });
  const appApi = {
    async post(path, body) {
      const r = await fetch(`http://127.0.0.1:${app.port}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-desk-secret": "test-secret" }, body: JSON.stringify(body) });
      return r.json();
    },
  };
  wss.on("connection", (ws) => new Call({ twilio: ws, openAI, app: appApi, log: () => {} }));
  return { url: `ws://127.0.0.1:${wss.address().port}/twilio/stream`, close: () => wss.close() };
}

test("a booked call: greeting, open times, the booking, goodbye, the wrap-up", async () => {
  const app = fakeApp();
  const realtime = fakeRealtime({ scenario: "book" });
  const srv = serve({ app, realtime });
  try {
    const got = await twilioClient({ url: srv.url, token: "tok-1", WS });
    assert.ok(got.closed, "the server closed the stream when the desk ended the call");
    assert.ok(got.media >= 6, `audio reached Twilio (${got.media} frames)`);
    assert.ok(got.clears >= 1, "the caller's speech cleared the desk's queued audio");
    const paths = app.log.map((x) => x.path);
    assert.deepEqual(paths, ["/api/desk/call-brief", "/api/desk/open-times", "/api/desk/book", "/api/desk/call-end"]);
    const end = app.log[app.log.length - 1].body;
    assert.equal(end.outcome, "done");
    assert.equal(end.booked.appointmentId, "appt1");
    assert.ok(end.transcript.some((l) => l.role === "caller" && /roof/.test(l.text)) && end.transcript.some((l) => l.role === "desk" && /booked/.test(l.text)), JSON.stringify(end.transcript));
    assert.equal(app.log[2].body.timeId, "t1");
    assert.equal(app.log[2].body.name, "Sam Rivera");
    const session = realtime.seen.sessions[0];
    assert.equal(session.type, "realtime");
    assert.equal(session.audio.input.format.type, "audio/pcmu");
    assert.equal(session.audio.output.voice, "marin");
    assert.deepEqual(session.tools.map((t) => t.name), TOOLS.map((t) => t.name));
  } finally {
    srv.close();
    app.close();
    realtime.close();
  }
});

test("a transfer: the desk says so, the stream closes, the app hears 'transfer'", async () => {
  const app = fakeApp();
  const realtime = fakeRealtime({ scenario: "transfer" });
  const srv = serve({ app, realtime });
  try {
    const got = await twilioClient({ url: srv.url, token: "tok-2", WS });
    assert.ok(got.closed);
    const end = app.log.find((x) => x.path === "/api/desk/call-end").body;
    assert.equal(end.outcome, "transfer");
    assert.ok(!app.log.some((x) => x.path === "/api/desk/book"));
  } finally {
    srv.close();
    app.close();
    realtime.close();
  }
});

test("a message taken counts as done, and lands in the app", async () => {
  const app = fakeApp();
  const realtime = fakeRealtime({ scenario: "message" });
  const srv = serve({ app, realtime });
  try {
    await twilioClient({ url: srv.url, token: "tok-3", WS });
    const msg = app.log.find((x) => x.path === "/api/desk/message");
    assert.equal(msg.body.name, "Dana Lee");
    const end = app.log.find((x) => x.path === "/api/desk/call-end").body;
    assert.equal(end.outcome, "done");
    assert.equal(end.messageTaken, true);
  } finally {
    srv.close();
    app.close();
    realtime.close();
  }
});

test("a refused token: the stream closes before the desk speaks and the app's TwiML takes over", async () => {
  const app = fakeApp();
  const realtime = fakeRealtime({ scenario: "book" });
  const srv = serve({ app, realtime });
  try {
    const got = await twilioClient({ url: srv.url, token: "bad", WS, frames: 10 });
    assert.ok(got.closed);
    assert.equal(got.media, 0);
    assert.deepEqual(app.log.map((x) => x.path), ["/api/desk/call-brief"]);
    assert.equal(realtime.seen.sessions.length, 0, "no realtime session was opened");
  } finally {
    srv.close();
    app.close();
    realtime.close();
  }
});

test("a key OpenAI refuses: the call fails with the reason for the app, before the desk speaks", async () => {
  const app = fakeApp();
  const realtime = fakeRealtime({ scenario: "badkey" });
  const srv = serve({ app, realtime });
  try {
    const got = await twilioClient({ url: srv.url, token: "good", WS, frames: 10 });
    assert.ok(got.closed);
    assert.equal(got.media, 0, "no audio reached the caller");
    const end = app.log.find((x) => x.path === "/api/desk/call-end")?.body;
    assert.equal(end?.outcome, "failed");
    assert.match(end?.error ?? "", /Incorrect API key/);
  } finally {
    srv.close();
    app.close();
    realtime.close();
  }
});

test("the beta session shape, for an account still on it", () => {
  const s = sessionUpdate({ instructions: "x", voice: "cedar" }, "beta").session;
  assert.equal(s.input_audio_format, "g711_ulaw");
  assert.equal(s.voice, "cedar");
  assert.equal(s.tools.length, 5);
});
