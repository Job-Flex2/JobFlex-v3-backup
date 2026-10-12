"use client";
// The client designer's small parts (2026-10-11/12): a numbered step, a row
// of choices, a − / + stepper that also takes a typed number. Shared by the
// page (deck-client-designer) and its house step (client-house).
import * as React from "react";
import { parseLength } from "@/lib/deck/wallMeasure";
import s from "./deck-client-designer.module.css";

export const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(" ");
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const half = (v: number) => Math.round(v * 2) / 2;
/** 16 → "16 ft", 16.5 → "16 ft 6 in". */
export const ftWords = (ft: number) => {
  const inches = Math.round(ft * 12);
  const f = Math.floor(inches / 12);
  const i = inches % 12;
  return i === 0 ? `${f} ft` : f === 0 ? `${i} in` : `${f} ft ${i} in`;
};
export const inWords = (inches: number) => ftWords(inches / 12);

export function Section({ n, title, sub, children, id }: { n: number; title: string; sub?: React.ReactNode; children: React.ReactNode; id?: string }) {
  return (
    <section className={s.card} id={id} aria-labelledby={`${id ?? `sec${n}`}-h`}>
      <header className={s.cardHead}>
        <span className={s.num} aria-hidden="true">{n}</span>
        <div>
          <h2 className={s.cardTitle} id={`${id ?? `sec${n}`}-h`}>{title}</h2>
          {sub ? <p className={s.cardSub}>{sub}</p> : null}
        </div>
      </header>
      <div className={s.cardBody}>{children}</div>
    </section>
  );
}

export function Chips<T extends string | number>({ label, value, options, onChange, disabled, small }: { label: string; value: T | null; options: ReadonlyArray<{ value: T; name: string; words?: string; swatch?: string }>; onChange: (v: T) => void; disabled?: (v: T) => boolean; small?: boolean }) {
  return (
    <div className={s.chips} role="radiogroup" aria-label={label}>
      {options.map((o) => {
        const on = o.value === value;
        const off = disabled?.(o.value) ?? false;
        return (
          <button key={String(o.value)} type="button" role="radio" aria-checked={on} disabled={off} className={cx(s.chip, on && s.chipOn, o.words && s.chipTall, small && s.chipSmall)} onClick={() => onChange(o.value)}>
            <span className={s.chipName}>
              {o.swatch ? <span className={s.dot} style={{ background: o.swatch }} aria-hidden="true" /> : null}
              {o.name}
            </span>
            {o.words ? <span className={s.chipWords}>{o.words}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * − / + with the number between them. `feet`: the box also takes what a tape
 * says ("12'6", "12 ft 6 in"). The box keeps what is typed until it is left.
 */
export function Stepper({ label, value, min, max, step = 1, words, onChange, data, feet = false, compact = false }: { label: string; value: number; min: number; max: number; step?: number; words?: (v: number) => string; onChange: (v: number) => void; data?: string; feet?: boolean; compact?: boolean }) {
  const [text, setText] = React.useState<string | null>(null);
  const commit = (t: string) => {
    setText(null);
    const n = feet ? parseLength(t) : Number(t.replace(/[^\d.]/g, ""));
    if (t.trim() && n !== null && Number.isFinite(n)) onChange(clamp(n, min, max));
  };
  return (
    <div className={cx(s.stepper, compact && s.stepperCompact)} data-client-stepper={data}>
      {compact ? null : <span className={s.stepLbl}>{label}</span>}
      <div className={s.stepRow}>
        <button type="button" className={s.stepBtn} aria-label={`${label}: less`} disabled={value <= min} onClick={() => onChange(clamp(value - step, min, max))}>−</button>
        <input
          className={s.stepIn}
          inputMode="decimal"
          aria-label={label}
          value={text ?? String(Math.round(value * 10) / 10)}
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
          }}
        />
        <button type="button" className={s.stepBtn} aria-label={`${label}: more`} disabled={value >= max} onClick={() => onChange(clamp(value + step, min, max))}>+</button>
      </div>
      {words ? <span className={s.stepWords}>{words(value)}</span> : null}
    </div>
  );
}
