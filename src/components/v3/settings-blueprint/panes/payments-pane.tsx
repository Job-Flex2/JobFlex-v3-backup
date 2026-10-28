"use client";

// Settings blueprint — PAYMENTS pane (rebuilt 2026-09-26, owner).
//
// The three payment processors live here: Stripe, Square and Stax, each the
// full connection card that used to sit under Integrations (connect, API key,
// payment options, permissions, webhook, disconnect), behind the same sub-tab
// strip. Everything this pane held before — the Get paid rows, bank transfer,
// the currency / deposit defaults and the receipts automation — was removed
// at the owner's request. Their saved values stay in the database untouched.
//
// Stripe's and Square's OAuth hand-offs return to ?tab=payments with a
// ?stripe= / ?square= status. That note shows once, and the pane opens on the
// provider it is about.

import { useState } from "react";

import { ProcessorSubpane } from "./processor-subpane";
import { StaxSubpane } from "./stax-subpane";
import { FinancingSubpane } from "./financing-subpane";
import {
  COMING_SOON_TAB,
  paymentSubTabs,
  PROCESSOR_OAUTH_NOTICE,
  comingSoonNote,
  isVisibleSubTab,
  type PaneProps,
  type SubTabKey,
} from "../settings-data";

export function PaymentsPane({ data, sub: wanted, notice }: PaneProps) {
  const { stripe, square, connections } = data.integrations;
  const financing = data.payments.financing;
  const tabs = paymentSubTabs({ financing: financing !== null });
  const returnedFrom: SubTabKey | undefined = notice?.square ? "square" : notice?.stripe ? "stripe" : notice?.financing && financing ? "financing" : undefined;
  const [sub, setSub] = useState<SubTabKey>(
    isVisibleSubTab(wanted, tabs) ? (wanted as SubTabKey) : (returnedFrom ?? "stripe"),
  );
  // A later jump to a provider (?sub=) lands on its tab.
  const [seenWanted, setSeenWanted] = useState(wanted);
  if (wanted !== seenWanted) {
    setSeenWanted(wanted);
    if (isVisibleSubTab(wanted, tabs)) setSub(wanted as SubTabKey);
  }

  const oauth = notice?.stripe
    ? { name: "Stripe", ...PROCESSOR_OAUTH_NOTICE[notice.stripe] }
    : notice?.square
      ? { name: "Square", ...PROCESSOR_OAUTH_NOTICE[notice.square] }
      : null;
  const soon: Partial<Record<SubTabKey, boolean>> = { stripe: stripe.comingSoon, square: square.comingSoon, stax: false };
  const names: Partial<Record<SubTabKey, string>> = { stripe: "Stripe", square: "Square", stax: "Stax" };

  return (
    <>
      {/* What the last OAuth round trip came back with — once, on this load. */}
      {oauth && oauth.title ? (
        <div className={oauth.tone === "ok" ? "note note--ok" : "note"} role="status" style={{ marginBottom: "14px" }}>
          <svg className="ic">
            <use href="#i-bell" />
          </svg>
          <div>
            <b>{`${oauth.name} — ${oauth.title}`}</b>
            <span>{oauth.sub}</span>
          </div>
        </div>
      ) : null}
      {soon[sub] ? (
        <div className="note note--soon" style={{ marginBottom: "14px" }}>
          <svg className="ic" aria-hidden="true">
            <use href="#i-bell" />
          </svg>
          <div>
            <b>{`${names[sub]} — coming soon`}</b>
            <span>{comingSoonNote(names[sub] ?? "")}</span>
          </div>
        </div>
      ) : null}
      <div className="sub">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            className={tab.key === sub ? "sub-b on" : "sub-b"}
            type="button"
            aria-pressed={tab.key === sub}
            onClick={() => setSub(tab.key)}
          >
            {tab.label}
            {soon[tab.key] ? <span className="sub-soon">{COMING_SOON_TAB}</span> : null}
          </button>
        ))}
      </div>
      {/* All three stay mounted, so a half-typed key survives a tab switch. */}
      <div className={sub === "stripe" ? "subpane on" : "subpane"}>
        <ProcessorSubpane d={stripe} conns={connections} />
      </div>
      <div className={sub === "square" ? "subpane on" : "subpane"}>
        <ProcessorSubpane d={square} conns={connections} />
      </div>
      <div className={sub === "stax" ? "subpane on" : "subpane"}>
        <StaxSubpane conns={connections} />
      </div>
      {financing ? (
        <div className={sub === "financing" ? "subpane on" : "subpane"}>
          <FinancingSubpane d={financing} returned={notice?.financing === "back"} />
        </div>
      ) : null}
    </>
  );
}
