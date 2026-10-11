// The sign-in code (2026-10-10, lib/signupOtp). One email for the
// passwordless sign-up and for "Email me a code" on the sign-in page: the six
// digits large enough to read across a room, how long they last, and one
// button that does the same as typing them — it opens the sign-up (or the
// account) in whatever browser the mail app hands it to. Pure, no I/O.
import type { BoxRow, EmailDoc, Lockup } from "../doc";

const PLATFORM_LOCKUP: Lockup = { kind: "platform" };
const PLATFORM_FOOTER = { name: "JobFlex" };

export interface OtpCodeInput {
  code: string;
  email: string;
  name?: string | null;
  /** Absolute link to /auth/register/code?k=… */
  href: string;
  /** Minutes the code and the button stay good. */
  minutes: number;
}

export function buildOtpCode(i: OtpCodeInput): EmailDoc {
  const first = i.name?.trim().split(/\s+/)[0] || "";
  const box: BoxRow[] = [
    { type: "field", label: "For", value: i.email },
    { type: "field", label: "Expires", value: `In ${i.minutes} minutes` },
    { type: "anchor", label: "Code", value: i.code },
  ];
  return {
    subject: `${i.code} is your JobFlex code`,
    lockup: PLATFORM_LOCKUP,
    kicker: { text: "Your code" },
    headline: "Your JobFlex code",
    prose: [`${first ? `Hi ${first} — e` : "E"}nter this code on the JobFlex page you came from. It works for ${i.minutes} minutes.`],
    box,
    cta: { label: "Continue in browser", href: i.href },
    after: [
      "The button does the same as the code: it opens JobFlex in this phone's or computer's browser and carries on where you left off.",
      "Didn't ask for a code? Ignore this email — nothing happens without it.",
    ],
    footer: PLATFORM_FOOTER,
  };
}

export interface OtpNoAccountInput {
  email: string;
  /** Absolute link to /auth/register?flow=otp… */
  href: string;
}

/** "Email me a code" for an address with no account: the page said the same
 *  thing it says for every address, and this email says what is true. */
export function buildOtpNoAccount(i: OtpNoAccountInput): EmailDoc {
  return {
    subject: "Sign in to JobFlex",
    lockup: PLATFORM_LOCKUP,
    kicker: { text: "Sign in" },
    headline: "No account for this address yet",
    prose: [`Someone asked to sign in to JobFlex as ${i.email}, and there is no JobFlex account for it. If it was you, create one — it takes a minute and no password.`],
    cta: { label: "Create your account", href: i.href },
    after: ["Didn't ask for this? Ignore this email — nothing happens without it."],
    footer: PLATFORM_FOOTER,
  };
}
