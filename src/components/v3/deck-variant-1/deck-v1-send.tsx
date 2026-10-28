"use client";
// SEND TO CLIENT — Variant 1's finish-screen panel. The logic is COPIED FROM deck-client-link.tsx (DeckClientLink):
// the client's name and how to reach them, start from the design on screen or a blank deck, the link with Copy,
// Text and Email, and every link the shop has sent with its stage and Open for what came back. A link made while
// the studio is on a proposal belongs to that proposal (lib/deck/clientDesign, actions/deckClientDesign).
// Restyled for this variant's plain stylesheet; an opened return opens in the deck estimator (this studio).

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { Copy, ExternalLink, Mail, MessageSquare, X } from "lucide-react";
import type { DeckDesign } from "@/lib/deck/design";
import { CLIENT_STAGES, clientStage, jobLine, STAGE_WORDS, type ClientLinkRow, type ClientStart } from "@/lib/deck/clientDesign";
import { smsHref } from "@/lib/proposalLink";
import { createDeckClientLink, deleteDeckClientLink, listDeckClientLinks } from "@/actions/deckClientDesign";
import { cx } from "./deck-v1-parts";

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
    <div className="v1-stages" role="img" aria-label={`Stage: ${STAGE_WORDS[stage]}${at ? `, ${agoShort(at)}` : ""}`} data-client-stage={stage}>
      <span className="v1-stage-track" aria-hidden="true">
        {CLIENT_STAGES.map((k, i) => (
          <i key={k} className={cx("v1-stage-dot", i <= idx && "is-on", fresh && i === idx && "is-new")} title={STAGE_WORDS[k]} />
        ))}
      </span>
      <span className={cx("v1-stage-word", fresh && "is-new")}>
        {closed ? "Link closed" : STAGE_WORDS[stage]}
        {at ? ` · ${agoShort(at)}` : ""}
        {fresh ? " · new" : ""}
      </span>
    </div>
  );
}

export interface SendPrefill { name: string; phone: string | null; email: string | null }

