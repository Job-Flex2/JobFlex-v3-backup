// RAMP'S DEVELOPER API, THE DOOR (2026-10-29). One JobFlex app registered in Ramp's Developer Console — its client
// id and secret in the platform's env — and every contractor authorizes it on their own Ramp business
// (Authorization Code grant: docs.ramp.com/developer-api/v1/authorization). Tokens live an hour; the refresh token
// renews them. The stand points RAMP_API_BASE and RAMP_AUTH_BASE at a fake; the sandbox at demo-api.ramp.com.
import type { RampTransaction } from "./shared";

export interface RampEnv {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  apiBase: string;
  authBase: string;
}
export function rampEnv(): RampEnv | null {
  const clientId = process.env.RAMP_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.RAMP_CLIENT_SECRET?.trim() ?? "";
  const redirectUri = process.env.RAMP_REDIRECT_URI?.trim() ?? "";
  if (!clientId || !clientSecret || !redirectUri) return null;
  return {
    clientId,
    clientSecret,
    redirectUri,
    apiBase: (process.env.RAMP_API_BASE?.trim() || "https://api.ramp.com").replace(/\/+$/, ""),
    authBase: (process.env.RAMP_AUTH_BASE?.trim() || "https://app.ramp.com").replace(/\/+$/, ""),
  };
}
export const rampEnabled = (): boolean => rampEnv() !== null;

/** What the contractor grants JobFlex: read the business, its users, transactions and receipts; keep the job field and its options; write memos; run webhooks. */
export const RAMP_SCOPES = ["business:read", "users:read", "transactions:read", "receipts:read", "accounting:read", "accounting:write", "memos:write", "webhooks:read", "webhooks:write"] as const;

export function rampAuthorizeUrl(env: RampEnv, state: string): string {
  const q = new URLSearchParams({ response_type: "code", client_id: env.clientId, redirect_uri: env.redirectUri, scope: RAMP_SCOPES.join(" "), state });
  return `${env.authBase}/v1/authorize?${q.toString()}`;
}

export interface RampTokenResponse {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number | null;
  scope?: string;
  token_type?: string;
}

export class RampApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly body?: string) {
    super(message);
    this.name = "RampApiError";
  }
}

