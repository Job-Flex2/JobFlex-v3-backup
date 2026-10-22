"use client";

// ADMIN · CUSTOMER DEVELOPMENT — BLUEPRINT
// /admin/customer-development (owner, 2026-10-22)
//
// Steve Blank's customer development, read off what JobFlex keeps: where we are on the four steps and what each
// still needs (Overview), the hypotheses and their live evidence, the segments, the voice of the customer (support
// tickets and their emails, cancellation reasons, trial notes) and the discovery interviews with who to talk to next.
// The investor report (./report) prints the same picture without customer names. Furniture: admin-influencers/admin-ui.

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import type { CustDevView } from "@/lib/custDev/read";
import { pct, type SegmentRow } from "@/lib/custDev/model";
import { Chip, Empty, KpiStrip, cx, useMdl, useReveal } from "@/components/v3/admin-influencers/admin-ui";
import ui from "@/components/v3/admin-influencers/admin-ui.module.css";
import { Bar, hours } from "./custdev-parts";
import { CallCards } from "./custdev-calls";
import { HypothesesTab } from "./custdev-hypotheses";
import { VoiceTab } from "./custdev-voice";
import { InterviewSheet, InterviewsTab, type InterviewDraft } from "./custdev-interviews";
import s from "./custdev.module.css";

export type Tab = "overview" | "hypotheses" | "segments" | "voice" | "interviews";
const TABS: ReadonlyArray<{ key: Tab; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "hypotheses", label: "Hypotheses" },
  { key: "segments", label: "Segments" },
  { key: "voice", label: "Voice of the customer" },
  { key: "interviews", label: "Interviews" },
];

export function CustDevContent({ view, tab: first }: { view: CustDevView; tab: Tab }) {
  // The kit's KPI strip waits for the house entrance (`.rv` → `rv-in`); played once on mount.
  const rootRef = useRef<HTMLDivElement>(null);
  useReveal(rootRef);
  const [tab, setTab] = useState<Tab>(first);
  const pick = (t: Tab) => {
    setTab(t);
    try {
      const u = new URL(window.location.href);
      if (t === "overview") u.searchParams.delete("tab");
      else u.searchParams.set("tab", t);
      window.history.replaceState(null, "", u);
    } catch {
      /* the address bar is a convenience */
    }
  };

  // One interview sheet for the page: the header's button, a call card, the log's Edit.
  // `n` gives each opening a fresh form; the sheet itself stays mounted so its open motion holds.
  const [draft, setDraft] = useState<{ d: InterviewDraft; n: number } | null>(null);
  const sheet = useMdl();
  const { open: openSheet } = sheet;
  const logInterview = useCallback(
    (d: InterviewDraft) => {
      setDraft((prev) => ({ d, n: (prev?.n ?? 0) + 1 }));
      openSheet();
    },
    [openSheet],
  );

  const m = view.measures;
  const current = view.stages.find((x) => x.key === view.current);
  const st = view.interviewStats;

  return (
    <div ref={rootRef} className={s.root} data-custdev>
      <div className={cx("page-head", s.head)}>
        <div>
          <div className="kicker">Platform · Growth</div>
          <h1 className="page-title">Customer development</h1>
          <p className={s.lead}>
            Who our customer is, what they tell us, and what we have proven — read from JobFlex&apos;s own records, the support inbox and the interviews we log.
          </p>
        </div>
        <div className={s.headActs}>
          <Link className="btn btn-ghost" href={"/admin/customer-development/report" as Route} target="_blank" data-custdev-report>
            Investor report
          </Link>
          <button type="button" className="btn btn-primary" onClick={() => logInterview({})} data-custdev-log>
            Log an interview
          </button>
        </div>
      </div>

      {view.missing.length ? (
        <p className={s.missing} role="status">
          Not in this database yet: {view.missing.join(", ")} — those parts are left out.
        </p>
      ) : null}

      <KpiStrip
        cols={5}
        cells={[
          { label: "We are at", value: current ? current.label.replace(/^Customer (\w)/, (_, c: string) => c.toUpperCase()) : "—", accent: true },
          { label: "Sign-ups", value: String(view.totals.signups) },
          { label: "Active in week 1", value: pct(m.activation) },
          { label: "Trial → paid", value: pct(m.trialToPaid) },
          { label: "Paying now", value: String(view.totals.payingNow), tone: view.totals.payingNow ? "ok" : undefined },
        ]}
      />

      <div className={s.tabs} role="tablist" aria-label="Customer development">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={cx(s.tab, tab === t.key && s.tabOn)}
            onClick={() => pick(t.key)}
            data-custdev-tab={t.key}
          >
            {t.label}
            {t.key === "interviews" && st.total ? <i>{st.total}</i> : null}
            {t.key === "voice" && view.voice.total ? <i>{view.voice.total}</i> : null}
          </button>
        ))}
      </div>

      {tab === "overview" ? <Overview view={view} onLog={logInterview} onTab={pick} /> : null}
      {tab === "hypotheses" ? <HypothesesTab view={view} /> : null}
      {tab === "segments" ? <Segments view={view} /> : null}
      {tab === "voice" ? <VoiceTab view={view} /> : null}
      {tab === "interviews" ? <InterviewsTab view={view} onLog={logInterview} /> : null}

      <InterviewSheet handle={sheet} draft={draft} view={view} />
    </div>
  );
}

