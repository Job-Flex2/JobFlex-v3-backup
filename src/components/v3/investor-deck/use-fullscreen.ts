"use client";
// FULL SCREEN for the pitch deck and the platform tour (owner, 2026-10-25: "make it more wide open and screen"). The
// browser's own full screen on the slideshow's element; F toggles it like a slideshow app, Esc leaves it. A browser
// without it (Safari on an iPhone) gets no button rather than one that does nothing.
import { useCallback, useEffect, useSyncExternalStore, type RefObject } from "react";

type WebkitDoc = Document & { webkitFullscreenEnabled?: boolean; webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };
type WebkitEl = HTMLElement & { webkitRequestFullscreen?: () => void };

const onChange = (cb: () => void) => {
  document.addEventListener("fullscreenchange", cb);
  document.addEventListener("webkitfullscreenchange", cb);
  return () => {
    document.removeEventListener("fullscreenchange", cb);
    document.removeEventListener("webkitfullscreenchange", cb);
  };
};
const never = () => () => {};
const current = () => document.fullscreenElement ?? (document as WebkitDoc).webkitFullscreenElement ?? null;

export function useFullscreen(ref: RefObject<HTMLElement | null>) {
  const able = useSyncExternalStore(never, () => Boolean(document.fullscreenEnabled || (document as WebkitDoc).webkitFullscreenEnabled), () => false);
  // One slideshow to a page, so anything in full screen is this one.
  const on = useSyncExternalStore(onChange, () => current() !== null, () => false);

  const toggle = useCallback(() => {
    const el = ref.current as WebkitEl | null;
    if (!el) return;
    if (current()) {
      if (document.exitFullscreen) void document.exitFullscreen().catch(() => {});
      else (document as WebkitDoc).webkitExitFullscreen?.();
    } else if (el.requestFullscreen) void el.requestFullscreen().catch(() => {});
    else el.webkitRequestFullscreen?.();
  }, [ref]);

  useEffect(() => {
    if (!able) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== "f" && e.key !== "F") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable], dialog")) return;
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [able, toggle]);

  return { able, on, toggle };
}