/** POST /developer/v1/token with the app's Basic credentials. */
export async function rampToken(env: RampEnv, form: Record<string, string>): Promise<RampTokenResponse> {
  const r = await fetch(`${env.apiBase}/developer/v1/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${env.clientId}:${env.clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  const text = await r.text();
  if (!r.ok) throw new RampApiError(r.status, `Ramp token request failed (${r.status})`, text.slice(0, 400));
  const json = JSON.parse(text) as RampTokenResponse;
  if (!json.access_token) throw new RampApiError(r.status, "Ramp returned no access token", text.slice(0, 400));
  return json;
}

export interface RampPage<T> {
  data: T[];
  page?: { next?: string | null };
}

/** The API with one business's access token. */
export class RampApi {
  constructor(private readonly env: RampEnv, private readonly accessToken: string) {}

  private async call<T>(method: string, path: string, body?: unknown, query?: Record<string, string>): Promise<T> {
    const url = path.startsWith("http") ? new URL(path) : new URL(`${this.env.apiBase}/developer/v1${path}`);
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
    const r = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${this.accessToken}`, Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    const text = await r.text();
    if (!r.ok) throw new RampApiError(r.status, `Ramp ${method} ${url.pathname} failed (${r.status})`, text.slice(0, 600));
    return (text ? JSON.parse(text) : {}) as T;
  }
  get<T>(path: string, query?: Record<string, string>): Promise<T> {
    return this.call<T>("GET", path, undefined, query);
  }
  post<T>(path: string, body: unknown): Promise<T> {
    return this.call<T>("POST", path, body);
  }
  patch<T>(path: string, body: unknown): Promise<T> {
    return this.call<T>("PATCH", path, body);
  }
  delete<T>(path: string): Promise<T> {
    return this.call<T>("DELETE", path);
  }
  /** Every page of a list, following `page.next`, never past `max` rows. */
  async listAll<T>(path: string, query: Record<string, string>, max = 2000): Promise<T[]> {
    const out: T[] = [];
    let next: string | null = null;
    let first = true;
    while (first || next) {
      const page: RampPage<T> = first ? await this.get<RampPage<T>>(path, query) : await this.get<RampPage<T>>(next as string);
      first = false;
      out.push(...(page.data ?? []));
      next = page.page?.next ?? null;
      if (out.length >= max) break;
    }
    return out.slice(0, max);
  }

  business(): Promise<{ id?: string; business_name_legal?: string; business_name_on_card?: string; active?: boolean }> {
    return this.get("/business");
  }
  transactions(since: Date | null, max = 1000): Promise<RampTransaction[]> {
    const q: Record<string, string> = { page_size: "100" };
    if (since) q.from_date = since.toISOString();
    return this.listAll<RampTransaction>("/transactions", q, max);
  }
  transaction(id: string): Promise<RampTransaction> {
    return this.get(`/transactions/${encodeURIComponent(id)}`);
  }
  receipt(id: string): Promise<{ id?: string; receipt_url: string; transaction_id?: string }> {
    return this.get(`/receipts/${encodeURIComponent(id)}`);
  }
  users(): Promise<Array<{ id?: string; email?: string; phone?: string | null; first_name?: string; last_name?: string; status?: string; role?: string }>> {
    return this.listAll("/users", { page_size: "100" }, 500);
  }
  user(id: string): Promise<{ id?: string; email?: string; phone?: string | null; first_name?: string; last_name?: string }> {
    return this.get(`/users/${encodeURIComponent(id)}`);
  }
  memo(transactionId: string, memo: string): Promise<{ id?: string; memo?: string }> {
    return this.post(`/memos/${encodeURIComponent(transactionId)}`, { memo: memo.slice(0, 500) });
  }
  createField(body: { id: string; name: string; input_type: "SINGLE_CHOICE"; is_required_for: string[]; is_splittable: boolean }): Promise<{ ramp_id?: string; id?: string; is_required_for?: string[] }> {
    return this.post("/accounting/fields", body);
  }
  updateField(rampId: string, body: { is_required_for?: string[]; name?: string }): Promise<{ ramp_id?: string }> {
    return this.patch(`/accounting/fields/${encodeURIComponent(rampId)}`, body);
  }
  fieldOptions(fieldRampId: string): Promise<Array<{ id?: string; ramp_id?: string; value?: string; is_active?: boolean; visibility?: string }>> {
    return this.listAll("/accounting/field-options", { field_id: fieldRampId, page_size: "100" }, 2000);
  }
  uploadFieldOptions(fieldRampId: string, options: Array<{ id: string; value: string }>): Promise<{ uploaded?: string[] }> {
    return this.post("/accounting/field-options", { field_id: fieldRampId, options });
  }
  updateFieldOption(optionRampId: string, body: { value?: string; visibility?: "HIDDEN" | "VISIBLE"; reactivate?: boolean }): Promise<{ ramp_id?: string }> {
    return this.patch(`/accounting/field-options/${encodeURIComponent(optionRampId)}`, body);
  }
  createWebhook(endpointUrl: string, eventTypes: string[]): Promise<{ id: string; secret: string; status?: string }> {
    return this.post("/webhooks", { endpoint_url: endpointUrl, event_types: eventTypes });
  }
  verifyWebhook(id: string, challenge: string): Promise<{ success?: boolean }> {
    return this.post(`/webhooks/${encodeURIComponent(id)}/verify`, { challenge });
  }
  deleteWebhook(id: string): Promise<unknown> {
    return this.delete(`/webhooks/${encodeURIComponent(id)}`);
  }
  inviteUser(body: { email: string; first_name: string; last_name: string; idempotency_key: string; role: "BUSINESS_USER" }): Promise<{ id: string }> {
    return this.post("/users/deferred", body);
  }
}

/** Revoke a token on disconnect; a failure is not the contractor's problem. */
export async function rampRevoke(env: RampEnv, token: string): Promise<void> {
  try {
    await fetch(`${env.apiBase}/developer/v1/token/revoke`, {
      method: "POST",
      headers: { Authorization: `Basic ${Buffer.from(`${env.clientId}:${env.clientSecret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    /* revoked or not, the connection is gone on our side */
  }
}
