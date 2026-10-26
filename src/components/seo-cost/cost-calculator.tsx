"use client";

import { useId, useMemo, useState } from "react";
import { calculate, usd, unitUsd, type CalcModel } from "@/lib/seo/calc";
import s from "./cost.module.css";

// The cost guide's calculator (2026-10-26): size, material and the job's
// extras, priced instantly in the browser from the model the page was built
// with (lib/seo/pricing → lib/seo/calc) — no request, no paid API. The same
// `calculate` prints the page's tables on the server.

type Option = { id: string; label: string; detail?: string };

export type CostCalculatorProps = {
  model: CalcModel;
  size: { question: string; short: string; per: string; min: number; max: number; step: number; typical: number };
  variants: Option[];
  /** "Roofing material", "System type". */
  variantLegend: string;
  extras: Option[];
  defaultVariant: string;
  city: string;
  quotesHref: string;
  proHref: string;
  pro: string;
};

const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));

export function CostCalculator({ model, size, variants, variantLegend, extras, defaultVariant, city, quotesHref, proHref, pro }: CostCalculatorProps) {
  const id = useId();
  const [raw, setRaw] = useState(String(size.typical));
  const [variant, setVariant] = useState(defaultVariant);
  const [picked, setPicked] = useState<string[]>([]);

  const typed = Number(raw.replace(/,/g, ""));
  const valid = Number.isFinite(typed) && typed > 0;
  const qty = valid ? clamp(typed, size.min, size.max) : size.typical;
  const out = valid && (typed < size.min || typed > size.max);
  const r = useMemo(() => calculate(model, variant, qty, picked), [model, variant, qty, picked]);

  const step = (dir: 1 | -1) => setRaw(String(clamp(Math.round((qty + dir * size.step) / size.step) * size.step, size.min, size.max)));
  const toggle = (x: string) => setPicked((p) => (p.includes(x) ? p.filter((y) => y !== x) : [...p, x]));

  return (
    <div className={s.calc}>
      <div className={s.calcFields}>
        <div className={s.field}>
          <label className={s.fieldLabel} htmlFor={`${id}-size`}>
            {size.question}
          </label>
          <div className={s.stepper}>
            <button type="button" className={s.stepBtn} onClick={() => step(-1)} aria-label={`Smaller by ${size.step} ${size.short}`} disabled={qty <= size.min}>
              −
            </button>
            <input
              id={`${id}-size`}
              className={s.stepInput}
              inputMode="decimal"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              onBlur={() => setRaw(String(qty))}
              aria-describedby={`${id}-size-note`}
            />
            <button type="button" className={s.stepBtn} onClick={() => step(1)} aria-label={`Larger by ${size.step} ${size.short}`} disabled={qty >= size.max}>
              +
            </button>
          </div>
          <p id={`${id}-size-note`} className={s.fieldNote} aria-live="polite">
            {out ? `Priced at ${qty.toLocaleString("en-US")} ${size.short} — the calculator covers ${size.min.toLocaleString("en-US")} to ${size.max.toLocaleString("en-US")}.` : `${size.min.toLocaleString("en-US")} to ${size.max.toLocaleString("en-US")} ${size.short}`}
          </p>
        </div>

        <fieldset className={s.field}>
          <legend className={s.fieldLabel}>{variantLegend}</legend>
          <div className={s.choices}>
            {variants.map((v) => (
              <label key={v.id} className={s.choice} data-on={variant === v.id || undefined}>
                <input type="radio" name={`${id}-variant`} value={v.id} checked={variant === v.id} onChange={() => setVariant(v.id)} />
                <span>
                  <b>{v.label}</b>
                  {v.detail ? <small>{v.detail}</small> : null}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {extras.length ? (
          <fieldset className={s.field}>
            <legend className={s.fieldLabel}>The job</legend>
            <div className={s.choices}>
              {extras.map((x) => (
                <label key={x.id} className={s.choice} data-on={picked.includes(x.id) || undefined}>
                  <input type="checkbox" checked={picked.includes(x.id)} onChange={() => toggle(x.id)} />
                  <span>
                    <b>{x.label}</b>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
      </div>

      <div className={s.calcResult} aria-live="polite">
        <span className={s.annot}>Estimated cost in {city}</span>
        <strong className={s.calcAvg}>{usd(r.avg)}</strong>
        <span className={s.calcRange}>
          {usd(r.lo)} – {usd(r.hi)}
        </span>
        <span className={s.calcPer}>
          {unitUsd(r.avg / qty)} {size.per} · {Math.round((r.labor / r.avg) * 100)}% labor
        </span>
        <a className={s.primary} href={quotesHref} data-seo-cta="quotes_calc">
          Get exact quotes from local pros
        </a>
        <p className={s.calcPro}>
          Are you a {pro}?{" "}
          <a href={proHref} data-seo-cta="pro_calc">
            Price jobs like this in 60 seconds
          </a>
        </p>
      </div>
    </div>
  );
}
