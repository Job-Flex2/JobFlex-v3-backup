// THE SIGN-UP FORM, WATCHED (2026-10-14): the shared words (boxes, reasons, sides, scrubbing) and the live line's
// story from a visit's events (lib/traffic-live formWatchOf / formSentence) — where they are, which box, every
// problem and whose side, away and back, the leave and its verdict.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/signup/signup-watch.check.ts
import { fieldName, reasonOfMessage, reasonSide, reasonWords, scrubWords } from "../../../src/lib/signup-watch-shared";
import { formSentence, formWatchOf, type LiveEvent } from "../../../src/lib/traffic-live";
import { TRAFFIC_EVENTS as E } from "../../../src/lib/traffic-contract";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

// ── words ──
check("boxes by id; trades and code by pattern; unknown ids are never named", fieldName("email") === "Email" && fieldName("password2") === "Confirm password" && fieldName("biz2") === "Business name" && fieldName("otpCode") === "Code" && fieldName("search") === null && fieldName("") === null);
check("our failures read as ours", ["server_error", "email_send_failed", "check_failed", "rate_limited", "page_error", "slow_form", "network", "offer_changed"].every((r) => reasonSide(r) === "ours"));
check("the form's refusals read as theirs", ["missing", "email_invalid", "wrong", "expired", "email_taken", "biz_missing"].every((r) => reasonSide(r) === "theirs"));
check("an unknown reason is theirs, in plain words", reasonSide("whatever_new") === "theirs" && reasonWords("whatever_new") === "whatever new");
check("the server's words map to reasons", reasonOfMessage("Something went wrong on our side. Try again in a minute.") === "server_error" && reasonOfMessage("Couldn't send the email. Check the address and try again.") === "email_send_failed" && reasonOfMessage("Too many codes from this network. Try again in 4 min.") === "rate_limited" && reasonOfMessage("That email is already registered. Try signing in instead.") === "email_taken" && reasonOfMessage("Your trial offer changed. Reload this page") === "offer_changed" && reasonOfMessage("Hmm") === "refused");
check("words that leave the browser carry no address and no long numbers", scrubWords("We sent it to maria@cascade.vc, ref 12345678") === "We sent it to [email], ref [n]");

// ── a visit, event by event ──
const t0 = Date.UTC(2026, 9, 14, 20, 0, 0);
let seq = 0;
const ev = (event: string, atS: number, p: Partial<LiveEvent> = {}): LiveEvent => ({
  person: "p1", distinctId: "d1", event, at: t0 + atS * 1000 + seq++, pathname: "/auth/register", url: "https://www.jobflex.app/auth/register", sessionId: "s1",
  hostname: "www.jobflex.app", environment: "production", utmSource: "", utmMedium: "", utmCampaign: "", utmContent: "", referrer: "", device: "Mobile", browser: "Safari", os: "iOS",
  country: "", region: "", city: "", placement: "", label: "", orgId: "", userId: "", step: "", outcome: "", plan: "", verified: "", lat: null, lon: null, countryCode: "", regionCode: "", click: "", ua: "Mozilla/5.0", browserType: "", ...p,
});
const typing = [
  ev("$pageview", 0),
  ev(E.step, 1, { step: "1" }),
  ev(E.signupField, 3, { phase: "in", field: "Name", screen: "account" }),
  ev(E.signupField, 9, { phase: "out", field: "Name", ms: "6000", filled: "true", valid: "true", edits: "12", screen: "account" }),
  ev(E.signupField, 10, { phase: "in", field: "Email", screen: "account" }),
];
let f = formWatchOf(typing, t0 + 30_000)!;
check("typing: on the account screen, in the Email box now, Name done", f.screen === "Account" && f.inBox?.field === "Email" && f.boxes.length === 1 && f.boxes[0].field === "Name" && f.boxes[0].secs === 6 && f.boxes[0].edits === 12 && f.verdict === null, JSON.stringify(f));
check("…the sentence says where they are and which box", /^On the account screen for .*, in the Email box since/.test(formSentence(f, true, t0 + 30_000)), formSentence(f, true, t0 + 30_000));

