"use client";

// THE CLIENT'S ROOM (2026-10-19) — /room-design/<token>. The homeowner turns the room in 3D, picks among the finishes
// the contractor offers (the 3D repaints as they pick, the total moves when the contractor shows prices), leaves a
// note and approves. Picks are kept as they go; approval is priced again on the server and rings the contractor.
import * as React from "react";
import dynamic from "next/dynamic";
import type { DesignDoc } from "@/lib/design/model";
import { applyPicks, money, pricedTotal, type ClientOption, type LinkPrices, type Picks, type Slot } from "@/lib/design/clientLink";
import { approveRoomClientDesign, saveRoomClientPicks } from "@/actions/designClientLink";
import s from "./room-client.module.css";

const Room3D = dynamic(() => import("./room-3d").then((m) => m.Room3D), { ssr: false, loading: () => <div className={s.three} /> });

type Props = {
  token: string;
  shop: { name: string; logoUrl: string | null; phone: string | null };
  clientName: string;
  title: string;
  roomName: string;
  address: string | null;
  doc: DesignDoc;
  room: string;
  options: ClientOption[];
  prices: LinkPrices | null;
  picks: Picks;
  note: string;
  approved: { at: string; name: string } | null;
  expired: boolean;
};

const signed = (n: number) => (Math.abs(n) < 1 ? "Same price" : `${n > 0 ? "+" : "−"}${money(Math.abs(n))}`);
const dateOf = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric" });

