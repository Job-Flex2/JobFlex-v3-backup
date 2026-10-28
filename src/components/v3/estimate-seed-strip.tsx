"use client";

// THE STRIP AN ESTIMATOR SHOWS WHEN IT WAS OPENED FROM A LEAD (2026-09-21):
// whose job this is, the address that was typed in for them, and the way
// back. Mounting it spends the seed (actions/estimateSeed), so the estimator
// prefills once and a later visit starts empty.

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { consumeEstimateSeed } from "@/actions/estimateSeed";
import "./estimate-seed-strip.css";

export type SeedStripData = {
  leadId: string;
  name: string;
  address: string | null;
  phone?: string | null;
  email?: string | null;
  /** The lead's scope (else the homeowner's words) and the estimator it was handed to (lib/estimateSeed). */
  brief?: string | null;
  estimator?: string;
};

/** The estimators that never show the lead's words anywhere else on their page. */
const SHOWS_SCOPE = new Set(["roof", "fence", "hvac"]);

/**
 * Rendered by the estimator page on EVERY visit, with the seed or null. The
 * seed is kept from the first render: spending it (a cookie delete in a
 * server action) makes Next re-render the page without one, and a strip the
 * page only drew while it had a seed vanished a moment after it appeared
 * (2026-09-22). State here outlives that refresh; a later visit starts null.
 */
export function EstimateSeedStrip({ seed }: { seed: SeedStripData | null }) {
  const [kept] = useState(() => seed);
  useEffect(() => {
    if (kept) void consumeEstimateSeed();
  }, [kept]);
  if (!kept) return null;
  const { leadId, name, address, phone, email } = kept;
  // Roof, fence and HVAC measure; nothing on them shows what the homeowner
  // asked for. The lead's scope is here to read while estimating, and it goes
  // on the proposal as its overview (lib/filingContext, 2026-09-26). The Smart
  // Proposal has it in its brief already, the manual proposal on its sheet.
  const brief = kept.brief?.trim() && SHOWS_SCOPE.has(kept.estimator ?? "") ? kept.brief.trim() : null;
  return (
    // A plain stylesheet (estimate-seed-strip.css, root `.jf-seed`); `data-nest` keeps the blueprint shell's element
    // reset off it (docs/design/mobile.md), which is what once left the old utility-class strip a hairline.
    <div className="jf-seed" data-nest data-estimate-seed>
      <div className="jfs-row">
        <span className="jfs-tag">
          <svg className="jfs-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></svg>
          From the lead
        </span>
        <div className="jfs-who">
          <strong className="jfs-name">{name || "Homeowner"}</strong>
          <div className="jfs-facts">
            {phone ? (
              <a className="jfs-fact" href={`tel:${phone.replace(/[^\d+]/g, "")}`}>
                <svg className="jfs-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" /></svg>
                {phone}
              </a>
            ) : null}
            {email ? (
              <a className="jfs-fact" href={`mailto:${email}`}>
                <svg className="jfs-ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="1" /><path d="m22 6-10 7L2 6" /></svg>
                {email}
              </a>
            ) : null}
            {address ? (
              <span className="jfs-fact">
                <svg className="jfs-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" /><circle cx="12" cy="10" r="3" /></svg>
                {address}
              </span>
            ) : null}
          </div>
        </div>
        <Link href={`/dashboard/leads/${leadId}` as Route} className="jfs-back">
          <svg className="jfs-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
          Back to the lead
        </Link>
      </div>
      {brief ? (
        <details className="jfs-scope" data-estimate-seed-scope>
          <summary>The lead&rsquo;s scope of work — it goes on the proposal</summary>
          <p>{brief}</p>
        </details>
      ) : null}
    </div>
  );
}
