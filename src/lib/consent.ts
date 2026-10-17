/* Cookie consent — the one record every optional tracker reads (2026-09-09).
   Two categories on top of the essential cookies:
     analytics  — PostHog (page views, session replay on public pages)
     marketing  — advertising measurement
   Stored as a first-party cookie so the server can read it too.

   TWO MODELS BY COUNTRY (owner, 2026-09-30). The middleware reads Vercel's
   x-vercel-ip-country and stores the model — never the country — in the
   jf_region cookie (a year, written once); the client reads it from there,
   so pages stay static. No header (localhost) and no cookie count as the US.
     notice  — everywhere outside CONSENT_OPTIN_COUNTRIES: no jf_consent
               record means analytics and marketing are on, the pixel and
               PostHog load at once, and no banner is shown. The footer's
               "Do not sell or share" turns marketing off; "Cookie settings"
               turns things back on.
     optin   — CONSENT_OPTIN_COUNTRIES: the banner is shown, and nothing
               optional runs until the visitor chooses.
   An explicit jf_consent record — a yes or a no — always beats the country.

   Client-safe: nothing touches `document` until a function is called. */

export const CONSENT_COOKIE = "jf_consent";
/** notice | optin, set by the middleware from the visitor's country. */
export const REGION_COOKIE = "jf_region";
export const REGION_MAX_AGE_S = 60 * 60 * 24 * 365; // 1 year
export const CONSENT_VERSION = 1;
export const CONSENT_MAX_AGE_S = 60 * 60 * 24 * 180; // 180 days
/** Fired on `window` after every write; detail is the new Consent. */
export const CONSENT_EVENT = "jf:consent";
/** Fired on `window` to open the banner's manage view (footer "Cookie settings"). */
export const CONSENT_OPEN_EVENT = "jf:consent-open";

export interface Consent {
  v: number;
  /** ISO time of the decision. */
  at: string;
  analytics: boolean;
  marketing: boolean;
  /** Notice model: defaults recorded without an explicit choice. */
  implied?: boolean;
  /** Notice model: the strip was dismissed with "Got it". */
  ack?: boolean;
}

export type ConsentMode = "notice" | "optin";

/* Where the visitor must opt in before any optional cookie: the EU's 27, the
   rest of the EEA (Iceland, Liechtenstein, Norway), the United Kingdom and
   Switzerland — ISO 3166-1 alpha-2, as Vercel's x-vercel-ip-country sends
   them (Greece is GR). Everyone else gets the notice model. */
export const CONSENT_OPTIN_COUNTRIES: ReadonlySet<string> = new Set([
  // European Union
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE",
  "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
  // EEA outside the EU
  "IS", "LI", "NO",
  // United Kingdom, Switzerland
  "GB", "CH",
]);

/** Opt-in for CONSENT_OPTIN_COUNTRIES; notice everywhere else. No country
 *  (no header — localhost) is treated as the US. */
export function consentModeFor(country: string | null | undefined): ConsentMode {
  const c = (country ?? "").trim().toUpperCase();
  return CONSENT_OPTIN_COUNTRIES.has(c) ? "optin" : "notice";
}

/** The model the middleware stored for this browser; no cookie is notice. */
export function pageConsentMode(): ConsentMode {
  return cookieValue(REGION_COOKIE) === "optin" ? "optin" : "notice";
}

/** What the trackers may do now: the visitor's own record when there is one,
 *  else the country's default — on for notice, off for opt-in. */
export function effectiveConsent(): { analytics: boolean; marketing: boolean; explicit: boolean } {
  return consentFromCookies(cookieValue(CONSENT_COOKIE), cookieValue(REGION_COOKIE));
}

/** effectiveConsent() from the two cookie values — the same rule, for the
 *  server, which reads them off the request. */
export function consentFromCookies(
  consentValue: string | undefined | null,
  regionValue: string | undefined | null,
): { analytics: boolean; marketing: boolean; explicit: boolean } {
  const c = parseConsentCookie(consentValue);
  if (c) return { analytics: c.analytics, marketing: c.marketing, explicit: true };
  const on = regionValue !== "optin";
  return { analytics: on, marketing: on, explicit: false };
}

export function parseConsentCookie(value: string | undefined | null): Consent | null {
  if (!value) return null;
  try {
    const c = JSON.parse(decodeURIComponent(value)) as Partial<Consent>;
    if (typeof c !== "object" || c === null || c.v !== CONSENT_VERSION) return null;
    return {
      v: CONSENT_VERSION,
      at: typeof c.at === "string" ? c.at : "",
      analytics: c.analytics === true,
      marketing: c.marketing === true,
      ...(c.implied ? { implied: true } : {}),
      ...(c.ack ? { ack: true } : {}),
    };
  } catch {
    return null;
  }
}

function cookieValue(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const hit = document.cookie.split("; ").find((c) => c.startsWith(name + "="));
  return hit ? hit.slice(name.length + 1) : undefined;
}

export function readConsent(): Consent | null {
  return parseConsentCookie(cookieValue(CONSENT_COOKIE));
}

export function writeConsent(choice: { analytics: boolean; marketing: boolean; implied?: boolean; ack?: boolean }): Consent {
  const consent: Consent = {
    v: CONSENT_VERSION,
    at: new Date().toISOString(),
    analytics: choice.analytics,
    marketing: choice.marketing,
    ...(choice.implied ? { implied: true } : {}),
    ...(choice.ack ? { ack: true } : {}),
  };
  try {
    document.cookie = `${CONSENT_COOKIE}=${encodeURIComponent(JSON.stringify(consent))}; path=/; max-age=${CONSENT_MAX_AGE_S}; samesite=lax`;
  } catch {
    /* cookies blocked — the choice lasts for this page only */
  }
  try {
    window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: consent }));
  } catch {
    /* no window */
  }
  return consent;
}

/** Subscribe to consent changes; returns the unsubscribe. */
export function onConsent(cb: (c: Consent) => void): () => void {
  const handler = (ev: Event) => cb((ev as CustomEvent<Consent>).detail);
  window.addEventListener(CONSENT_EVENT, handler);
  return () => window.removeEventListener(CONSENT_EVENT, handler);
}

/** "Do not sell or share my personal information": marketing off, the rest kept. */
export function withdrawMarketing(): Consent {
  return writeConsent({ analytics: effectiveConsent().analytics, marketing: false, ack: true });
}

export function openConsentManager(): void {
  try {
    window.dispatchEvent(new Event(CONSENT_OPEN_EVENT));
  } catch {
    /* no window */
  }
}
