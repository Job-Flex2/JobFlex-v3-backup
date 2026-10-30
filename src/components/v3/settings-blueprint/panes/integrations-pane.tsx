"use client";

import { useState } from "react";
import { MetaConnection } from "../meta-connection";
import { GmailConnection } from "./gmail-connection";
import { RampConnection } from "./ramp-connection";
import {
  COMING_SOON_TAB, comingSoonNote, connectionSubTabs, isVisibleSubTab,
  type PaneProps, type SubTabKey,
} from "../settings-data";

// Gmail and Meta. The payment processors (Stripe, Square, Stax) moved to the
// Payments pane on 2026-09-26 (owner). Keep each provider mounted so switching
// tabs retains unsaved fields.
export function IntegrationsPane({ data, sub: wanted, notice }: PaneProps) {
  const { gmail, meta, ramp } = data.integrations;
  const tabs = connectionSubTabs({ gmail: !gmail.comingSoon || gmail.connected || Boolean(gmail.revokedAt) });
  const [sub, setSub] = useState<SubTabKey>(isVisibleSubTab(wanted, tabs) ? (wanted as SubTabKey) : tabs[0].key);
  const [seenWanted, setSeenWanted] = useState(wanted);
  if (wanted !== seenWanted) {
    setSeenWanted(wanted);
    if (isVisibleSubTab(wanted, tabs)) setSub(wanted as SubTabKey);
  }
  const soon: Partial<Record<SubTabKey, boolean>> = { gmail: gmail.comingSoon, meta: meta.comingSoon, ramp: !ramp.enabled && !ramp.connected };
  const names: Partial<Record<SubTabKey, string>> = { gmail: "Gmail sending", meta: "Meta business", ramp: "Ramp cards" };

  return <>
    {soon[sub] && <div className="note note--soon" style={{ marginBottom: "14px" }}>
      <svg className="ic" aria-hidden="true"><use href="#i-bell" /></svg>
      <div><b>{`${names[sub]} — coming soon`}</b><span>{comingSoonNote(names[sub] ?? "")}</span></div>
    </div>}
    <div className="sub">
      {tabs.map(tab => <button key={tab.key} className={tab.key === sub ? "sub-b on" : "sub-b"} type="button" aria-pressed={tab.key === sub} onClick={() => setSub(tab.key)}>
        {tab.label}{soon[tab.key] && <span className="sub-soon">{COMING_SOON_TAB}</span>}
      </button>)}
    </div>
    <div className={sub === "gmail" ? "subpane on" : "subpane"}><GmailConnection data={gmail} notice={notice?.gmail} /></div>
    <div className={sub === "meta" ? "subpane on" : "subpane"}><MetaConnection data={meta} /></div>
    <div className={sub === "ramp" ? "subpane on" : "subpane"}><RampConnection data={ramp} /></div>
  </>;
}
