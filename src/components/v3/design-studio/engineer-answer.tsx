"use client";
// The engineer's answers on the request page (milestone 5): a box under each change's questions, the engineer's name
// (and license) and a note, sent back to the contractor. Shown as answered once it has been.
import * as React from "react";
import s from "./engineering-sheet.module.css";
import { answerEngineeringRequest } from "@/actions/designEngineering";
import type { EngAnswer } from "@/lib/design/engineering";

type Ctx = { answers: Record<string, string>; set: (id: string, v: string) => void; done: EngAnswer | null };
const AnswerCtx = React.createContext<Ctx | null>(null);

export function AnswerProvider({ token, initial, company, children }: { token: string; initial: EngAnswer | null; company: string; children: React.ReactNode }) {
  const [answers, setAnswers] = React.useState<Record<string, string>>({});
  const [done, setDone] = React.useState<EngAnswer | null>(initial);
  const [by, setBy] = React.useState("");
  const [license, setLicense] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const set = React.useCallback((id: string, v: string) => setAnswers((a) => ({ ...a, [id]: v })), []);
  const send = async () => {
    setBusy(true);
    setError(null);
    const r = await answerEngineeringRequest(token, { by, license: license || undefined, email, note: note || undefined, perChange: answers });
    setBusy(false);
    if (r.ok) setDone({ by, ...(license ? { license } : {}), ...(note ? { note } : {}), perChange: answers, at: r.at });
    else setError(r.error);
  };
  return (
    <AnswerCtx.Provider value={{ answers, set, done }}>
      {children}
      <section className={s.section} data-eng-answer-form>
        {done ? (
          <>
            <h2 className={s.h2}>Answered</h2>
            <p className={s.ok} data-eng-answered>
              {done.by}
              {done.license ? ` · ${done.license}` : ""} · {new Date(done.at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} — sent to {company}.
            </p>
            {done.note ? <p className={s.answered}>{done.note}</p> : null}
          </>
        ) : (
          <>
            <h2 className={s.h2}>Send your answer to {company}</h2>
            <div className={s.row}>
              <label>
                <span className={s.label}>Your name</span>
                <input id="eng-by" className={s.input} value={by} onChange={(e) => setBy(e.target.value)} autoComplete="name" data-eng-by />
              </label>
              <label>
                <span className={s.label}>License (optional)</span>
                <input id="eng-license" className={s.input} value={license} onChange={(e) => setLicense(e.target.value)} placeholder="PE 12345, WA" />
              </label>
              <label>
                <span className={s.label}>Your email (for their reply)</span>
                <input id="eng-email" className={s.input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
              </label>
            </div>
            <label style={{ display: "block", marginTop: 12 }}>
              <span className={s.label}>A note for the whole job (optional)</span>
              <textarea id="eng-note" className={s.area} value={note} onChange={(e) => setNote(e.target.value)} placeholder="A site visit needed first, the fee, a timeline…" />
            </label>
            {error ? <p className={s.err}>{error}</p> : null}
            <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
              <button type="button" className={s.btn} onClick={send} disabled={busy || by.trim().length < 2} data-eng-send>
                {busy ? "Sending…" : "Send the answer"}
              </button>
              <button type="button" className={`${s.btn} ${s.ghost} ${s.noPrint}`} onClick={() => window.print()}>
                Print or save as PDF
              </button>
            </div>
          </>
        )}
      </section>
    </AnswerCtx.Provider>
  );
}

/** The box under one change's questions (or the answer given). */
export function AnswerBox({ id }: { id: string }) {
  const ctx = React.useContext(AnswerCtx);
  if (!ctx) return null;
  if (ctx.done) {
    const a = ctx.done.perChange[id];
    return a ? <p className={s.answered}>{a}</p> : null;
  }
  return (
    <label className={s.noPrint} style={{ display: "block" }}>
      <span className={s.label}>Your answer</span>
      <textarea id={`eng-a-${id}`} className={s.area} value={ctx.answers[id] ?? ""} onChange={(e) => ctx.set(id, e.target.value)} placeholder="Beam size and grade, posts and footings, header, notes…" data-eng-answer={id} />
    </label>
  );
}
