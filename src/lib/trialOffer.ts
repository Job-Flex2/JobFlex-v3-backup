/** Server-assigned signup experiment. Existing intents without an offer keep seven days. */
export const TRIAL_EXPERIMENT = "signup_trial_length_v1";
export const TRIAL_OFFER_COOKIE = "jf_trial_offer_v1";
export const TRIAL_OFFER_MAX_AGE = 30 * 24 * 60 * 60;
export type TrialOffer = { variant: "a" | "b"; days: 3 | 7 };
export const LEGACY_TRIAL_OFFER: TrialOffer = { variant: "b", days: 7 };

/* THE TEST IS OVER (owner, 2026-10-11): everyone gets seven days again. The
   middleware assigns no variant, a stored "a" (cookie, pending signup, code
   draft) resolves to seven days, no exposure is recorded and new subscriptions
   carry no experiment label. The mechanism stays: to run the next test, give
   it a new TRIAL_EXPERIMENT key and set this to false. */
export const TRIAL_TEST_ENDED = true;
/** What Admin → A/B testing says beside the finished test's results. */
export const TRIAL_TEST_ENDED_NOTE = "Ended Oct 11, 2026 · everyone gets the 7-day trial";

export function trialOfferFor(value: unknown): TrialOffer {
  return !TRIAL_TEST_ENDED && value === "a" ? { variant: "a", days: 3 } : { ...LEGACY_TRIAL_OFFER };
}

/** Only previously validated, stored terms enter billing; no arbitrary client duration. */
export function storedTrialOffer(value?: TrialOffer | null): TrialOffer {
  return value?.variant === "a" && value.days === 3 ? trialOfferFor("a") : trialOfferFor("b");
}

export function trialOfferMetadata(offer?: TrialOffer | null): Record<string, string> {
  const terms = storedTrialOffer(offer);
  if (TRIAL_TEST_ENDED) return { trial_days: String(terms.days) };
  return { trial_days: String(terms.days), trial_variant: terms.variant,
    ...(offer ? { trial_experiment: TRIAL_EXPERIMENT } : {}) };
}
