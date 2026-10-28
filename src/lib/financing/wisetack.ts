// WISETACK — the one file that talks to Wisetack.
//
// ASSUMED SHAPE (2026-10-28). Wisetack's partner API is private: its docs and sandbox keys come with the partner
// agreement the owner is asking for. Until then the paths, field names, status names and the webhook signature below
// are JobFlex's assumption, and the pretend Wisetack (qa/stand/fake-wisetack.mjs) answers to exactly this shape.
// When the real docs arrive: rewrite the calls and the two status tables here, keep the FinancingProvider interface,
// re-run qa/tests/logic/financing-*.check.ts, then walk one job in Wisetack's sandbox.
//
// Money is in minor units (cents) both ways.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { FinancingProvider, MerchantSnapshot, ProviderEvent } from "./provider";
import type { Funding, LoanSnapshot, LoanState, MerchantState } from "./state";

export const MERCHANT_STATUS: Record<string, MerchantState> = {
  APPLICATION_STARTED: "started",
  UNDER_REVIEW: "review",
  ACTION_REQUIRED: "needs_info",
  APPROVED: "approved",
  DECLINED: "declined",
  SUSPENDED: "paused",
};

export const LOAN_STATUS: Record<string, LoanState> = {
  INITIATED: "sent",
  STARTED: "started",
  ACTIONS_REQUIRED: "needs_action",
  AUTHORIZED: "approved",
  LOAN_TERMS_ACCEPTED: "accepted",
  COMPLETION_REQUESTED: "done_asked",
  SETTLED: "paid",
  DECLINED: "declined",
  EXPIRED: "expired",
  CANCELED: "canceled",
  REFUNDED: "refunded",
};

const SIGNATURE_HEADER = "x-wisetack-signature";

export function signBody(raw: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
}

function signatureOk(raw: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const want = Buffer.from(signBody(raw, secret));
  const got = Buffer.from(header.trim());
  return want.length === got.length && timingSafeEqual(want, got);
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const int = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);

function merchantSnapshot(d: Obj): MerchantSnapshot | null {
  const state = MERCHANT_STATUS[String(d.status ?? "")];
  if (!state) return null;
  return {
    state,
    needs: Array.isArray(d.requirements) ? d.requirements.filter((r): r is string => typeof r === "string" && !!r.trim()) : [],
    note: str(d.note),
    minMinor: int(d.minAmount),
    maxMinor: int(d.maxAmount),
    feeBps: int(d.feeBps),
    prequalUrl: str(d.prequalUrl),
  };
}

function loanSnapshot(d: Obj): LoanSnapshot | null {
  const state = LOAN_STATUS[String(d.status ?? "")];
  if (!state) return null;
  const fundings: Funding[] = Array.isArray(d.fundings)
    ? d.fundings
        .map(obj)
        .filter((f) => !!str(f.id) && int(f.amount) !== null)
        .map((f) => ({ id: String(f.id), amountMinor: int(f.amount)!, at: str(f.at) ?? new Date().toISOString() }))
    : [];
  return { state, approvedMinor: int(d.approvedAmount), fundings, expiresAt: str(d.expiresAt) };
}

function toEvent(e: Obj): ProviderEvent | null {
  const id = str(e.id);
  const d = obj(e.data);
  if (!id) return null;
  if (e.type === "merchant.updated") {
    const ref = str(d.merchantRef);
    const snapshot = merchantSnapshot(d);
    return ref && snapshot ? { id, kind: "merchant", merchantRef: ref, snapshot } : null;
  }
  if (e.type === "transaction.updated") {
    const ref = str(d.transactionId);
    const snapshot = loanSnapshot(d);
    return ref && snapshot ? { id, kind: "loan", loanRef: ref, snapshot } : null;
  }
  if (e.type === "prequal.completed") {
    const ref = str(d.merchantRef);
    const c = obj(d.customer);
    const name = str(c.name);
    const amount = int(d.amount);
    return ref && name && amount !== null ? { id, kind: "prequal", merchantRef: ref, person: { name, phone: str(c.phone), email: str(c.email) }, amountMinor: amount } : null;
  }
  return null;
}

export function wisetackProvider(cfg: { base: string; key: string; secret: string }): FinancingProvider {
  const root = cfg.base.replace(/\/+$/, "");
  const call = async (method: "GET" | "POST", path: string, body?: unknown): Promise<Response> =>
    fetch(`${root}${path}`, {
      method,
      headers: { authorization: `Bearer ${cfg.key}`, accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
  const ok = async (res: Response): Promise<Obj> => {
    if (!res.ok) throw new Error(`Wisetack: ${res.status}`);
    return obj(await res.json().catch(() => ({})));
  };
  const merchantOf = (d: Obj): MerchantSnapshot => {
    const s = merchantSnapshot(d);
    if (!s) throw new Error(`Wisetack: unknown merchant status ${String(d.status)}`);
    return s;
  };

  return {
    async startMerchant(p) {
      const d = await ok(await call("POST", "/v1/merchants", p));
      const ref = str(d.merchantRef);
      const url = str(d.applicationUrl);
      if (!ref || !url) throw new Error("Wisetack: no merchant reference");
      return { merchantRef: ref, url };
    },
    async linkMerchant(p) {
      const res = await call("POST", "/v1/merchants/link", p);
      if (res.status === 404) return { error: "not_found" as const };
      const d = await ok(res);
      const ref = str(d.merchantRef);
      if (!ref) throw new Error("Wisetack: no merchant reference");
      return { merchantRef: ref, url: str(d.url) };
    },
    async merchant(ref) {
      return merchantOf(await ok(await call("GET", `/v1/merchants/${encodeURIComponent(ref)}`)));
    },
    async createLoan(i) {
      const d = await ok(
        await call("POST", "/v1/transactions", {
          merchantRef: i.merchantRef,
          amount: i.amountMinor,
          purpose: i.purpose,
          reference: i.reference,
          customer: i.client,
          returnUrl: i.returnUrl,
        }),
      );
      const ref = str(d.transactionId);
      const url = str(d.paymentLink);
      if (!ref || !url) throw new Error("Wisetack: no transaction");
      return { loanRef: ref, url, expiresAt: str(d.expiresAt) };
    },
    async loan(ref) {
      const s = loanSnapshot(await ok(await call("GET", `/v1/transactions/${encodeURIComponent(ref)}`)));
      if (!s) throw new Error("Wisetack: unknown transaction status");
      return s;
    },
    async askDone(ref) {
      const res = await call("POST", `/v1/transactions/${encodeURIComponent(ref)}/completion-request`, {});
      if (res.status === 404 || res.status === 501) return "unsupported";
      await ok(res);
      return "asked";
    },
    async cancelLoan(ref) {
      await ok(await call("POST", `/v1/transactions/${encodeURIComponent(ref)}/cancel`, {}));
    },
    async monthly(merchantRef, amountMinor) {
      const res = await call("GET", `/v1/merchants/${encodeURIComponent(merchantRef)}/monthly?amount=${amountMinor}`);
      if (res.status === 204 || res.status === 404) return null;
      return str((await ok(res)).text);
    },
    parseWebhook(raw, headers) {
      if (!signatureOk(raw, headers.get(SIGNATURE_HEADER), cfg.secret)) return null;
      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        return [];
      }
      const list = Array.isArray(obj(body).events) ? (obj(body).events as unknown[]) : [body];
      return list.map((e) => toEvent(obj(e))).filter((e): e is ProviderEvent => e !== null);
    },
  };
}
