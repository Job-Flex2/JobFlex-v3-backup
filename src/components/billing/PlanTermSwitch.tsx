"use client";

// THE ONE BILLING SWITCH (owner, 2026-10-12): Monthly | Annual over a row of
// plan cards — the landing, /pricing, the signup plan step and the upgrade page
// (desk and phone). It replaces the per-card "Monthly $…/mo · Annual $…/yr"
// buttons. A radio group: the arrow keys move the choice, only the chosen half
// is in the tab order, and each half is a 44px target on a phone. The tag on
// "Annual" is the deal every yearly plan shares ("2 months free",
// lib/planDeal sharedDealWords) — none when they differ. A surface with no
// yearly price draws no switch at all (the caller decides, lib/planDeal
// offersYearly). Styles: plan-term-switch.css, self-scoped, tokens with
// fallbacks so it reads the same inside the landing's `.jf-lp` and the app.

import { useRef } from "react";
import { annualDeal, dealWords, planTerm, savedWords, type BillingTerm } from "@/lib/planDeal";
import "./plan-term-switch.css";

const TERMS: { term: BillingTerm; label: string }[] = [
  { term: "MONTH", label: "Monthly" },
  { term: "YEAR", label: "Annual" },
];

export function PlanTermSwitch({
  value,
  onChange,
  tag = "",
  tone = "paper",
  className = "",
}: {
  value: BillingTerm;
  onChange: (term: BillingTerm) => void;
  /** "2 months free" on the Annual half, or "" for none. */
  tag?: string;
  /** "ink" on the landing's dark pricing band. */
  tone?: "paper" | "ink";
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const pick = (i: number) => {
    const t = TERMS[(i + TERMS.length) % TERMS.length];
    onChange(t.term);
    refs.current[TERMS.indexOf(t)]?.focus();
  };
  return (
    <div
      className={"jf-term" + (tone === "ink" ? " jf-term--ink" : "") + (className ? ` ${className}` : "")}
      role="radiogroup"
      aria-label="Billing period"
      data-plan-term={value}
    >
      {TERMS.map((t, i) => {
        const on = value === t.term;
        return (
          <button
            key={t.term}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            className={"jf-term-b" + (on ? " is-on" : "")}
            data-term={t.term}
            onClick={() => onChange(t.term)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                e.preventDefault();
                pick(i + 1);
              } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                e.preventDefault();
                pick(i - 1);
              } else if (e.key === "Home") {
                e.preventDefault();
                pick(0);
              } else if (e.key === "End") {
                e.preventDefault();
                pick(TERMS.length - 1);
              }
            }}
          >
            {t.label}
            {t.term === "YEAR" && tag ? <i className="jf-term-tag">{tag}</i> : null}
          </button>
        );
      })}
    </div>
  );
}

/** The deal line under a card's price, the same on every plan surface — ONE
 *  line (owner, 2026-10-12): "2 months free · You save $90" on a year (the
 *  months only when they are whole, the saving in green), "You save $N"
 *  alone otherwise, "Billed yearly" for a year with no saving, and a quiet
 *  "Billed monthly" on a month or for a plan with no yearly price. Always
 *  drawn and one line high (plan-term-switch.css), so the switch moves nothing. */
export function PlanDealSlot({
  term,
  monthlyCents,
  yearlyCents,
}: {
  term: BillingTerm;
  monthlyCents: number;
  yearlyCents: number | null | undefined;
}) {
  const billed = planTerm(term, yearlyCents);
  const deal = billed === "YEAR" ? annualDeal(monthlyCents, yearlyCents) : null;
  const stamp = dealWords(deal);
  return (
    <span className="jf-deal" data-plan-deal={billed}>
      {billed === "MONTH" ? (
        <span className="jf-deal-billed">Billed monthly</span>
      ) : deal ? (
        <>
          {stamp ? (
            <>
              <span className="jf-deal-months">{stamp}</span>
              <span className="jf-deal-dot" aria-hidden="true">
                {" · "}
              </span>
            </>
          ) : null}
          <span className="jf-deal-save">{savedWords(deal)}</span>
        </>
      ) : (
        <span className="jf-deal-billed">Billed yearly</span>
      )}
    </span>
  );
}

/* THE CHOICE, KEPT FOR THIS TAB (sessionStorage): the signup plan step reopens
   on it after the Google return, the emailed code or a cancelled Checkout.
   Storage can be blocked (a private window): then the link alone decides. */
const TERM_KEY = "jf_billing_term";
export function rememberBillingTerm(term: BillingTerm): void {
  try {
    sessionStorage.setItem(TERM_KEY, term);
  } catch {
    /* storage blocked */
  }
}
export function recalledBillingTerm(): BillingTerm | null {
  try {
    const v = sessionStorage.getItem(TERM_KEY);
    return v === "YEAR" || v === "MONTH" ? v : null;
  } catch {
    return null;
  }
}
