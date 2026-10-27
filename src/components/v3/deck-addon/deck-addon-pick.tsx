"use client";

// "ADD DECK STUDIO" BESIDE THE PLAN CARDS (owner, 2026-10-26) — its own file, apart from ./deck-addon: the sign-up's
// plan step draws it, and that page loads no server action, no toast and nothing else it does not draw.

import * as React from "react";
import { Check } from "lucide-react";
import { DECK_PICK_TRIAL_WORDS, deckAddonShortWords, type AddonInterval, type DeckAddonPick } from "@/lib/deckAddon";
import s from "./deck-addon.module.css";

/** "ADD DECK STUDIO" BESIDE THE PLAN CARDS (owner, 2026-10-26) — the sign-up's plan step, Plans & upgrade and the
 *  Subscription page's cards. Off until ticked; ticked, the plan goes to Stripe (or changes in place) with the add-on
 *  on it. In a trial it says it is included and billed after. Held already: what the shop pays for it, at the price
 *  its line was bought at; open without it (a complimentary plan, the Custom plan's page): nothing is drawn. */
export function DeckAddonPickBox({
  checked,
  onChange,
  pick,
  interval = "MONTH",
  disabled = false,
  className,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  /** What the picker shows (lib/deckAddonBilling deckAddonPick); null while it is read, then nothing is drawn. */
  pick: DeckAddonPick | null;
  /** The term the plans are shown on: the add-on is billed on the plan's. */
  interval?: AddonInterval;
  disabled?: boolean;
  className?: string;
}) {
  const id = React.useId();
  if (!pick || pick.included) return null;
  // On the plan, at its own price. A change of term takes it off (lib/planChange): then it is offered again.
  if (pick.held && pick.held.interval === interval) {
    return (
      <p className={`${s.da} ${s.pickHeld}${className ? ` ${className}` : ""}`} data-deck-pick="held">
        <Check className={s.tick} strokeWidth={3} aria-hidden="true" />
        <span>
          <b>Deck Studio · {pick.held.words}</b> stays on your plan when you change plans.
        </span>
      </p>
    );
  }
  return (
    <label className={`${s.da} ${s.pick}${checked ? ` ${s.pickOn}` : ""}${className ? ` ${className}` : ""}`} htmlFor={id} data-deck-pick={checked ? "on" : "off"}>
      <input id={id} type="checkbox" className={s.pickBox} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} data-deck-pick-box />
      <span className={s.pickText}>
        <span className={s.pickTitle}>Add Deck Studio · +{deckAddonShortWords(interval)}</span>
        <span className={s.pickNote}>
          {pick.trialing ? DECK_PICK_TRIAL_WORDS : pick.held ? "A change of term takes your add-on off — tick it to keep Deck Studio on the new term." : "3D deck design, framing from the span tables, the permit set."}
        </span>
      </span>
    </label>
  );
}
