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
            className={"jf-term-b" + (on ? " is-on" : "") + (badge ? " has-badge" : "")}
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
            <span className="jf-term-label">{t.label}</span>
            {badge ? (
              <>
                {/* The badge's own width, unpainted and not text: it widens the Annual
                    half so the badge starts 7px inside it and still ends ~10px past
                    the switch (plan-term-switch.css). */}
                <span className="jf-term-badge jf-term-badge-size" aria-hidden="true">
                  <Ghost text={badge} />
                </span>
                <span className="jf-term-badge" data-term-badge aria-hidden="true">
                  {badge}
                </span>
              </>
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

/** THE PRICE (2026-10-12): the price on the switch's term, alone on its line —
 *  the free months are the stamp in the card's head (PlanCardHead).
 *  `figureClassName` is the surface's own price class (`lp-pw-price`,
 *  `pw-price`, `jf-up-price`, `mu-price-row`); it carries `data-plan-price`. */
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
  const year = planTerm(term, yearlyCents) === "YEAR";
  return (
    <span className={`${figureClassName} jf-price`} data-plan-price>
      {figure(dealDollars(year ? (yearlyCents ?? 0) : monthlyCents), year ? "/yr" : "/mo")}
    </span>
  );
}

/** THE CARD'S HEAD (owner, 2026-10-12): the plan's name on the left and, on a
 *  year with whole free months, the filled "3 MONTHS FREE" stamp pressed to the
 *  card's right edge — the same place and the same line in every card of a
 *  row. On a month the stamp keeps its box, unpainted and not text (Ghost), so
 *  the head is one height on either side of the switch; a plan whose year is
 *  not whole months has no stamp. When the name and the stamp do not fit on
 *  one line (a phone), the stamp drops under the name, on the left. `name` is
 *  the surface's own name element; `aside` is anything else that lives at the
 *  head's right (the phone's "Most picked" / "Current" tags). */
export function PlanCardHead({
  term,
  monthlyCents,
  yearlyCents,
  name,
  aside = null,
  className = "",
}: {
  term: BillingTerm;
  monthlyCents: number;
  yearlyCents: number | null | undefined;
  name: ReactNode;
  aside?: ReactNode;
  className?: string;
}) {
  const stamp = yearlyCents ? dealWords(annualDeal(monthlyCents, yearlyCents)) : "";
  const on = planTerm(term, yearlyCents) === "YEAR";
  return (
    <div className={"jf-card-head" + (className ? ` ${className}` : "")} data-plan-head>
      {name}
      {stamp || aside ? (
        <span className="jf-card-head-r">
          {stamp ? (
            on ? (
              <span className="jf-stamp" data-plan-stamp>
                {stamp}
              </span>
            ) : (
              <span className="jf-stamp is-off" aria-hidden="true">
                <Ghost text={stamp} />
              </span>
            )
          ) : null}
          {aside}
        </span>
      ) : null}
    </div>
  );
}

/** The deal line straight under a card's price, the same on every plan surface
 *  — ONE line of one height (owner, 2026-10-12): on a year "You save $135 a
 *  year", green, bold, 15px (the free months are the stamp in the card's head,
 *  PlanCardHead); "Billed yearly" for a year that saves nothing; a quiet
 *  "Billed monthly" on a month or for a plan with no yearly price. */
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
