import "server-only";
// THE SIGN-UP'S NETWORK BRAKE (owner, 2026-10-10): twenty new sign-ups an hour
// per IP paired with the browser's User-Agent — a mobile carrier puts
// thousands of people behind one address, so the IP alone (five an hour)
// refused real people. One rule for both sign-ups, each with its own counter:
// the password sign-up's step 2 (actions/signupCheckout startPendingSignup,
// `signup-start`) and the passwordless one's proven new address
// (lib/signupOtp, `otp-signup`). Answers the refusal in words, never throws.
import { HOUR, clientIp, enforceRateLimit } from "@/lib/rateLimit";
import { hashToken } from "@/lib/tokens";

export const SIGNUPS_PER_NETWORK_HOUR = 20;

/** The counter's key: `<prefix>:<ip>:<first 16 hex of sha256(User-Agent)>`. */
export async function signupNetworkKey(prefix: string): Promise<string> {
  let ua = "";
  try {
    const { headers } = await import("next/headers");
    ua = (await headers()).get("user-agent") ?? "";
  } catch {
    /* no request: the IP alone */
  }
  return `${prefix}:${await clientIp()}:${hashToken(ua).slice(0, 16)}`;
}

/** Null when this sign-up may go on; otherwise the words to show. */
export async function signupNetworkBrake(prefix: string): Promise<string | null> {
  try {
    await enforceRateLimit(await signupNetworkKey(prefix), SIGNUPS_PER_NETWORK_HOUR, HOUR, "sign-ups");
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : "Too many sign-ups. Try again later.";
  }
}
