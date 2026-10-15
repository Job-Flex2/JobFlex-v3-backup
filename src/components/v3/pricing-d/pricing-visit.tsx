"use client";

import { useEffect, useSyncExternalStore } from "react";
import { CtaTracker } from "@/components/v3/landing-e/cta-tracker";
import {
  pickFbclid,
  pickUtm,
  resolveLandingVariant,
  signupHref,
  type LandingVariantKey,
} from "@/components/v3/landing-e/landing-variants";
import { LOGIN, PRICING, REGISTER } from "@/components/v3/landing-e/routes";

/* /pricing is ISR (the plans are cached for an hour), so the server cannot
   read the query the landing's Pricing link sends here (owner, 2026-10-02:
   industry, utm_* and fbclid ride along). After paint this reads it once and
   hands it to every bare register and /pricing link on the page — the plan
   cards, the build-your-own button, the nav — through the landing's own
   signupHref, so a visitor who reads the prices first still starts the
   trial with the trade and the ad that brought them.

   Then it tracks `cta_click` (owner, 2026-10-15, in place of the trial
   badge that left every page): the plan cards' start buttons ("pricing",
   button plan-<slug>), the build-your-own button ("pricing-custom", button
   plan-custom), the nav's trial button ("nav", button nav-trial) and the
   nav's login links. The login links are tagged here, not in nav.tsx, so
   the landing — which tracks every tagged CTA — never counts a returning
   user's sign-in as a CTA click. The trade comes from that same query. */
const query = () => Object.fromEntries(new URLSearchParams(window.location.search));
const tradeOf = (params: Record<string, string>) => resolveLandingVariant(params.industry ?? params.trade);
// The query never changes without a navigation: nothing to subscribe to.
const still = () => () => {};

export function PricingVisit() {
  const industry = useSyncExternalStore<LandingVariantKey | undefined>(still, () => tradeOf(query()), () => undefined);

  useEffect(() => {
    const params = query();
    const opts = { industry: tradeOf(params), utm: pickUtm(params), fbclid: pickFbclid(params) };
    for (const base of [REGISTER, PRICING]) {
      const href = signupHref(base, opts);
      if (href === base) continue;
      document.querySelectorAll<HTMLAnchorElement>(`.jf-lp a[href="${base}"]`).forEach((a) => {
        a.setAttribute("href", href);
      });
    }
    document.querySelectorAll<HTMLAnchorElement>(`.jf-lp header a[href="${LOGIN}"]`).forEach((a) => {
      a.dataset.cta = "nav-login";
      a.dataset.ctaButton = "nav-login";
    });
  }, []);

  return <CtaTracker industry={industry} only={["pricing", "pricing-custom", "nav", "nav-login"]} />;
}
