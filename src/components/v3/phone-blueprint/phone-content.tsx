"use client";

// Blueprint phone — page CONTENT only. The donor's `.content` children,
// verbatim (jobflex-phone-blueprint_1.html); the sidebar, topbar, sprite and
// graph-paper field come from the shared shell
// (components/v3/blueprint-shell), which persists across navigation. Dynamic
// regions (#statGrid, #phFilters, the call-log body and #sheetBody) are left
// empty exactly like the donor and filled by the ported script on mount —
// same architecture, same timing.
//
// Returning a fragment keeps these blocks as DIRECT children of `.content`,
// which the donor's reveal cascade (`.content > *`) depends on.
//
// The donor's sprite is byte-identical to the one the shared shell already
// renders (42 symbols, same ids AND same geometry), so this page ships no
// sprite of its own and its `<use href="#i-…">` references resolve against the
// shell copy.
//
// One structural note: in the donor, `#sheetBg` / `#sheet` sit OUTSIDE
// `.content` (children of `.layout`, which the shared shell owns here), so
// they ship as the last members of this fragment instead. Both are
// `position: fixed`, so they take no part in `.content`'s flex flow; the
// stacking consequence of moving them inside a `z-index: 1` ancestor is
// undone by the one escape-hatch rule in phone-global.css, and the reveal
// cascade skips them in phone-behavior.ts — together those reproduce the
// donor's paint order and motion exactly.
//
// The setup banner is the one block the donor rendered unconditionally: it
// only appears when Twilio is genuinely unconfigured, which is what the
// classic page did. The reveal cascade indexes `.content > *` at runtime, so
// dropping it just shifts the remaining blocks up one step.

import { DeskWorkspaceHeader, type DeskWorkspaceData } from "../ai-desk/desk-workspace-header";
import { useCallback, useRef } from "react";
import { useBlueprintContent } from "@/components/v3/blueprint-shell/use-blueprint-content";
import { initPhoneContent } from "./phone-behavior";
import type { Call, PhoneDeskStrip, PhoneStats } from "./phone-data";
import "./phone-global.css";

export type PhoneContentProps = {
  /** The org's 100 most recent calls, read in the page's server component. */
  deskSettings?: DeskWorkspaceData;
  entries: Call[];
  /** Whole-table counts, not counts over `entries`. */
  stats: PhoneStats;
  /** The Twilio "A call comes in" webhook this deployment answers on. */
  webhookUrl: string;
  twilioConfigured: boolean;
  /** The AI desk's line under the title (2026-10-13; the desktop sheet stopped drawing it 2026-10-16 — the setup tab
   *  says the same, larger). */
  desk: PhoneDeskStrip | null;
};

export function PhoneContent({
  entries,
  deskSettings,
  stats,
  webhookUrl,
  twilioConfigured,
}: PhoneContentProps) {
  // The seed reaches `init` through a ref, NOT through the callback's deps.
  // `useBlueprintContent` re-runs whenever `init` changes identity, and a
  // re-run tears the page down and replays the whole reveal cascade — so the
  // init has to stay referentially stable for the life of the mount. The ref
  // is never written after creation: from the first commit on, the behavior
  // module owns the log and keeps itself in step with the database through
  // `createLeadFromCall`. Navigating away unmounts this component, so the next
  // visit gets a fresh ref holding freshly-queried rows.
  const seedRef = useRef({ entries, stats });

  const init = useCallback(
    (content: HTMLElement) =>
      initPhoneContent(content, {
        entries: seedRef.current.entries,
        stats: seedRef.current.stats,
      }),
    [],
  );
  useBlueprintContent(init);

  return (
    <>
      <DeskWorkspaceHeader settings={deskSettings} />

      {/* banner: provider not configured */}
      {!twilioConfigured && (
        <div className="cfg-banner" id="cfgBanner">
          <span className="cfg-ic">
            <svg className="ic">
              <use href="#i-gear" />
            </svg>
          </span>
          <div className="cfg-body">
            <div className="cfg-t">Twilio isn&apos;t configured</div>
            <div className="cfg-h">Add <code>TWILIO_ACCOUNT_SID</code>, <code>TWILIO_AUTH_TOKEN</code> and <code>TWILIO_PHONE_NUMBER</code>, then point the number&apos;s <b>A call comes in</b> webhook at this URL.</div>
            <div className="cfg-hook">
              <span className="hook-url" id="hookUrl">{webhookUrl}</span>
              <button className="hook-copy" type="button" id="hookCopy">
                <svg className="ic">
                  <use href="#i-dup" />
                </svg>
                Copy
              </button>
            </div>
          </div>
        </div>
      )}

      {/* stats */}
      <div className="stat-grid" id="statGrid"></div>

      {/* call log */}
      <div className="card card--table">
        <div className="tb-head">
          <span className="kpi-lbl">Call log</span>
          <div className="ph-filters" id="phFilters"></div>
        </div>
        <table className="ptable ph-table">
          <thead>
            <tr>
              <th>From</th>
              <th>Direction</th>
              <th>Duration</th>
              <th>Summary</th>
              <th>When</th>
              <th className="th-open"></th>
            </tr>
          </thead>
          <tbody id="callBody"></tbody>
        </table>
      </div>
      {/* The donor pointed this at "the webhook above" — which is only above it
          while the setup banner is on the page. */}
      <div className="pempty is-hidden" id="callEmpty">
        <b>No calls yet</b>
        <br />
        {twilioConfigured
          ? "Your number is connected. The first inbound call will land here, transcribed and summarized."
          : "Wire up your number to the webhook above to start auto-capturing inbound calls as leads."}
      </div>
      <div className="pmenu" id="pMenu"></div>

      {/* Transcript panel — donor overlays, fixed to the viewport */}
      <div className="sheet-bg" id="sheetBg"></div>
      <aside className="sheet" id="sheet">
        <div className="sheet-head">
          <div className="sheet-title" id="sheetTitle">
            —
          </div>
          <button className="sheet-x" type="button" data-sheet="close" aria-label="Close">
            ×
          </button>
        </div>
        <div className="sheet-body" id="sheetBody"></div>
      </aside>
    </>
  );
}
