"use client";
// Customer development · Hypotheses (owner, 2026-10-22): each one with how it is tested, the live evidence, the
// interviews that back or break it, and a verdict — the data's ("Data supports", "Too early") until the owner gives
// theirs (Validated, Invalidated, Testing), every change dated. Edit the words or the bar, add one, put one away.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CustDevView } from "@/lib/custDev/read";
import { AREAS, targetWords, type HypArea, type HypothesisView, type Status } from "@/lib/custDev/model";
import { custDevAddHypothesis, custDevSetHypothesis } from "@/actions/custDev";
import { Empty, Sheet, cx, useMdl } from "@/components/v3/admin-influencers/admin-ui";
import ui from "@/components/v3/admin-influencers/admin-ui.module.css";
import { Verdict, dateWords } from "./custdev-parts";
import s from "./custdev.module.css";

const STATUS_WORDS: Record<Status, string> = { auto: "Let the data decide", testing: "Testing", validated: "Validated", invalidated: "Invalidated" };
const RATIO = new Set(["proposalLift", "beachhead", "adActivation"]);

export function HypothesesTab({ view }: { view: CustDevView }) {
  const router = useRouter();
  const [showAway, setShowAway] = useState(false);
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<HypothesisView | null>(null);
  const edit = useMdl();
  const add = useMdl();

  const list = view.hypotheses.filter((h) => (showAway ? h.archived : !h.archived));
  const away = view.hypotheses.filter((h) => h.archived).length;

  const setStatus = (h: HypothesisView, status: Status) =>
    start(async () => {
      setError(null);
      const r = await custDevSetHypothesis({ id: h.id, status });
      if (!r.ok) setError(r.error);
      router.refresh();
    });

  return (
    <>
      <section className="card" aria-labelledby="cd-hyps">
        <div className={cx("card-head", ui.cardHead)}>
          <div className="card-titles">
            <div className="card-title" id="cd-hyps">Hypotheses</div>
            <div className="card-sub">What we believe about our customer, each with the test that proves it or kills it. The data gives its verdict; yours overrides it.</div>
          </div>
          <div className={s.cardActs}>
            {away ? (
              <button type="button" className={cx("btn", ui.btnGhost, ui.btnSm, s.tap)} aria-pressed={showAway} onClick={() => setShowAway((v) => !v)}>
                {showAway ? "Show open" : `Put away (${away})`}
              </button>
            ) : null}
            <button type="button" className={cx("btn", "btn-primary", ui.btnSm, s.tap)} onClick={() => add.open()} data-custdev-add-hyp>
              Add hypothesis
            </button>
          </div>
        </div>
        {error ? <p className={s.err} role="alert">{error}</p> : null}
        {list.length === 0 ? (
          <Empty>{showAway ? "Nothing put away." : "No open hypotheses."}</Empty>
        ) : (
          AREAS.map((a) => {
            const rows = list.filter((h) => h.area === a.key);
            if (!rows.length) return null;
            return (
              <div key={a.key} className={s.hypGroup}>
                <div className={s.secL}>{a.label}</div>
                <ul className={s.hyps}>
                  {rows.map((h) => (
                    <li key={h.id} className={s.hyp} data-custdev-hyp={h.id} data-shown={h.shown}>
                      <div className={s.hypMain}>
                        <p className={s.hypStatement}>{h.statement}</p>
                        <p className={s.hypTest}>
                          <span className={s.mono}>Test</span> {h.test}
                          {h.metric ? <span className={s.hypBar}> · bar {targetWords(h)}</span> : null}
                        </p>
                        {h.notes ? <p className={s.hypNotes}>{h.notes}</p> : null}
                        {h.history.length ? (
                          <p className={s.hypHist}>
                            {STATUS_WORDS[h.history[h.history.length - 1].status]} · {dateWords(h.history[h.history.length - 1].at)}
                            {h.history[h.history.length - 1].by ? ` · ${h.history[h.history.length - 1].by}` : ""}
                          </p>
                        ) : null}
                      </div>
                      <div className={s.hypEvidence}>
                        <span className={ui.tdLbl}>Evidence</span>
                        <span className={s.hypValue}>{h.evidence ? h.evidence.shown : "Interviews and what customers write"}</span>
                        <span className={s.hypTalks}>
                          Interviews: <b className={s.plus}>+{h.interviews.supports}</b> <b className={s.minus}>−{h.interviews.refutes}</b>
                        </span>
                      </div>
                      <div className={s.hypVerdict}>
                        <Verdict shown={h.shown} />
                        <label className={s.hypSelect}>
                          <span className="sr-only">Verdict for: {h.statement}</span>
                          <span className="bp-sel bp-sel--admin">
                            <select className="bp-sel-in" value={h.status} disabled={busy} onChange={(e) => setStatus(h, e.target.value as Status)} data-custdev-verdict={h.id}>
                              {(Object.keys(STATUS_WORDS) as Status[]).map((k) => (
                                <option key={k} value={k}>
                                  {STATUS_WORDS[k]}
                                </option>
                              ))}
                            </select>
                          </span>
                        </label>
                        <button
                          type="button"
                          className={cx("btn", ui.btnGhost, ui.btnSm, s.tap)}
                          onClick={() => {
                            setEditing(h);
                            edit.open();
                          }}
                        >
                          Edit
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })
        )}
      </section>
      <EditSheet handle={edit} h={editing} />
      <AddSheet handle={add} />
    </>
  );
}

type Handle = ReturnType<typeof useMdl>;

function EditSheet({ handle, h }: { handle: Handle; h: HypothesisView | null }) {
  return (
    <Sheet mdlRef={handle.ref} title="Hypothesis" titleId="cdEditT" size="lg" onClose={handle.close}>
      {h ? <EditBody key={h.id} h={h} onDone={handle.close} /> : null}
    </Sheet>
  );
}

/** The form, fresh for each hypothesis opened (the sheet itself stays mounted, so its open motion holds). */
function EditBody({ h, onDone }: { h: HypothesisView; onDone: () => void }) {
  const router = useRouter();
  const [statement, setStatement] = useState(h.statement);
  const [test, setTest] = useState(h.test);
  const [notes, setNotes] = useState(h.notes);
  const ratio = !!h.metric && RATIO.has(h.metric);
  const [bar, setBar] = useState(h.target === null ? "" : ratio ? String(h.target) : String(Math.round(h.target * 100)));
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const save = (archived?: boolean) =>
    start(async () => {
      setError(null);
      const n = bar.trim() === "" ? null : Number(bar);
      if (h.metric && (n === null || !Number.isFinite(n) || n < 0)) {
        setError("The bar is a number.");
        return;
      }
      const r = await custDevSetHypothesis({ id: h.id, statement, test, notes, target: h.metric ? (ratio ? n : (n as number) / 100) : undefined, archived });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      onDone();
      router.refresh();
    });
  return (
    <>
      <div className="mf">
        <label className="mf-lbl" htmlFor="cdHypStatement">We believe</label>
        <textarea className={cx("mf-in", ui.area)} id="cdHypStatement" rows={2} value={statement} onChange={(e) => setStatement(e.target.value)} maxLength={300} />
      </div>
      <div className="mf">
        <label className="mf-lbl" htmlFor="cdHypTest">We will know it when</label>
        <input className="mf-in" id="cdHypTest" value={test} onChange={(e) => setTest(e.target.value)} maxLength={300} />
      </div>
      {h.metric ? (
        <div className="mf">
          <label className="mf-lbl" htmlFor="cdHypBar">
            The bar ({h.op === ">=" ? "at least" : "at most"}
            {ratio ? ", times" : ", %"})
          </label>
          <input className="mf-in" id="cdHypBar" inputMode="decimal" value={bar} onChange={(e) => setBar(e.target.value)} />
          <div className={ui.hint}>Now: {h.evidence?.shown ?? "no data yet"}.</div>
        </div>
      ) : null}
      <div className="mf">
        <label className="mf-lbl" htmlFor="cdHypNotes">Notes and evidence</label>
        <textarea className={cx("mf-in", ui.area)} id="cdHypNotes" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} placeholder="What we saw, who said it, what we will try next" />
      </div>
      {h.history.length ? (
        <div className={s.histList}>
          <div className={ui.secL}>Verdicts</div>
          <ul>
            {[...h.history].reverse().map((x) => (
              <li key={x.at}>
                {dateWords(x.at)} — {STATUS_WORDS[x.status]}
                {x.by ? ` · ${x.by}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {error ? <p className={s.err} role="alert">{error}</p> : null}
      <div className={s.sheetActs}>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => save(!h.archived)}>
          {h.archived ? "Put back" : "Put away"}
        </button>
        <button type="button" className={cx("btn btn-primary", busy && ui.btnBusy)} disabled={busy} onClick={() => save()} data-custdev-hyp-save>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </>
  );
}

function AddSheet({ handle }: { handle: Handle }) {
  const router = useRouter();
  const [area, setArea] = useState<HypArea>("problem");
  const [statement, setStatement] = useState("");
  const [test, setTest] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const save = () =>
    start(async () => {
      setError(null);
      const r = await custDevAddHypothesis({ area, statement, test });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setStatement("");
      setTest("");
      handle.close();
      router.refresh();
    });
  return (
    <Sheet
      mdlRef={handle.ref}
      title="Add a hypothesis"
      titleId="cdAddT"
      size="lg"
      onClose={handle.close}
      error={error}
      foot={
        <button type="button" className={cx("btn btn-primary", busy && ui.btnBusy)} disabled={busy} onClick={save} data-custdev-add-save>
          {busy ? "Adding…" : "Add"}
        </button>
      }
    >
      <div className="mf">
        <label className="mf-lbl" htmlFor="cdAddArea">Area</label>
        <span className="bp-sel bp-sel--admin">
          <select className="bp-sel-in" id="cdAddArea" value={area} onChange={(e) => setArea(e.target.value as HypArea)}>
            {AREAS.map((a) => (
              <option key={a.key} value={a.key}>
                {a.label}
              </option>
            ))}
          </select>
        </span>
      </div>
      <div className="mf">
        <label className="mf-lbl" htmlFor="cdAddStatement">We believe</label>
        <textarea className={cx("mf-in", ui.area)} id="cdAddStatement" rows={2} value={statement} onChange={(e) => setStatement(e.target.value)} maxLength={300} placeholder="Roofers would pay more for a measurement they can trust without climbing." />
      </div>
      <div className="mf">
        <label className="mf-lbl" htmlFor="cdAddTest">We will know it when</label>
        <input className="mf-in" id="cdAddTest" value={test} onChange={(e) => setTest(e.target.value)} maxLength={300} placeholder="8 of 10 roofers we interview say yes" />
      </div>
      <div className={ui.hint}>A hypothesis you write is judged by its interviews and your verdict; it starts as Testing.</div>
    </Sheet>
  );
}

