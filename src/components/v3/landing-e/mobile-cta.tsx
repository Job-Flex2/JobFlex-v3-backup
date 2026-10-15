"use client";

import { useEffect, useState } from "react";
import { REGISTER } from "./routes";

export function MobileCta({
  registerHref = REGISTER,
  cta,
}: {
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
          roof") needs the whole bar's width on a phone. */}
      <div className="flex flex-col items-stretch px-5 py-2.5">
        <a href={registerHref} className="lp-btn-dark h-12 w-full text-[16px] font-semibold" data-cta="sticky">
          {cta ?? "Start FREE Trial"}
        </a>
      </div>
    </div>
  );
}
