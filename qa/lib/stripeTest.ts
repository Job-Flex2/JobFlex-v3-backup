// Stripe from the QA side — TEST MODE ONLY. The billing suite's test-clock scenario advances clocks
// and reads invoices itself; the key for that is STRIPE_TEST_SECRET_KEY (CI) or the app's own
// STRIPE_SECRET_KEY_TEST (.env.local). STRIPE_SECRET_KEY is never read here — on Vercel and in .env
// it is the LIVE key. A key that is not sk_test_ / rk_test_ stops the billing suite before it starts
// (lib/global-setup) and every call below; the value is never printed.
const API = "https://api.stripe.com/v1";

export class LiveKeyRefused extends Error {}

/** The test key, or null when none is configured. Throws on a key that is not a test key. */
export function stripeTestKey(): string | null {
  const name = process.env.STRIPE_TEST_SECRET_KEY ? "STRIPE_TEST_SECRET_KEY" : process.env.STRIPE_SECRET_KEY_TEST ? "STRIPE_SECRET_KEY_TEST" : null;
  if (!name) return null;
  const key = process.env[name]!.trim();
  if (!/^(sk|rk)_test_/.test(key)) {
    throw new LiveKeyRefused(`QA guard: ${name} is not a Stripe TEST key (it must start with sk_test_ or rk_test_) — the billing suite never runs on a live key.`);
  }
  return key;
}

/** Throws unless the configured key (if any) is a test key. */
export function assertStripeTestOnly(): void {
  stripeTestKey();
}

function form(body: Record<string, string | number | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) if (v !== undefined) p.append(k, String(v));
  return p.toString();
}

/** One Stripe API call with the test key. Answers Stripe's JSON; a Stripe error comes back as { error }. */
export async function stripe<T = Record<string, unknown>>(method: "GET" | "POST", path: string, body?: Record<string, string | number | undefined>): Promise<T & { error?: { type?: string; code?: string; decline_code?: string; message?: string } }> {
  const key = stripeTestKey();
  if (!key) throw new Error("no Stripe test key (STRIPE_TEST_SECRET_KEY / STRIPE_SECRET_KEY_TEST)");
  const url = `${API}${path}${method === "GET" && body ? `?${form(body)}` : ""}`;
  const r = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: method === "POST" ? form(body ?? {}) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  return (await r.json()) as T & { error?: { type?: string; code?: string; decline_code?: string; message?: string } };
}

/** Moves a test clock to `to` (seconds) and waits until Stripe has run everything due by then. */
export async function advanceClock(clockId: string, to: number, timeoutMs = 180_000): Promise<void> {
  const r = await stripe("POST", `/test_helpers/test_clocks/${clockId}/advance`, { frozen_time: to });
  if (r.error) throw new Error(`test clock advance refused: ${r.error.message}`);
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const c = await stripe<{ status: string }>("GET", `/test_helpers/test_clocks/${clockId}`);
    if (c.status === "ready") return;
    if (c.status === "internal_failure") throw new Error("the test clock failed on Stripe's side");
    await new Promise((res) => setTimeout(res, 2000));
  }
  throw new Error(`the test clock did not settle within ${Math.round(timeoutMs / 1000)} s`);
}
