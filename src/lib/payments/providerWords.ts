// The words for where a payment came from — the activity feed's "received via …" and the dashboard a refund happens
// in. Pure (lib/payments/settle re-exports them; the checks import them here).

/** The dashboard a refund happens in. */
export function providerName(provider: string): string {
  return provider === "SQUARE" ? "Square" : provider === "STAX" ? "Stax" : provider === "WISETACK" ? "Wisetack" : "Stripe";
}

export function providerWord(provider: string, method: string | null): string {
  if (provider === "STRIPE") return method === "us_bank_account" ? "Stripe (bank debit)" : "Stripe";
  if (provider === "SQUARE") return "Square";
  if (provider === "STAX") return method === "us_bank_account" ? "Stax (bank)" : "Stax";
  if (provider === "WISETACK") return "Wisetack financing";
  if (method === "BANK_TRANSFER") return "bank transfer";
  if (method === "CASH") return "cash";
  if (method === "CHECK") return "check";
  return "manual entry";
}
