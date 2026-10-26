"use client";
// THE PITCH DECK'S OWN WORDS on /admin/investors (2026-10-25): the slides only the owner can write — the raise and what
// is next. An empty box keeps its slide off the link's Pitch deck (lib/investorPitch). No team box: the founders and
// roles are shared after a preliminary offer, never on the link (owner, 2026-10-25).
import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { saveInvestorPitchAction } from "@/actions/investors";
import type { InvestorPitch } from "@/lib/investorPitch";
import { RAISE_DRAFT } from "@/lib/investorPitchShared";
import s from "./admin-investors.module.css";
import p from "./pitch-words.module.css";

const BOXES: Array<{ key: "ask" | "roadmap"; label: string; hint: string; example: string }> = [
  { key: "ask", label: "The raise", hint: "First line is the slide's headline; each line after it is one thing the money pays for. Empty: the slide says “We're raising — offers and first conversations welcome.”", example: "Raising $750K pre-seed\nPaid ads in the four trades that convert\nTwo engineers for the estimators\nSales: the AI desk outbound" },
  { key: "roadmap", label: "What's next", hint: "One item per line, in order. Empty: no roadmap slide.", example: "Payments inside the proposal for every trade\nSpanish for crews" },
];

/** The raise's first draft lives in lib/investorPitchShared (the link reads it too, until the owner saves their own). */
export { RAISE_DRAFT };

export function PitchWordsPanel({ initial, linkBase }: { initial: InvestorPitch; /** The live shared link, or null when it is off. */ linkBase: string | null }) {
  // Nothing saved for the raise yet: the box starts with the draft (not on the link until saved).
  const [words, setWords] = useState({ ask: initial.ask || RAISE_DRAFT, roadmap: initial.roadmap });
  const [saved, setSaved] = useState(initial);
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const changed = words.ask !== saved.ask || words.roadmap !== saved.roadmap;

  const save = async () => {
    setPending(true);
    setNote(null);
    try {
      const r = await saveInvestorPitchAction(words);
      if (r.ok) {
        setSaved(r.pitch);
        setWords({ ask: r.pitch.ask, roadmap: r.pitch.roadmap });
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
      <p className={s.hint}>The investor link has three pages now: the figures, a <b>pitch deck</b> and a <b>platform tour</b> of 30 real screens. The deck builds itself from the product, these live figures, the plan prices, the comparison on the landing page and market facts with their sources; these two slides are yours to write. The founders and the team are not on the link: the deck tells investors that the founding team, the company structure and the cap table go to shortlisted investors after your review of their indicative offer.</p>
      <div className={p.boxes}>
        {BOXES.map((b) => (
          <label key={b.key} className={p.box}>
            <span className={p.label}>{b.label}</span>
            <textarea className={p.area} id={`pitch-${b.key}`} rows={b.key === "ask" ? 10 : 6} maxLength={2000} value={words[b.key]} placeholder={b.example} onChange={(e) => setWords((w) => ({ ...w, [b.key]: e.target.value }))} data-pitch-box={b.key} />
            {b.key === "ask" && !saved.ask && words.ask === RAISE_DRAFT ? <span className={p.draft} data-pitch-draft>A first draft, written for you — it is what the link shows at the top and on the deck&apos;s ask slide until you change it here and save.</span> : null}
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
