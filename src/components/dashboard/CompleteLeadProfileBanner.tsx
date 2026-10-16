"use client";
import * as React from "react";
import Link from "next/link";
import { X, MapPin } from "lucide-react";
import "./complete-lead-profile-banner.css";

const SNOOZE_KEY = "jf.leadProfileNag";
const SNOOZE_DAYS = 7;

// Nudges owners/admins whose org can't receive platform leads yet (missing
// geocoded address and/or trades). Dismiss snoozes for 7 days via localStorage
// — deliberately not schema-backed.
export function CompleteLeadProfileBanner({
  needsAddress,
  needsTrades,
}: {
  needsAddress: boolean;
  needsTrades: boolean;
}) {
  const [visible, setVisible] = React.useState(false);
  const [closing, setClosing] = React.useState(false);

  React.useEffect(() => {
    try {
      const until = Number(window.localStorage.getItem(SNOOZE_KEY) ?? 0);
      if (Date.now() > until) setVisible(true);
    } catch {
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  const missing =
    needsAddress && needsTrades
      ? "your business address and the trades you take"
      : needsAddress
        ? "your business address"
        : "the trades you take";

  return (
    // Same amber plate as the Overview banner (complete-lead-profile-banner.css).
    <div className={`jf-lead-nudge${closing ? " is-closing" : ""}`} data-lead-banner="">
      <MapPin className="jf-lead-nudge-pin" strokeWidth={1.75} aria-hidden />
      <div className="jf-lead-nudge-body">
        <div className="jf-lead-nudge-kicker">Lead Center</div>
        <p className="jf-lead-nudge-txt">
          Homeowner leads near you aren&apos;t reaching your shop yet — add {missing} to start
          receiving them.{" "}
          <Link href="/dashboard/company" className="jf-lead-nudge-link">
            Complete your profile
          </Link>
        </p>
      </div>
      <button
        type="button"
        aria-label="Dismiss for a week"
        onClick={() => {
          try {
            window.localStorage.setItem(
              SNOOZE_KEY,
              String(Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000),
            );
          } catch {
            /* still hide for this render */
          }
          setClosing(true);
          window.setTimeout(() => setVisible(false), 300);
        }}
        // 44px hit area: this banner mounts on the handheld Leads too, where
        // the dismiss is a thumb target, not a mouse one.
        className="jf-lead-nudge-close"
      >
        <span>
          <X />
        </span>
      </button>
    </div>
  );
}
