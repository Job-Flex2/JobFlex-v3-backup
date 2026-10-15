/* Meta Conversions API, server half (2026-09-09). Every browser event has a
   server copy with the same event_id, so Meta deduplicates the pair; the
   server copy is also the one that survives ad blockers. Sends nothing
   unless NEXT_PUBLIC_META_PIXEL_ID and META_CAPI_ACCESS_TOKEN are both set;
   META_TEST_EVENT_CODE routes events to Events Manager's Test Events tab.

   LOGS (2026-09-30). Every event leaves exactly one line, whatever happens:
   "<Event> events_received=1" when Meta took it, "<Event> rejected <status>:
   <Meta's error.message>" when it did not, "<Event> not sent: …" when a
   variable is missing. The live test on production showed browser events
   and no server ones, and the code had nothing to say about why.

   CONSENT (lib/consent). With marketing consent the event carries fbp/fbc,
   the client IP and the user agent. Without it the event still goes — as a
   server-side conversion record, with the hashed email/phone only. Never a
   raw address: email and phone are SHA-256 hashed, normalised the way Meta
   asks (trimmed, lower-cased; phone as digits with the country code). */

import { createHash } from "node:crypto";
import { isQaEmail } from "@/lib/qaEmail";

const GRAPH_VERSION = "v21.0";

export interface MetaUserData {
  email?: string | null;
  phone?: string | null;
  /** Meta's own cookies, only with marketing consent. */
  fbp?: string | null;
  fbc?: string | null;
  clientIp?: string | null;
  userAgent?: string | null;
  /** The organization id once the account exists, hashed like the rest.
   *  external_id is [sha256(email)] before the account and
   *  [sha256(email), sha256(organization id)] after it (2026-10-01): the
   *  email hash is the one id a Lead, an InitiateCheckout and a Purchase of
   *  the same person all share. */
  externalId?: string | null;
}

export interface MetaEvent {
  eventName: "PageView" | "ViewContent" | "Lead" | "InitiateCheckout" | "CompleteRegistration" | "StartTrial" | "Subscribe" | "Purchase";
  eventId: string;
  /** Unix seconds; now when absent. */
  eventTime?: number;
  sourceUrl?: string | null;
  user: MetaUserData;
  /** industry, plan, utm_* … */
  custom?: Record<string, string | number | null | undefined>;
  value?: number;
  currency?: string;
  /** True when the browser could also have fired this event (consent), for the report only. */
  consent: boolean;
}

export const isMetaCapiConfigured = (): boolean =>
  Boolean(process.env.NEXT_PUBLIC_META_PIXEL_ID?.trim() && process.env.META_CAPI_ACCESS_TOKEN?.trim());

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function hashEmail(email: string | null | undefined): string | null {
  const e = (email ?? "").trim().toLowerCase();
  return e ? sha256(e) : null;
}

/** Digits only, with a country code; a bare 10-digit US number gets "1". */
export function hashPhone(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D+/g, "");
  if (!digits) return null;
  const withCountry = digits.length === 10 ? "1" + digits : digits;
  return withCountry.length >= 11 ? sha256(withCountry) : null;
}

/** The request body, built once so a debug log and the send are the same bytes. */
export function buildMetaPayload(e: MetaEvent): Record<string, unknown> {
  const em = hashEmail(e.user.email);
  const ph = hashPhone(e.user.phone);
  const userData: Record<string, unknown> = {};
  if (em) userData.em = [em];
  if (ph) userData.ph = [ph];
  const externalIds = [em, e.user.externalId ? sha256(e.user.externalId) : null].filter((v): v is string => Boolean(v));
  if (externalIds.length) userData.external_id = externalIds;
  if (e.consent) {
    if (e.user.fbp) userData.fbp = e.user.fbp;
    if (e.user.fbc) userData.fbc = e.user.fbc;
    if (e.user.clientIp) userData.client_ip_address = e.user.clientIp;
    if (e.user.userAgent) userData.client_user_agent = e.user.userAgent;
  }
  const custom: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(e.custom ?? {})) if (v !== null && v !== undefined && v !== "") custom[k] = v;
  if (e.value != null) custom.value = e.value;
  if (e.currency) custom.currency = e.currency;
  const data: Record<string, unknown> = {
    event_name: e.eventName,
    event_time: e.eventTime ?? Math.floor(Date.now() / 1000),
    event_id: e.eventId,
    action_source: "website",
    user_data: userData,
    ...(Object.keys(custom).length ? { custom_data: custom } : {}),
    ...(e.sourceUrl ? { event_source_url: e.sourceUrl } : {}),
  };
  const body: Record<string, unknown> = { data: [data] };
  const test = process.env.META_TEST_EVENT_CODE?.trim();
  if (test) body.test_event_code = test;
  return body;
}

