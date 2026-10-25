"use client";
// THE PITCH DECK'S OWN WORDS on /admin/investors (2026-10-25): the three slides only the owner can write — the team,
// the raise, what is next. An empty box keeps its slide off the link's Pitch deck (lib/investorPitch).
import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { saveInvestorPitchAction } from "@/actions/investors";
import type { InvestorPitch } from "@/lib/investorPitch";
import s from "./admin-investors.module.css";
import p from "./pitch-words.module.css";

const BOXES: Array<{ key: "ask" | "team" | "roadmap"; label: string; hint: string; example: string }> = [
  { key: "ask", label: "The raise", hint: "First line is the slide's headline; each line after it is one thing the money pays for. Empty: the slide says “We're raising — offers and first conversations welcome.”", example: "Raising $750K pre-seed\nPaid ads in the four trades that convert\nTwo engineers for the estimators\nSales: the AI desk outbound" },
  { key: "team", label: "The team", hint: "One person per line: Name — role — a line about them. Empty: no team slide.", example: "Jane Doe — Founder, CEO — 12 years running a roofing company" },
  { key: "roadmap", label: "What's next", hint: "One item per line, in order. Empty: no roadmap slide.", example: "Payments inside the proposal for every trade\nSpanish for crews" },
];

export function PitchWordsPanel({ initial, linkBase }: { initial: InvestorPitch; /** The live shared link, or null when it is off. */ linkBase: string | null }) {
  const [words, setWords] = useState({ ask: initial.ask, team: initial.team, roadmap: initial.roadmap });
  const [saved, setSaved] = useState(initial);
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const changed = words.ask !== saved.ask || words.team !== saved.team || words.roadmap !== saved.roadmap;

  const save = async () => {
    setPending(true);
    setNote(null);
    try {
      const r = await saveInvestorPitchAction(words);
      if (r.ok) {
        setSaved(r.pitch);
        setWords({ ask: r.pitch.ask, team: r.pitch.team, roadmap: r.pitch.roadmap });
        setNote({ ok: true, text: "Saved — the Pitch deck shows it now." });
      } else setNote({ ok: false, text: r.error });
    } catch {
      setNote({ ok: false, text: "The words could not be saved. Try again." });
    } finally {
      setPending(false);
    }
  };

  return (
    <section className={`${s.panel} ${p.wide}`} aria-label="Pitch deck words" data-pitch-words>
      <div className={p.head}>
        <h2 className={s.panelTitle}>Pitch deck · your words</h2>
        {linkBase ? (
          <div className={p.opens}>
            <a className="btn btn-ghost" href={`${linkBase}/pitch`} target="_blank" rel="noreferrer"><ExternalLink size={14} aria-hidden="true" />Pitch deck</a>
            <a className="btn btn-ghost" href={`${linkBase}/tour`} target="_blank" rel="noreferrer"><ExternalLink size={14} aria-hidden="true" />Platform tour</a>
          </div>
        ) : null}
      </div>
      <p className={s.hint}>The investor link has three pages now: the figures, a <b>pitch deck</b> and a <b>platform tour</b> of 30 real screens. The deck builds itself from the product, these live figures, the plan prices and the comparison on the landing page; these three slides are yours to write.</p>
      <div className={p.boxes}>
        {BOXES.map((b) => (
          <label key={b.key} className={p.box}>
            <span className={p.label}>{b.label}</span>
            <textarea className={p.area} id={`pitch-${b.key}`} rows={6} maxLength={2000} value={words[b.key]} placeholder={b.example} onChange={(e) => setWords((w) => ({ ...w, [b.key]: e.target.value }))} data-pitch-box={b.key} />
            <span className={s.hint}>{b.hint}</span>
          </label>
        ))}
      </div>
      <div className={s.linkActs}>
        <button type="button" className="btn btn-primary" disabled={pending || !changed} onClick={() => void save()} data-pitch-save>{pending ? "Saving…" : "Save the words"}</button>
        {saved.updatedAt ? <span className={s.hint}>Last saved {new Date(saved.updatedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}{saved.updatedBy ? ` by ${saved.updatedBy}` : ""}</span> : null}
        {note ? <span className={`${s.hint} ${note.ok ? p.ok : p.bad}`} role="status">{note.text}</span> : null}
      </div>
    </section>
  );
}
