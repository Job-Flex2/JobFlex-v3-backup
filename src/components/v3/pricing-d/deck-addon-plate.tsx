"use client";

// "ADD-ON · DECK STUDIO" — the plate under the plan cards, on /pricing and the landing's pricing section (owner,
// 2026-10-26): what the add-on is, its price on any plan, and the plans' own start button.
//
// The price is lib/deckAddon's — the one Stripe is charged with — never a literal here; the trial's days are the
// visitor's saved offer, as on every plan card. Framed like the cards (white on a 2px ink line, 2px corners) but flat:
// no offset behind the plate. The start button is the cards' own (.lp-pw-go), offset and all.

import { useTrialOffer } from "@/components/providers/trial-offer";
import { Reveal } from "@/components/v3/landing-e/reveal";
import { deckAddonCents } from "@/lib/deckAddon";
import "./pricing.css";

const WHAT = [
  ["3D deck design", "draw the deck and watch it build, board by board"],
  ["Framing from the span tables", "joists, beams and posts sized to the code tables"],
  ["Permit set", "the plan, framing and material sheets, ready to print"],
] as const;

export function DeckAddonPlate({ registerHref, cta = "pricing-deck", delay }: { registerHref: string; cta?: string; delay?: number }) {
  const { days } = useTrialOffer();
  const dollars = Math.round(deckAddonCents("MONTH") / 100);
  return (
    <Reveal delay={delay}>
      <div className="pr-deck p-6 sm:p-8" data-deck-addon-plate>
        <div className="grid grid-cols-1 gap-7 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-10">
          <div>
            <p className="lp-eyebrow text-lp-blue">Add-on · Deck Studio</p>
            <h3 className="mt-4 text-[clamp(22px,2.4vw,32px)] font-bold leading-[1.15] tracking-[-0.02em] text-[#0a0a0a]">
              ${dollars}/mo on any plan. Included in your {days}-day trial.
            </h3>
            <ul className="pr-deck-list">
              {WHAT.map(([k, v]) => (
                <li key={k}>
                  <svg className="pr-deck-ic" viewBox="0 0 24 24" aria-hidden>
                    <path d="M4 12.5l5 5L20 6.5" />
                  </svg>
                  <span>
                    <b>{k}</b> — {v}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-col justify-between gap-6 border-slate-900/10 lg:border-l lg:pl-10">
            <div>
              <p className="lp-pw-price text-[#0a0a0a]">
                ${dollars}
                <i>/mo</i>
              </p>
              <p className="pr-desc mt-3">
                Added to the plan you pick — ${Math.round(deckAddonCents("YEAR") / 100)}/yr on a yearly plan — and billed
                with it once the trial ends. Tick it on the plan step, or on Stripe&apos;s checkout page.
              </p>
            </div>
            <a href={registerHref} className="lp-pw-go" data-cta={cta} data-cta-button="plan-deck-addon">
              Start {days}-day free trial
            </a>
          </div>
        </div>
      </div>
    </Reveal>
  );
}
