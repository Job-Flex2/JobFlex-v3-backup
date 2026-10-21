"use client";
// THE MATERIALS, ON THE SCREEN (2026-10-21) — lib/plans/materialsReport on the desk page and the phone page alike: what
// it is figured from (each measurement can be corrected — the materials follow), extra on top, the materials trade by
// trade in the units they are bought in, a deck from its size (a form when the plans and the words give none), and out
// the door: Download PDF, the spreadsheet, the list copied for a supplier.
import { useState } from "react";
import s from "./measure-report.module.css";
import { MEASURE_SOURCE_WORD } from "@/lib/plans/measureReport";
import { materialsAsReport, materialsText, type MaterialMeasure, type MaterialsReport } from "@/lib/plans/materialsReport";
import { DECK_BOARD_LABEL, DECK_BOARDS, type DeckBoard, type DeckSpec } from "@/lib/plans/deckSpec";
import { reportCsv } from "@/lib/plans/measureReport";
import { downloadText } from "@/lib/plans/csv";
import { TRADE_LABEL } from "@/lib/plans/takeoff";
import { toast } from "@/components/ui/Toast";

type Props = {
  report: MaterialsReport;
  /** A deck was asked for and its size is still wanted. */
  deckAsk: Partial<DeckSpec> | null;
  plan: { name: string | null; address: string | null; file: string; sheets: number };
  extraPct: number;
  onExtra: (pct: number) => void;
  onMeasure: (id: string, qty: number | null) => void;
  onDeck: (spec: DeckSpec) => void;
  onPage: (page: number) => void;
  onAsk: () => void;
  onEstimate: () => void;
};

const EXTRAS = [0, 5, 10, 15];
const qtyWords = (q: number) => (Number.isInteger(q) ? q.toLocaleString("en-US") : (Math.round(q * 10) / 10).toLocaleString("en-US"));

function Pages({ pages, onPage }: { pages: number[]; onPage: (p: number) => void }) {
  if (!pages.length) return <span className={s.none}>—</span>;
  return (
    <span className={s.pages}>
      {pages.slice(0, 3).map((p) => (
        <button key={p} type="button" className={s.page} onClick={() => onPage(p)} aria-label={`Open sheet ${p}`}>
          p.{p}
        </button>
      ))}
      {pages.length > 3 ? <span className={s.none}>+{pages.length - 3}</span> : null}
    </span>
  );
}

/** One measurement, its quantity editable: Enter or leaving the box keeps it, the materials follow. */
function MeasureRowEdit({ m, onMeasure, onPage }: { m: MaterialMeasure; onMeasure: Props["onMeasure"]; onPage: Props["onPage"] }) {
  const [text, setText] = useState(String(m.qty));
  const [seen, setSeen] = useState(m.qty);
  if (seen !== m.qty) {
    setSeen(m.qty);
    setText(String(m.qty));
  }
  const commit = () => {
    const n = Number(text.replace(/[,\s]/g, ""));
    if (Number.isFinite(n) && n >= 0 && n !== m.qty) onMeasure(m.id, n);
    else setText(String(m.qty));
  };
  return (
    <div className={s.row} role="row" data-material-measure={m.id}>
      <span className={s.item} role="cell">
        <b>{m.label}</b>
        <small>
          {TRADE_LABEL[m.trade]} · {m.edited ? "entered by you" : m.basis}
        </small>
      </span>
      <span className={s.qtyEdit} role="cell">
        <input
          aria-label={`${m.label} — ${m.unit}`}
          inputMode="decimal"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          data-material-measure-qty
        />
        <span>{m.unit}</span>
      </span>
      <span className={`${s.src} ${m.edited ? s.srcMeasured : m.source === "rule" ? s.srcAssumed : ""}`} role="cell">
        {m.edited ? (
          <button type="button" className={s.linkBtn} onClick={() => onMeasure(m.id, null)}>
            Back to the plans
          </button>
        ) : (
          MEASURE_SOURCE_WORD[m.source]
        )}
      </span>
      <span className={s.right} role="cell">
        <Pages pages={m.pages} onPage={onPage} />
      </span>
    </div>
  );
}