export function RoomClient(p: Props) {
  const [picks, setPicks] = React.useState<Picks>(p.picks);
  const [note, setNote] = React.useState(p.note);
  const [view, setView] = React.useState<"orbit" | "walk">("orbit");
  const [frame, setFrame] = React.useState(0);
  const [saved, setSaved] = React.useState<"idle" | "saving" | "saved" | "error">("idle");
  const [asking, setAsking] = React.useState(false);
  const [name, setName] = React.useState(p.clientName);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [approved, setApproved] = React.useState(p.approved);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const locked = !!approved || p.expired;

  const doc = React.useMemo(() => applyPicks(p.doc, p.room, p.options, picks), [p.doc, p.room, p.options, picks]);
  const total = p.prices ? pricedTotal(p.prices, picks) : null;
  const first = p.clientName.split(/\s+/)[0] || p.clientName;

  // Kept as they go: a moment after the last change.
  const keep = (nextPicks: Picks, nextNote: string) => {
    if (timer.current) clearTimeout(timer.current);
    setSaved("saving");
    timer.current = setTimeout(() => {
      saveRoomClientPicks(p.token, nextPicks, nextNote)
        .then((r) => setSaved(r.ok ? "saved" : "error"))
        .catch(() => setSaved("error"));
    }, 700);
  };
  const pick = (slot: Slot, key: string) => {
    if (locked) return;
    const next = { ...picks, [slot]: key };
    setPicks(next);
    keep(next, note);
  };
  const approve = async () => {
    setBusy(true);
    setError(null);
    if (timer.current) clearTimeout(timer.current);
    const r = await approveRoomClientDesign(p.token, { name, picks, note }).catch(() => ({ ok: false as const, error: "The approval didn't go through — check your connection and try again." }));
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setApproved({ at: r.at, name: name.trim() || p.clientName });
    setAsking(false);
  };

  return (
    <main className={s.page} data-room-client>
      <header className={s.bar}>
        <div className={s.shop}>
          {p.shop.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.shop.logoUrl} alt="" className={s.logo} />
          ) : null}
          <b>{p.shop.name}</b>
        </div>
        {p.shop.phone ? (
          <a className={s.phone} href={`tel:${p.shop.phone.replace(/[^\d+]/g, "")}`}>
            {p.shop.phone}
          </a>
        ) : null}
      </header>

      <section className={s.head}>
        <div className={s.caps}>Prepared for {p.clientName}</div>
        <h1 className={s.h1}>{p.title}</h1>
        {p.address ? <p className={s.sub}>{p.address}</p> : null}
      </section>

      {approved ? (
        <p className={`${s.banner} ${s.bannerOk}`} data-room-approved>
          Approved on {dateOf(approved.at)} by {approved.name}. {p.shop.name} has your choices and will send you the proposal.
        </p>
      ) : p.expired ? (
        <p className={s.banner}>This link has closed. Ask {p.shop.name} for a new one to make changes.</p>
      ) : (
        <p className={s.lede}>
          Hi {first} — turn the room around, choose your finishes{p.prices ? " and watch the price" : ""}, then approve it when it looks right.
        </p>
      )}

      <div className={s.grid}>
        <div className={s.stage}>
          <Room3D doc={doc} focus={p.room} view={view} frameToken={frame} className={s.three} label={`${p.roomName} in 3D`} />
          <div className={s.views}>
            <div className={s.seg} role="group" aria-label="View">
              <button type="button" aria-pressed={view === "orbit"} onClick={() => setView("orbit")}>
                Look around
              </button>
              <button type="button" aria-pressed={view === "walk"} onClick={() => setView("walk")}>
                Walk in
              </button>
            </div>
            <button type="button" className={s.textBtn} onClick={() => setFrame((t) => t + 1)}>
              Reset view
            </button>
          </div>
          <p className={s.hint}>{view === "walk" ? "Drag to look around. On a keyboard, the arrow keys walk." : "Drag to turn the room, pinch or scroll to zoom."}</p>
        </div>

        <aside className={s.side}>
          {p.options.map((o) => {
            const cur = picks[o.slot] ?? o.choices[0].key;
            return (
              <fieldset key={o.slot} className={s.slot} disabled={locked} data-room-slot={o.slot}>
                <legend className={s.slotTitle}>
                  {o.title}
                  <span className={s.slotNow}>{o.choices.find((c) => c.key === cur)?.name}</span>
                </legend>
                <div className={s.swatches}>
                  {o.choices.map((c, i) => {
                    const d = p.prices?.delta[o.slot]?.[c.key] ?? 0;
                    return (
                      <button key={c.key} type="button" className={s.swatch} aria-pressed={cur === c.key} onClick={() => pick(o.slot, c.key)} data-room-choice={c.key}>
                        <span className={s.chip} style={{ background: c.hex }} />
                        <span className={s.chipName}>{c.name}</span>
                        <span className={s.chipNote}>{i === 0 ? "As designed" : p.prices ? signed(d) : " "}</span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            );
          })}
          <label className={s.label} htmlFor="room-note">
            Anything to tell {p.shop.name}?
          </label>
          <textarea
            id="room-note"
            className={s.area}
            value={note}
            disabled={locked}
            maxLength={1500}
            placeholder="A question, a change you'd like, the best time to start…"
            onChange={(e) => {
              setNote(e.target.value);
              keep(picks, e.target.value);
            }}
          />
          <div className={s.saved} aria-live="polite">
            {saved === "saving" ? "Saving…" : saved === "saved" ? `Saved — ${p.shop.name} can see your choices.` : saved === "error" ? "Not saved — check your connection." : ""}
          </div>
        </aside>
      </div>

      <div className={s.dock} data-room-dock>
        <div className={s.dockIn}>
          <div>
            {total != null ? (
              <>
                <div className={s.caps}>{p.roomName} · before tax</div>
                <div className={s.total} data-room-total>
                  {money(total)}
                </div>
              </>
            ) : (
              <div className={s.dockWords}>{approved ? "Approved" : `${p.shop.name} will price your choices in the proposal.`}</div>
            )}
          </div>
          {approved ? (
            <div className={s.done} data-room-done>
              Approved — {p.shop.name} has your choices
            </div>
          ) : !locked && !asking ? (
            <button type="button" className={s.btn} onClick={() => setAsking(true)} data-room-approve>
              Approve this design
            </button>
          ) : null}
        </div>
        {asking && !locked ? (
          <div className={s.ask} role="dialog" aria-label="Approve this design" data-room-ask>
            <label className={s.label} htmlFor="room-name">
              Your name
            </label>
            <input id="room-name" className={s.input} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            <p className={s.fine}>Approving tells {p.shop.name} to prepare your proposal with these finishes. Nothing is charged and nothing is signed yet.</p>
            {error ? <p className={s.err}>{error}</p> : null}
            <div className={s.askRow}>
              <button type="button" className={s.btn} onClick={approve} disabled={busy || !name.trim()} data-room-confirm>
                {busy ? "Approving…" : "Approve"}
              </button>
              <button type="button" className={s.textBtn} onClick={() => setAsking(false)}>
                Not yet
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
