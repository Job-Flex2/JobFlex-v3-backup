/* THE SIGN-UP'S MODE (2026-10-10): the password sign-up as built, or the
   passwordless one — name and email, a six-digit code from an email, then the
   plan (lib/signupOtp). The owner's switch on Admin → Trials decides for
   everybody (lib/trialPolicyServer readSignupFlow); `/auth/register?flow=otp`
   turns it on in ONE browser whatever the switch says — so it can be tried on
   production from a phone — and remembers it in a cookie; `?flow=off`
   forgets it. Pure: read by the register page on the server and by the
   register form in the browser. */

export type SignupMode = "password" | "otp";

/** The browser's own choice, set by `?flow=otp` (30 days). */
export const SIGNUP_MODE_COOKIE = "jf_signup_flow";
export const SIGNUP_MODE_MAX_AGE_S = 60 * 60 * 24 * 30;

/** `?flow=` first, then this browser's cookie, then the owner's switch. */
export function resolveSignupMode(param: string | string[] | undefined | null, cookie: string | undefined | null, passwordlessSwitch: boolean): SignupMode {
  const p = Array.isArray(param) ? param[0] : param;
  if (p === "otp") return "otp";
  if (p === "off") return passwordlessSwitch ? "otp" : "password";
  if (cookie === "otp") return "otp";
  return passwordlessSwitch ? "otp" : "password";
}

/** Called in the browser as the register page opens: `?flow=otp` is kept,
 *  `?flow=off` forgotten. */
export function rememberSignupMode(param: string | null): void {
  if (param !== "otp" && param !== "off") return;
  try {
    document.cookie =
      param === "otp"
        ? `${SIGNUP_MODE_COOKIE}=otp; path=/; max-age=${SIGNUP_MODE_MAX_AGE_S}; samesite=lax`
        : `${SIGNUP_MODE_COOKIE}=; path=/; max-age=0; samesite=lax`;
  } catch {
    /* cookies blocked: the parameter still decides this page */
  }
}

/* The passwordless sign-up's draft (lib/signupOtp), named by this cookie as
   well as by `?d=` in the address. Written from the browser — a cookie set by
   a server action refreshes the route, and that refresh put the address back
   the way it was before `?d=` was added. A day, like the draft. */
export const OTP_DRAFT_COOKIE = "jf_otp_draft";
export const OTP_DRAFT_MAX_AGE_S = 24 * 60 * 60;
export function rememberOtpDraft(token: string | null): void {
  try {
    const secure = window.location.protocol === "https:" ? "; secure" : "";
    document.cookie = token
      ? `${OTP_DRAFT_COOKIE}=${encodeURIComponent(token)}; path=/; max-age=${OTP_DRAFT_MAX_AGE_S}; samesite=lax${secure}`
      : `${OTP_DRAFT_COOKIE}=; path=/; max-age=0; samesite=lax${secure}`;
  } catch {
    /* cookies blocked: the address bar still names the draft */
  }
}

/** The sign-up a completed account came through, as the reports split it:
 *  the owner's three settings (Admin → Trials). Carried on the pending signup,
 *  then on the server's completion events (jf_signup_completed, Meta's
 *  CompleteRegistration / StartTrial / Purchase as `signup_mode`). */
export type SignupModeLabel = "3-step" | "2-step" | "passwordless";
export const SIGNUP_MODE_LABELS: readonly SignupModeLabel[] = ["3-step", "2-step", "passwordless"];
