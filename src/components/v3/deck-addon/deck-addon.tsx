"use client";

// THE DECK STUDIO'S PREVIEW, ON SCREEN. The Deck estimator comes with every paid plan (owner, 2026-10-21; before that
// a $45/mo add-on — actions/deckAddon and lib/deckAddonBilling still read an older line left on a subscription).
// What an account WITHOUT a running plan sees in the studio — two pieces, one answer: pick a plan.
//   · DeckAddonDialog — what a plan adds to the preview, and the way to Subscription;
//   · DeckPreviewBanner — the studio's band while it is a preview, and the trial's one line.

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { Check } from "lucide-react";
import { deckTrialWords, type AddonInterval } from "@/lib/deckAddon";
import s from "./deck-addon.module.css";

const UNLOCKS = [
  "Drafts that save as you go, and open again from any device",
  "The proposal straight from the design — and updated when the design changes",
  "The client's design link, to shape the deck with you",
  "Material lists for the yard and the installer, and the permit sheet",
];

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric" }) : null);

const PLANS_HREF = "/dashboard/subscription" as Route;

export function DeckAddonDialog({ open, onClose, why }: { open: boolean; onClose: () => void; why?: string | null; onAdded?: () => void }) {
  const ref = React.useRef<HTMLDialogElement>(null);
  React.useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className={`${s.da} ${s.dialog}`} onClose={onClose} aria-labelledby="deck-addon-title" data-deck-addon-dialog>
      <div className={s.body}>
        <div className={s.kicker}>Deck Studio · every plan</div>
        <h2 className={s.title} id="deck-addon-title">{why ?? "Deck Studio comes with your plan"}</h2>
        <p className={s.lead}>The preview designs anything — the deck in 3D, checked to code, priced. A plan adds the rest:</p>
        <ul className={s.list}>
          {UNLOCKS.map((u) => (
            <li key={u}>
              <Check className={s.tick} strokeWidth={3} aria-hidden="true" />
              <span>{u}</span>
            </li>
          ))}
        </ul>
        <p className={s.note}>Every plan has the Deck estimator, with the plan&apos;s monthly uses. On a Custom plan, add the Deck estimator page.</p>
        <div className={s.acts}>
          <Link className={`${s.btn} ${s.btnPrimary}`} href={PLANS_HREF} data-deck-choose-plan>
            Choose a plan
          </Link>
          <button type="button" className={s.btn} onClick={onClose}>
            Not now
          </button>
        </div>
      </div>
    </dialog>
  );
}

/** The studio's band while it is a preview (a saved deck: to look at and print); while the trial holds it, one line
 *  about after the trial. */
export function DeckPreviewBanner({ mode, trialEndsAt, interval = "MONTH", saved = false, onAdd, children }: { mode: "preview" | "trial"; trialEndsAt?: string | null; interval?: AddonInterval; saved?: boolean; onAdd?: () => void; children?: React.ReactNode }) {
  if (mode === "trial") {
    const until = day(trialEndsAt ?? null);
    return (
      <p className={`${s.da} ${s.trialLine}`} data-deck-trial-line>
        <span>
          {deckTrialWords(interval)}
          {until ? ` Your trial runs until ${until}.` : ""}
        </span>
      </p>
    );
  }
  return (
    <div className={`${s.da} ${s.banner}`} role="note" data-deck-preview={saved ? "saved" : "design"}>
      <div className={s.bannerText}>
        <span className={s.stamp}>{saved ? "View only" : "Preview"}</span>
        {saved ? (
          <>
            A saved deck, to look at and print. <b>Changing it takes a plan.</b>
          </>
        ) : (
          <>
            Design anything here — the deck in 3D, checked to code, priced. <b>Saving, sending and printing come with a plan.</b>
          </>
        )}
      </div>
      {onAdd ? (
        <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={onAdd} data-deck-preview-add>
          Choose a plan
        </button>
      ) : (
        <Link className={`${s.btn} ${s.btnPrimary}`} href={PLANS_HREF} data-deck-preview-add>
          Choose a plan
        </Link>
      )}
      {/* A saved deck's prints: from the saved copy, open in the preview too. */}
      {children ? <div className={s.prints}>{children}</div> : null}
    </div>
  );
}
