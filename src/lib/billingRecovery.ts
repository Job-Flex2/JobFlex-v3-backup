import type { PlanStatusRow } from "@/lib/planStatus";
import { planLapsed } from "@/lib/planStatus";

export type RecoveryKind = "active" | "payment" | "trial-ended" | "canceled" | "expired";
export interface BillingRecoveryState {
  kind: RecoveryKind;
  blocked: boolean;
  verified: boolean;
  reason: string;
  invoiceUrl: string | null;
  amountCents: number | null;
  currency: string;
  nextRetryAt: string | null;
  canUpdateCard: boolean;
  isOwner: boolean;
}

export function recoveryKind(sub: PlanStatusRow | null): RecoveryKind {
  if (sub && ["PAST_DUE", "UNPAID"].includes(sub.status)) return "payment";
  if (sub?.status === "TRIAL_ENDED" || (sub?.status === "TRIALING" && planLapsed(sub))) return "trial-ended";
  // The Free plan (lib/freePlan): a subscription that ended, or a grant that ran out.
  if (sub?.status === "CANCELED" || sub?.status === "FREE") return "canceled";
  return sub && !planLapsed(sub) ? "active" : "expired";
}

/** Safe explanations only. Never expose raw provider errors or fraud codes. */
export function paymentFailureReason(code?: string | null): string {
  switch (code) {
    case "insufficient_funds": return "Your bank reported insufficient funds. Add funds, then review and retry the payment, or use another card.";
    case "expired_card": return "Your card has expired. Update your card to complete the payment.";
    case "authentication_required": return "Your bank needs you to confirm this payment. Open the invoice to finish verification.";
    case "incorrect_cvc": case "invalid_cvc": return "Your bank could not verify the card security code. Update your card details.";
    default: return "The payment for your plan did not go through. Your bank may not provide a specific reason. Review the invoice or update your card.";
  }
}
