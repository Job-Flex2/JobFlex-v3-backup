"use client";

/* Meta Lead (ad owner, 2026-10-17): the one event besides the layout's
   PageView. Sent where the old pixel sent it — step 1 of the signup passed
   with an address — once per browser: a reload, Back or a second visit sends
   nothing more. Only when the pixel is on the page (layout.tsx, live site only). */

const SENT_KEY = "jf_meta_lead";
let sentHere = false;

export function trackMetaLeadOnce(): void {
  if (sentHere || typeof window === "undefined") return;
  try {
    if (window.localStorage.getItem(SENT_KEY)) {
      sentHere = true;
      return;
    }
  } catch {
    /* storage blocked: this page still remembers below */
  }
  const fbq = (window as unknown as { fbq?: (...args: unknown[]) => void }).fbq;
  if (typeof fbq !== "function") return;
  fbq("track", "Lead");
  sentHere = true;
  try {
    window.localStorage.setItem(SENT_KEY, "1");
  } catch {
    /* storage blocked: once per page load then */
  }
}
