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