/* ── Overview ──────────────────────────────────────────────────────────────────────────────────────────────────── */

function Overview({ view, onLog, onTab }: { view: CustDevView; onLog: (d: InterviewDraft) => void; onTab: (t: Tab) => void }) {
  const steps = view.stages;
  const currentIndex = steps.findIndex((x) => x.key === view.current);
  const maxFunnel = view.funnel[0]?.n ?? 0;
  const proven = view.hypotheses.filter((h) => !h.archived && (h.shown === "validated" || h.shown === "supported")).length;
  const disproven = view.hypotheses.filter((h) => !h.archived && (h.shown === "invalidated" || h.shown === "refuted")).length;
  const open = view.hypotheses.filter((h) => !h.archived).length - proven - disproven;
  return (
    <>
      <section className="card" aria-labelledby="cd-steps">
        <div className={cx("card-head", ui.cardHead)}>
          <div className="card-titles">
            <div className="card-title" id="cd-steps">The four steps</div>
            <div className="card-sub">Each step is passed when every check under it is met — measured, not judged.</div>
          </div>
        </div>
        <ol className={s.steps}>
          {steps.map((step, i) => (
            <li key={step.key} className={cx(s.step, i === currentIndex && s.stepNow, step.done && s.stepDone)} data-custdev-step={step.key} aria-current={i === currentIndex ? "step" : undefined}>
              <div className={s.stepHead}>
                <span className={s.stepNo}>{i + 1}</span>
                <span className={s.stepName}>{step.label}</span>
                {step.done ? <Chip tone="ok">Passed</Chip> : i === currentIndex ? <Chip tone="bp">We are here</Chip> : <Chip tone="mute">Ahead</Chip>}
              </div>
              <p className={s.stepQ}>{step.question}</p>
              <ul className={s.checks}>
                {step.criteria.map((c) => (
                  <li key={c.label} className={cx(s.check, c.met && s.checkMet)}>
                    <span className={s.checkBox} aria-hidden="true">{c.met ? "✓" : ""}</span>
                    <span>
                      <span className={s.checkLabel}>{c.label}</span>
                      <span className={s.checkNow}>{c.now}</span>
                    </span>
                    <span className="sr-only">{c.met ? "met" : "not met yet"}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </section>

      <div className={s.two}>
        <section className="card" aria-labelledby="cd-funnel">
          <div className={cx("card-head", ui.cardHead)}>
            <div className="card-titles">
              <div className="card-title" id="cd-funnel">From sign-up to paying</div>
              <div className="card-sub">Every counted account since the start · the share is of all sign-ups.</div>
            </div>
          </div>
          <div className={s.funnel}>
            {view.funnel.map((f) => (
              <div key={f.key} className={s.funnelRow} data-custdev-funnel={f.key}>
                <span className={s.funnelLabel}>{f.label}</span>
                <Bar value={f.n} max={maxFunnel} tone={f.key === "paying" || f.key === "paid" ? "ok" : "bp"} />
                <span className={s.num}>{f.n}</span>
                <span className={s.numSoft}>{f.ofAll === null ? "" : pct(f.ofAll)}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="card" aria-labelledby="cd-hyp">
          <div className={cx("card-head", ui.cardHead)}>
            <div className="card-titles">
              <div className="card-title" id="cd-hyp">What we have proven</div>
              <div className="card-sub">{view.hypotheses.filter((h) => !h.archived).length} hypotheses · {view.interviewStats.total} interviews</div>
            </div>
            <button type="button" className={cx("btn", ui.btnGhost, ui.btnSm, s.tap)} onClick={() => onTab("hypotheses")}>
              Open
            </button>
          </div>
          <div className={s.proven}>
            <div className={s.provenCell} data-tone="ok">
              <span className={s.provenN}>{proven}</span>
              <span>supported or validated</span>
            </div>
            <div className={s.provenCell} data-tone="bad">
              <span className={s.provenN}>{disproven}</span>
              <span>not supported</span>
            </div>
            <div className={s.provenCell} data-tone="mute">
              <span className={s.provenN}>{open}</span>
              <span>still open</span>
            </div>
          </div>
          {view.segments.early ? (
            <p className={s.note}>
              <b>Early adopters so far:</b> {view.segments.early.key} contractors turn trials into paying customers {view.segments.early.lift.toFixed(1)}× as often as the average.
            </p>
          ) : (
            <p className={s.note}>No trade stands out yet — it takes at least five finished trials in a trade to say.</p>
          )}
        </section>
      </div>

      <section className="card" aria-labelledby="cd-cohorts">
        <div className={cx("card-head", ui.cardHead)}>
          <div className="card-titles">
            <div className="card-title" id="cd-cohorts">Week by week</div>
            <div className="card-sub">Each week&apos;s sign-ups and what they went on to do. A week&apos;s first-week use shows once the week is a week old.</div>
          </div>
        </div>
        <div className={cx(ui.tbl, s.tblScroll)} role="table" aria-label="Weekly cohorts">
          <div className={cx(ui.tr, ui.th, s.cohortCols)} role="row">
            <span>Week of</span>
            <span>Sign-ups</span>
            <span>Used a tool in week 1</span>
            <span>Sent a proposal</span>
            <span>Paid</span>
            <span>Paying now</span>
          </div>
          {view.cohorts.map((c) => (
            <div key={c.week} className={cx(ui.tr, s.cohortCols)} role="row" data-custdev-week={c.label}>
              <span className={s.cellStrong}>{c.label}</span>
              <span className={s.num}><span className={ui.tdLbl}>Sign-ups</span>{c.signups}</span>
              <span className={s.num}><span className={ui.tdLbl}>Week-1 use</span>{pct(c.activation)}</span>
              <span className={s.num}><span className={ui.tdLbl}>Sent a proposal</span>{pct(c.sentProposal)}</span>
              <span className={s.num}><span className={ui.tdLbl}>Paid</span>{pct(c.paid)}</span>
              <span className={s.num}><span className={ui.tdLbl}>Paying now</span>{c.payingNow}</span>
            </div>
          ))}
        </div>
        {view.weeks.length ? (
          <div className={s.tracked}>
            <div className={s.secL}>Scorecard kept every week since {view.weeks[0].week}</div>
            <div className={cx(ui.tbl, s.tblScroll)} role="table" aria-label="Weekly scorecard">
              <div className={cx(ui.tr, ui.th, s.scoreCols)} role="row">
                <span>Week</span>
                <span>Sign-ups</span>
                <span>Paying</span>
                <span>Week-1 use</span>
                <span>Trial → paid</span>
                <span>Interviews</span>
                <span>Proven / not</span>
              </div>
              {view.weeks.slice(-8).reverse().map((w) => (
                <div key={w.week} className={cx(ui.tr, s.scoreCols)} role="row">
                  <span className={s.cellStrong}>{w.week}</span>
                  <span className={s.num}><span className={ui.tdLbl}>Sign-ups</span>{w.signups}</span>
                  <span className={s.num}><span className={ui.tdLbl}>Paying</span>{w.payingNow}</span>
                  <span className={s.num}><span className={ui.tdLbl}>Week-1 use</span>{pct(w.activation)}</span>
                  <span className={s.num}><span className={ui.tdLbl}>Trial → paid</span>{pct(w.trialToPaid)}</span>
                  <span className={s.num}><span className={ui.tdLbl}>Interviews</span>{w.interviews}</span>
                  <span className={s.num}><span className={ui.tdLbl}>Proven / not</span>{w.validated} / {w.invalidated}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <section className="card" aria-labelledby="cd-calls">
        <div className={cx("card-head", ui.cardHead)}>
          <div className="card-titles">
            <div className="card-title" id="cd-calls">Who to talk to next</div>
            <div className="card-sub">Picked from the accounts: who paid, whose trial is ending, who went quiet, who left, who wrote to us.</div>
          </div>
          <button type="button" className={cx("btn", ui.btnGhost, ui.btnSm, s.tap)} onClick={() => onTab("interviews")}>
            All {view.calls.length}
          </button>
        </div>
        <CallCards calls={view.calls.slice(0, 6)} onLog={onLog} />
      </section>
    </>
  );
}

/* ── Segments ──────────────────────────────────────────────────────────────────────────────────────────────────── */

function Segments({ view }: { view: CustDevView }) {
  return (
    <>
      <section className="card" aria-labelledby="cd-early">
        <div className={cx("card-head", ui.cardHead)}>
          <div className="card-titles">
            <div className="card-title" id="cd-early">Early adopters</div>
            <div className="card-sub">The trade whose trials turn into paying customers most often — at least five finished trials.</div>
          </div>
        </div>
        {view.segments.early ? (
          <p className={s.callout}>
            <b>{view.segments.early.key}</b> — {view.segments.early.lift.toFixed(1)}× the average trial → paid rate. Talk to them first, build for them first, and aim the ads at them.
          </p>
        ) : (
          <Empty>No trade has five finished trials yet. Until it does, the table below is the evidence.</Empty>
        )}
      </section>
      <SegmentTable title="By trade" id="cd-trade" rows={view.segments.trade} overall={view.segments.overall} />
      <SegmentTable title="By sign-up channel" id="cd-channel" rows={view.segments.channel} overall={view.segments.overall} />
    </>
  );
}

function SegmentTable({ title, id, rows, overall }: { title: string; id: string; rows: SegmentRow[]; overall: SegmentRow }) {
  const max = Math.max(1, ...rows.map((r) => r.signups));
  return (
    <section className="card" aria-labelledby={id}>
      <div className={cx("card-head", ui.cardHead)}>
        <div className="card-titles">
          <div className="card-title" id={id}>{title}</div>
          <div className="card-sub">Rates count only the accounts that have had the chance: a week old for week-1 use, a finished trial for trial → paid.</div>
        </div>
      </div>
      {rows.length === 0 ? (
        <Empty>No accounts yet.</Empty>
      ) : (
        <div className={cx(ui.tbl, s.tblScroll)} role="table" aria-label={title}>
          <div className={cx(ui.tr, ui.th, s.segCols)} role="row">
            <span>Segment</span>
            <span>Sign-ups</span>
            <span>Week-1 use</span>
            <span>Sent a proposal</span>
            <span>Trial → paid</span>
            <span>Paying</span>
            <span>Left</span>
            <span>To first estimate</span>
          </div>
          {[...rows, overall].map((r) => (
            <div key={r.key} className={cx(ui.tr, s.segCols, r === overall && s.rowTotal)} role="row" data-custdev-segment={r.key}>
              <span className={s.segName}>
                <span className={s.cellStrong}>{r === overall ? "All accounts" : r.key}</span>
                {r === overall ? null : <Bar value={r.signups} max={max} />}
              </span>
              <span className={s.num}><span className={ui.tdLbl}>Sign-ups</span>{r.signups}</span>
              <span className={s.num}><span className={ui.tdLbl}>Week-1 use</span>{pct(r.activation)}<small>{r.activation.of ? ` of ${r.activation.of}` : ""}</small></span>
              <span className={s.num}><span className={ui.tdLbl}>Sent a proposal</span>{pct(r.sentProposal)}</span>
              <span className={s.num}><span className={ui.tdLbl}>Trial → paid</span>{pct(r.trialToPaid)}<small>{r.trialToPaid.of ? ` of ${r.trialToPaid.of}` : ""}</small></span>
              <span className={s.num}><span className={ui.tdLbl}>Paying</span>{r.payingNow}</span>
              <span className={s.num}><span className={ui.tdLbl}>Left</span>{r.left}</span>
              <span className={s.num}><span className={ui.tdLbl}>To first estimate</span>{hours(r.hoursToFirstValue)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