export function DeckV1Send({ design, address, title, clientId, proposalId = null, prefill = null, onOpened, onClose }: { design: DeckDesign; address: string; title: string; clientId?: string; proposalId?: string | null; /** The client this design is for, already known (the lead, the link it came through): the fields start filled (owner, 2026-10-28). */ prefill?: SendPrefill | null; onOpened?: (token: string) => void; onClose: () => void }) {
  const [name, setName] = React.useState(prefill?.name ?? "");
  const [phone, setPhone] = React.useState(prefill?.phone ?? "");
  const [email, setEmail] = React.useState(prefill?.email ?? "");
  const [start, setStart] = React.useState<ClientStart>("mine");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [made, setMade] = React.useState<Row | null>(null);
  const [copied, setCopied] = React.useState<string | null>(null);
  const [links, setLinks] = React.useState<Row[] | null>(null);

  React.useEffect(() => {
    let alive = true;
    void listDeckClientLinks().then((res) => {
      if (alive) setLinks(res.ok ? res.links : []);
    });
    return () => {
      alive = false;
    };
  }, []);
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
    <section className="v1-send" aria-label="Send to client" data-deck-client-link>
      <div className="v1-send-head">
        <h3 className="v1-h3">Send to client</h3>
        <button type="button" className="v1-icon-btn" onClick={onClose} aria-label="Close Send to client">
          <X size={18} strokeWidth={2.5} aria-hidden="true" />
        </button>
      </div>
      <p className="v1-hint">They design it in 3D on their own page — no prices — and press Send. It comes back here as a draft, framed to the code{proposalId ? ", and updates this proposal" : ""}.</p>
      <div className="v1-send-form" data-client-link-form>
        <label className="v1-field v1-field-wide">
          <span className="v1-lbl"><span>Client&apos;s name</span></span>
          <input className="v1-in" value={name} autoComplete="off" onChange={(e) => setName(e.target.value)} data-client-link-name />
        </label>
        <div className="v1-grid2">
          <label className="v1-field">
            <span className="v1-lbl"><span>Mobile</span><span className="v1-lbl-aside">to text it</span></span>
            <input className="v1-in" value={phone} inputMode="tel" onChange={(e) => setPhone(e.target.value)} />
          </label>
          <label className="v1-field">
            <span className="v1-lbl"><span>Email</span><span className="v1-lbl-aside">optional</span></span>
            <input className="v1-in" value={email} inputMode="email" onChange={(e) => setEmail(e.target.value)} />
          </label>
        </div>
        <div className="v1-seg" role="radiogroup" aria-label="Where the client starts">
          <button type="button" role="radio" aria-checked={start === "mine"} className={cx("v1-seg-btn", start === "mine" && "is-on")} onClick={() => setStart("mine")} data-client-link-start="mine">From this design</button>
          <button type="button" role="radio" aria-checked={start === "blank"} className={cx("v1-seg-btn", start === "blank" && "is-on")} onClick={() => setStart("blank")} data-client-link-start="blank">From a blank deck</button>
        </div>
        <p className="v1-hint">{start === "mine" ? "They see this deck and correct it." : "They pick a deck, covered deck, gazebo or pergola and design it."} Your address, site, house and lumber stay yours.</p>
        <div className="v1-row-acts">
          <button type="button" className="v1-btn v1-btn-primary" disabled={busy || !name.trim()} onClick={() => void make()} data-client-link-make>
            {busy ? "Making the link…" : "Make the link"}
          </button>
        </div>
        {error ? <p className="v1-call v1-call-bad" role="alert">{error}</p> : null}
        {made ? (
          <div className="v1-send-made" data-client-link-made>
            <input className="v1-in" readOnly value={made.url} aria-label="The client's link" onFocus={(e) => e.currentTarget.select()} />
            <div className="v1-row-acts">
              <button type="button" className="v1-btn v1-btn-sm" onClick={() => void copy(made)}><Copy size={15} aria-hidden="true" />{copied === made.token ? "Copied" : "Copy link"}</button>
              <a className="v1-btn v1-btn-sm" href={smsHref(made.clientPhone, made.message)}><MessageSquare size={15} aria-hidden="true" />Text it</a>
              <a className="v1-btn v1-btn-sm" href={mailto(made)}><Mail size={15} aria-hidden="true" />Email it</a>
              <a className="v1-btn v1-btn-sm v1-btn-quiet" href={made.url} target="_blank" rel="noopener">Their page<ExternalLink size={14} aria-hidden="true" /></a>
            </div>
          </div>
        ) : null}
      </div>
      <div className="v1-send-list">
        <div className="v1-send-list-head">
          <span className="v1-h4">Links sent</span>
          {links ? <span className="v1-meta">{returned} sent back</span> : null}
        </div>
        {links === null ? <p className="v1-meta">Reading…</p> : links.length === 0 ? <p className="v1-meta">No client links yet.</p> : null}
        {(links ?? []).map((l) => (
          <div key={l.token} className={cx("v1-send-row", l.unseen && "is-new")} data-client-link-row={l.token}>
            <div className="v1-send-row-text">
              <div className="v1-send-name">{l.clientName}</div>
              <div className="v1-meta">{jobLine(l)}{l.words && (l.proposal || l.words !== l.title) ? ` · ${l.words}` : ""}</div>
              <Stages l={l} />
              <div className="v1-meta">
                link sent {agoShort(l.createdAt)}{l.byName ? ` by ${l.byName}` : ""}
                {l.note ? ` · “${l.note.length > 80 ? `${l.note.slice(0, 80)}…` : l.note}”` : ""}
              </div>
            </div>
            {l.draftId ? (
              <Link className="v1-btn v1-btn-sm" href={`/dashboard/deck-estimator?draft=${l.draftId}` as Route} onClick={() => onOpened?.(l.token)} data-client-link-open>Open</Link>
            ) : (
              <button type="button" className="v1-btn v1-btn-sm" onClick={() => void copy(l)} disabled={l.expired}>{copied === l.token ? "Copied" : "Copy"}</button>
            )}
            <button type="button" className="v1-icon-btn v1-icon-danger" onClick={() => void remove(l)} aria-label={`Close ${l.clientName}'s link`}>
              <X size={16} strokeWidth={2.5} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
