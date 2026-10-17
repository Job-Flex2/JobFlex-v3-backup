"use client";

import { TrialStartLabel } from "@/components/providers/trial-offer";
import { Logo } from "./logo";
import { LOGIN, PRICING, REGISTER } from "./routes";
import Link from "next/link";

/* One text link in the bar: Pricing, back in (owner, 2026-10-02 — it came
   out on 2026-09-26), to the /pricing page on a desk and a phone alike. Its
   href carries the visit's industry, utm_* and fbclid like every register
   link (signupHref), so the prices page can hand them on to its own start
   buttons. Product, Features and Resources never had pages. */

export function Nav({
  registerHref = REGISTER,
  pricingHref = PRICING,
  cta,
}: {
  registerHref?: string;
  pricingHref?: string;
  cta?: string;
}) {
  return (
    // Sticky on desktop only (owner, 2026-08-25): on a phone a pinned bar
    // eats a chunk of a short viewport for a two-item nav. The bar sits on the
    // same ink ground the hero paints, so pinned or not it reads as one field.
    <header className="lp-nav relative z-50 lg:sticky lg:top-0">
      {/* 80 / 64px (owner, 2026-09-20): the bar was 94 / 72 and took more of
          the fold than a five-item row needs. The mark is 67px tall at lg,
          which is what sets 80px as the floor. `scroll-padding-top` in
          landing-e.css follows this number — move them together. */}
      <div className="mx-auto flex h-[64px] max-w-[86rem] items-center justify-between px-5 sm:px-6 lg:h-[80px]">
        <Link href="/" aria-label="JobFlex home">
          <Logo className="lp-brand--lg" />
        </Link>

        <div className="hidden items-center gap-6 lg:flex">
          <a href={pricingHref} className="text-[15px] font-medium text-black/70 transition-colors hover:text-black">
            Pricing
          </a>
          <a href={LOGIN} className="text-[15px] font-medium text-black/70 transition-colors hover:text-black">
            Sign in
          </a>
          {/* No note under this one (owner, 2026-09-10): the bar stays a bar.
              The trial line lives under the hero pair. */}
          <a href={registerHref} className="lp-btn-dark lp-trial-cta" data-cta="nav" data-cta-button="nav-trial">
            {cta ?? <TrialStartLabel />}
          </a>
        </div>

        {/* Handheld: the menu drawer is gone and the bar carries the action a
            visitor on a phone actually wants (owner, 2026-08-25), with Pricing
            beside it as a 44 px text link (2026-10-02). The wrapper
            does the hiding — `.jf-lp .lp-btn-dark` sets display and would
            outrank a `lg:hidden` sitting on the anchor itself. */}
        <div className="flex items-center gap-2 lg:hidden">
          <a
            href={pricingHref}
            className="inline-flex min-h-[44px] items-center px-3 text-[14.5px] font-medium text-black/70 transition-colors hover:text-black"
           
          >
            Pricing
          </a>
          <a href={LOGIN} className="lp-btn-dark h-10 px-5 text-[14.5px] font-semibold">
            Log in
          </a>
        </div>
      </div>
    </header>
  );
}
