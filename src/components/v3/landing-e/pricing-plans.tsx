"use client";

import { useTrialOffer } from "@/components/providers/trial-offer";
import { useEffect, useRef, useState } from "react";
import { expandPlanFeatures, formatPlanPrice, priceCadence, type PlanDTO } from "@/lib/planCatalog";
import { annualDeal, dealWords } from "@/lib/planDeal";
import "./pricing-faq.css";

/* THE REGISTER'S PLAN CARDS ON THE LANDING (owner, 2026-09-26). A port of
   step 3 of signup ("Pick a plan.", auth-register-blueprint/register-content
   + auth-register.module.css `.pw-*`) as `lp-pw-*` in pricing-faq.css: mono
   plan name, 44px price, ONE shared feature list — ink tick where the plan
   has it, grey dash where it does not — and the card's own full-width start
   button. Everything is read from the live catalogue (getPlanCatalog on the
   server): expandPlanFeatures gives the shared rows and what each plan
   includes, formatPlanPrice the price. Every button starts the visitor’s assigned
   trial (lib/trialOffer), whatever the catalogue row's own days.
   The register reads no `plan` param, so every button is the register link.

   On a phone (≤768px) the row is the register's swipe carousel: cards
   min(84vw, 340px), snap centre, the MOST-PICKED card centred on arrival,
   lists cut to six whole rows with "Show all N", and square dots under it. */
const PHONE = "(max-width: 768px)";
const CUT = 6;

function Check() {
  return (
    <svg className="lp-pw-ic" viewBox="0 0 24 24" aria-hidden>
      <path d="M4 12.5l5 5L20 6.5" />
    </svg>
  );
}
function Minus() {
  return (
    <svg className="lp-pw-ic" viewBox="0 0 24 24" aria-hidden>
      <path d="M6 12h12" />
    </svg>
  );
}