function DeckForm({ start, onDeck }: { start: Partial<DeckSpec>; onDeck: Props["onDeck"] }) {
  const [w, setW] = useState(start.widthFt ? String(start.widthFt) : "");
  const [d, setD] = useState(start.depthFt ? String(start.depthFt) : "");
  const [h, setH] = useState(String(start.heightIn ?? 36));
  const [board, setBoard] = useState<DeckBoard>(start.board ?? "composite");
  const [stairs, setStairs] = useState(start.stairs ?? true);
  const [railing, setRailing] = useState(start.railing ?? true);
  const ok = Number(w) >= 4 && Number(d) >= 4 && Number(h) >= 6;
  return (
    <form
      className={s.deckForm}
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) onDeck({ widthFt: Number(w), depthFt: Number(d), heightIn: Number(h), board, stairs, railing, state: start.state ?? null, from: "entered" });
      }}
      data-material-deck-form
    >
      <label>
        <span>Width, ft</span>
        <input inputMode="decimal" value={w} onChange={(e) => setW(e.target.value)} placeholder="20" data-deck-width />
      </label>
      <label>
        <span>Depth, ft</span>
        <input inputMode="decimal" value={d} onChange={(e) => setD(e.target.value)} placeholder="16" data-deck-depth />
      </label>
      <label>
        <span>Height, in</span>
        <input inputMode="numeric" value={h} onChange={(e) => setH(e.target.value)} placeholder="36" data-deck-height />
      </label>
      <label>
        <span>Boards</span>
        <select value={board} onChange={(e) => setBoard(e.target.value as DeckBoard)} data-deck-board>
          {DECK_BOARDS.map((b) => (
            <option key={b} value={b}>
              {DECK_BOARD_LABEL[b]}
            </option>
          ))}
        </select>
      </label>
      <label className={s.tick}>
        <input type="checkbox" checked={stairs} onChange={(e) => setStairs(e.target.checked)} /> Stairs
      </label>
      <label className={s.tick}>
        <input type="checkbox" checked={railing} onChange={(e) => setRailing(e.target.checked)} /> Railing
      </label>
      <button type="submit" className={s.btnPrimary} disabled={!ok} data-deck-go>
        Work out the deck
      </button>
    </form>
  );
}

