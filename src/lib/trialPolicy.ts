// THE TRIAL'S TERMS, IN ONE PLACE.
//
// THE CARD IS TAKEN UP FRONT (owner, 2026-10-06 — back from the card-less
// experiment of 2026-10-01). The plan step opens Stripe Checkout for the plan
// picked, the card is taken, the trial runs seven days (the 3-day test ended
// 2026-10-11, lib/trialOffer), and then Stripe
// charges that plan's price (/api/checkout/signup → completePendingSignup).
// That is the default: no variable, or anything but "false".
//
// TRIAL_REQUIRES_CARD=false brings back the card-less trial: the plan step
// asks for nothing, the address is confirmed by email, and the account
// starts on its assigned trial with no payment method on file (lib/cardlessTrial).
// The code stays, switched off. Trials already started that way keep their
// ribbon, caps and add-card screen whatever the flag says — those read the
// organization's own card-less record (lib/trialState), not this switch.
// Read on the server only; pages hand the answer to their client components
// as a prop.
//
// SINCE 2026-10-07 THE OWNER'S SWITCH WINS: Admin → Trials keeps one row
// (lib/trialPolicyServer) and every door asks `signupTrialMode()` THERE —
// the switch, else the variable below, plus the day's card-less ceiling.
// The variable is only the default while no row is set (Reset to default
// (env) on Admin → Trials removes the row).

/** The deployment's default: a card up front unless TRIAL_REQUIRES_CARD=false. */
export function trialRequiresCardEnv(): boolean {
  return process.env.TRIAL_REQUIRES_CARD?.trim().toLowerCase() !== "false";
}

/** Legacy fallback only. New signups use the persisted offer in trialOffer.ts. */
export const TRIAL_DAYS = 7;

/** The card-less trial's length (the same seven days). */
export const CARDLESS_TRIAL_DAYS = TRIAL_DAYS;

/** The line every trial badge, register button note and plan card carries. */
export function trialLine(requiresCard: boolean, days: number = TRIAL_DAYS): string {
  return requiresCard ? `Start your ${days}-day free trial` : `${days}-Day Free Trial · No Credit Card Required`;
}
