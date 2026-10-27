// The homeowner's TCPA consent (owner, 2026-10-26): the words beside the box
// under "Send my project" on /homeowner (desktop and phone wizards). The box
// must be ticked to send; the server keeps these exact words with the request,
// with the time, the IP and the page (LeadSource, lib/leadCenter/intake).
// Change the words here only — the wizards and the stored record read this.
// Plain module: it ships to the browser.

export const LEAD_CONSENT_TEXT =
  "By submitting, you agree that JobFlex and up to three contractors matched to your project may contact you by phone, text or email about your request, including by automated means. Consent is not a condition of purchase. Message and data rates may apply. Reply STOP to opt out.";

/** What the wizard says when the box is not ticked. */
export const LEAD_CONSENT_MISSING = "Please tick the box to agree to be contacted about your request.";

/** The page a request was sent from, as the wizard reports it: path and query, nothing else. */
export function consentPageFromLocation(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return (window.location.pathname + window.location.search).slice(0, 300);
}
