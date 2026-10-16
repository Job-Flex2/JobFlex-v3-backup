"use client";

import { useEffect, useState } from "react";
import { REGISTER } from "./routes";

export function MobileCta({
  registerHref = REGISTER,
  cta,
  note = null,
}: {
  /** The trial in a few words under the button (lib/trialPolicy trialShortLine):
   *  a trade's button does not say it; the default page's does, and passes none. */
  note?: string | null;
  registerHref?: string;
  /** A trade variant's primary CTA words; the default page keeps its own. */
  cta?: string;
}) {
  const [scrolled, setScrolled] = useState(false);
  const [ctaVisible, setCtaVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 640);
      // Hide once the final CTA section has scrolled into (or past) view
      const target = document.getElementById("final-cta");
      if (target) {
        setCtaVisible(target.getBoundingClientRect().top < window.innerHeight);
      }
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const show = scrolled && !ctaVisible;

  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/95 backdrop-blur transition-transform duration-300 md:hidden ${
        show ? "translate-y-0" : "translate-y-full"
      }`}
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {/* One full-width button: a trade's CTA ("Start free — measure a
          roof") needs the whole bar's width on a phone. Under it, on a trade
          landing, the trial as plain small text — no frame (owner,
          2026-10-16; the framed badge read as a second button). */}
      <div className={`flex flex-col items-stretch px-5 ${note ? "gap-1 pb-1.5 pt-2.5" : "py-2.5"}`}>
        <a href={registerHref} className="lp-btn-dark h-12 w-full text-[16px] font-semibold" data-cta="sticky">
          {cta ?? "Start FREE Trial"}
        </a>
        {note ? <p className="whitespace-nowrap text-center text-[12px] leading-4 text-slate-600">{note}</p> : null}
      </div>
    </div>
  );
}
