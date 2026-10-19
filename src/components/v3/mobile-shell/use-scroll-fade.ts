"use client";

// SIDEWAYS SCROLL HINT for the handheld filter rows (owner, 2026-10-18).
//
// A row of filter segments that is wider than the phone slides sideways rather
// than wrapping or clipping a label. Without a hint, the segment cut by the
// screen's edge reads as a clipped word. This hook writes `data-fade` on the
// scroller — "start", "end" or "start end", or nothing when it fits — so the
// page's CSS can fade only the side(s) that still hold more segments:
//
//   .fsegScroll[data-fade="end"] { mask-image: linear-gradient(to right, #000 calc(100% - 32px), transparent); }
//
// Put the frame on a wrapper and the mask on the scroller inside it, or the
// fade erases the frame's edge too.
//
// Pass the current pick as `active`: whenever it changes, the scroller slides
// just far enough to show the pressed segment ([aria-pressed="true"]) whole,
// so the pick is never left under the fade or past the edge.
//
// The DOM is written directly (as use-anchored-menu does): it re-measures on
// scroll and resize, and none of that should cost a React render.

import { useCallback, useEffect, useRef } from "react";

export function useScrollFade<T extends HTMLElement>(active?: unknown): (node: T | null) => void {
  const nodeRef = useRef<T | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  /** Slide just far enough to show the pressed segment whole, clear of the fade. */
  const reveal = useCallback((node: T) => {
    const on = node.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!on) return;
    // Measured against the scroller, not scrollIntoView: that would also move the page.
    const fade = 32;
    const left = on.getBoundingClientRect().left - node.getBoundingClientRect().left + node.scrollLeft;
    const right = left + on.offsetWidth;
    if (left < node.scrollLeft + fade) node.scrollLeft = Math.max(0, left - fade);
    else if (right > node.scrollLeft + node.clientWidth - fade) node.scrollLeft = right - node.clientWidth + fade;
  }, []);

  const attach = useCallback((node: T | null) => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    nodeRef.current = node;
    if (!node) return;
    const measure = () => {
      const max = node.scrollWidth - node.clientWidth;
      const parts: string[] = [];
      if (max > 1 && node.scrollLeft > 1) parts.push("start");
      if (max > 1 && node.scrollLeft < max - 1) parts.push("end");
      if (parts.length) node.dataset.fade = parts.join(" ");
      else delete node.dataset.fade;
    };
    measure();
    node.addEventListener("scroll", measure, { passive: true });
    // A resize (the button beside the row growing with its pick) can push the
    // pressed segment back under the fade, so it is revealed again.
    const ro = new ResizeObserver(() => {
      reveal(node);
      measure();
    });
    ro.observe(node);
    for (const child of Array.from(node.children)) ro.observe(child);
    cleanupRef.current = () => {
      node.removeEventListener("scroll", measure);
      ro.disconnect();
    };
  }, [reveal]);

  useEffect(() => () => cleanupRef.current?.(), []);

  useEffect(() => {
    if (nodeRef.current) reveal(nodeRef.current);
  }, [active, reveal]);

  return attach;
}
