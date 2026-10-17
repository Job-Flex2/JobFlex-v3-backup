"use client";

import { useEffect, useState } from "react";
import { CONSENT_OPEN_EVENT, effectiveConsent, pageConsentMode, readConsent, writeConsent, type Consent } from "@/lib/consent";

/* The cookie banner (2026-09-09; by country 2026-09-30). Essential cookies are
   always on; Analytics (PostHog) and Marketing are the two choices. Which visitors see it (lib/consent):
     optin   — EU, EEA, UK and Switzerland: the card opens by itself until
               "Accept all" / "Essential only" / Manage → Save.
     notice  — everyone else: never opens by itself (owner, 2026-09-30); the
               trackers run on the country default.
   The footer's "Cookie settings" and "Do not sell or share" open the manage
   view for everyone — that is where a choice is changed or taken back.
   Blueprint tokens only — paper card, 1.5 px ink frame, mono caps. Type
   floors (2026-09-10): mono caps 11 px in ink-muted, text and buttons 14 px. */
export function CookieBanner() {
  const [open, setOpen] = useState(false);
  const [manage, setManage] = useState(false);
  const [analytics, setAnalytics] = useState(true);
  const [marketing, setMarketing] = useState(false);

  useEffect(() => {
    // After paint, not during the effect: the cookie is a client-only fact and
    // the server rendered the banner closed.
    const id = requestAnimationFrame(() => {
      const c = effectiveConsent();
      setAnalytics(c.analytics);
      setMarketing(c.marketing);
      if (pageConsentMode() === "optin" && !readConsent()) setOpen(true);
    });
    const reopen = () => {
      const c = effectiveConsent();
      setAnalytics(c.analytics);
      setMarketing(c.marketing);
      setManage(true);
      setOpen(true);
    };
    window.addEventListener(CONSENT_OPEN_EVENT, reopen);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener(CONSENT_OPEN_EVENT, reopen);
    };
  }, []);

  if (!open) return null;

  const decide = (choice: { analytics: boolean; marketing: boolean }): Consent => {
    const c = writeConsent({ ...choice, ack: true });
    setOpen(false);
    setManage(false);
    return c;
  };

  const toggle = (on: boolean) =>
    `relative inline-flex h-5 w-9 shrink-0 items-center rounded-[2px] border-[1.5px] transition-colors ${
      on ? "border-[color:var(--ink)] bg-[color:var(--ink)]" : "border-[color:var(--ink-line)] bg-transparent"
    }`;
  const knob = (on: boolean) =>
    `absolute top-[2px] h-3 w-3 rounded-[1px] transition-transform ${on ? "translate-x-[18px] bg-[color:var(--paper-deep)]" : "translate-x-[2px] bg-[color:var(--ink-muted)]"}`;

  return (
    <div
      role="dialog"
      aria-label="Cookie preferences"
      className="fixed inset-x-3 bottom-3 z-[95] mx-auto max-w-[36rem] rounded-[var(--radius)] border-[1.5px] border-[color:var(--ink)] bg-[color:var(--paper-deep)] p-4 text-[color:var(--ink)] shadow-[4px_4px_0_rgba(10,10,10,0.08)] sm:inset-x-auto sm:left-6 sm:bottom-6 sm:p-5"
      data-cookie-banner
    >
      <div className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-[color:var(--ink-muted)]">Cookies</div>
      <p className="mt-1.5 text-[14px] leading-[1.5] text-[color:var(--ink-soft)]">
        Essential cookies keep you signed in. With your OK we also use analytics (PostHog, first-party) and marketing
        cookies — the Meta Pixel — to measure our ads. Details in the{" "}
        <a href="/privacy" className="underline underline-offset-2">
          privacy policy
        </a>
        .
      </p>

      {manage && (
        <div className="mt-3 grid gap-2 border-t border-[color:var(--ink-line)] pt-3">
          <div className="flex items-center justify-between gap-3 text-[14px]">
            <span>
              <span className="font-semibold">Essential</span>
              <span className="text-[color:var(--ink-muted)]"> · sign-in, security, your cookie choice</span>
            </span>
            <span className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-[color:var(--ink-muted)]">Always on</span>
          </div>
          <label className="flex cursor-pointer items-center justify-between gap-3 text-[14px]">
            <span>
              <span className="font-semibold">Analytics</span>
              <span className="text-[color:var(--ink-muted)]"> · PostHog page views and session replay on public pages</span>
            </span>
            <button type="button" role="switch" aria-checked={analytics} className={toggle(analytics)} onClick={() => setAnalytics((v) => !v)} data-consent-toggle="analytics">
              <span className={knob(analytics)} />
            </button>
          </label>
          <label className="flex cursor-pointer items-center justify-between gap-3 text-[14px]">
            <span>
              <span className="font-semibold">Marketing</span>
              <span className="text-[color:var(--ink-muted)]"> · Meta Pixel: advertising measurement (_fbp, _fbc)</span>
            </span>
            <button type="button" role="switch" aria-checked={marketing} className={toggle(marketing)} onClick={() => setMarketing((v) => !v)} data-consent-toggle="marketing">
              <span className={knob(marketing)} />
            </button>
          </label>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="h-9 rounded-[var(--radius)] bg-[color:var(--ink)] px-4 text-[14px] font-semibold text-[color:var(--paper-deep)]"
          onClick={() => decide({ analytics: true, marketing: true })}
          data-consent="accept-all"
        >
          Accept all
        </button>
        <button
          type="button"
          className="h-9 rounded-[var(--radius)] border-[1.5px] border-[color:var(--ink)] px-4 text-[14px] font-semibold"
          onClick={() => decide({ analytics: false, marketing: false })}
          data-consent="essential"
        >
          Essential only
        </button>
        {manage ? (
          <button
            type="button"
            className="h-9 rounded-[var(--radius)] border-[1.5px] border-[color:var(--ink-line)] px-4 text-[14px] font-semibold"
            onClick={() => decide({ analytics, marketing })}
            data-consent="save"
          >
            Save choices
          </button>
        ) : (
          <button
            type="button"
            className="h-9 px-2 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-[color:var(--ink-muted)] underline-offset-2 hover:underline"
            onClick={() => setManage(true)}
            data-consent="manage"
          >
            Manage
          </button>
        )}
      </div>
    </div>
  );
}
