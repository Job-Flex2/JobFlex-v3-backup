"use client";

// MOBILE HOMEOWNER — section 3, "How it works": four cards, four live
// vignettes.
//
// Re-laid-out rather than reused. The desktop `homeowner-vignettes.tsx` is a
// 4-across grid that folds to 2×2 at ≤700px and then rescues the overflow with
// `transform: scale(.658)` on the vignette interior — which renders the 7.5px
// mono annotations at 4.9px, below anything readable in daylight. Here the
// cards stack full width and every vignette draws at 1:1.
//
// It also mints five bare document-global ids (`steps`, `vType`, `vChips`,
// `vRows`, `vNote`) that nothing has queried since the React port. Only the
// one the IntersectionObserver actually needs survives, namespaced
// `jfmh-steps`; the other four are gone.
//
// The LOOPS are the desktop module's, tick for tick — 55ms typing with a
// 26-tick pause on the finished line, 1700ms chip advance, 180ms-staggered
// scope rows on a 4200ms cycle with a 350ms gap, and a notification that drops
// every 4600ms and returns 500ms later. All four start together, once, when
// the section crosses 15% of the viewport, and every one of them is a no-op
// under `prefers-reduced-motion` with its final state rendered instead. Each
// vignette owns its own state so the 18-updates-per-second typing loop cannot
// re-render the wizard sitting above it.

import { useEffect, useState } from "react";
import { useInViewOnce, useReducedMotion } from "../homeowner-landing/use-homeowner-behavior";
import { storySteps } from "../homeowner-landing/homeowner-story";

// THE STORY (2026-10-28, ./homeowner-story — "one homeowner portal"): one roof, told the way the portal works now —
// the words, the price for the house, a JobFlex pro takes it, the proposal. The figures are an illustration.
const TYPE_TEXT = "My roof is 15 years old and leaking around the chimney…";
const V_CHIPS = ["Architectural", "Metal", "Impact-resistant"];
const V_PRICES = ["$13,100–$16,800", "$22,900–$29,400", "$15,600–$20,000"];
const V_ROWS = ["Proposal · 14 line items · $14,860", "Accepted online · in your dashboard"];

/* vignette 1 — typing */
function VType({ started }: { started: boolean }) {
  const reduced = useReducedMotion();
  const [n, setN] = useState(0);

  useEffect(() => {
    if (!started || reduced) return;
    const id = window.setInterval(() => {
      setN((v) => (v >= TYPE_TEXT.length + 26 ? 0 : v + 1));
    }, 55);
    return () => window.clearInterval(id);
  }, [started, reduced]);

  const text = started && reduced ? TYPE_TEXT : TYPE_TEXT.slice(0, Math.min(n, TYPE_TEXT.length));
  return <span>{text}</span>;
}

/* vignette 2 — the price: the roof's range for the house, re-priced as the material changes. Advances every 1700ms;
   under reduced motion the first material stays, priced. */
function VPrice({ started }: { started: boolean }) {
  const reduced = useReducedMotion();
  const [sel, setSel] = useState(0);

  useEffect(() => {
    if (!started || reduced) return;
    const id = window.setInterval(() => setSel((s) => (s + 1) % V_CHIPS.length), 1700);
    return () => window.clearInterval(id);
  }, [started, reduced]);

  return (
    <>
      <div className="v-price">{V_PRICES[sel]}</div>
      <div className="v-chips">
        {V_CHIPS.map((label, i) => (
          <span key={label} className={i === sel ? "v-chip on" : "v-chip"}>
            {label}
          </span>
        ))}
      </div>
    </>
  );
}

