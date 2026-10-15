"use client";

/* Meta events from the public pages (2026-10-01), on top of the signup's own
   (register-content: InitiateCheckout, CompleteRegistration).

     ViewContent        landing view, content_name = the trade ("default")   browser + server
     Lead               register step 1 submitted with a free email          browser + server
     EstimatorDemoStep  a hero estimator window reaching a step              browser only
     EstimatorDemoTier  a tier picked in the HVAC hero window                browser only

   CONSENT. Every one of these needs marketing consent — the visitor's record,
   else the country's default (lib/consent) — in the browser, and the server
   checks the same cookies again before it sends its copy (api/meta/event).
   Without consent nothing is sent, either side. The pair shares one event_id,
   so Meta counts it once.

   fbp / fbc (2026-10-01). The server copy carries the pixel's cookies; on a
   first visit the _fbp cookie does not exist until fbevents.js has loaded,
   which can be after the event. So the copy waits for _fbp (up to
   FBP_WAIT_MS, or until the page is left) and puts both values in the body
   as well; the server prefers the request's cookies and falls back to these. */

import { effectiveConsent } from "@/lib/consent";
import { isQaVisitor, markQaVisitor } from "@/lib/qaEmail";
import { isMetaPixelConfigured, loadMetaPixel, metaTrack, metaTrackCustom, newEventId, readMetaCookies } from "@/lib/metaPixel";

const FBP_WAIT_MS = 2500;

export type MetaPairEvent = "ViewContent" | "Lead";
export type MetaCustomEvent = "EstimatorDemoStep" | "EstimatorDemoTier";

function allowed(): boolean {
  if (!isMetaPixelConfigured() || !effectiveConsent().marketing || isQaVisitor()) return false;
  // An event fired from a page's first effect runs before the provider's
  // (children first); the load is idempotent, so the event finds its pixel.
  loadMetaPixel();
  return true;
}

/** The browser event and its Conversions API copy, one event_id. False when
 *  nothing was sent (no pixel id, or no marketing consent). */
export function metaTrackWithServer(
  event: MetaPairEvent,
  params: { content_name?: string },
  extra: { email?: string } = {},
): boolean {
  markQaVisitor(extra.email); // a QA Lab address (lib/qaEmail): this event and every later one stay home
  if (!allowed()) return false;
  const eventId = newEventId();
  metaTrack(event, params, eventId);
  const fbclid = new URLSearchParams(window.location.search).get("fbclid") || undefined;
  const sourceUrl = window.location.origin + window.location.pathname;
  const started = Date.now();
  let done = false;
  let timer = 0;
  const send = () => {
    if (done) return;
    done = true;
    window.clearTimeout(timer);
    window.removeEventListener("pagehide", send);
    try {
      const { fbp, fbc } = readMetaCookies();
      void fetch("/api/meta/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // keepalive: leaving the page (a CTA tap) must not cancel the copy.
        keepalive: true,
        body: JSON.stringify({
          event,
          eventId,
          params,
          ...(extra.email ? { email: extra.email } : {}),
          ...(fbclid ? { fbclid } : {}),
          ...(fbp ? { fbp } : {}),
          ...(fbc ? { fbc } : {}),
          sourceUrl,
        }),
      }).catch(() => {});
    } catch {
      /* the server copy is best effort */
    }
  };
  const poll = () => {
    if (readMetaCookies().fbp || Date.now() - started >= FBP_WAIT_MS) send();
    else timer = window.setTimeout(poll, 100);
  };
  window.addEventListener("pagehide", send);
  poll();
  return true;
}

export function metaCustomEvent(event: MetaCustomEvent, params: Record<string, string | number>): void {
  if (!allowed()) return;
  metaTrackCustom(event, params);
}
