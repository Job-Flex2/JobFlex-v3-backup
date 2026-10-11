"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";
import { LEGACY_TRIAL_OFFER, TRIAL_EXPERIMENT, TRIAL_TEST_ENDED, type TrialOffer } from "@/lib/trialOffer";
import { onTrafficReady, trackTrafficExperiment } from "@/lib/traffic-client";

const Context = createContext<TrialOffer>(LEGACY_TRIAL_OFFER);
export const useTrialOffer = () => useContext(Context);

/** Server terms render on the first paint; analytics observes, never assigns them.
 *  A finished test (TRIAL_TEST_ENDED) records no exposure. */
export function TrialOfferProvider({ offer, children, trackExposure = true }: { offer: TrialOffer; children: ReactNode; trackExposure?: boolean }) {
  useEffect(() => {
    if (trackExposure && !TRIAL_TEST_ENDED) return onTrafficReady(() => trackTrafficExperiment(TRIAL_EXPERIMENT, offer.variant));
  }, [offer.variant, trackExposure]);
  return <Context.Provider value={offer}>{children}</Context.Provider>;
}

/** Direct signup visits are exposed only when the plan step shows the offer. */
export function useTrialOfferExposure(visible: boolean) {
  const { variant } = useTrialOffer();
  useEffect(() => {
    if (visible && !TRIAL_TEST_ENDED) return onTrafficReady(() => trackTrafficExperiment(TRIAL_EXPERIMENT, variant));
  }, [visible, variant]);
}

export function TrialDurationLabel() {
  const { days } = useTrialOffer();
  return <>{days}-day free trial</>;
}

export function TrialStartLabel() {
  return <>Start <TrialDurationLabel /></>;
}
