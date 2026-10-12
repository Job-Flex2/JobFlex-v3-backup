"use client";

// THE ONE BILLING SWITCH (owner, 2026-10-12): Monthly | Annual over a row of
// plan cards — the landing, /pricing, the signup plan step and the upgrade page
// (desk and phone). It replaces the per-card "Monthly $…/mo · Annual $…/yr"
// buttons. A radio group: the arrow keys move the choice, only the chosen half
// is in the tab order, and each half is a 44px target on a phone. The badge on
// "Annual" is always shown, on either side of the switch (owner, 2026-10-12):
// the free months the yearly plans give ("2–3 months free"), or "Save up to $N"
// when none is whole months (lib/planDeal sharedDealWords). A surface with no
// yearly price draws no switch at all (the caller decides, lib/planDeal
// offersYearly). Styles: plan-term-switch.css, self-scoped, tokens with
// fallbacks so it reads the same inside the landing's `.jf-lp` and the app.

import { useRef, type ReactNode } from "react";
import { annualDeal, dealDollars, dealWords, planTerm, savedYearWords, type BillingTerm } from "@/lib/planDeal";
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
  /** The badge on the Annual half — "2–3 months free" — or "" for none. */
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
      className={"jf-term" + (tone === "ink" ? " jf-term--ink" : "") + (tag ? " has-badge" : "") + (className ? ` ${className}` : "")}
      role="radiogroup"
      aria-label="Billing period"
      data-plan-term={value}
    >
      {TERMS.map((t, i) => {
        const on = value === t.term;
        const badge = t.term === "YEAR" && tag ? tag : "";
        return (
          <button
            key={t.term}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={badge ? `${t.label}, ${badge}` : undefined}
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
            {badge ? (
              <span className="jf-term-badge" data-term-badge aria-hidden="true">
                {badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** The price figure in a card's own type — the number and its unit — as each
 *  surface draws it (`<>{num}<i>{per}</i></>`, the phone's `<b>…</b><i>…</i>`). */
type PriceFigure = (num: ReactNode, per: ReactNode) => ReactNode;

/** Text drawn by CSS from an attribute (plan-term-switch.css): it sizes its
 *  box and paints, but is in neither the page's text nor its reading order. */
function Ghost({ text }: { text: string }) {
  return <span className="jf-ghost-t" data-c={text} />;
}

/** THE PRICE ROW (owner, 2026-10-12): the price, and on a year with whole free
 *  months the filled "3 MONTHS FREE" stamp beside it — under it when the card
 *  is too narrow for both (flex-wrap). The other term's price is laid in the
 *  same cell, unpainted, and the stamp keeps its box on a month, unpainted, so
 *  the row has one size whichever way the switch stands: no card grows or
 *  shrinks on the switch and the rows of a row stay on one line. Neither the
 *  unpainted price nor the unpainted stamp is text on the page (Ghost), so on
 *  Monthly a card says nothing about the year. `figureClassName` is the
 *  surface's own price class (`lp-pw-price`, `pw-price`, `jf-up-price`,
 *  `mu-price-row`); the shown figure carries `data-plan-price`. */
export function PlanPrice({
  term,
  monthlyCents,
  yearlyCents,
  figureClassName,
  figure = (num, per) => (
    <>
      {num}
      <i>{per}</i>
    </>
  ),
}: {
  term: BillingTerm;
  monthlyCents: number;
  yearlyCents: number | null | undefined;
  figureClassName: string;
  figure?: PriceFigure;
}) {
  const billed = planTerm(term, yearlyCents);
  const deal = yearlyCents ? annualDeal(monthlyCents, yearlyCents) : null;
  const stamp = dealWords(deal);
  const shown = billed === "YEAR" ? { c: yearlyCents ?? 0, per: "/yr" } : { c: monthlyCents, per: "/mo" };
  const other = billed === "YEAR" ? { c: monthlyCents, per: "/mo" } : yearlyCents ? { c: yearlyCents, per: "/yr" } : null;
  return (
    <span className="jf-price" data-plan-price-row>
      <span className="jf-price-fig">
        <span className={`${figureClassName} jf-price-now`} data-plan-price>
          {figure(dealDollars(shown.c), shown.per)}
        </span>
        {other ? (
          <span className={`${figureClassName} jf-price-ghost`} aria-hidden="true">
            {figure(<Ghost text={dealDollars(other.c)} />, <Ghost text={other.per} />)}
          </span>
        ) : null}
      </span>
      {stamp ? (
        billed === "YEAR" ? (
          <span className="jf-price-stamp" data-plan-stamp>
            {stamp}
          </span>
        ) : (
          <span className="jf-price-stamp is-off" aria-hidden="true">
            <Ghost text={stamp} />
          </span>
        )
      ) : null}
    </span>
  );
}

/** The deal line under a card's price, the same on every plan surface — ONE
 *  line of one height (owner, 2026-10-12): on a year "You save $135 a year",
 *  green, bold, 15px (the free months are the stamp beside the price,
 *  PlanPrice); "Billed yearly" for a year that saves nothing; a quiet "Billed
 *  monthly" on a month or for a plan with no yearly price. */
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
  return (
    <span className="jf-deal" data-plan-deal={billed}>
      {billed === "MONTH" ? (
        <span className="jf-deal-billed">Billed monthly</span>
      ) : deal ? (
        <span className="jf-deal-save">{savedYearWords(deal)}</span>
      ) : (
        <span className="jf-deal-billed">Billed yearly</span>
      )}
    </span>
  );
}

/** " — 3 months free" for the signup's "Free until Oct 19, then $405/yr" line on a
 *  year with whole free months, else "". */
export function planWhenDeal(term: BillingTerm, monthlyCents: number, yearlyCents: number | null | undefined): string {
  if (planTerm(term, yearlyCents) !== "YEAR") return "";
  const words = dealWords(annualDeal(monthlyCents, yearlyCents));
  return words ? ` — ${words}` : "";
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
