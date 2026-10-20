"use client";

/* The three steps of the how-it-works section (hero-proof.tsx): a white card
   per step, a chevron in the gap between them, and a 3 px scale along each
   card's foot filled a third, two thirds and the whole way in the trade
   tool's colour.

   The scales are in the server's HTML already filled, so a page whose
   script never runs shows them as they end. Once this runs, a visitor who
   has not asked for reduced motion and has not reached the section yet gets
   them emptied (data-how="armed") and filled once, 500 ms, as the section
   comes into view (data-how="on"). */

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

export type HowIcon = "pin" | "deck" | "pen" | "calc" | "file" | "cal" | "card";

/* The project sprite's line icons (proposals-blueprint/sprite.tsx — 24×24,
   stroke 2, currentColor), drawn inline: the landing does not render the
   dashboard's sprite. "calc" is drawn here in the same style; the sprite has
   no calculator. */
const ICON: Record<HowIcon, ReactNode> = {
  pin: (
    <>
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </>
  ),
  deck: (
    <>
      <path d="M2 10h20" />
      <path d="M2 13h20" />
      <path d="M4 13v8" />
      <path d="M20 13v8" />
      <path d="M12 13v8" />
      <path d="M5 10V5h14v5" />
    </>
  ),
  pen: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </>
  ),
  calc: (
    <>
      <rect x="4" y="2" width="16" height="20" rx="1" />
      <path d="M8 6h8" />
      <path d="M8 11h.01" />
      <path d="M12 11h.01" />
      <path d="M16 11h.01" />
      <path d="M8 15h.01" />
      <path d="M12 15h.01" />
      <path d="M16 15h.01" />
      <path d="M8 19h8" />
    </>
  ),
  file: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
    </>
  ),
  cal: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="1" />
      <path d="M16 2v4" />
      <path d="M8 2v4" />
      <path d="M3 10h18" />
    </>
  ),
  card: (
    <>
      <rect x="2" y="5" width="20" height="14" rx="1" />
      <path d="M2 10h20" />
    </>
  ),
};

export type HowStep = { title: string; value: string; label: string; icon: HowIcon };

export function HowSteps({ steps }: { steps: HowStep[] }) {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
    // Already on screen when the script arrives: leave the scales as they are.
    if (el.getBoundingClientRect().top < window.innerHeight) return;
    el.setAttribute("data-how", "armed");
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        // One frame at empty, then the fill.
        requestAnimationFrame(() => el.setAttribute("data-how", "on"));
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <ol ref={ref} className="lp-how-steps">
      {steps.map((s, i) => (
        <li key={s.title} className="lp-how-step">
          <div className="lp-how-top">
            <span className="lp-how-icon" aria-hidden>
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {ICON[s.icon]}
              </svg>
            </span>
            <span className="lp-how-num">{String(i + 1).padStart(2, "0")}</span>
          </div>
          <h3 className="lp-how-title">{s.title}</h3>
          <p className="lp-how-val">{s.value}</p>
          <p className="lp-how-label">{s.label}</p>
          <span className="lp-how-scale" aria-hidden>
            <span className="lp-how-fill" style={{ "--how-fill": (i + 1) / steps.length } as CSSProperties} />
          </span>
        </li>
      ))}
    </ol>
  );
}
