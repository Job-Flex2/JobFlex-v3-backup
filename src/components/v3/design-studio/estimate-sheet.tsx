"use client";
// THE ESTIMATE SHEET (Home Design Studio, milestone 4 — 2026-10-17). Under the room being designed: every line the
// design implies, counted from it and priced from the JobFlex price book for the job's city — the contractor's own
// price for a line kept for every estimate after — grouped the way a kitchen is bid, with what a kitchen this size
// usually runs in that city beside the total, then "Create the proposal" for a client. Any room (2026-10-18): a bath,
// a laundry or a finish room is priced by its own trade's steps, with its own benchmark where the book has one.
import * as React from "react";
import s from "./design-studio.module.css";
import type { DesignDoc } from "@/lib/design/model";
import { DEFAULT_OPTIONS, GROUPS, benchmarkFor, benchmarkTone, estimateTotal, lineTotal, priceDesign, scopeText, takeoff, type EstLine, type EstimateOptions } from "@/lib/design/estimate";
import { KIND_LABEL } from "@/lib/design/rooms";
import { roomFinishes } from "@/lib/design/roomKinds";
import type { DesignProduct } from "@/lib/design/inventory";
import { convertDesignToProposal, designLocation, findDesignClients, readDesignBook, saveDesignPrice, type DesignClient, type DesignLocation } from "@/actions/designStudio";

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n >= 1000 ? 0 : 2 });

type Props = {
  doc: DesignDoc;
  focus: string;
  designId: string | null;
  /** The shop's own market (its address), until the job's address says otherwise. */
  market: DesignLocation;
  shopAddress: string | null;
  onPatch: (fn: (d: DesignDoc) => void) => void;
  /** The shop's products: a piece that is one is supplied at its price. */
  products?: readonly DesignProduct[];
};