/** Awaits Meta's answer and logs it; never throws. True when Meta accepted
 *  the event. The callers run it inside `after()` or an awaited webhook, so
 *  the request is not cut off with the response. */
export async function sendMetaEvent(e: MetaEvent): Promise<boolean> {
  // The QA Lab's own accounts (@qa.jobflex.test, lib/qaTestMode) never reach Meta.
  if (isQaEmail(e.user?.email)) return false;
  // Read here, at send time, on the server: the token never reaches a bundle.
  const pixel = process.env.NEXT_PUBLIC_META_PIXEL_ID?.trim();
  const token = process.env.META_CAPI_ACCESS_TOKEN?.trim();
  const test = process.env.META_TEST_EVENT_CODE?.trim();
  const body = buildMetaPayload(e);
  const tag = `[meta:capi] ${e.eventName} event_id=${e.eventId}${test ? ` test_event_code=${test}` : ""}`;
  if (process.env.META_CAPI_DEBUG === "true") {
    console.info(`${tag} payload`, JSON.stringify(body));
  }
  if (!pixel || !token) {
    const missing = [!pixel && "NEXT_PUBLIC_META_PIXEL_ID", !token && "META_CAPI_ACCESS_TOKEN"].filter(Boolean).join(" and ");
    console.warn(`${tag} not sent: ${missing} is empty`);
    return false;
  }
  try {
    const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${pixel}/events?access_token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    const text = await res.text().catch(() => "");
    let json: { events_received?: number; fbtrace_id?: string; error?: { message?: string; error_user_msg?: string } } = {};
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON — the raw text is logged below */
    }
    if (!res.ok || json.error) {
      const why = json.error?.error_user_msg || json.error?.message || text.slice(0, 200) || "no body";
      console.warn(`${tag} rejected ${res.status}: ${why}`);
      return false;
    }
    console.info(`${tag} events_received=${json.events_received ?? "?"}${json.fbtrace_id ? ` fbtrace_id=${json.fbtrace_id}` : ""}`);
    return true;
  } catch (err) {
    console.warn(`${tag} unavailable: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/** Meta's fbc, built the way the pixel builds its _fbc cookie when the
 *  cookie itself is missing: `fb.1.<ms when the click id was seen>.<fbclid>`. */
export function fbcFromFbclid(fbclid: string | null | undefined, seenAtMs: number): string | undefined {
  return fbclid ? `fb.1.${seenAtMs}.${fbclid}` : undefined;
}

/* ── what the signup remembers for the events that come later ── */

/** Written on the organization at creation (Organization.metaSignupJson) so
 *  the Stripe webhook's StartTrial / Purchase carry the same person. */
export interface MetaSignupContext {
  consent: boolean;
  registrationEventId: string;
  checkoutEventId?: string;
  fbp?: string;
  /** The pixel's _fbc cookie, or one built from `fbclid` when it was missing. */
  fbc?: string;
  /** Meta's click id from the ad link, with consent only (2026-09-30). */
  fbclid?: string;
  clientIp?: string;
  userAgent?: string;
  sourceUrl?: string;
  /** Set once the first Purchase has gone, so renewals do not repeat it. */
  purchaseSentAt?: string;
  /** Set once Subscribe (the same first paid invoice) has gone. */
  subscribeSentAt?: string;
  trialSentAt?: string;
  /** The sign-up's mode (lib/signupMode), stamped at account creation. */
  signupMode?: string;
}

export function parseMetaSignup(json: string | null | undefined): MetaSignupContext | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as MetaSignupContext;
    return v && typeof v === "object" && typeof v.registrationEventId === "string" ? v : null;
  } catch {
    return null;
  }
}
