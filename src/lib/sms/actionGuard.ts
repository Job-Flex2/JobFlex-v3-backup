// EVERY TEXTING ACTION ANSWERS IN WORDS (2026-10-14).
//
// The owner typed his mobile on Settings → Texting and got two different
// nonsense answers: "Phone texts are set up in Settings, which your role
// doesn't open" (startPhoneVerification caught EVERY UnauthorizedError — a
// run-out session included — and blamed the role) and "Minified React error
// #441" (setMemberMobile let its guard's throw reach the browser, where a
// production build hides the message). Neither told him what to do.
//
// `guardSms` wraps each action in actions/sms: a thrown guard error becomes
// `{ ok: false, error }` with the real reason and the way out, and anything
// unexpected is logged on the server and answered plainly. The mapper is
// pure (duck-typed on the error's name, so the QA script can run it without
// next/headers) — keep it that way.

export type SmsActionResult = { ok: true; note?: string } | { ok: false; error: string };

export const SIGN_IN_AGAIN = "Your sign-in has run out. Refresh the page and sign in again — nothing was changed.";
export const OFFICE_ONLY = "Only the office — owner, admin or manager — can change texting. Ask them, or have them add your mobile for you.";
export const NO_COMPANY = "Sign in to a company first.";
/** The browser's side of the same failure: the action's answer never came back as one — the sign-in
 *  redirected it (a run-out session), a deploy landed in between, or the network dropped. In a production
 *  build React words it "Minified React error #441" — the owner's screenshot. */
export const LOST_SESSION = "JobFlex couldn't reach your sign-in. Refresh the page — sign in again if it asks — then try once more. Nothing was changed.";
export const LOST_SESSION_RE = /unexpected response|server components render|minified react error|next_redirect|fetch failed|failed to fetch|load failed|network ?error/i;
export const OUR_SIDE = "Something failed on our side and nothing was changed. Try again in a minute; if it keeps happening, tell us.";

/** The sentence a failed texting action shows, from whatever was thrown. */
export function smsFailureMessage(err: unknown): string {
  const e = err as { name?: string; message?: string; digest?: string } | null;
  const name = e?.name ?? "";
  const msg = (e?.message ?? "").trim();
  if (LOST_SESSION_RE.test(msg) || LOST_SESSION_RE.test(e?.digest ?? "")) return LOST_SESSION;
  if (name === "UnauthorizedError") {
    // orgContext throws the same class for three different things.
    if (/role|manager|owner access/i.test(msg)) return OFFICE_ONLY;
    if (/partner session/i.test(msg)) return "This is a partner sign-in — texting lives on a contractor account.";
    return SIGN_IN_AGAIN;
  }
  if (name === "NoOrgError") return NO_COMPANY;
  if (name === "TrialEndedError" || name === "RateLimitError") return msg || OUR_SIDE;
  return OUR_SIDE;
}

/** Run a texting action; whatever it throws comes back as words. */
export async function guardSms(fn: () => Promise<SmsActionResult>): Promise<SmsActionResult> {
  try {
    return await fn();
  } catch (err) {
    const message = smsFailureMessage(err);
    if (message === OUR_SIDE) console.error("[sms] action failed:", err instanceof Error ? `${err.name}: ${err.message}` : err);
    return { ok: false, error: message };
  }
}
