"use client";
// SEND IT TO THE CLIENT (Home Design Studio, 2026-10-19) — under the estimate: the finishes the client may choose
// among (the design's own first, then the ones offered — one cheaper and one dearer where the price moves, by default),
// whether they see prices, and the link to send from your own phone or email. Below, this room's links: where each
// client is with it, what they chose, and "Apply their choices" once they have.
import * as React from "react";
import s from "./design-studio.module.css";
import type { DesignDoc } from "@/lib/design/model";
import { estimateTotal, priceDesign, takeoff, type EstimateOptions } from "@/lib/design/estimate";
import type { DesignProduct } from "@/lib/design/inventory";
import { kindOfLabel, roomFinishes } from "@/lib/design/roomKinds";
import { applyChosen, choicesOf, currentChoice, money, slotsFor, slotTitle, standing, suggestOptions, withChoice, type ClientOption, type LinkRow, type Slot } from "@/lib/design/clientLink";
import { createRoomClientLink, listRoomClientLinks, markRoomClientApplied } from "@/actions/designClientLink";
import type { DesignClient } from "@/actions/designStudio";

type Props = {
  doc: DesignDoc;
  focus: string;
  designId: string | null;
  /** Saves the design (a link opens the saved one) and gives its id. */
  onSave: () => Promise<string | null>;
  onPatch: (fn: (d: DesignDoc) => void) => void;
  factor: number;
  book: Record<string, number>;
  opts: EstimateOptions;
  products: readonly DesignProduct[];
  client: DesignClient | null;
  /** The contractor's own title for the job ("" — the room's name and "design"). */
  title: string;
  address: string | null;
};
type Row = LinkRow & { url: string };
const MAX_OFFERED = 3;

