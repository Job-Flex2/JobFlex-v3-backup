"use client";

import { WorkSquare } from "../estimators-blueprint/work-square";
import s from "./blueprint-estimator.module.css";

const STEPS = ["Reading your plans", "Working out the job", "Measuring it on the sheets", "Pricing"];
const PRICING = 3;

export function BlueprintLoadingCard({ request, step, readDone, readTotal, priced = 0, priceTotal = 0, pricingNow = [], hint, onCancel }: {
  request: string;
  step: number;
  readDone: number;
  readTotal: number;
  /** Trades priced so far and of how many — the pricing step's real progress (2026-10-17; it read a fixed 88%). */
  priced?: number;
  priceTotal?: number;
  /** The trades being priced right now, by name. */
  pricingNow?: string[];
  hint: string;
  onCancel: () => void;
}) {
  const within = step === 0 && readTotal ? readDone / readTotal : step === PRICING && priceTotal ? priced / priceTotal : 0.5;
  const progress = Math.min(99, Math.round(((step + within) / STEPS.length) * 100));
  const pricingWords = step === PRICING && priceTotal ? `${priced} of ${priceTotal} trades` : "";
  return (
    <section className={`${s.card} ${s.work}`} aria-label="Blueprint estimate progress">
      <div className={s.workRequest}>{request}</div>
      <div className={s.workHead}>
        <div className={s.workStage} role="status">{STEPS[step]}…</div>
        <div className={s.workPercent}>{progress}%</div>
      </div>
      <div className={s.meter} role="progressbar" aria-label="Estimate progress" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${progress}%` }} />
      </div>
      <ol className={s.steps} aria-label="Estimate steps">
        {STEPS.map((label, i) => (
          <li key={label} className={i < step ? s.stepDone : i === step ? s.stepNow : undefined}>
            <WorkSquare state={i < step ? "done" : i === step ? "now" : "wait"} />
            <span>{label}</span>
            <span className={s.stepState}>{i < step ? "Done" : i === step ? (i === PRICING && pricingWords ? pricingWords : "In progress") : ""}</span>
          </li>
        ))}
      </ol>
      {step === PRICING && pricingNow.length ? <p className={s.workNow}>Pricing now: {pricingNow.join(", ")}</p> : null}
      <p className={s.workHint}>{hint}</p>
      <button type="button" className={s.btnGhost} onClick={onCancel}>Cancel</button>
    </section>
  );
}
