"use client";
// CLIENT DESIGNS — copied from deck-estimator-blueprint/deck-client-link.tsx for variant 3 (the title block's folder).
//
// The folder (2026-10-13, owner: "in the Deck Studio folder: the client's name and the design"): every link the shop
// has sent, newest first — the client's name, what they designed, where it stands (not opened, opened, designing, sent
// back — the unopened return blooms), who sent the link and when, the proposal it belongs to — and Open for what came
// back. Above the list, the form that makes a new link: the client's name and how to reach them, start from the design
// on screen or from a blank deck; the link comes back with Copy, Text and Email. A link made while the studio is on a
// proposal belongs to that proposal (lib/deck/clientDesign, actions/deckClientDesign).
//
// Variant 3 changes: Open lands on this variant's page (/dashboard/deck-v3), by the router; the sheet's classes.

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { X } from "lucide-react";
import type { DeckDesign } from "@/lib/deck/design";
import { CLIENT_STAGES, clientStage, jobLine, STAGE_WORDS, type ClientLinkRow, type ClientStart } from "@/lib/deck/clientDesign";
import { smsHref } from "@/lib/proposalLink";
import { createDeckClientLink, deleteDeckClientLink, listDeckClientLinks } from "@/actions/deckClientDesign";
import { d3 as s } from "./d3-classes";

