// WISETACK FINANCING — what JobFlex asks of a lender, as one interface. ./wisetack.ts is the only implementation;
// the stand runs it against the pretend Wisetack (qa/stand/fake-wisetack.mjs). No env → no provider → financing is
// hidden everywhere, quietly (production stays that way until the partner agreement and the keys).

import type { Funding, LoanSnapshot, LoanState, MerchantState } from "./state";
import { wisetackProvider } from "./wisetack";

export type { Funding, LoanSnapshot, LoanState, MerchantState };

export type MerchantSnapshot = {
  state: MerchantState;
  needs: string[];
  note: string | null;
  minMinor: number | null;
  maxMinor: number | null;
  feeBps: number | null;
  prequalUrl: string | null;
};

/** What JobFlex already knows about the business — the application arrives filled in. */
export type MerchantPrefill = {
  /** The JobFlex organization id. */
  reference: string;
  businessName: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: { line1: string | null; city: string | null; state: string | null; zip: string | null };
  trade: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
  yearStarted: number | null;
  returnUrl: string;
};

export type ProviderEvent =
  | { id: string; kind: "merchant"; merchantRef: string; snapshot: MerchantSnapshot }
  | { id: string; kind: "loan"; loanRef: string; snapshot: LoanSnapshot }
  | { id: string; kind: "prequal"; merchantRef: string; person: { name: string; phone: string | null; email: string | null }; amountMinor: number };

export interface FinancingProvider {
  startMerchant(p: MerchantPrefill): Promise<{ merchantRef: string; url: string }>;
  /** A contractor who already has a Wisetack account. */
  linkMerchant(p: { email: string; reference: string; returnUrl: string }): Promise<{ merchantRef: string; url: string | null } | { error: "not_found" }>;
  merchant(ref: string): Promise<MerchantSnapshot>;
  createLoan(i: {
    merchantRef: string;
    amountMinor: number;
    purpose: string;
    /** The JobFlex proposal id. */
    reference: string;
    client: { name: string; phone: string | null; email: string | null };
    returnUrl: string;
  }): Promise<{ loanRef: string; url: string; expiresAt: string | null }>;
  loan(ref: string): Promise<LoanSnapshot>;
  /** Ask the client to confirm the job is done (the payout follows). */
  askDone(ref: string): Promise<"asked" | "unsupported">;
  cancelLoan(ref: string): Promise<void>;
  /** Wisetack's own monthly wording for this amount, or null — JobFlex never makes one up. */
  monthly(merchantRef: string, amountMinor: number): Promise<string | null>;
  /** Signed events, or null when the signature is wrong or missing. */
  parseWebhook(raw: string, headers: Headers): ProviderEvent[] | null;
}

export function getProvider(env: NodeJS.ProcessEnv = process.env): FinancingProvider | null {
  const base = env.WISETACK_API_BASE?.trim();
  const key = env.WISETACK_API_KEY?.trim();
  const secret = env.WISETACK_WEBHOOK_SECRET?.trim();
  if (!base || !key || !secret) return null;
  return wisetackProvider({ base, key, secret });
}
