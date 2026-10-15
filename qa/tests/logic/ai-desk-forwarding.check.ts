// THE DESK'S NUMBER, FORWARDED (2026-10-14: the owner set "forwards every call" and his cell kept ringing — *72 is
// Verizon's code only): the carrier codes with the desk's number in them, both kinds, and the test call's listening.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/ai-desk-forwarding.check.ts
import { forwardingCodes } from "../../../src/lib/aiDesk/shared";
import { testSession, TEST_TURN } from "../../../src/lib/aiDesk/testCall";
import { forwardCheckView, isForwardedCustomerCall, isForwardTestCall, samePhone, statusAfterCall, testAnsweredTwiml, testArrivedTwiml, type ForwardCheck } from "../../../src/lib/aiDesk/forwardCheck";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

const all = forwardingCodes("(866) 897-5760", "all");
check("every call: Verizon *72, AT&T and T-Mobile **21*…#", JSON.stringify(all) === JSON.stringify([{ carrier: "Verizon", on: "*728668975760", off: "*73" }, { carrier: "AT&T · T-Mobile", on: "**21*8668975760#", off: "##21#" }]), JSON.stringify(all));
const missed = forwardingCodes("+18668975760", "missed");
check("missed calls: Verizon *71, AT&T and T-Mobile **004*…#", missed[0].on === "*718668975760" && missed[1].on === "**004*8668975760#" && missed[1].off === "##004#");
check("a leading 1 or +1 is dropped; a short number gives no codes", forwardingCodes("1 866 897 5760", "all")[0].on === "*728668975760" && forwardingCodes("12345", "all").length === 0);

const ga = testSession({ instructions: "x", voice: "marin", model: "gpt-realtime-mini", api: "ga" }) as { audio: { input: Record<string, unknown> } };
check("the browser test listens like the phone desk: strict, patient, noise reduced", JSON.stringify(ga.audio.input.turn_detection) === JSON.stringify(TEST_TURN) && TEST_TURN.threshold === 0.7 && TEST_TURN.silence_duration_ms === 800 && (ga.audio.input.noise_reduction as { type: string }).type === "far_field");
const beta = testSession({ instructions: "x", voice: "marin", model: "m", api: "beta" }) as Record<string, unknown>;
check("…in the beta shape too", (beta.turn_detection as { threshold: number }).threshold === 0.7 && (beta.input_audio_noise_reduction as { type: string }).type === "far_field");

// ── is it really forwarding? ──
const T0 = Date.UTC(2026, 9, 14, 23, 0, 0);
const test: ForwardCheck = { id: "t1", status: "calling", how: "test", kind: "all", phone: "+14257726587", desk: "+18668975760", startedAt: T0, at: T0 };
check("same phone, any format", samePhone("(425) 772-6587", "+14257726587") && !samePhone("", "") && !samePhone("anonymous", "+14257726587"));
check("the test coming back with our caller ID is recognised", isForwardTestCall(test, { from: "+18668975760", to: "+18668975760", at: T0 + 4000 }));
check("…with the business phone as caller ID, or marked forwarded from it", isForwardTestCall(test, { from: "+14257726587", to: "+18668975760", at: T0 + 4000 }) && isForwardTestCall(test, { from: "+12065550100", to: "+18668975760", forwardedFrom: "+14257726587", at: T0 + 4000 }));
check("a customer calling during the test is not the test", !isForwardTestCall(test, { from: "+12065550100", to: "+18668975760", at: T0 + 4000 }));
check("too late, finished, or to another number: not the test", !isForwardTestCall(test, { from: "+18668975760", to: "+18668975760", at: T0 + 200_000 }) && !isForwardTestCall({ ...test, status: "works" }, { from: "+18668975760", to: "+18668975760", at: T0 + 4000 }) && !isForwardTestCall(test, { from: "+18668975760", to: "+18005550000", at: T0 + 4000 }));
check("a real call forwarded from the business phone confirms it", isForwardedCustomerCall({ to: "+18668975760", forwardedFrom: "4257726587" }, "+14257726587", "+18668975760") && !isForwardedCustomerCall({ to: "+18668975760", forwardedFrom: null }, "+14257726587", "+18668975760"));
const now = { forwarding: "all" as const, phone: "+14257726587", desk: "+18668975760", at: T0 + 5000 };
check("the check counts for its own forwarding, phone and number only", forwardCheckView(test, now)?.id === "t1" && forwardCheckView(test, { ...now, forwarding: "missed" }) === null && forwardCheckView(test, { ...now, phone: "+12065550100" }) === null && forwardCheckView(test, { ...now, forwarding: "none" }) === null);
check("a test that never came back reads as no answer", forwardCheckView(test, { ...now, at: T0 + 200_000 })?.status === "noanswer");
check("Twilio's endings: no-answer/busy → noanswer, failed → failed, completed → nothing", statusAfterCall("no-answer") === "noanswer" && statusAfterCall("busy") === "noanswer" && statusAfterCall("failed") === "failed" && statusAfterCall("completed") === null);
check("what the test says: back at the desk it works; at the phone it isn't on yet", /Forwarding works/.test(testArrivedTwiml()) && /Forwarding works/.test(testAnsweredTwiml(true, "all")) && /not forwarding calls to your AI desk yet/.test(testAnsweredTwiml(false, "all")) && /let the test call ring without answering/.test(testAnsweredTwiml(false, "missed")) && /<Hangup\/>/.test(testAnsweredTwiml(false, "all")));

if (bad) {
  console.log(`\n${bad} FAILED`);
  process.exit(1);
}
console.log("\nall passed");