const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(" ");
const ago = (iso: string) => {
  const sec = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.round(sec / 60)} min ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)} h ago`;
  return `${Math.round(sec / 86400)} d ago`;
};

type Row = ClientLinkRow & { url: string; message: string };

/** The stage line (lib/deck/clientDesign clientStage): every stage reached is lit, the current one named with its time. */
function Stages({ l }: { l: Row }) {
  const { stage, at } = clientStage(l);
  const idx = CLIENT_STAGES.indexOf(stage);
  const closed = l.expired && stage !== "accepted" && stage !== "proposal" && stage !== "priced";
  return (
    <div className={s.stages} role="img" aria-label={`Stage: ${STAGE_WORDS[stage]}${at ? `, ${ago(at)}` : ""}`} data-client-stage={stage}>
      <span className={s.stageTrack} aria-hidden="true">
        {CLIENT_STAGES.map((k, i) => (
          <i key={k} className={cx(s.stageDot, i <= idx && s.stageOn, i === idx && s.stageNow, i === idx && stage === "returned" && l.unseen && s.stageNew)} title={STAGE_WORDS[k]} />
        ))}
      </span>
      <span className={cx(s.stageWord, stage === "returned" && l.unseen && s.stageWordNew)}>
        {closed ? "Link closed" : STAGE_WORDS[stage]}{at ? ` · ${ago(at)}` : ""}{stage === "returned" && l.unseen ? " · new" : ""}
      </span>
    </div>
  );
}

export function DeckClientLink({ design, address, title, clientId, proposalId = null, unseen = 0, onOpened }: { design: DeckDesign; address: string; title: string; clientId?: string; proposalId?: string | null; unseen?: number; onOpened?: (token: string) => void }) {
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [start, setStart] = React.useState<ClientStart>("mine");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [made, setMade] = React.useState<Row | null>(null);
  const [copied, setCopied] = React.useState<string | null>(null);
  const [links, setLinks] = React.useState<Row[] | null>(null);
  const [making, setMaking] = React.useState(false);

  const refresh = async () => {
    const res = await listDeckClientLinks();
    setLinks(res.ok ? res.links : []);
  };
  const make = async () => {
    setBusy(true);
    setError(null);
    const res = await createDeckClientLink({ clientName: name, clientPhone: phone, clientEmail: email, clientId: clientId ?? null, start, design, address, title, proposalId });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const row: Row = { ...res.link, message: res.message };
    setMade(row);
    setLinks((list) => [row, ...(list ?? []).filter((l) => l.token !== row.token)]);
  };
  const copy = async (l: Row) => {
    try {
      await navigator.clipboard.writeText(l.url);
      setCopied(l.token);
      setTimeout(() => setCopied((t) => (t === l.token ? null : t)), 1600);
    } catch {
      window.prompt("Copy the link:", l.url);
    }
  };
  const remove = async (l: Row) => {
    if (!window.confirm(`Close ${l.clientName}'s link? The page stops opening.${l.draftId ? " The design they sent stays in your drafts." : ""}`)) return;
    const res = await deleteDeckClientLink(l.token);
    if (res.ok) {
      setLinks((list) => (list ?? []).filter((x) => x.token !== l.token));
      if (made?.token === l.token) setMade(null);
    }
  };
  const mailto = (l: Row) => `mailto:${encodeURIComponent(l.clientEmail ?? "")}?subject=${encodeURIComponent("Design your deck")}&body=${encodeURIComponent(l.message)}`;
  const returned = (links ?? []).filter((l) => l.status === "sent").length;

  return (
    <details className={s.drafts} onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && void refresh()} data-deck-client-link>
      <summary className={cx(s.btn, s.btnSm, unseen > 0 && s.btnBloom)} data-deck-client-count={unseen}>
        Client designs{unseen > 0 ? <span className={s.countPill} aria-label={`${unseen} sent back, not opened yet`}>{unseen}</span> : null}
      </summary>
      <div className={cx(s.draftList, s.draftListWide)}>
        <div className={s.folderHead}>
          <div>
            <div className={s.draftName}>The designs your clients sent{links ? ` · ${returned} back` : ""}</div>
            <div className={s.draftMeta}>They design in 3D on their own page — no prices — and press Send. It lands here, framed to the code, and {proposalId ? "updates this proposal" : "becomes a proposal"}.</div>
          </div>
          <button type="button" className={cx(s.btn, s.btnSm, making ? s.btnOn : s.btnPrimary)} onClick={() => setMaking((v) => !v)} data-client-link-new aria-expanded={making}>
            {making ? "Close" : "New link"}
          </button>
        </div>
        {making ? (
          <div className={s.folderForm} data-client-link-form>
            <input className={s.in} value={name} placeholder="Client's name" aria-label="Client's name" autoComplete="off" onChange={(e) => setName(e.target.value)} data-client-link-name />
            <div className={s.folderPair}>
              <input className={s.in} value={phone} placeholder="Mobile (to text it)" aria-label="Client's mobile" inputMode="tel" onChange={(e) => setPhone(e.target.value)} />
              <input className={s.in} value={email} placeholder="Email (optional)" aria-label="Client's email" inputMode="email" onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className={s.seg} role="radiogroup" aria-label="Where the client starts">
              <button type="button" role="radio" aria-checked={start === "mine"} className={cx(s.segBtn, start === "mine" && s.segOn)} onClick={() => setStart("mine")} data-client-link-start="mine">From this design</button>
              <button type="button" role="radio" aria-checked={start === "blank"} className={cx(s.segBtn, start === "blank" && s.segOn)} onClick={() => setStart("blank")} data-client-link-start="blank">From a blank deck</button>
            </div>
            <div className={s.draftMeta}>
              {start === "mine" ? "They see the deck on your screen now and correct it." : "They pick a deck, covered deck, gazebo or pergola and design it from there."} Your address, site, house and lumber stay yours.{proposalId ? " What they send back updates this proposal." : ""}
            </div>
            <button type="button" className={cx(s.btn, s.btnSm, s.btnPrimary)} disabled={busy || !name.trim()} onClick={() => void make()} data-client-link-make>
              {busy ? "Making the link…" : "Make the link"}
            </button>
            {error ? <div className={cx(s.call, s.callBad)} role="alert">{error}</div> : null}
            {made ? (
              <div className={s.folderMade} data-client-link-made>
                <input className={s.in} readOnly value={made.url} aria-label="The client's link" onFocus={(e) => e.currentTarget.select()} />
                <div className={s.actRow}>
                  <button type="button" className={cx(s.btn, s.btnSm, s.btnPrimary)} onClick={() => void copy(made)}>{copied === made.token ? "Copied" : "Copy link"}</button>
                  <a className={cx(s.btn, s.btnSm)} href={smsHref(made.clientPhone, made.message)}>Text it</a>
                  <a className={cx(s.btn, s.btnSm)} href={mailto(made)}>Email it</a>
                  <a className={cx(s.btn, s.btnSm, s.btnGhost)} href={made.url} target="_blank" rel="noopener">See their page ↗</a>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        {links === null ? <div className={s.draftEmpty}>Reading…</div> : links.length === 0 ? <div className={s.draftEmpty}>No client links yet — press New link.</div> : null}
        {(links ?? []).map((l) => {
          return (
            <div key={l.token} className={cx(s.draftRow, l.unseen && s.draftRowNew)} data-client-link-row={l.token} data-client-link-unseen={l.unseen ? "1" : undefined}>
              <div style={{ minWidth: 0 }}>
                <div className={s.draftName}>{l.clientName}</div>
                <div className={s.draftMeta} data-client-link-job>{jobLine(l)}{l.words && (l.proposal || l.words !== l.title) ? ` · ${l.words}` : ""}</div>
                <Stages l={l} />
                <div className={s.draftMeta}>
                  link sent {ago(l.createdAt)}{l.byName ? ` by ${l.byName}` : ""}
                  {l.note ? ` · “${l.note.length > 80 ? `${l.note.slice(0, 80)}…` : l.note}”` : ""}
                </div>
              </div>
              {l.draftId ? (
                <Link className={cx(s.btn, s.btnSm, s.btnPrimary)} href={`/dashboard/deck-v3?draft=${l.draftId}` as Route} onClick={() => onOpened?.(l.token)} data-client-link-open>Open</Link>
              ) : (
                <button type="button" className={cx(s.btn, s.btnSm)} onClick={() => void copy(l)} disabled={l.expired}>{copied === l.token ? "Copied" : "Copy"}</button>
              )}
              <button type="button" className={cx(s.btn, s.btnSm, s.btnDanger)} onClick={() => void remove(l)} aria-label={`Close ${l.clientName}'s link`}>
                <X size={14} strokeWidth={2.5} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </details>
  );
}