export function EstimateSheet({ doc, focus, designId, market, shopAddress, onPatch, products = [] }: Props) {
  const [book, setBook] = React.useState<Record<string, number>>({});
  const [found, setFound] = React.useState<{ address: string; loc: DesignLocation } | null>(null);
  const [made, setMade] = React.useState<{ id: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [client, setClient] = React.useState<DesignClient | null>(null);
  const opts: EstimateOptions = React.useMemo(() => ({ ...DEFAULT_OPTIONS, ...(doc.estimate ?? {}) }), [doc.estimate]);
  const address = doc.estimate?.address ?? "";
  // The job's address sets the market once it's looked up; until then (or without one), the shop's.
  const loc = address.trim() && found?.address === address.trim() ? found.loc : market;
  const fin = roomFinishes(doc, focus);
  const t = React.useMemo(() => takeoff(doc, focus), [doc, focus]);
  const lines = React.useMemo(() => (t ? priceDesign(t, fin, opts, loc.factor, book, products) : []), [t, fin, opts, loc.factor, book, products]);
  const total = estimateTotal(lines);
  const unset = lines.filter((l) => l.basis === "allowance" && l.unitPrice === 0);

  React.useEffect(() => {
    let live = true;
    readDesignBook().then((r) => {
      if (live && r.ok) setBook(r.book);
    });
    return () => {
      live = false;
    };
  }, []);
  React.useEffect(() => {
    const a = address.trim();
    if (!a) return;
    let live = true;
    designLocation(a).then((r) => live && r.ok && setFound({ address: a, loc: r.loc }));
    return () => {
      live = false;
    };
  }, [address]);

  if (!t) return null;
  const setOpt = (patch: Partial<NonNullable<DesignDoc["estimate"]>>) =>
    onPatch((d) => {
      d.estimate = { ...DEFAULT_OPTIONS, ...(d.estimate ?? {}), ...patch };
    });
  const keepPrice = async (key: string, price: number | null) => {
    const r = await saveDesignPrice(key, price);
    if (r.ok) setBook(r.book);
    else setError(r.error);
  };
  const bench = benchmarkFor(t, loc.factor);
  const tone = bench ? benchmarkTone(total, bench) : "in";
  const roomTitle = doc.estimate?.title ?? `${t.room} — ${t.kind === "other" ? "room" : KIND_LABEL[t.kind].toLowerCase()} design`;
  const machines = t.kind === "kitchen" || t.kind === "laundry" ? "Appliances" : t.kind === "bath" ? "Fixtures" : null;
  const create = async () => {
    setBusy(true);
    setError(null);
    const res = await convertDesignToProposal({
      title: roomTitle,
      clientId: client?.id ?? null,
      address: address.trim() || client?.address || null,
      scope: scopeText(t, fin, opts, products),
      lines: lines.filter((l) => l.qty > 0).map((l: EstLine) => ({ name: l.name, description: l.desc, quantity: l.qty, unit: l.unit, unitPrice: l.unitPrice, labor: l.labor })),
      designId,
      room: t.room,
      doc,
    });
    setBusy(false);
    if (res.ok) setMade({ id: res.id });
    else setError(res.error);
  };

  return (
    <section className={s.card} data-design-estimate>
      <div className={s.head}>
        <div>
          <div className={s.cardTitle}>Estimate · {t.room}</div>
          <p className={s.cardSub}>
            Counted from the design, priced from the JobFlex price book for {loc.place}
            {loc.level !== "national" ? ` (×${loc.factor.toFixed(2)})` : ""} — selling prices, overhead and profit in. Your own price for a line is kept for every estimate after.
          </p>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className={s.mono}>Total before tax</div>
          <div style={{ fontSize: 28, fontWeight: 900 }} data-design-estimate-total>
            {usd(total)}
          </div>
        </div>
      </div>
      <div className={s.body}>
        <div className={s.fields} style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
          <label className={s.field}>
            <span className={s.lbl}>Job address</span>
            <input className={s.in} defaultValue={address} placeholder={shopAddress ?? "Street, city, state"} onBlur={(e) => e.target.value.trim() !== address && setOpt({ address: e.target.value.trim() || undefined })} data-design-estimate-address />
          </label>
          <div className={s.field}>
            <span className={s.lbl}>Job</span>
            <div className={s.seg}>
              <button type="button" className={`${s.segB} ${opts.scope === "remodel" ? s.on : ""}`} onClick={() => setOpt({ scope: "remodel" })}>
                Remodel
              </button>
              <button type="button" className={`${s.segB} ${opts.scope === "new" ? s.on : ""}`} onClick={() => setOpt({ scope: "new" })} data-design-estimate-new>
                New
              </button>
            </div>
          </div>
          {machines ? (
          <div className={s.field}>
            <span className={s.lbl}>{machines}</span>
            <div className={s.seg}>
              <button type="button" className={`${s.segB} ${opts.appliances === "owner" ? s.on : ""}`} onClick={() => setOpt({ appliances: "owner" })}>
                Owner&apos;s
              </button>
              <button type="button" className={`${s.segB} ${opts.appliances === "allowance" ? s.on : ""}`} onClick={() => setOpt({ appliances: "allowance" })} data-design-estimate-allowance>
                We supply
              </button>
            </div>
          </div>
          ) : null}
          <div className={s.field}>
            <span className={s.lbl}>Also</span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button type="button" className={`${s.btn} ${s.btnSm} ${opts.roughIn ? s.btnOn : ""}`} onClick={() => setOpt({ roughIn: !opts.roughIn })} aria-pressed={opts.roughIn}>
                New rough-in
              </button>
              <button type="button" className={`${s.btn} ${s.btnSm} ${opts.permits ? s.btnOn : ""}`} onClick={() => setOpt({ permits: !opts.permits })} aria-pressed={opts.permits}>
                Permits
              </button>
            </div>
          </div>
        </div>
        {bench ? (
          <p className={`${s.note} ${tone === "in" ? "" : s.noteWarn}`} data-design-estimate-bench>
            {bench.words} usually runs {usd(bench.low)}–{usd(bench.high)} in {loc.place} by the price book
            {tone === "under" ? " — this estimate is well under that; check nothing is missing." : tone === "over" ? " — this estimate is well over that; worth a second look." : " — this estimate is in line."}
            {t.appliances.length && opts.appliances === "owner" ? " Appliances are the owner's: set and connected only." : ""}
          </p>
        ) : null}
        {!lines.length ? (
          <p className={s.note} data-design-estimate-empty>
            {t.kind === "outdoor" ? "A patio or deck is priced in the Deck Studio — this design shows how it's furnished." : "Nothing to price yet — design the room, and the work it needs is counted here."}
          </p>
        ) : null}
        {t.furnishings ? <p className={s.note}>The furniture in the design shows the room; it isn&apos;t priced — unless it&apos;s one of your products.</p> : null}
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, fontVariantNumeric: "tabular-nums", minWidth: 640 }} data-design-estimate-lines>
            <thead>
              <tr style={{ textAlign: "left" }}>
                <th className={s.lbl} style={{ padding: "6px 8px" }}>Line</th>
                <th className={s.lbl} style={{ padding: "6px 8px", textAlign: "right" }}>Qty</th>
                <th className={s.lbl} style={{ padding: "6px 8px", textAlign: "right" }}>Price</th>
                <th className={s.lbl} style={{ padding: "6px 8px", textAlign: "right" }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {GROUPS.map((g) => {
                const gl = lines.filter((l) => l.group === g);
                if (!gl.length) return null;
                return (
                  <React.Fragment key={g}>
                    <tr>
                      <td colSpan={3} style={{ padding: "12px 8px 4px", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", fontSize: 11.5 }}>
                        {g}
                      </td>
                      <td style={{ padding: "12px 8px 4px", textAlign: "right", fontWeight: 800 }}>{usd(estimateTotal(gl))}</td>
                    </tr>
                    {gl.map((l) => (
                      <tr key={l.key} style={{ borderTop: "1px solid var(--hair-soft)" }} data-design-line={l.key}>
                        <td style={{ padding: "6px 8px" }}>
                          <div style={{ fontWeight: 700 }}>{l.name}</div>
                          <div style={{ color: "var(--muted)", fontSize: 12, lineHeight: 1.4 }}>{l.desc}</div>
                        </td>
                        <td style={{ padding: "6px 8px", textAlign: "right", whiteSpace: "nowrap" }}>
                          {l.qty} {l.unit}
                        </td>
                        <td style={{ padding: "6px 8px", textAlign: "right", whiteSpace: "nowrap" }}>
                          <PriceIn value={l.unitPrice} onCommit={(v) => keepPrice(l.key, v)} line={l.key} />
                          <div className={s.mono} style={{ fontSize: 9.5 }}>
                            {l.key.startsWith("prod-") && book[l.key] == null ? (
                              "Your inventory"
                            ) : l.key.startsWith("prod-") ? (
                              <>
                                Your price ·{" "}
                                <button type="button" className={s.link} onClick={() => keepPrice(l.key, null)}>
                                  inventory price
                                </button>
                              </>
                            ) : l.basis === "yours" ? (
                              <>
                                Your price ·{" "}
                                <button type="button" className={s.link} onClick={() => keepPrice(l.key, null)}>
                                  book price
                                </button>
                              </>
                            ) : l.basis === "allowance" ? (
                              "Allowance — set it"
                            ) : l.fee ? (
                              "Fee, at cost"
                            ) : (
                              "Price book"
                            )}
                          </div>
                        </td>
                        <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 700 }}>{usd(lineTotal(l))}</td>
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "2px solid var(--ink)" }}>
                <td colSpan={3} style={{ padding: "10px 8px", fontWeight: 900 }}>
                  Total before tax <span className={s.mono}>· sales tax for the job&apos;s state is added on the proposal</span>
                </td>
                <td style={{ padding: "10px 8px", textAlign: "right", fontWeight: 900, fontSize: 16 }}>{usd(total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div style={{ display: "grid", gap: 10, borderTop: "1.5px solid var(--hair-soft)", paddingTop: 14 }}>
          <div className={s.cardTitle} style={{ fontSize: 12 }}>
            The proposal
          </div>
          <div className={s.fields} style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
            <label className={s.field}>
              <span className={s.lbl}>Title</span>
              <input className={s.in} defaultValue={roomTitle} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== roomTitle && setOpt({ title: e.target.value.trim() })} data-design-proposal-title />
            </label>
            <ClientPick value={client} onPick={setClient} />
          </div>
          {made ? (
            <p className={`${s.note} ${s.noteGood}`} data-design-proposal-made>
              The proposal is made (a draft).{" "}
              <a className={s.link} href={`/dashboard/proposals/${made.id}`}>
                Open it
              </a>
            </p>
          ) : null}
          {unset.length ? (
            <p className={`${s.note} ${s.noteWarn}`} data-design-unset>
              {unset.length === 1 ? "One allowance isn't set" : `${unset.length} allowances aren't set`} — {unset.map((l) => l.name.replace(" · allowance", "").toLowerCase()).join(", ")}. {unset.length === 1 ? "It goes" : "They go"} on the proposal at $0 until you price {unset.length === 1 ? "it" : "them"}.
            </p>
          ) : null}
          {error ? <p className={`${s.note} ${s.noteWarn}`}>{error}</p> : null}
          <div>
            <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={create} disabled={busy || total <= 0} data-design-proposal-create>
              {busy ? "Making the proposal…" : made ? "Make another proposal" : "Create the proposal"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function PriceIn({ value, onCommit, line }: { value: number; onCommit: (v: number) => void; line: string }) {
  const [txt, setTxt] = React.useState(String(value));
  const [seen, setSeen] = React.useState(value);
  if (seen !== value) {
    setSeen(value);
    setTxt(String(value));
  }
  const commit = () => {
    const n = Number(txt.replace(/[$,\s]/g, ""));
    if (Number.isFinite(n) && n >= 0 && n !== value) onCommit(Math.round(n * 100) / 100);
    else setTxt(String(value));
  };
  return (
    <input
      aria-label="Unit price"
      inputMode="decimal"
      value={txt}
      onChange={(e) => setTxt(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      style={{ width: 92, textAlign: "right", height: 30, border: "1.5px solid var(--ink)", borderRadius: 4, padding: "0 6px", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}
      data-design-price={line}
    />
  );
}

function ClientPick({ value, onPick }: { value: DesignClient | null; onPick: (c: DesignClient | null) => void }) {
  const [q, setQ] = React.useState("");
  const [hits, setHits] = React.useState<DesignClient[]>([]);
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (!open) return;
    let live = true;
    const tm = setTimeout(() => {
      findDesignClients(q).then((r) => live && r.ok && setHits(r.clients));
    }, 250);
    return () => {
      live = false;
      clearTimeout(tm);
    };
  }, [q, open]);
  if (value)
    return (
      <div className={s.field}>
        <span className={s.lbl}>Client</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontWeight: 800 }} data-design-client-picked>
            {value.name}
          </span>
          <button type="button" className={s.link} onClick={() => onPick(null)}>
            Change
          </button>
        </div>
      </div>
    );
  return (
    <div className={s.field} style={{ position: "relative" }}>
      <span className={s.lbl}>Client</span>
      <input className={s.in} value={q} placeholder="Search clients — or leave it for later" onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 200)} onChange={(e) => setQ(e.target.value)} data-design-client-search />
      {open && hits.length ? (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 5, background: "#fff", border: "1.5px solid var(--ink)", borderRadius: 4, boxShadow: "3px 3px 0 var(--ink)", display: "grid" }}>
          {hits.map((c) => (
            <button key={c.id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(c)} style={{ textAlign: "left", padding: "8px 10px", border: 0, borderBottom: "1px solid var(--hair-soft)", background: "#fff", cursor: "pointer" }} data-design-client={c.id}>
              <div style={{ fontWeight: 700 }}>{c.name}</div>
              <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{[c.email, c.phone, c.address].filter(Boolean).join(" · ")}</div>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
