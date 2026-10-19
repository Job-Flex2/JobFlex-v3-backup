"use client";
// DECK ESTIMATOR — VARIANT 2, SEND TO CLIENT. Copied from deck-client-link.tsx (2026-10-18) with the same server
// actions and the same rules — every link the shop has sent, newest first, the stage it stands at, Open for what came
// back; above it the form that makes a new link (from this design or a blank deck) with Copy, Text and Email — laid
// out as the inspector's panel instead of a drop-down. "Open" stays in this variant.
//
// (CLIENT DESIGNS, owner 2026-10-13: "in the Deck Studio folder: the client's name and the design".)

import * as React from "react";
import type { DeckDesign } from "@/lib/deck/design";
import { CLIENT_STAGES, clientStage, jobLine, STAGE_WORDS, type ClientLinkRow, type ClientStart } from "@/lib/deck/clientDesign";
import { smsHref } from "@/lib/proposalLink";
import { createDeckClientLink, deleteDeckClientLink, listDeckClientLinks } from "@/actions/deckClientDesign";
import { cx } from "./deck-v2-controls";

const agoShort = (iso: string) => {
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
  const fresh = stage === "returned" && l.unseen;
  return (
    <div className="v2-stages" role="img" aria-label={`Stage: ${STAGE_WORDS[stage]}${at ? `, ${agoShort(at)}` : ""}`} data-client-stage={stage}>
      <span className="v2-stage-track" aria-hidden="true">
        {CLIENT_STAGES.map((k, i) => (
          <i key={k} className={cx("v2-stage-dot", i <= idx && "is-on", i === idx && fresh && "is-new")} title={STAGE_WORDS[k]} />
        ))}
      </span>
      <span className={cx("v2-stage-word", fresh && "is-new")}>
        {closed ? "Link closed" : STAGE_WORDS[stage]}
        {at ? ` · ${agoShort(at)}` : ""}
        {fresh ? " · new" : ""}
      </span>
    </div>
  );
}

export function DeckV2ClientLinks({ design, address, title, clientId, proposalId = null, onOpened, onOpenDraft }: { design: DeckDesign; address: string; title: string; clientId?: string; proposalId?: string | null; onOpened?: (token: string) => void; onOpenDraft: (draftId: string) => void }) {
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [start, setStart] = React.useState<ClientStart>("mine");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [made, setMade] = React.useState<Row | null>(null);
  const [copied, setCopied] = React.useState<string | null>(null);
  const [links, setLinks] = React.useState<Row[] | null>(null);

  React.useEffect(() => {
    let alive = true;
    void listDeckClientLinks()
      .then((res) => alive && setLinks(res.ok ? res.links : []))
      .catch(() => alive && setLinks([]));
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
    <div className="v2-stack" data-deck-client-link>
      <p className="v2-lead">The client designs it in 3D on their own page — no prices — and presses Send. It comes back here framed to the code, and {proposalId ? "updates this proposal" : "becomes a proposal"}.</p>
      <div className="v2-group" data-client-link-form>
        <Lbl text="Client's name">
          <input className="v2-in" value={name} placeholder="Full name" autoComplete="off" onChange={(e) => setName(e.target.value)} data-client-link-name />
        </Lbl>
        <div className="v2-grid2">
          <Lbl text="Mobile">
            <input className="v2-in" value={phone} placeholder="To text it" inputMode="tel" onChange={(e) => setPhone(e.target.value)} />
          </Lbl>
          <Lbl text="Email">
            <input className="v2-in" value={email} placeholder="Optional" inputMode="email" onChange={(e) => setEmail(e.target.value)} />
          </Lbl>
        </div>
        <div className="v2-seg" role="radiogroup" aria-label="Where the client starts">
          <button type="button" role="radio" aria-checked={start === "mine"} className={cx("v2-seg-btn", start === "mine" && "is-on")} onClick={() => setStart("mine")} data-client-link-start="mine">From this design</button>
          <button type="button" role="radio" aria-checked={start === "blank"} className={cx("v2-seg-btn", start === "blank" && "is-on")} onClick={() => setStart("blank")} data-client-link-start="blank">From a blank deck</button>
        </div>
        <p className="v2-hint">
          {start === "mine" ? "They see the deck on your screen now and correct it." : "They pick a deck, covered deck, gazebo or pergola and design it from there."} Your address, site, house and lumber stay yours.{proposalId ? " What they send back updates this proposal." : ""}
        </p>
        <button type="button" className="v2-btn v2-btn-primary v2-btn-block" disabled={busy || !name.trim()} onClick={() => void make()} data-client-link-make>
          {busy ? "Making the link…" : "Make the link"}
        </button>
        {error ? <p className="v2-call is-bad" role="alert">{error}</p> : null}
        {made ? (
          <div className="v2-made" data-client-link-made>
            <input className="v2-in" readOnly value={made.url} aria-label="The client's link" onFocus={(e) => e.currentTarget.select()} />
            <div className="v2-acts">
              <button type="button" className="v2-btn v2-btn-sm v2-btn-primary" onClick={() => void copy(made)}>{copied === made.token ? "Copied" : "Copy link"}</button>
              <a className="v2-btn v2-btn-sm" href={smsHref(made.clientPhone, made.message)}>Text it</a>
              <a className="v2-btn v2-btn-sm" href={mailto(made)}>Email it</a>
              <a className="v2-btn v2-btn-sm" href={made.url} target="_blank" rel="noopener">Their page</a>
            </div>
          </div>
        ) : null}
      </div>

      <div className="v2-sub-title">Sent links{links ? ` · ${returned} came back` : ""}</div>
      {links === null ? <p className="v2-empty">Reading…</p> : links.length === 0 ? <p className="v2-empty">No client links yet.</p> : null}
      <div className="v2-rows">
        {(links ?? []).map((l) => (
          <div key={l.token} className={cx("v2-row", l.unseen && "is-new")} data-client-link-row={l.token} data-client-link-unseen={l.unseen ? "1" : undefined}>
            <div className="v2-row-main">
              <div className="v2-row-name">{l.clientName}</div>
              <div className="v2-row-meta" data-client-link-job>{jobLine(l)}{l.words && (l.proposal || l.words !== l.title) ? ` · ${l.words}` : ""}</div>
              <Stages l={l} />
              <div className="v2-row-meta">
                link sent {agoShort(l.createdAt)}{l.byName ? ` by ${l.byName}` : ""}
                {l.note ? ` · “${l.note.length > 80 ? `${l.note.slice(0, 80)}…` : l.note}”` : ""}
              </div>
            </div>
            <div className="v2-row-acts">
              {l.draftId ? (
                <button type="button" className="v2-btn v2-btn-sm v2-btn-primary" onClick={() => { onOpened?.(l.token); onOpenDraft(l.draftId!); }} data-client-link-open>Open</button>
              ) : (
                <button type="button" className="v2-btn v2-btn-sm" onClick={() => void copy(l)} disabled={l.expired}>{copied === l.token ? "Copied" : "Copy"}</button>
              )}
              <button type="button" className="v2-btn v2-btn-sm v2-btn-quiet" onClick={() => void remove(l)} aria-label={`Close ${l.clientName}'s link`}>Close link</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Lbl({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <label className="v2-field">
      <span className="v2-lbl">
        <span>{text}</span>
      </span>
      {children}
    </label>
  );
}
