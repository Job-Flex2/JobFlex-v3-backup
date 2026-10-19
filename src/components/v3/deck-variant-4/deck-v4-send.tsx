"use client";
// DECK ESTIMATOR — VARIANT 4: SEND TO CLIENT. Copied from deck-client-link.tsx (2026-10-18) — the client-design folder
// and the form that makes a link — restyled as the variant's "Send to client" action. Every link the shop has sent,
// newest first: the client's name, what they designed, the stage it stands at, Open for what came back. Above the
// list, the form: the client's name and how to reach them, start from the design on screen or from a blank deck; the
// link comes back with Copy, Text and Email. A link made while the studio is on a proposal belongs to that proposal.

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import type { DeckDesign } from "@/lib/deck/design";
import { CLIENT_STAGES, clientStage, jobLine, STAGE_WORDS, type ClientLinkRow, type ClientStart } from "@/lib/deck/clientDesign";
import { smsHref } from "@/lib/proposalLink";
import { createDeckClientLink, deleteDeckClientLink, listDeckClientLinks } from "@/actions/deckClientDesign";
import { cx } from "./deck-v4-controls";

const agoShort = (iso: string) => {
  const sec = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.round(sec / 60)} min ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)} h ago`;
  return `${Math.round(sec / 86400)} d ago`;
};

type Row = ClientLinkRow & { url: string; message: string };

function Stages({ l }: { l: Row }) {
  const { stage, at } = clientStage(l);
  const idx = CLIENT_STAGES.indexOf(stage);
  const closed = l.expired && stage !== "accepted" && stage !== "proposal" && stage !== "priced";
  const fresh = stage === "returned" && l.unseen;
  return (
    <div className="v4-stages" role="img" aria-label={`Stage: ${STAGE_WORDS[stage]}${at ? `, ${agoShort(at)}` : ""}`} data-client-stage={stage}>
      <span className="v4-stage-track" aria-hidden="true">
        {CLIENT_STAGES.map((k, i) => (
          <i key={k} className={cx("v4-stage-dot", i <= idx && "is-on", fresh && i === idx && "is-new")} title={STAGE_WORDS[k]} />
        ))}
      </span>
      <span className={cx("v4-stage-word", fresh && "is-new")}>
        {closed ? "Link closed" : STAGE_WORDS[stage]}
        {at ? ` · ${agoShort(at)}` : ""}
        {fresh ? " · new" : ""}
      </span>
    </div>
  );
}

export function SendToClient({ design, address, title, clientId, proposalId = null, unseen = 0, onOpened, openHref }: { design: DeckDesign; address: string; title: string; clientId?: string; proposalId?: string | null; unseen?: number; onOpened?: (token: string) => void; openHref: (draftId: string) => string }) {
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [start, setStart] = React.useState<ClientStart>("mine");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [made, setMade] = React.useState<Row | null>(null);
  const [copied, setCopied] = React.useState<string | null>(null);
  const [links, setLinks] = React.useState<Row[] | null>(null);

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
    <details className="v4-pop" onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && void refresh()} data-deck-client-link>
      <summary className={cx("v4-btn", unseen > 0 && "v4-btn--bloom")} data-deck-client-count={unseen}>
        Send to client
        {unseen > 0 ? (
          <span className="v4-count" aria-label={`${unseen} sent back, not opened yet`}>
            {unseen}
          </span>
        ) : null}
      </summary>
      <div className="v4-pop-body v4-pop-body--wide">
        <div className="v4-pop-title">A link for the client to design it</div>
        <p className="v4-hint">They design in 3D on their own page — no prices — and press Send. It comes back here framed to the code and {proposalId ? "updates this proposal" : "becomes a proposal"}.</p>
        <div className="v4-send-form" data-client-link-form>
          <Labelled label="Client's name">
            <input className="v4-in" value={name} autoComplete="off" onChange={(e) => setName(e.target.value)} data-client-link-name />
          </Labelled>
          <div className="v4-grid2">
            <Labelled label="Mobile (to text it)">
              <input className="v4-in" value={phone} inputMode="tel" onChange={(e) => setPhone(e.target.value)} />
            </Labelled>
            <Labelled label="Email (optional)">
              <input className="v4-in" value={email} inputMode="email" onChange={(e) => setEmail(e.target.value)} />
            </Labelled>
          </div>
          <div className="v4-seg" role="radiogroup" aria-label="Where the client starts">
            <button type="button" role="radio" aria-checked={start === "mine"} className={cx("v4-seg-btn", start === "mine" && "is-on")} onClick={() => setStart("mine")} data-client-link-start="mine">From this design</button>
            <button type="button" role="radio" aria-checked={start === "blank"} className={cx("v4-seg-btn", start === "blank" && "is-on")} onClick={() => setStart("blank")} data-client-link-start="blank">From a blank deck</button>
          </div>
          <p className="v4-hint">
            {start === "mine" ? "They see the deck on your screen now and correct it." : "They pick a deck, covered deck, gazebo or pergola and design it from there."} Your address, site, house and lumber stay yours.
          </p>
          <button type="button" className="v4-btn v4-btn--primary" disabled={busy || !name.trim()} onClick={() => void make()} data-client-link-make>
            {busy ? "Making the link…" : "Make the link"}
          </button>
          {error ? <p className="v4-call v4-call--bad" role="alert">{error}</p> : null}
          {made ? (
            <div className="v4-made" data-client-link-made>
              <input className="v4-in" readOnly value={made.url} aria-label="The client's link" onFocus={(e) => e.currentTarget.select()} />
              <div className="v4-acts">
                <button type="button" className="v4-btn v4-btn--sm v4-btn--primary" onClick={() => void copy(made)}>{copied === made.token ? "Copied" : "Copy link"}</button>
                <a className="v4-btn v4-btn--sm" href={smsHref(made.clientPhone, made.message)}>Text it</a>
                <a className="v4-btn v4-btn--sm" href={mailto(made)}>Email it</a>
                <a className="v4-btn v4-btn--sm v4-btn--quiet" href={made.url} target="_blank" rel="noopener">Their page ↗</a>
              </div>
            </div>
          ) : null}
        </div>
        <div className="v4-pop-title v4-pop-title--rule">Links sent{links ? ` · ${returned} back` : ""}</div>
        {links === null ? <div className="v4-empty">Reading…</div> : links.length === 0 ? <div className="v4-empty">No client links yet.</div> : null}
        <div className="v4-rows">
          {(links ?? []).map((l) => (
            <div key={l.token} className={cx("v4-draft", l.unseen && "is-new")} data-client-link-row={l.token} data-client-link-unseen={l.unseen ? "1" : undefined}>
              <div className="v4-draft-text">
                <div className="v4-draft-name">{l.clientName}</div>
                <div className="v4-draft-meta" data-client-link-job>
                  {jobLine(l)}
                  {l.words && (l.proposal || l.words !== l.title) ? ` · ${l.words}` : ""}
                </div>
                <Stages l={l} />
                <div className="v4-draft-meta">
                  link sent {agoShort(l.createdAt)}
                  {l.byName ? ` by ${l.byName}` : ""}
                  {l.note ? ` · “${l.note.length > 80 ? `${l.note.slice(0, 80)}…` : l.note}”` : ""}
                </div>
              </div>
              {l.draftId ? (
                <Link className="v4-btn v4-btn--sm v4-btn--primary" href={openHref(l.draftId) as Route} onClick={() => onOpened?.(l.token)} data-client-link-open>
                  Open
                </Link>
              ) : (
                <button type="button" className="v4-btn v4-btn--sm" onClick={() => void copy(l)} disabled={l.expired}>
                  {copied === l.token ? "Copied" : "Copy"}
                </button>
              )}
              <button type="button" className="v4-btn v4-btn--sm v4-btn--danger" onClick={() => void remove(l)} aria-label={`Close ${l.clientName}'s link`}>
                Close
              </button>
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="v4-field">
      <span className="v4-lbl">
        <span>{label}</span>
      </span>
      {children}
    </label>
  );
}
