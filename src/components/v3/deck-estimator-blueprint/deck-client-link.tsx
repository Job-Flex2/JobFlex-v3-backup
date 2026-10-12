"use client";
// SEND THE CLIENT A LINK TO DESIGN IT (2026-10-11, lib/deck/clientDesign).
// Beside the studio's Drafts: the client's name and how to reach them, start
// from the design on screen or from a blank deck, and the link comes back
// with Copy, Text and Email. Under it, the shop's links and where each one
// stands — not opened, opened, designing, sent back (with its draft to open).

import * as React from "react";
import type { Route } from "next";
import type { DeckDesign } from "@/lib/deck/design";
import type { ClientLinkRow, ClientStart } from "@/lib/deck/clientDesign";
import { smsHref } from "@/lib/proposalLink";
import { createDeckClientLink, deleteDeckClientLink, listDeckClientLinks } from "@/actions/deckClientDesign";
import s from "./deck-studio.module.css";

const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(" ");
const ago = (iso: string) => {
  const sec = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.round(sec / 60)} min ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)} h ago`;
  return `${Math.round(sec / 86400)} d ago`;
};

type Row = ClientLinkRow & { url: string; message: string };

function standing(l: Row): { text: string; tone: "pass" | "warn" | "none" } {
  if (l.expired) return { text: "Closed", tone: "none" };
  if (l.status === "sent") return { text: "Sent back ✓", tone: "pass" };
  if (l.workAt) return { text: "Designing", tone: "warn" };
  if (l.openedAt) return { text: "Opened", tone: "warn" };
  return { text: "Not opened", tone: "none" };
}

export function DeckClientLink({ design, address, title, clientId }: { design: DeckDesign; address: string; title: string; clientId?: string }) {
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
    const res = await createDeckClientLink({ clientName: name, clientPhone: phone, clientEmail: email, clientId: clientId ?? null, start, design, address, title });
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

  return (
    <details className={s.drafts} onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && void refresh()} data-deck-client-link>
      <summary className={cx(s.btn, s.btnSm)}>Client designs it</summary>
      <div className={s.draftList} style={{ width: "min(460px, 94vw)", maxHeight: 560 }}>
        <div style={{ display: "grid", gap: 8, padding: "8px 10px 10px", borderBottom: "1px solid var(--hair-soft)" }}>
          <div className={s.hint} style={{ fontSize: 12.5 }}>
            Send your client a link: they change the size, stairs, railing and boards in 3D — <b>no prices on their page</b> — and press Send. It comes back here as a draft, framed to the code tables.
          </div>
          <input className={s.in} value={name} placeholder="Client's name" aria-label="Client's name" autoComplete="off" onChange={(e) => setName(e.target.value)} data-client-link-name />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <input className={s.in} value={phone} placeholder="Mobile (to text it)" aria-label="Client's mobile" inputMode="tel" onChange={(e) => setPhone(e.target.value)} />
            <input className={s.in} value={email} placeholder="Email (optional)" aria-label="Client's email" inputMode="email" onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div role="radiogroup" aria-label="Where the client starts" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button type="button" role="radio" aria-checked={start === "mine"} className={cx(s.btn, s.btnSm, start === "mine" && s.btnOn)} onClick={() => setStart("mine")} data-client-link-start="mine">From this design</button>
            <button type="button" role="radio" aria-checked={start === "blank"} className={cx(s.btn, s.btnSm, start === "blank" && s.btnOn)} onClick={() => setStart("blank")} data-client-link-start="blank">From a blank deck</button>
          </div>
          <div className={s.hint} style={{ fontSize: 11.5 }}>
            {start === "mine" ? "They see the deck on your screen now and correct it." : "They pick a deck, covered deck, gazebo or pergola and design it from there."} Your address, site, house and lumber stay yours.
          </div>
          <button type="button" className={cx(s.btn, s.btnSm, s.btnPrimary)} disabled={busy || !name.trim()} onClick={() => void make()} data-client-link-make>
            {busy ? "Making the link…" : "Make the link"}
          </button>
          {error ? <div className={s.hint} style={{ color: "var(--danger)" }} role="alert">{error}</div> : null}
          {made ? (
            <div style={{ display: "grid", gap: 6, padding: 8, border: "1.5px solid var(--blueprint)", borderRadius: "var(--radius)" }} data-client-link-made>
              <input className={s.in} readOnly value={made.url} aria-label="The client's link" onFocus={(e) => e.currentTarget.select()} />
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button type="button" className={cx(s.btn, s.btnSm, s.btnPrimary)} onClick={() => void copy(made)}>{copied === made.token ? "Copied ✓" : "Copy link"}</button>
                <a className={cx(s.btn, s.btnSm)} href={smsHref(made.clientPhone, made.message)}>Text it</a>
                <a className={cx(s.btn, s.btnSm)} href={mailto(made)}>Email it</a>
                <a className={cx(s.btn, s.btnSm, s.btnGhost)} href={made.url} target="_blank" rel="noopener">See their page ↗</a>
              </div>
            </div>
          ) : null}
        </div>
        {links === null ? <div className={s.draftEmpty}>Reading…</div> : links.length === 0 ? <div className={s.draftEmpty}>No client links yet.</div> : null}
        {(links ?? []).map((l) => {
          const st = standing(l);
          return (
            <div key={l.token} className={s.draftRow} data-client-link-row={l.token}>
              <div style={{ minWidth: 0 }}>
                <div className={s.draftName}>
                  {l.clientName} <span className={cx(s.stamp, st.tone === "pass" && s.stampPass, st.tone === "warn" && s.stampWarn)} style={{ marginLeft: 4 }} data-client-link-status={st.text}>{st.text}</span>
                </div>
                <div className={s.draftMeta}>
                  {l.status === "sent" && l.sentAt ? `sent ${ago(l.sentAt)}` : `made ${ago(l.createdAt)}`} · {l.start === "mine" ? "from your design" : "from blank"}
                  {l.note ? ` · “${l.note.length > 60 ? `${l.note.slice(0, 60)}…` : l.note}”` : ""}
                </div>
              </div>
              {l.draftId ? (
                <a className={cx(s.btn, s.btnSm, s.btnPrimary)} href={`/dashboard/deck-estimator?draft=${l.draftId}` as Route} data-client-link-open>Open</a>
              ) : (
                <button type="button" className={cx(s.btn, s.btnSm)} onClick={() => void copy(l)} disabled={l.expired}>{copied === l.token ? "Copied ✓" : "Copy"}</button>
              )}
              <button type="button" className={cx(s.btn, s.btnSm, s.btnDanger)} onClick={() => void remove(l)} aria-label={`Close ${l.clientName}'s link`}>×</button>
            </div>
          );
        })}
      </div>
    </details>
  );
}
