"use client";
// SIZES & MEASUREMENTS, ON THE SCREEN (2026-10-21) — the report lib/plans/measureReport makes from every sheet read,
// on the desk page and the phone page alike: the headline figures, a find box, what was asked, every room by floor,
// then each part of the house — each figure with where it came from and a link to its sheet. Download PDF (built in
// the browser, measure-pdf) and the spreadsheet.
import { useMemo, useState } from "react";
import s from "./measure-report.module.css";
import { filterReport, MEASURE_SOURCE_WORD, reportCsv, withFirst, type MeasureRow, type RoomRow } from "@/lib/plans/measureReport";
import { downloadText } from "@/lib/plans/csv";
import type { Sizes } from "./use-blueprint-estimator";
import { toast } from "@/components/ui/Toast";

type Props = {
  sizes: Sizes;
  plan: { name: string | null; address: string | null; file: string };
  onPage: (page: number) => void;
  /** Back to the question, to ask for another size. */
  onAsk: () => void;
  /** Price a job from the same plans. */
  onEstimate: () => void;
};

function Pages({ pages, onPage }: { pages: number[]; onPage: (p: number) => void }) {
  if (!pages.length) return <span className={s.none}>—</span>;
  return (
    <span className={s.pages}>
      {pages.slice(0, 4).map((p) => (
        <button key={p} type="button" className={s.page} onClick={() => onPage(p)} aria-label={`Open sheet ${p}`}>
          p.{p}
        </button>
      ))}
      {pages.length > 4 ? <span className={s.none}>+{pages.length - 4}</span> : null}
    </span>
  );
}

function Rows({ rows, onPage }: { rows: MeasureRow[]; onPage: (p: number) => void }) {
  return (
    <div className={s.table} role="table">
      <div className={`${s.row} ${s.rowHead}`} role="row">
        <span role="columnheader">Item</span>
        <span role="columnheader">Measurement</span>
        <span role="columnheader">Source</span>
        <span role="columnheader" className={s.right}>
          Sheet
        </span>
      </div>
      {rows.map((r, i) => (
        <div key={`${r.label}-${i}`} className={s.row} role="row" data-measure-row>
          <span className={s.item} role="cell">
            <b>{r.label}</b>
            {r.note ? <small>{r.note}</small> : null}
          </span>
          <span className={s.value} role="cell">
            {r.value}
          </span>
          <span className={`${s.src} ${r.source === "rule" ? s.srcAssumed : r.source === "measured" ? s.srcMeasured : ""}`} role="cell">
            {MEASURE_SOURCE_WORD[r.source]}
          </span>
          <span className={s.right} role="cell">
            <Pages pages={r.pages} onPage={onPage} />
          </span>
        </div>
      ))}
    </div>
  );
}

