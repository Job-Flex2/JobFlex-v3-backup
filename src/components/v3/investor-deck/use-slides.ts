"use client";
// One slide at a time (2026-10-25) — the pitch deck and the platform tour: the arrow keys, a swipe on the slide,
// Play / Pause (a slide every few seconds, stopping on the last), and every other control through `go`.
import { useCallback, useEffect, useRef, useState } from "react";

export function useSlides(count: number, playMs = 6500) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const at = useRef(0);
  useEffect(() => {
    at.current = index;
  }, [index]);

  const go = useCallback((n: number) => setIndex(Math.max(0, Math.min(count - 1, n))), [count]);
  /** A reader's own move stops the show. */
  const move = useCallback((n: number) => {
    setPlaying(false);
    go(n);
  }, [go]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable], dialog")) return;
      if (e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); setPlaying(false); setIndex((x) => Math.min(count - 1, x + 1)); }
      else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); setPlaying(false); setIndex((x) => Math.max(0, x - 1)); }
      else if (e.key === "Home") { setPlaying(false); setIndex(0); }
      else if (e.key === "End") { setPlaying(false); setIndex(count - 1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [count]);

  useEffect(() => {
    if (!playing) return;
    const t = window.setInterval(() => {
      if (at.current >= count - 1) { setPlaying(false); return; }
      setIndex(at.current + 1);
    }, playMs);
    return () => window.clearInterval(t);
  }, [playing, count, playMs]);

  // A swipe across the slide turns it; a tap does nothing.
  const startX = useRef<number | null>(null);
  const swipe = {
    onPointerDown: (e: React.PointerEvent) => { startX.current = e.clientX; },
    onPointerUp: (e: React.PointerEvent) => {
      const from = startX.current;
      startX.current = null;
      if (from === null) return;
      const dx = e.clientX - from;
      if (Math.abs(dx) > 50) move(at.current + (dx < 0 ? 1 : -1));
    },
  };

  const togglePlay = () => {
    if (!playing && at.current >= count - 1) go(0);
    setPlaying((p) => !p);
  };

  return { index, go, move, playing, togglePlay, swipe };
}
