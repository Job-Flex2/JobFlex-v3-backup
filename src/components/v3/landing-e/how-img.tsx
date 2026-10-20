"use client";

/* A how-it-works picture that asks for its file only as the section nears
   the screen (300 px ahead). `loading="lazy"` alone starts it 1,250–2,500 px
   ahead — on a phone that is still the first screen's load, and the three
   pictures pushed the hero's LCP back ~370 ms in Lighthouse. The box keeps
   its 4:3 shape before the file comes (hero-fit.css), so nothing moves; a
   page whose script never runs gets the <noscript> copy. */

import { useEffect, useRef } from "react";

export function HowImg({ src, alt }: { src: string; alt: string }) {
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const img = ref.current;
    if (!img) return;
    const load = () => img.setAttribute("src", src);
    if (!("IntersectionObserver" in window)) return load();
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        load();
      },
      { rootMargin: "300px 0px" },
    );
    io.observe(img);
    return () => io.disconnect();
  }, [src]);
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- a fixed 760×570 webp, already its own size */}
      <img ref={ref} alt={alt} width={760} height={570} decoding="async" />
      <noscript>
        {/* eslint-disable-next-line @next/next/no-img-element -- the same picture without the script */}
        <img src={src} alt={alt} width={760} height={570} loading="lazy" decoding="async" />
      </noscript>
    </>
  );
}
