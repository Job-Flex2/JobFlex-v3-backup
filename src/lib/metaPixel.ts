"use client";
import { isQaVisitor } from "@/lib/qaEmail";

/* Meta Pixel, browser half (2026-09-09). Loads ONLY after marketing consent
   (lib/consent) and only when NEXT_PUBLIC_META_PIXEL_ID is set; without the
   id every function here is a silent no-op — no script, no _fbp/_fbc, no
   console noise. Events carry an eventID so the Conversions API's copy of
   the same event (lib/metaCapi) deduplicates against them. */

const PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID?.trim() || "";
const SCRIPT_ID = "jf-meta-pixel";
const SCRIPT_SRC = "https://connect.facebook.net/en_US/fbevents.js";

type Fbq = ((...args: unknown[]) => void) & { queue?: unknown[]; loaded?: boolean; version?: string; callMethod?: unknown; push?: unknown };
declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
  }
}

export const isMetaPixelConfigured = (): boolean => PIXEL_ID.length > 0;

let loaded = false;

/** The standard fbevents bootstrap, without the automatic PageView (we send
 *  PageView ourselves, with an eventID). Safe to call twice. */
export function loadMetaPixel(): void {
  if (!PIXEL_ID || typeof window === "undefined" || loaded) return;
  loaded = true;
  if (!window.fbq) {
    const fbq: Fbq = function (...args: unknown[]) {
      if (fbq.callMethod) (fbq.callMethod as (...a: unknown[]) => void).apply(fbq, args);
      else fbq.queue!.push(args);
    } as Fbq;
    fbq.queue = [];
    fbq.loaded = true;
    fbq.version = "2.0";
    fbq.push = fbq;
    window.fbq = fbq;
    window._fbq = fbq;
  }
  if (!document.getElementById(SCRIPT_ID)) {
    const s = document.createElement("script");
    s.id = SCRIPT_ID;
    s.async = true;
    s.src = SCRIPT_SRC;
    document.head.appendChild(s);
  }
  window.fbq("init", PIXEL_ID);
}

function expireCookie(name: string) {
  const host = window.location.hostname;
  const parts = host.split(".");
  const apex = parts.length >= 2 ? "." + parts.slice(-2).join(".") : host;
  for (const domain of [null, host, apex]) {
    document.cookie = `${name}=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT${domain ? `; domain=${domain}` : ""}`;
  }
}

/** Consent withdrawn: the script tag goes, the global goes, _fbp/_fbc go. */
export function unloadMetaPixel(): void {
  if (typeof window === "undefined") return;
  loaded = false;
  document.getElementById(SCRIPT_ID)?.remove();
  try {
    delete window.fbq;
    delete window._fbq;
  } catch {
    window.fbq = undefined;
    window._fbq = undefined;
  }
  expireCookie("_fbp");
  expireCookie("_fbc");
}

export function isMetaPixelLoaded(): boolean {
  return loaded && typeof window !== "undefined" && typeof window.fbq === "function";
}

export function metaTrack(event: string, params: Record<string, string | number> = {}, eventId?: string): void {
  if (!isMetaPixelLoaded() || isQaVisitor()) return; // QA Lab browsers send nothing (lib/qaEmail)
  try {
    window.fbq!("track", event, params, eventId ? { eventID: eventId } : undefined);
  } catch {
    /* the pixel must never break the page */
  }
}

/** A custom event (fbq trackCustom) — ours, not one of Meta's standard names.
 *  Browser only: there is no server copy to deduplicate against. */
export function metaTrackCustom(event: string, params: Record<string, string | number> = {}): void {
  if (!isMetaPixelLoaded() || isQaVisitor()) return; // QA Lab browsers send nothing (lib/qaEmail)
  try {
    window.fbq!("trackCustom", event, params);
  } catch {
    /* the pixel must never break the page */
  }
}

/** The standard PageView, exactly as Meta's own snippet sends it —
 *  `fbq('track', 'PageView')`, no custom data, no eventID (there is no server
 *  copy to deduplicate against). The live test on production listed our
 *  PageView, then sent with an `industry` parameter, as a custom event
 *  (2026-09-30). */
export function metaPageView(): void {
  if (!isMetaPixelLoaded() || isQaVisitor()) return; // QA Lab browsers send nothing (lib/qaEmail)
  try {
    window.fbq!("track", "PageView");
  } catch {
    /* the pixel must never break the page */
  }
}

/** The pixel's own first-party cookies, for the Conversions API's user_data. */
export function readMetaCookies(): { fbp?: string; fbc?: string } {
  if (typeof document === "undefined") return {};
  const get = (n: string) => document.cookie.split("; ").find((c) => c.startsWith(n + "="))?.slice(n.length + 1);
  const fbp = get("_fbp");
  const fbc = get("_fbc");
  return { ...(fbp ? { fbp } : {}), ...(fbc ? { fbc } : {}) };
}

export function newEventId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
