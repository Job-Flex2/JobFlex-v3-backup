"use client";
// DECK ESTIMATOR — VARIANT 5: SEND TO CLIENT. Copied from deck-client-link.tsx (2026-10-18) and re-dressed for this
// variant's finish row: the same folder of client links (the client's name, what they designed, where it stands, Open
// for what came back) and the same form that makes a new link (from this design or a blank deck; Copy, Text, Email).
// Here the form comes first — the button says "Send to client" — and the folder sits under it. A link made while the
// studio is on a proposal belongs to that proposal (lib/deck/clientDesign, actions/deckClientDesign).

import * as React from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import type { DeckDesign } from "@/lib/deck/design";
import { CLIENT_STAGES, clientStage, jobLine, STAGE_WORDS, type ClientLinkRow, type ClientStart } from "@/lib/deck/clientDesign";
import { smsHref } from "@/lib/proposalLink";
import { createDeckClientLink, deleteDeckClientLink, listDeckClientLinks } from "@/actions/deckClientDesign";
import { cx } from "./deck-v5-controls";

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
  return (
    <div className="v5-stages" role="img" aria-label={`Stage: ${STAGE_WORDS[stage]}${at ? `, ${agoShort(at)}` : ""}`} data-client-stage={stage}>
      <span className="v5-stage-track" aria-hidden="true">
        {CLIENT_STAGES.map((k, i) => (
          <i key={k} className={cx("v5-stage-dot", i <= idx && "is-on", i === idx && stage === "returned" && l.unseen && "is-new")} title={STAGE_WORDS[k]} />
        ))}
      </span>
      <span className={cx("v5-stage-word", stage === "returned" && l.unseen && "is-new")}>
        {closed ? "Link closed" : STAGE_WORDS[stage]}{at ? ` · ${agoShort(at)}` : ""}{stage === "returned" && l.unseen ? " · new" : ""}
      </span>
    </div>
  );
}

export function SendToClient({ design, address, title, clientId, proposalId = null, unseen = 0, onOpened, openHref }: { design: DeckDesign; address: string; title: string; clientId?: string; proposalId?: string | null; unseen?: number; onOpened?: (token: string) => void; openHref: (draftId: string) => string }) {
  const router = useRouter();
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
    const res = await listDeckClientLinks().catch(() => ({ ok: false as const }));
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
    <details className="v5-pop v5-pop--up" onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && void refresh()} data-deck-client-link>
      <summary className={cx("v5-btn", unseen > 0 && "v5-btn--bloom")} data-deck-client-count={unseen}>
        Send to client
        {unseen > 0 ? <span className="v5-count" aria-label={`${unseen} sent back, not opened yet`}>{unseen}</span> : null}
      </summary>
      <div className="v5-pop-panel v5-pop-panel--wide" role="group" aria-label="Send the design to a client">
        <div className="v5-pop-title">Send a design link</div>
        <p className="v5-hint">They design in 3D on their own page — no prices — and press Send. It comes back here framed to the code and {proposalId ? "updates this proposal" : "becomes a proposal"}.</p>
        <div className="v5-send-form" data-client-link-form>
          <Field2 label="Client's name">
            <input className="v5-in" value={name} placeholder="Full name" autoComplete="off" onChange={(e) => setName(e.target.value)} data-client-link-name />
          </Field2>
          <div className="v5-grid2">
            <Field2 label="Mobile">
              <input className="v5-in" value={phone} placeholder="To text it" inputMode="tel" onChange={(e) => setPhone(e.target.value)} />
            </Field2>
            <Field2 label="Email">
              <input className="v5-in" value={email} placeholder="Optional" inputMode="email" onChange={(e) => setEmail(e.target.value)} />
            </Field2>
          </div>
          <div className="v5-seg" role="radiogroup" aria-label="Where the client starts">
            <button type="button" role="radio" aria-checked={start === "mine"} className={cx("v5-seg-btn", start === "mine" && "is-on")} onClick={() => setStart("mine")} data-client-link-start="mine">From this design</button>
            <button type="button" role="radio" aria-checked={start === "blank"} className={cx("v5-seg-btn", start === "blank" && "is-on")} onClick={() => setStart("blank")} data-client-link-start="blank">From a blank deck</button>
          </div>
          <p className="v5-hint">
            {start === "mine" ? "They see this deck and correct it." : "They pick a deck, covered deck, gazebo or pergola and design it."} Your address, site, house and lumber stay yours.{proposalId ? " What they send back updates this proposal." : ""}
          </p>
          <button type="button" className="v5-btn v5-btn--primary" disabled={busy || !name.trim()} onClick={() => void make()} data-client-link-make>
            {busy ? "Making the link…" : "Make the link"}
          </button>
          {error ? <p className="v5-call v5-call--bad" role="alert">{error}</p> : null}
          {made ? (
            <div className="v5-made" data-client-link-made>
              <input className="v5-in" readOnly value={made.url} aria-label="The client's link" onFocus={(e) => e.currentTarget.select()} />
              <div className="v5-acts">
                <button type="button" className="v5-btn v5-btn--sm v5-btn--primary" onClick={() => void copy(made)}>{copied === made.token ? "Copied" : "Copy link"}</button>
                <a className="v5-btn v5-btn--sm" href={smsHref(made.clientPhone, made.message)}>Text it</a>
                <a className="v5-btn v5-btn--sm" href={mailto(made)}>Email it</a>
                <a className="v5-btn v5-btn--sm" href={made.url} target="_blank" rel="noopener">Their page ↗</a>
              </div>
            </div>
          ) : null}
        </div>
        <div className="v5-pop-title v5-pop-title--rule">Sent so far{links ? ` · ${returned} back` : ""}</div>
        {links === null ? <div className="v5-empty">Reading…</div> : links.length === 0 ? <div className="v5-empty">No client links yet.</div> : null}
        <div className="v5-pop-list">
          {(links ?? []).map((l) => (
            <div key={l.token} className={cx("v5-list-row", l.unseen && "is-new")} data-client-link-row={l.token} data-client-link-unseen={l.unseen ? "1" : undefined}>
              <div className="v5-list-text">
                <div className="v5-list-name">{l.clientName}</div>
                <div className="v5-list-meta" data-client-link-job>{jobLine(l)}{l.words && (l.proposal || l.words !== l.title) ? ` · ${l.words}` : ""}</div>
                <Stages l={l} />
                <div className="v5-list-meta">
                  link sent {agoShort(l.createdAt)}{l.byName ? ` by ${l.byName}` : ""}
                  {l.note ? ` · “${l.note.length > 80 ? `${l.note.slice(0, 80)}…` : l.note}”` : ""}
                </div>
              </div>
              {l.draftId ? (
                <a
                  className="v5-btn v5-btn--sm v5-btn--primary"
                  href={openHref(l.draftId)}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                    e.preventDefault();
                    onOpened?.(l.token);
                    router.push(openHref(l.draftId!) as Route);
                  }}
                  data-client-link-open
                >
                  Open
                </a>
              ) : (
                <button type="button" className="v5-btn v5-btn--sm" onClick={() => void copy(l)} disabled={l.expired}>{copied === l.token ? "Copied" : "Copy"}</button>
              )}
              <button type="button" className="v5-btn v5-btn--sm v5-btn--icon" onClick={() => void remove(l)} aria-label={`Close ${l.clientName}'s link`} title="Close the link">
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
              </button>
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}

function Field2({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="v5-field">
      <span className="v5-lbl"><span>{label}</span></span>
      {children}
    </label>
  );
}
