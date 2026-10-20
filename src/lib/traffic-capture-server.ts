import { createHash } from "node:crypto";
import { z } from "zod";

export const trafficIdentitySchema = z.object({
  distinctId: z.string().min(1).max(200), sessionId: z.string().max(100),
  hostname: z.string().max(253).regex(/^[a-zA-Z0-9.:-]+$/),
  environment: z.enum(["development", "production"]),
});

/** A verified server outcome, with the browser's anonymous ID to connect the funnel. */
/** `variant` (landing-e pass A): "e" for the test landing's signups, absent otherwise — the funnel reads absent as d. */
export async function captureSignupOutcome(identity: unknown, sessionId: string, outcome: string, plan: string | null, live: boolean, industry: string | null = null, utm: Record<string, string | undefined> | null = null, variant: string | null = null, signupMode: string | null = null) {
  const utmProps = Object.fromEntries(Object.entries(utm ?? {}).filter(([k, v]) => /^utm_(source|medium|campaign|content|term)$/.test(k) && v));
  const parsed = trafficIdentitySchema.safeParse(identity);
  const token = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!parsed.success || !token) return;
  const host = (process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com").replace(/\/+$/, "");
  if (!["https://us.i.posthog.com", "https://eu.i.posthog.com"].includes(host)) return;
  const context = parsed.data;
  try {
    const response = await fetch(`${host}/capture/`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: token, event: "jf_signup_completed", distinct_id: context.distinctId,
        timestamp: new Date().toISOString(),
        properties: { $insert_id: createHash("sha256").update(`jf_signup_completed:${sessionId}`).digest("hex"),
          $session_id: context.sessionId, $process_person_profile: false, $pathname: "/auth/register",
          jf_hostname: context.hostname, jf_environment: context.environment, verified: true, billing_mode: live ? "live" : "test", outcome, plan: plan || "unknown", industry: industry || "default", ...(variant ? { variant } : {}), ...(signupMode ? { signup_mode: signupMode } : {}), ...utmProps } }),
      signal: AbortSignal.timeout(3000), cache: "no-store",
    });
    if (!response.ok) console.warn("[traffic] signup capture rejected", response.status);
  } catch { console.warn("[traffic] signup capture unavailable"); }
}

/* THE SERVER'S OWN STEPS OF THE SIGN-UP (2026-10-19). A hand-off the server makes — the 303 to Stripe from
   /auth/register/checkout — has no page left to report it, so it is sent from here under the browser's anonymous ID
   (the one the pending signup recorded, else the PostHog cookie's), with the same hostname and environment tags the
   browser's events carry. Never awaited by the visitor (next/server after()); no ID, no event. */
export async function captureTrafficEvent(identity: unknown, event: string, properties: Record<string, string | number | boolean | null>) {
  const parsed = trafficIdentitySchema.safeParse(identity);
  const token = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!parsed.success || !token) return;
  const host = (process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com").replace(/\/+$/, "");
  if (!["https://us.i.posthog.com", "https://eu.i.posthog.com"].includes(host)) return;
  const context = parsed.data;
  try {
    const response = await fetch(`${host}/capture/`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: token, event, distinct_id: context.distinctId, timestamp: new Date().toISOString(),
        properties: { ...(context.sessionId ? { $session_id: context.sessionId } : {}), $process_person_profile: false, $pathname: "/auth/register",
          jf_hostname: context.hostname, jf_environment: context.environment, jf_server: true, ...properties } }),
      signal: AbortSignal.timeout(3000), cache: "no-store",
    });
    if (!response.ok) console.warn("[traffic] server event rejected", event, response.status);
  } catch { console.warn("[traffic] server event unavailable", event); }
}

/** The browser's anonymous ID from posthog-js's own cookie (`ph_<key>_posthog`, persistence "localStorage+cookie"),
 *  for a request that brought no recorded identity — a sign-up sent without JavaScript, say. */
export function identityFromCookie(cookieValue: string | null | undefined, hostname: string) {
  if (!cookieValue) return undefined;
  try {
    const rec = JSON.parse(decodeURIComponent(cookieValue)) as { distinct_id?: unknown; $sesid?: unknown };
    if (typeof rec.distinct_id !== "string" || !rec.distinct_id) return undefined;
    const sesid = Array.isArray(rec.$sesid) && typeof rec.$sesid[1] === "string" ? rec.$sesid[1] : "";
    const environment = hostname === "localhost" || hostname === "127.0.0.1" ? "development" : "production";
    return { distinctId: rec.distinct_id, sessionId: sesid, hostname, environment } as const;
  } catch {
    return undefined;
  }
}