function Rooms({ rooms, onPage }: { rooms: RoomRow[]; onPage: (p: number) => void }) {
  const levels = Array.from(new Set(rooms.map((r) => r.level)));
  return (
    <>
      {levels.map((lv) => {
        const list = rooms.filter((r) => r.level === lv);
        const area = list.reduce((a, r) => a + (r.areaSqFt ?? 0), 0);
        return (
          <div key={lv} className={s.level}>
            <h3 className={s.h3}>
              {lv} floor <span>· {list.length} room{list.length === 1 ? "" : "s"} · {area.toLocaleString("en-US")} sq ft inside the walls</span>
            </h3>
            <div className={s.table} role="table">
              <div className={`${s.room} ${s.rowHead}`} role="row">
                <span role="columnheader">Room</span>
                <span role="columnheader">Size</span>
                <span role="columnheader" className={s.right}>
                  Sq ft
                </span>
                <span role="columnheader">Ceiling</span>
                <span role="columnheader">Floor</span>
                <span role="columnheader" className={s.right}>
                  Sheet
                </span>
              </div>
              {list.map((r, i) => (
                <div key={`${r.name}-${i}`} className={s.room} role="row" data-measure-room>
                  <span className={s.item} role="cell">
                    <b>{r.name}</b>
                  </span>
                  <span role="cell">{r.size ?? <span className={s.none}>no size on the plans</span>}</span>
                  <span className={`${s.value} ${s.right}`} role="cell">
                    {r.areaSqFt != null ? r.areaSqFt.toLocaleString("en-US") : "—"}
                    {r.estimated ? (
                      <em className={s.est} title="No size on the plans — shared out from the floor's area. Measure on site.">
                        est.
                      </em>
                    ) : null}
                  </span>
                  <span role="cell">{r.ceiling ?? <span className={s.none}>—</span>}</span>
                  <span role="cell">{r.floor ?? <span className={s.none}>—</span>}</span>
                  <span className={s.right} role="cell">
                    <Pages pages={r.pages} onPage={onPage} />
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

export function MeasureReportView({ sizes, plan, onPage, onAsk, onEstimate }: Props) {
  const [find, setFind] = useState("");
  const [making, setMaking] = useState(false);
  const report = useMemo(() => filterReport(withFirst(sizes.report, sizes.focus), find), [sizes, find]);
  const full = sizes.report;
  const focusFirst = sizes.focus && sizes.focus !== "rooms" ? report.sections.filter((x) => x.key === sizes.focus) : [];
  const rest = report.sections.filter((x) => !focusFirst.includes(x));
  const nothing = find.trim() && !report.rooms.length && !report.sections.length && !(report.asked?.rows.length ?? 0);

  const downloadPdf = async () => {
    setMaking(true);
    try {
      const { downloadMeasurePdf } = await import("./measure-pdf");
      await downloadMeasurePdf(full, plan);
    } catch (err) {
      console.error("[measure-pdf]", err);
      toast.error("The PDF could not be made", err instanceof Error ? err.message : "Try again.");
    } finally {
      setMaking(false);
    }
  };
  const name = (plan.name || plan.file.replace(/\.pdf$/i, "") || "Plans").trim();

  const section = (x: (typeof report.sections)[number]) => (
    <section key={x.key} className={s.card} data-measure-section={x.key}>
      <h2 className={s.h2}>{x.title}</h2>
      <Rows rows={x.rows} onPage={onPage} />
    </section>
  );

  return (
    <div className={s.mr} data-measure-report>
      <div className={s.top}>
        <div className={s.titles}>
          <div className={s.kicker}>Sizes & measurements · {full.sheets} sheet{full.sheets === 1 ? "" : "s"} read</div>
          <h1 className={s.title}>{name}</h1>
          {plan.address ? <p className={s.sub}>{plan.address}</p> : null}
        </div>
        <div className={s.actions}>
          <button type="button" className={s.btnPrimary} onClick={() => void downloadPdf()} disabled={making} data-measure-pdf>
            {making ? "Making the PDF…" : "Download PDF"}
          </button>
          <button type="button" className={s.btnGhost} onClick={() => downloadText(`${name} — sizes and measurements.csv`, reportCsv(full), "text/csv;charset=utf-8")} data-measure-csv>
            Spreadsheet
          </button>
        </div>
      </div>

      <dl className={s.summary}>
        {full.summary.map((x) => (
          <div key={x.label}>
            <dt>{x.label}</dt>
            <dd>{x.value}</dd>
          </div>
        ))}
      </dl>

      <div className={s.findBar}>
        <label className={s.find}>
          <span className={s.srOnly}>Find a size</span>
          <input id="measure-find" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a size — kitchen, closet, window, roof, baseboard…" data-measure-find />
        </label>
        <button type="button" className={s.btnGhost} onClick={onAsk}>
          Measure something else
        </button>
        <button type="button" className={s.btnGhost} onClick={onEstimate}>
          Estimate a job
        </button>
      </div>

      {nothing ? <p className={s.empty}>Nothing on these plans matches “{find.trim()}”. Try another word, or ask for it to be measured.</p> : null}

      {report.asked ? (
        <section className={`${s.card} ${s.asked}`} data-measure-asked>
          <h2 className={s.h2}>You asked: {report.asked.request}</h2>
          {report.asked.rows.length ? <Rows rows={report.asked.rows} onPage={onPage} /> : <p className={s.p}>Nothing was measured for that on the sheets — look for it in the tables below, or say it another way.</p>}
        </section>
      ) : null}

      {focusFirst.map(section)}

      {report.rooms.length ? (
        <section className={s.card} data-measure-section="rooms">
          <h2 className={s.h2}>Rooms</h2>
          <Rooms rooms={report.rooms} onPage={onPage} />
        </section>
      ) : null}

      {rest.map(section)}

      {full.checks.length && !find.trim() ? (
        <section className={`${s.card} ${s.checks}`}>
          <h2 className={s.h2}>To check on site</h2>
          <ul>
            {full.checks.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </section>
      ) : null}
      <p className={s.fine}>Read from the plans by JobFlex. &ldquo;On the plans&rdquo; is written on a sheet; &ldquo;worked out&rdquo; is figured from what is; &ldquo;assumed&rdquo; is a builder&apos;s rule where the plans are silent. Verify critical sizes on site before ordering.</p>
    </div>
  );
}