export function MaterialsView({ report, deckAsk, plan, extraPct, onExtra, onMeasure, onDeck, onPage, onAsk, onEstimate }: Props) {
  const [making, setMaking] = useState(false);
  const [editDeck, setEditDeck] = useState(false);
  const name = (plan.name || plan.file.replace(/\.pdf$/i, "") || "Plans").trim();
  const meta = { name: plan.name, address: plan.address, sheets: plan.sheets };
  const fileBase = `${name} — ${report.title.toLowerCase()} materials`;

  const downloadPdf = async () => {
    setMaking(true);
    try {
      const { downloadMeasurePdf } = await import("./measure-pdf");
      await downloadMeasurePdf(materialsAsReport(report, meta), { name: plan.name, address: plan.address, file: plan.file }, { kicker: `Materials list · ${report.title} · from the plans`, fileWord: `${report.title.toLowerCase()} materials` });
    } catch (err) {
      console.error("[materials-pdf]", err);
      toast.error("The PDF could not be made", err instanceof Error ? err.message : "Try again.");
    } finally {
      setMaking(false);
    }
  };
  const copyList = async () => {
    try {
      await navigator.clipboard.writeText(materialsText(report, meta));
      toast.success("Copied", "Paste it into a text or an email to your supplier.");
    } catch {
      toast.error("Copy didn't work here", "Use Download PDF or the spreadsheet instead.");
    }
  };

  return (
    <div className={s.mr} data-materials-report>
      <div className={s.top}>
        <div className={s.titles}>
          <div className={s.kicker}>
            Materials · {plan.sheets} sheet{plan.sheets === 1 ? "" : "s"} read · nothing priced
          </div>
          <h1 className={s.title}>{report.title}</h1>
          <p className={s.sub}>{[plan.name, plan.address].filter(Boolean).join(" · ") || plan.file}</p>
        </div>
        <div className={s.actions}>
          <button type="button" className={s.btnPrimary} onClick={() => void downloadPdf()} disabled={making || !report.count} data-materials-pdf>
            {making ? "Making the PDF…" : "Download PDF"}
          </button>
          <button type="button" className={s.btnGhost} onClick={() => void copyList()} disabled={!report.count} data-materials-copy>
            Copy for the supplier
          </button>
          <button type="button" className={s.btnGhost} onClick={() => downloadText(`${fileBase}.csv`, reportCsv(materialsAsReport(report, meta)), "text/csv;charset=utf-8")} disabled={!report.count} data-materials-csv>
            Spreadsheet
          </button>
        </div>
      </div>

      <div className={s.findBar}>
        <div className={s.extra} role="group" aria-label="Extra on top">
          <span>Extra on top</span>
          {EXTRAS.map((p) => (
            <button key={p} type="button" aria-pressed={extraPct === p} className={extraPct === p ? s.extraOn : undefined} onClick={() => onExtra(p)} data-materials-extra={p}>
              {p ? `+${p}%` : "None"}
            </button>
          ))}
        </div>
        <button type="button" className={s.btnGhost} onClick={onAsk}>
          Other materials
        </button>
        <button type="button" className={s.btnGhost} onClick={onEstimate}>
          Estimate a job
        </button>
      </div>

      {report.asked.length ? (
        <section className={`${s.card} ${s.asked}`}>
          <h2 className={s.h2}>Measured for “{report.request}”</h2>
          <div className={s.table} role="table">
            {report.asked.map((r, i) => (
              <div key={`${r.label}-${i}`} className={s.row} role="row">
                <span className={s.item} role="cell">
                  <b>{r.label}</b>
                  {r.note ? <small>{r.note}</small> : null}
                </span>
                <span className={s.value} role="cell">
                  {r.value}
                </span>
                <span className={`${s.src} ${r.source === "measured" ? s.srcMeasured : ""}`} role="cell">
                  {MEASURE_SOURCE_WORD[r.source]}
                </span>
                <span className={s.right} role="cell">
                  <Pages pages={r.pages} onPage={onPage} />
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {report.measures.length ? (
        <section className={s.card} data-materials-measures>
          <h2 className={s.h2}>What it is figured from</h2>
          <p className={s.p}>Correct any number and every material that rests on it follows.</p>
          <div className={s.table} role="table">
            {report.measures.map((m) => (
              <MeasureRowEdit key={m.id} m={m} onMeasure={onMeasure} onPage={onPage} />
            ))}
          </div>
        </section>
      ) : null}

      {report.groups.map((g) => (
        <section key={g.trade} className={s.card} data-materials-trade={g.trade}>
          <h2 className={s.h2}>
            {g.title} <span className={s.count}>· {g.lines.length} to order</span>
          </h2>
          <div className={s.table} role="table">
            <div className={`${s.row} ${s.rowHead}`} role="row">
              <span role="columnheader">Material</span>
              <span role="columnheader">To buy</span>
              <span role="columnheader">Source</span>
              <span role="columnheader" className={s.right}>
                Sheet
              </span>
            </div>
            {g.lines.map((l) => (
              <div key={l.id} className={s.row} role="row" data-material-line={l.id}>
                <span className={s.item} role="cell">
                  <b>{l.label}</b>
                  <small>{l.basis}</small>
                </span>
                <span className={s.value} role="cell">
                  {qtyWords(l.qty)} {l.unit}
                </span>
                <span className={`${s.src} ${l.source === "rule" ? s.srcAssumed : l.source === "measured" ? s.srcMeasured : ""}`} role="cell">
                  {MEASURE_SOURCE_WORD[l.source]}
                </span>
                <span className={s.right} role="cell">
                  <Pages pages={l.pages} onPage={onPage} />
                </span>
              </div>
            ))}
          </div>
        </section>
      ))}

      {deckAsk || report.deck ? (
        <section className={`${s.card} ${s.asked}`} data-materials-deck>
          <h2 className={s.h2}>{report.deck ? `Deck — ${report.deck.words}` : "The deck"}</h2>
          {report.deck && !editDeck ? (
            <>
              <p className={s.p}>
                Framed to the code tables by the Deck Studio{report.deck.spec.from === "plans" ? " — the size is the deck drawn on the plans" : ""}.{report.deck.fixes.length ? ` Sized up: ${report.deck.fixes.join("; ")}.` : ""}{" "}
                <button type="button" className={s.linkBtn} onClick={() => setEditDeck(true)} data-deck-change>
                  Change the deck
                </button>
              </p>
              {report.deck.groups.map((g) => (
                <div key={g.label} className={s.level}>
                  <h3 className={s.h3}>{g.label}</h3>
                  <div className={s.table} role="table">
                    {g.lines.map((l, i) => (
                      <div key={`${l.label}-${i}`} className={s.row} role="row" data-deck-line>
                        <span className={s.item} role="cell">
                          <b>{l.label}</b>
                          {l.note ? <small>{l.note}</small> : null}
                        </span>
                        <span className={s.value} role="cell">
                          {qtyWords(l.qty)} {l.unit}
                        </span>
                        <span className={s.src} role="cell">
                          Worked out
                        </span>
                        <span className={s.right} role="cell">
                          <span className={s.none}>—</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </>
          ) : (
            <>
              <p className={s.p}>{report.deck ? "Change the size, the height or the boards:" : "There is no deck on these plans. Give its size and the Deck Studio frames it to the code — footings, posts, beams, joists, decking, stairs and railing, with every hanger and screw."}</p>
              <DeckForm
                start={report.deck?.spec ?? deckAsk ?? {}}
                onDeck={(spec) => {
                  setEditDeck(false);
                  onDeck(spec);
                }}
              />
            </>
          )}
        </section>
      ) : null}

      {!report.count && !deckAsk ? <p className={s.empty}>Nothing to buy was found for that on these plans. Try another part of the house, or name the material.</p> : null}
      <p className={s.fine}>Quantities from the plans by JobFlex, in the units they are sold in, waste included as each line says. &ldquo;Assumed&rdquo; lines are a builder&apos;s rule where the plans are silent — confirm them before ordering.</p>
    </div>
  );
}
