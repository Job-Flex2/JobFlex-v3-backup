// WHY A PLAN CHARGE FAILED — the words (owner, 2026-10-21). Pure, safe for the
// client bundle: the admin page (/admin/revenue/failed-payments) labels its
// rows with these, and the owner's text (lib/billingProblemText) says the
// reason in plain words. The rows themselves are lib/paymentFailures.

export type CardFunding = "credit" | "debit" | "prepaid" | "unknown";
export const CARD_FUNDINGS: readonly CardFunding[] = ["credit", "debit", "prepaid", "unknown"];

export function cardFunding(v: string | null | undefined): CardFunding {
  return v === "credit" || v === "debit" || v === "prepaid" ? v : "unknown";
}

/** The code a failure is counted under: the bank's decline code, else Stripe's error code. */
export function failureCode(f: { declineCode: string | null; errorCode: string | null }): string {
  return f.declineCode || f.errorCode || "no_reason";
}

/** The admin's label for a decline / error code — Stripe's own codes, named. */
const LABELS: Record<string, string> = {
  insufficient_funds: "Insufficient funds",
  do_not_honor: "Do not honor",
  generic_decline: "Generic decline",
  card_declined: "Card declined",
  expired_card: "Expired card",
  incorrect_cvc: "Incorrect CVC",
  invalid_cvc: "Invalid CVC",
  incorrect_number: "Incorrect number",
  invalid_number: "Invalid number",
  invalid_expiry_month: "Invalid expiry",
  invalid_expiry_year: "Invalid expiry",
  incorrect_zip: "ZIP check failed",
  authentication_required: "Needs bank approval (3DS)",
  card_velocity_exceeded: "Card limit reached",
  withdrawal_count_limit_exceeded: "Card limit reached",
  transaction_not_allowed: "Transaction not allowed",
  card_not_supported: "Card not supported",
  currency_not_supported: "Currency not supported",
  not_permitted: "Not permitted",
  restricted_card: "Restricted card",
  call_issuer: "Call the bank",
  processing_error: "Processing error",
  try_again_later: "Try again later",
  issuer_not_available: "Bank unavailable",
  reenter_transaction: "Re-enter transaction",
  fraudulent: "Fraud suspected (bank)",
  merchant_blacklist: "Blocked (Radar list)",
  highest_risk_level: "Blocked by Radar",
  lost_card: "Lost card",
  stolen_card: "Stolen card",
  pickup_card: "Pick-up card",
  security_violation: "Security violation",
  service_not_allowed: "Service not allowed",
  stop_payment_order: "Stop-payment order",
  revocation_of_authorization: "Authorization revoked",
  revocation_of_all_authorizations: "Authorization revoked",
  new_account_information_available: "New card details at the bank",
  invalid_account: "Invalid account",
  account_closed: "Account closed",
  payment_intent_authentication_failure: "Bank approval failed (3DS)",
  no_payment_method: "No card on file",
  no_reason: "No reason given",
};

export function failureLabel(code: string): string {
  return LABELS[code] ?? code.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** The reason as the owner reads it in a text. Never a fraud or Radar code (lib/billingRecovery's rule): anything the
 *  bank would rather not explain is "your bank declined it". */
export function plainDeclineWords(code: string | null | undefined): string {
  switch (code) {
    case "insufficient_funds":
      return "insufficient funds";
    case "expired_card":
      return "the card has expired";
    case "incorrect_cvc":
    case "invalid_cvc":
      return "the card's security code didn't match";
    case "incorrect_number":
    case "invalid_number":
      return "the card number is wrong";
    case "invalid_expiry_month":
    case "invalid_expiry_year":
      return "the card's expiry date is wrong";
    case "authentication_required":
    case "payment_intent_authentication_failure":
      return "your bank needs you to approve it";
    case "card_velocity_exceeded":
    case "withdrawal_count_limit_exceeded":
      return "the card's limit was reached";
    case "processing_error":
    case "try_again_later":
    case "issuer_not_available":
      return "the bank couldn't process it just now";
    case "card_not_supported":
    case "currency_not_supported":
    case "transaction_not_allowed":
      return "the card doesn't allow this charge";
    case "no_payment_method":
      return "there's no card on file";
    default:
      return "your bank declined it";
  }
}

export const FUNDING_LABELS: Record<CardFunding, string> = {
  credit: "Credit",
  debit: "Debit",
  prepaid: "Prepaid",
  unknown: "Unknown",
};