const refused = [...typing,
  ev(E.signupField, 20, { phase: "out", field: "Email", ms: "10000", filled: "true", valid: "true", edits: "18", screen: "account" }),
  ev(E.signupProblem, 21, { reason: "email_taken", side: "theirs", message: "That email is already registered.", screen: "account", field: "" }),
  ev(E.signupLeave, 50, { kind: "closed", screen: "account", field: "", ms: "49000", pageMs: "50000", lastProblem: "email_taken" }),
];
f = formWatchOf(refused, t0 + 60_000)!;
check("refused, then closed: the leave, its screen and the form's verdict", f.left?.kind === "closed" && f.left.screen === "Account" && f.verdict === "theirs" && f.problems[0].words === "Email already has an account", JSON.stringify({ left: f.left, verdict: f.verdict }));
check("…the sentence names the screen, the time and the refusal", /^Left at the account screen after 49 s — right after “Email already has an account”\.$/.test(formSentence(f, false)), formSentence(f, false));

const oursFail = [...typing,
  ev(E.signupProblem, 15, { reason: "email_send_failed", side: "ours", screen: "account" }),
  ev(E.signupProblem, 18, { reason: "wrong", side: "theirs", screen: "code" }),
  ev(E.signupLeave, 40, { kind: "closed", screen: "code", ms: "20000" }),
];
f = formWatchOf(oursFail)!;
check("any failure of ours makes the verdict ours, even with a later refusal", f.verdict === "ours" && /after a failure of ours: the code email didn't send/.test(formSentence(f, false)), formSentence(f, false));

const quiet = [...typing, ev(E.signupLeave, 45, { kind: "closed", screen: "account", field: "Email", ms: "44000" })];
f = formWatchOf(quiet)!;
check("closed with no error shown: their choice, and the box they were in", f.verdict === "choice" && /in the Email box — no error shown: their choice/.test(formSentence(f, false)), formSentence(f, false));

const toGoogle = [...typing, ev(E.signupLeave, 12, { kind: "google", screen: "account" })];
f = formWatchOf(toGoogle)!;
check("off to Google on purpose is not an abandon", f.verdict === null && formSentence(f, true) === "Went to Google to sign up with it.");

const readingEmail = [ev("$pageview", 0), ev(E.step, 1, { step: "code" }), ev(E.signupAway, 30, { screen: "code", ms: "29000" })];
f = formWatchOf(readingEmail, t0 + 150_000)!;
check("away from the code screen: probably reading the email", f.screen === "Email code" && !!f.away && /most likely reading the email for the code/.test(formSentence(f, true, t0 + 150_000)), formSentence(f, true, t0 + 150_000));
const back = [...readingEmail, ev(E.signupBack, 95, { screen: "code", ms: "65000" })];
f = formWatchOf(back, t0 + 100_000)!;
check("…and back after a minute: no longer away, the return counted", !f.away && f.cameBack?.secs === 65 && /Came back after 1 min away/.test(formSentence(f, true, t0 + 100_000)), formSentence(f, true, t0 + 100_000));

const closedTab = [...typing, ev(E.signupAway, 44.5, { screen: "account", field: "Email" }), ev(E.signupLeave, 45, { kind: "closed", screen: "account", field: "Email", ms: "44000" })];
f = formWatchOf(closedTab)!;
check("closing a tab hides it first: that away is the close, not a story", !f.away && !!f.left && f.left.awaySecs === undefined && f.verdict === "choice");
const sameSecond = [...typing, ev(E.signupLeave, 45, { kind: "closed", screen: "account", field: "Email", ms: "44000" }), ev(E.signupAway, 45, { screen: "account", field: "Email" })];
f = formWatchOf(sameSecond)!;
check("…and when the close's away sorts after its leave (whole seconds), still no away", !f.away && f.left?.kind === "closed" && f.verdict === "choice");
const putDown = [...typing, ev(E.signupAway, 30, { screen: "account", field: "Email" }), ev(E.signupLeave, 270, { kind: "closed", screen: "account", field: "Email", ms: "269000" })];
f = formWatchOf(putDown)!;
check("away four minutes, then closed: the leave carries the time away", !f.away && f.left?.awaySecs === 240, JSON.stringify(f.left));

const reloaded = [...quiet, ev("$pageview", 60)];
f = formWatchOf(reloaded)!;
check("a move after the leave (a reload) means they did not leave", f.left === null);
check("a visit that never reached the form has no watch", formWatchOf([ev("$pageview", 0, { pathname: "/" })]) === null);

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