export function ClientLinkCard(p: Props) {
  const kind = kindOfLabel(p.doc, p.focus);
  const fin = roomFinishes(p.doc, p.focus);
  const priceOf = React.useCallback(
    (slot: Slot, key: string) => {
      const d = { ...p.doc, finishes: { ...(p.doc.finishes ?? {}), [p.focus]: withChoice(roomFinishes(p.doc, p.focus), slot, key) } };
      const t = takeoff(d, p.focus);
      return t ? estimateTotal(priceDesign(t, roomFinishes(d, p.focus), p.opts, p.factor, p.book, p.products)) : 0;
    },
    [p.doc, p.focus, p.opts, p.factor, p.book, p.products],
  );
  // What's offered in each slot beyond the design's own (seeded once from the suggestions; the room's own choice is
  // always first and never in this list).
  const [offer, setOffer] = React.useState<Partial<Record<Slot, string[]>>>(() => Object.fromEntries(suggestOptions(p.doc, p.focus, priceOf).map((o) => [o.slot, o.choices.slice(1).map((c) => c.key)])));
  const [showPrice, setShowPrice] = React.useState(true);
  const [name, setName] = React.useState(p.client?.name ?? "");
  const [email, setEmail] = React.useState(p.client?.email ?? "");
  const [phone, setPhone] = React.useState(p.client?.phone ?? "");
  const [seenClient, setSeenClient] = React.useState(p.client?.id ?? null);
  if ((p.client?.id ?? null) !== seenClient) {
    setSeenClient(p.client?.id ?? null);
    if (p.client) {
      setName(p.client.name);
      setEmail(p.client.email ?? "");
      setPhone(p.client.phone ?? "");
    }
  }
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [made, setMade] = React.useState<{ url: string; message: string; title: string } | null>(null);
  const [copied, setCopied] = React.useState<string | null>(null);
  const [links, setLinks] = React.useState<Row[]>([]);

  const refresh = React.useCallback((id: string | null) => {
    if (!id) return;
    listRoomClientLinks(id).then((r) => r.ok && setLinks(r.links));
  }, []);
  React.useEffect(() => {
    refresh(p.designId);
  }, [p.designId, refresh]);

  const options: ClientOption[] = slotsFor(kind)
    .map((slot) => {
      const cur = currentChoice(fin, slot);
      const extra = (offer[slot] ?? []).filter((k) => k !== cur.key);
      return { slot, title: slotTitle(slot, kind), choices: [cur, ...choicesOf(slot).filter((c) => extra.includes(c.key))] };
    })
    .filter((o) => o.choices.length >= 2);
  // What each choice adds or saves against the design as it is — priced once a design change, not on every keystroke.
  const deltas = React.useMemo(() => {
    const t = takeoff(p.doc, p.focus);
    const base = t ? estimateTotal(priceDesign(t, roomFinishes(p.doc, p.focus), p.opts, p.factor, p.book, p.products)) : 0;
    const out: Partial<Record<Slot, Record<string, number>>> = {};
    for (const slot of slotsFor(kindOfLabel(p.doc, p.focus))) out[slot] = Object.fromEntries(choicesOf(slot).map((c) => [c.key, priceOf(slot, c.key) - base]));
    return out;
  }, [p.doc, p.focus, p.opts, p.factor, p.book, p.products, priceOf]);

  const toggle = (slot: Slot, key: string) =>
    setOffer((o) => {
      const now = o[slot] ?? [];
      return { ...o, [slot]: now.includes(key) ? now.filter((k) => k !== key) : now.length >= MAX_OFFERED ? now : [...now, key] };
    });
  const make = async () => {
    setBusy(true);
    setError(null);
    setMade(null);
    const id = await p.onSave();
    if (!id) {
      setBusy(false);
      return setError("Save the design first — the link opens the saved design.");
    }
    const r = await createRoomClientLink({ designId: id, doc: p.doc, room: p.focus, clientName: name, clientEmail: email.trim(), clientPhone: phone, clientId: p.client?.id ?? null, options, showPrice, address: p.address ?? undefined, title: p.title });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setMade({ url: r.url, message: r.message, title: r.row.title });
    setLinks((l) => [r.row, ...l.filter((x) => x.token !== r.token)]);
  };
  const copy = async (what: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied((c) => (c === what ? null : c)), 1800);
    } catch {
      setError("Copy didn't work here — select the link and copy it.");
    }
  };
  const apply = async (r: Row) => {
    p.onPatch((d) => {
      d.finishes = applyChosen(d, r.room, r.picks).finishes;
    });
    await markRoomClientApplied(r.token);
    refresh(p.designId);
  };
  const mine = links.filter((l) => l.room === p.focus);

  return (
    <div style={{ display: "grid", gap: 12, borderTop: "1.5px solid var(--hair-soft)", paddingTop: 14 }} data-design-client-link>
      <div>
        <div className={s.cardTitle} style={{ fontSize: 12 }}>
          Send it to the client
        </div>
        <p className={s.cardSub}>They open the room in 3D, choose among the finishes you offer, see the price move and approve it. You hear at once.</p>
      </div>
      {options.length || slotsFor(kind).length ? (
        <div style={{ display: "grid", gap: 10 }}>
          {slotsFor(kind).map((slot) => {
            const cur = currentChoice(fin, slot);
            const on = offer[slot] ?? [];
            return (
              <div key={slot} data-design-offer={slot}>
                <div className={s.lbl} style={{ marginBottom: 4 }}>
                  {slotTitle(slot, kind)} <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>· the design has {cur.name}</span>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {choicesOf(slot)
                    .filter((c) => c.key !== cur.key)
                    .map((c) => {
                      const d = deltas[slot]?.[c.key] ?? 0;
                      const picked = on.includes(c.key);
                      return (
                        <button
                          key={c.key}
                          type="button"
                          className={`${s.btn} ${s.btnSm} ${picked ? s.btnOn : ""}`}
                          aria-pressed={picked}
                          onClick={() => toggle(slot, c.key)}
                          disabled={!picked && on.length >= MAX_OFFERED}
                          title={picked ? "Offered — click to take it off" : "Offer this one"}
                          data-design-offer-choice={c.key}
                        >
                          <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 2, background: c.hex, border: "1px solid rgba(0,0,0,.2)", marginRight: 6, verticalAlign: -1 }} />
                          {c.name}
                          {Math.abs(d) >= 1 ? <span style={{ marginLeft: 6, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{`${d > 0 ? "+" : "−"}${money(Math.abs(d))}`}</span> : null}
                        </button>
                      );
                    })}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
      <div className={s.fields} style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        <label className={s.field}>
          <span className={s.lbl}>Client&apos;s name</span>
          <input className={s.in} value={name} onChange={(e) => setName(e.target.value)} placeholder="Who the page greets" data-design-link-name />
        </label>
        <label className={s.field}>
          <span className={s.lbl}>Email</span>
          <input className={s.in} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="To email it from yours" />
        </label>
        <label className={s.field}>
          <span className={s.lbl}>Phone</span>
          <input className={s.in} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="To text it from yours" />
        </label>
        <div className={s.field}>
          <span className={s.lbl}>Prices</span>
          <div className={s.seg}>
            <button type="button" className={`${s.segB} ${showPrice ? s.on : ""}`} onClick={() => setShowPrice(true)} data-design-link-prices>
              Show them
            </button>
            <button type="button" className={`${s.segB} ${!showPrice ? s.on : ""}`} onClick={() => setShowPrice(false)}>
              Hide them
            </button>
          </div>
        </div>
      </div>
      {error ? <p className={`${s.note} ${s.noteWarn}`}>{error}</p> : null}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={make} disabled={busy || !name.trim() || !options.length} data-design-link-make>
          {busy ? "Making the link…" : made ? "Make another link" : "Make the client's link"}
        </button>
        {!options.length ? <span className={s.mono}>Offer at least one other finish</span> : null}
      </div>
      {made ? (
        <div className={`${s.note} ${s.noteGood}`} style={{ display: "grid", gap: 8 }} data-design-link-made>
          <div style={{ wordBreak: "break-all", fontWeight: 700 }} data-design-link-url>
            {made.url}
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button type="button" className={s.link} onClick={() => copy("link", made.url)}>
              {copied === "link" ? "Copied" : "Copy the link"}
            </button>
            <button type="button" className={s.link} onClick={() => copy("msg", made.message)}>
              {copied === "msg" ? "Copied" : "Copy the message"}
            </button>
            {phone.trim() ? (
              <a className={s.link} href={`sms:${phone.replace(/[^\d+]/g, "")}?&body=${encodeURIComponent(made.message)}`}>
                Text it
              </a>
            ) : null}
            {email.trim() ? (
              <a className={s.link} href={`mailto:${email.trim()}?subject=${encodeURIComponent(made.title)}&body=${encodeURIComponent(made.message)}`}>
                Email it
              </a>
            ) : null}
            <a className={s.link} href={made.url} target="_blank" rel="noreferrer">
              See what they see
            </a>
          </div>
        </div>
      ) : null}
      {mine.length ? (
        <div style={{ display: "grid", gap: 6 }} data-design-links>
          <div className={s.lbl}>This room&apos;s links</div>
          {mine.map((l) => (
            <div key={l.token} style={{ display: "grid", gap: 2, padding: "8px 0", borderTop: "1px solid var(--hair-soft)", fontSize: 13 }} data-design-link-row={l.token}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
                <b>{l.clientName}</b>
                <span className={s.mono} style={{ color: l.status === "approved" ? "var(--good, #1f7a46)" : undefined }}>
                  {standing(l)}
                </span>
                {l.approvedTotal != null ? <span style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{money(l.approvedTotal)}</span> : null}
                <span style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
                  <button type="button" className={s.link} onClick={() => copy(l.token, l.url)}>
                    {copied === l.token ? "Copied" : "Copy link"}
                  </button>
                  {l.picked.length && !l.appliedAt ? (
                    <button type="button" className={s.link} onClick={() => apply(l)} data-design-link-apply>
                      Apply their choices
                    </button>
                  ) : l.appliedAt ? (
                    <span className={s.mono}>Applied</span>
                  ) : null}
                </span>
              </div>
              {l.picked.length ? <div style={{ color: "var(--muted)" }}>{l.picked.join(" · ")}</div> : null}
              {l.note ? <div style={{ fontStyle: "italic" }}>“{l.note}”</div> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
