// The AI desk, step 4 — pure checks, no network, no database (2026-10-13).
//   npx tsx --tsconfig tsconfig.json scripts/qa/ai-desk-step4.check.ts
// The browser test's events and session, the month's minutes, the outcome words on the
// Phone page, its desk line, and that the browser's tool list is the voice server's.
import { pathToFileURL } from "url";
import path from "path";
import { clock, DESK_OUTCOME_LABEL, deskOutcomeWord, minutesOf, monthKey, parseDeskUse, prettyPhone, VOICE_WORDS, VOICES } from "../../src/lib/aiDesk/shared";
import { DESK_TOOLS, GREET_FIRST, readRealtimeEvent, realtimeCallsUrl, TEST_NOTE, testSession, timeIdWords, toolOutputEvents } from "../../src/lib/aiDesk/testCall";
import { deskStripWords, type PhoneDeskStrip } from "../../src/components/v3/phone-blueprint/phone-data";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

(async () => {
  // ── the tools: one list, in two places
  const voiceServer = (await import(pathToFileURL(path.resolve("voice/call.mjs")).href)) as { TOOLS: unknown };
  check("the browser test's tools are the voice server's, word for word", JSON.stringify(voiceServer.TOOLS) === JSON.stringify(DESK_TOOLS));

  // ── the events on the data channel
  check("the desk's words", JSON.stringify(readRealtimeEvent(JSON.stringify({ type: "response.output_audio_transcript.done", transcript: " Thanks for calling. " }))) === JSON.stringify({ kind: "desk", text: "Thanks for calling." }));
  check("…and the beta name for them", readRealtimeEvent({ type: "response.audio_transcript.done", transcript: "Hi" })?.kind === "desk");
  check("the caller's words", JSON.stringify(readRealtimeEvent({ type: "conversation.item.input_audio_transcription.completed", transcript: "Can someone come today?" })) === JSON.stringify({ kind: "caller", text: "Can someone come today?" }));
  const tool = readRealtimeEvent({ type: "response.function_call_arguments.done", name: "book_visit", call_id: "c1", arguments: '{"time_id":"estimate|2026-10-15T17:00:00.000Z","name":"Sam"}' });
  check("a tool call with its arguments parsed", tool?.kind === "tool" && tool.name === "book_visit" && tool.callId === "c1" && tool.args.name === "Sam");
  const badArgs = readRealtimeEvent({ type: "response.function_call_arguments.done", name: "end_call", call_id: "c2", arguments: "{not json" });
  check("…unreadable arguments become none, not a crash", badArgs?.kind === "tool" && Object.keys(badArgs.args).length === 0);
  check("the end of a turn, the caller talking over, an error", readRealtimeEvent({ type: "response.done" })?.kind === "turn-done" && readRealtimeEvent({ type: "input_audio_buffer.speech_started" })?.kind === "caller-speaking" && (readRealtimeEvent({ type: "error", error: { message: "nope" } }) as { message?: string })?.message === "nope");
  check("audio deltas and unknown events are nothing to the panel; so is a non-JSON frame", readRealtimeEvent({ type: "response.output_audio.delta", delta: "AAAA" }) === null && readRealtimeEvent("{{") === null && readRealtimeEvent(42) === null);
  const outs = toolOutputEvents("c1", { booked: true });
  check("a tool's output goes back as a function_call_output, then the model's next turn", outs.length === 2 && (outs[0].item as { call_id: string; output: string }).call_id === "c1" && (outs[0].item as { output: string }).output === '{"booked":true}' && outs[1].type === "response.create");
  check("the desk speaks first, with the written greeting word for word", GREET_FIRST.type === "response.create" && /GREETING exactly as written/.test(GREET_FIRST.response.instructions) && /recorded/.test(GREET_FIRST.response.instructions));

  // ── the session the key is minted for
  const ga = testSession({ instructions: "I", voice: "cedar", model: "gpt-realtime-mini", api: "ga" }) as { type: string; model: string; audio: { output: { voice: string }; input: { transcription: unknown; turn_detection: unknown } }; tools: unknown[]; output_modalities: string[] };
  check("GA: a realtime session with the voice, the caller's words transcribed, server turn-taking, the five tools", ga.type === "realtime" && ga.model === "gpt-realtime-mini" && ga.audio.output.voice === "cedar" && !!ga.audio.input.transcription && !!ga.audio.input.turn_detection && ga.tools.length === 5 && ga.output_modalities[0] === "audio");
  const beta = testSession({ instructions: "I", voice: "marin", model: "m", api: "beta" }) as { modalities: string[]; voice: string; input_audio_transcription: unknown; tools: unknown[] };
  check("beta: the older shape", beta.modalities.length === 2 && beta.voice === "marin" && !!beta.input_audio_transcription && beta.tools.length === 5);
  check("the browser posts its offer to OpenAI's public endpoint, never a proxy", realtimeCallsUrl("ga", "x") === "https://api.openai.com/v1/realtime/calls" && realtimeCallsUrl("beta", "gpt-realtime-mini") === "https://api.openai.com/v1/realtime?model=gpt-realtime-mini");
  check("the test note: a test, nothing saved, no phone rings, no caller ID", /TEST/.test(TEST_NOTE) && /nothing is saved/.test(TEST_NOTE) && /no phone rings/.test(TEST_NOTE) && /no caller ID/i.test(TEST_NOTE));
  const when = timeIdWords("estimate|2026-10-15T17:00:00.000Z", "America/Los_Angeles");
  check("a chosen time in words, in the company's zone", when === "Thursday, October 15 at 10:00 AM", when ?? "null");
  check("…and a bad id is none", timeIdWords("nope", "America/Los_Angeles") === null && timeIdWords("estimate|yesterday", "America/Los_Angeles") === null);

  // ── the month's minutes
  check("the month turns in UTC", monthKey(new Date("2026-10-31T23:30:00Z")) === "2026-10" && monthKey(new Date("2026-11-01T00:00:00Z")) === "2026-11");
  const use = parseDeskUse('{"callSeconds":217,"calls":3,"testSeconds":"x","tests":-2}');
  check("the stored row, read tolerantly", use.callSeconds === 217 && use.calls === 3 && use.testSeconds === 0 && use.tests === 0 && parseDeskUse("{{").calls === 0 && parseDeskUse(null).callSeconds === 0);
  check("seconds as minutes: none, under a minute is one, otherwise the nearest", minutesOf(0) === 0 && minutesOf(30) === 1 && minutesOf(217) === 4 && minutesOf(150) === 3);
  check("seconds as a clock", clock(65) === "1:05" && clock(0) === "0:00" && clock(599) === "9:59");

  // ── how a call went, in words
  check("booked beats everything; then a message; then a transfer", deskOutcomeWord({ outcome: "done", appointmentId: "a1", messageTaken: true }) === "booked" && deskOutcomeWord({ outcome: "transfer", appointmentId: null, messageTaken: true }) === "message" && deskOutcomeWord({ outcome: "transfer", appointmentId: null, messageTaken: false }) === "transfer");
  check("a call the desk only talked on is answered; one it could not take says so", deskOutcomeWord({ outcome: "done", appointmentId: null, messageTaken: false }) === "answered" && deskOutcomeWord({ outcome: "voicemail", appointmentId: null, messageTaken: false }) === "answered" && deskOutcomeWord({ outcome: "failed", appointmentId: null, messageTaken: false }) === "failed");
  check("…each with its label", DESK_OUTCOME_LABEL.booked === "booked a visit" && DESK_OUTCOME_LABEL.message === "took a message" && DESK_OUTCOME_LABEL.transfer === "handed to you");

  // ── the voices
  check("every voice has its words; marin is the one recommended", VOICES.every((v) => VOICE_WORDS[v].length > 3) && /recommend/.test(VOICE_WORDS.marin));
  check("a number for the page", prettyPhone("+18665550199") === "(866) 555-0199" && prettyPhone("+447700900123") === "+447700900123");

  // ── the Phone page's desk line
  const strip: PhoneDeskStrip = { number: "(866) 555-0199", on: true, go: "assistant", mode: "ANSWER", companyPhone: "(425) 555-0100", voice: "marin", minutes: 4, calls: 3, tests: 0, live: true, left: "146 min left", out: false, low: false };
  check("the desk answers every call, in its voice", deskStripWords(strip) === "(866) 555-0199 — the desk answers every call, in the marin voice.", deskStripWords(strip));
  check("…without the voice server: callers are asked to leave a message", /not connected yet — callers are asked to leave a message/.test(deskStripWords({ ...strip, live: false })));
  check("ring my phone first", deskStripWords({ ...strip, go: "phone", mode: "FORWARD" }) === "(866) 555-0199 rings (425) 555-0100 first; the desk takes what nobody picks up.");
  check("no number yet; a number not yet wired for calls", /No number yet/.test(deskStripWords({ ...strip, number: null })) && /not taking calls yet/.test(deskStripWords({ ...strip, on: false })));

  console.log(bad ? `\n${bad} FAILED` : "\nall passed");
  process.exit(bad ? 1 : 0);
})();
