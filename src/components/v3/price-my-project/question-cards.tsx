"use client";
// THE THREE QUESTIONS (owner, 2026-10-27: "very attractive, easy enough for a homeowner"): picture answers, never a
// form — what's on the roof now, how many floors, what they'd like; then three optional notes. Pure UI: the answers
// live with the flow, this draws them.
import { EXISTING, MATERIALS, type RoofAnswers } from "@/lib/publicEstimate/roof";
import s from "./price.module.css";

function Opt({ on, onClick, label, blurb, name }: { on: boolean; onClick: () => void; label: string; blurb?: string; name: string }) {
  return (
    <button type="button" role="radio" aria-checked={on} className={`${s.opt}${on ? ` ${s.optOn}` : ""}`} onClick={onClick} data-price-opt={name}>
      <span>{label}</span>
      {blurb ? <span className={s.optB}>{blurb}</span> : null}
    </button>
  );
}

export function QuestionCards({ answers, onChange }: { answers: RoofAnswers; onChange: (a: RoofAnswers) => void }) {
  const set = <K extends keyof RoofAnswers>(k: K, v: RoofAnswers[K]) => onChange({ ...answers, [k]: v });
  return (
    <div style={{ display: "grid", gap: 22 }} data-price-questions>
      <div className={s.q} role="radiogroup" aria-label="What's on the roof now">
        <p className={s.qT}>1 · What’s on the roof now?</p>
        <div className={`${s.opts} ${s.opts3}`}>
          {EXISTING.map((e) => (
            <Opt key={e.id} name={`existing-${e.id}`} on={answers.existing === e.id} onClick={() => set("existing", e.id)} label={e.label} />
          ))}
        </div>
      </div>
      <div className={s.q} role="radiogroup" aria-label="How many floors">
        <p className={s.qT}>2 · How many floors?</p>
        <div className={`${s.opts} ${s.opts3}`}>
          {([1, 2, 3] as const).map((n) => (
            <Opt key={n} name={`storeys-${n}`} on={answers.storeys === n} onClick={() => set("storeys", n)} label={n === 3 ? "3 or more" : String(n)} />
          ))}
        </div>
      </div>
      <div className={s.q} role="radiogroup" aria-label="What would you like">
        <p className={s.qT}>3 · What would you like?</p>
        <div className={`${s.opts} ${s.opts5}`}>
          {MATERIALS.map((m) => (
            <Opt key={m.id} name={`material-${m.id}`} on={answers.material === m.id} onClick={() => set("material", m.id)} label={m.label} blurb={m.blurb} />
          ))}
        </div>
      </div>
      <div className={s.q}>
        <p className={s.qT}>Anything we should know? <span className={s.muted}>(optional)</span></p>
        <div className={s.checks}>
          {(
            [
              ["leaks", "It leaks"],
              ["skylights", "Skylights"],
              ["solarPanels", "Solar panels"],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className={`${s.check}${answers[k] ? ` ${s.checkOn}` : ""}`}>
              <input type="checkbox" checked={answers[k]} onChange={(e) => set(k, e.target.checked)} data-price-note={k} />
              {label}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