/* vignette 4 — the proposal: the rows arrive, accepted online */
function VRows({ started }: { started: boolean }) {
  const reduced = useReducedMotion();
  const [on, setOn] = useState<boolean[]>(() => V_ROWS.map(() => false));

  useEffect(() => {
    if (!started || reduced) return;

    const timers = new Set<number>();
    const later = (fn: () => void, ms: number) => {
      const id = window.setTimeout(() => {
        timers.delete(id);
        fn();
      }, ms);
      timers.add(id);
    };
    const rowsOn = (value: boolean) => {
      V_ROWS.forEach((_, i) => {
        later(
          () =>
            setOn((prev) => {
              const next = prev.slice();
              next[i] = value;
              return next;
            }),
          value ? i * 180 : 0
        );
      });
    };

    rowsOn(true);
    const cycle = window.setInterval(() => {
      rowsOn(false);
      later(() => rowsOn(true), 350);
    }, 4200);

    return () => {
      window.clearInterval(cycle);
      timers.forEach((id) => window.clearTimeout(id));
      timers.clear();
    };
  }, [started, reduced]);

  const shown = reduced ? V_ROWS.map(() => started) : on;

  return (
    <div className="v-rows">
      {V_ROWS.map((label, i) => (
        <div key={label} className={shown[i] ? "v-row on" : "v-row"}>
          <i>✓</i>
          {label}
        </div>
      ))}
    </div>
  );
}

/* vignette 3 — the match: "You're matched", as the email and text say */
function VNote({ started }: { started: boolean }) {
  const reduced = useReducedMotion();
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!started || reduced) return;
    let back = 0;
    const id = window.setInterval(() => {
      setHidden(true);
      back = window.setTimeout(() => setHidden(false), 500);
    }, 4600);
    return () => {
      window.clearInterval(id);
      if (back) window.clearTimeout(back);
    };
  }, [started, reduced]);

  const on = started && !hidden;

  return (
    <div className={on ? "v-note on" : "v-note"}>
      <span className="v-mark">JF</span>
      <div className="v-nbody">
        <div className="v-nt">
          <b>JobFlex</b>
          <span>now</span>
        </div>
        <p className="v-nb">
          You’re matched! <em>Reyes &amp; Sons</em> will contact you about your roof.
        </p>
      </div>
    </div>
  );
}

export function MobileStepsGrid({
  className,
  gridRef,
  house = false,
}: {
  className: string;
  gridRef: (el: Element | null) => void;
  /** The house estimators on: step 02 names every estimator, not the roof alone (./homeowner-story). */
  house?: boolean;
}) {
  const run = useInViewOnce("jfmh-steps", 0.15);
  const [s1, s2, s3, s4] = storySteps(house);

  return (
    <div className={className} id="jfmh-steps" ref={gridRef}>
      <div className="st">
        <div className="vig">
          <div className="vig-in">
            <div className="v-type">
              <div className="v-l">Your project</div>
              <p className="v-p">
                <VType started={run} />
                <span className="v-caret"></span>
              </p>
            </div>
          </div>
        </div>
        <div className="st-n">{s1.n}</div>
        <div className="st-t">{s1.title}</div>
        <p className="st-b">{s1.body}</p>
      </div>

      <div className="st">
        <div className="vig">
          <div className="vig-in">
            <div className="v-q">
              <div className="v-qt">Your roof · priced from the sky</div>
              <VPrice started={run} />
            </div>
          </div>
        </div>
        <div className="st-n">{s2.n}</div>
        <div className="st-t">{s2.title}</div>
        <p className="st-b">{s2.body}</p>
      </div>

      <div className="st">
        <div className="vig">
          <div className="vig-in">
            <div className="v-back"></div>
            <VNote started={run} />
          </div>
        </div>
        <div className="st-n">{s3.n}</div>
        <div className="st-t">{s3.title}</div>
        <p className="st-b">{s3.body}</p>
      </div>

      <div className="st">
        <div className="vig">
          <div className="vig-in">
            <div className="v-s">
              <p className="v-raw">Site visit · the details confirmed</p>
              <svg className="ic v-arrow">
                <use href="#jfmh-i-chev" />
              </svg>
              <VRows started={run} />
            </div>
          </div>
        </div>
        <div className="st-n">{s4.n}</div>
        <div className="st-t">{s4.title}</div>
        <p className="st-b">{s4.body}</p>
      </div>
    </div>
  );
}
