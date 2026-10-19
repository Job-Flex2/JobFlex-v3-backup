"use client";

import { useEffect } from "react";
import { createWheelMotion, wheelPixels } from "@/lib/smooth-wheel";

// The same gentle wheel movement as AI desk, Texting and the deck estimator.
// Public pages keep native touch scrolling, editable controls, nested demos,
// zoom gestures and modal locks. The owner's desktop-only preference remains.
const DESKTOP = "(hover: hover) and (pointer: fine) and (min-width: 769px)";
const NATIVE = 'input, select, textarea, [contenteditable=""], [contenteditable="true"], [data-native-wheel], [data-native-scroll]';

/** True when something between the target and the page scrolls (or holds)
 *  a vertical wheel in this direction. */
function handledInside(start: EventTarget | null, dy: number): boolean {
  let el = start instanceof Element ? start : null;
  const root = document.documentElement;
  while (el && el !== document.body && el !== root) {
    const cs = getComputedStyle(el);
    const oy = cs.overflowY;
    if ((oy === "auto" || oy === "scroll" || oy === "overlay") && el.scrollHeight > el.clientHeight + 1) {
      const room = dy > 0 ? el.scrollHeight - el.clientHeight - el.scrollTop > 1 : el.scrollTop > 1;
      if (room || cs.overscrollBehaviorY !== "auto") return true;
    }
    el = el.parentElement;
  }
  return false;
}

function pageLocked(): boolean {
  const body = document.body;
  if (!body) return true;
  const hs = getComputedStyle(document.documentElement);
  const bs = getComputedStyle(body);
  const shut = (v: string) => v === "hidden" || v === "clip";
  if (shut(hs.overflowY) || shut(bs.overflowY) || bs.position === "fixed") return true;
  let modal: Element | null;
  try {
    modal = document.querySelector("dialog:modal");
  } catch {
    modal = document.querySelector("dialog[open]");
  }
  if (modal) return true;
  for (const el of Array.from(document.querySelectorAll('[aria-modal="true"]'))) {
    if (el.getClientRects().length) return true;
  }
  return false;
}

function setScroll(y: number) {
  try {
    window.scrollTo({ top: y, behavior: "instant" });
  } catch {
    window.scrollTo(0, y); // engines without "instant" have no smooth scrolling to override
  }
}

export function SmoothWheel() {
  useEffect(() => {
    const desk = window.matchMedia(DESKTOP);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const root = document.documentElement;
    const ownBehavior = root.style.scrollBehavior;
    let lastSet = window.scrollY;
    const motion = createWheelMotion(
      () => window.scrollY,
      (value) => { setScroll(value); lastSet = window.scrollY; },
      () => Math.max(0, (document.scrollingElement ?? root).scrollHeight - window.innerHeight),
      root,
    );
    const stop = () => motion.stop();
    const onScroll = () => { if (Math.abs(window.scrollY - lastSet) > 2) stop(); };
    const onWheel = (event: WheelEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || !desk.matches || reduce.matches) return;
      if (!event.deltaY || Math.abs(event.deltaX) > Math.abs(event.deltaY) || pageLocked()) return;
      if (event.target instanceof Element && event.target.closest(NATIVE)) return;
      if (handledInside(event.target, event.deltaY)) return;
      event.preventDefault();
      motion.move(wheelPixels(event, window.innerHeight));
    };
    const interrupts = ["keydown", "pointerdown", "touchstart", "hashchange", "resize"] as const;
    let listening = false;
    const sync = () => {
      const enabled = desk.matches && !reduce.matches;
      root.style.scrollBehavior = enabled ? ownBehavior : "auto";
      if (enabled === listening) return;
      listening = enabled;
      if (enabled) window.addEventListener("wheel", onWheel, { passive: false });
      else { window.removeEventListener("wheel", onWheel); stop(); }
    };
    for (const event of interrupts) window.addEventListener(event, stop, { passive: true, capture: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    desk.addEventListener("change", sync);
    reduce.addEventListener("change", sync);
    sync();
    return () => {
      stop();
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("scroll", onScroll);
      for (const event of interrupts) window.removeEventListener(event, stop, true);
      desk.removeEventListener("change", sync);
      reduce.removeEventListener("change", sync);
      root.style.scrollBehavior = ownBehavior;
    };
  }, []);
  return null;
}
