"use client";

/* One Meta pixel event, once per company (2026-10-23) — MetaStartTrial's rule for an event with no data: the browser
   remembers the company, so a reload or a later visit sends nothing, and it is sent only when the pixel is on the
   page (the live site); the pixel's script can land a moment after this mounts, so it is waited for briefly. */

import * as React from "react";

const WAIT_MS = 10_000;
const sentHere = new Set<string>();

export function MetaPixelOnce({ name, organizationId }: { name: string; organizationId: string }) {
  React.useEffect(() => {
    const key = `jf_meta_${name}:${organizationId}`;
    if (sentHere.has(key)) return;
    try {
      if (window.localStorage.getItem(key)) {
        sentHere.add(key);
        return;
      }
    } catch {
      /* storage blocked: this page still remembers below */
    }
    const started = Date.now();
    let timer = 0;
    const send = () => {
      if (sentHere.has(key)) return;
      const fbq = (window as unknown as { fbq?: (...args: unknown[]) => void }).fbq;
      if (typeof fbq !== "function") {
        if (Date.now() - started < WAIT_MS) timer = window.setTimeout(send, 200);
        return;
      }
      fbq("track", name);
      sentHere.add(key);
      try {
        window.localStorage.setItem(key, "1");
      } catch {
        /* storage blocked: once per page load then */
      }
    };
    send();
    return () => window.clearTimeout(timer);
  }, [name, organizationId]);
  return null;
}
