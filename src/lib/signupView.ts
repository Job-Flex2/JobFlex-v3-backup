/* THE SIGN-UP SCREEN (owner, 2026-10-22): "when they click the 7-day trial they appear right away in the JobFlex
   platform — the sidebar, the overview, nothing you can click — and right in the middle of it they continue with
   Google, the way it is now; then the card and the payment. A switch, a different method of sign up."

   "page"  = the sign-up page as built (the form beside the photo).
   "app"   = the same form as a card in the middle of a preview of the app (components/v3/auth-register-blueprint/
             app-preview.tsx — the overview with sample work, inert); on a phone a sheet over the phone app.
   "split" = half and half: each new visitor gets one of the two and keeps it (the jf_suv cookie), and the register
             page records the exposure, so the A/B tab on the traffic page compares them.

   A link can ask for one — `?view=app` or `?view=page` (an ad sending its own visitors in, or the owner looking) —
   and that holds for the rest of the browser session, over the switch.

   The view only changes what is drawn. The form, the server's checks, Google, the card page and the account are the
   same in both. Client-safe: no server imports. */

export type SignupView = "page" | "app";
export type SignupViewMode = SignupView | "split";

/** The visitor's screen: "app" / "page", with "!" when a link asked for it. */
export const SIGNUP_VIEW_COOKIE = "jf_suv";
/** The experiment name the split records (lib/traffic-client trackTrafficExperiment). */
export const SIGNUP_VIEW_EXPERIMENT = "signup_view";
/** How long a half-and-half visitor keeps the screen they were given. A link's choice lasts the browser session. */
export const SIGNUP_VIEW_DAYS = 30;

export function isSignupViewMode(value: unknown): value is SignupViewMode {
  return value === "page" || value === "app" || value === "split";
}

export interface SignupViewChoice {
  view: SignupView;
  /** link = `?view=` (now or earlier this session); switch = the owner's page/app; split = half and half. */
  source: "link" | "switch" | "split";
}

function readCookie(raw: string | null | undefined): { view: SignupView; byLink: boolean } | null {
  if (!raw) return null;
  const byLink = raw.endsWith("!");
  const v = byLink ? raw.slice(0, -1) : raw;
  return v === "app" || v === "page" ? { view: v, byLink } : null;
}

/** The cookie's value for a choice. */
export function signupViewCookieValue(choice: SignupViewChoice): string {
  return choice.source === "link" ? `${choice.view}!` : choice.view;
}

/**
 * A visitor's fixed place in the half-and-half split: a number in [0, 1) from any steady id — the analytics id, or
 * the address and browser before there is one — so the same person lands on the same side even without the cookie.
 * FNV-1a with a final mix (the top bit decides the side, and FNV alone leaves it weak).
 */
export function signupViewCoin(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Which screen this visit gets. `coin` is a number in [0, 1) — used only for a visitor under "split" who has no
 * screen yet. A `?view=` link wins, then a link's choice from earlier in the session, then the switch; under the
 * split a visitor keeps the screen they were first given.
 */
export function resolveSignupView(mode: SignupViewMode, param: unknown, cookie: string | null | undefined, coin: number): SignupViewChoice {
  if (param === "app" || param === "page") return { view: param, source: "link" };
  const kept = readCookie(cookie);
  if (kept?.byLink) return { view: kept.view, source: "link" };
  if (mode === "split") return { view: kept ? kept.view : coin < 0.5 ? "app" : "page", source: "split" };
  return { view: mode, source: "switch" };
}