export function PricingPlans({
  plans,
  registerHref,
}: {
  plans: PlanDTO[];
  registerHref: string;
}) {
  const { days } = useTrialOffer();
  const { rows, included } = expandPlanFeatures(plans);
  const heroIndex = Math.max(0, plans.findIndex((p) => p.highlight));
  const railRef = useRef<HTMLDivElement>(null);
  const touched = useRef(false);
  const [active, setActive] = useState(heroIndex);
  const [open, setOpen] = useState<Set<string>>(() => new Set());

  const toggle = (slug: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });

  /* The rail is `position: relative` (pricing-faq.css), so a card's
     offsetLeft is measured from the rail itself, in its scroll space. */
  const cardLeft = (rail: HTMLElement, i: number) => {
    const card = rail.children[i] as HTMLElement | undefined;
    if (!card) return 0;
    return Math.max(0, card.offsetLeft - (rail.clientWidth - card.offsetWidth) / 2);
  };

  /* ARRIVE ON THE MOST-PICKED CARD, CENTRED (owner, 2026-09-26) — the
     register does the same. One pass on mount was not enough: the section
     sits under content-visibility:auto and fades in, and a page first laid
     out wide (a desk window narrowed to phone size, a turned tablet) had
     already spent its one pass, so the rail opened on the first card. It is
     set again whenever the rail gets a size, comes into view or turns into
     a carousel, each time with two follow-ups while the fade settles (the
     register's 120/520 ms), until the visitor touches, scrolls or tabs into
     it — after that it is theirs. */
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const phone = window.matchMedia(PHONE);
    const timers: number[] = [];
    const settle = () => {
      if (touched.current || !phone.matches || !rail.clientWidth) return;
      const left = cardLeft(rail, heroIndex);
      if (Math.abs(rail.scrollLeft - left) > 1) rail.scrollLeft = left;
    };
    const settleSoon = () => {
      settle();
      timers.push(window.setTimeout(settle, 120), window.setTimeout(settle, 520));
    };
    /* Only a hand on the carousel counts: not a click on the desk grid, and
       not a vertical wheel that is scrolling the page past it. */
    const mark = (e: Event) => {
      if (!phone.matches) return;
      if (e instanceof WheelEvent && !e.shiftKey && Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      touched.current = true;
    };
    settleSoon();
    const ro = new ResizeObserver(() => settle());
    ro.observe(rail);
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) settleSoon();
      },
      { rootMargin: "0px 0px 400px 0px" },
    );
    io.observe(rail);
    phone.addEventListener("change", settleSoon);
    const MARKS = ["pointerdown", "touchstart", "wheel", "keydown", "focusin"] as const;
    for (const ev of MARKS) rail.addEventListener(ev, mark, { passive: true });
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const mid = rail.scrollLeft + rail.clientWidth / 2;
        let best = 0;
        let bestD = Infinity;
        Array.from(rail.children).forEach((el, i) => {
          const c = el as HTMLElement;
          const d = Math.abs(c.offsetLeft + c.offsetWidth / 2 - mid);
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        });
        setActive(best);
      });
    };
    rail.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      io.disconnect();
      ro.disconnect();
      timers.forEach(clearTimeout);
      cancelAnimationFrame(frame);
      phone.removeEventListener("change", settleSoon);
      for (const ev of MARKS) rail.removeEventListener(ev, mark);
      rail.removeEventListener("scroll", onScroll);
    };
  }, [heroIndex]);

  const goTo = (i: number) => {
    const rail = railRef.current;
    if (!rail) return;
    touched.current = true;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    rail.scrollTo({ left: cardLeft(rail, i), behavior: reduce ? "auto" : "smooth" });
  };

  return (
    <>
      <div className="lp-pw-plans" ref={railRef}>
        {plans.map((p) => {
          const has = included.get(p.slug) ?? new Set<string>();
          const isOpen = open.has(p.slug);
          const listId = `lp-pw-feats-${p.slug}`;
          return (
            <article key={p.slug} className={"lp-pw-plan" + (p.highlight ? " lp-pw-plan--hero" : "")}>
              {p.highlight ? <span className="lp-pw-tag">Most picked</span> : null}
              <h3 className="lp-pw-plan-n">{p.name}</h3>
              <p className="lp-pw-price">
                {formatPlanPrice(p.priceCents)}
                <i>{priceCadence(true)}</i>
              </p>
              {/* The year's price as the trade reads it (owner, 2026-10-11): months free, never a percentage. */}
              {p.yearlyPriceCents && annualDeal(p.priceCents, p.yearlyPriceCents) ? (
                <p className="lp-pw-annual" data-plan-annual={p.slug}>
                  or {formatPlanPrice(p.yearlyPriceCents)}/yr — {dealWords(annualDeal(p.priceCents, p.yearlyPriceCents))}
                </p>
              ) : null}
              <ul id={listId} className={"lp-pw-feats" + (isOpen ? " is-open" : "")}>
                {rows.map((f) => {
                  const on = has.has(f.toLowerCase());
                  return (
                    <li key={f} className={on ? "lp-pw-f" : "lp-pw-f lp-pw-f--no"}>
                      {on ? <Check /> : <Minus />}
                      <span className="sr-only">{on ? "Included: " : "Not included: "}</span>
                      {f}
                    </li>
                  );
                })}
              </ul>
              {rows.length > CUT ? (
                <button
                  type="button"
                  className="lp-pw-more"
                  aria-expanded={isOpen}
                  aria-controls={listId}
                  onClick={() => toggle(p.slug)}
                >
                  {isOpen ? "Show less" : `Show all ${rows.length}`}
                </button>
              ) : null}
              <a href={registerHref} className="lp-pw-go" data-cta="pricing">
                Start {days}-day free trial
                <span className="sr-only"> on {p.name}</span>
              </a>
            </article>
          );
        })}
      </div>
      {plans.length > 1 ? (
        <div className="lp-pw-dots">
          {plans.map((p, i) => (
            <button
              key={p.slug}
              type="button"
              className="lp-pw-dot"
              aria-label={`Show the ${p.name} plan`}
              aria-current={i === active ? "true" : undefined}
              onClick={() => goTo(i)}
            >
              <span aria-hidden />
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}
