"use client";

// SIDEWAYS SCROLL HINT for the handheld filter rows (owner, 2026-10-18).
//
// A row of filter segments that is wider than the phone slides sideways rather
// than wrapping or clipping a label. Without a hint, the segment cut by the
// screen's edge reads as a clipped word. This hook writes `data-fade` on the
// scroller — "start", "end" or "start end", or nothing when it fits — so the
// page's CSS can fade only the side(s) that still hold more segments:
//
//   .fseg[data-fade~="end"] { mask-image: linear-gradient(to right, #000 calc(100% - 28px), transparent); }
//
// The DOM is written directly (as use-anchored-menu does): it re-measures on
// scroll and resize, and none of that should cost a React render.

import { useCallback, useEffect, useRef } from "react";

export function useScrollFade<T extends HTMLElement>(): (node: T | null) => void {
  const nodeRef = useRef<T | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

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
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    for (const child of Array.from(node.children)) ro.observe(child);
    cleanupRef.current = () => {
      node.removeEventListener("scroll", measure);
      ro.disconnect();
    };
  }, []);

  useEffect(() => () => cleanupRef.current?.(), []);

  return attach;
}
