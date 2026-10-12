"use client";

import * as React from "react";
import r from "./deck-step-rail.module.css";

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(" ");

/** One step as the rail shows it: its number, its title and its colour, read off the page. */
interface RailItem {
  n: string;
  title: string;
  color: string;
}

const stepsOf = (root: HTMLElement) => [...root.querySelectorAll<HTMLDetailsElement>(":scope > details[data-step]")];

/**
 * THE STEP RAIL (2026-10-12, owner: "polish the deck studio — smart, nice, easy to use"): a numbered dot for every step,
 * stuck at the top of the steps, the one being read lit and named; a tap opens that step and scrolls to it. It is read off
 * the page like the steps' own "Next:" buttons, so the steps that come and go (the house, the roof, the footprint) need no
 * list of their own.
 */
export function DeckStepRail({ stepsRef }: { stepsRef: React.RefObject<HTMLElement | null> }) {
  const [items, setItems] = React.useState<RailItem[]>([]);
  const [active, setActive] = React.useState(0);

  React.useEffect(() => {
    const root = stepsRef.current;
    if (!root) return;
    let io: IntersectionObserver | null = null;
    const seen = new Map<Element, boolean>();
    const read = () => {
      const next = stepsOf(root).map((d) => ({ n: d.getAttribute("data-step") ?? "", title: d.querySelector("[data-step-title]")?.textContent ?? "", color: d.style.getPropertyValue("--step-c") }));
      setItems((prev) => (prev.length === next.length && prev.every((p, i) => p.n === next[i].n && p.title === next[i].title && p.color === next[i].color) ? prev : next));
    };
    // The step being read: the first one crossing a band near the top of the screen.
    const watch = () => {
      io?.disconnect();
      seen.clear();
      if (typeof IntersectionObserver === "undefined") return;
      io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) seen.set(e.target, e.isIntersecting);
          const i = stepsOf(root).findIndex((d) => seen.get(d));
          if (i >= 0) setActive(i);
        },
        { rootMargin: "-18% 0px -72% 0px" },
      );
      for (const d of stepsOf(root)) io.observe(d);
    };
    const raf = requestAnimationFrame(() => {
      read();
      watch();
    });
    const mo = new MutationObserver((list) => {
      read();
      if (list.some((m) => m.target === root)) watch();
    });
    mo.observe(root, { childList: true, subtree: true, characterData: true });
    return () => {
      cancelAnimationFrame(raf);
      mo.disconnect();
      io?.disconnect();
    };
  }, [stepsRef]);

  const go = (i: number) => {
    const root = stepsRef.current;
    const d = root ? stepsOf(root)[i] : undefined;
    if (!d) return;
    d.open = true;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    d.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
    d.querySelector("summary")?.focus({ preventScroll: true });
    setActive(i);
  };

  if (items.length < 2) return null;
  const now = items[Math.min(active, items.length - 1)];
  return (
    <nav className={r.rail} aria-label="Steps" data-deck-rail>
      <ol className={r.dots}>
        {items.map((it, i) => (
          <li key={`${it.n}-${it.title}`}>
            <button
              type="button"
              className={cx(r.dot, i === active && r.on)}
              style={{ "--dot": it.color || "var(--blueprint)" } as React.CSSProperties}
              onClick={() => go(i)}
              aria-current={i === active ? "step" : undefined}
              aria-label={`Step ${it.n}: ${it.title}`}
              title={it.title}
              data-deck-rail-step={it.n}
            >
              {it.n}
            </button>
          </li>
        ))}
      </ol>
      <span className={r.now} style={{ color: now?.color || undefined }} data-deck-rail-now>
        {now?.title}
      </span>
    </nav>
  );
}
