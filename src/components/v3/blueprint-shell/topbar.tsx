"use client";

// Blueprint shell — topbar. Donor markup, verbatim.
//
// This is the union of both donors' topbars: the newer proposals donor's
// mobile burger (its drawer is the only way to reach the nav under 860px —
// the older dashboard donor simply hid the sidebar with no way back) plus the
// dashboard donor's ⌘K chip, which the proposals donor dropped but
// decisions.md still lists as part of the mono annotation layer.

// The search field was a dead `<input>` and the ⌘K chip was decoration. Both
// now open the command palette, which the shell renders alongside this bar.
// A button, not an input: the field never accepted typing, so presenting it as
// something you type into was the lie. It opens the thing you type into.

import { canOpen } from "./nav-map";
import { useNavIdentity, useNavLocked } from "./nav-role";
import { ACTIVE_ENGINE_HREFS } from "@/components/v3/estimators-blueprint/estimators-data";
import { NotificationBell } from "./notification-bell";

export function Topbar() {
  const { role } = useNavIdentity();
  // Every engine the picker offers sits outside a field worker's allow-list, so
  // the app's most prominent CTA would open a dialog whose every card bounces
  // them back to Jobs. Asked of the engine list itself so a new engine cannot
  // leave this behind. The production topbar strips the same controls from
  // limited roles (components/layout/Topbar.tsx, `stripped`).
  const locked = useNavLocked();
  const canEstimate = ACTIVE_ENGINE_HREFS.some((href) => canOpen(role, href, locked));

  const openPalette = () => {
    document.dispatchEvent(new CustomEvent("jf:command-palette"));
  };
  const openPicker = () => {
    document.dispatchEvent(new CustomEvent("jf:estimator-picker"));
  };

  return (
    <header className="topbar">
      <button className="icon-btn nav-burger" id="navBurger" data-tour="nav-menu" type="button" aria-label="Open navigation">
        <svg className="ic">
          <use href="#i-menu" />
        </svg>
      </button>
      {/* The ⌘K chip is gone by request. It came from the dashboard donor and
          decisions.md lists it under the mono annotation layer, so this is a
          deliberate departure rather than a slip: the shortcut still works and
          is still advertised, in the accessible name instead of as a plate in
          the bar. */}
      <button className="search" type="button" onClick={openPalette} aria-label="Search — ⌘K">
        <svg className="ic">
          <use href="#i-search" />
        </svg>
        <span className="search-ph">Search clients, proposals, leads…</span>
      </button>

      <div className="topbar-right">
        {/* The app's most prominent CTA was a bare <button> with no onClick,
            no type and no id — the only thing touching it was the press
            animation, so it looked responsive and did nothing. It then pointed
            straight at Smart Proposal, which quietly decided FOR the user that
            every estimate is an AI one. It now opens the estimator picker, so
            the engine is a choice: Roof, Fence, Manual or Smart Proposal.
            A dumb dispatcher, like the ⌘K chip beside it — the dialog owns its
            own state and is mounted once in the shell. */}
        {canEstimate && (
          <button className="btn btn-primary" type="button" onClick={openPicker} aria-label="New Estimate">
            <svg className="ic">
              <use href="#i-plus" />
            </svg>
            {/* Wrapped so the handheld topbar can shrink the CTA to its plus
                glyph (blueprint.module.css ≤560px) without losing the name —
                aria-label above keeps it. */}
            <span className="cta-label">New Estimate</span>
          </button>
        )}
        {/* The bell now has a real feed — see ./notification-bell.tsx. It used
            to open the command palette because no notification surface existed
            on the promoted routes; the only feed in the codebase was mounted by
            the legacy topbar and was manager-gated, so a field worker had no
            in-app notification surface at all. */}
        {/* Help — the launcher for the composer this shell mounts, at EVERY
            width. It used to be the handheld half of a pair, with a floating
            plate above 860px; the plate is retired, because a globally mounted
            button in the bottom-right corner loses that corner to the page —
            to whatever a handheld surface pins to the bottom of the screen,
            and on the desk to FloatingCostsCard, permanent furniture on the
            proposal editor. A top bar is the one corner nothing else claims.
            `.icon-btn` draws it at the bar's own 40px like the bell beside it;
            the widget's stylesheet adds the 44px hit floor without changing
            the plate, so the bar's rhythm is untouched. */}
        <NotificationBell />
      </div>
    </header>
  );
}
