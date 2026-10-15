// THE DESK'S NUMBER, FORWARDED (2026-10-14: the owner set "forwards every call" and his cell kept ringing — *72 is
// Verizon's code only): the carrier codes with the desk's number in them, both kinds, and the test call's listening.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json scripts/qa/ai-desk-forwarding.check.ts
import { forwardingCodes } from "../../src/lib/aiDesk/shared";
import { testSession, TEST_TURN } from "../../src/lib/aiDesk/testCall";

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

if (bad) {
  console.log(`\n${bad} FAILED`);
  process.exit(1);
}
console.log("\nall passed");
